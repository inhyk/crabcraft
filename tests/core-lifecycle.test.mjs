import test from 'node:test';
import assert from 'node:assert/strict';
import {worldArea,addActor,intent} from './core/worldHarness.mjs';
import {InMemoryCharacterRegistry} from '../src/sim/transfer.ts';
import {prepareRestore} from '../src/sim/persistence.ts';
const restore=(c)=>prepareRestore(c,0,{version:'test-explicit-pause-and-cancel',restore:c=>({...c,activity:{seated:false,village:false,controlsLocked:false,cast:null,channel:null,dash:false,pendingHit:false,rootPending:false}})});

test('durability barrier freezes complete Area and input neutralization never manufactures an ack',()=>{
 const a=worldArea('barrier'),{u,p}=addActor(a);a.step(new Map([[u.ref.id,intent(42,[],{forward:1})]]));
 const token=a.beginDurabilityBarrier('save'),before=a.snapshot();assert.throws(()=>a.step(new Map()),/barrier/);assert.deepEqual(a.snapshot(),before);
 a.neutralizeInput(u.ref);assert.equal(p.lastConsumedSeq,42);assert.equal(p.heldIntent.forward,0);
 assert.throws(()=>a.attachFresh('other','mage','human','spawn'),/barrier/);
 a.resetInputSession(u.ref);assert.equal(p.lastConsumedSeq,0);a.releaseDurabilityBarrier(token);a.step(new Map([[u.ref.id,intent(1)]]));assert.equal(p.lastConsumedSeq,1);
});

test('capture handles dead actor with remaining death/status clocks and copies progression without events or RNG',()=>{
 const a=worldArea('dead-save'),{u,p}=addActor(a);p.state.achievements={earned:['island'],distance:12.5};p.state.lighthouseSecretFound=true;
 a.services.combat.kill(u.ref,null);u.slowUntil=a.services.time+12;u.slowPct=.4;
 const rng=a.debugState().rng,events=a.drainEvents(),c=a.capturePlayerCheckpoint(u.ref);
 assert.equal(c.checkpoint.survival.alive,false);assert.equal(c.checkpoint.survival.respawnRemaining,3.6);assert.equal(c.checkpoint.survival.statuses.slowRemaining,12);
 assert.deepEqual(c.checkpoint.progress.achievements,{earned:['island'],distance:12.5});assert.equal(c.checkpoint.progress.lighthouseSecretFound,true);
 assert.deepEqual(a.debugState().rng,rng);assert.deepEqual(a.drainEvents(),[]);assert.ok(events.length);assert.ok(Object.isFrozen(c.checkpoint.progress));
});

test('staged restoration stays invisible until registry CAS and carries exact death/status/resource state',()=>{
 const registry=new InMemoryCharacterRegistry(),source=worldArea('source','w1',{characters:registry}),dest=worldArea('dest','w1',{characters:registry});const {u,p}=addActor(source);
 p.state.resource=17;source.services.combat.kill(u.ref,null);u.absorb=4;u.absorbMax=20;u.absorbUntil=7;
 const c=source.capturePlayerCheckpoint(u.ref).checkpoint,reservation=dest.reserveAdmission('hero','spawn',0),staged=dest.stageRestoredArrival(reservation,c,restore(c));
 assert.equal(dest.players.size,0);assert.equal(dest.services.getUnit(staged.newRef),null);assert.deepEqual(registry.owner('hero'),u.ref);
 assert.equal(registry.compareAndSwap('hero',u.ref,staged.newRef),true);const ref=dest.activateRestoredArrival(staged.token),unit=dest.services.getUnit(ref),player=dest.services.player(ref);
 assert.equal(unit.alive,false);assert.equal(unit.absorb,4);assert.equal(player.state.resource,17);assert.equal(player.state.deadUntil,3.6);assert.equal(dest.players.size,1);
});

test('retirement keeps registry and actor until exact captured checkpoint is durable and commits once',()=>{
 const registry=new InMemoryCharacterRegistry(),a=worldArea('retire','w1',{characters:registry}),{u}=addActor(a);
 const q=a.quiescePlayer(u.ref,'disconnect');assert.deepEqual(a.quiescePlayer(u.ref,'disconnect'),q);assert.equal(a.players.size,1);assert.deepEqual(registry.owner('hero'),u.ref);
 assert.throws(()=>a.commitPlayerRetirement(q.token),/not durable/);assert.throws(()=>a.markCheckpointDurable(q.capture.captureId,1,['fake']),/receipt/);
 a.markCheckpointDurable(q.capture.captureId,1,[]);a.commitPlayerRetirement(q.token);a.commitPlayerRetirement(q.token);assert.equal(a.players.size,0);assert.equal(registry.owner('hero'),null);a.step(new Map());
});

test('durable mark only consumes captured grant IDs and recovery replaces stale life after registry CAS',()=>{
 const registry=new InMemoryCharacterRegistry(),a=worldArea('recover','w1',{characters:registry}),{u,p}=addActor(a);
 const grant=(id)=>({id:JSON.stringify(['origin',id,1,'hero']),victim:{area:'origin',id,life:1},recipient:'hero',xp:10,coins:3,objectives:[],flags:[]});
 a.receiveGrant(grant(1));const c=a.capturePlayerCheckpoint(u.ref);a.receiveGrant(grant(2));a.markCheckpointDurable(c.captureId,1,c.appliedGrantIds);assert.deepEqual(a.appliedGrantIds('hero'),[grant(2).id]);
 const barrier=a.beginDurabilityBarrier('recover');const before=u.ref;const next=a.restorePlayerCheckpoint(before,c.checkpoint,restore(c.checkpoint),c.appliedGrantIds);
 assert.notEqual(next.id,before.id);assert.equal(a.services.getUnit(before),null);assert.deepEqual(registry.owner('hero'),next);assert.equal(a.services.player(next).state.xp,10);assert.equal(p.state.xp,20);
 assert.deepEqual(a.appliedGrantIds('hero'),[]);assert.equal(a.receiveGrant(grant(2)),'applied');assert.equal(a.services.player(next).state.xp,20);a.releaseDurabilityBarrier(barrier);
});

test('failed recovery CAS preserves actor, progression, events and ownership',()=>{
 const registry=new InMemoryCharacterRegistry(),a=worldArea('conflict','w1',{characters:registry}),{u,p}=addActor(a);const c=a.capturePlayerCheckpoint(u.ref).checkpoint;
 a.drainEvents();const token=a.beginDurabilityBarrier('conflict');const saved=registry.compareAndSwap.bind(registry);registry.compareAndSwap=()=>false;
 assert.throws(()=>a.restorePlayerCheckpoint(u.ref,c,restore(c)),/registry/);assert.equal(a.services.player(u.ref),p);assert.equal(a.players.size,1);assert.deepEqual(a.drainEvents(),[]);assert.deepEqual(registry.owner('hero'),u.ref);
 registry.compareAndSwap=saved;a.releaseDurabilityBarrier(token);
});
