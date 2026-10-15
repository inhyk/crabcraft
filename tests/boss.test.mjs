import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Boss } from '../tmp/test-modules/boss.js';
import { LEVEL_XP, xpForLevel, levelForXp, BOSS_PROFILES, canChallenge, canEnterWorld2, patrolReward } from '../src/game/progression.ts';

function setup(profile=BOSS_PROFILES.rust, level=profile.level) {
 const damage=[], warnings=[], actions=[];
 function unit(){return {pos:new THREE.Vector3(),rig:{root:new THREE.Group(),face:{setTint(){}}},level:1,hp:1,maxHp:1,alive:true,hidden:false,height:3,radius:1,yaw:0,lift:0,stunUntil:0,slowUntil:0,motion:{stop(){}},setBaseTint(){},express(){},act(a){actions.push(a)},cancelPendingHit(){},setYaw(y){this.yaw=y},teleport(w,x,z,yaw=0){this.pos.set(x,0,z);this.yaw=yaw},moveTo(w,x,z){this.pos.set(x,0,z)},feedLocomotion(){},stunned(){return false},speedMul(){return 1},distTo(other){return this.pos.distanceTo(other.pos)},gapTo(other){return this.distTo(other)-this.radius-other.radius}};}
 const player=unit();player.level=level;player.hp=player.maxHp=300;player.pos.set(100,0,100);
 const game={time:0,world:{heightAt(){return 0}},player:{unit:player,level},controlsLocked:false,say(){},audio:{sfx(){}},hud:{bossFrame:{show(){},hide(){}},messages:{warn(x){warnings.push(x)},banner(){}},floats:{spawn(){}}},follow:{shake(){}},vfx:new Proxy({fx:{release(){}}},{get(target,key){return key in target?target[key]:()=>({})}}),combat:{damage(a,b,n){damage.push(n);b.hp-=n},kill(u){u.alive=false}},spawnAdd(){return null},seaDirection(){return new THREE.Vector3(1,0,0)}};
 const boss=new Boss(game,unit(),{position:new THREE.Vector3(),radius:15,yaw:0},unit(),profile);
 return {game,boss,player,damage,warnings,actions};
}

test('levels 3 and 10 are reachable with ordered thresholds and genuine progression gates',()=>{
 assert.equal(levelForXp(899),2);assert.equal(levelForXp(900),3);assert.equal(levelForXp(6499),9);assert.equal(levelForXp(6500),10);
 assert.equal(canChallenge(2,3,false),false);assert.equal(canChallenge(3,3,false),true);
 assert.equal(canChallenge(9,10,true),false);assert.equal(canChallenge(10,10,false),false);assert.equal(canChallenge(10,10,true),true);
 // A first victory plus ordinary kills and five-kill patrols reaches the final boss without debug XP.
 let xp=1400,kills=0;
 while(xp<LEVEL_XP[9]&&kills<200){const level=levelForXp(xp);xp+=50+12*(level-2);if(++kills%5===0)xp+=patrolReward(level);}
 assert.ok(kills<60,`Progression too slow: ${kills} kills`);
});

test('boss cannot start below its required level, then unlocks on level-up',()=>{
 const {game,boss,player}=setup(BOSS_PROFILES.rust,2);
 boss.wake();boss.update(2.5);player.pos.set(0,0,8);boss.update(.1);
 assert.equal(boss.state,'idle');assert.equal(boss.unit.invulnerable,true);assert.equal(boss.unit.targetable,false);
 game.player.level=player.level=3;boss.update(.1);
 assert.equal(boss.state,'fight');assert.equal(boss.unit.invulnerable,false);
});

test('both boss encounters transition phases and reset cleanly after player death',()=>{
 for(const profile of Object.values(BOSS_PROFILES)){
  const {boss,player}=setup(profile);boss.wake();boss.update(2.5);player.pos.set(0,0,8);boss.update(.1);
  boss.unit.hp=profile.hp*.55;boss.update(.1);assert.equal(boss.phase,2);
  boss.unit.hp=profile.hp*.2;boss.update(.1);assert.equal(boss.phase,3);assert.equal(boss.enraged,true);
  player.alive=false;boss.update(.1);assert.equal(boss.state,'idle');assert.equal(boss.phase,1);assert.equal(boss.enraged,false);assert.equal(boss.unit.hp,profile.hp);assert.equal(boss.telegraphActive,false);
 }
});

test('level 10 nova is telegraphed and avoidable, but hits a player who stays inside',()=>{
 for(const dodge of [true,false]){
  const {game,boss,player,damage,warnings}=setup(BOSS_PROFILES.abyss);
  boss.wake();boss.update(2.5);player.pos.set(0,0,8);boss.update(.1);
  game.time=10;boss.update(.1);boss.update(2); // first slam
  game.time=20;boss.update(.1);assert.equal(boss.mechName,'nova');assert.ok(warnings.some(x=>x.includes('푸른 원')));
  const before=damage.length;if(dodge)player.pos.set(12,0,8);boss.update(2.5);
  assert.equal(damage.length-before,dodge?0:1);
 }
});

test('boss area attacks damage every party member inside the shared telegraph and spare those outside',()=>{
 const {game,boss,player,damage}=setup(BOSS_PROFILES.abyss);
 const friend={...player,pos:new THREE.Vector3(1,0,8),kind:'remote'},dodger={...player,pos:new THREE.Vector3(20,0,8),kind:'remote'};
 game.combatPlayers=()=>[player,friend,dodger];game.combatTarget=()=>player;
 boss.wake();boss.update(2.5);player.pos.set(0,0,8);boss.update(.1);
 game.time=10;boss.update(.1);boss.update(2);
 game.time=20;boss.update(.1);assert.equal(boss.mechName,'nova');
 const before=damage.length;boss.update(2.5);assert.equal(damage.length-before,2);assert.equal(dodger.hp,300);
});

test('direct chapter travel preserves story checkpoints and unlimited levels',()=>{
 assert.equal(LEVEL_XP.length,20);assert.equal(levelForXp(21999),19);assert.equal(levelForXp(22000),20);
 assert.equal(canEnterWorld2(false,true),false);assert.equal(canEnterWorld2(true,false),false);assert.equal(canEnterWorld2(true,true),true);
 assert.equal(canChallenge(20,20,true,false,2),true);assert.equal(canChallenge(20,20,true,true,1),false);
 assert.equal(canChallenge(19,20,true,true,2),false);assert.equal(canChallenge(20,20,true,true,2),true);
 let xp=6500,kills=0;while(xp<22000 && kills<200){const level=levelForXp(xp);xp+=140+12*(level-2);if(++kills%5===0)xp+=patrolReward(level);}
 assert.ok(kills<80,`World II needs too many kills: ${kills}`);
});
test('the eclipse attack protects the inner sanctuary and hits the surrounding danger ring for every player',()=>{
 const {game,boss,player,damage,warnings}=setup(BOSS_PROFILES.eclipse);
 boss.wake();boss.update(2.5);player.pos.set(0,0,8);boss.update(.1);
 game.time=10;boss.update(.1);boss.update(2);
 game.time=20;boss.update(.1);assert.equal(boss.mechName,'eclipse');
 const at=boss.networkState('b20').mech.at;
 player.pos.set(at[0]+4,0,at[2]);
 const friend={...player,pos:new THREE.Vector3(at[0]+8,0,at[2]),kind:'remote'};
 const far={...player,pos:new THREE.Vector3(at[0]+15,0,at[2]),kind:'remote'};
 game.combatPlayers=()=>[player,friend,far];
 const before=damage.length;boss.update(3);assert.equal(damage.length-before,1);
 assert.equal(friend.hp,player.hp-114);assert.equal(far.hp,player.hp);
 assert.ok(warnings.some(x=>x.includes('초록 원')));
});


test('unlimited thresholds remain ordered and invert exactly above 20',()=>{
 for(const level of [21,22,50,100,1000,100000]) {
   const xp=xpForLevel(level);assert.equal(levelForXp(xp),level);assert.equal(levelForXp(xp-1),level-1);
   assert.ok(xpForLevel(level+1)>xp);
 }
 assert.equal(xpForLevel(21),24200);assert.equal(xpForLevel(22),26600);
});
test('turning the lighthouse off prevents waking and suspends an existing encounter',()=>{
 const {game,boss}=setup();game.world.getEnvironment=()=>({mood:3,beacon:false});boss.wake();assert.equal(boss.state,'dormant');
 game.world.getEnvironment=()=>({mood:1,beacon:true});boss.wake();boss.update(2.5);assert.equal(boss.state,'idle');
 boss.sleep();assert.equal(boss.state,'dormant');assert.equal(boss.unit.hidden,true);assert.equal(boss.unit.invulnerable,true);assert.equal(boss.unit.targetable,false);
});

test('World II boss combat leaves the World I lighthouse and morning unchanged',()=>{
 const {game,boss,player}=setup(BOSS_PROFILES.eclipse);
 let mood=3;game.world.getEnvironment=()=>({mood,beacon:false});game.world.setMood=value=>{mood=value};
 boss.wake();boss.update(2.5);player.pos.set(0,0,8);boss.update(.1);
 assert.equal(boss.state,'fight');assert.equal(mood,3);assert.equal(game.world.getEnvironment().beacon,false);
});
