import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {BattleSync} from '../tmp/test-modules/battle.js';
import {Combat} from '../tmp/test-modules/combat.js';

function unit(kind='scrapling') {
 const u={kind,name:kind,reaction:kind==='scrapling'||kind==='boss'?'hostile':'friendly',pos:new THREE.Vector3(),hp:100,maxHp:100,level:3,alive:true,hidden:false,invulnerable:false,targetable:true,
  yaw:0,stunUntil:0,slowUntil:0,slowPct:0,rust:0,rustUntil:0,pushX:0,pushZ:0,pushTime:0,absorb:0,lastCombat:0,radius:1,
  rig:{root:new THREE.Group(),face:{setTint(){}}},motion:{action:null,stop(){}},ctrl:null,
  act(action){this.onAction?.(action)},express(){},flash(){},cancelPendingHit(){},feedLocomotion(){},setYaw(y){this.yaw=y},setBaseTint(){},centre(v){return v.copy(this.pos)},distTo(o){return this.pos.distanceTo(o.pos)}};
 Object.defineProperty(u,'hostile',{get:()=>u.reaction==='hostile'});return u;
}
function game() {
 const p=unit('player'),enemy=unit();enemy.ctrl={state:'idle',stats:{xp:20},onDamaged(){this.state='chase'},onDeath(){this.state='dead'},resumeAuthority(){}};
 const boss=id=>{const b={unit:unit('boss'),freed:unit('freed'),state:'dormant',phase:1,enraged:false,
  networkState(){return {id,state:this.state,phase:this.phase,enraged:this.enraged,mech:null}},applyNetwork(s){Object.assign(this,s)},resumeAuthority(){},wake(){this.state='waking'}};return b};
 const noop=()=>{};
 let mood=0,beacon=false;
 const g={world:{setMood(m){mood=m},setBeaconLit(b){beacon=b},getEnvironment(){return {mood,beacon}}},time:10,god:false,rewards:0,units:[p,enemy],enemies:[{unit:enemy,resumeAuthority(){}}],boss:boss('b3'),finalBoss:boss('b10'),worldBoss:boss('b20'),encounter:{engaged:false},world2:{chapter:1,enter(){this.chapter=2},returnToShore(){this.chapter=1}},journey:{rustCleared:false,abyssCleared:false},
  player:{unit:p,setTarget:noop,gainRage:noop,onDamaged:noop,onWardHit:noop},hud:{floats:{spawn:noop},damageFlash:noop,messages:{info:noop}},
  follow:{shake:noop},audio:{sfx:noop},vfx:{deathPoof:noop,smoke:noop,stunStars:noop},onUnitDied(u){if(u.kind==='scrapling')this.rewards++}};
 g.combat=new Combat(g);return g;
}
function pair() {
 const a=game(),b=game(),queue=[],ar=unit('remote'),br=unit('remote');
 const ap=new Map([['b',{unit:ar}]]),bp=new Map([['a',{unit:br}]]);
 const relay=(id,packet)=>queue.push({id,packet});
 const aa=new BattleSync(a,p=>relay('a',p),()=>ap),bb=new BattleSync(b,p=>relay('b',p),()=>bp);
 a.multiplayer={battle:aa};b.multiplayer={battle:bb};aa.join('a','a',null);bb.join('b','a',null);
 const flush=()=>{let guard=0;while(queue.length){assert.ok(++guard<100);const {id,packet:p}=queue.shift(),dst=id==='a'?bb:aa;
  if(p.type==='world')dst.apply(p.world);if(p.type==='combat')dst.receive(id,p.event);}};
 aa.update(.1);flush();return {a,b,aa,bb,ar,flush};
}

test('guest and host damage reduce the same enemy HP; death grants exactly one reward per player',()=>{
 const {a,b,aa,flush}=pair(),enemy=a.enemies[0].unit,mirror=b.enemies[0].unit;
 b.combat.damage(b.player.unit,mirror,23);assert.equal(mirror.hp,100);flush();assert.equal(enemy.hp,77);assert.equal(mirror.hp,77);
 a.combat.damage(a.player.unit,enemy,31);aa.update(.1);flush();assert.equal(enemy.hp,46);assert.equal(mirror.hp,46);
 b.combat.damage(b.player.unit,mirror,46);flush();assert.equal(enemy.alive,false);assert.equal(mirror.alive,false);
 assert.equal(a.rewards,1);assert.equal(b.rewards,1);
 b.combat.damage(b.player.unit,mirror,46);flush();assert.equal(a.rewards,1);assert.equal(b.rewards,1);
});
test('enemy hits damage the remote owner, not the host; guest stun and knockback reach the authoritative enemy',()=>{
 const {a,b,bb,ar,flush}=pair(),enemy=a.enemies[0].unit,mirror=b.enemies[0].unit;
 a.combat.damage(enemy,ar,19);flush();assert.equal(b.player.unit.hp,81);assert.equal(a.player.unit.hp,100);
 mirror.stunUntil=b.time+2;mirror.slowUntil=b.time+4;mirror.slowPct=.5;mirror.pushX=12;mirror.pushTime=.35;
 bb.condition(mirror);flush();assert.equal(enemy.stunUntil,a.time+2);assert.equal(enemy.slowPct,.5);assert.equal(enemy.pushX,12);
});
test('late joins and host migration preserve combat state without granting old kill rewards',()=>{
 const {a,b,aa,bb,flush}=pair();
 a.combat.damage(a.player.unit,a.enemies[0].unit,100);flush();assert.equal(b.rewards,1);
 const c=game(),cc=new BattleSync(c,()=>{},()=>new Map());c.multiplayer={battle:cc};
 cc.join('c','a',aa.snapshot());assert.equal(c.enemies[0].unit.alive,false);assert.equal(c.rewards,0);
 bb.elect('b');assert.equal(bb.authority,true);assert.equal(b.enemies[0].unit.alive,false);assert.equal(b.rewards,1);
});

test('boss death still grants one reward when an add-death checkpoint arrived first',()=>{
 const {b,bb}=pair();b.enemies[0].unit.alive=false;
 bb.receive('a',{kind:'death',target:'e0',serial:99});assert.equal(b.rewards,1);
 bb.receive('a',{kind:'death',target:'e0',serial:99});assert.equal(b.rewards,1);
});
test('boss night, celebration, beacon and world clock synchronize including late join and host transfer',()=>{
 const {a,b,aa,bb,flush}=pair();
 a.world.setMood(1);a.world.setBeaconLit(true);aa.worldTime(100,.1);aa.update(.1);flush();
 assert.deepEqual(b.world.getEnvironment(),{mood:1,beacon:true});assert.equal(bb.worldTime(999,0),aa.worldTime(999,0));
 // A guest completing the beacon/night step asks the host; it never changes only its own sky.
 a.world.setMood(0);aa.update(.1);flush();b.world.setMood(1);assert.equal(b.world.getEnvironment().mood,0);flush();assert.equal(a.world.getEnvironment().mood,1);assert.equal(b.world.getEnvironment().mood,1);
 a.journey.abyssCleared=true;a.world.setMood(2);aa.update(.1);flush();
 const c=game(),cc=new BattleSync(c,()=>{},()=>new Map());c.multiplayer={battle:cc};cc.join('c','a',aa.snapshot());assert.deepEqual(c.world.getEnvironment(),{mood:2,beacon:true});
 const clock=bb.worldTime(12345,0);bb.elect('b');assert.equal(bb.worldTime(12345,0),clock);assert.equal(b.world.getEnvironment().mood,2);
});

test('World II entry and the final crown survive late join and authority transfer',()=>{
 const {a,b,aa,bb,flush}=pair();
 // A guest can use direct travel, but cannot teleport the room during combat.
 a.encounter.engaged=true;bb.enterWorld2();flush();assert.equal(a.world2.chapter,1);a.encounter.engaged=false;
 a.journey.rustCleared=true;a.journey.abyssCleared=true;a.journey.firstEndingSeen=true;
 aa.update(.1);flush();bb.enterWorld2();flush();
 assert.equal(a.world2.chapter,2);assert.equal(b.world2.chapter,2);
 a.journey.trueCleared=true;a.worldBoss.state='dead';a.worldBoss.unit.level=20;
 aa.update(.1);flush();assert.equal(b.journey.trueCleared,true);assert.equal(b.worldBoss.state,'dead');
 const c=game(),cc=new BattleSync(c,()=>{},()=>new Map());cc.join('c','a',aa.snapshot());
 assert.equal(c.world2.chapter,2);assert.equal(c.worldBoss.unit.level,20);assert.equal(c.journey.trueCleared,true);
 bb.elect('b');assert.equal(bb.authority,true);assert.equal(b.world2.chapter,2);
});


test('two-way portals synchronize both chapters without losing story crowns',()=>{
 const {a,b,aa,bb,flush}=pair();a.journey.rustCleared=true;a.journey.abyssCleared=true;
 bb.travel(2);flush();assert.equal(a.world2.chapter,2);assert.equal(b.world2.chapter,2);
 bb.travel(1);flush();assert.equal(a.world2.chapter,1);assert.equal(b.world2.chapter,1);assert.equal(b.journey.abyssCleared,true);
});
test('a guest can turn off the shared beacon and request morning',()=>{
 const {a,b,aa,bb,flush}=pair();a.world.setBeaconLit(true);aa.update(.1);flush();
 bb.requestLighthouse(false);flush();assert.equal(a.world.getEnvironment().beacon,false);assert.equal(b.beaconLit,false);
});


test('room PvP is off by default; parties prevent friendly fire and rivals receive one hit',()=>{
 const {a,b,aa,bb,ar,flush}=pair();ar.invulnerable=false;
 a.combat.damage(a.player.unit,ar,15);flush();assert.equal(b.player.unit.hp,100);
 aa.setMode('pvp');flush();assert.equal(bb.mode,'pvp');
 a.combat.damage(a.player.unit,ar,15);flush();assert.equal(b.player.unit.hp,85);
 aa.setParty(2);bb.setParty(2);flush();a.time+=1;
 a.combat.damage(a.player.unit,ar,15);flush();assert.equal(b.player.unit.hp,85);
 bb.setParty(3);flush();a.time+=1;a.combat.damage(a.player.unit,ar,15);flush();assert.equal(b.player.unit.hp,70);
});
test('guests cannot enable PvP and out-of-range attacks do no damage',()=>{
 const {a,b,aa,bb,ar,flush}=pair();bb.setMode('pvp');flush();assert.equal(aa.mode,'coop');
 aa.setMode('pvp');flush();ar.pos.set(100,0,100);a.combat.damage(a.player.unit,ar,20);flush();assert.equal(b.player.unit.hp,100);
});

test('a stale guest night request cannot override an extinguished beacon or change shore weather from World II',()=>{
 const {a,b,aa,flush}=pair();
 a.world.setMood(3);a.world.setBeaconLit(false);aa.update(.1);flush();b.world.setMood(1);flush();
 assert.deepEqual(a.world.getEnvironment(),{mood:3,beacon:false});assert.deepEqual(b.world.getEnvironment(),{mood:3,beacon:false});
 a.world.setBeaconLit(true);a.world.setMood(0);a.world2.enter();aa.update(.1);flush();b.world.setMood(1);flush();
 assert.deepEqual(a.world.getEnvironment(),{mood:0,beacon:true});assert.deepEqual(b.world.getEnvironment(),{mood:0,beacon:true});
});
