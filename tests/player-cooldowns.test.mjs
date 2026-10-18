import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Player} from '../tmp/test-modules/player.js';
import {CLASSES} from '../src/data/classes.ts';

// Real Player/useAbility/commit/executeAbility; only rendering, world and animation are stubbed.
function setup(cls,ab){
 const unit={pos:new THREE.Vector3(),radius:1,height:2,yaw:0,level:1,alive:true,lastCombat:100,stunUntil:0,slowUntil:0,rustUntil:0,absorb:0,
  stunned(){return false;},distTo(t){return this.pos.distanceTo(t.pos);},gapTo(t){return this.distTo(t)-this.radius-t.radius;},
  act(_name,opts){opts?.onHit?.();},socketPos(_name,out){return out.copy(this.pos);},centre(out){return out.copy(this.pos);},
  teleport(_world,x,z){this.pos.set(x,0,z);},express(){},motion:{stop(){}},rig:{face:{setTint(){}}}};
 const target={...unit,pos:new THREE.Vector3(0,0,ab.id==='sideways-charge'?5:2),hostile:true,kind:'enemy',cancelPendingHit(){}};
 const effects=[],errors=[];
 const game={time:100,controlsLocked:false,world:{raycastSolid(){return null;},heightAt(){return 0;},resolveCollision(x,z,_radius,out){return out.set(x,z);}},
  units:[target],input:{isDown(){return false;}},audio:{sfx(){}},follow:{shake(){}},
  hud:{actionBar:{press(){}},castBar:{start(){},finish(){},fail(){}},messages:{error(m){errors.push(m);}},floats:{spawn(){}}},
  combat:{damage(_a,_b,n){effects.push('damage');return n;},heal(_src,dst,n){effects.push('heal');dst.hp=Math.min(dst.maxHp,dst.hp+n);}},
  vfx:new Proxy({projectile(_from,_to,_style,_speed,hit){hit();}},{get(o,k){return o[k]??(()=>({pop(){}}));}})};
 const player=new Player(game,unit,cls);game.player=player;player.target=target;player.resource=player.maxResource=10000;player.nextSwing=Infinity;
 return {game,player,effects,errors};
}
function release(s,ab){if(s.player.cast){s.game.time=s.player.cast.end;s.player.updateCombat();}assert.equal(s.player.cast,null);assert.ok(s.player.cooldownLeft(ab)>0);}

for(const cls of Object.values(CLASSES))for(const ab of cls.abilities){
 test(`${cls.id}/${ab.id}: repeated input and queued input cannot bypass personal recovery`,()=>{
  const s=setup(cls,ab),{game,player}=s;
  assert.ok(Number.isFinite(ab.cooldown)&&ab.cooldown>=3,'every active skill needs real recovery');
  player.useAbility(ab.slot);release(s,ab);
  const first={...player.cooldowns.get(ab.id)},resource=player.resource,effects=s.effects.length;
  assert.equal(first.end-first.start,ab.cooldown);
  // Keep ample resources: rejection must come from the cooldown, not exhaustion or GCD.
  for(game.time=first.start+1.1;game.time<first.end-.4;game.time+=.05){player.useAbility(ab.slot);player.updateCombat();}
  assert.equal(player.resource,resource);assert.equal(s.effects.length,effects);assert.deepEqual(player.cooldowns.get(ab.id),first);
  game.time=first.end-.2;player.useAbility(ab.slot);player.updateCombat();assert.equal(player.cast,null);assert.equal(player.resource,resource);
  game.time=first.end;player.updateCombat();release(s,ab);
  assert.ok(player.cooldowns.get(ab.id).start>=first.end,'queued cast releases only after recovery');
  assert.equal(player.resource,Math.min(player.maxResource,resource-ab.cost+(ab.generates??0)));
 });
}

test('level restoration and respawn refill resources without clearing recovery',()=>{
 const ab=CLASSES.priest.abilities[1],s=setup(CLASSES.priest,ab);s.player.useAbility(2);release(s,ab);
 const cd={...s.player.cooldowns.get(ab.id)};
 s.player.restoreXp(Number.MAX_SAFE_INTEGER);assert.deepEqual(s.player.cooldowns.get(ab.id),cd);
 s.player.target=null;s.player.respawn();assert.deepEqual(s.player.cooldowns.get(ab.id),cd);
 s.game.time=cd.start+2;s.player.useAbility(2);assert.equal(s.player.cast,null);assert.deepEqual(s.player.cooldowns.get(ab.id),cd);
});

test('cancelling a heal releases no effect, does not spend mana, and retains the GCD',()=>{
 const ab=CLASSES.priest.abilities[1],s=setup(CLASSES.priest,ab),resource=s.player.resource;
 s.player.useAbility(2);assert.ok(s.player.cast);s.game.time+=.1;s.player.interruptCast();
 assert.equal(s.effects.length,0);assert.equal(s.player.resource,resource);assert.equal(s.player.cooldownLeft(ab),0);
 s.player.useAbility(2);assert.equal(s.player.cast,null);
 s.game.time=s.player.gcdEnd;s.player.useAbility(2);release(s,ab);assert.equal(s.effects.length,1);
});

test('expiry does not bypass insufficient mana or allow two different instant skills in one GCD',()=>{
 const ab=CLASSES.mage.abilities[1],s=setup(CLASSES.mage,ab);
 s.player.useAbility(2);const paid=s.player.resource;s.player.useAbility(4);
 assert.equal(s.player.resource,paid);assert.equal(s.player.cooldowns.has('tidal-nova'),false);
 s.game.time=s.player.cooldowns.get(ab.id).end;s.player.resource=ab.cost-1;s.player.useAbility(2);
 assert.equal(s.player.cooldownLeft(ab),0);assert.equal(s.player.resource,ab.cost-1);
});

for (const cls of Object.values(CLASSES)) test(`${cls.id}: ultimate locks for exactly 60 seconds, rejects locked play and cannot reset on respawn`,()=>{
 const ab=cls.abilities.find(a=>a.slot===5);assert.ok(ab);assert.equal(ab.cooldown,60);
 const s=setup(cls,ab),{game,player}=s;player.resource=0;
 game.controlsLocked=true;player.useAbility(5);assert.equal(s.effects.length,0);game.controlsLocked=false;
 game.villageGames={playing:true};player.useAbility(5);assert.equal(s.effects.length,0);game.villageGames.playing=false;
 player.useAbility(5);assert.equal(s.effects.length,1);const cd={...player.cooldowns.get(ab.id)};
 assert.equal(cd.end-cd.start,60);player.restoreXp(900);player.target=null;player.respawn();assert.deepEqual(player.cooldowns.get(ab.id),cd);
 game.time=cd.end-.1;player.useAbility(5);player.updateCombat();assert.equal(s.effects.length,1);
 game.time=cd.end;player.updateCombat();assert.equal(s.effects.length,2);assert.equal(player.cooldownLeft(ab),60);
});

test('ultimate respects range, hidden enemies and line of sight',()=>{
 const cls=CLASSES.mage,ab=cls.abilities[4],s=setup(cls,ab);const near=s.game.units[0];
 s.game.units.push({...near,pos:new THREE.Vector3(40,0,0)},{...near,hidden:true});
 s.game.world.raycastSolid=()=>0;s.player.useAbility(5);assert.equal(s.effects.length,0);
 s.game.world.raycastSolid=()=>null;s.game.time+=60;s.player.useAbility(5);assert.equal(s.effects.length,1);
});


test('mage slot 3 heals exactly 10 HP, blinks safely, and cannot repeat its heal during the 15-second cooldown',()=>{
 const ab=CLASSES.mage.abilities[2],{game,player}=setup(CLASSES.mage,ab);const u=player.unit;
 u.hp=50;u.maxHp=100;player.useAbility(3);assert.equal(u.hp,60);assert.equal(u.pos.z,8);
 game.time+=2;player.useAbility(3);assert.equal(u.hp,60);assert.equal(u.pos.z,8);
 game.time=player.cooldowns.get(ab.id).end;player.gcdEnd=game.time;u.hp=96;
 game.world.resolveCollision=(x,z,r,out)=>out.set(x,z>10?z+2:z);player.useAbility(3);
 assert.equal(u.hp,100);assert.equal(u.pos.z,10);assert.equal(player.cooldownLeft(ab),15);
});
