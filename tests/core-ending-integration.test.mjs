import test from 'node:test';import assert from 'node:assert/strict';
import {worldArea,addActor,tick,intent} from './core/worldHarness.mjs';
import {createPublicDefinition} from '../src/sim/areas/variants.ts';
import {createEndingStage} from '../src/sim/features/worldRules.ts';
import {validCommand} from '../src/sim/input.ts';
import {actionRequest,realActionData} from '../src/sim/data/actions.ts';
import {createConfiguredRestorePolicy} from '../server/world/startup.ts';
import {prepareRestore} from '../src/sim/persistence.ts';
const appearance={race:'human',sex:'female',classId:'mage',shell:0,crest:0,led:0,name:'Earned gate fixture'};
const shore=worldArea('ending-shore').services.definition,final=worldArea('ending-final-template','w4').services.definition,stage=createEndingStage(shore,final);
function fixture(id,extra={}){const area=worldArea(id,'w4',{definition:createPublicDefinition(final),endingPresentation:{incarnation:id,stage,appearance:()=>appearance},...extra});const a=addActor(area,'a'),b=addActor(area,'b');return {area,a,b};}
function grantGate(a){a.p.state.flags.frostCleared=true;} // Explicit eligibility unit fixture, NOT earned gameplay E2E.
let revision=0;
function durable(area,ref){const c=area.capturePlayerCheckpoint(ref);area.markCheckpointDurable(c.captureId,++revision,c.appliedGrantIds);return c;}
function start(f){grantGate(f.a);tick(f.area);assert(f.area.hasPendingEndingTransitions());assert.equal(f.area.endingObservation(f.a.ref),null);durable(f.area,f.a.ref);return f.area.endingObservation(f.a.ref);}
test('earned chapter gate stays canonical, opt-in default and bounded configuration are explicit',()=>{
 const {area,a,b}=fixture('gate');tick(area);assert.equal(area.hasPendingEndingTransitions(),false);assert.equal(area.services.runCommand(a.ref,{kind:'endingReplay'}),false);grantGate(a);tick(area);assert.equal(area.endingObservation(b.ref),null);assert.equal(b.p.state.flags.frostEndingStarted,undefined);assert.equal(a.p.state.flags.firstEndingSeen,undefined);
 const disabled=worldArea('disabled','w4',{definition:createPublicDefinition(final)}),p=addActor(disabled);grantGate(p);tick(disabled);assert.equal(disabled.hasPendingEndingTransitions(),false);assert.equal(disabled.endingObservation(p.ref),null);
 assert.throws(()=>fixture('bad',{endingPresentation:{incarnation:'x'.repeat(128),stage,appearance:()=>appearance}}),/configuration/);
 assert.equal(validCommand({kind:'endingControl',id:'a',action:'skip'}),true);assert.equal(validCommand({kind:'endingControl',id:'a',action:'skip',target:a.ref}),false);
});
test('exact capture gates start, stale capture cannot acknowledge a newer terminal, snapshot never steps',()=>{
 const f=fixture('capture'),{area,a}=f,old=area.capturePlayerCheckpoint(a.ref);grantGate(a);tick(area);area.markCheckpointDurable(old.captureId,++revision,old.appliedGrantIds);assert.equal(area.endingObservation(a.ref),null);assert(area.hasPendingEndingTransitions());
 const pending=area.capturePlayerCheckpoint(a.ref);area.services.combat.damage([...area.units.values()].find(u=>u.kind==='scrapling').ref,a.ref,3);tick(area);assert.equal(a.p.state.controlsLocked,false);area.markCheckpointDurable(pending.captureId,++revision,pending.appliedGrantIds);assert(area.hasPendingEndingTransitions());assert.equal(area.endingObservation(a.ref),null);
 durable(area,a.ref);const terminal=area.endingObservation(a.ref);assert.equal(terminal.phase,'cancelled');assert.equal(terminal.reason,'damage');assert.equal(terminal.cast.length,0);for(let i=0;i<3;i++){area.snapshot();area.drainEvents();assert.deepEqual(area.endingObservation(a.ref),terminal);}
});
test('personal controls block ordered attacks/targets but other resident movement/combat and actual townsfolk continue',()=>{
 const f=fixture('independent'),{area,a,b}=f,startView=start(f),xp=a.p.state.xp,coins=a.p.state.coins;
 const people=[...area.units.values()].filter(u=>u.kind==='townsfolk'),before=people.map(u=>[u.x,u.z]),b0={x:b.u.x,z:b.u.z};
 const outcomes=area.step(new Map([[a.ref.id,intent(1,[{kind:'target',target:b.ref},{kind:'ability',slot:1},{kind:'endingControl',id:'stale',action:'skip'}],{forward:1})],[b.ref.id,intent(1,[],{forward:1})]]));
 assert.deepEqual(outcomes.filter(o=>o.unit.id===a.ref.id).map(o=>[o.commandIndex,o.success]),[[0,false],[1,false],[2,false]]);assert.equal(a.p.state.target,null);assert.equal(a.p.state.cast,null);assert.equal(a.u.invulnerable,false);
 tick(area,180);assert(Math.hypot(b.u.x-b0.x,b.u.z-b0.z)>1);assert(people.some((u,i)=>Math.hypot(u.x-before[i][0],u.z-before[i][1])>.05));assert.equal(a.p.state.xp,xp);assert.equal(a.p.state.coins,coins);
 const enemy=[...area.units.values()].find(u=>u.kind==='scrapling'),hp=enemy.hp;area.services.combat.damage(b.ref,enemy.ref,4);assert(enemy.hp<hp);assert.equal(area.endingObservation(a.ref).id,startView.id);
});
test('real pending-hit damage and death cancel in the same step after hit resolution without invulnerability',()=>{
 for(const lethal of [false,true]){const f=fixture(`hit-${lethal}`),{area,a}=f;start(f);const enemy=[...area.units.values()].find(u=>u.kind==='scrapling');enemy.x=a.u.x+1;enemy.y=a.u.y;enemy.z=a.u.z;if(lethal)a.u.hp=1;
  area.services.startAction(enemy.ref,actionRequest(realActionData,'attack_swipe'),{left:1/30,plan:{attack:'enemy-claw',source:enemy.ref,target:a.ref}});const hp=a.u.hp;tick(area);assert(a.u.hp<hp);assert.equal(a.p.state.controlsLocked,false);assert(area.hasPendingEndingTransitions());assert.equal(area.endingObservation(a.ref),null);durable(area,a.ref);const state=area.endingObservation(a.ref);assert.equal(state.phase,'cancelled');assert.equal(state.reason,lethal?'death':'damage');assert.equal(a.u.invulnerable,false);
 }
});
test('skip/continue remain ordered, original command indexes survive, and each boundary needs exact capture',()=>{
 const f=fixture('commands'),{area,a}=f,s=start(f);tick(area,152);assert.equal(area.services.runCommand(a.ref,{kind:'endingControl',id:s.id,action:'skip'}),false);tick(area);const results=area.step(new Map([[a.ref.id,intent(1,[{kind:'endingControl',id:s.id,action:'skip'}])]]));assert.equal(results[0].success,true);assert.equal(results[0].commandIndex,0);assert(area.hasPendingEndingTransitions());assert.equal(area.endingObservation(a.ref),null);durable(area,a.ref);assert.equal(area.endingObservation(a.ref).phase,'credits');assert.equal(a.p.state.controlsLocked,false);assert.equal(area.services.runCommand(a.ref,{kind:'endingReplay'}),false);
 area.step(new Map([[a.ref.id,intent(2,[{kind:'endingControl',id:s.id,action:'continue'}])]]));assert.equal(a.p.state.controlsLocked,false);assert.equal(area.endingObservation(a.ref),null);durable(area,a.ref);assert.equal(area.endingObservation(a.ref).phase,'finished');assert.equal(area.services.runCommand(a.ref,{kind:'endingReplay'}),true);tick(area);durable(area,a.ref);assert.notEqual(area.endingObservation(a.ref).id,s.id);assert.equal(a.p.state.xp,0);assert.equal(a.p.state.coins,0);
});
test('retirement capture cancels before capture, restore cancels activity, manual replay gets a new lifetime/incarnation',()=>{
 const f=fixture('retire'),{area,a}=f,first=start(f),retirement=area.quiescePlayer(a.ref,'test-retire');assert.equal(retirement.capture.checkpoint.activity.controlsLocked,false);assert.equal(area.endingObservation(a.ref),null);area.markCheckpointDurable(retirement.capture.captureId,++revision,retirement.capture.appliedGrantIds);assert.equal(area.endingObservation(a.ref).phase,'cancelled');area.commitPlayerRetirement(retirement.token);assert.equal(area.endingObservation(a.ref),null);
 const policy=createConfiguredRestorePolicy({cooldowns:'pause',statuses:'pause',death:'pause',history:'pause',hp:'preserve',resource:'preserve',location:'saved',activity:'cancel'},new Map());const saved=retirement.capture.checkpoint,restored=prepareRestore(saved,50,policy);const admission=area.reserveAdmission(saved.character,'spawn',0),arrival=area.stageRestoredArrival(admission,saved,restored),ref=area.activateRestoredArrival(arrival.token);assert.notDeepEqual(ref,a.ref);tick(area);assert.equal(area.hasPendingEndingTransitions(),false);assert.equal(area.endingObservation(ref),null);assert.equal(area.services.runCommand(ref,{kind:'endingReplay'}),true);tick(area);durable(area,ref);assert.notEqual(area.endingObservation(ref).id,first.id);
});
test('missing trusted appearance and existing combat retain bounded admission after the one-shot ready flag',()=>{
 let ready=false;const f=fixture('delayed',{endingPresentation:{incarnation:'delayed',stage,appearance:()=>ready?appearance:null}}),{area,a}=f;grantGate(a);tick(area,2);assert.equal(a.p.state.flags.frostEndingStarted,true);assert.equal(a.p.state.controlsLocked,false);assert.equal(area.hasPendingEndingTransitions(),false);assert.equal(area.debugState().features.ending.requests.length,1);
 durable(area,a.ref);a.u.lastCombat=area.services.time;ready=true;tick(area,100);assert.equal(area.hasPendingEndingTransitions(),false);assert.equal(area.debugState().features.ending.requests.length,1);tick(area,51);assert(area.hasPendingEndingTransitions());durable(area,a.ref);assert.equal(area.endingObservation(a.ref).cast[0].appearance.name,appearance.name);
});
test('transfer staging cancels before DTO, abort preserves safe cancelled state, commit discards only old-life presentation',()=>{
 const f=fixture('transfer'),{area,a}=f;start(f);const first=area.stageDeparture(a.ref);assert.equal(first.dto.flags.frostCleared,true);assert.equal(a.p.state.controlsLocked,false);assert(area.hasPendingEndingTransitions());area.abortDeparture(first.token);assert.equal(area.endingObservation(a.ref),null);durable(area,a.ref);assert.equal(area.endingObservation(a.ref).reason,'transferred');
 assert.equal(area.services.runCommand(a.ref,{kind:'endingReplay'}),true);tick(area);durable(area,a.ref);const empty=worldArea('transfer-empty','w4',{definition:createPublicDefinition(final),endingPresentation:{incarnation:'transfer-empty',stage,appearance:()=>appearance}}),reserved=empty.reserveAdmission('a','spawn',0),departure=area.stageDeparture(a.ref),arrival=empty.stageArrival(reserved,departure.dto);area.commitDeparture(departure.token);const next=empty.activateArrival(arrival.token);
 assert.equal(area.endingObservation(a.ref),null);assert.equal(area.hasPendingEndingTransitions(),false);assert.equal(empty.services.player(next).state.controlsLocked,false);tick(empty);assert.equal(empty.endingObservation(next),null);assert.equal(empty.services.player(next).state.flags.frostCleared,true);
});
test('old-life capture ACK cannot activate a respawned replay and a fully absorbed hit still cancels combat activity',()=>{
 const f=fixture('life'),{area,a}=f;grantGate(a);tick(area);const old=area.capturePlayerCheckpoint(a.ref);a.p.respawn();const next={...a.p.state.unit};assert.notEqual(next.life,a.ref.life);assert.equal(area.endingObservation(a.ref),null);assert.equal(area.services.runCommand(next,{kind:'endingReplay'}),true);tick(area);area.markCheckpointDurable(old.captureId,++revision,old.appliedGrantIds);assert.equal(area.endingObservation(next),null);assert(area.hasPendingEndingTransitions());durable(area,next);
 const hp=a.u.hp;a.u.absorb=a.u.absorbMax=100;a.u.absorbUntil=area.services.time+10;const enemy=[...area.units.values()].find(u=>u.kind==='scrapling');assert.equal(area.services.combat.damage(enemy.ref,next,3),0);assert.equal(a.u.hp,hp);tick(area);assert.equal(a.p.state.controlsLocked,false);durable(area,next);assert.equal(area.endingObservation(next).reason,'combat');
});
