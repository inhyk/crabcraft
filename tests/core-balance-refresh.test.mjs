import test from 'node:test';import assert from 'node:assert/strict';
import {createArea} from '../src/sim/area.ts';import {realActionData} from '../src/sim/data/actions.ts';
import {canonicalEnemyLevel,canonicalEnemyRespawn,enemyRespawnClearance,enemyStats} from '../src/sim/data/enemies.ts';
function fixture(chapter,kind='scavenger',role='ordinary'){
 const home={x:0,y:0,z:0},spawn={id:'spawn',position:{x:40,y:0,z:0},yaw:0,radius:2},s={id:'enemy',kind,role,home,pack:'one',fixedLevel:canonicalEnemyLevel(kind,chapter,role),wanderRadius:0};
 const area=createArea({id:`balance-${chapter}-${kind}-${role}`,seed:13,definition:{world:`w${chapter}`,spawn,recall:spawn,pois:{},npcs:[],bosses:[],enemies:[s],interactions:[]},query:{heightAt:()=>0,resolveCollision:(x,z,r,out)=>out.set(x,z),raycastSolid:()=>null},actionData:realActionData,context:{mode:'public',members:[],pvp:'disabled'},policy:{enemyLevel:()=>canonicalEnemyLevel(kind,chapter,role),enemyPopulation:()=>({desired:1,respawnSeconds:canonicalEnemyRespawn(kind,chapter,role)}),damageAllowed:()=>true,canInteract:()=>true},limits:{eventCount:10000,inputCommandsPerTick:32,timers:100,projectiles:100}});const ref=area.attachFresh('fighter','mage','human','spawn'),u=area.services.getUnit(ref),enemy=[...area.enemies.values()][0];if(role!=='ordinary')enemy.respawnAt(0,0);return {area,u,enemy};
}
const tick=(a,n)=>{for(let i=0;i<n;i++)a.step(new Map());};
test('canonical fixed world tiers ignore high-level visitors and preserve exact guardian/add/echo roles',()=>{
 const levels={1:[1,2,2],2:[10,12,10],3:[20,22,20],4:[100,102,100]};
 for(const chapter of [1,2,3,4])for(const [index,kind]of ['scrapling','scavenger','jellyfish'].entries()){const {area,u,enemy}=fixture(chapter,kind);assert.equal(enemy.actor.level,levels[chapter][index]);const stats={...enemy.stats,dmg:[...enemy.stats.dmg]};u.level=100000;u.x=100;tick(area,2);assert.deepEqual(enemy.stats,stats);assert.equal(enemyRespawnClearance(kind,chapter,'ordinary'),kind==='scavenger'&&(chapter===2||chapter===3)?8:22);}
 assert.equal(canonicalEnemyLevel('scavenger',4,'add'),2);assert.equal(canonicalEnemyLevel('scavenger',4,'echo'),10);assert.equal(canonicalEnemyRespawn('scavenger',3,'ordinary'),6);assert.equal(canonicalEnemyRespawn('scavenger',4,'ordinary'),12);assert.equal(enemyStats('scavenger',12,2,'ordinary').respawn,6);
});
test('actual World II and III guardians use six seconds and eight metre player clearance',()=>{
 for(const chapter of [2,3]){const {area,u,enemy}=fixture(chapter);const old=enemy.unit;area.services.combat.kill(old,null);u.x=7;tick(area,182);assert.equal(enemy.state,'dead');u.x=8.1;tick(area,1);assert.equal(enemy.actor.alive,true);assert.equal(enemy.unit.life,old.life+1);}
 const {area,u,enemy}=fixture(4);area.services.combat.kill(enemy.unit,null);u.x=10;tick(area,370);assert.equal(enemy.state,'dead');u.x=22.1;tick(area,1);assert.equal(enemy.actor.alive,true);
});
test('Echo respawn waits120seconds after death while initial45second scheduling cannot shorten it',()=>{
 const {area,u,enemy}=fixture(2,'scavenger','echo');tick(area,90);const diedAt=area.services.time,old=enemy.unit;area.services.combat.kill(old,null);u.x=30;tick(area,3599);assert.equal(enemy.state,'dead');assert.ok(area.services.time-diedAt<120);tick(area,3);assert.equal(enemy.actor.alive,true);assert.equal(enemy.unit.life,old.life+1);assert.equal(enemy.actor.level,10);
});


test('endgame claw cadence and post-warning gaps match refreshed public balance',async()=>{
 const {Boss}=await import('../src/sim/boss.ts');const {creatureHarness}=await import('./core-enemy.test.mjs');
 const fight=(profile)=>{const h=creatureHarness(),p=h.unit('player',{x:0,y:0,z:3});p.level=300;p.hp=p.maxHp=10000;const u=h.unit('boss',{x:0,y:0,z:0},profile),f=h.unit('freed'),b=new Boss(h.s,u,{id:'arena',position:{x:0,y:0,z:0},yaw:0,radius:17},f,profile);h.controllers.set(u.ref.id,b);b.wake();for(let i=0;i<74;i++)h.step([b]);assert.equal(b.state,'fight');return {...h,b};};
 for(const profile of ['dawn','frost']){
  for(const enraged of [false,true]){const h=fight(profile);if(enraged){h.b.actor.hp=h.b.actor.maxHp*.2;h.step([h.b]);}const before=h.b.debugState().nextSwing;let changed=false;for(let i=0;i<90;i++){h.step([h.b]);const next=h.b.debugState().nextSwing;if(next!==before){assert.ok(Math.abs(next-h.s.time-(enraged?2.2:2.8))<1e-10);changed=true;break;}}assert.equal(changed,true);}
  for(const phase of [1,2,3]){const h=fight(profile);if(phase>1)h.b.actor.hp=h.b.actor.maxHp*(phase===2?.7:.2);let warning;for(let i=0;i<1000&&!warning;i++){h.step([h.b]);warning=h.events.find(e=>e.type==='telegraph');}assert.ok(warning);const gap=phase===3?2.4:phase===2?2.8:3.2;assert.ok(Math.abs(h.b.debugState().nextMech-h.s.time-warning.seconds-gap)<1e-9);}
 }
});
