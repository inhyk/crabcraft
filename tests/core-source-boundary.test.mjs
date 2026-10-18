import test from 'node:test';
import assert from 'node:assert/strict';
import {worldArea,intent} from './core/worldHarness.mjs';
import {InMemoryCharacterRegistry} from '../src/sim/transfer.ts';
const hero='00000000-0000-4000-8000-000000000001';
const limits={maxDirtyCreditEntries:100000,maxDirtyCreditBytes:64000000,maxPendingDeaths:256,maxStagedBytes:64000000};
function fixture(id,extra={}){const template=worldArea(`${id}:template`),definition={...template.services.definition,npcs:[],townsfolk:[],bosses:[],enemies:[template.services.definition.enemies[0]]},area=worldArea(id,'w1',{definition,ledgerMode:'external-durable',ledgerLimits:limits,...extra}),ref=area.attachFresh(hero,'mage','human','spawn',0),unit=area.services.getUnit(ref),player=area.services.player(ref),enemy=[...area.enemies.values()][0],victim=area.services.getUnit(enemy.unit);Object.assign(unit,{x:victim.x,y:victim.y,z:victim.z});victim.stunUntil=100;player.state.nextSwing=100;return{area,ref,unit,player,enemy,victim};}
const seal=(capture,cursor)=>({format:'paged-v1',key:JSON.stringify([capture.victim.area,capture.victim.id,capture.victim.life]),victim:capture.victim,codecVersion:1,recipientCount:cursor.recipientCount,digestScheme:'sha256-chain-v1',contentDigest:'a'.repeat(64),recipeDigest:'b'.repeat(64),finalCursor:cursor});

test('real Area stages death, blocks the next input until spill/seal, and resumes after exact durable capture',()=>{
 const registry=new InMemoryCharacterRegistry(),{area:a,ref,player:p,victim}=fixture('source',{characters:registry});victim.hp=1;assert.deepEqual(a.prepareLedgerStep(),{ready:true});a.step(new Map([[ref.id,intent(1,[{kind:'ability',slot:5}])]]));assert.equal(victim.alive,false);assert.equal(p.state.coins,5);assert.equal(p.state.xp,20);assert.deepEqual(a.pendingGrants(),[]);assert.equal(a.pendingDeathRecipes(1).length,1);
 const before=a.snapshot();assert.deepEqual(a.prepareLedgerStep(),{ready:false,reason:'flush-required'});assert.throws(()=>a.step(new Map([[ref.id,intent(2,[{kind:'jump'}])]])),/IO required/);assert.equal(p.lastConsumedSeq,1);assert.deepEqual(a.snapshot(),before);
 assert.throws(()=>a.dispose(),/Undrained/);assert.deepEqual(registry.owner(hero),ref);
 const barrier=a.beginDurabilityBarrier('source-store'),batch=a.captureDirtyCredits(100);assert.equal(batch.writes.length,1);a.markCreditsDurable(batch.token);assert.deepEqual(a.prepareLedgerStep(),{ready:false,reason:'outcomes-pending'});
 const [capture]=a.pendingDeathRecipes(1),credits=batch.writes.map(w=>w.credit),page=a.planStagedOutcomePage(capture,credits);a.acceptStagedOutcomePage(capture,page,credits);a.retireJournaledOutcome(capture,seal(capture,page.nextCursor));assert.equal(a.resourceUsage().pendingDeaths,0);
 const checkpoint=a.capturePlayerCheckpoint(ref);a.markCheckpointDurable(checkpoint.captureId,1,checkpoint.appliedGrantIds);a.releaseDurabilityBarrier(barrier);assert.deepEqual(a.prepareLedgerStep(),{ready:true});a.step(new Map([[ref.id,intent(2)]]));assert.equal(p.lastConsumedSeq,2);assert.equal(p.state.coins,5);assert.equal(a.resourceUsage().dirtyCreditEntries,0);assert.equal(a.resourceUsage().appliedGrantIds,0);
});

test('summary IO is fenced to full resident refs and exact requested victim set',()=>{
 const{area:a,ref,player:p,victim}=fixture('summary');victim.hp=victim.maxHp=1000;a.step(new Map([[ref.id,intent(1,[{kind:'ability',slot:5}])]]));assert.equal(victim.alive,true);const barrier=a.beginDurabilityBarrier('spill'),batch=a.captureDirtyCredits(100);a.markCreditsDurable(batch.token);assert.deepEqual(a.prepareLedgerStep(),{ready:false,reason:'summary-required'});
 const old=a.beginContributionSummaryRead(100),credit=batch.writes[0].credit,summary={victim:victim.ref,sourceVersion:1,throughVersion:batch.writes[0].version,state:'open',totalContributors:1,storedEligibleTotal:Number(credit.cogEligible),residents:[{character:hero,priorCredit:credit,eligibleBefore:0}]};const next=a.services.respawnUnit(ref);assert.throws(()=>a.installContributionSummaries(old,[summary]),/roster/);assert.equal(a.resourceUsage().summaryReads,0);const fresh=a.beginContributionSummaryRead(100);a.cancelContributionSummaryRead(old);assert.equal(a.resourceUsage().summaryReads,1);a.installContributionSummaries(fresh,[summary]);assert.deepEqual(a.prepareLedgerStep(),{ready:true});assert.equal(p.state.unit.life,next.life);a.releaseDurabilityBarrier(barrier);
});

test('unsupported atomic capacity rejects before clock, input acknowledgment or gameplay mutation',()=>{
 const{area:a,ref,player:p}=fixture('small',{ledgerLimits:{...limits,maxPendingDeaths:2}}),before=a.snapshot();a.timers.schedule(0,{kind:'echoSpawn',spawnId:a.services.definition.enemies[0].id});assert.throws(()=>a.step(new Map([[ref.id,intent(1,[{kind:'ability',slot:5}])]])),/unsupported-step-capacity/);assert.deepEqual(a.snapshot(),before);assert.equal(p.lastConsumedSeq,-1);assert.deepEqual(a.pendingDeathRecipes(1),[]);
});

test('event overflow at a real pending hit retains the complete death recipe and drains a failed Area',()=>{
 const registry=new InMemoryCharacterRegistry(),{area:a,ref,unit,player:p,victim}=fixture('event-fault',{characters:registry,limits:{eventCount:1,inputCommandsPerTick:32,timers:100,projectiles:100}});victim.hp=1;unit.pendingHit={left:0,plan:{attack:'warrior-auto',source:ref,target:victim.ref}};
 assert.throws(()=>a.step(new Map()),/capacity/);assert.equal(victim.alive,false);assert.equal(p.state.xp,20);assert.equal(p.state.coins,5);assert.equal(a.pendingDeathRecipes(1).length,1);assert.throws(()=>a.step(new Map()),/failed/);assert.deepEqual(a.drainEvents().map(e=>e.event.type),['aggro']);
 const batch=a.captureDirtyCredits(100),[capture]=a.pendingDeathRecipes(1);assert.equal(batch.writes.length,1);a.markCreditsDurable(batch.token);const credits=batch.writes.map(w=>w.credit),page=a.planStagedOutcomePage(capture,credits);a.acceptStagedOutcomePage(capture,page,credits);a.retireJournaledOutcome(capture,seal(capture,page.nextCursor));assert.equal(a.resourceUsage().pendingDeaths,0);a.dispose();assert.equal(registry.owner(hero),null);
});


test('constructor rejects limits that cannot hold the configured maximum roster before admission',()=>{
 const registry=new InMemoryCharacterRegistry();assert.throws(()=>fixture('startup-small',{characters:registry,ledgerLimits:{...limits,maxDirtyCreditEntries:199}}),/unsupported-step-capacity/);assert.equal(registry.owner(hero),null);assert.throws(()=>fixture('startup-bytes',{ledgerLimits:{...limits,maxStagedBytes:100}}),/unsupported-step-capacity/);const {area:party}=fixture('party-fit',{context:{mode:'party-encounter',pvp:'disabled',members:[]},ledgerLimits:{...limits,maxDirtyCreditEntries:16}});const before=party.snapshot();assert.throws(()=>party.applyContext({...party.services.context,mode:'public'}),/unsupported-step-capacity/);assert.deepEqual(party.snapshot(),before);
});
