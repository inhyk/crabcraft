// Real throwaway Postgres and a real dungeon Area. No fake completion candidates or victim grants.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { startPostgres } from '../node/local-postgres.mjs';
import { migrate } from '../node/db.ts';
import { CharacterStore, CharacterStoreError } from './character-store.ts';
import { DungeonCompletionStore, validateDungeonCompletionManifest } from './dungeon-completion-store.ts';
import { freezeDungeonCompletion, sealDungeonCompletion, deliverDungeonAwards } from './dungeons.ts';
import { createCoreCharacterCodec } from '../../src/sim/persistence.ts';
import { createDungeonDefinition, createDungeonQuery } from '../../src/sim/areas/dungeon.ts';
import { xpForLevel } from '../../src/sim/data/progression.ts';
import { worldArea, flatWorld, tick } from '../../tests/core/worldHarness.mjs';

const codec = createCoreCharacterCodec({ identities: [{ classId: 'mage', archetype: 'human' }], freshLocation: { x: 0, y: 0, z: 0, yaw: 0 } });
const identity = name => ({ schema: 'world-identity-v1', classId: 'mage', archetype: 'human', appearance: { race: 'human', sex: 'male', classId: 'mage', shell: 0, crest: 0, led: 0, name } });
const accounts = ['a', 'b', 'c'].map(x => 'g' + x.repeat(23));
const code = c => e => e instanceof CharacterStoreError && e.code === c;
const ownership = { closed: { aborted: false }, assertOwned() {} };
const boundary = fn => Promise.resolve().then(fn);
let postgres, pool, characters, dungeons, people;

before(async () => {
  postgres = await startPostgres(); pool = new pg.Pool({ connectionString: postgres.url });
  try {
    const applied = await migrate(pool);
    assert.equal(applied.at(-1), '008_world_dungeon_awards'); assert.deepEqual(await migrate(pool), []);
    for (const a of accounts) await pool.query("INSERT INTO accounts(username,save,revision,updated,created) VALUES($1,'{}',0,1,1)", [a]);
    characters = new CharacterStore(pool, codec); dungeons = new DungeonCompletionStore(pool);
    people = [];
    for (const [i, a] of accounts.entries()) people.push(await characters.create(a, identity(`Diver${i}`)));
  } catch (e) { await pool.end(); postgres.stop(); throw e; }
});
after(async () => { try { await pool?.end(); } finally { postgres?.stop(); } });

const rows = async table => (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
const live = a => [...a.enemies.values()].filter(e => a.services.getUnit(e.unit)?.alive);
function until(a, predicate, max = 1000) { for (let i = 0; i < max; i++) { if (predicate()) return; tick(a); } assert.fail(JSON.stringify(a.dungeonObservation())); }
function killWave(a, u) { for (const e of live(a)) a.services.combat.damage(u.ref, e.unit, 1e9); tick(a); }

/** Actual tier-35 run: two level-35 members, the second dies during the last wave and stays in the run. */
function clearedRun(members) {
  const runId = randomUUID();
  const area = worldArea(`dungeon-${runId}`, 'w3', { dungeon: { runId, tier: 35 }, definition: createDungeonDefinition(35), query: createDungeonQuery(flatWorld),
    context: { mode: 'dungeon', members: [], pvp: 'disabled' }, featureAwards: { maxPending: 8 }, limits: { eventCount: 100000, inputCommandsPerTick: 32, timers: 1000, projectiles: 1000 } });
  const actors = members.map(c => {
    const ref = area.attachFresh(c.characterId, 'mage', 'human', 'spawn', c.revision), p = area.services.player(ref), u = area.services.getUnit(ref);
    p.restoreXp(xpForLevel(35)); p.state.nextSwing = 1e9;
    area.bindDungeonReturn(ref, { version: 1, world: 'w3', location: { x: 3, y: 0, z: 4, yaw: 0.4 } }, flatWorld);
    return { c, ref, p, u };
  });
  const wave = () => until(area, () => area.dungeonObservation().phase === 'wave');
  wave(); killWave(area, actors[0].u); wave(); killWave(area, actors[0].u); wave();
  if (actors[1]) { area.services.combat.damage(live(area)[0].unit, actors[1].u.ref, 1e9); assert.equal(actors[1].u.alive, false); }
  killWave(area, actors[0].u); until(area, () => area.pendingDungeonCompletion() !== null);
  assert.equal(area.dungeonObservation().phase, 'clear');
  return { area, runId, actors };
}
const residents = run => run.actors.map(x => ({ characterId: x.c.characterId, accountId: x.c.accountId, ref: x.u.ref }));

test('clear-time roster seals once, pays real XP/coins/flag once through receipts, and dead recipients stay dead', async () => {
  const [a, b] = people, run = clearedRun([a, b]);
  const frozen = freezeDungeonCompletion(run.area, residents(run));
  assert.deepEqual(frozen.manifest.recipients.map(r => r.characterId), [a.characterId, b.characterId].sort());
  assert.deepEqual([frozen.manifest.candidate.baseXp, frozen.manifest.candidate.coins, frozen.manifest.candidate.finalWave.length], [1800, 1800, 3]);
  const sealed = await sealDungeonCompletion({ area: run.area, frozen, store: dungeons, ownership, boundary, isCurrent: () => true });
  assert.equal(sealed.kind, 'sealed'); assert.equal(sealed.seal.created, true); assert.equal(run.area.pendingDungeonCompletion(), null);
  // Lost ACK replay of the identical manifest is idempotent; any changed fact is a conflict.
  const again = await dungeons.recordDungeonCompletion(frozen.manifest);
  assert.deepEqual({ ...again, created: true }, { ...sealed.seal });
  const m = frozen.manifest;
  await assert.rejects(dungeons.recordDungeonCompletion({ ...m, candidate: { ...m.candidate, coins: m.candidate.coins + 1 } }), code('outcome_conflict'));
  await assert.rejects(dungeons.recordDungeonCompletion({ ...m, recipients: m.recipients.slice(0, 1) }), code('outcome_conflict'));
  assert.deepEqual([await rows('world_dungeon_completions'), await rows('world_dungeon_awards')], [1, 2]);

  const barrier = run.area.beginDurabilityBarrier('dungeon-awards'), before = run.actors.map(x => ({ xp: x.p.state.xp, coins: x.p.state.coins }));
  for (const x of run.actors) {
    const delivered = await deliverDungeonAwards({ area: run.area, ref: x.u.ref, accountId: x.c.accountId, characterId: x.c.characterId, expectedRevision: 0, maxPending: 8, store: dungeons, ownership, boundary, isCurrent: () => true });
    assert.equal(delivered.kind, 'applied'); assert.deepEqual(delivered.results.map(r => r.result), ['applied']);
  }
  run.actors.forEach((x, i) => { assert.equal(x.p.state.xp, before[i].xp + 1800); assert.equal(x.p.state.coins, before[i].coins + 1800); assert.equal(x.p.state.flags.dungeonCleared35, true); });
  assert.equal(run.actors[1].u.alive, false, 'award does not revive a dead resident');
  // A wrong revision is refused by the Area fence before any read; the store reports the durable revision itself.
  await assert.rejects(deliverDungeonAwards({ area: run.area, ref: run.actors[0].u.ref, accountId: a.accountId, characterId: a.characterId, expectedRevision: 5, maxPending: 8, store: dungeons, ownership, boundary, isCurrent: () => true }), /Stale ledger revision/);
  assert.deepEqual(await dungeons.readPendingDungeonAwards(a.accountId, a.characterId, 5, 10), { kind: 'revision', revision: 0 });
  const moved = { readPendingDungeonAwards: async () => ({ kind: 'revision', revision: 3 }) };
  assert.deepEqual(await deliverDungeonAwards({ area: run.area, ref: run.actors[0].u.ref, accountId: a.accountId, characterId: a.characterId, expectedRevision: 0, maxPending: 8, store: moved, ownership, boundary, isCurrent: () => true }), { kind: 'revision', revision: 3 });

  for (const x of run.actors) {
    const capture = run.area.capturePlayerCheckpoint(x.u.ref);
    assert.equal(capture.appliedFeatureAwardIds.length, 1);
    assert.deepEqual({ x: capture.checkpoint.location.x, z: capture.checkpoint.location.z }, { x: 3, z: 4 }, 'saved location is the public return point, not the chamber');
    const saved = await characters.saveCheckpoint(x.c.accountId, x.c.characterId, 0, codec.toJson(capture.checkpoint), capture.appliedGrantIds, capture.appliedFeatureAwardIds);
    assert.equal(saved.revision, 1); assert.equal(saved.checkpoint.progress.flags.dungeonCleared35, true); assert.equal(saved.checkpoint.world, "w3"); assert.equal(saved.checkpoint.progress.coins, before[run.actors.indexOf(x)].coins + 1800);
    run.area.markCheckpointDurable(capture.captureId, saved.revision, capture.appliedGrantIds, capture.appliedFeatureAwardIds);
    assert.deepEqual(run.area.appliedFeatureAwardIds(x.c.characterId), []);
    // Repeating the same receipt is rejected without moving the revision.
    await assert.rejects(characters.saveCheckpoint(x.c.accountId, x.c.characterId, 1, codec.toJson(capture.checkpoint), [], capture.appliedFeatureAwardIds), code('already_applied'));
    const recovery = await characters.loadForRecovery(x.c.accountId, x.c.characterId, [], capture.appliedFeatureAwardIds);
    assert.equal(recovery.character.revision, 1); assert.deepEqual(recovery.dungeonAwards, [{ id: capture.appliedFeatureAwardIds[0], appliedRevision: 1 }]);
  }
  run.area.releaseDurabilityBarrier(barrier);
  // A new process (new pool) sees nothing left to pay.
  const fresh = new pg.Pool({ connectionString: postgres.url });
  try {
    const page = await new DungeonCompletionStore(fresh).readPendingDungeonAwards(a.accountId, a.characterId, 1, 100);
    assert.deepEqual(page, { kind: 'page', page: { revision: 1, awards: [] }, more: false });
  } finally { await fresh.end(); }
  people[0] = await characters.getOwned(a.accountId, a.characterId); people[1] = await characters.getOwned(b.accountId, b.characterId);
});

test('a member who left before the clear is not a recipient, and a foreign or unknown recipient writes nothing', async () => {
  const [a, , c] = people, run = clearedRun([a]);
  const frozen = freezeDungeonCompletion(run.area, residents(run));
  assert.deepEqual(frozen.manifest.recipients, [{ characterId: a.characterId, accountId: a.accountId }]);
  assert.throws(() => freezeDungeonCompletion(run.area, [...residents(run), { characterId: c.characterId, accountId: c.accountId, ref: run.actors[0].u.ref }]), /not in the run Area/);
  const counts = [await rows('world_dungeon_completions'), await rows('world_dungeon_awards')];
  const foreign = { ...frozen.manifest, recipients: [{ characterId: c.characterId, accountId: a.accountId }] };
  await assert.rejects(dungeons.recordDungeonCompletion(foreign), code('not_found'));
  await assert.rejects(dungeons.recordDungeonCompletion({ ...frozen.manifest, recipients: [{ characterId: randomUUID(), accountId: a.accountId }] }), code('not_found'));
  assert.deepEqual([await rows('world_dungeon_completions'), await rows('world_dungeon_awards')], counts);
  // A failed journal write leaves the source candidate pending; it is only ACKed after a matching durable seal.
  const failing = { recordDungeonCompletion: async () => { throw new Error('db down'); } };
  assert.deepEqual(await sealDungeonCompletion({ area: run.area, frozen, store: failing, ownership, boundary, isCurrent: () => true }), { kind: 'unresolved', reason: 'storage' });
  assert.notEqual(run.area.pendingDungeonCompletion(), null);
  const wrong = { recordDungeonCompletion: async m => ({ ...(await dungeons.recordDungeonCompletion(m)), digest: '0'.repeat(64) }) };
  assert.equal((await sealDungeonCompletion({ area: run.area, frozen, store: wrong, ownership, boundary, isCurrent: () => true })).kind, 'unresolved');
  assert.notEqual(run.area.pendingDungeonCompletion(), null);
  assert.equal((await sealDungeonCompletion({ area: run.area, frozen, store: dungeons, ownership, boundary, isCurrent: () => true })).kind, 'sealed');
  // Another account cannot read this character's awards; other characters' award IDs never receipt here.
  await assert.rejects(dungeons.readPendingDungeonAwards(c.accountId, a.characterId, a.revision, 10), code('not_found'));
  const ids = (await pool.query('SELECT award_id FROM world_dungeon_awards WHERE character_id<>$1', [a.characterId])).rows.map(r => r.award_id);
  const current = await characters.getOwned(a.accountId, a.characterId);
  await assert.rejects(characters.saveCheckpoint(a.accountId, a.characterId, current.revision, current.checkpoint, [], ids.slice(0, 1)), code('not_found'));
  const own = (await pool.query('SELECT award_id FROM world_dungeon_awards WHERE character_id=$1 AND run_id=$2', [a.characterId, run.runId])).rows.map(r => r.award_id);
  await assert.rejects(characters.saveCheckpoint(a.accountId, a.characterId, current.revision + 7, current.checkpoint, [], own), code('conflict'));
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM world_dungeon_award_receipts WHERE award_id=$1', [own[0]])).rows[0].n, 0);
  assert.equal((await characters.getOwned(a.accountId, a.characterId)).revision, current.revision);
  run.area.dispose();
});

test('two pools racing the same clear commit one manifest; the SQL triggers refuse partial or edited journals', async () => {
  const [, b] = people, run = clearedRun([b]), frozen = freezeDungeonCompletion(run.area, residents(run));
  const other = new pg.Pool({ connectionString: postgres.url });
  try {
    const seals = await Promise.all([dungeons.recordDungeonCompletion(frozen.manifest), new DungeonCompletionStore(other).recordDungeonCompletion(frozen.manifest)]);
    assert.deepEqual(seals.map(s => s.created).sort(), [false, true]); assert.equal(seals[0].digest, seals[1].digest);
  } finally { await other.end(); }
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM world_dungeon_completions WHERE run_id=$1', [run.runId])).rows[0].n, 1);
  const raw = async (sql, values) => { const client = await pool.connect(); try { await client.query('BEGIN'); await client.query(sql, values); await client.query('COMMIT'); } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); } };
  const runId = randomUUID(), manifest = JSON.stringify({ kind: 'dungeon-clear-v1', candidate: { run: { area: 'x', runId }, tier: 35, completedTick: 1, finalWave: [], baseXp: 1, coins: 1 }, recipients: [{ characterId: b.characterId, accountId: b.accountId }] });
  await assert.rejects(raw('INSERT INTO world_dungeon_completions(area_id,run_id,manifest_json,recipient_count) VALUES($1,$2,$3,1)', ['x', runId, manifest]), /incomplete dungeon completion manifest/);
  const id = JSON.stringify(['dungeon-award-v1', 'x', runId, b.characterId]);
  const insertBoth = payload => raw(`WITH c AS (INSERT INTO world_dungeon_completions(area_id,run_id,manifest_json,recipient_count) VALUES('x',$1,$2,1))
    INSERT INTO world_dungeon_awards(award_id,area_id,run_id,character_id,account_id,payload_json) VALUES($3,'x',$1,$4,$5,$6)`, [runId, manifest, id, b.characterId, b.accountId, JSON.stringify(payload)]);
  const payload = { schema: 'dungeon-award-v1', id, run: { area: 'x', runId }, tier: 35, recipient: b.characterId, baseXp: 1, coins: 1 };
  await assert.rejects(insertBoth({ ...payload, coins: 999999 }), /does not match sealed manifest/);
  await assert.rejects(raw(`WITH c AS (INSERT INTO world_dungeon_completions(area_id,run_id,manifest_json,recipient_count) VALUES('y',$1,$2,1))
    INSERT INTO world_dungeon_awards(award_id,area_id,run_id,character_id,account_id,payload_json) VALUES($3,'y',$1,$4,$5,$6)`, [runId, manifest, JSON.stringify(['dungeon-award-v1', 'y', runId, b.characterId]), b.characterId, b.accountId, JSON.stringify({ ...payload, id: JSON.stringify(['dungeon-award-v1', 'y', runId, b.characterId]) })]), /does not match|run does not match/);
  assert.ok(await rows('world_dungeon_award_receipts') > 0);
  for (const sql of ['UPDATE world_dungeon_completions SET recipient_count=recipient_count', 'DELETE FROM world_dungeon_awards', 'UPDATE world_dungeon_award_receipts SET applied_revision=applied_revision', 'DELETE FROM world_dungeon_award_receipts'])
    await assert.rejects(pool.query(sql), /immutable/);
  for (const bad of [{ recipients: Array.from({ length: 9 }, () => ({ characterId: randomUUID(), accountId: b.accountId })) }, { recipients: [frozen.manifest.recipients[0], frozen.manifest.recipients[0]] },
    { candidate: { ...frozen.manifest.candidate, run: { area: frozen.manifest.candidate.run.area, runId: 'run-1' } } }, { candidate: { ...frozen.manifest.candidate, tier: 425 } }, { kind: 'dungeon-clear-v2' }])
    assert.throws(() => validateDungeonCompletionManifest({ ...frozen.manifest, ...bad }), code('invalid'));
  assert.equal((await sealDungeonCompletion({ area: run.area, frozen, store: dungeons, ownership, boundary, isCurrent: () => true })).kind, 'sealed');
  run.area.dispose();
});
