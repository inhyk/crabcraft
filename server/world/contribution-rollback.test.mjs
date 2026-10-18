import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {startPostgres} from '../node/local-postgres.mjs';
import {migrate} from '../node/db.ts';
import {CharacterStore,victimAdvisoryLock} from './character-store.ts';
import {CharacterStore as LegacyCharacterStore} from './fixtures/legacy-character-store-7f48d43.fixture.ts';
import {DurableOutcomeStore} from './contribution-store.ts';
import {createCoreCharacterCodec} from '../../src/sim/persistence.ts';
import {planOutcomePage,victimKey} from '../../src/sim/ledger.ts';

// Exact original first-PR68 store, independent of shallow CI git history. Do not modernize this fixture.
const LEGACY_SHA='6d584c7b1415717adfa58c3b7aabf41da8582b92311baa46010c4e8eaf3ffd2e';
const identity={schema:'world-identity-v1',classId:'warrior',archetype:'human',appearance:{race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'CompatibilityFixture'}};
const codec=createCoreCharacterCodec({identities:[{classId:'warrior',archetype:'human'}],freshLocation:{x:0,y:0,z:0,yaw:0}});
const resources={maxEntries:100,maxPayloadBytes:1e6,timeoutMs:10000};
const options={planOutcomePage,queryTimeoutMs:10000};
const priorVersions=['001_accounts','002_google_only','003_chat_reports','004_world_characters','005_world_victim_outcomes','006_world_chat'];
let cluster,pool,sequence=0;
before(async()=>{try{assert.equal(createHash('sha256').update(await readFile(new URL('./fixtures/legacy-character-store-7f48d43.fixture.ts',import.meta.url))).digest('hex'),LEGACY_SHA);cluster=await startPostgres();pool=new pg.Pool({connectionString:cluster.url});await migrate(pool);}catch(e){await pool?.end();cluster?.stop();throw e;}});
after(async()=>{try{await pool?.end();}finally{cluster?.stop();}});
async function character(target=pool){const accountId='g'+(++sequence).toString(16).padStart(23,'0');await target.query("INSERT INTO accounts(username,save,revision,updated,created) VALUES($1,'{\"legacy\":true}',47,1,1)",[accountId]);return new CharacterStore(target,codec).create(accountId,identity);}
const ref=area=>({area,id:1,life:1});
const recipe=(victim,count=0)=>({schema:'world-death-v1',victim,world:'w1',throughVersion:count,expectedContributors:count,expectedRandomDraws:0,facts:{kind:'scrapling',level:20,role:'ordinary',profile:null,xp:248,coins:62},overrides:[],random:{algorithm:'mulberry32-v1',state:42}});
function entry(c,victim){const id=JSON.stringify([victim.area,victim.id,victim.life,c.characterId]);return{accountId:c.accountId,characterId:c.characterId,id,payload:{id,victim,recipient:c.characterId,xp:248,coins:62,objectives:[{kind:'kill-scrapling',amount:1}],flags:[]}};}
async function stage(area,target=pool){const cs=await Promise.all([character(target),character(target)]);cs.sort((a,b)=>a.characterId<b.characterId?-1:1);const victim=ref(area),ledger=new DurableOutcomeStore(target,codec,options);await ledger.recordContributionBatch(cs.map((c,i)=>({victim,character:c.characterId,version:i+1,credit:{character:c.characterId,cogEligible:false,cogMisses:0,flags:{}}})));let draft=await ledger.beginVictimDraft({recipe:recipe(victim,2),fence:await ledger.readContributionSummary(victim,[])});const first=await nextPage(ledger,draft);draft=await ledger.appendVictimPage(draft.draftId,first);return{cs,victim,ledger,draft,first:first.grants[0]};}
async function nextPage(ledger,draft){const read=await ledger.readContributionPage(draft.draftId,draft.cursor.afterCharacter,1);return planOutcomePage(draft.recipe,draft.cursor,read.credits.map(w=>w.credit));}
const outcome=async fn=>{try{return{ok:true,value:await fn()};}catch(e){return{ok:false,error:e};}};
const pgCode=code=>e=>e.code===code;
async function until(check){const end=Date.now()+5000;while(!await check()){if(Date.now()>end)throw new Error('expected PostgreSQL lock wait was not observed');await new Promise(r=>setTimeout(r,5));}}

test('exact old reader cannot read or receipt a partial page; sealed retries and permanent cleanup gate remain compatible',async()=>{
  const s=await stage('rollback-reader'),old=new LegacyCharacterStore(pool,codec),c=s.cs[0];
  assert.equal((await pool.query('SELECT count(*)::int n FROM world_character_grants_physical WHERE grant_id=$1',[s.first.id])).rows[0].n,1);
  assert.deepEqual(await old.pendingGrants(c.accountId,c.characterId),[]);
  await assert.rejects(old.recordGrant(c.accountId,c.characterId,s.first.id,codec.grantToJson(s.first)),e=>e.code==='grant_mismatch');
  await assert.rejects(old.loadForRecovery(c.accountId,c.characterId,[s.first.id]),e=>e.code==='not_found');
  await assert.rejects(old.saveCheckpoint(c.accountId,c.characterId,0,{...c.checkpoint,progress:{...c.checkpoint.progress,xp:248,coins:62}},[s.first.id]),e=>e.code==='not_found');
  assert.equal((await old.getOwned(c.accountId,c.characterId)).revision,0);
  assert.equal((await pool.query('SELECT count(*)::int n FROM world_character_grant_receipts WHERE grant_id=$1',[s.first.id])).rows[0].n,0);
  const unseen=entry(s.cs[1],s.victim);await assert.rejects(old.recordGrant(unseen.accountId,unseen.characterId,unseen.id,unseen.payload),/staging intent/);
  await assert.rejects(old.recordVictimOutcome(s.cs.map(c=>entry(c,s.victim)),resources),/cannot coexist/);
  assert.equal((await pool.query('SELECT count(*)::int n FROM world_victim_outcomes WHERE outcome_key=$1',[victimKey(s.victim)])).rows[0].n,0);
  await s.ledger.appendVictimPage(s.draft.draftId,await nextPage(s.ledger,s.draft));await s.ledger.sealVictimDraft(s.draft.draftId);
  assert.equal((await old.pendingGrants(c.accountId,c.characterId)).length,1);
  const saved=await old.saveCheckpoint(c.accountId,c.characterId,0,{...c.checkpoint,progress:{...c.checkpoint.progress,xp:248,coins:62}},[s.first.id]);assert.equal(saved.revision,1);assert.equal((await old.loadForRecovery(c.accountId,c.characterId,[s.first.id])).grants[0].appliedRevision,1);
  let cleanup;do{cleanup=await s.ledger.cleanupVictimDraft(s.draft.draftId,1);}while(!cleanup.done);
  assert.equal((await pool.query('SELECT count(*)::int n FROM world_contribution_sources WHERE victim_key=$1',[victimKey(s.victim)])).rows[0].n,0);
  const duplicate=entry(c,s.victim);assert.equal((await old.recordGrant(c.accountId,c.characterId,duplicate.id,duplicate.payload)).id,duplicate.id);
  await assert.rejects(old.recordGrant(c.accountId,c.characterId,duplicate.id,{...duplicate.payload,xp:249}),/permanently sealed/);
  const extra=entry(await character(),s.victim);await assert.rejects(old.recordGrant(extra.accountId,extra.characterId,extra.id,extra.payload),/permanently sealed/);
  await assert.rejects(pool.query('INSERT INTO world_victim_outcomes(outcome_key,codec_version,recipient_count,content_digest) VALUES($1,1,1,$2)',[victimKey(s.victim),'a'.repeat(64)]),/cannot coexist/);
});

test('original non007 writer ON CONFLICT/RETURNING and real row locks, FK and immutable behavior survive the legacy view',async()=>{
  const old=new LegacyCharacterStore(pool,codec),a=await character(),b=await character(),victim=ref('non-paged-old'),entries=[entry(a,victim),entry(b,victim)];
  assert.equal((await old.recordVictimOutcome(entries,resources)).length,2);assert.equal((await old.recordVictimOutcome(entries,resources)).length,2);
  await assert.rejects(old.recordVictimOutcome(entries.map((e,i)=>i?e:{...e,payload:{...e.payload,xp:249}}),resources),e=>e.code==='outcome_conflict');
  const e=entry(a,ref('non-paged-returning')),values=[e.id,a.characterId,a.accountId,JSON.stringify(e.payload)],sql='INSERT INTO world_character_grants(grant_id,character_id,account_id,codec_version,payload_json) VALUES($1,$2,$3,1,$4) ON CONFLICT(grant_id) DO NOTHING RETURNING grant_id,journal_sequence';
  assert.equal((await pool.query(sql,values)).rowCount,1);assert.equal((await pool.query(sql,values)).rowCount,0);assert.equal((await old.recordGrant(a.accountId,a.characterId,e.id,e.payload)).id,e.id);
  for(const id of ['opaque:legacy','[bad JSON','["\\ud800",1,1,"legacy"]'])assert.equal((await old.recordGrant(a.accountId,a.characterId,id,e.payload)).id,id);
  const owner=await pool.connect(),contender=await pool.connect();try{await owner.query('BEGIN');assert.equal((await owner.query('SELECT * FROM world_character_grants WHERE grant_id=$1 FOR UPDATE',[e.id])).rowCount,1);await assert.rejects(contender.query('SELECT * FROM world_character_grants WHERE grant_id=$1 FOR UPDATE NOWAIT',[e.id]),pgCode('55P03'));}finally{await owner.query('ROLLBACK');owner.release();contender.release();}
  const foreignKeys=(await pool.query("SELECT confrelid::regclass::text AS target FROM pg_constraint WHERE conrelid='world_character_grant_receipts'::regclass AND contype='f'")).rows;assert.deepEqual(foreignKeys,[{target:'world_character_grants_physical'}]);
  await assert.rejects(pool.query("INSERT INTO world_character_grant_receipts(grant_id,character_id,applied_revision) VALUES('nonexistent-fk-probe',$1,1)",[a.characterId]),pgCode('23503'));
  for(const query of ['UPDATE world_character_grants SET payload_json=payload_json WHERE grant_id=$1','DELETE FROM world_character_grants WHERE grant_id=$1'])await assert.rejects(pool.query(query,[e.id]),/immutable/);
  await pool.query('INSERT INTO world_character_grant_receipts(grant_id,character_id,applied_revision) VALUES($1,$2,1)',[e.id,a.characterId]);await assert.rejects(pool.query('DELETE FROM world_character_grant_receipts WHERE grant_id=$1',[e.id]),/immutable/);
});

test('Node/SQL signed victim lock and canonical JSON tuple keys match UTF8, escaping and numeric forms',async()=>{
  for(const area of ['plain','한글😀','quotes"and\\slashes','negative-probe-1','negative-probe-2']){const key=JSON.stringify([area,17,3]),id=JSON.stringify([area,17,3,'legacy']);const sql=(await pool.query('SELECT world_victim_lock_key($1)::text AS lock,world_grant_victim_key($2) AS victim',[key,id])).rows[0];assert.equal(sql.lock,victimAdvisoryLock(key));assert.equal(sql.victim,key);}
  assert.equal((await pool.query('SELECT world_grant_victim_key($1) AS key',['["numeric",1.0,1e0,"legacy"]'])).rows[0].key,'["numeric",1,1]');
  for(const id of ['opaque','null','{}','[]','["x",0,1,"y"]','["x",1.1,1,"y"]','["\\ud800",1,1,"y"]'])assert.equal((await pool.query('SELECT world_grant_victim_key($1) AS key',[id])).rows[0].key,null);
});

test('mapping-first intent is invisible and deferred FK cannot commit an intent without its immutable physical row',async()=>{
  const s=await stage('deferred-intent'),remaining=s.cs[1],id=entry(remaining,s.victim).id,client=await pool.connect();
  try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock($1::bigint)',[victimAdvisoryLock(victimKey(s.victim))]);await client.query('INSERT INTO world_paged_grant_visibility(grant_id,draft_id,victim_key,character_id) VALUES($1,$2,$3,$4)',[id,s.draft.draftId,victimKey(s.victim),remaining.characterId]);await assert.rejects(client.query('COMMIT'),pgCode('23503'));}finally{await client.query('ROLLBACK');client.release();}
  assert.equal((await pool.query('SELECT count(*)::int n FROM world_paged_grant_visibility WHERE draft_id=$1',[s.draft.draftId])).rows[0].n,1);
  await s.ledger.appendVictimPage(s.draft.draftId,await nextPage(s.ledger,s.draft));await s.ledger.sealVictimDraft(s.draft.draftId);
});

test('preexisting old connection and named prepared SQL honor007 after DDL waits for its old table-lock transaction',async()=>{
  await pool.query('CREATE DATABASE rollback_pre007');const url=new URL(cluster.url);url.pathname='/rollback_pre007';const baseline=new pg.Pool({connectionString:url.href});let retained,migration;
  try{
    await baseline.query('CREATE TABLE schema_migrations(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');for(const version of priorVersions){await baseline.query(await readFile(new URL(`../node/migrations/${version}.sql`,import.meta.url),'utf8'));await baseline.query('INSERT INTO schema_migrations(version) VALUES($1)',[version]);}
    retained=await baseline.connect();const routingPool={query:retained.query.bind(retained),connect:async()=>({query:retained.query.bind(retained),release(){}})},old=new LegacyCharacterStore(routingPool,codec),beforePid=(await retained.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,c=await character(baseline),normal=entry(c,ref('before007-oldwriter'));await old.recordGrant(c.accountId,c.characterId,normal.id,normal.payload);
    const source=await readFile(new URL('./fixtures/legacy-character-store-7f48d43.fixture.ts',import.meta.url),'utf8'),pendingSql=source.match(/const result = await this\.pool\.query<GrantRow>\(`(SELECT g\.\* FROM world_character_grants g[\s\S]*?)`, \[characterId, after, limit\]\)/)[1],prepared={name:'original-pr68-pending',text:pendingSql,values:[c.characterId,'0',100]};
    await retained.query('BEGIN');assert.equal((await retained.query(prepared)).rowCount,1);const oid=(await retained.query("SELECT 'world_character_grants'::regclass::oid AS oid")).rows[0].oid;migration=outcome(()=>migrate(baseline));let wait;
    await until(async()=>{wait=(await baseline.query("SELECT pid,pg_blocking_pids(pid) AS blockers FROM pg_locks WHERE relation=$1 AND mode='AccessExclusiveLock' AND NOT granted",[oid])).rows[0];return!!wait;});assert(wait.blockers.includes(beforePid));await retained.query('COMMIT');const applied=await migration;assert.equal(applied.ok,true);assert.deepEqual(applied.value,['007_world_paged_ledger']);
    const other=await character(baseline),victim=ref('post007-partial'),ledger=new DurableOutcomeStore(baseline,codec,options),cs=[c,other].sort((a,b)=>a.characterId<b.characterId?-1:1);await ledger.recordContributionBatch(cs.map((c,i)=>({victim,character:c.characterId,version:i+1,credit:{character:c.characterId,cogEligible:false,cogMisses:0,flags:{}}})));let d=await ledger.beginVictimDraft({recipe:recipe(victim,2),fence:await ledger.readContributionSummary(victim,[])});
    // Include c's page in the physical journal while retaining an unsealed outcome.
    const count=cs[0].characterId===c.characterId?1:2,read=await ledger.readContributionPage(d.draftId,null,count),planned=planOutcomePage(d.recipe,d.cursor,read.credits.map(w=>w.credit));d=await ledger.appendVictimPage(d.draftId,planned);
    assert.equal((await retained.query(prepared)).rowCount,1);assert.deepEqual((await old.pendingGrants(c.accountId,c.characterId)).map(g=>g.id),[normal.id]);const partial=entry(c,victim);
    await assert.rejects(old.saveCheckpoint(c.accountId,c.characterId,0,{...c.checkpoint,progress:{...c.checkpoint.progress,xp:248,coins:62}},[partial.id]),e=>e.code==='not_found');assert.equal((await old.getOwned(c.accountId,c.characterId)).revision,0);assert.equal((await old.recordGrant(c.accountId,c.characterId,normal.id,normal.payload)).id,normal.id);assert.equal((await retained.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,beforePid);
  }finally{if(retained){await retained.query('ROLLBACK').catch(()=>{});retained.release();}await migration;await baseline.end();await pool.query('DROP DATABASE rollback_pre007');}
});

for(const oldFirst of [true,false])test(`005/begin race: ${oldFirst?'old whole transaction':'new draft'} takes the victim lock first`,async()=>{
  const victim=ref(oldFirst?'race-old-first':'race-draft-first'),key=victimKey(victim),cs=await Promise.all([character(),character()]),old=new LegacyCharacterStore(pool,codec),ledger=new DurableOutcomeStore(pool,codec,options),fence=await ledger.readContributionSummary(victim,[]),gate=await pool.connect(),gateId=oldFirst?83474381:83474382,table=oldFirst?'world_victim_outcomes':'world_victim_drafts',column=oldFirst?'outcome_key':'victim_key',timing=oldFirst?'BEFORE':'AFTER';let firstWork,secondWork;
  await gate.query('SELECT pg_advisory_lock($1::bigint)',[String(gateId)]);await pool.query(`CREATE FUNCTION hold_compat_begin() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.${column}=TG_ARGV[0] THEN PERFORM pg_advisory_xact_lock(${gateId});END IF;RETURN NEW;END;$$;CREATE TRIGGER aaa_hold_compat_begin ${timing} INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION hold_compat_begin('${key}');`);
  try{const whole=()=>old.recordVictimOutcome(cs.map(c=>entry(c,victim)),resources),begin=()=>ledger.beginVictimDraft({recipe:recipe(victim),fence});firstWork=outcome(oldFirst?whole:begin);await until(async()=>(await pool.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=$1::oid AND NOT granted",[gateId])).rowCount);secondWork=outcome(oldFirst?begin:whole);await until(async()=>(await pool.query("SELECT count(*)::int n FROM pg_locks WHERE locktype='advisory' AND NOT granted")).rows[0].n>=2);await gate.query('SELECT pg_advisory_unlock($1::bigint)',[String(gateId)]);const[first,second]=await Promise.all([firstWork,secondWork]);assert.equal(first.ok,true);assert.equal(second.ok,false);assert.notEqual(second.error.code,'40P01');assert.equal((await pool.query('SELECT count(*)::int n FROM world_victim_outcomes WHERE outcome_key=$1',[key])).rows[0].n,oldFirst?1:0);assert.equal((await pool.query('SELECT count(*)::int n FROM world_victim_drafts WHERE victim_key=$1',[key])).rows[0].n,oldFirst?0:1);}
  finally{await gate.query('SELECT pg_advisory_unlock($1::bigint)',[String(gateId)]).catch(()=>{});gate.release();await Promise.allSettled([firstWork,secondWork].filter(Boolean));await pool.query(`DROP TRIGGER aaa_hold_compat_begin ON ${table};DROP FUNCTION hold_compat_begin()`);}
});

for(const oldFirst of [true,false])test(`005/append race: ${oldFirst?'old character-lock holder':'new staged writer'} acquires the shared victim lock first`,async()=>{
  const s=await stage(oldFirst?'race-old-append':'race-append-old'),planned=await nextPage(s.ledger,s.draft),key=victimKey(s.victim),old=new LegacyCharacterStore(pool,codec),gate=await pool.connect(),gateId=oldFirst?83474383:83474384,table=oldFirst?'world_victim_outcomes':'world_character_grants_physical',timing=oldFirst?'BEFORE':'AFTER',condition=oldFirst?`NEW.outcome_key='${key}'`:`NEW.grant_id='${planned.grants[0].id}'`;let firstWork,secondWork;
  await gate.query('SELECT pg_advisory_lock($1::bigint)',[String(gateId)]);await pool.query(`CREATE FUNCTION hold_compat_append() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN PERFORM pg_advisory_xact_lock(${gateId});END IF;RETURN NEW;END;$$;CREATE TRIGGER aaa_hold_compat_append ${timing} INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION hold_compat_append();`);
  try{const whole=()=>old.recordVictimOutcome(s.cs.map(c=>entry(c,s.victim)),resources),append=()=>s.ledger.appendVictimPage(s.draft.draftId,planned);firstWork=outcome(oldFirst?whole:append);await until(async()=>(await pool.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=$1::oid AND NOT granted",[gateId])).rowCount);secondWork=outcome(oldFirst?append:whole);await until(async()=>(await pool.query("SELECT count(*)::int n FROM pg_locks WHERE locktype='advisory' AND NOT granted")).rows[0].n>=2);await gate.query('SELECT pg_advisory_unlock($1::bigint)',[String(gateId)]);const[first,second]=await Promise.all([firstWork,secondWork]),oldResult=oldFirst?first:second,newResult=oldFirst?second:first;assert.equal(oldResult.ok,false);assert.notEqual(oldResult.error.code,'40P01');assert.equal(newResult.ok,true);assert.equal((await s.ledger.sealVictimDraft(s.draft.draftId)).recipientCount,2);assert.equal((await pool.query('SELECT count(*)::int n FROM world_victim_outcomes WHERE outcome_key=$1',[key])).rows[0].n,0);}
  finally{await gate.query('SELECT pg_advisory_unlock($1::bigint)',[String(gateId)]).catch(()=>{});gate.release();await Promise.allSettled([firstWork,secondWork].filter(Boolean));await pool.query(`DROP TRIGGER aaa_hold_compat_append ON ${table};DROP FUNCTION hold_compat_append()`);}
});
