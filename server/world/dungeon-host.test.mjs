// Actual PG + WebSocket host with dungeon runs enabled. Dungeon commands use the trusted typed host API until D3 adds wire messages;
// combat, presence, reconnect and persistence go through real sockets, the real numeric host loop and PostgreSQL.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { startPostgres } from '../node/local-postgres.mjs';
import { createPool, migrate } from '../node/db.ts';
import { CharacterStore } from './character-store.ts';
import { DungeonCompletionStore } from './dungeon-completion-store.ts';
import { WorldTicketRegistry } from './admission.ts';
import { acquireHostOwnership } from './ownership.ts';
import { loadWorldCatalog, createGameplayCatalog } from './catalog.ts';
import { createActualWorldHost } from './host.ts';
import { DurableOutcomeStore } from './contribution-store.ts';
import { planOutcomePage } from '../../src/sim/ledger.ts';
import { createCoreCharacterCodec } from '../../src/sim/persistence.ts';
import { createWorldVariants } from '../../src/sim/areas/variants.ts';
import { xpForLevel } from '../../src/sim/data/progression.ts';
import { DUNGEON_CHAMBER } from '../../src/sim/data/dungeons.ts';
import { createGameplayProtocol, GameplayReceiver, projectObservationExtras } from './gameplay/protocol.ts';
import { encodeInput } from './gameplay/intents.ts';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, ms = 8000, what = 'condition') { const end = performance.now() + ms; while (!(await check())) { if (performance.now() > end) throw new Error(`${what} timeout`); await delay(10); } }
let cluster, pool, loaded, codec, store, dungeonStore, gameplayCatalog, accountNumber = 0;
const origin = 'http://localhost:5261';
const appearance = { race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'Diver' };
const restore = { version: 'dungeon-test-pause-preserve', restore: checkpoint => ({ ...checkpoint,
  activity: { seated: false, village: false, controlsLocked: false, cast: null, channel: null, dash: false, pendingHit: false, rootPending: false,
    motion: { velocityX: 0, velocityZ: 0, jumpRemaining: 0, spinRemaining: 0, pushX: 0, pushZ: 0, pushRemaining: 0, lift: 0, dashElapsed: null } } }) };
const policy = { enemyLevel: spawn => spawn.fixedLevel, enemyPopulation: () => ({ desired: 1, respawnSeconds: 300 }),
  damageAllowed: (context, source, target) => !(source?.kind === 'player' && target.kind === 'player'), canInteract: () => true };

before(async () => {
  cluster = await startPostgres(); pool = createPool(cluster.url); await migrate(pool);
  const directory = new URL('../../public/world/', import.meta.url), ids = ['w1', 'w2', 'w3', 'w4'];
  const source = JSON.parse(await readFile(new URL('collision-w1.json', directory), 'utf8')).source;
  // No public enemies, so nothing outside the run touches the test characters.
  loaded = await loadWorldCatalog({ directory, expectedBakeSource: source, maxBakeBytes: 16 * 1024 * 1024, maxCells: 1000000,
    configs: Object.fromEntries(ids.map(id => [id, { fixedLevels: { scrapling: 1, scavenger: 1, jellyfish: 1, echo: 1 }, population: { scrapling: 0, scavenger: 0, jellyfish: 0 } }])),
    policies: Object.fromEntries(ids.map(id => [id, policy])), seeds: { w1: 1, w2: 2, w3: 3, w4: 4 }, variants: createWorldVariants });
  const spawn = loaded.get('w1').publicDefinition.spawn;
  codec = createCoreCharacterCodec({ identities: [{ classId: 'warrior', archetype: 'human' }], freshLocation: { ...spawn.position, yaw: spawn.yaw } });
  store = new CharacterStore(pool, codec); dungeonStore = new DungeonCompletionStore(pool); gameplayCatalog = createGameplayCatalog(loaded, { dungeons: [35, 50] });
});
after(async () => { await pool?.end(); cluster?.stop(); });

/** Seal writes can be held failing to prove the frozen roster is retried unchanged. */
function sealGate() { const gate = { failing: false, attempts: 0 }; gate.store = { recordDungeonCompletion: async m => { gate.attempts++; if (gate.failing) throw new Error('db down'); return dungeonStore.recordDungeonCompletion(m); }, readPendingDungeonAwards: (...args) => dungeonStore.readPendingDungeonAwards(...args), charactersWithPendingDungeonAwards: ids => dungeonStore.charactersWithPendingDungeonAwards(ids) }; return gate; }
async function runtime(options = {}) {
  const admission = new WorldTicketRegistry(async binding => {
    const r = await pool.query('SELECT expires FROM sessions WHERE username=$1 AND token_hash=$2', [binding.accountId, binding.sessionKey]);
    return r.rows[0] && Number(r.rows[0].expires) > Date.now() ? { ...binding, expiresAt: Number(r.rows[0].expires) } : null;
  });
  const ownership = await acquireHostOwnership(pool, 'world-dungeon-host-test'), failures = [];
  let host;
  try {
    host = createActualWorldHost({ admission, characters: options.characters ?? store, worlds: loaded, codec, ownership, dungeonCompletions: options.dungeonStore ?? dungeonStore,
      ...(options.ledger ? { outcomes: new DurableOutcomeStore(pool, codec, { planOutcomePage }) } : {}),
      gameplay: { catalog: gameplayCatalog, create: () => createGameplayProtocol(gameplayCatalog) },
      policies: { authTimeoutMs: 1000, inputTimeoutMs: 250, reconnectGraceMs: options.grace ?? 3000, sessionRevalidateMs: 1000, checkpointIntervalMs: 200,
        maxConnections: 16, maxConnectionsPerIp: 16, maxWaiting: 16, maxAuthFrameBytes: 1024, maxFrameBytes: 65536, maxBufferedBytes: 8 * 1024 * 1024, maxQueuedInputs: 128,
        maxMutationSourcesPerTick: 64, loopIntervalMs: 2,
        ...(options.ledger ? { ledger: { sourceLimits: { maxDirtyCreditEntries: 10000, maxDirtyCreditBytes: 16777216, maxPendingDeaths: 32, maxStagedBytes: 8388608 },
          drainLimits: { pageSize: 100, creditBatchesPerSlice: 1, outcomesPerSlice: 1, summaryVictimsPerSlice: 10, writeAttempts: 2 }, recoveryLimits: { draftsPerSlice: 10, pageSize: 100 }, recoveryIntervalMs: 100 } } : {}),
        victimOutcome: { maxEntries: 2048, maxPayloadBytes: 8 * 1024 * 1024, timeoutMs: 5000 },
        persistence: { maxQueuedPerCharacter: 1, maxAttempts: 2, retryMs: 1, maxRecoveryRounds: 2 },
        areaLimits: { eventCount: 4096, inputCommandsPerTick: 32, timers: 256, projectiles: 256 }, restore,
        party: { maxParties: 8, maxEncounters: options.maxEncounters ?? 4, returnSpawn: () => 'bossArena' },
        dungeons: { tiers: [35, 50], maxPendingAwards: 8 },
        offlineSeconds: (record, now) => Math.max(0, now - record.updatedAt) / 1000, visible: () => true, observationExtras: projectObservationExtras },
      originAllowed: value => value === origin, clientIp: () => '127.0.0.1', nowMonotonicMs: () => performance.now(), nowWallMs: Date.now,
      onFailure: (stage, error) => { failures.push({ stage, message: error.message }); } });
  } catch (error) { await ownership.release(); throw error; }
  const server = createServer(); server.on('upgrade', host.handleUpgrade); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  await host.ready();
  return { host, admission, failures, url: `ws://127.0.0.1:${server.address().port}/world`, async close() {
    const result = await host.shutdown(3000); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await ownership.release(); return result;
  } };
}
/** Trusted world/level fixture written before login: the character stands at a grounded W3 point. Nothing here is earned by play. */
async function character({ level = 1, hp, world = 'w3', offset = 0 } = {}) {
  const accountId = 'g' + (++accountNumber).toString(16).padStart(23, '0'), sessionKey = (accountNumber + 4096).toString(16).padStart(64, '0'), expiresAt = Date.now() + 120000;
  await pool.query('INSERT INTO accounts(username,updated,created) VALUES($1,0,0)', [accountId]);
  await pool.query('INSERT INTO sessions(token_hash,username,expires) VALUES($1,$2,$3)', [sessionKey, accountId, expiresAt]);
  let record = await store.create(accountId, { schema: 'world-identity-v1', classId: 'warrior', archetype: 'human', appearance: { ...appearance, name: `Diver${accountNumber}` } });
  if (world !== 'w1' || level > 1 || hp !== undefined) {
    const checkpoint = structuredClone(record.checkpoint), w = loaded.get(world), arrival = w.publicDefinition.pois.arrival ?? w.publicDefinition.spawn;
    const out = { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; return this; } }, radius = w.actionData.archetype('human').radius;
    w.query.resolveCollision(arrival.position.x + offset, arrival.position.z, radius, out);
    checkpoint.world = world; checkpoint.location = { x: out.x, y: w.query.heightAt(out.x, out.y), z: out.y, yaw: 0 };
    checkpoint.progress.quests.chapter = Number(world[1]);
    checkpoint.progress.xp = xpForLevel(level); checkpoint.survival.maxHp = Math.round(checkpoint.progress.baseMaxHp * (1 + .15 * (level - 1)));
    checkpoint.survival.hp = hp ?? checkpoint.survival.maxHp;
    record = await store.saveCheckpoint(accountId, record.characterId, record.revision, checkpoint, []);
  }
  return { record, binding: { accountId, sessionKey, expiresAt }, id: record.characterId };
}
/** Re-level an online character through a genuine external revision; the host recovers it from PG. */
async function relevel(c, level) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const current = await store.getOwned(c.binding.accountId, c.id), checkpoint = structuredClone(current.checkpoint);
    checkpoint.progress.xp = xpForLevel(level); checkpoint.survival.maxHp = checkpoint.survival.hp = Math.round(checkpoint.progress.baseMaxHp * (1 + .15 * (level - 1)));
    try { await store.saveCheckpoint(c.binding.accountId, c.id, current.revision, checkpoint, []); return; } catch (error) { if (error.code !== 'conflict') throw error; }
  }
  throw new Error('relevel fixture conflict');
}
async function client(rt, c) {
  const ws = new WebSocket(rt.url, { headers: { Origin: origin } });
  const bot = { ws, c, state: null, receiver: null, binding: null, sequence: 0, errors: [], controls: [] };
  ws.on('message', (bytes, binary) => {
    try {
      if (!binary) {
        const value = JSON.parse(bytes.toString()); bot.controls.push(value);
        if (value.type === 'world-bound') { const { type: _type, ...binding } = value; bot.binding = binding; bot.sequence = 0; bot.state = null; bot.receiver = new GameplayReceiver(binding, gameplayCatalog); }
      } else {
        const result = bot.receiver.accept(bytes, performance.now() / 1000);
        if (result?.kind === 'snapshot') bot.state = result.state; else if (result?.kind === 'control') bot.controls.push(result.control);
      }
    } catch (error) { bot.errors.push(error.message); }
  });
  await once(ws, 'open');
  ws.send(JSON.stringify({ type: 'authenticate', ticket: rt.admission.issue(c.binding, origin).ticket, characterId: c.id, schemaRevision: gameplayCatalog.wireSchemaRevision }));
  bot.send = commands => { if (ws.readyState === WebSocket.OPEN) ws.send(encodeInput({ binding: bot.binding, intent: { seq: ++bot.sequence, forward: 0, strafe: 0, turn: 0, sprint: false, steeringYaw: null, heldChannel: null, commands } }, gameplayCatalog)); };
  bot.self = () => bot.state?.actors.find(a => a.ref.id === bot.state.selfRef.id && a.ref.life === bot.state.selfRef.life);
  bot.party = () => bot.controls.filter(v => v.type === 'party').at(-1)?.state ?? null;
  bot.inPublic = () => !!bot.binding?.area.startsWith('w') && bot.state?.header.area === bot.binding.area;
  // Dungeon slots publish their typed run view since D3, so every login ends with an observation.
  await until(() => bot.state || bot.errors.length || bot.controls.some(v => v.type === 'error'), 8000, 'login');
  assert.deepEqual(bot.errors, []); assert.ok(bot.state, JSON.stringify(bot.controls));
  return bot;
}
async function closeBot(bot) { if (bot && bot.ws.readyState !== WebSocket.CLOSED) { bot.ws.close(); await once(bot.ws, 'close'); } }
const heartbeat = bots => setInterval(() => { for (const bot of bots) bot.send([]); }, 50);
async function party(leader, ...members) {
  leader.send([{ kind: 'partyCreate' }]); await until(() => leader.party());
  for (const m of members) { m.send([{ kind: 'partyJoin', code: leader.party().code }]); await until(() => m.party()?.members.length === members.indexOf(m) + 2); }
  await until(() => leader.party().members.length === members.length + 1);
}
const inDungeon = bot => bot.binding.area.startsWith('dungeon:');
const position = bot => { const s = bot.self(); return { x: s.x, z: s.z }; };
const near = (a, b, what) => { assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < .01, `${what}: ${JSON.stringify([a, b])}`); };
const count = async table => (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
/** Unpaid awards at the character's current revision: a live host may checkpoint an online character between two reads. */
async function unpaidAwards(p) {
  for (let i = 0; i < 20; i++) {
    const { revision } = await store.getOwned(p.binding.accountId, p.id);
    const read = await dungeonStore.readPendingDungeonAwards(p.binding.accountId, p.id, revision, 10);
    if (read.kind === 'page') return { awards: read.page.awards, more: read.more };
  }
  throw new Error('revision kept moving under the award read');
}

for (const ledger of [false, true]) test(`${ledger ? 'external ledger: ' : ''}dungeon start checks leader, level, world, party and room capacity before anyone moves, then the whole party enters together`, { timeout: 30000 }, async () => {
  const rt = await runtime({ maxEncounters: 1, ledger }), bots = []; let beat;
  try {
    const [a, b, d, e] = [await character({ level: 40 }), await character({ level: 20, offset: 1.5 }), await character({ level: 40, world: 'w1' }), await character({ level: 40, offset: -1.5 })];
    for (const c of [a, b, d, e]) bots.push(await client(rt, c));
    const [A, B, D, E] = bots; beat = heartbeat(bots);
    assert.deepEqual(await rt.host.dungeon(e.id, { kind: 'dungeonStart', tier: 35 }), { ok: false, code: 'dungeon-party-required' });
    await party(A, B);
    const areas = bots.map(bot => bot.binding.area), origins = [position(A), position(B)];
    assert.deepEqual(await rt.host.dungeon(b.id, { kind: 'dungeonStart', tier: 35 }), { ok: false, code: 'dungeon-leader-required' });
    // One under-level member denies the whole start: the leader stays at the source too.
    assert.deepEqual(await rt.host.dungeon(a.id, { kind: 'dungeonStart', tier: 35 }), { ok: false, code: 'dungeon-level' });
    assert.deepEqual(await rt.host.dungeon(a.id, { kind: 'dungeonStart', tier: 50 }), { ok: false, code: 'dungeon-level' });
    assert.deepEqual(await rt.host.dungeon(a.id, { kind: 'dungeonStart', tier: 75 }), { ok: false, code: 'dungeon-unavailable' }, 'tier not configured');
    assert.deepEqual(await rt.host.dungeon(a.id, { kind: 'dungeonJoin', run: '00000000-0000-4000-8000-000000000000' }), { ok: false, code: 'dungeon-run-unavailable' });
    assert.deepEqual(await rt.host.dungeon(a.id, { kind: 'dungeonStart', tier: 35, owner: a.id }), { ok: false, code: 'invalid-command' });
    D.send([{ kind: 'partyCreate' }]); await until(() => D.party());
    assert.deepEqual(await rt.host.dungeon(d.id, { kind: 'dungeonStart', tier: 35 }), { ok: false, code: 'dungeon-world' }, 'tier 35 starts only in World III');
    await delay(100);
    assert.deepEqual(bots.map(bot => bot.binding.area), areas); assert.equal(rt.host.stats().dungeonAreas, 0);
    assert.ok(A.controls.some(v => v.type === 'error' && v.code === 'dungeon-level'), 'denial is also sent as a control error');

    await relevel(b, 35); await until(() => B.self()?.level === 35, 8000, 'relevel');
    // A party PvP preference never reaches the run: the dungeon context only accepts coop.
    A.send([{ kind: 'partyPvp', enabled: true }]); await until(() => B.party()?.pvp === true);
    const started = await rt.host.dungeon(a.id, { kind: 'dungeonStart', tier: 35 });
    assert.equal(started.ok, true, JSON.stringify(started)); assert.equal(started.tier, 35); assert.match(started.run.runId, /^[0-9a-f-]{36}$/);
    await until(() => inDungeon(A) && inDungeon(B), 5000, 'both enter');
    const inside = (await store.getOwned(b.binding.accountId, b.id)).revision;
    assert.equal(A.binding.area, started.run.area); assert.equal(B.binding.area, started.run.area);
    assert.equal(rt.host.stats().dungeonAreas, 1); assert.equal(rt.host.dungeonObservation(b.id).run.runId, started.run.runId);
    assert.deepEqual(rt.host.dungeonObservation(a.id).run, started.run); assert.equal(rt.host.dungeonObservation(d.id), null);
    assert.equal(A.party().members.length, 2, 'party is retained inside the run');
    // Saved while inside: the public origin, never the y80 chamber.
    await until(async () => (await store.getOwned(b.binding.accountId, b.id)).revision > inside, 5000, 'save inside');
    const saved = await store.getOwned(b.binding.accountId, b.id);
    assert.equal(saved.checkpoint.world, 'w3'); near(saved.checkpoint.location, origins[1], 'saved origin'); assert.ok(Math.abs(saved.checkpoint.location.y - DUNGEON_CHAMBER.y) > 20);
    // The room pool is shared with boss encounters and capped by maxEncounters=1.
    E.send([{ kind: 'partyCreate' }]); await until(() => E.party());
    assert.deepEqual(await rt.host.dungeon(e.id, { kind: 'dungeonStart', tier: 35 }), { ok: false, code: 'dungeon-capacity' });
    assert.deepEqual(await rt.host.dungeon(e.id, { kind: 'dungeonJoin', run: started.run.runId }), { ok: false, code: 'dungeon-run-unavailable' }, 'another party cannot join');
    assert.equal(A.party().pvp, true);
    assert.deepEqual(rt.failures, []); for (const bot of bots) assert.deepEqual(bot.errors, []);
  } finally { clearInterval(beat); for (const bot of bots) await closeBot(bot); await rt.close(); }
});

for (const ledger of [false, true]) test(`${ledger ? 'external ledger: ' : ''}grace reconnect resumes the same run, a member leaves and late-joins, and the leader ends the run returning everyone to their origins`, { timeout: 30000 }, async () => {
  const rt = await runtime({ ledger }), bots = []; let beat;
  try {
    const a = await character({ level: 120 }), b = await character({ level: 120, offset: 2 });
    const A = await client(rt, a); let B = await client(rt, b); bots.push(A, B); beat = heartbeat(bots);
    await party(A, B); const origins = [position(A), position(B)];
    const started = await rt.host.dungeon(a.id, { kind: 'dungeonStart', tier: 35 }); assert.equal(started.ok, true);
    await until(() => inDungeon(A) && inDungeon(B));
    // Same-process reconnect inside grace resumes the owned dungeon actor in the same run.
    await closeBot(B); bots.splice(1, 1);
    B = await client(rt, b); bots.push(B); assert.ok(inDungeon(B));
    assert.equal(B.binding.area, started.run.area); assert.equal(rt.host.dungeonObservation(b.id).run.runId, started.run.runId);
    // A follower cannot end an active run; it can leave alone and come back while the run is still going.
    assert.deepEqual(await rt.host.dungeon(b.id, { kind: 'dungeonReturn', run: started.run.runId }), { ok: false, code: 'dungeon-leader-required' });
    B.send([{ kind: 'encounterLeave' }]); await until(() => B.inPublic(), 5000, 'leave alone');
    near(position(B), origins[1], 'individual leave origin'); assert.equal(B.party().members.length, 2);
    // A late join needs the canonical five seconds out of combat; the sentinels may have hit the member before it left.
    let joined;
    await until(async () => { joined = await rt.host.dungeon(b.id, { kind: 'dungeonJoin', run: started.run.runId }); return joined.ok || joined.code !== 'dungeon-party-busy'; }, 8000, 'late join admission');
    assert.equal(joined.ok, true, JSON.stringify(joined));
    await until(() => inDungeon(B), 5000, 'late join'); assert.equal(B.binding.area, started.run.area);
    assert.deepEqual(await rt.host.dungeon(a.id, { kind: 'dungeonReturn', run: '00000000-0000-4000-8000-000000000000' }), { ok: false, code: 'dungeon-run-unavailable' });
    assert.equal((await rt.host.dungeon(a.id, { kind: 'dungeonReturn', run: started.run.runId })).ok, true);
    await until(() => A.inPublic() && B.inPublic(), 5000, 'leader ends run');
    near(position(A), origins[0], 'leader origin'); near(position(B), origins[1], 'member origin');
    assert.equal(A.party().members.length, 2, 'returning keeps the party');
    await until(() => rt.host.stats().dungeonAreas === 0, 3000, 'empty run disposed');
    assert.deepEqual(rt.failures, []); for (const bot of bots) assert.deepEqual(bot.errors, []);
  } finally { clearInterval(beat); for (const bot of bots) await closeBot(bot); await rt.close(); }
});

for (const ledger of [false, true]) test(`${ledger ? 'external ledger: ' : ''}host restart restores a dungeon resident at its safe public return point`, { timeout: 30000 }, async () => {
  const a = await character({ level: 40 }); let rt = await runtime({ ledger }), A, beat, origin;
  try {
    A = await client(rt, a); beat = heartbeat([A]); await party(A); origin = position(A);
    assert.equal((await rt.host.dungeon(a.id, { kind: 'dungeonStart', tier: 35 })).ok, true);
    await until(() => inDungeon(A)); await delay(300);
  } finally { clearInterval(beat); assert.deepEqual(await rt.close(), { durable: true, unresolved: 0 }); await closeBot(A); }
  const saved = await store.getOwned(a.binding.accountId, a.id);
  assert.equal(saved.checkpoint.world, 'w3'); near(saved.checkpoint.location, origin, 'saved at restart');
  rt = await runtime({ ledger });
  try {
    A = await client(rt, a);
    assert.ok(A.inPublic(), A.binding.area); assert.equal(A.state.world, 'w3'); near(position(A), origin, 'restored after restart');
    assert.equal(rt.host.stats().dungeonAreas, 0); assert.deepEqual(rt.failures, []);
  } finally { await closeBot(A); await rt.close(); }
});

for (const ledger of [false, true]) test(`${ledger ? 'external ledger: ' : ''}a member killed in a wiped run returns dead, without revival, and stays dead in PG`, { timeout: 30000 }, async () => {
  const rt = await runtime({ ledger }); let A, beat;
  try {
    const a = await character({ level: 35, hp: 1 });
    A = await client(rt, a); beat = heartbeat([A]); await party(A); const origin = position(A);
    const started = await rt.host.dungeon(a.id, { kind: 'dungeonStart', tier: 35 }); assert.equal(started.ok, true);
    // Actual sentinels, timing and damage kill the 1 HP fixture; with nobody eligible left the run fails.
    await until(() => rt.host.dungeonObservation(a.id)?.phase === 'failed', 15000, 'wipe');
    assert.equal(rt.host.dungeonObservation(a.id).activeEnemies.length, 0);
    assert.equal((await rt.host.dungeon(a.id, { kind: 'dungeonReturn', run: started.run.runId })).ok, true);
    await until(() => A.inPublic(), 5000, 'dead return');
    const self = A.self(); assert.equal(self.alive, false); assert.equal(self.hp, 0); near(position(A), origin, 'dead return origin');
    await until(async () => { const r = await store.getOwned(a.binding.accountId, a.id); return r.checkpoint.survival.alive === false && Math.abs(r.checkpoint.location.y - DUNGEON_CHAMBER.y) > 20; }, 5000, 'dead save');
    const saved = await store.getOwned(a.binding.accountId, a.id);
    assert.equal(saved.checkpoint.survival.hp, 0); assert.ok(saved.checkpoint.survival.respawnRemaining > 0); assert.equal(saved.checkpoint.progress.flags.dungeonCleared35, undefined);
    assert.deepEqual(rt.failures, []); assert.deepEqual(A.errors, []);
  } finally { clearInterval(beat); await closeBot(A); await rt.close(); }
});

for (const ledger of [false, true]) test(`${ledger ? 'external ledger: ' : ''}a real clear freezes the clear-time roster, retries the seal unchanged, and pays each recipient once online or after an offline return`, { timeout: 150000 }, async () => {
  const gate = sealGate(), bots = []; let rt = await runtime({ dungeonStore: gate.store, grace: 300, ledger }), beat, fight;
  try {
    const people = [await character({ level: 650 }), await character({ level: 200, offset: 2 }), await character({ level: 200, offset: -2 }), await character({ level: 200, offset: 4 })];
    const [a, b, c, d] = people, [A, B, C, D] = await Promise.all(people.map(p => client(rt, p))); bots.push(A, B, C, D); beat = heartbeat([B, C, D]);
    await party(A, B, C, D); const origins = [A, B, C, D].map(position);
    const before = await Promise.all(people.map(p => store.getOwned(p.binding.accountId, p.id)));
    const counts = [await count('world_dungeon_completions'), await count('world_dungeon_awards'), await count('world_dungeon_award_receipts')];
    gate.failing = true;
    const started = await rt.host.dungeon(a.id, { kind: 'dungeonStart', tier: 35 }); assert.equal(started.ok, true);
    await until(() => [A, B, C, D].every(inDungeon), 5000, 'party enters');
    // A member who leaves before the clear is not on the roster.
    D.send([{ kind: 'encounterLeave' }]); await until(() => D.inPublic(), 5000, 'early leave');
    // The level 650 leader fights with ordinary target/ability inputs over its socket; the charge reaches sentinels chasing others.
    let turn = 0;
    fight = setInterval(() => { const run = rt.host.dungeonObservation(a.id), target = run?.activeEnemies[0]; A.send(target && run.phase === 'wave' ? [{ kind: 'target', target }, { kind: 'ability', slot: [3, 1, 4][turn++ % 3] }] : []); }, 50);
    await until(() => rt.host.dungeonObservation(a.id)?.phase === 'clear', 90000, 'clear');
    clearInterval(fight); fight = undefined;
    await until(() => gate.attempts >= 2, 5000, 'seal retries');
    assert.equal(await count('world_dungeon_completions'), counts[0], 'nothing is sealed while the write fails');
    // After the clear boundary one member disconnects and retires; a follower then brings everyone else home.
    clearInterval(beat); beat = heartbeat([A, C, D]); await closeBot(B);
    await until(() => rt.host.stats().activeActors === 3, 8000, 'member retired');
    assert.equal((await rt.host.dungeon(c.id, { kind: 'dungeonReturn', run: started.run.runId })).ok, true, 'a follower may return the party after the clear');
    await until(() => A.inPublic() && C.inPublic(), 5000, 'return after clear');
    near(position(A), origins[0], 'leader origin'); near(position(C), origins[2], 'follower origin');
    assert.deepEqual(await rt.host.dungeon(a.id, { kind: 'dungeonJoin', run: started.run.runId }), { ok: false, code: 'dungeon-run-ended' });
    assert.deepEqual(await rt.host.dungeon(d.id, { kind: 'dungeonJoin', run: started.run.runId }), { ok: false, code: 'dungeon-run-ended' }, 'no eligibility after the clear');
    const retired = await store.getOwned(b.binding.accountId, b.id);
    assert.equal(retired.checkpoint.progress.flags.dungeonCleared35, undefined); near(retired.checkpoint.location, origins[1], 'retired at origin');
    gate.failing = false;
    for (const p of [a, c]) await until(async () => (await store.getOwned(p.binding.accountId, p.id)).checkpoint.progress.flags.dungeonCleared35 === true, 8000, 'online award');
    assert.equal(rt.host.stats().dungeonClears, 1);
    assert.deepEqual([await count('world_dungeon_completions'), await count('world_dungeon_awards')], [counts[0] + 1, counts[1] + 3]);
    const manifest = JSON.parse((await pool.query('SELECT manifest_json FROM world_dungeon_completions WHERE run_id=$1', [started.run.runId])).rows[0].manifest_json);
    assert.deepEqual(manifest.recipients.map(r => r.characterId), [a.id, b.id, c.id].sort());
    await until(() => rt.host.stats().dungeonAreas === 0, 3000, 'sealed empty run disposed');
    // The committed manifest outlives this process: the offline recipient is paid once by the next host, in a public Area.
    clearInterval(beat); assert.deepEqual(rt.failures, []); for (const bot of bots) assert.deepEqual(bot.errors, []);
    assert.deepEqual(await rt.close(), { durable: true, unresolved: 0 }); for (const bot of bots.splice(0)) await closeBot(bot);
    rt = await runtime({ ledger });
    const B2 = await client(rt, b); bots.push(B2); beat = heartbeat([B2]);
    assert.ok(B2.inPublic()); near(position(B2), origins[1], 'offline recipient origin');
    await until(async () => (await store.getOwned(b.binding.accountId, b.id)).checkpoint.progress.flags.dungeonCleared35 === true, 8000, 'offline award');
    await until(() => B2.state?.self.player.flags.dungeonCleared35 === true, 3000, 'award visible to the returning client');
    await delay(600);
    const paid = await Promise.all(people.map(p => store.getOwned(p.binding.accountId, p.id)));
    for (const i of [0, 1, 2]) { assert.equal(paid[i].checkpoint.progress.xp, before[i].checkpoint.progress.xp + 1800); assert.equal(paid[i].checkpoint.progress.coins, before[i].checkpoint.progress.coins + 1800); }
    assert.equal(paid[3].checkpoint.progress.xp, before[3].checkpoint.progress.xp); assert.equal(paid[3].checkpoint.progress.flags.dungeonCleared35, undefined);
    assert.equal(await count('world_dungeon_award_receipts'), counts[2] + 3);
    for (const p of people) assert.deepEqual(await unpaidAwards(p), { awards: [], more: false }, `no unpaid award for ${p.id}`);
    assert.deepEqual(rt.failures, []); for (const bot of bots) assert.deepEqual(bot.errors, []);
  } finally { clearInterval(beat); clearInterval(fight); for (const bot of bots) await closeBot(bot); await rt.close(); }
});

test('a clear whose manifest never committed is reported as unresolved at shutdown and pays nothing after restart', { timeout: 120000 }, async () => {
  const gate = sealGate(), a = await character({ level: 650 }); let rt = await runtime({ dungeonStore: gate.store }), A, beat, fight, origin, run;
  try {
    A = await client(rt, a); beat = heartbeat([A]); await party(A); origin = position(A);
    const started = await rt.host.dungeon(a.id, { kind: 'dungeonStart', tier: 35 }); assert.equal(started.ok, true); run = started.run.runId;
    await until(() => inDungeon(A)); clearInterval(beat); gate.failing = true;
    let turn = 0;
    fight = setInterval(() => { const o = rt.host.dungeonObservation(a.id), target = o?.activeEnemies[0]; A.send(target && o.phase === 'wave' ? [{ kind: 'target', target }, { kind: 'ability', slot: [3, 1, 4][turn++ % 3] }] : []); }, 50);
    await until(() => rt.host.dungeonObservation(a.id)?.phase === 'clear', 90000, 'clear');
    clearInterval(fight); fight = undefined; await until(() => gate.attempts >= 1, 5000, 'seal attempt');
  } finally { clearInterval(beat); clearInterval(fight); }
  assert.deepEqual(await rt.close(), { durable: false, unresolved: 1 }, 'an owed clear lost with the process is not a durable stop');
  await closeBot(A);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM world_dungeon_completions WHERE run_id=$1', [run])).rows[0].n, 0);
  const saved = await store.getOwned(a.binding.accountId, a.id);
  assert.equal(saved.checkpoint.progress.flags.dungeonCleared35, undefined); near(saved.checkpoint.location, origin, 'saved at origin');
  rt = await runtime();
  try {
    A = await client(rt, a); assert.ok(A.inPublic()); near(position(A), origin, 'restarted at origin'); await delay(500);
    assert.equal((await store.getOwned(a.binding.accountId, a.id)).checkpoint.progress.flags.dungeonCleared35, undefined); assert.deepEqual(rt.failures, []);
  } finally { await closeBot(A); await rt.close(); }
});

for (const ledger of [false, true]) test(`${ledger ? 'external ledger: ' : ''}a dungeon resident whose PG revision moves underneath it is readmitted publicly from the durable checkpoint`, { timeout: 30000 }, async () => {
  const rt = await runtime({ ledger }); let A, B, beat;
  try {
    const a = await character({ level: 120 }), b = await character({ level: 120, offset: 2 });
    A = await client(rt, a); B = await client(rt, b); beat = heartbeat([A, B]); await party(A, B); const origin = position(A);
    const started = await rt.host.dungeon(a.id, { kind: 'dungeonStart', tier: 35 }); assert.equal(started.ok, true); await until(() => inDungeon(A) && inDungeon(B));
    await relevel(a, 125);
    await until(() => A.inPublic() && A.self()?.level === 125, 8000, 'recovered publicly');
    near(position(A), origin, 'recovered at origin'); assert.equal(rt.host.stats().activeActors, 2);
    // The other member keeps the run; the recovered member is no longer in the party.
    assert.equal(B.binding.area, started.run.area); assert.equal(rt.host.dungeonObservation(b.id).run.runId, started.run.runId);
    await until(() => B.party()?.members.length === 1 && A.party() === null, 3000, 'party resync');
    assert.equal(rt.host.stats().dungeonAreas, 1);
    assert.equal((await rt.host.dungeon(b.id, { kind: 'dungeonReturn', run: started.run.runId })).ok, true);
    await until(() => B.inPublic() && rt.host.stats().dungeonAreas === 0, 5000, 'run ended');
    assert.deepEqual(rt.failures, []); assert.deepEqual(A.errors, []); assert.deepEqual(B.errors, []);
  } finally { clearInterval(beat); await closeBot(A); await closeBot(B); await rt.close(); }
});

/**
 * Holds the next barrier at its round-start journal queries until the test's own writes have committed, and counts certified
 * grant page reads per character.
 */
function held() {
  const w = { reads: new Map(), armed: false }; let parked, release;
  w.arm = () => { w.armed = true; w.parked = new Promise(resolve => { parked = resolve; }); w.released = new Promise(resolve => { release = resolve; }); };
  w.open = () => { w.armed = false; release(); };
  const hold = run => async (...args) => { if (w.armed) { parked(); await w.released; } return run(...args); };
  w.characters = new Proxy(store, { get(target, key) {
    if (key === 'pendingGrants') return async (...args) => { w.reads.set(args[1], (w.reads.get(args[1]) ?? 0) + 1); return target.pendingGrants(...args); };
    if (key === 'charactersWithPendingGrants') return hold(ids => target.charactersWithPendingGrants(ids));
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } });
  w.dungeons = { recordDungeonCompletion: m => dungeonStore.recordDungeonCompletion(m), readPendingDungeonAwards: (...args) => dungeonStore.readPendingDungeonAwards(...args),
    charactersWithPendingDungeonAwards: hold(ids => dungeonStore.charactersWithPendingDungeonAwards(ids)) };
  return w;
}
/** A clear sealed outside this host's own run, as a late seal from a previous owner would be. */
function sealedElsewhere(people, baseXp, coins) {
  const runId = randomUUID(), area = `dungeon:${runId}`;
  return { kind: 'dungeon-clear-v1', candidate: { run: { area, runId }, tier: 35, completedTick: 1, finalWave: [1, 2, 3].map(id => ({ area, id, life: 1 })), baseXp, coins },
    recipients: people.map(p => ({ characterId: p.id, accountId: p.binding.accountId })) };
}
const barriers = rt => rt.host.stats().persistenceBarriers;
async function idleBarriers(rt, n = 2) { const start = barriers(rt); await until(() => barriers(rt) >= start + n && !rt.host.stats().durableBarrier, 6000, 'interval barriers'); }
const receipts = async id => (await pool.query('SELECT count(*)::int AS n FROM world_dungeon_award_receipts WHERE award_id=$1', [id])).rows[0].n;

for (const ledger of [false, true]) test(`${ledger ? 'external ledger: ' : ''}an award sealed elsewhere for an online character${ledger ? '' : ' whose grant pages are skipped'} is paid by the next barrier, exactly once`, { timeout: 30000 }, async () => {
  const w = held(), rt = await runtime({ ledger, characters: w.characters, dungeonStore: w.dungeons }); let A, beat;
  try {
    const a = await character({ level: 40 }); A = await client(rt, a); beat = heartbeat([A]);
    await idleBarriers(rt);
    // Not a grant recipient, not pendingReplay, nothing journaled: retained interval barriers read no page for it.
    w.reads.clear(); await idleBarriers(rt);
    if (!ledger) assert.equal(w.reads.get(a.id), undefined);
    const before = await store.getOwned(a.binding.accountId, a.id);
    w.arm(); await w.parked; const held = barriers(rt);
    const seal = await dungeonStore.recordDungeonCompletion(sealedElsewhere([a], 700, 300)), award = seal.awardIds[0];
    w.reads.clear(); w.open();
    await until(() => barriers(rt) > held || !rt.host.stats().durableBarrier, 6000, 'held barrier');
    assert.deepEqual(rt.failures, []);
    assert.equal(await receipts(award), 1, 'paid by the first barrier that read after the seal committed');
    if (!ledger) assert.ok(w.reads.get(a.id) >= 1, 'the page read certifies the revision before the award read');
    // Paid once: later barriers find nothing, and the retained skip applies again.
    w.reads.clear(); await idleBarriers(rt, 3);
    if (!ledger) assert.equal(w.reads.get(a.id), undefined);
    const paid = await store.getOwned(a.binding.accountId, a.id);
    assert.equal(paid.checkpoint.progress.xp, before.checkpoint.progress.xp + 700); assert.equal(paid.checkpoint.progress.coins, before.checkpoint.progress.coins + 300);
    assert.equal(paid.checkpoint.progress.flags.dungeonCleared35, true); assert.equal(await receipts(award), 1);
    assert.deepEqual(await unpaidAwards(a), { awards: [], more: false });
    await until(() => A.state?.self.player.flags.dungeonCleared35 === true && A.state.self.player.xp === paid.checkpoint.progress.xp, 3000, 'award visible to the client');
    assert.deepEqual(rt.failures, []); assert.deepEqual(A.errors, []);
  } finally { clearInterval(beat); await closeBot(A); await rt.close(); }
});

test('a skipped retained character whose award lands with a moved PG revision is recovered by its page read and paid once, without failing closed', { timeout: 30000 }, async () => {
  const w = held(), rt = await runtime({ characters: w.characters, dungeonStore: w.dungeons }); let A, beat;
  try {
    const a = await character({ level: 40 }); A = await client(rt, a); beat = heartbeat([A]);
    await idleBarriers(rt); w.reads.clear(); await idleBarriers(rt); assert.equal(w.reads.get(a.id), undefined);
    const before = await store.getOwned(a.binding.accountId, a.id), recoveries = rt.host.stats().recoveries;
    // Both outside writes commit while the next barrier waits before its first read.
    w.arm(); await w.parked; const held = barriers(rt);
    await relevel(a, 45); const award = (await dungeonStore.recordDungeonCompletion(sealedElsewhere([a], 700, 300))).awardIds[0];
    w.open();
    await until(() => barriers(rt) > held || !rt.host.stats().durableBarrier, 6000, 'held barrier');
    assert.deepEqual(rt.failures, [], 'the award read never retries a stale revision until recovery capacity');
    assert.equal(await receipts(award), 1); assert.ok(rt.host.stats().recoveries > recoveries);
    await idleBarriers(rt, 3);
    const paid = await store.getOwned(a.binding.accountId, a.id);
    assert.equal(paid.checkpoint.progress.xp, xpForLevel(45) + 700, 'the recovered durable level plus the award');
    assert.equal(paid.checkpoint.progress.coins, before.checkpoint.progress.coins + 300); assert.equal(await receipts(award), 1);
    await until(() => A.state?.self.player.xp === paid.checkpoint.progress.xp && A.state.self.player.flags.dungeonCleared35 === true, 3000, 'recovered award visible');
    assert.deepEqual(rt.failures, []); assert.deepEqual(A.errors, []);
  } finally { clearInterval(beat); await closeBot(A); await rt.close(); }
});

test('with dungeons enabled a retained host saves once per interval in halting rounds only, since feature award captures need the world held', { timeout: 30000 }, async () => {
  const rt = await runtime(), bots = []; let beat;
  try {
    for (let i = 0; i < 2; i++) bots.push(await client(rt, await character({ offset: i })));
    beat = heartbeat(bots);
    await until(() => !rt.host.stats().durableBarrier, 8000, 'admission rounds');
    const start = rt.host.stats(), t0 = performance.now();
    await delay(1500);
    const end = rt.host.stats(), seconds = (performance.now() - t0) / 1000;
    assert.deepEqual(rt.failures, []); assert.equal(end.frozen, false);
    assert.equal(end.saveRounds, 0, 'no running-world round'); assert.equal(end.checkpointCaptures, 0);
    const rounds = end.haltingBarriers - start.haltingBarriers;
    // checkpointIntervalMs is 200 ms here: about one round per interval, never one per tick.
    assert.ok(rounds >= 2 && rounds <= Math.ceil(seconds / .2) + 1, JSON.stringify({ rounds, seconds }));
    assert.ok(end.ticks - start.ticks > 0);
    for (const bot of bots) assert.deepEqual(bot.errors, []);
  } finally { clearInterval(beat); for (const bot of bots) await closeBot(bot); await rt.close(); }
});
