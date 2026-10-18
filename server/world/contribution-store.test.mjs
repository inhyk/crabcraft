import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { startPostgres } from '../node/local-postgres.mjs';
import { migrate } from '../node/db.ts';
import { CharacterStore, CharacterStoreError } from './character-store.ts';
import { DurableOutcomeStore, DurableLedgerError } from './contribution-store.ts';
import { createWorld1Definition } from '../../src/sim/areas/world1.ts';
import { worldArea, flatWorld, addActor } from '../../tests/core/worldHarness.mjs';
import { createCoreCharacterCodec, prepareRestore } from '../../src/sim/persistence.ts';
import { planOutcomePage, initialPlannerCursor, victimKey } from '../../src/sim/ledger.ts';

const identity = { schema:'world-identity-v1',classId:'warrior',archetype:'human',appearance:{race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'LedgerFixture'} };
const codec = createCoreCharacterCodec({identities:[{classId:'warrior',archetype:'human'}],freshLocation:{x:0,y:0,z:0,yaw:0}});
const options = {planOutcomePage};
const error = code => e => e instanceof DurableLedgerError && e.code === code;
let cluster,pool,store,ledger,characters;
before(async () => {
  try {
    cluster=await startPostgres();pool=new pg.Pool({connectionString:cluster.url});await migrate(pool);store=new CharacterStore(pool,codec);ledger=new DurableOutcomeStore(pool,codec,options);
    characters=[];
    for(let i=1;i<=257;i++) {
      const accountId='g'+i.toString(16).padStart(23,'0');await pool.query("INSERT INTO accounts(username,save,revision,updated,created) VALUES($1,'{\"legacy\":true}',7,1,1)",[accountId]);characters.push(await store.create(accountId,identity));
    }
    characters.sort((a,b)=>a.characterId<b.characterId?-1:1);
  } catch(e) {await pool?.end();cluster?.stop();throw e;}
});
after(async()=>{try{await pool?.end();}finally{cluster?.stop();}});
const ref = area => ({area,id:1,life:1});
const credit = (c,eligible=false) => ({character:c.characterId,cogEligible:eligible,cogMisses:0,flags:{}});
const writes = (victim,records=characters,eligible=false) => records.map((c,i)=>({victim,character:c.characterId,version:i+1,credit:credit(c,eligible)}));
async function flush(batch,target=ledger){for(let i=0;i<batch.length;i+=100)await target.recordContributionBatch(batch.slice(i,i+100));}
function recipe(victim,throughVersion,overrides=[],count=0,draws=0){return {schema:'world-death-v1',victim,world:'w1',throughVersion,expectedContributors:count,expectedRandomDraws:draws,facts:{kind:'scrapling',level:20,role:'ordinary',profile:null,xp:248,coins:62},overrides,random:{algorithm:'mulberry32-v1',state:42}};}
async function draft(victim,overrides=[]){const summary=await ledger.readContributionSummary(victim,[]);return ledger.beginVictimDraft({recipe:recipe(victim,summary.throughVersion,overrides,summary.totalContributors,summary.storedEligibleTotal),fence:summary});}
async function page(draft,limit=100,target=ledger){const read=await target.readContributionPage(draft.draftId,draft.cursor.afterCharacter,limit);return {read,planned:read.credits.length?planOutcomePage(draft.recipe,draft.cursor,read.credits.map(w=>w.credit)):null};}
async function materialize(draft,limit=100,target=ledger){while(draft.cursor.recipientCount<draft.contributorCount){const next=await page(draft,limit,target);assert(next.read.credits.length<=100);draft=await target.appendVictimPage(draft.draftId,next.planned);}return target.sealVictimDraft(draft.draftId);}

// Stateful tests use distinct victim incarnations and share only immutable character identities.
test('bounded contribution UPSERT versions, final source fence and exact stored eligibility prefixes',async()=>{
  const victim=ref('ledger-version'),[a,b,c]=characters;
  const zero=await ledger.readContributionSummary(victim,[b.characterId]);assert.equal(zero.sourceVersion,0);assert.equal(zero.throughVersion,0);assert.equal(zero.totalContributors,0);assert.equal(zero.residents[0].priorCredit,null);
  await ledger.recordContributionBatch([{victim,character:a.characterId,version:1000,credit:credit(a,true)}]);
  const stale=await ledger.readContributionSummary(victim,[]);
  await ledger.recordContributionBatch([{victim,character:b.characterId,version:2,credit:credit(b,true)}]);
  const summary=await ledger.readContributionSummary(victim,[c.characterId,b.characterId,a.characterId]);
  assert.equal(summary.sourceVersion,2);assert.equal(summary.throughVersion,1000);assert.equal(summary.totalContributors,2);assert.equal(summary.storedEligibleTotal,2);
  assert.deepEqual(summary.residents.map(r=>[r.character,r.eligibleBefore,!!r.priorCredit]),[[a.characterId,0,true],[b.characterId,1,true],[c.characterId,2,false]]);
  await assert.rejects(ledger.beginVictimDraft({recipe:recipe(victim,1000,[],2,2),fence:stale}),error('conflict'));
  await assert.rejects(ledger.beginVictimDraft({recipe:recipe(victim,1001,[],2,2),fence:summary}),error('conflict'));
  await ledger.recordContributionBatch([{victim,character:b.characterId,version:2,credit:credit(b,true)},{victim,character:b.characterId,version:1,credit:credit(b,false)}]);
  assert.equal((await ledger.readContributionSummary(victim,[])).sourceVersion,2);
  await assert.rejects(ledger.recordContributionBatch([{victim,character:b.characterId,version:2,credit:credit(b,false)}]),error('conflict'));
  await ledger.recordContributionBatch([{victim,character:b.characterId,version:3,credit:credit(b,false)}]);
  assert.equal((await ledger.readContributionSummary(victim,[])).storedEligibleTotal,1);
  await assert.rejects(ledger.recordContributionBatch(Array(101).fill(writes(victim,[a])[0])),error('invalid'));
  const missing={...writes(victim,[a])[0],character:'00000000-0000-4000-8000-000000000001',credit:{...credit(a),character:'00000000-0000-4000-8000-000000000001'}};
  const rollbackVictim=ref('ledger-batch-rollback');await assert.rejects(ledger.recordContributionBatch([{...writes(rollbackVictim,[a])[0]}, {...missing,victim:rollbackVictim}]),error('not_found'));
  assert.equal((await ledger.readContributionSummary(rollbackVictim,[])).totalContributors,0);
  const d=await draft(victim);assert.equal(d.sourceVersion,3);assert.equal(d.recipe.throughVersion,1000);assert.equal((await ledger.readContributionSummary(victim,[])).state,'frozen');
  await assert.rejects(ledger.recordContributionBatch([{victim,character:c.characterId,version:1001,credit:credit(c)}]),error('closed'));
  await assert.rejects(ledger.cleanupVictimDraft(d.draftId),error('closed'));
  await assert.rejects(pool.query('DELETE FROM world_contributions WHERE victim_key=$1',[victimKey(victim)]),/unsealed/);
});

test('final pure-core summary verification rejects missing recipients/draws and applies resident overrides without SQL reward rules',async()=>{
  const victim=ref('ledger-recipe-proof'),[a,b]=characters;await flush(writes(victim,[a,b],true));
  const summary=await ledger.readContributionSummary(victim,[a.characterId]);
  for(const invalid of [recipe(victim,2,[],1,1),recipe(victim,2,[],2,1)]) await assert.rejects(ledger.beginVictimDraft({recipe:invalid,fence:summary}),/reservation mismatch/);
  assert.equal((await ledger.readContributionSummary(victim,[])).state,'open');
  const r=recipe(victim,2,[credit(a,false)],2,1),d=await ledger.beginVictimDraft({recipe:r,fence:summary});
  const planned=(await page(d)).planned;assert(!planned.grants[0].objectives.some(o=>o.kind==='cog-roll'));assert(planned.grants[1].objectives.some(o=>o.kind==='cog-roll'));
  const next=await ledger.appendVictimPage(d.draftId,planned),seal=await ledger.sealVictimDraft(next.draftId);assert.equal(seal.finalCursor.randomDraws,1);
  const entry={accountId:a.accountId,characterId:a.characterId,id:planned.grants[0].id,payload:codec.grantToJson(planned.grants[0])};
  await assert.rejects(store.recordGrantBatch([entry]),e=>e.code==='outcome_conflict');
  const legacyVictim=ref('ledger-existing-legacy'),id=JSON.stringify([legacyVictim.area,1,1,a.characterId]),payload={...planned.grants[0],id,victim:legacyVictim};
  await store.recordGrant(a.accountId,a.characterId,id,codec.grantToJson(payload));
  const empty=await ledger.readContributionSummary(legacyVictim,[]);await assert.rejects(ledger.beginVictimDraft({recipe:recipe(legacyVictim,0),fence:empty}),error('conflict'));
});

test('257 sequential contributors stage bounded pure-planner pages invisibly, restart, seal atomically and retain exact receipts',async()=>{
  const victim=ref('ledger-257'),batch=writes(victim,characters,true);await flush(batch);
  let d=await draft(victim),first=await page(d);const firstId=first.planned.grants[0].id,c=characters[0];
  await assert.rejects(ledger.sealVictimDraft(d.draftId),error('conflict'));
  await assert.rejects(ledger.appendVictimPage(d.draftId,{...first.planned,grants:first.planned.grants.map((g,i)=>i?g:{...g,xp:1})}),error('conflict'));
  d=await ledger.appendVictimPage(d.draftId,first.planned);assert.equal(d.cursor.recipientCount,100);
  assert.deepEqual(await ledger.appendVictimPage(d.draftId,first.planned),d);
  assert.equal((await pool.query('SELECT count(*)::int n FROM world_character_grants WHERE grant_id=$1',[firstId])).rows[0].n,1);
  assert(!(await store.pendingGrants(c.accountId,c.characterId)).some(g=>g.id===firstId));
  await assert.rejects(store.loadForRecovery(c.accountId,c.characterId,[firstId]),e=>e instanceof CharacterStoreError&&e.code==='not_found');
  await assert.rejects(store.saveCheckpoint(c.accountId,c.characterId,0,c.checkpoint,[firstId]),e=>e instanceof CharacterStoreError&&e.code==='not_found');
  assert.equal((await store.getOwned(c.accountId,c.characterId)).revision,0);
  // Independent pool/store emulates process restart with only immutable recipe and durable cursor.
  const secondPool=new pg.Pool({connectionString:cluster.url});let seal;
  try {const restarted=new DurableOutcomeStore(secondPool,codec,options);d=await restarted.getVictimDraft(d.draftId);seal=await materialize(d,100,restarted);assert.deepEqual(await restarted.sealVictimDraft(d.draftId),seal);}finally{await secondPool.end();}
  assert.equal(seal.recipientCount,257);assert.equal(seal.finalCursor.randomDraws,257);assert.equal(seal.finalCursor.pageSequence,3);assert.equal(JSON.stringify(seal).length<1500,true);
  assert.deepEqual(await ledger.getVictimSeal(victim),seal);
  for(const record of characters){const pending=await store.pendingGrants(record.accountId,record.characterId);const earned=pending.filter(g=>g.payload.victim.area===victim.area);assert.equal(earned.length,1);assert.equal(earned[0].payload.xp,248);assert.equal(earned[0].payload.coins,62);}
  const saved=await store.saveCheckpoint(c.accountId,c.characterId,0,{...c.checkpoint,progress:{...c.checkpoint.progress,xp:248,coins:62}},[firstId]);
  assert.equal(saved.revision,1);assert(!(await store.pendingGrants(c.accountId,c.characterId)).some(g=>g.id===firstId));
  assert.equal((await store.loadForRecovery(c.accountId,c.characterId,[firstId])).grants[0].appliedRevision,1);
  await assert.rejects(store.saveCheckpoint(c.accountId,c.characterId,1,saved.checkpoint,[firstId]),e=>e.code==='already_applied');
  let cleanup;do{cleanup=await ledger.cleanupVictimDraft(d.draftId,37);assert(cleanup.removed<=111);}while(!cleanup.done);
  assert.deepEqual(await ledger.getVictimSeal(victim),seal);assert.equal((await store.loadForRecovery(c.accountId,c.characterId,[firstId])).grants[0].appliedRevision,1);
  await assert.rejects(ledger.recordContributionBatch(batch.slice(0,1)),error('closed'));await assert.rejects(ledger.beginVictimDraft({recipe:d.recipe,fence:{sourceVersion:257,throughVersion:257,totalContributors:257,storedEligibleTotal:257}}),error('closed'));
});

test('real Area101 lifetime contributors under100 concurrent match paged oracle including offline delivery and exact-once recovery',async()=>{
  const records=characters.slice(100,201),definition=createWorld1Definition({query:flatWorld,personalProps:flatWorld,fixedLevels:{scrapling:20,scavenger:20,jellyfish:20,echo:20},population:{scrapling:1,scavenger:0,jellyfish:0}}),area=worldArea('paged-real-101','w1',{definition}),destination=worldArea('paged-real-offline');
  try {
    const enemy=[...area.enemies.values()][0],actors=records.slice(0,100).map(c=>addActor(area,c.characterId,'warrior'));assert.equal(area.players.size,100);
    for(const actor of actors)assert(area.services.combat.damage(actor.ref,enemy.unit,1)>0);
    // Read-only retained-core debug snapshots provide the independent oracle fixture, not a production spill path.
    let sourceCredits=area.debugState().interactions.credits.find(e=>e.victim.id===enemy.unit.id).contributors;
    await ledger.recordContributionBatch(sourceCredits.map((credit,i)=>({victim:enemy.unit,character:credit.character,version:i+1,credit})));
    const retirement=area.quiescePlayer(actors[0].ref,'offline-oracle'),left=await store.saveCheckpoint(records[0].accountId,records[0].characterId,records[0].revision,retirement.capture.checkpoint,retirement.capture.appliedGrantIds);
    area.markCheckpointDurable(retirement.capture.captureId,left.revision,retirement.capture.appliedGrantIds);area.commitPlayerRetirement(retirement.token);records[0]=left;
    const last=addActor(area,records[100].characterId,'warrior');assert.equal(area.players.size,100);assert(area.services.combat.damage(last.ref,enemy.unit,1)>0);
    sourceCredits=area.debugState().interactions.credits.find(e=>e.victim.id===enemy.unit.id).contributors;
    const newest=sourceCredits.find(c=>c.character===records[100].characterId);await ledger.recordContributionBatch([{victim:enemy.unit,character:newest.character,version:101,credit:newest}]);
    const randomState=area.services.random.state();area.services.combat.damage(last.ref,enemy.unit,area.services.getUnit(enemy.unit).hp);
    const oracle=area.pendingGrants();assert.equal(oracle.length,101);assert.equal(oracle.filter(g=>!g.appliedHere).length,1);
    const summary=await ledger.readContributionSummary(enemy.unit,[]),r={...recipe(enemy.unit,101,[],101,0),random:{algorithm:'mulberry32-v1',state:randomState}};let d=await ledger.beginVictimDraft({recipe:r,fence:summary});
    while(d.cursor.recipientCount<101){const p=await page(d);for(const grant of p.planned.grants)assert.deepEqual(grant,oracle.find(o=>o.grant.id===grant.id).grant);d=await ledger.appendVictimPage(d.draftId,p.planned);}
    const seal=await ledger.sealVictimDraft(d.draftId);assert.equal(seal.recipientCount,101);
    for(const pending of oracle.filter(p=>p.appliedHere)){const c=records.find(r=>r.characterId===pending.grant.recipient),actor=area.services.playerByCharacter(c.characterId),capture=area.capturePlayerCheckpoint(actor.state.unit),saved=await store.saveCheckpoint(c.accountId,c.characterId,c.revision,capture.checkpoint,capture.appliedGrantIds);area.markCheckpointDurable(capture.captureId,saved.revision,capture.appliedGrantIds);}
    const offline=oracle.find(p=>!p.appliedHere),c=records[0],checkpoint=codec.toCore(c.checkpoint),admission=destination.reserveAdmission(c.characterId,'spawn',0),arrival=destination.stageRestoredArrival(admission,checkpoint,prepareRestore(checkpoint,0,{version:'test-explicit-preserve',restore:c=>c})),owner=destination.activateRestoredArrival(arrival.token);
    assert.equal(destination.receiveGrant(offline.grant),'applied');assert.equal(destination.receiveGrant(offline.grant),'duplicate');const capture=destination.capturePlayerCheckpoint(owner),saved=await store.saveCheckpoint(c.accountId,c.characterId,c.revision,capture.checkpoint,capture.appliedGrantIds);destination.markCheckpointDurable(capture.captureId,saved.revision,capture.appliedGrantIds);
    const restarted=new CharacterStore(pool,codec);for(const pending of oracle){const c=records.find(r=>r.characterId===pending.grant.recipient),recovered=await restarted.loadForRecovery(c.accountId,c.characterId,[pending.grant.id]);assert(recovered.grants[0].appliedRevision!==null);assert.equal(recovered.character.checkpoint.progress.xp,248);assert.equal(recovered.character.checkpoint.progress.coins,62);area.acknowledgeGrant(pending.grant.id);}
  }finally{if(!area.pendingGrants().length)area.dispose();destination.dispose();}
});

test('mid-page SQL failure rolls back every staged grant, mapping and cursor; independent append retry is idempotent',async()=>{
  const victim=ref('ledger-failed-page');await flush(writes(victim,characters.slice(0,5)));const d=await draft(victim),p=await page(d);
  await pool.query(`CREATE FUNCTION fail_ledger_page() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.character_id::text=TG_ARGV[0] THEN RAISE EXCEPTION 'ledger page midpoint'; END IF; RETURN NEW; END; $$;
    CREATE TRIGGER fail_ledger_page BEFORE INSERT ON world_character_grants FOR EACH ROW EXECUTE FUNCTION fail_ledger_page('${characters[2].characterId}')`);
  try{await assert.rejects(ledger.appendVictimPage(d.draftId,p.planned),/midpoint/);}finally{await pool.query('DROP TRIGGER fail_ledger_page ON world_character_grants;DROP FUNCTION fail_ledger_page()');}
  assert.deepEqual(await ledger.getVictimDraft(d.draftId),d);assert.equal((await pool.query('SELECT count(*)::int n FROM world_paged_grant_visibility WHERE draft_id=$1',[d.draftId])).rows[0].n,0);
  const secondPool=new pg.Pool({connectionString:cluster.url});try{const other=new DurableOutcomeStore(secondPool,codec,options);const results=await Promise.all([ledger.appendVictimPage(d.draftId,p.planned),other.appendVictimPage(d.draftId,p.planned)]);assert.deepEqual(results[0],results[1]);await assert.rejects(pool.query('UPDATE world_victim_pages SET planned_count=planned_count WHERE draft_id=$1',[d.draftId]),/immutable/);await assert.rejects(pool.query('DELETE FROM world_victim_pages WHERE draft_id=$1',[d.draftId]),/unsealed/);await ledger.sealVictimDraft(d.draftId);await assert.rejects(pool.query('UPDATE world_paged_outcome_seals SET recipient_count=recipient_count WHERE draft_id=$1',[d.draftId]),/immutable/);}finally{await secondPool.end();}
});

test('same frozen outcome has identical immutable row-chain digest and RNG across different bounded page partitions',async()=>{
  await pool.query('CREATE DATABASE ledger_partition');const url=new URL(cluster.url);url.pathname='/ledger_partition';const otherPool=new pg.Pool({connectionString:url.href});
  try {
    await migrate(otherPool);const other=new DurableOutcomeStore(otherPool,codec,options),records=characters.slice(10,15),victim=ref('ledger-partition');
    for(const c of records){await otherPool.query("INSERT INTO accounts(username,save,updated,created) VALUES($1,'{}',1,1)",[c.accountId]);const raw=(await pool.query('SELECT * FROM world_characters WHERE character_id=$1',[c.characterId])).rows[0];await otherPool.query('INSERT INTO world_characters(character_id,account_id,codec_version,identity_json,checkpoint_json,revision) VALUES($1,$2,$3,$4,$5,$6)',[raw.character_id,raw.account_id,raw.codec_version,raw.identity_json,raw.checkpoint_json,raw.revision]);}
    const batch=writes(victim,records,true);await flush(batch);await flush(batch,other);
    const first=await draft(victim),summary=await other.readContributionSummary(victim,[]),second=await other.beginVictimDraft({recipe:first.recipe,fence:summary});
    const left=await materialize(first,2),right=await materialize(second,3,other);
    assert.equal(left.contentDigest,right.contentDigest);assert.equal(left.recipeDigest,right.recipeDigest);assert.equal(left.finalCursor.randomState,right.finalCursor.randomState);assert.equal(left.finalCursor.randomDraws,5);assert.notEqual(left.finalCursor.pageSequence,right.finalCursor.pageSequence);
  }finally{await otherPool.end();await pool.query('DROP DATABASE ledger_partition');}
});

test('indexed recovery cycles have a fixed highwater and catch later drafts by restarting, including empty outcomes',async()=>{
  const before=await ledger.getDraftRecoveryHighWater(),early=await draft(ref('recovery-early')),high=await ledger.getDraftRecoveryHighWater(),late=await draft(ref('recovery-late'));
  const cycle=await ledger.listVictimDrafts({afterSequence:before,throughSequence:high,limit:1});assert.equal(cycle.length,1);assert.equal(cycle[0].draftId,early.draftId);
  assert.deepEqual(await ledger.listVictimDrafts({afterSequence:cycle[0].recoverySequence,throughSequence:high}),[]);
  const next=await ledger.listVictimDrafts({throughSequence:await ledger.getDraftRecoveryHighWater()});assert(next.some(d=>d.draftId===late.draftId));
  const seal=await ledger.sealVictimDraft(early.draftId);assert.equal(seal.recipientCount,0);assert.equal(seal.finalCursor.pageSequence,0);
  assert(!(await ledger.listVictimDrafts({throughSequence:await ledger.getDraftRecoveryHighWater()})).some(d=>d.draftId===early.draftId));
  await assert.rejects(ledger.listVictimDrafts({throughSequence:'1e3'}),error('invalid'));await assert.rejects(ledger.listVictimDrafts({throughSequence:'1',limit:101}),error('invalid'));
});

test('late old-owner begin commits behind an advanced sequence cursor and the next recovery cycle discovers it',async()=>{
  const victim=ref('recovery-late-behind'),summary=await ledger.readContributionSummary(victim,[]),gate=await pool.connect(),lock='83474375';let pending;
  await gate.query('SELECT pg_advisory_lock($1::bigint)',[lock]);
  await pool.query(`CREATE FUNCTION hold_ledger_draft() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.victim_key=TG_ARGV[0] THEN PERFORM pg_advisory_xact_lock(83474375); END IF; RETURN NEW; END; $$;
    CREATE TRIGGER hold_ledger_draft AFTER INSERT ON world_victim_drafts FOR EACH ROW EXECUTE FUNCTION hold_ledger_draft('${victimKey(victim)}')`);
  try {
    pending=ledger.beginVictimDraft({recipe:recipe(victim,0),fence:summary});
    const until=Date.now()+3000;while(!(await pool.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=83474375 AND NOT granted")).rowCount){if(Date.now()>until)throw new Error('late draft did not reach transaction gate');await new Promise(r=>setTimeout(r,5));}
    const newer=await draft(ref('recovery-already-scanned')),high=await ledger.getDraftRecoveryHighWater();
    assert((await ledger.listVictimDrafts({throughSequence:high})).some(d=>d.draftId===newer.draftId));
    await gate.query('SELECT pg_advisory_unlock($1::bigint)',[lock]);const late=await pending;
    assert(BigInt(late.recoverySequence)<BigInt(newer.recoverySequence));
    assert(!(await ledger.listVictimDrafts({afterSequence:newer.recoverySequence,throughSequence:high})).some(d=>d.draftId===late.draftId));
    assert((await ledger.listVictimDrafts({throughSequence:await ledger.getDraftRecoveryHighWater()})).some(d=>d.draftId===late.draftId));
  }finally{await gate.query('SELECT pg_advisory_unlock($1::bigint)',[lock]).catch(()=>{});gate.release();await pending?.catch(()=>{});await pool.query('DROP TRIGGER hold_ledger_draft ON world_victim_drafts;DROP FUNCTION hold_ledger_draft()');}
});

test('delayed seal publishes an older journal sequence so delivery must requery oldest pending after each checkpoint',async()=>{
  const c=characters[256],slow=ref('ledger-delayed'),fast=ref('ledger-fast');await flush(writes(slow,[c]));let d=await draft(slow);d=await ledger.appendVictimPage(d.draftId,(await page(d)).planned);
  await flush(writes(fast,[c]));const f=await draft(fast);await materialize(f);
  const visible=await store.pendingGrants(c.accountId,c.characterId);assert.equal(visible.length,2); // prior257 outcome plus newer fast victim
  const fastGrant=visible.find(g=>g.payload.victim.area===fast.area);assert(fastGrant);
  await ledger.sealVictimDraft(d.draftId);
  const after=await store.pendingGrants(c.accountId,c.characterId,{after:fastGrant.sequence});assert(!after.some(g=>g.payload.victim.area===slow.area));
  assert((await store.pendingGrants(c.accountId,c.characterId)).some(g=>g.payload.victim.area===slow.area));
});

test('007 migration is additive over preexisting005/006 data and framework rerun is empty',async()=>{
  await pool.query('CREATE DATABASE ledger_pre007');const url=new URL(cluster.url);url.pathname='/ledger_pre007';const legacy=new pg.Pool({connectionString:url.href});
  try {
    await legacy.query('CREATE TABLE schema_migrations(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
    const files=(await readdir(new URL('../node/migrations/',import.meta.url))).filter(f=>/^00[1-6]_.*\.sql$/.test(f)).sort();
    for(const file of files){await legacy.query(await readFile(new URL(`../node/migrations/${file}`,import.meta.url),'utf8'));await legacy.query('INSERT INTO schema_migrations(version) VALUES($1)',[file.slice(0,-4)]);}
    const accountId='g'+'f'.repeat(23);await legacy.query("INSERT INTO accounts(username,save,revision,updated,created) VALUES($1,'{\"legacy\":true}',47,123,100)",[accountId]);
    const priorStore=new CharacterStore(legacy,codec),c=await priorStore.create(accountId,identity),victim=ref('pre007-durable'),id=JSON.stringify([victim.area,victim.id,victim.life,c.characterId]),payload={id,victim,recipient:c.characterId,xp:1,coins:1,objectives:[],flags:[]};
    await legacy.query('INSERT INTO world_character_grants(grant_id,character_id,account_id,codec_version,payload_json) VALUES($1,$2,$3,1,$4)',[id,c.characterId,accountId,JSON.stringify(payload)]);
    await legacy.query('INSERT INTO world_character_grant_receipts(grant_id,character_id,applied_revision) VALUES($1,$2,1)',[id,c.characterId]);
    await legacy.query('INSERT INTO world_victim_outcomes(outcome_key,codec_version,recipient_count,content_digest) VALUES($1,1,1,$2)',[victimKey(victim),'a'.repeat(64)]);
    await legacy.query('INSERT INTO world_chat_accounts(account_id,enabled,party_only,mute_until) VALUES($1,false,true,1234)',[accountId]);
    const tables=['world_chat_accounts','accounts','world_characters','world_character_grants','world_character_grant_receipts','world_victim_outcomes'];
    const before=await Promise.all(tables.map(t=>legacy.query(`SELECT * FROM ${t}`)));
    assert.deepEqual(await migrate(legacy),['007_world_paged_ledger']);assert.deepEqual(await migrate(legacy),[]);assert.deepEqual((await Promise.all(tables.map(t=>legacy.query(`SELECT * FROM ${t}`)))).map(r=>r.rows),before.map(r=>r.rows));
    assert.equal((await legacy.query('SELECT count(*)::int n FROM world_replayable_grants')).rows[0].n,1);
  }finally{await legacy.end();await pool.query('DROP DATABASE ledger_pre007');}
});
