import test from 'node:test';
import assert from 'node:assert/strict';
import {worldArea} from './core/worldHarness.mjs';
import {InMemoryCharacterRegistry} from '../src/sim/transfer.ts';
import {prepareRestore} from '../src/sim/persistence.ts';
const area=(id,options={})=>worldArea(id,'w1',{ledgerMode:'external-durable',...options});
const actor=a=>{const ref=a.attachFresh('hero','mage','human','spawn',0);return {ref,p:a.services.player(ref),u:a.services.getUnit(ref)};};
const grant=(id,recipient='hero')=>({id:JSON.stringify(['earned',id,1,recipient]),victim:{area:'earned',id,life:1},recipient,xp:0,coins:1,objectives:[],flags:[]});
const restore=c=>prepareRestore(c,0,{version:'cancel-for-test',restore:c=>({...c,activity:{seated:false,village:false,controlsLocked:false,cast:null,channel:null,dash:false,pendingHit:false,rootPending:false,motion:{velocityX:0,velocityZ:0,jumpRemaining:0,spinRemaining:0,pushX:0,pushZ:0,pushRemaining:0,lift:0,dashElapsed:null}}})});

test('external replay requires explicit revision, barrier and single-use complete page certification',()=>{
 const a=area('proof');assert.throws(()=>a.attachFresh('hero','mage','human','spawn'),/revision/);assert.equal(a.players.size,0);const {ref,p}=actor(a);
 assert.throws(()=>a.receiveGrant(grant(1)),/certified/);assert.throws(()=>a.services.applyEarnedGrant(grant(1)),/certified/);assert.throws(()=>a.beginGrantRead(ref,0),/barrier/);
 const barrier=a.beginDurabilityBarrier('read');a.bindDurableLedger(ref,0);assert.throws(()=>a.bindDurableLedger(ref,1),/already bound/);
 const token=a.beginGrantRead(ref,0);assert.ok(Object.isFrozen(token.actor));assert.throws(()=>a.applyCertifiedGrants(token,{revision:1,grants:[grant(1)]}),/page/);assert.equal(p.state.coins,0);assert.throws(()=>a.applyCertifiedGrants(token,{revision:0,grants:[grant(1)]}),/Stale/);
 const bad=a.beginGrantRead(ref,0);assert.throws(()=>a.applyCertifiedGrants(bad,{revision:0,grants:[grant(1),{...grant(2),coins:NaN}]}));assert.equal(p.state.coins,0);assert.equal(a.resourceUsage().replayTokens,0);
 const good=a.beginGrantRead(ref,0);assert.deepEqual(a.applyCertifiedGrants(good,{revision:0,grants:[grant(1)]}),[{id:grant(1).id,result:'applied'}]);assert.equal(p.state.coins,1);
 const retry=a.beginGrantRead(ref,0);assert.deepEqual(a.applyCertifiedGrants(retry,{revision:0,grants:[grant(1)]}),[{id:grant(1).id,result:'duplicate'}]);assert.equal(p.state.coins,1);a.releaseDurabilityBarrier(barrier);
});

test('stale cancellation, owner/session changes and durable mark cannot authorize a later page',()=>{
 const a=area('stale'),{ref,p}=actor(a),barrier=a.beginDurabilityBarrier('read');const old=a.beginGrantRead(ref,0),next=a.beginGrantRead(ref,0);a.cancelGrantRead(old);assert.equal(a.resourceUsage().replayTokens,1);
 a.applyCertifiedGrants(next,{revision:0,grants:[grant(1)]});const c=a.capturePlayerCheckpoint(ref),late=a.beginGrantRead(ref,0);a.markCheckpointDurable(c.captureId,1,c.appliedGrantIds);assert.equal(a.resourceUsage().appliedGrantIds,0);assert.equal(a.resourceUsage().durableCharacters,0);
 assert.throws(()=>a.applyCertifiedGrants(late,{revision:0,grants:[grant(1)]}),/Stale/);assert.throws(()=>a.beginGrantRead(ref,0),/revision/);
 const session=a.beginGrantRead(ref,1);a.resetInputSession(ref);assert.throws(()=>a.applyCertifiedGrants(session,{revision:1,grants:[grant(2)]}),/Stale/);assert.equal(p.state.coins,1);
 const ownership=a.beginGrantRead(ref,1);a.invalidateGrantRead(ref);assert.throws(()=>a.applyCertifiedGrants(ownership,{revision:1,grants:[grant(2)]}),/Stale/);a.releaseDurabilityBarrier(barrier);
});

test('exact capture pruning keeps later uncommitted effects and invalidates overlapping older captures',()=>{
 const a=area('exact'),{ref,p}=actor(a);a.beginDurabilityBarrier('save');a.applyCertifiedGrants(a.beginGrantRead(ref,0),{revision:0,grants:[grant(1)]});const older=a.capturePlayerCheckpoint(ref),same=a.capturePlayerCheckpoint(ref);
 a.applyCertifiedGrants(a.beginGrantRead(ref,0),{revision:0,grants:[grant(2)]});assert.throws(()=>a.markCheckpointDurable(older.captureId,1,[grant(2).id]),/mismatch/);
 assert.throws(()=>a.markCheckpointDurable(older.captureId,0,older.appliedGrantIds),/advancing/);a.markCheckpointDurable(older.captureId,1,older.appliedGrantIds);assert.deepEqual(a.appliedGrantIds('hero'),[grant(2).id]);assert.throws(()=>a.markCheckpointDurable(same.captureId,2,same.appliedGrantIds),/Stale/);assert.equal(p.state.coins,2);
});

test('thousands of certified grants drain with bounded active receipts and no saved history in RAM',()=>{
 const a=area('long-run'),{ref,p}=actor(a);a.beginDurabilityBarrier('healthy-store');let revision=0;
 for(let start=1;start<=3000;start+=100){const page=Array.from({length:100},(_,i)=>grant(start+i));a.applyCertifiedGrants(a.beginGrantRead(ref,revision),{revision,grants:page});assert.equal(a.resourceUsage().appliedGrantIds,100);const c=a.capturePlayerCheckpoint(ref);a.markCheckpointDurable(c.captureId,++revision,c.appliedGrantIds);const usage=a.resourceUsage();assert.equal(usage.appliedGrantIds,0);assert.equal(usage.replayTokens,0);assert.equal(usage.captures,0);assert.equal(usage.durableCharacters,0);assert.equal(usage.ledgerOwners,1);}
 assert.equal(p.state.coins,3000);
});

test('page capacity and validation fail before first recipient effect and consume the proof',()=>{
 const a=area('capacity'),{ref,p}=actor(a);a.beginDurabilityBarrier('read');
 for(const [start,n]of [[1,100],[101,100],[201,56]])a.applyCertifiedGrants(a.beginGrantRead(ref,0),{revision:0,grants:Array.from({length:n},(_,i)=>grant(start+i))});
 assert.equal(p.state.coins,256);const full=a.beginGrantRead(ref,0);assert.throws(()=>a.applyCertifiedGrants(full,{revision:0,grants:[grant(1),grant(257)]}),/capacity/);assert.equal(p.state.coins,256);assert.equal(a.resourceUsage().replayTokens,0);
 for(const grants of [[grant(1),grant(1)],[grant(1,'other')],Array.from({length:101},(_,i)=>grant(i+1))]){const token=a.beginGrantRead(ref,0);assert.throws(()=>a.applyCertifiedGrants(token,{revision:0,grants}));assert.equal(a.resourceUsage().replayTokens,0);assert.equal(p.state.coins,256);}
});

test('recovery and fresh life invalidate proof and rebuild only revision-bound owner state',()=>{
 const registry=new InMemoryCharacterRegistry(),a=area('recovery',{characters:registry}),{ref,p}=actor(a),barrier=a.beginDurabilityBarrier('recover');a.applyCertifiedGrants(a.beginGrantRead(ref,0),{revision:0,grants:[grant(1)]});const c=a.capturePlayerCheckpoint(ref),old=a.beginGrantRead(ref,0);
 assert.throws(()=>a.restorePlayerCheckpoint(ref,c.checkpoint,restore(c.checkpoint),c.appliedGrantIds),/revision/);assert.equal(a.services.player(ref),p);
 const next=a.restorePlayerCheckpoint(ref,c.checkpoint,restore(c.checkpoint),c.appliedGrantIds,1);assert.deepEqual(a.appliedGrantIds('hero'),[]);assert.throws(()=>a.applyCertifiedGrants(old,{revision:0,grants:[grant(1)]}),/Stale/);
 const proof=a.beginGrantRead(next,1),life=a.services.respawnUnit(next);assert.throws(()=>a.applyCertifiedGrants(proof,{revision:1,grants:[grant(2)]}),/Stale/);assert.equal(a.beginGrantRead(life,1).actor.life,life.life);a.releaseDurabilityBarrier(barrier);
});

test('external transfer carries revision without old receipts and rejects retained-mode destinations',()=>{
 const registry=new InMemoryCharacterRegistry(),a=area('source',{characters:registry}),b=area('dest',{characters:registry}),{ref}=actor(a),barrier=a.beginDurabilityBarrier('save');a.applyCertifiedGrants(a.beginGrantRead(ref,0),{revision:0,grants:[grant(1)]});a.releaseDurabilityBarrier(barrier);assert.throws(()=>a.stageDeparture(ref),/durable/);
 const save=a.beginDurabilityBarrier('save2'),c=a.capturePlayerCheckpoint(ref);a.markCheckpointDurable(c.captureId,1,c.appliedGrantIds);a.releaseDurabilityBarrier(save);const d=a.stageDeparture(ref),ad=b.reserveAdmission('hero','spawn',0),staged=b.stageArrival(ad,d.dto);assert.deepEqual(d.dto.appliedGrantIds,[]);assert.deepEqual(d.dto.ledger,{mode:'external-durable',revision:1});
 const retained=worldArea('retained'),bad=retained.reserveAdmission('hero','spawn',0);assert.throws(()=>retained.stageArrival(bad,d.dto),/mode/);
 assert.equal(registry.compareAndSwap('hero',ref,staged.newRef),true);a.commitDeparture(d.token);const next=b.activateArrival(staged.token);assert.equal(a.resourceUsage().ledgerOwners,0);b.beginDurabilityBarrier('read');assert.equal(b.beginGrantRead(next,1).durableRevision,1);assert.equal(b.services.player(next).state.coins,1);assert.equal(b.resourceUsage().appliedGrantIds,0);
});

test('staged restore requires explicit revision and remains inactive until activation',()=>{
 const source=worldArea('saved');const old=source.attachFresh('hero','mage','human','spawn'),checkpoint=source.capturePlayerCheckpoint(old).checkpoint,dest=area('restore'),ad=dest.reserveAdmission('hero','spawn',0);
 assert.throws(()=>dest.stageRestoredArrival(ad,checkpoint,restore(checkpoint)),/revision/);assert.equal(dest.players.size,0);const staged=dest.stageRestoredArrival(ad,checkpoint,restore(checkpoint),{revision:19});assert.equal(dest.resourceUsage().ledgerOwners,0);const ref=dest.activateRestoredArrival(staged.token);dest.beginDurabilityBarrier('read');assert.equal(dest.beginGrantRead(ref,19).durableRevision,19);
});

test('durable retirement releases owner metadata and session changes invalidate a saved retirement proof',()=>{
 const registry=new InMemoryCharacterRegistry(),a=area('retire',{characters:registry}),{ref}=actor(a),q=a.quiescePlayer(ref,'disconnect');a.markCheckpointDurable(q.capture.captureId,1,[]);a.resetInputSession(ref);assert.throws(()=>a.commitPlayerRetirement(q.token),/Stale retirement/);assert.deepEqual(registry.owner('hero'),ref);a.abortPlayerRetirement(q.token);
 const next=a.quiescePlayer(ref,'disconnect-retry');a.markCheckpointDurable(next.capture.captureId,2,[]);a.commitPlayerRetirement(next.token);assert.equal(registry.owner('hero'),null);assert.equal(a.resourceUsage().ledgerOwners,0);assert.equal(a.resourceUsage().replayTokens,0);assert.equal(a.resourceUsage().retirements,0);
});

test('registry ownership loss rejects a previously valid proof before any reward mutation',()=>{
 const registry=new InMemoryCharacterRegistry(),a=area('owner',{characters:registry}),{ref,p}=actor(a);a.beginDurabilityBarrier('read');const token=a.beginGrantRead(ref,0);registry.compareAndSwap('hero',ref,{area:'destination',id:1,life:1});assert.throws(()=>a.applyCertifiedGrants(token,{revision:0,grants:[grant(1)]}),/registry/);assert.equal(p.state.coins,0);assert.equal(a.resourceUsage().replayTokens,0);
});

test('reserved Mulberry block preserves sequential rolls and same-stack subsequent RNG exactly',async()=>{
 const {Random,advanceRandomState}=await import('../src/sim/random.ts');for(const seed of [0,1,0xffffffff])for(const count of [0,1,7,1000]){const actual=new Random(seed),oracle=new Random(seed);for(let i=0;i<count;i++)oracle.next();actual.reserve(seed,count,advanceRandomState(seed,count));assert.equal(actual.state(),oracle.state());assert.equal(actual.next(),oracle.next());}
 const big=new Random(123);assert.equal(advanceRandomState(123,2**32),123);assert.equal(advanceRandomState(123,Number.MAX_SAFE_INTEGER),(123-0x6d2b79f5)>>>0);big.reserve(123,Number.MAX_SAFE_INTEGER,advanceRandomState(123,Number.MAX_SAFE_INTEGER));
 const state=big.state();assert.throws(()=>big.reserve(state,Number.MAX_SAFE_INTEGER+1,state));assert.throws(()=>big.reserve(state,1,state));assert.throws(()=>big.reserve(0,1,advanceRandomState(0,1)));assert.equal(big.state(),state);
 const a=area('reserve'),start=a.debugState().rng.state;a.services.reserveOutcomeRandom(start,2**32,start);assert.equal(a.debugState().rng.state,start);assert.throws(()=>worldArea('retained-rng').services.reserveOutcomeRandom(0,0,0),/External/);
});

test('a real event-capacity fault retains only the applied prefix and requires fresh certification',()=>{
 const a=area('partial',{limits:{eventCount:1,inputCommandsPerTick:32,timers:1000,projectiles:1000}}),{ref,p}=actor(a);a.beginDurabilityBarrier('apply');const grants=[{...grant(1),xp:1},{...grant(2),xp:1}],proof=a.beginGrantRead(ref,0);
 assert.throws(()=>a.applyCertifiedGrants(proof,{revision:0,grants}),/capacity/);assert.equal(p.state.xp,1);assert.equal(p.state.coins,1);assert.deepEqual(a.appliedGrantIds('hero'),[grant(1).id]);assert.equal(a.resourceUsage().replayTokens,0);assert.throws(()=>a.applyCertifiedGrants(proof,{revision:0,grants}),/Stale/);
 a.drainEvents();assert.deepEqual(a.applyCertifiedGrants(a.beginGrantRead(ref,0),{revision:0,grants}),[{id:grant(1).id,result:'duplicate'},{id:grant(2).id,result:'applied'}]);assert.equal(p.state.xp,2);assert.equal(p.state.coins,2);
});
