import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startPostgres } from '../node/local-postgres.mjs';
import { createPool, migrate } from '../node/db.ts';
import { CharacterStore } from './character-store.ts';
import { PersistenceCoordinator, readCertifiedGrantPage } from './persistence-coordinator.ts';

let cluster, pool, store;
const account = 'g' + '9'.repeat(23);
// Storage-only codec: gameplay schema has its own owner and acceptance tests.
const codec = {
  version: 1,
  validateIdentity: value => structuredClone(value),
  fresh: () => ({ xp: 0, coins: 0 }),
  validateCheckpoint: value => structuredClone(value),
  validateGrant: value => structuredClone(value),
};
const signal = new AbortController();
const ownership = { key: 'test', closed: signal.signal, assertOwned() {}, async release() {} };
const options = { maxQueuedPerCharacter: 1, maxAttempts: 2, retryMs: 0, now: () => performance.now() };
before(async () => {
  cluster = await startPostgres(); pool = createPool(cluster.url); await migrate(pool);
  await pool.query("INSERT INTO accounts(username,updated,created) VALUES($1,0,0)", [account]);
  store = new CharacterStore(pool, codec);
});
after(async () => { await pool?.end(); cluster?.stop(); });
const capture = (character, change = {}) => ({ captureId: character.characterId + ':1', accountId: account,
  characterId: character.characterId, expectedRevision: character.revision, checkpoint: { xp: 25, coins: 2 }, appliedGrantIds: [], ...change });

test('immutable captured checkpoint and receipt commit together in actual Postgres', async () => {
  const character = await store.create(account, { classId: 'warrior' });
  const id = JSON.stringify(['area', 2, 1, character.characterId]);
  await store.recordGrant(account, character.characterId, id, { xp: 25 });
  const coordinator = new PersistenceCoordinator(store, ownership, options);
  const input = capture(character, { appliedGrantIds: [id] });
  const promise = coordinator.commit(input); input.checkpoint.xp = 999; input.appliedGrantIds.length = 0;
  const result = await promise; assert.equal(result.kind, 'saved'); assert.equal(result.character.checkpoint.xp, 25);
  const recovery = await store.loadForRecovery(account, character.characterId, [id]);
  assert.equal(recovery.grants[0].appliedRevision, 1); assert.equal(recovery.character.checkpoint.xp, 25);
  assert.deepEqual(await coordinator.shutdown(100), { durable: true, unresolved: 0 });
});

test('lost commit response enters consistent recovery rather than applying or saving a second reward', async () => {
  const character = await store.create(account, { classId: 'mage' });
  const id = JSON.stringify(['area', 3, 1, character.characterId]);
  await store.recordGrant(account, character.characterId, id, { xp: 25 });
  let calls = 0;
  const ambiguous = {
    async saveCheckpoint(...args) { calls++; await store.saveCheckpoint(...args); throw new Error('lost response'); },
    loadForRecovery: (...args) => store.loadForRecovery(...args),
  };
  const coordinator = new PersistenceCoordinator(ambiguous, ownership, options);
  const result = await coordinator.commit(capture(character, { appliedGrantIds: [id] }));
  assert.equal(result.kind, 'recovery'); assert.equal(calls, 1);
  assert.equal(result.recovery.character.revision, 1); assert.equal(result.recovery.character.checkpoint.xp, 25);
  assert.equal(result.recovery.grants[0].appliedRevision, 1);
});

test('ordinary failure retries the same detached capture; conflict never overwrites newer state', async () => {
  const character = await store.create(account, { classId: 'priest' }); let calls = 0;
  const flaky = { async saveCheckpoint(...args) { if (++calls === 1) throw new Error('unavailable'); return store.saveCheckpoint(...args); },
    loadForRecovery: (...args) => store.loadForRecovery(...args) };
  const coordinator = new PersistenceCoordinator(flaky, ownership, options);
  assert.equal((await coordinator.commit(capture(character))).kind, 'saved'); assert.equal(calls, 2);
  const stale = new PersistenceCoordinator(store, ownership, options);
  const result = await stale.commit(capture(character, { checkpoint: { xp: 999, coins: 999 } }));
  assert.equal(result.kind, 'recovery'); assert.equal(result.recovery.character.checkpoint.xp, 25);
});

test('queue, receipt and deadline bounds retain unresolved work without permitting ownership-lost writes', async () => {
  const character = await store.create(account, { classId: 'warrior' });
  let release; const blocked = new Promise(resolve => { release = resolve; });
  const delayed = { async saveCheckpoint(...args) { await blocked; return store.saveCheckpoint(...args); }, loadForRecovery: (...args) => store.loadForRecovery(...args) };
  const coordinator = new PersistenceCoordinator(delayed, ownership, options);
  const pending = coordinator.commit(capture(character));
  assert.throws(() => coordinator.commit(capture(character)), /queue full/);
  const timed = await coordinator.shutdown(1); assert.equal(timed.durable, false); assert.equal(timed.unresolved, 1);
  release(); assert.equal((await pending).kind, 'saved');
  const closed = new AbortController(); closed.abort();
  const denied = new PersistenceCoordinator(store, { ...ownership, closed: closed.signal }, options);
  assert.equal((await denied.commit(capture(character))).kind, 'unresolved');
  const bounded = new PersistenceCoordinator(store, ownership, options);
  assert.throws(() => bounded.commit(capture(character, { appliedGrantIds: Array.from({ length: 257 }, (_, i) => String(i)) })), /invalid checkpoint/);
});

 test('candidate journal read is revision-certified against actual PG receipts and discards stale or ownership-lost responses', async () => {
  const character=await store.create(account,{classId:'mage'}), id=JSON.stringify(['certified',1,1,character.characterId]);
  await store.recordGrant(account,character.characterId,id,{xp:25});
  const context={accountId:account,characterId:character.characterId,expectedRevision:0,limit:100};
  const stale={async pendingGrants(...args){const candidates=await store.pendingGrants(...args);await store.saveCheckpoint(account,character.characterId,0,{xp:25,coins:2},[id]);return candidates;},loadForRecovery:(...args)=>store.loadForRecovery(...args)};
  const result=await readCertifiedGrantPage(stale,ownership,context);assert.equal(result.kind,'recovery');assert.equal(result.recovery.character.revision,1);assert.equal(result.recovery.grants[0].appliedRevision,1);
  const fresh=await readCertifiedGrantPage(store,ownership,{...context,expectedRevision:1});assert.equal(fresh.kind,'page');assert.deepEqual(fresh.grants,[]);
  const closed=new AbortController();const losesDuringRead={pendingGrants:(...args)=>store.pendingGrants(...args),async loadForRecovery(...args){const r=await store.loadForRecovery(...args);closed.abort();return r;}};
  assert.deepEqual(await readCertifiedGrantPage(losesDuringRead,{...ownership,closed:closed.signal},{...context,expectedRevision:1}),{kind:'unresolved',reason:'ownership'});
});

test('batched commit saves together, and after a lost batch response every capture recovers without a second reward', async () => {
  const characters = [await store.create(account, { classId: 'mage' }), await store.create(account, { classId: 'warrior' })];
  const ids = characters.map((c, i) => JSON.stringify(['batch-area', i + 1, 1, c.characterId]));
  for (const [i, c] of characters.entries()) await store.recordGrant(account, c.characterId, ids[i], { xp: 25 });
  const plain = new PersistenceCoordinator(store, ownership, options);
  const first = await plain.commitBatch(characters.map((c, i) => ({ ...capture(c, { appliedGrantIds: [ids[i]] }), captureId: `${c.characterId}:batch` })));
  assert.deepEqual(first.map(r => [r.kind, r.character.revision]), [['saved', 1], ['saved', 1]]);
  assert.deepEqual([plain.metrics.batches, plain.metrics.batchFallbacks], [1, 0]);
  let batchCalls = 0, singleCalls = 0;
  const ambiguous = {
    async saveCheckpoints(writes) { batchCalls++; await store.saveCheckpoints(writes); throw new Error('lost batch response'); },
    async saveCheckpoint(...args) { singleCalls++; return store.saveCheckpoint(...args); },
    loadForRecovery: (...args) => store.loadForRecovery(...args),
  };
  const coordinator = new PersistenceCoordinator(ambiguous, ownership, options);
  const again = await coordinator.commitBatch(first.map(r => ({ ...capture(r.character, { checkpoint: { xp: 30, coins: 2 } }), captureId: `${r.character.characterId}:again` })));
  // The batch committed; each fallback save meets its own advanced revision and returns recovery, never a second write.
  assert.equal(batchCalls, 1); assert.equal(singleCalls, 2); assert.deepEqual(again.map(r => r.kind), ['recovery', 'recovery']);
  for (const result of again) { assert.equal(result.recovery.character.revision, 2); assert.equal(result.recovery.character.checkpoint.xp, 30); }
  for (const [i, c] of characters.entries()) assert.equal((await store.loadForRecovery(account, c.characterId, [ids[i]])).grants[0].appliedRevision, 1);
  assert.equal(coordinator.metrics.batchFallbacks, 1);
  assert.deepEqual(await coordinator.shutdown(100), { durable: true, unresolved: 0 });
});
