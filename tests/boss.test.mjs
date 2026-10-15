import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Boss } from '../tmp/test-modules/boss.js';
import { LEVEL_XP, levelForXp, BOSS_PROFILES, canChallenge, patrolReward } from '../src/game/progression.ts';

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
