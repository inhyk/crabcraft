// Real throwaway Postgres only. The tiny codec below is a test fixture, never a production projection.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { startPostgres } from '../node/local-postgres.mjs';
import { migrate } from '../node/db.ts';
import { CharacterStore, CharacterStoreError, MAX_GRANT_BATCH_ENTRIES, MAX_CHECKPOINT_GRANT_RECEIPTS } from './character-store.ts';

const A = 'g' + 'a'.repeat(23), B = 'g' + 'b'.repeat(23);
const identity = { classId: 'test-warrior', appearance: { shell: 2 } };
function testCodec() {
  return {
    version: 1,
    validateIdentity(v) {
      assert.deepEqual(v, identity); return v;
    },
    fresh() { return { level: 1, xp: 0, coins: 0, mode: 'alive' }; },
    validateCheckpoint(v) {
      assert(v && Object.keys(v).sort().join(',') === 'coins,level,mode,xp');
      for (const key of ['level', 'xp', 'coins']) assert(Number.isSafeInteger(v[key]) && v[key] >= 0);
      assert(v.level >= 1 && ['alive', 'dead', 'seated', 'village'].includes(v.mode)); return v;
    },
    validateGrant(v) { assert(v && Object.keys(v).sort().join(',') === 'coins,xp'); assert(Number.isSafeInteger(v.xp) && v.xp >= 0 && Number.isSafeInteger(v.coins) && v.coins >= 0); return v; },
  };
}
let postgres, pool, store;
const liveClients = new Set();
async function closeMainPool() {
  // pg-pool end() can resolve after removing idle clients, before their sockets end.
  // Await the public client end events before stopping the throwaway cluster.
  const closed = [...liveClients].map(client => once(client, 'end'));
  await pool?.end();
  await Promise.all(closed);
}
before(async () => {
  try {
    postgres = await startPostgres(); pool = new pg.Pool({ connectionString: postgres.url });
    pool.on('connect', client => {
      liveClients.add(client);
      client.once('end', () => liveClients.delete(client));
    });
    // Start with actual existing schema and account data, then apply only the new additive migration.
    await pool.query('CREATE TABLE schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const version of ['001_accounts', '002_google_only', '003_chat_reports']) {
      await pool.query(await readFile(new URL(`../node/migrations/${version}.sql`, import.meta.url), 'utf8'));
      await pool.query('INSERT INTO schema_migrations(version) VALUES($1)', [version]);
    }
    await pool.query(`INSERT INTO accounts(username,save,revision,updated,created) VALUES($1,$3,47,123,100),($2,'{}',0,1,1)`, [A, B, '{"legacyXP":999999}']);
    const existingAccount = (await pool.query('SELECT * FROM accounts WHERE username=$1', [A])).rows[0];
    assert.deepEqual(await migrate(pool), ['004_world_characters', '005_world_victim_outcomes', '006_world_chat', '007_world_paged_ledger', '008_world_dungeon_awards']);
    assert.deepEqual((await pool.query('SELECT * FROM accounts WHERE username=$1', [A])).rows[0], existingAccount);
    assert.deepEqual(await migrate(pool), []);
    assert.equal((await pool.query('SELECT save FROM accounts WHERE username=$1', [A])).rows[0].save, '{"legacyXP":999999}');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM world_characters')).rows[0].n, 0);
    store = new CharacterStore(pool, testCodec());
  } catch (e) { await closeMainPool(); postgres?.stop(); throw e; }
});
after(async () => { try { await closeMainPool(); assert.equal(liveClients.size, 0); } finally { postgres?.stop(); } });
const error = code => e => e instanceof CharacterStoreError && e.code === code;
const fresh = () => store.create(A, identity);
const grant = (c, id, xp = 10) => store.recordGrant(A, c.characterId, id, { xp, coins: 2 });

test('requires explicit codec, valid appearance/class and existing Google account; fresh ignores old save', async () => {
  assert.throws(() => new CharacterStore(pool), error('invalid'));
  assert.throws(() => new CharacterStore(pool, { ...testCodec(), validateCheckpoint: undefined }), error('invalid'));
  await assert.rejects(store.create('guest', identity), error('invalid'));
  await assert.rejects(store.create('g' + 'c'.repeat(23), identity), /foreign key/);
  await assert.rejects(store.create(A, { ...identity, classId: 'unknown' }));
  const c = await fresh(); assert.match(c.characterId, /^[a-f0-9-]{36}$/); assert.equal(c.revision, 0);
  assert(Number.isSafeInteger(c.updatedAt) && c.updatedAt > 0 && c.updatedAt <= Date.now());
  assert.deepEqual(c.checkpoint, { level: 1, xp: 0, coins: 0, mode: 'alive' });
  assert.equal((await pool.query('SELECT save FROM accounts WHERE username=$1', [A])).rows[0].save, '{"legacyXP":999999}');
});

test('account ownership applies to read, journal, pending and CAS save; global character IDs differ', async () => {
  const c = await fresh(), other = await store.create(B, identity); assert.notEqual(c.characterId, other.characterId);
  for (const operation of [() => store.getOwned(B, c.characterId), () => store.recordGrant(B, c.characterId, 'ownership', { xp: 1, coins: 0 }),
    () => store.pendingGrants(B, c.characterId), () => store.saveCheckpoint(B, c.characterId, 0, c.checkpoint)]) await assert.rejects(operation(), error('not_found'));
  assert((await store.listOwned(B)).every(row => row.accountId === B));
});

test('journal records survive a new pool; identical semantic payload retries are idempotent; mismatches reject', async () => {
  const c = await fresh(), first = await grant(c, 'durable:grant');
  const second = await store.recordGrant(A, c.characterId, first.id, { coins: 2, xp: 10 }); assert.deepEqual(second, first);
  const reconnect = new pg.Pool({ connectionString: postgres.url });
  try { assert.deepEqual(await new CharacterStore(reconnect, testCodec()).pendingGrants(A, c.characterId), [first]); }
  finally { await reconnect.end(); }
  await assert.rejects(grant(c, first.id, 11), error('grant_mismatch'));
  const other = await fresh(); await assert.rejects(grant(other, first.id), error('grant_mismatch'));
  const b = await store.create(B, identity); await assert.rejects(store.recordGrant(B, b.characterId, first.id, { xp: 10, coins: 2 }), error('grant_mismatch'));
});

test('CAS checkpoint and receipts commit together, reject repeated numeric apply, and retain immutable grant journal', async () => {
  const c = await fresh(), earned = await grant(c, 'atomic:grant');
  const saved = await store.saveCheckpoint(A, c.characterId, 0, { ...c.checkpoint, xp: 10, coins: 2 }, [earned.id]);
  assert.equal(saved.revision, 1); assert.equal(saved.checkpoint.xp, 10); assert.deepEqual(await store.pendingGrants(A, c.characterId), []);
  await assert.rejects(store.saveCheckpoint(A, c.characterId, 0, saved.checkpoint, [earned.id]), error('conflict'));
  await assert.rejects(store.saveCheckpoint(A, c.characterId, 1, { ...saved.checkpoint, xp: 20 }, [earned.id]), error('already_applied'));
  const rows = await pool.query('SELECT * FROM world_character_grants WHERE grant_id=$1', [earned.id]); assert.equal(rows.rowCount, 1);
  assert.equal((await pool.query('SELECT applied_revision FROM world_character_grant_receipts WHERE grant_id=$1', [earned.id])).rows[0].applied_revision, '1');
  for (const sql of ['UPDATE world_character_grants SET payload_json=payload_json WHERE grant_id=$1', 'DELETE FROM world_character_grants WHERE grant_id=$1', 'DELETE FROM world_character_grant_receipts WHERE grant_id=$1']) await assert.rejects(pool.query(sql, [earned.id]), /immutable/);
});

test('receipt insertion DB failure rolls back checkpoint and all receipts; exact checkpoint retry works', async () => {
  const c = await fresh(), first = await grant(c, 'rollback:first'), second = await grant(c, 'rollback:second');
  await pool.query(`CREATE FUNCTION test_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.grant_id='rollback:second' THEN RAISE EXCEPTION 'injected receipt failure'; END IF; RETURN NEW; END; $$;
    CREATE TRIGGER test_receipt_failure BEFORE INSERT ON world_character_grant_receipts FOR EACH ROW EXECUTE FUNCTION test_receipt_failure()`);
  const checkpoint = { ...c.checkpoint, xp: 20, coins: 4 };
  try { await assert.rejects(store.saveCheckpoint(A, c.characterId, 0, checkpoint, [first.id, second.id]), /injected receipt failure/); }
  finally { await pool.query('DROP TRIGGER test_receipt_failure ON world_character_grant_receipts; DROP FUNCTION test_receipt_failure()'); }
  assert.deepEqual(await store.getOwned(A, c.characterId), c);
  assert.equal((await store.pendingGrants(A, c.characterId)).length, 2);
  const retried = await store.saveCheckpoint(A, c.characterId, 0, checkpoint, [first.id, second.id]);
  assert.deepEqual(retried.checkpoint, checkpoint); assert.equal(retried.revision, 1);
});

test('missing, foreign-recipient and duplicate receipt IDs never advance checkpoint', async () => {
  const c = await fresh(), other = await fresh(); await grant(other, 'foreign:grant');
  for (const ids of [['missing:grant'], ['foreign:grant'], ['duplicate', 'duplicate']]) await assert.rejects(store.saveCheckpoint(A, c.characterId, 0, c.checkpoint, ids));
  assert.deepEqual(await store.getOwned(A, c.characterId), c);
});

test('two independent pools racing CAS yield one committed revision and one conflict', async () => {
  const c = await fresh(), secondPool = new pg.Pool({ connectionString: postgres.url });
  try {
    const secondStore = new CharacterStore(secondPool, testCodec());
    const results = await Promise.allSettled([store.saveCheckpoint(A, c.characterId, 0, { ...c.checkpoint, xp: 1 }), secondStore.saveCheckpoint(A, c.characterId, 0, { ...c.checkpoint, xp: 2 })]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.code, 'conflict');
    assert.equal((await store.getOwned(A, c.characterId)).revision, 1);
  } finally { await secondPool.end(); }
});

test('separate Node processes racing the same earned grant commit one durable journal entry', { timeout: 10000 }, async () => {
  const c = await fresh();
  const source = `import pg from 'pg'; import { CharacterStore } from ${JSON.stringify(new URL('./character-store.ts', import.meta.url).href)};
    const pool=new pg.Pool({connectionString:process.env.TEST_PG_URL});
    const codec={version:1,validateIdentity:v=>v,fresh:()=>({}),validateCheckpoint:v=>v,validateGrant:v=>v};
    try { const s=new CharacterStore(pool,codec); await s.recordGrant(${JSON.stringify(A)},${JSON.stringify(c.characterId)},'cross-process',{xp:10,coins:2}); }
    finally {await pool.end();}`;
  const children = [0, 1].map(() => spawn(process.execPath, ['--input-type=module', '-e', source], { env: { ...process.env, TEST_PG_URL: postgres.url }, stdio: ['ignore', 'ignore', 'pipe'] }));
  try {
    const results = await Promise.all(children.map(async child => { let stderr = ''; child.stderr.on('data', d => stderr += d); const [code] = await once(child, 'exit'); assert.equal(code, 0, stderr); }));
    assert.equal(results.length, 2); assert.equal((await store.pendingGrants(A, c.characterId)).length, 1);
  } finally { for (const child of children) if (child.exitCode === null) child.kill('SIGKILL'); }
});

test('pending grants and character lists page without pruning or truncating the durable journal', async () => {
  const c = await fresh(); for (let i = 0; i < 5; i++) await grant(c, `page:${i}`);
  const first = await store.pendingGrants(A, c.characterId, { limit: 2 }), second = await store.pendingGrants(A, c.characterId, { limit: 2, after: first.at(-1).sequence }), third = await store.pendingGrants(A, c.characterId, { after: second.at(-1).sequence });
  assert.equal(new Set([...first, ...second, ...third].map(g => g.id)).size, 5);
  await store.saveCheckpoint(A, c.characterId, 0, { ...c.checkpoint, xp: 20, coins: 4 }, first.map(g => g.id));
  assert.equal((await store.pendingGrants(A, c.characterId)).length, 3);
  const chars = await store.listOwned(A, { limit: 1 }), next = await store.listOwned(A, { limit: 1, after: chars[0].characterId });
  assert.equal(chars.length, 1); assert.equal(next.length, 1); assert.notEqual(chars[0].characterId, next[0].characterId);
  for (const options of [{ limit: 0 }, { limit: 101 }, { after: '9223372036854775808' }]) await assert.rejects(store.pendingGrants(A, c.characterId, options), error('invalid'));
});

test('finite bounded strict JSON rejects invalid state before any persistence', async () => {
  const c = await fresh(), permissive = new CharacterStore(pool, { ...testCodec(), validateCheckpoint: v => v, validateGrant: v => v });
  const cycle = {}; cycle.self = cycle;
  for (const value of [NaN, Infinity, undefined, 1n, new Date(), cycle, { omitted: undefined }, [undefined], Array(1), { a: 'x'.repeat(262145) }, { get x() { throw new Error('must not invoke getter'); } }]) await assert.rejects(permissive.saveCheckpoint(A, c.characterId, 0, value), error('invalid'));
  for (const value of [{ a: 'x'.repeat(16385) }, { xp: NaN }]) await assert.rejects(permissive.recordGrant(A, c.characterId, 'oversized', value), error('invalid'));
  let deep = {}; for (let i = 0; i < 34; i++) deep = { deep };
  await assert.rejects(permissive.saveCheckpoint(A, c.characterId, 0, deep), error('invalid'));
  await assert.rejects(store.saveCheckpoint(A, c.characterId, Number.MAX_SAFE_INTEGER, c.checkpoint), error('invalid'));
  assert.deepEqual(await store.getOwned(A, c.characterId), c);
});

test('codec version, corrupt rows and invalid checkpoint schema fail closed', async () => {
  const c = await fresh(); await assert.rejects(store.saveCheckpoint(A, c.characterId, 0, { xp: 1 }));
  await pool.query('UPDATE world_characters SET codec_version=2 WHERE character_id=$1', [c.characterId]);
  await assert.rejects(store.getOwned(A, c.characterId), error('version'));
  await pool.query("UPDATE world_characters SET codec_version=1,checkpoint_json='broken' WHERE character_id=$1", [c.characterId]);
  await assert.rejects(store.getOwned(A, c.characterId), error('invalid'));
  await pool.query('UPDATE world_characters SET checkpoint_json=$2 WHERE character_id=$1', [c.characterId, JSON.stringify(c.checkpoint)]);
  await pool.query("INSERT INTO world_character_grants(grant_id,character_id,account_id,codec_version,payload_json) VALUES('corrupt:grant',$1,$2,2,'{}')", [c.characterId, A]);
  await assert.rejects(store.pendingGrants(A, c.characterId), error('version'));
});

test('checkpoint codec can persist dead, seated and village states without treating transfer DTO as storage', async () => {
  let c = await fresh(); for (const mode of ['dead', 'seated', 'village']) c = await store.saveCheckpoint(A, c.characterId, c.revision, { ...c.checkpoint, mode });
  assert.equal((await store.getOwned(A, c.characterId)).checkpoint.mode, 'village');
});

test('lost source ACK recovery loads checkpoint and matching receipt ledger without reapplying numeric grant', async () => {
  const c = await fresh(), earned = await grant(c, 'lost-ack:grant');
  const committed = await store.saveCheckpoint(A, c.characterId, 0, { ...c.checkpoint, xp: 10, coins: 2 }, [earned.id]);
  // Source retries the immutable grant because the host died after DB commit but before its ACK.
  await grant(c, earned.id);
  const restored = await store.loadForRecovery(A, c.characterId, [earned.id]);
  assert.deepEqual(restored.character, committed); assert.equal(restored.grants[0].appliedRevision, 1);
  assert.equal(restored.character.checkpoint.xp, 10); assert.deepEqual(await store.pendingGrants(A, c.characterId), []);
  await assert.rejects(store.loadForRecovery(B, c.characterId, [earned.id]), error('not_found'));
  await assert.rejects(store.loadForRecovery(A, c.characterId, ['missing']), error('not_found'));
});

test('same grant retry compares JSON semantics even when original server journal text has different key order', async () => {
  const c = await fresh();
  await pool.query(`INSERT INTO world_character_grants(grant_id,character_id,account_id,codec_version,payload_json)
    VALUES('semantic:grant',$1,$2,1,'{ "xp": 10.0, "coins": 2 }')`, [c.characterId, A]);
  assert.equal((await grant(c, 'semantic:grant')).payload.xp, 10);
});

test('exact core JSON-tuple grant IDs support retry, ownership/content conflict and lost-ACK recovery', async () => {
  const c = await fresh();
  // Actual WorldRules ID format, with synthetic fixture values and no production core import.
  const id = JSON.stringify(['fixture:새벽-area', 17, 3, c.characterId]);
  const earned = await grant(c, id); assert.equal(earned.id, id);
  assert.deepEqual(await grant(c, id), earned);
  await assert.rejects(grant(c, id, 11), error('grant_mismatch'));
  const other = await fresh(); await assert.rejects(grant(other, id), error('grant_mismatch'));
  await assert.rejects(store.recordGrant(B, c.characterId, id, { xp: 10, coins: 2 }), error('not_found'));
  const b = await store.create(B, identity); await assert.rejects(store.recordGrant(B, b.characterId, id, { xp: 10, coins: 2 }), error('grant_mismatch'));
  assert.deepEqual((await store.loadForRecovery(A, c.characterId, [id])).grants.map(g => g.appliedRevision), [null]);
  await store.saveCheckpoint(A, c.characterId, 0, { ...c.checkpoint, xp: 10, coins: 2 }, [id]);
  await grant(c, id); const recovery = await store.loadForRecovery(A, c.characterId, [id]);
  assert.equal(recovery.grants[0].id, id); assert.equal(recovery.grants[0].appliedRevision, 1);
  assert.equal(recovery.character.checkpoint.xp, 10); assert.deepEqual(await store.pendingGrants(A, c.characterId), []);
});

test('UTF-8 grant ID bounds and C0/C1 controls agree across API and SQL constraints', async () => {
  const c = await fresh(), maxId = '🦀'.repeat(128); assert.equal(Buffer.byteLength(maxId), 512);
  assert.equal((await grant(c, maxId)).id, maxId);
  const rawInsert = id => pool.query(`INSERT INTO world_character_grants(grant_id,character_id,account_id,codec_version,payload_json)
    VALUES($1,$2,$3,1,'{"xp":10,"coins":2}')`, [id, c.characterId, A]);
  for (const id of ['', 'x'.repeat(513), '🦀'.repeat(129), 'newline\n', 'nul\0', 'tab\t', 'del\x7f', 'c1\u0085', 'c1last\u009f']) {
    await assert.rejects(grant(c, id), error('invalid'));
    await assert.rejects(rawInsert(id), /check constraint|invalid byte sequence/);
  }
  await assert.rejects(grant(c, '\ud800'), error('invalid'));
  const quoted = `SQL 'quotes'; $1 and \\backslash`;
  assert.equal((await grant(c, quoted)).id, quoted);
});

test('sparse arrays with out-of-range numeric properties reject without changing checkpoint or revision', async () => {
  const permissive = new CharacterStore(pool, { ...testCodec(), validateCheckpoint: v => v });
  let c = await permissive.create(A, identity);
  c = await permissive.saveCheckpoint(A, c.characterId, 0, { ...c.checkpoint, items: ['kept', { slots: [1, 2] }] });
  const before = (await pool.query('SELECT checkpoint_json,revision FROM world_characters WHERE character_id=$1', [c.characterId])).rows[0];
  for (const key of ['4294967295', '9007199254740993', '184467440737095516160000']) {
    const invalid = Array(1); invalid[key] = 'must not disappear';
    // This has one own numeric-looking property and length 1, but no real index 0.
    assert.equal(Object.keys(invalid).length, invalid.length); assert.equal(Object.hasOwn(invalid, 0), false);
    await assert.rejects(permissive.saveCheckpoint(A, c.characterId, c.revision, { ...c.checkpoint, items: invalid }), error('invalid'));
    assert.deepEqual((await pool.query('SELECT checkpoint_json,revision FROM world_characters WHERE character_id=$1', [c.characterId])).rows[0], before);
    assert.deepEqual(await permissive.getOwned(A, c.characterId), c);
  }
});

test('sparse arrays returned by checkpoint codec reject and roll back without changing durable state', async () => {
  const c = await fresh();
  const before = (await pool.query('SELECT checkpoint_json,revision FROM world_characters WHERE character_id=$1', [c.characterId])).rows[0];
  for (const key of ['4294967295', '9007199254740993', '184467440737095516160000']) {
    const invalid = Array(1); invalid[key] = 'codec output must not disappear';
    const codec = { ...testCodec(), validateCheckpoint(v) {
      // Decode of the current checkpoint remains valid; the next validated checkpoint introduces the sparse array.
      return v.xp === 1 ? { ...v, items: invalid } : v;
    } };
    const badOutput = new CharacterStore(pool, codec);
    await assert.rejects(badOutput.saveCheckpoint(A, c.characterId, 0, { ...c.checkpoint, xp: 1 }), error('invalid'));
    assert.deepEqual((await pool.query('SELECT checkpoint_json,revision FROM world_characters WHERE character_id=$1', [c.characterId])).rows[0], before);
    assert.deepEqual(await store.getOwned(A, c.characterId), c);
  }
});

test('one complete 100-contributor death commits and retries atomically with owner lookup and input-ordered results', async () => {
  assert.equal(MAX_GRANT_BATCH_ENTRIES, 100); assert.equal(MAX_CHECKPOINT_GRANT_RECEIPTS, 256);
  const characters = await Promise.all(Array.from({ length: 100 }, (_, i) => store.create(i % 2 ? B : A, identity)));
  const entries = characters.map(c => ({ accountId: c.accountId, characterId: c.characterId, id: JSON.stringify(['batch-death', 73, 1, c.characterId]), payload: { xp: 10, coins: 2 } })).reverse();
  const first = await store.recordGrantBatch(entries), retry = await store.recordGrantBatch(entries.map(e => ({ ...e, payload: { coins: 2, xp: 10 } })));
  assert.deepEqual(first.map(g => g.id), entries.map(e => e.id)); assert.deepEqual(retry, first);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM world_character_grants WHERE grant_id=ANY($1::text[])', [entries.map(e => e.id)])).rows[0].n, 100);
  assert.equal(await store.getOwner(characters[0].characterId), A); assert.equal(await store.getOwner(characters[1].characterId), B);
  await assert.rejects(store.getOwner('not-a-character'), error('invalid'));
  await assert.rejects(store.getOwner('00000000-0000-4000-8000-000000000000'), error('not_found'));
  assert.equal((await store.pendingGrants(first[0].accountId, first[0].characterId)).length, 1);
  assert.equal((await store.getOwned(characters[0].accountId, characters[0].characterId)).checkpoint.xp, 0);
});

test('mid-batch PostgreSQL failure rolls back the complete death and preserves retryable input', async () => {
  const a = await fresh(), b = await store.create(B, identity);
  const entries = [a, b].map((c, i) => ({ accountId: c.accountId, characterId: c.characterId, id: `batch-rollback:${i}`, payload: { xp: 10, coins: 2 } }));
  await pool.query(`CREATE FUNCTION test_batch_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.grant_id='batch-rollback:1' THEN RAISE EXCEPTION 'injected batch failure'; END IF; RETURN NEW; END; $$;
    CREATE TRIGGER test_batch_failure BEFORE INSERT ON world_character_grants_physical FOR EACH ROW EXECUTE FUNCTION test_batch_failure()`);
  try { await assert.rejects(store.recordGrantBatch(entries), /injected batch failure/); }
  finally { await pool.query('DROP TRIGGER test_batch_failure ON world_character_grants_physical; DROP FUNCTION test_batch_failure()'); }
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM world_character_grants WHERE grant_id LIKE 'batch-rollback:%'")).rows[0].n, 0);
  assert.deepEqual(await store.getOwned(A, a.characterId), a); assert.deepEqual(await store.getOwned(B, b.characterId), b);
  assert.equal((await store.recordGrantBatch(entries)).length, 2);
});

test('batch content conflicts, wrong owner and invalid codec result roll back earlier grant inserts', async () => {
  const a = await fresh(), b = await fresh(); await grant(b, 'batch-conflict:z');
  const first = { accountId: A, characterId: a.characterId, id: 'batch-conflict:a', payload: { xp: 10, coins: 2 } };
  await assert.rejects(store.recordGrantBatch([first, { ...first, id: 'batch-conflict:z', characterId: b.characterId, payload: { xp: 11, coins: 2 } }]), error('grant_mismatch'));
  await assert.rejects(store.recordGrantBatch([first, { ...first, id: 'batch-conflict:b', characterId: b.characterId, accountId: B }]), error('not_found'));
  await assert.rejects(store.recordGrantBatch([first, { ...first, id: 'batch-conflict:b', characterId: b.characterId, payload: { xp: 'invalid', coins: 2 } }]));
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM world_character_grants WHERE grant_id IN ('batch-conflict:a','batch-conflict:b')")).rows[0].n, 0);
  assert.equal((await store.pendingGrants(A, b.characterId))[0].payload.xp, 10);
  for (const entries of [[], Array(1), [first, first], Array(101).fill(first), [first, { ...first, id: 'other', accountId: B }]]) await assert.rejects(store.recordGrantBatch(entries), error('invalid'));
});

test('oppositely ordered batches across independent pools converge without row-lock deadlock', { timeout: 5000 }, async () => {
  const a = await fresh(), b = await fresh(), secondPool = new pg.Pool({ connectionString: postgres.url });
  const entries = [a, b].map((c, i) => ({ accountId: A, characterId: c.characterId, id: `batch-race:${i}`, payload: { xp: 10, coins: 2 } }));
  try {
    const second = new CharacterStore(secondPool, testCodec());
    const [first, reverse] = await Promise.all([store.recordGrantBatch(entries), second.recordGrantBatch([...entries].reverse())]);
    assert.deepEqual(first, [...reverse].reverse());
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM world_character_grants WHERE grant_id LIKE 'batch-race:%'")).rows[0].n, 2);
  } finally { await secondPool.end(); }
});

test('disjoint recipients racing colliding immutable IDs produce one whole batch and one conflict', { timeout: 5000 }, async () => {
  const chars = await Promise.all(Array.from({ length: 4 }, fresh)), secondPool = new pg.Pool({ connectionString: postgres.url });
  const entries = chars.map((c, i) => ({ accountId: A, characterId: c.characterId, id: `batch-id-race:${i % 2}`, payload: { xp: 10, coins: 2 } }));
  try {
    const second = new CharacterStore(secondPool, testCodec());
    const results = await Promise.allSettled([store.recordGrantBatch(entries.slice(0, 2)), second.recordGrantBatch(entries.slice(2).reverse())]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.find(r => r.status === 'rejected').reason.code, 'grant_mismatch');
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM world_character_grants WHERE grant_id LIKE 'batch-id-race:%'")).rows[0].n, 2);
  } finally { await secondPool.end(); }
});

test('receipt cap rejects a final capture containing more than 256 applied grant IDs without any commit', async () => {
  const c = await fresh(), ids = Array.from({ length: MAX_CHECKPOINT_GRANT_RECEIPTS + 1 }, (_, i) => `receipt-overflow:${i}`);
  await assert.rejects(store.saveCheckpoint(A, c.characterId, 0, { ...c.checkpoint, xp: ids.length }, ids), error('invalid'));
  await assert.rejects(store.loadForRecovery(A, c.characterId, ids), error('invalid'));
  assert.deepEqual(await store.getOwned(A, c.characterId), c);
});

test('bounded creation uses one account-locking transaction and respects racing independent pools', async () => {
  const owner = 'g' + 'd'.repeat(23); await pool.query("INSERT INTO accounts(username,save,updated,created) VALUES($1,'{}',1,1)", [owner]);
  const secondPool = new pg.Pool({ connectionString: postgres.url });
  try {
    const second = new CharacterStore(secondPool, testCodec());
    const results = await Promise.allSettled([store.createBounded(owner, identity, 1), second.createBounded(owner, identity, 1)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.find(r => r.status === 'rejected').reason.code, 'character_limit');
    assert.equal((await store.listOwned(owner)).length, 1);
    for (const max of [undefined, 0, -1, 1.5, Infinity]) await assert.rejects(store.createBounded(owner, identity, max), error('invalid'));
  } finally { await secondPool.end(); }
});

test('bounded creation rolls back codec failure even after the INSERT returned a row', async () => {
  const owner = 'g' + 'e'.repeat(23); await pool.query("INSERT INTO accounts(username,save,updated,created) VALUES($1,'{}',1,1)", [owner]);
  let validations = 0; const original = testCodec();
  const badDecode = new CharacterStore(pool, { ...original, validateCheckpoint(value, context) { validations++; if (validations === 2) throw new Error('injected post-insert decode failure'); return original.validateCheckpoint(value, context); } });
  await assert.rejects(badDecode.createBounded(owner, identity, 1), /post-insert decode/);
  assert.deepEqual(await store.listOwned(owner), []);
  assert.equal((await store.createBounded(owner, identity, 1)).revision, 0);
});
