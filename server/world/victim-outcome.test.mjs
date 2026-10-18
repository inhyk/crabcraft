// Real Area lifetime contributors + actual PostgreSQL, not a synthetic contributor array alone.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { startPostgres } from '../node/local-postgres.mjs';
import { migrate } from '../node/db.ts';
import { CharacterStore, CharacterStoreError } from './character-store.ts';
import { acquireHostOwnership } from './ownership.ts';
import { PersistenceCoordinator } from './persistence-coordinator.ts';
import { createCoreCharacterCodec, prepareRestore } from '../../src/sim/persistence.ts';
import { createWorld1Definition } from '../../src/sim/areas/world1.ts';
import { worldArea, flatWorld, addActor, tick } from '../../tests/core/worldHarness.mjs';
import { xpForLevel } from '../../src/sim/data/progression.ts';

const identity = { schema: 'world-identity-v1', classId: 'warrior', archetype: 'human', appearance: { race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'OutcomeFixture' } };
const codec = createCoreCharacterCodec({ identities: [{ classId: 'warrior', archetype: 'human' }], freshLocation: { x: 0, y: 0, z: 0, yaw: 0 } });
// Explicit test resource budgets, NOT an eligibility cap or approved deployment setting.
const resources = { maxEntries: 1024, maxPayloadBytes: 4 * 1024 * 1024, timeoutMs: 5000 };
const preserve = { version: 'test-explicit-preserve', restore: checkpoint => checkpoint };

for (const [profile, world, level, rewardXp, rewardCoins] of [['eclipse', 'w2', 20, 5000, 1200], ['dawn', 'w3', 100, 100000, 5000]]) {
  test(`actual ${profile} blessing grant and checkpoint survive PostgreSQL save and fresh Area restore`, async () => {
    const record = await character(), source = worldArea(`durable-blessing-${profile}`, world), destination = worldArea(`restored-blessing-${profile}`, world);
    try {
      // Trusted level/story fixture isolates new canonical boss rewards and persistence composition.
      const actor = addActor(source, record.characterId, 'warrior'); actor.p.gainXp(xpForLevel(level));
      Object.assign(actor.p.state.flags, { rustCleared: true, abyssCleared: true, trueCleared: true });
      const boss = source.services.bossByProfile(profile); boss.wake(); tick(source, 74);
      const beforeXp = actor.p.state.xp; source.services.combat.damage(actor.ref, boss.unit, 1e8);
      assert.equal(actor.p.state.xp - beforeXp, rewardXp); assert.equal(actor.p.state.coins, rewardCoins);
      const pending = source.pendingGrants(); assert.equal(pending.length, 1);
      assert(pending[0].grant.objectives.some(o => o.kind === 'boss-xp-blessing'));
      const grant = pending[0].grant, payload = codec.grantToJson(grant);
      await store.recordVictimOutcome([{ accountId: record.accountId, characterId: record.characterId, id: grant.id, payload }], resources);
      const capture = source.capturePlayerCheckpoint(actor.ref);
      assert.equal(capture.checkpoint.survival.cooldowns['boss-xp-blessing'].endRemaining, 600);
      const saved = await store.saveCheckpoint(record.accountId, record.characterId, record.revision, capture.checkpoint, capture.appliedGrantIds);
      source.markCheckpointDurable(capture.captureId, saved.revision, capture.appliedGrantIds); source.acknowledgeGrant(grant.id);
      const recovered = await store.loadForRecovery(record.accountId, record.characterId, [grant.id]);
      assert.equal(recovered.grants[0].appliedRevision, saved.revision);
      const checkpoint = codec.toCore(recovered.character.checkpoint), admission = destination.reserveAdmission(record.characterId, 'spawn', 0);
      const staged = destination.stageRestoredArrival(admission, checkpoint, prepareRestore(checkpoint, 0, preserve)), ref = destination.activateRestoredArrival(staged.token);
      const restored = destination.services.player(ref); assert.equal(restored.state.xp, saved.checkpoint.progress.xp);
      const restoredXp = restored.state.xp; restored.gainXp(100); assert.equal(restored.state.xp - restoredXp, 150);
      assert.equal((await store.pendingGrants(record.accountId, record.characterId)).length, 0);
    } finally { for (const pending of source.pendingGrants()) source.acknowledgeGrant(pending.grant.id); source.dispose(); destination.dispose(); }
  });
}
// Pool.end() can resolve before its clients emit end; PG must remain alive through both boundaries.
const poolState = new WeakMap();
function testPool(connectionString) {
  const result = new pg.Pool({ connectionString }), state = { clients: new Set(), closing: null };
  poolState.set(result, state);
  result.on('connect', client => { state.clients.add(client); client.once('end', () => state.clients.delete(client)); });
  return result;
}
function closePool(result) {
  if (!result) return Promise.resolve();
  const state = poolState.get(result);
  if (!state.closing) { const disconnected = [...state.clients].map(client => once(client, 'end')); state.closing = Promise.all([result.end(), ...disconnected]); }
  return state.closing;
}
const storeError = code => e => e instanceof CharacterStoreError && e.code === code;
let cluster, pool, store, accountSequence = 1;
before(async () => {
  try { cluster = await startPostgres(); pool = testPool(cluster.url); await migrate(pool); store = new CharacterStore(pool, codec); }
  catch (e) { await closePool(pool); cluster?.stop(); throw e; }
});
after(async () => { try { await closePool(pool); } finally { cluster?.stop(); } });
async function character() {
  const accountId = 'g' + (accountSequence++).toString(16).padStart(23, '0');
  await pool.query("INSERT INTO accounts(username,save,updated,created) VALUES($1,'{}',1,1)", [accountId]);
  return store.create(accountId, identity);
}
const entry = (c, area = 'fixture-outcome', id = 1, xp = 20) => {
  const victim = { area, id, life: 1 }, grantId = JSON.stringify([area, id, 1, c.characterId]);
  return { accountId: c.accountId, characterId: c.characterId, id: grantId, payload: { id: grantId, victim, recipient: c.characterId, xp, coins: 5, objectives: [], flags: [] } };
};
const keyOf = e => JSON.stringify([e.payload.victim.area, e.payload.victim.id, e.payload.victim.life]);
async function count(outcome) {
  const prefix = outcome.slice(0, -1) + ',';
  return (await pool.query('SELECT (SELECT count(*) FROM world_victim_outcomes WHERE outcome_key=$1)::int AS seals,(SELECT count(*) FROM world_character_grants WHERE left(grant_id,length($2))=$2)::int AS grants', [outcome, prefix])).rows[0];
}
async function until(check, timeout = 3000) { const end = Date.now() + timeout; while (!await check()) { if (Date.now() >= end) throw new Error('condition timeout'); await new Promise(r => setTimeout(r, 5)); } }

test('101 lifetime contributors with at most100 concurrent real Area owners all receive full durable reward exactly once', { timeout: 20000 }, async () => {
  const records = await Promise.all(Array.from({ length: 101 }, character));
  // Real configured level20 scrapling has >101 HP. All contributions use actual positive integer Combat.damage.
  const definition = createWorld1Definition({ query: flatWorld, personalProps: flatWorld, fixedLevels: { scrapling: 20, scavenger: 20, jellyfish: 20, echo: 20 }, population: { scrapling: 1, scavenger: 0, jellyfish: 0 } });
  const source = worldArea('lifetime-101-source', 'w1', { definition }), destination = worldArea('lifetime-offline-return');
  let peak = 0, barrier;
  try {
    const victim = [...source.enemies.values()][0]; assert(source.services.getUnit(victim.unit).hp > 101);
    const actors = records.slice(0, 100).map(record => { const actor = addActor(source, record.characterId, 'warrior'); peak = Math.max(peak, source.players.size); return actor; });
    for (const actor of actors) assert(source.services.combat.damage(actor.ref, victim.unit, 1) >= 1);
    // One contributor leaves without losing its lifetime eligibility, opening the100th simultaneous slot.
    const retirement = source.quiescePlayer(actors[0].ref, 'offline-fixture');
    const left = await store.saveCheckpoint(records[0].accountId, records[0].characterId, 0, retirement.capture.checkpoint, retirement.capture.appliedGrantIds);
    source.markCheckpointDurable(retirement.capture.captureId, left.revision, retirement.capture.appliedGrantIds); source.commitPlayerRetirement(retirement.token); records[0] = left;
    const last = addActor(source, records[100].characterId, 'warrior'); peak = Math.max(peak, source.players.size);
    assert.equal(source.players.size, 100); assert(source.services.combat.damage(last.ref, victim.unit, 1) >= 1);
    source.services.combat.damage(last.ref, victim.unit, source.services.getUnit(victim.unit).hp);
    const pending = source.pendingGrants(); assert.equal(pending.length, 101); assert.equal(peak, 100);
    assert(pending.every(p => p.grant.xp === 248 && p.grant.coins === 62), 'every contributor receives the full configured level20 reward');
    assert.equal(pending.filter(g => !g.appliedHere).length, 1);
    const entries = await Promise.all(pending.map(async p => ({ accountId: await store.getOwner(p.grant.recipient), characterId: p.grant.recipient, id: p.grant.id, payload: codec.grantToJson(p.grant) })));
    const outcome = keyOf(entries[0]); barrier = source.beginDurabilityBarrier('complete-victim-outcome');
    await assert.rejects(store.recordGrantBatch(entries), storeError('invalid'));
    await assert.rejects(store.recordVictimOutcome(entries, { ...resources, maxEntries: 100 }), storeError('resource_limit'));
    await assert.rejects(store.recordVictimOutcome(entries, { ...resources, maxPayloadBytes: 1 }), storeError('resource_limit'));
    assert.deepEqual(await count(outcome), { seals: 0, grants: 0 }); assert.equal(source.pendingGrants().length, 101);
    // A mid-insert failure rolls back BOTH the seal and every recipient, without ACKing the source.
    const failId = entries.slice().sort((a, b) => a.id < b.id ? -1 : 1)[50].characterId;
    await pool.query(`CREATE FUNCTION fail_whole_victim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.character_id::text=TG_ARGV[0] THEN RAISE EXCEPTION 'whole victim midpoint failure'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER fail_whole_victim BEFORE INSERT ON world_character_grants_physical FOR EACH ROW EXECUTE FUNCTION fail_whole_victim('${failId}')`);
    try { await assert.rejects(store.recordVictimOutcome(entries, resources), /midpoint failure/); }
    finally { await pool.query('DROP TRIGGER fail_whole_victim ON world_character_grants_physical; DROP FUNCTION fail_whole_victim()'); }
    assert.deepEqual(await count(outcome), { seals: 0, grants: 0 }); assert.equal(source.pendingGrants().length, 101);
    const grants = await store.recordVictimOutcome(entries, resources); assert.equal(grants.length, 101);
    assert.deepEqual(await count(outcome), { seals: 1, grants: 101 });
    assert.equal((await pool.query('SELECT recipient_count FROM world_victim_outcomes WHERE outcome_key=$1', [outcome])).rows[0].recipient_count, '101');
    assert.deepEqual(await store.recordVictimOutcome([...entries].reverse(), resources), [...grants].reverse());
    await assert.rejects(store.recordVictimOutcome(entries.slice(0, -1), resources), storeError('outcome_conflict'));
    await assert.rejects(store.recordVictimOutcome(entries.map((e, i) => i ? e : { ...e, payload: { ...e.payload, xp: e.payload.xp + 1 } }), resources), storeError('outcome_conflict'));
    // Locally applied grants are captured directly; there is no receiveGrant reapply for these100 owners.
    for (const p of pending.filter(p => p.appliedHere)) {
      const actor = source.services.playerByCharacter(p.grant.recipient), record = records.find(c => c.characterId === p.grant.recipient), capture = source.capturePlayerCheckpoint(actor.state.unit);
      assert.equal(capture.checkpoint.progress.xp, p.grant.xp); assert.equal(capture.checkpoint.progress.coins, p.grant.coins);
      const saved = await store.saveCheckpoint(record.accountId, record.characterId, record.revision, capture.checkpoint, capture.appliedGrantIds);
      source.markCheckpointDurable(capture.captureId, saved.revision, capture.appliedGrantIds);
    }
    const offline = pending.find(p => !p.appliedHere), record = records[0];
    assert.equal((await store.pendingGrants(record.accountId, record.characterId)).length, 1);
    const admission = destination.reserveAdmission(record.characterId, 'spawn', 0), checkpoint = codec.toCore(record.checkpoint);
    const staged = destination.stageRestoredArrival(admission, checkpoint, prepareRestore(checkpoint, 0, preserve)), ref = destination.activateRestoredArrival(staged.token);
    assert.equal(destination.receiveGrant(offline.grant), 'applied'); assert.equal(destination.receiveGrant(offline.grant), 'duplicate');
    const capture = destination.capturePlayerCheckpoint(ref), saved = await store.saveCheckpoint(record.accountId, record.characterId, record.revision, capture.checkpoint, capture.appliedGrantIds);
    destination.markCheckpointDurable(capture.captureId, saved.revision, capture.appliedGrantIds);
    // New store/pool after a simulated lost ACK reads101 complete receipts; no XP/coin reapplication.
    const reconnectPool = testPool(cluster.url);
    try {
      const reconnect = new CharacterStore(reconnectPool, codec);
      for (const e of entries) {
        const restored = await reconnect.loadForRecovery(e.accountId, e.characterId, [e.id]);
        assert(restored.grants[0].appliedRevision !== null); assert.equal(restored.character.checkpoint.progress.xp, e.payload.xp); assert.equal(restored.character.checkpoint.progress.coins, e.payload.coins);
        assert.deepEqual(await reconnect.pendingGrants(e.accountId, e.characterId), []);
      }
      assert.equal((await reconnect.recordVictimOutcome(entries, resources)).length, 101);
    } finally { await closePool(reconnectPool); }
    assert.equal((await pool.query('SELECT count(*)::int n FROM world_character_grant_receipts WHERE grant_id=ANY($1::text[])', [entries.map(e => e.id)])).rows[0].n, 101);
    for (const p of pending) source.acknowledgeGrant(p.grant.id);
    source.releaseDurabilityBarrier(barrier); barrier = undefined; assert.equal(source.pendingGrants().length, 0);
  } finally {
    if (barrier) source.releaseDurabilityBarrier(barrier);
    // Failure does not silently ACK/dispose earned source data; the test cluster is still cleaned up by after().
    if (!source.pendingGrants().length) source.dispose(); destination.dispose();
  }
});

test('outcome seals reject subset/extension, unsealed legacy rows and mixed victims while preserving old API retries', async () => {
  const a = await character(), b = await character(), c = await character(), entries = [entry(a, 'seal-fixture'), entry(b, 'seal-fixture')];
  await store.recordVictimOutcome(entries, resources);
  await assert.rejects(store.recordVictimOutcome([...entries, entry(c, 'seal-fixture')], resources), storeError('outcome_conflict'));
  await assert.rejects(store.recordGrantBatch([entry(c, 'seal-fixture')]), storeError('outcome_conflict'));
  assert.equal((await store.recordGrant(entries[0].accountId, entries[0].characterId, entries[0].id, entries[0].payload)).id, entries[0].id);
  await assert.rejects(store.recordVictimOutcome([entries[0], entry(c, 'other-victim')], resources), storeError('invalid'));
  const legacy = [entry(a, 'unsealed-fixture'), entry(b, 'unsealed-fixture')]; await store.recordGrantBatch([legacy[0]]);
  await assert.rejects(store.recordVictimOutcome(legacy, resources), storeError('outcome_conflict'));
  assert.deepEqual(await count(keyOf(legacy[0])), { seals: 0, grants: 1 });
  const outcome = keyOf(entries[0]); for (const sql of ['UPDATE world_victim_outcomes SET recipient_count=recipient_count WHERE outcome_key=$1', 'DELETE FROM world_victim_outcomes WHERE outcome_key=$1']) await assert.rejects(pool.query(sql, [outcome]), /immutable/);
  for (const policy of [undefined, { ...resources, timeoutMs: 0 }, { ...resources, maxEntries: Infinity }]) await assert.rejects(store.recordVictimOutcome(entries, policy), storeError('invalid'));
});

test('outcome lock timeout leaves no seal or grants and can retry the complete capture', async () => {
  const a = await character(), e = entry(a, 'outcome-timeout'), outcome = keyOf(e);
  const lock = createHash('sha256').update('world-victim-outcome:' + outcome).digest().readBigInt64BE().toString(), blocker = await pool.connect();
  try {
    await blocker.query('SELECT pg_advisory_lock($1::bigint)', [lock]);
    await assert.rejects(store.recordVictimOutcome([e], { ...resources, timeoutMs: 40 }), /timeout|deadline/);
    assert.deepEqual(await count(outcome), { seals: 0, grants: 0 });
  } finally { await blocker.query('SELECT pg_advisory_unlock($1::bigint)', [lock]); blocker.release(); }
  assert.equal((await store.recordVictimOutcome([e], resources)).length, 1);
});

test('actual guard loss during an actual blocked PG write suppresses publication; newer authority survives stale completion/retry', { timeout: 10000 }, async () => {
  const c = await character(), first = entry(c, 'inflight-first'), second = entry(c, 'inflight-second');
  await store.recordVictimOutcome([first], resources); await store.recordVictimOutcome([second], resources);
  const ownershipKey = 'outcome-inflight-host', lock = BigInt.asUintN(64, createHash('sha256').update(ownershipKey).digest().readBigInt64BE());
  const firstGuard = await acquireHostOwnership(pool, ownershipKey), gate = await pool.connect(); let secondGuard, work;
  const gateKey = 93921471;
  try {
    await gate.query('SELECT pg_advisory_lock($1::bigint)', [gateKey]);
    await pool.query(`CREATE FUNCTION hold_inflight_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.character_id::text=TG_ARGV[0] THEN PERFORM pg_advisory_xact_lock(TG_ARGV[1]::bigint); END IF; RETURN NEW; END; $$;
      CREATE TRIGGER hold_inflight_checkpoint BEFORE UPDATE ON world_characters FOR EACH ROW EXECUTE FUNCTION hold_inflight_checkpoint('${c.characterId}','${gateKey}')`);
    const coordinator = new PersistenceCoordinator(store, firstGuard, { maxQueuedPerCharacter: 1, maxAttempts: 1, retryMs: 0, now: () => performance.now() });
    let published = 0;
    work = coordinator.commit({ captureId: 'old-capture', accountId: c.accountId, characterId: c.characterId, expectedRevision: 0, checkpoint: { ...c.checkpoint, progress: { ...c.checkpoint.progress, xp: 20, coins: 5 } }, appliedGrantIds: [first.id] }).then(result => { if (result.kind === 'saved') published++; return result; });
    await until(async () => (await pool.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted AND classid=0 AND objid=$1::oid", [String(gateKey)])).rowCount > 0);
    const pid = (await pool.query("SELECT pid FROM pg_locks WHERE locktype='advisory' AND granted AND classid=$1::oid AND objid=$2::oid AND objsubid=1", [(lock >> 32n).toString(), (lock & 0xffffffffn).toString()])).rows[0].pid;
    await pool.query('SELECT pg_terminate_backend($1)', [pid]); await until(() => firstGuard.closed.aborted);
    secondGuard = await acquireHostOwnership(pool, ownershipKey); secondGuard.assertOwned();
    await gate.query('SELECT pg_advisory_unlock($1::bigint)', [gateKey]);
    assert.deepEqual(await work, { kind: 'unresolved', captureId: 'old-capture', reason: 'ownership' }); assert.equal(published, 0);
    // Abort did NOT fence the independent DB transaction: it committed complete state+receipt, but was not published.
    const durableOld = await store.loadForRecovery(c.accountId, c.characterId, [first.id]); assert.equal(durableOld.character.revision, 1); assert.equal(durableOld.grants[0].appliedRevision, 1);
    const fresh = await store.saveCheckpoint(c.accountId, c.characterId, 1, { ...durableOld.character.checkpoint, progress: { ...durableOld.character.checkpoint.progress, xp: 40, coins: 10 } }, [second.id]);
    await assert.rejects(store.saveCheckpoint(c.accountId, c.characterId, 0, c.checkpoint), storeError('conflict'));
    assert.equal((await coordinator.commit({ captureId: 'old-late', accountId: c.accountId, characterId: c.characterId, expectedRevision: fresh.revision, checkpoint: c.checkpoint, appliedGrantIds: [] })).kind, 'unresolved');
    assert.deepEqual(await store.getOwned(c.accountId, c.characterId), fresh); assert.equal(fresh.checkpoint.progress.xp, 40);
  } finally {
    await gate.query('SELECT pg_advisory_unlock($1::bigint)', [gateKey]).catch(() => {}); gate.release(); await work?.catch(() => {});
    await pool.query('DROP TRIGGER IF EXISTS hold_inflight_checkpoint ON world_characters; DROP FUNCTION IF EXISTS hold_inflight_checkpoint()'); await firstGuard.release(); await secondGuard?.release();
  }
});

test('migration005 preserves existing account/save and all004 character/grant/receipt rows and reruns cleanly', async () => {
  await pool.query('CREATE DATABASE victim_pre005'); const url = new URL(cluster.url); url.pathname = '/victim_pre005'; const legacy = testPool(url.href);
  try {
    await legacy.query('CREATE TABLE schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const version of ['001_accounts', '002_google_only', '003_chat_reports', '004_world_characters']) {
      await legacy.query(await readFile(new URL(`../node/migrations/${version}.sql`, import.meta.url), 'utf8')); await legacy.query('INSERT INTO schema_migrations(version) VALUES($1)', [version]);
    }
    const accountId = 'g' + 'f'.repeat(23); await legacy.query("INSERT INTO accounts(username,save,revision,updated,created) VALUES($1,'{\"legacy\":true}',47,123,100)", [accountId]);
    const legacyStore = new CharacterStore(legacy, codec), c = await legacyStore.create(accountId, identity), e = entry(c, 'prior005');
    await legacy.query('INSERT INTO world_character_grants(grant_id,character_id,account_id,codec_version,payload_json) VALUES($1,$2,$3,1,$4)', [e.id, c.characterId, accountId, JSON.stringify(e.payload)]);
    await legacy.query('INSERT INTO world_character_grant_receipts(grant_id,character_id,applied_revision) VALUES($1,$2,1)', [e.id, c.characterId]);
    const tables = ['accounts', 'world_characters', 'world_character_grants', 'world_character_grant_receipts'], before = await Promise.all(tables.map(t => legacy.query(`SELECT * FROM ${t}`)));
    assert.deepEqual(await migrate(legacy), ['005_world_victim_outcomes', '006_world_chat', '007_world_paged_ledger', '008_world_dungeon_awards']); assert.deepEqual(await migrate(legacy), []);
    const after = await Promise.all(tables.map(t => legacy.query(`SELECT * FROM ${t}`))); assert.deepEqual(after.map(r => r.rows), before.map(r => r.rows));
  } finally { await closePool(legacy); await pool.query('DROP DATABASE victim_pre005'); }
});

test('independent pools serialize equal whole outcomes and concurrent legacy writes never seal a partial set', async () => {
  const a = await character(), b = await character(), secondPool = testPool(cluster.url);
  try {
    const second = new CharacterStore(secondPool, codec), entries = [entry(a, 'outcome-race'), entry(b, 'outcome-race')];
    const [forward, reverse] = await Promise.all([store.recordVictimOutcome(entries, resources), second.recordVictimOutcome([...entries].reverse(), resources)]);
    assert.deepEqual(forward, [...reverse].reverse()); assert.deepEqual(await count(keyOf(entries[0])), { seals: 1, grants: 2 });
    const mixed = [entry(a, 'outcome-legacy-race'), entry(b, 'outcome-legacy-race')];
    const [whole, legacy] = await Promise.allSettled([store.recordVictimOutcome(mixed, resources), second.recordGrantBatch([mixed[0]])]);
    assert.equal(legacy.status, 'fulfilled');
    if (whole.status === 'fulfilled') assert.deepEqual(await count(keyOf(mixed[0])), { seals: 1, grants: 2 });
    else { assert.equal(whole.reason.code, 'outcome_conflict'); assert.deepEqual(await count(keyOf(mixed[0])), { seals: 0, grants: 1 }); }
  } finally { await closePool(secondPool); }
});
