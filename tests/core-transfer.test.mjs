import test from 'node:test';
import assert from 'node:assert/strict';
import {SimulationArea} from '../src/sim/area.ts';
import {realActionData} from '../src/sim/data/actions.ts';
import {createWorld1Definition} from '../src/sim/areas/world1.ts';
import {createWorld2Definition} from '../src/sim/areas/world2.ts';
import {InMemoryTransferCoordinator,captureTransfer} from '../src/sim/transfer.ts';
const query={heightAt:()=>0,resolveCollision:(x,z,r,out)=>out.set(x,z),raycastSolid:()=>null};
function area(id,world='w1',overrides={}){const config={query,fixedLevels:{scrapling:1,scavenger:2,jellyfish:2,echo:10},population:{scrapling:1,scavenger:0,jellyfish:0}};return new SimulationArea({id,definition:(world==='w1'?createWorld1Definition:createWorld2Definition)(config),query,seed:15,policy:{enemyLevel:s=>s.fixedLevel,enemyPopulation:()=>({desired:1,respawnSeconds:30}),damageAllowed:()=>true,canInteract:()=>true},actionData:realActionData,context:{mode:'public',members:[],pvp:'disabled'},limits:{eventCount:100000,inputCommandsPerTick:32,timers:1000,projectiles:1000},...overrides});}
function actor(a,id='hero'){const ref=a.attachFresh(id,'mage','human','spawn'),p=a.services.player(ref),u=a.services.getUnit(ref);p.state.flags.abyssCleared=true;p.state.flags.trueCleared=true;return {ref,p,u};}
function ready(a,u,gate='gate:w2'){Object.assign(u,a.services.definition.interactions.find(i=>i.id===gate).position);u.lastCombat=a.services.time-10;}
test('real Area transfer rebases ultimate, histories and retained statuses from time1000 to10',()=>{
 const src=area('transfer-high'),dst=area('transfer-low','w2'),c=new InMemoryTransferCoordinator();
 // Advance actual clocks using their real step ownership; no fake Area services.
 for(let i=0;i<30000;i++)src.step(new Map());for(let i=0;i<300;i++)dst.step(new Map());
 const{p,u,ref}=actor(src);c.characters.compareAndSwap('hero',null,ref);p.state.cooldowns['crown-burst']={start:src.services.time-10,end:src.services.time+50};p.state.gcdStart=src.services.time-.25;p.state.gcdEnd=src.services.time+.75;p.state.lastSpend=src.services.time-3;p.state.lastAttack=src.services.time-4;u.stunUntil=src.services.time+2;u.absorb=22;u.absorbMax=35;u.absorbUntil=src.services.time+9;u.encounterBlessing=true;p.state.warded=true;p.state.target=[...src.enemies.values()][0].unit;p.state.velX=7;p.state.quests.tracked[1]='q1';ready(src,u);
 const before=captureTransfer(src.services,p,[]),result=c.transfer('hero',src,dst,'gate:w2',0);assert.equal(result.ok,true);assert.equal(src.services.playerByCharacter('hero'),null);assert.equal(src.services.getUnit(ref),null);
 const migrated=dst.services.playerByCharacter('hero'),v=dst.services.getUnit(result.ref);assert.ok(Math.abs(migrated.state.cooldowns['crown-burst'].end-dst.services.time-50)<1e-7);assert.ok(Math.abs(migrated.state.cooldowns['crown-burst'].start-dst.services.time+10)<1e-7);assert.equal(migrated.state.target,null);assert.equal(migrated.state.velX,0);assert.equal(v.encounterBlessing,false);assert.equal(v.absorb,22);assert.ok(Math.abs(v.absorbUntil-dst.services.time-9)<1e-7);assert.equal(migrated.state.quests.tracked[1],'q1');assert.equal(migrated.state.quests.chapter,2);assert.equal(c.characters.owner('hero').area,dst.services.id);
 before.flags.changed=true;assert.equal(migrated.state.flags.changed,undefined);assert.equal(src.enemies.size,1);assert.equal(dst.enemies.size,2);
});
test('reservation denial, staging failure and registry CAS conflict leave exact source state',()=>{
 const src=area('rollback-src'),dst=area('rollback-dst','w2'),c=new InMemoryTransferCoordinator(),{ref,p,u}=actor(src);ready(src,u);c.characters.compareAndSwap('hero',null,ref);
 const snapshot=()=>src.debugState();const before=snapshot();const reserve=dst.reserveAdmission.bind(dst);dst.reserveAdmission=()=>null;assert.deepEqual(c.transfer('hero',src,dst,'gate:w2',1),{ok:false,reason:'destination-full'});assert.deepEqual(snapshot(),before);dst.reserveAdmission=reserve;
 const stage=dst.stageArrival.bind(dst);dst.stageArrival=()=>{throw new Error('fixture-stage-failure');};assert.equal(c.transfer('hero',src,dst,'gate:w2',2).reason,'fixture-stage-failure');assert.deepEqual(snapshot(),before);dst.stageArrival=stage;
 const cas=c.characters.compareAndSwap.bind(c.characters);c.characters.compareAndSwap=()=>false;assert.equal(c.transfer('hero',src,dst,'gate:w2',3).reason,'registry-conflict');assert.deepEqual(snapshot(),before);c.characters.compareAndSwap=cas;
 assert.equal(p.state.character,'hero');assert.equal(dst.services.playerByCharacter('hero'),null);assert.equal(c.transfer('hero',src,dst,'gate:w2',4).ok,true);
});
test('transfer succeeds independently of retryable mailbox delivery',()=>{
 const src=area('delivery-src'),dst=area('delivery-dst','w2'),c=new InMemoryTransferCoordinator(),{ref,u}=actor(src);ready(src,u);c.characters.compareAndSwap('hero',null,ref);c.awards.record({id:'older-entitlement',victim:{area:'old',id:1,life:1},recipient:'hero',xp:20,coins:5,objectives:[],flags:[]},false);
 const receive=dst.receiveGrant.bind(dst);dst.receiveGrant=()=>{throw new Error('delivery-fault');};assert.equal(c.transfer('hero',src,dst,'gate:w2',1).ok,true);assert.throws(()=>c.deliver(dst,'hero'),/delivery-fault/);assert.equal(c.characters.owner('hero').area,'delivery-dst');assert.equal(c.awards.pending('hero').length,1);dst.receiveGrant=receive;c.deliver(dst,'hero');assert.equal(c.awards.pending('hero').length,0);assert.equal(dst.services.playerByCharacter('hero').state.xp,20);c.deliver(dst,'hero');assert.equal(dst.services.playerByCharacter('hero').state.xp,20);
});
