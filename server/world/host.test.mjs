import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { startPostgres } from '../node/local-postgres.mjs';
import { createPool, migrate } from '../node/db.ts';
import { CharacterStore } from './character-store.ts';
import { WorldTicketRegistry } from './admission.ts';
import { acquireHostOwnership } from './ownership.ts';
import { WorldChatService } from './chat.ts';
import { loadWorldCatalog, createGameplayCatalog } from './catalog.ts';
import { createActualWorldHost } from './host.ts';
import { createCoreCharacterCodec } from '../../src/sim/persistence.ts';
import { createWorldVariants, personalNpcVisible } from '../../src/sim/areas/variants.ts';
import { createGameplayProtocol, GameplayReceiver, projectObservationExtras } from './gameplay/protocol.ts';
import { encodeInput } from './gameplay/intents.ts';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, ms = 5000) { const end = performance.now() + ms; while (!check()) { if (performance.now() > end) throw new Error('condition timeout'); await delay(10); } }
let cluster, pool, loaded, codec, store, gameplayCatalog;
let accountNumber = 0;
const origin = 'http://localhost:5260';
const appearance = { race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'HostHero' };
const identity = { schema: 'world-identity-v1', classId: 'warrior', archetype: 'human', appearance };
const explicitRestore = { version: 'test-pause-preserve-survival-and-cancel-activity', restore: checkpoint => ({ ...checkpoint,
  activity: { seated: false, village: false, controlsLocked: false, cast: null, channel: null, dash: false, pendingHit: false, rootPending: false,
    motion: { velocityX: 0, velocityZ: 0, jumpRemaining: 0, spinRemaining: 0, pushX: 0, pushZ: 0, pushRemaining: 0, lift: 0, dashElapsed: null } } }) };
const policy = { enemyLevel: spawn => spawn.fixedLevel, enemyPopulation: () => ({ desired: 1, respawnSeconds: 300 }),
  damageAllowed: (context, source, target) => !(source?.kind === 'player' && target.kind === 'player') || context.mode === 'party-encounter' && context.pvp === 'party-only', canInteract: () => true };
before(async () => {
  cluster = await startPostgres(); pool = createPool(cluster.url); await migrate(pool);
  const directory = new URL('../../public/world/', import.meta.url);
  const source = JSON.parse(await readFile(new URL('collision-w1.json', directory), 'utf8')).source;
  const ids = ['w1', 'w2', 'w3', 'w4'];
  loaded = await loadWorldCatalog({ directory, expectedBakeSource: source, maxBakeBytes: 16 * 1024 * 1024, maxCells: 1000000,
    configs: Object.fromEntries(ids.map(id => [id, { fixedLevels: { scrapling: 1, scavenger: 1, jellyfish: 1, echo: 1 }, population: { scrapling: 1, scavenger: 0, jellyfish: 0 } }])),
    policies: Object.fromEntries(ids.map(id => [id, policy])), seeds: { w1: 1, w2: 2, w3: 3, w4: 4 }, variants: createWorldVariants });
  const spawn = loaded.get('w1').publicDefinition.spawn;
  codec = createCoreCharacterCodec({ identities: [{ classId: 'warrior', archetype: 'human' }, { classId: 'mage', archetype: 'human' }], freshLocation: { ...spawn.position, yaw: spawn.yaw } });
  store = new CharacterStore(pool, codec);
  gameplayCatalog = createGameplayCatalog(loaded);
});
after(async () => { await pool?.end(); cluster?.stop(); });

async function character(classId = 'warrior') {
  const accountId = 'g' + (++accountNumber).toString(16).padStart(23, '0'), sessionKey = accountNumber.toString(16).padStart(64, '0'), expiresAt = Date.now() + 60000;
  await pool.query('INSERT INTO accounts(username,updated,created) VALUES($1,0,0)', [accountId]);
  await pool.query('INSERT INTO sessions(token_hash,username,expires) VALUES($1,$2,$3)', [sessionKey, accountId, expiresAt]);
  return { record: await store.create(accountId, { ...identity, classId, appearance: { ...appearance, classId } }), binding: { accountId, sessionKey, expiresAt } };
}
async function runtime(options = {}) {
  const admission = new WorldTicketRegistry(async binding => {
    const r = await pool.query('SELECT expires FROM sessions WHERE username=$1 AND token_hash=$2', [binding.accountId, binding.sessionKey]);
    return r.rows[0] && Number(r.rows[0].expires) > Date.now() ? { ...binding, expiresAt: Number(r.rows[0].expires) } : null;
  });
  const ownership = await acquireHostOwnership(pool, 'world-host-test');
  const worlds = new Map(loaded), base = loaded.get('w1'), spawn = base.publicDefinition.spawn.position;
  // Vertical test relocates one actual W1 enemy template beside actual baked spawn, without altering its rules/stats.
  if (options.combat) worlds.set('w1', { ...base, publicDefinition: { ...base.publicDefinition, enemies: [{ ...base.publicDefinition.enemies[0], home: { x: spawn.x + 3, y: base.query.heightAt(spawn.x + 3, spawn.z), z: spawn.z }, wanderRadius: 0 }] } });
  const failures = [];
  const host = createActualWorldHost({ admission, characters: options.characters ?? store, worlds, codec, ownership, chat: options.chat ? new WorldChatService(pool) : undefined,
    gameplay: { catalog: gameplayCatalog, create: () => createGameplayProtocol(gameplayCatalog) },
    policies: { authTimeoutMs: options.capacity ? 2000 : 500, inputTimeoutMs: 250, reconnectGraceMs: options.grace ?? 2000, sessionRevalidateMs: 100,
      checkpointIntervalMs: 1000, maxConnections: options.capacity ? 110 : 16, maxConnectionsPerIp: options.capacity ? 110 : 16, maxWaiting: options.capacity ? 110 : 16,
      maxAuthFrameBytes: 1024, maxFrameBytes: 65536, maxBufferedBytes: 8 * 1024 * 1024, maxQueuedInputs: 128,
      maxMutationSourcesPerTick: 64, loopIntervalMs: 2, chat: options.chat ? { maxPending: 4 } : undefined,
      victimOutcome: { maxEntries: options.victimMaxEntries ?? 2048, maxPayloadBytes: 8 * 1024 * 1024, timeoutMs: 5000 },
      victimOutcomeRetryCeiling: options.victimRetry ? { maxEntries: 2048, maxPayloadBytes: 8 * 1024 * 1024, timeoutMs: 5000 } : undefined,
      persistence: { maxQueuedPerCharacter: 1, maxAttempts: 2, retryMs: 1, maxRecoveryRounds: 2 },
      areaLimits: { eventCount: 4096, inputCommandsPerTick: 32, timers: 256, projectiles: 256 }, restore: explicitRestore,
      party: options.party ? { maxParties: 8, maxEncounters: 8, returnSpawn: () => 'bossArena' } : undefined,
      offlineSeconds: (record, now) => Math.max(0, now - record.updatedAt) / 1000,
      visible: (unit, viewer) => personalNpcVisible(worlds.get(viewer.quests.chapter === 1 ? 'w1' : 'w' + viewer.quests.chapter).publicDefinition, unit.npcId, viewer.flags),
      observationExtras: projectObservationExtras },
    originAllowed: value => value === origin, clientIp: () => '127.0.0.1', nowMonotonicMs: () => options.capacity ? 0 : performance.now(), nowWallMs: Date.now,
    onFailure: (stage, error) => { failures.push({ stage, message: error.message }); },
  });
  const server = createServer(); server.on('upgrade', host.handleUpgrade); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `ws://127.0.0.1:${server.address().port}/world`;
  return { host, admission, ownership, url, failures, async close() {
    const result = await host.shutdown(3000); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await ownership.release();
    return result;
  } };
}
async function client(rt, c, auth = true) {
  const ws = new WebSocket(rt.url, { headers: { Origin: origin } });
  const bot = { ws, state: null, receiver: null, binding: null, sequence: 0, events: [], results: [], errors: [], controls: [], packets: 0 };
  ws.on('message', (bytes, binary) => {
    try {
      if (!binary) {
        const value = JSON.parse(bytes.toString()); bot.controls.push(value);
        if (value.type === 'world-bound') { const { type: _type, ...binding } = value; bot.binding = binding; bot.sequence = 0; bot.receiver = new GameplayReceiver(binding, gameplayCatalog); }
      } else {
        bot.packets++; const result = bot.receiver.accept(bytes, performance.now() / 1000);
        if (result?.kind === 'snapshot') { bot.state = result.state; bot.events.push(...result.events); bot.results.push(...result.results); }
        else if (result?.kind === 'events') { bot.events.push(...result.events); bot.results.push(...result.results); }
        else if (result?.kind === 'control') bot.controls.push(result.control);
      }
    } catch (error) { bot.errors.push(error.message); }
  });
  await once(ws, 'open');
  if (auth) ws.send(JSON.stringify({ type: 'authenticate', ticket: rt.admission.issue(c.binding, origin).ticket, characterId: c.record.characterId }));
  bot.send = (commands, held = {}) => ws.send(encodeInput({ binding: bot.binding, intent: { seq: ++bot.sequence, forward: 0, strafe: 0, turn: 0, sprint: false, steeringYaw: null, heldChannel: null, ...held, commands } }, gameplayCatalog));
  return bot;
}
async function ready(rt, bot) { await until(() => bot.state || bot.controls.some(v => v.type === 'error') || rt.failures.length); assert.deepEqual(rt.failures, []); assert.deepEqual(bot.errors, []); assert.ok(bot.state, JSON.stringify(bot.controls)); }

test('real PG+WS login, level1 ability hit/death/full reward, durable save and authenticated live reconnect', { timeout: 20000 }, async () => {
  const rt = await runtime({ combat: true });
  try {
    const c = await character('mage'), bot = await client(rt, c); await ready(rt, bot);
    assert.equal(bot.state.self.player.xp, 0); assert.equal(bot.state.actors.find(a => a.ref.id === bot.state.selfRef.id).level, 1);
    const target = bot.state.actors.find(a => a.kind === 'scrapling'); assert.ok(target);
    bot.send([{ kind: 'target', target: target.ref }, { kind: 'ability', slot: 1 }]);
    const heartbeat = setInterval(() => { if (bot.ws.readyState === WebSocket.OPEN) bot.send([]); }, 50);
    try { await until(() => bot.state.self.player.xp > 0 || rt.failures.length || bot.controls.some(v => v.type === 'error'), 10000); }
    catch { throw new Error(JSON.stringify({ self: bot.state.self.player, target: bot.state.actors.find(a => a.ref.id === target.ref.id), selfActor: bot.state.actors.find(a => a.ref.id === bot.state.selfRef.id), events: bot.events.map(e => e.event), controls: bot.controls, errors: bot.errors, stats: rt.host.stats() })); }
    clearInterval(heartbeat);
    assert.deepEqual(rt.failures, []); assert.deepEqual(bot.errors, []); assert.ok(bot.state.self.player.xp > 0, JSON.stringify(bot.controls));
    assert.ok(bot.events.some(e => e.event.type === 'damage')); assert.ok(bot.events.some(e => e.event.type === 'death'));
    assert.ok(bot.events.some(e => e.event.type === 'projectile' && e.event.stage === 'spawn'));
    const saved = await store.getOwned(c.binding.accountId, c.record.characterId), xp = saved.checkpoint.progress.xp;
    assert.equal(xp, bot.state.self.player.xp); assert.ok(saved.revision > 0);
    const receipts = await pool.query('SELECT count(*)::integer n FROM world_character_grant_receipts WHERE character_id=$1', [c.record.characterId]); assert.equal(receipts.rows[0].n, 1);
    const oldSession = bot.binding.session; bot.ws.close(); await once(bot.ws, 'close');
    const returned = await client(rt, c); await ready(rt, returned); assert.notEqual(returned.binding.session, oldSession); assert.equal(returned.state.self.player.xp, xp);
    returned.send([{ kind: 'target', target: null }]); await until(() => returned.receiver.header.consumedInput === 1);
    assert.equal((await store.getOwned(c.binding.accountId, c.record.characterId)).checkpoint.progress.xp, xp);
    returned.ws.close(); await once(returned.ws, 'close');
  } finally { assert.deepEqual(await rt.close(), { durable: true, unresolved: 0 }); }
});

test('preauth timeout, cross-account selection, concurrent owner and revoked session fail closed', { timeout: 10000 }, async () => {
  const rt = await runtime();
  try {
    const a = await character(), b = await character();
    const idle = await client(rt, a, false); await once(idle.ws, 'close'); assert.ok(idle.controls.some(c => c.code === 'auth-timeout'));
    const stolen = await client(rt, { ...a, record: b.record }); await once(stolen.ws, 'close'); assert.ok(stolen.controls.some(c => c.code === 'character-unavailable'));
    const first = await client(rt, a); await ready(rt, first); const duplicate = await client(rt, a); await once(duplicate.ws, 'close'); assert.ok(duplicate.controls.some(c => c.code === 'character-active'));
    await pool.query('DELETE FROM sessions WHERE token_hash=$1', [a.binding.sessionKey]); await once(first.ws, 'close'); assert.ok(first.controls.some(c => c.code === 'session-expired'));
    assert.equal(rt.host.stats().frozen, false);
  } finally { await rt.close(); }
});

test('disconnect retirement saves checkpoint, releases capacity and resumes from PG after new host', { timeout: 10000 }, async () => {
  const c = await character(), rt = await runtime({ grace: 20 }); let latest;
  try {
    const bot = await client(rt, c); await ready(rt, bot); bot.send([{ kind: 'jump' }]); await until(() => bot.receiver.header.consumedInput === 1);
    bot.ws.close(); await once(bot.ws, 'close'); await until(() => rt.host.stats().activeActors === 0);
    latest = await store.getOwned(c.binding.accountId, c.record.characterId); assert.ok(latest.revision >= 2);
    assert.equal(rt.host.stats().publicAreas, 4); const ticks = rt.host.stats().ticks; await delay(100); assert.equal(rt.host.stats().ticks, ticks);
  } finally { assert.deepEqual(await rt.close(), { durable: true, unresolved: 0 }); }
  const next = await runtime();
  try {
    const resumed = await client(next, c); await ready(next, resumed); assert.equal(resumed.state.self.player.xp, latest.checkpoint.progress.xp); assert.deepEqual(resumed.errors, []);
    resumed.ws.close(); await once(resumed.ws, 'close');
  } finally { await next.close(); }
});

test('real enemy death survives retirement and reauthentication without an alive/full-HP reset', { timeout: 10000 }, async () => {
  const rt = await runtime({ combat: true, grace: 20 }); let bot, returned;
  try {
    const c = await character('mage'), checkpoint = structuredClone(c.record.checkpoint);
    checkpoint.survival.hp = 1; // Explicit low-HP fixture, actual enemy/action/timing causes death.
    c.record = await store.saveCheckpoint(c.binding.accountId, c.record.characterId, c.record.revision, checkpoint, []);
    bot = await client(rt, c); await ready(rt, bot);
    await until(() => bot.state.actors.find(a => a.ref.id === bot.state.selfRef.id).alive === false || rt.failures.length, 5000);
    assert.deepEqual(rt.failures, []); bot.ws.close(); await once(bot.ws, 'close'); await until(() => rt.host.stats().activeActors === 0);
    const dead = await store.getOwned(c.binding.accountId, c.record.characterId);
    assert.equal(dead.checkpoint.survival.alive, false); assert.equal(dead.checkpoint.survival.hp, 0); assert.ok(dead.checkpoint.survival.respawnRemaining > 0);
    returned = await client(rt, c); await ready(rt, returned);
    const self = returned.state.actors.find(a => a.ref.id === returned.state.selfRef.id);
    assert.equal(self.alive, false); assert.equal(self.hp, 0); assert.deepEqual(returned.errors, []);
  } finally { bot?.ws.close(); returned?.ws.close(); await rt.close(); }
});

test('authoritative party codes enforce eight members, leader handoff and level-gated private admission', { timeout: 15000 }, async () => {
  const rt = await runtime({ party: true }); const bots = [];
  try {
    for (let i = 0; i < 9; i++) { const c = await character(); const bot = await client(rt, c); await ready(rt, bot); bots.push(bot); }
    const party = bot => bot.controls.filter(c => c.type === 'party').at(-1)?.state;
    bots[0].send([{ kind: 'partyCreate' }]); await until(() => party(bots[0])?.members.length === 1);
    const code = party(bots[0]).code; assert.match(code, /^[A-F0-9]{6}$/);
    for (let i = 1; i < 8; i++) { bots[i].send([{ kind: 'partyJoin', code }]); await until(() => party(bots[0])?.members.length === i + 1); }
    bots[8].send([{ kind: 'partyJoin', code }]); await until(() => bots[8].controls.some(c => c.code === 'party-join-unavailable'));
    assert.equal(party(bots[0]).members.length, 8); assert.equal(party(bots[8]), null);
    bots[0].send([{ kind: 'partyPvp', enabled: true }]); await until(() => party(bots[1])?.pvp === true);
    // Being party leader or enabling party PvP never bypasses level, shared beacon or entrance rules.
    bots[0].send([{ kind: 'bossChallenge', profile: 'rust' }]); await until(() => bots[0].controls.some(c => c.code === 'encounter-prerequisites'));
    assert.equal(rt.host.stats().encounterAreas, 0); assert.equal(rt.host.stats().publicAreas, 4);
    const nextLeader = party(bots[0]).members[1].id;
    bots[0].send([{ kind: 'partyLeave' }]); await until(() => party(bots[1])?.leader === nextLeader);
    assert.equal(party(bots[1]).members.length, 7); assert.equal(party(bots[0]), null);
    assert.deepEqual(rt.failures, []); for (const bot of bots) assert.deepEqual(bot.errors, []);
  } finally { for (const bot of bots) bot.ws.close(); await rt.close(); }
});

test('two actual combat contributors receive complete identical XP in one atomic death batch', { timeout: 15000 }, async () => {
  const rt = await runtime({ combat: true }); const bots = []; const timers = [];
  try {
    const characters = [await character('mage'), await character('mage')];
    for (const c of characters) { const bot = await client(rt, c); await ready(rt, bot); bots.push(bot); }
    for (const bot of bots) {
      const target = bot.state.actors.find(a => a.kind === 'scrapling'); bot.send([{ kind: 'target', target: target.ref }, { kind: 'ability', slot: 1 }]);
      timers.push(setInterval(() => { if (bot.ws.readyState === WebSocket.OPEN) bot.send([]); }, 50));
    }
    await until(() => bots.every(bot => bot.state.self.player.xp > 0) || rt.failures.length, 10000);
    assert.deepEqual(rt.failures, []); assert.equal(bots[0].state.self.player.xp, 20); assert.equal(bots[1].state.self.player.xp, 20);
    const rows = await pool.query('SELECT g.character_id,r.applied_revision FROM world_character_grants g JOIN world_character_grant_receipts r USING(grant_id) WHERE g.character_id=ANY($1::uuid[])', [characters.map(c => c.record.characterId)]);
    const seals = await pool.query('SELECT recipient_count FROM world_victim_outcomes WHERE outcome_key=$1', [JSON.stringify([bots[0].events.find(e=>e.event.type==="death").event.unit.area,bots[0].events.find(e=>e.event.type==="death").event.unit.id,bots[0].events.find(e=>e.event.type==="death").event.unit.life])]); assert.equal(Number(seals.rows[0].recipient_count),2);
    assert.equal(rows.rowCount, 2); assert.equal(new Set(rows.rows.map(r => r.character_id)).size, 2);
    for (const c of characters) assert.equal((await store.getOwned(c.binding.accountId, c.record.characterId)).checkpoint.progress.xp, 20);
  } finally { for (const timer of timers) clearInterval(timer); for (const bot of bots) bot.ws.close(); await rt.close(); }
});

test('private encounter admission uses actual beacon channel and trusted readiness fixture; CAS restore cannot bypass membership', { timeout: 15000 }, async () => {
  const rt = await runtime({ party: true }); let bot, heartbeat;
  try {
    const c = await character('mage'), base = loaded.get('w1'), beacon = base.publicDefinition.interactions.find(i => i.id === 'beacon');
    // Trusted test setup reaches level3 and lighthouse. It does not claim those were earned by play.
    const checkpoint = structuredClone(c.record.checkpoint); checkpoint.progress.xp = 900;
    checkpoint.survival.maxHp = checkpoint.survival.hp = Math.round(checkpoint.progress.baseMaxHp * 1.3);
    checkpoint.survival.resource = checkpoint.survival.maxResource = 160;
    checkpoint.progress.quests.status.q1 = checkpoint.progress.quests.status.q2 = 'done'; checkpoint.progress.quests.status.q3 = 'active';
    checkpoint.progress.quests.progress['q1-kill'] = 6; checkpoint.progress.quests.progress['q1-cog'] = 4; checkpoint.progress.quests.progress['q2-deliver'] = 1;
    checkpoint.progress.quests.cogs = 4;
    checkpoint.location = { ...beacon.position, yaw: 0 };
    c.record = await store.saveCheckpoint(c.binding.accountId, c.record.characterId, c.record.revision, checkpoint, []);
    bot = await client(rt, c); await ready(rt, bot);
    bot.send([{ kind: 'interact', targetId: 'beacon' }], { heldChannel: 'beacon' });
    heartbeat = setInterval(() => { if (bot.ws.readyState === WebSocket.OPEN) bot.send([], { heldChannel: 'beacon' }); }, 50);
    await until(() => bot.state.features.environment.beacon || rt.failures.length, 5000); clearInterval(heartbeat); heartbeat = undefined;
    assert.deepEqual(rt.failures, []); assert.equal(bot.state.features.environment.beacon, true);
    bot.send([{ kind: 'partyCreate' }]); await until(() => bot.controls.some(control => control.type === 'party' && control.state));
    const original = bot.binding.session, entry = base.encounterDefinitions.get('rust').pois['encounter:entry'];
    // A genuine external revision forces the host's freeze/load/restore path, then validates the real entrance.
    let written = false;
    for (let attempt = 0; attempt < 10 && !written; attempt++) {
      const current = await store.getOwned(c.binding.accountId, c.record.characterId), next = structuredClone(current.checkpoint);
      next.location = { ...entry.position, yaw: entry.yaw };
      try { await store.saveCheckpoint(c.binding.accountId, c.record.characterId, current.revision, next, []); written = true; }
      catch (error) { if (error.code !== 'conflict') throw error; }
    }
    assert.equal(written, true);
    await until(() => bot.binding.session !== original && Math.abs(bot.state.actors.find(a => a.ref.id === bot.state.selfRef.id).x - entry.position.x) < .5 || rt.failures.length, 5000);
    assert.deepEqual(rt.failures, []); bot.send([{ kind: 'bossChallenge', profile: 'rust' }]);
    await until(() => bot.binding.area.startsWith('party:') && bot.state.actors.some(a => a.kind === 'boss') || rt.failures.length, 5000);
    assert.deepEqual(rt.failures, []); assert.deepEqual(bot.errors, []);
    assert.equal(rt.host.stats().publicAreas, 4); assert.equal(rt.host.stats().encounterAreas, 1);
    assert.ok(bot.state.actors.some(a => a.archetype === 'boss-rust'));
    // Return while the boss is still waking and combat has not begun; the configured return is a real public POI.
    bot.send([{ kind: 'encounterLeave' }]);
    await until(() => bot.binding.area.startsWith('w1:') && rt.host.stats().encounterAreas === 0 || rt.failures.length, 5000);
    assert.deepEqual(rt.failures, []); assert.deepEqual(bot.errors, []); assert.equal(bot.state.self.player.xp, 900);
    assert.notEqual(bot.state.self.player.flags.rustCleared, true);
  } finally { if (heartbeat) clearInterval(heartbeat); bot?.ws.close(); await rt.close(); }
});

test('100 actual authenticated sockets occupy one public Area; 101st queues, takes a released seat and cancels cleanly (paused simulation clock)', { timeout: 30000 }, async () => {
  const rt = await runtime({ capacity: true, grace: 0 }); const bots = [];
  try {
    const records = [];
    for (let i = 0; i < 101; i++) records.push(await character());
    bots.push(...await Promise.all(records.map(c => client(rt, c))));
    await until(() => rt.host.stats().activeActors === 100 && rt.host.stats().waiting === 1 || rt.failures.length, 15000);
    assert.deepEqual(rt.failures, []); assert.equal(rt.host.stats().publicAreas, 4);
    await until(() => bots.some(bot => !bot.binding && bot.controls.some(c => c.type === 'queued')));
    const queued = bots.find(bot => !bot.binding && bot.controls.some(c => c.type === 'queued'));
    assert.ok(queued); assert.equal(queued.controls.filter(c => c.type === 'queued').length, 1);
    const admitted = bots.find(bot => bot.binding); admitted.ws.close(); await once(admitted.ws, 'close');
    await until(() => queued.binding && rt.host.stats().waiting === 0, 15000);
    assert.equal(rt.host.stats().activeActors, 100); assert.equal(rt.host.stats().publicAreas, 4);
    const cancelled = await client(rt, await character()); bots.push(cancelled);
    await until(() => cancelled.controls.some(c => c.type === 'queued'));
    cancelled.ws.close(); await once(cancelled.ws, 'close'); await until(() => rt.host.stats().waiting === 0);
    assert.equal(rt.host.stats().activeActors, 100); assert.equal(rt.host.stats().ticks, 0);
    // This is admission/cancellation evidence with a paused injected clock, explicitly not a 100-player load result.
    assert.deepEqual(rt.failures, []);
  } finally { for (const bot of bots) bot.ws.close(); await rt.close(); }
});

test('all four real worlds round-trip through validated gate intents with unchanged XP and retained ultimate cooldown', { timeout: 25000 }, async () => {
  const rt = await runtime(); let bot;
  try {
    const c = await character('mage'), first = loaded.get('w1'), initialGate = first.publicDefinition.interactions.find(i => i.id === 'gate:w2');
    const initial = structuredClone(c.record.checkpoint); initial.location = { ...initialGate.position, yaw: 0 };
    c.record = await store.saveCheckpoint(c.binding.accountId, c.record.characterId, c.record.revision, initial, []);
    bot = await client(rt, c); await ready(rt, bot);
    bot.send([{ kind: 'ability', slot: 5 }]); await until(() => bot.receiver.header.consumedInput === 1);
    bot.send([{ kind: 'travel', gateId: 'gate:w2' }]); await until(() => bot.receiver.header.consumedInput === 2);
    assert.equal(bot.state.world, 'w1'); assert.equal(rt.host.stats().activeActors, 1);
    const staleBinding = { ...bot.binding };
    const hops = [['w1','w2'], ['w2','w3'], ['w3','w4'], ['w4','w3'], ['w3','w2'], ['w2','w1']];
    for (const [from, to] of hops) {
      const world = loaded.get(from), gate = world.publicDefinition.interactions.find(i => i.id === `gate:${to}`), oldSession = bot.binding.session;
      let written = false;
      for (let attempt = 0; attempt < 10 && !written; attempt++) {
        const current = await store.getOwned(c.binding.accountId, c.record.characterId), checkpoint = structuredClone(current.checkpoint);
        // Trusted navigation/unlock test fixture, not earned progression or client position input.
        checkpoint.progress.flags = { ...checkpoint.progress.flags, abyssCleared: true, trueCleared: true, finalCleared: true };
        const out = { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; return this; } };
        world.query.resolveCollision(gate.position.x, gate.position.z, world.actionData.archetype('human').radius, out);
        checkpoint.location = { x: out.x, y: world.query.heightAt(out.x, out.y), z: out.y, yaw: 0 };
        try { await store.saveCheckpoint(c.binding.accountId, c.record.characterId, current.revision, checkpoint, []); written = true; }
        catch (error) { if (error.code !== 'conflict') throw error; }
      }
      assert.equal(written, true);
      await until(() => bot.binding.session !== oldSession && bot.state.world === from || rt.failures.length, 5000);
      assert.deepEqual(rt.failures, []); const before = bot.binding.area;
      bot.send([{ kind: 'travel', gateId: `gate:${to}` }]);
      await until(() => bot.binding.area !== before && bot.state.world === to || rt.failures.length, 5000);
      assert.deepEqual(rt.failures, []); assert.deepEqual(bot.errors, []);
      assert.equal(bot.state.self.player.xp, 0); assert.equal(bot.state.self.player.coins, 0);
      assert.equal(bot.state.self.player.quests.chapter, Number(to.slice(1)));
      assert.ok(bot.state.self.player.cooldowns['crown-burst'].end - bot.state.time > 30);
      assert.equal(rt.host.stats().activeActors, 1); assert.equal(rt.host.stats().publicAreas, 4);
    }
    const saved = await store.getOwned(c.binding.accountId, c.record.characterId); assert.equal(saved.checkpoint.world, 'w1'); assert.equal(saved.checkpoint.progress.xp, 0);
    bot.ws.send(encodeInput({ binding: staleBinding, intent: { seq: 100, forward: 0, strafe: 0, turn: 0, sprint: false, steeringYaw: null, heldChannel: null, commands: [] } }, gameplayCatalog));
    await once(bot.ws, 'close'); assert.ok(bot.controls.some(control => control.code === 'invalid-input'));
  } finally { bot?.ws.close(); await rt.close(); }
});

test('economic results use actual delegated outcomes and original input origins only after a committed checkpoint', { timeout: 10000 }, async () => {
  const rt = await runtime(); let bot;
  try {
    const c = await character('mage'); bot = await client(rt, c); await ready(rt, bot);
    bot.send([{ kind: 'questAccept', questId: 'q1', npcId: 'brinebeard' }]);
    bot.send([{ kind: 'questAccept', questId: 'q1', npcId: 'brinebeard' }]);
    await until(() => bot.results.some(r => r.inputSequence === 1 && r.status === 'durable') && bot.results.some(r => r.inputSequence === 2 && r.status === 'failed') || rt.failures.length);
    assert.deepEqual(rt.failures, []);
    const accepted = bot.results.find(r => r.inputSequence === 1); assert.equal(accepted.commandIndex, 0); assert.equal(accepted.code, 'quest-accepted');
    const savedQuest = await store.getOwned(c.binding.accountId, c.record.characterId);
    assert.ok(accepted.revision <= savedQuest.revision); assert.equal(savedQuest.checkpoint.progress.quests.status.q1, 'active');
    const oldSession = bot.binding.session, pip = loaded.get('w1').publicDefinition.npcs.find(n => n.id === 'pip');
    // Trusted shop-readiness fixture only; the actual two purchases and failures run through core commands.
    let written = false;
    for (let attempt = 0; attempt < 10 && !written; attempt++) {
      const current = await store.getOwned(c.binding.accountId, c.record.characterId), checkpoint = structuredClone(current.checkpoint);
      checkpoint.location = { ...pip.position, yaw: 0 }; checkpoint.progress.coins = 200;
      try { await store.saveCheckpoint(c.binding.accountId, c.record.characterId, current.revision, checkpoint, []); written = true; }
      catch (error) { if (error.code !== 'conflict') throw error; }
    }
    assert.equal(written, true); await until(() => bot.binding.session !== oldSession || rt.failures.length); assert.deepEqual(rt.failures, []);
    bot.results = [];
    bot.send([{ kind: 'forgeBuy', npcId: 'pip', slot: 'weapon', request: 111 }, { kind: 'forgeBuy', npcId: 'pip', slot: 'armor', request: 112 }]);
    await until(() => bot.results.filter(r => r.status === 'durable' && [111,112].includes(r.request)).length === 2 || rt.failures.length);
    assert.deepEqual(rt.failures, []);
    const bought = bot.results.filter(r => [111,112].includes(r.request)); assert.deepEqual(bought.map(r => [r.inputSequence,r.commandIndex,r.code]), [[1,0,'equipment-bought'],[1,1,'equipment-bought']]);
    assert.equal(bought[0].revision, bought[1].revision);
    const saved = await store.getOwned(c.binding.accountId, c.record.characterId);
    assert.equal(saved.checkpoint.progress.coins, 0); assert.equal(saved.checkpoint.progress.attackRank, 1); assert.equal(saved.checkpoint.progress.armorRank, 1);
    assert.ok(bought[0].revision <= saved.revision);
    bot.send([{ kind: 'forgeUpgrade', npcId: 'pip', slot: 'weapon', request: 113 }]);
    await until(() => bot.results.some(r => r.request === 113 && r.status === 'failed') || rt.failures.length);
    assert.equal(bot.results.find(r => r.request === 113).code, 'equipment-coins'); assert.deepEqual(bot.errors, []);
  } finally { bot?.ws.close(); await rt.close(); }
});

 test('unsafe persisted identity is masked only in public appearance and party controls', { timeout: 10000 }, async () => {
  const c = await character();
  await pool.query("UPDATE world_characters SET identity_json=jsonb_set(identity_json::jsonb,'{appearance,name}',$1::jsonb)::text WHERE character_id=$2", [JSON.stringify('call 01012345678'), c.record.characterId]);
  const rt = await runtime({ party: true }); let bot;
  try {
    bot = await client(rt, c); await ready(rt, bot);
    assert.equal(bot.state.actors.find(a => a.ref.id === bot.state.selfRef.id).appearance.name, '게 모험가');
    bot.send([{ kind: 'partyCreate' }]);
    await until(() => bot.controls.some(control => control.type === 'party' && control.state));
    assert.equal(bot.controls.findLast(control => control.type === 'party' && control.state).state.members[0].name, '게 모험가');
    assert.equal((await store.getOwned(c.binding.accountId, c.record.characterId)).identity.appearance.name, 'call 01012345678');
    assert.deepEqual(bot.errors, []);
  } finally { bot?.ws.close(); await rt.close(); }
});

 test('real account chat filters, persists local mute/preferences and isolates party delivery; three reports shadow-mute without leaking moderation state', { timeout: 15000 }, async () => {
  const rt = await runtime({ party: true, chat: true }); const bots = [], records = [];
  const controls = (b, type) => b.controls.filter(c => c.type === type);
  const lines = b => controls(b, 'chatLine');
  async function operation(bot, command) {
    const n = controls(bot, 'chatResult').length; bot.send([command]);
    await until(() => controls(bot, 'chatResult').length > n || rt.failures.length);
    assert.deepEqual(rt.failures, []); return controls(bot, 'chatResult').at(-1);
  }
  try {
    for (let i = 0; i < 4; i++) { const record = await character();
      if(i===3){const {setQuestChapter}=await import('../../src/sim/data/quests.ts');const checkpoint=structuredClone(record.record.checkpoint),spawn=loaded.get('w2').publicDefinition.spawn;checkpoint.world='w2';checkpoint.location={...spawn.position,yaw:spawn.yaw};setQuestChapter(checkpoint.progress.quests,2);record.record=await store.saveCheckpoint(record.binding.accountId,record.record.characterId,record.record.revision,checkpoint,[]);}
      const bot = await client(rt, record); records.push(record); bots.push(bot); await ready(rt, bot); }
    await until(() => bots.every(b => controls(b, 'chatPreferences').length));
    const [a,b,c,d] = bots;
    assert.equal((await operation(a, { kind: 'chatSay', channel: 'area', text: 'call 01012345678' })).ok, true);
    await until(() => bots.slice(0,3).every(bot => lines(bot).length === 1)); assert.equal(lines(d).length,0);
    assert.ok(lines(b)[0].line.text.includes('***')); assert.ok(!JSON.stringify(lines(b)).includes('01012345678'));
    assert.ok(!JSON.stringify(a.controls).includes(records[0].binding.accountId));
    assert.equal((await operation(b, { kind: 'chatMute', target: a.state.selfRef, muted: true })).ok, true);
    await delay(710); await operation(a, { kind: 'chatSay', channel: 'area', text: 'muted local check' });
    await until(() => lines(c).length === 2); assert.equal(lines(b).length,1);
    const bState = (await pool.query('SELECT muted FROM world_chat_targets WHERE owner_account=$1 AND target_account=$2', [records[1].binding.accountId, records[0].binding.accountId])).rows[0]; assert.equal(bState.muted,true);
    a.send([{kind:'partyCreate'}]); await until(() => controls(a,'party').at(-1)?.state);
    b.send([{kind:'partyJoin',code:controls(a,'party').at(-1).state.code}]); await until(() => controls(a,'party').at(-1)?.state?.members.length === 2);
    await operation(b, {kind:'chatMute',target:a.state.selfRef,muted:false});
    await delay(710); const outsiderLines=lines(c).length;
    await operation(a, {kind:'chatSay',channel:'party',text:'party hello'}); await until(() => lines(b).at(-1)?.line.text === 'party hello'); assert.equal(lines(c).length,outsiderLines);
    await operation(b, {kind:'chatPreferences',enabled:false,partyOnly:true});
    assert.deepEqual(controls(b,'chatPreferences').at(-1), {type:'chatPreferences',enabled:false,partyOnly:true});
    const preferenceCount=controls(b,'chatPreferences').length, partyCount=controls(b,'party').length;
    const clientProtocol=createGameplayProtocol(gameplayCatalog);
    for(const chunk of clientProtocol.encodeControl({...b.binding,sequence:1,tick:0,acceptedInput:0,consumedInput:0},{type:'resync',lastSequence:b.state.sequence,reason:'gap'})) b.ws.send(chunk);
    await until(()=>controls(b,'chatPreferences').length>preferenceCount&&controls(b,'party').length>partyCount);
    assert.equal(controls(b,'chatPreferences').at(-1).enabled,false);
    b.ws.close(); await once(b.ws,'close'); const replacement=await client(rt,records[1]); bots.push(replacement); await ready(rt,replacement);
    await until(() => controls(replacement,'chatPreferences').length); assert.equal(controls(replacement,'chatPreferences').at(-1).enabled,false);
    for (const reporter of [replacement,c,d]) { const result=await operation(reporter,{kind:'chatReport',target:a.state.selfRef,reason:'personal'}); assert.equal(result.ok,true); assert.equal(Object.hasOwn(result,'muted'),false); }
    await delay(710); const before=lines(c).length, ownBefore=lines(a).length;
    await operation(a,{kind:'chatSay',channel:'area',text:'shadow muted own echo'}); await until(() => lines(a).length > ownBefore); assert.equal(lines(c).length,before);
    const reports=await pool.query('SELECT target_lines FROM chat_reports WHERE target_account=$1',[records[0].binding.accountId]); assert.equal(reports.rows.length,3); assert.ok(!JSON.stringify(reports.rows).includes('01012345678'));
    assert.deepEqual(bots.flatMap(bot=>bot.errors),[]);
  } finally { for (const b of bots) b.ws.close(); await rt.close(); }
});

test('actual PG ownership backend loss during blocked checkpoint suppresses late snapshot and durable command publication although old SQL may commit', { timeout: 12000 }, async () => {
  const c = await character(); let bot, blocker, armed = false; let oldResult;
  const delayed = new Proxy(store,{get(target,key){if(key==='saveCheckpoint')return async(...args)=>{if(armed){armed=false;blocker=await pool.connect();await blocker.query('BEGIN');await blocker.query('SELECT 1 FROM world_characters WHERE character_id=$1 FOR UPDATE',[c.record.characterId]);}return target.saveCheckpoint(...args);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  const rt = await runtime({victimRetry:true,characters:delayed});
  try {
    bot = await client(rt, c); await ready(rt, bot); await until(() => !rt.host.stats().durableBarrier);
    const owner = (await pool.query("SELECT pid FROM pg_locks WHERE locktype='advisory' AND granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())")).rows;
    assert.equal(owner.length,1);
    const before = await store.getOwned(c.binding.accountId,c.record.characterId); armed = true;
    bot.send([{kind:'questAccept',questId:'q1',npcId:'brinebeard'}]);
    for(let i=0;;i++) { const waiting=(await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%world_characters%FOR UPDATE%'" )).rowCount; if(waiting)break; if(i>200)throw new Error('checkpoint did not block'); await delay(10); }
    const stateSequence=bot.state.sequence, resultsBefore=bot.results.length;
    await pool.query('SELECT pg_terminate_backend($1)',[owner[0].pid]); await until(() => rt.ownership.closed.aborted);
    await blocker.query('COMMIT'); blocker.release(); blocker=null;
    await until(() => !rt.host.stats().durableBarrier); await delay(50);
    assert.equal(bot.state.sequence,stateSequence); assert.equal(bot.results.length,resultsBefore); assert.equal(rt.host.stats().frozen,true);
    assert.equal(await rt.host.retryDurability({maxEntries:2048,maxPayloadBytes:8*1024*1024,timeoutMs:5000}),false);
    const after=await store.getOwned(c.binding.accountId,c.record.characterId);
    assert.equal(after.revision,before.revision+1); assert.equal(after.checkpoint.progress.quests.status.q1,'active');
    assert.deepEqual(bot.errors,[]);
  } finally { if(blocker){await blocker.query('ROLLBACK');blocker.release();}bot?.ws.close();oldResult=await rt.close(); }
  assert.equal(oldResult.durable,false);
  const next=await runtime();let resumed;
  try {resumed=await client(next,c);await ready(next,resumed);assert.equal(resumed.state.self.player.quests.status.q1,'active');assert.deepEqual(resumed.errors,[]);}finally{resumed?.ws.close();await next.close();}
});

test('chat bounds pending DB work and discards a late committed line after authoritative party scope changes', { timeout: 10000 }, async () => {
 const record=await character(), rt=await runtime({party:true,chat:true});let bot,blocker;
 try {
  bot=await client(rt,record);await ready(rt,bot);await until(()=>bot.controls.some(c=>c.type==='chatPreferences'));
  blocker=await pool.connect();await blocker.query('BEGIN');await blocker.query('SELECT 1 FROM world_chat_accounts WHERE account_id=$1 FOR UPDATE',[record.binding.accountId]);
  bot.send([{kind:'chatSay',channel:'area',text:'late obsolete scope'}]);await until(()=>rt.host.stats().pendingChat===1);
  bot.send([{kind:'chatSay',channel:'area',text:'bounded overload'}]);await until(()=>bot.controls.some(c=>c.type==='chatResult'&&c.inputSequence===2));
  assert.equal(bot.controls.find(c=>c.type==='chatResult'&&c.inputSequence===2).error,'unavailable');assert.equal(rt.host.stats().pendingChat,1);
  bot.send([{kind:'partyCreate'}]);await until(()=>bot.controls.some(c=>c.type==='party'&&c.state));
  await blocker.query('COMMIT');blocker.release();blocker=null;await until(()=>rt.host.stats().pendingChat===0);await delay(30);
  assert.equal(bot.controls.some(c=>c.type==='chatLine'&&c.line.text==='late obsolete scope'),false);
  assert.equal(bot.controls.some(c=>c.type==='chatResult'&&c.inputSequence===1),false);
  assert.deepEqual(bot.errors,[]);assert.deepEqual(rt.failures,[]);
 }finally{if(blocker){await blocker.query('ROLLBACK');blocker.release();}bot?.ws.close();await rt.close();}
});

test('257 trusted offline journal fixtures drain through committed bounded pages before the first public baseline without duplicate rewards', { timeout: 10000 }, async () => {
 const c=await character();
 for(let offset=0;offset<257;offset+=100){const entries=[];for(let i=offset;i<Math.min(257,offset+100);i++){const victim={area:'trusted-offline-fixture',id:i+1,life:1},id=JSON.stringify([victim.area,victim.id,victim.life,c.record.characterId]);entries.push({accountId:c.binding.accountId,characterId:c.record.characterId,id,payload:{id,victim,recipient:c.record.characterId,xp:0,coins:1,objectives:[],flags:[]}});}await store.recordGrantBatch(entries);}
 const rt=await runtime();let bot;
 try{bot=await client(rt,c);await ready(rt,bot);assert.equal(bot.state.self.player.coins,257);assert.equal(bot.state.self.player.xp,0);
  const receipts=await pool.query('SELECT applied_revision,count(*)::int n FROM world_character_grant_receipts WHERE character_id=$1 GROUP BY applied_revision ORDER BY applied_revision',[c.record.characterId]);
  assert.deepEqual(receipts.rows.map(r=>r.n),[100,100,57]);assert.equal((await store.pendingGrants(c.binding.accountId,c.record.characterId)).length,0);assert.deepEqual(bot.errors,[]);assert.deepEqual(rt.failures,[]);
 }finally{bot?.ws.close();await rt.close();}
 const resumed=await runtime();let next;try{next=await client(resumed,c);await ready(resumed,next);assert.equal(next.state.self.player.coins,257);}finally{next?.ws.close();await resumed.close();}
});

 test('insufficient whole outcome budget freezes complete two-contributor source with no journal or public reward', { timeout: 12000 }, async () => {
  const rt=await runtime({combat:true,victimMaxEntries:1}),bots=[],records=[],timers=[];
  try {
    for(let i=0;i<2;i++){const record=await character('mage'),bot=await client(rt,record);records.push(record);bots.push(bot);await ready(rt,bot);}
    for(const bot of bots){const target=bot.state.actors.find(a=>a.kind==='scrapling');bot.send([{kind:'target',target:target.ref},{kind:'ability',slot:1}]);timers.push(setInterval(()=>{if(bot.ws.readyState===WebSocket.OPEN)bot.send([]);},50));}
    await until(()=>rt.host.stats().frozen,10000);assert.equal(rt.host.stats().pendingSourceGrants,2);
    assert.ok(rt.failures.some(f=>f.stage==='durability'&&f.message.includes('complete source retained')));
    assert.equal((await pool.query('SELECT 1 FROM world_character_grants WHERE character_id=ANY($1::uuid[])',[records.map(c=>c.record.characterId)])).rowCount,0);
    for(const bot of bots){assert.equal(bot.state.self.player.xp,0);assert.deepEqual(bot.errors,[]);}
  }finally{for(const t of timers)clearInterval(t);for(const b of bots)b.ws.close();const result=await rt.close();assert.equal(result.durable,false);}
});

test('resource-only outcome pause retries the same retained Area within explicit ceiling and reopens only after complete durable reconciliation', { timeout: 12000 }, async () => {
 const rt=await runtime({combat:true,victimMaxEntries:1,victimRetry:true}),bots=[],records=[],timers=[];let resumed;
 try {
  for(let i=0;i<2;i++){const c=await character('mage'),b=await client(rt,c);records.push(c);bots.push(b);await ready(rt,b);}
  const area=bots[0].binding.area;
  for(const b of bots){const target=b.state.actors.find(a=>a.kind==='scrapling');b.send([{kind:'target',target:target.ref},{kind:'ability',slot:1}]);timers.push(setInterval(()=>{if(b.ws.readyState===WebSocket.OPEN)b.send([]);},50));}
  await until(()=>rt.host.stats().resourcePaused&&!rt.host.stats().durableBarrier,10000);
  assert.equal(rt.host.stats().accepting,false);assert.equal(rt.host.stats().pendingSourceGrants,2);
  await assert.rejects(rt.host.retryDurability({maxEntries:2049,maxPayloadBytes:8*1024*1024,timeoutMs:5000}),/ceiling/);
  assert.equal(await rt.host.retryDurability({maxEntries:2,maxPayloadBytes:8*1024*1024,timeoutMs:5000}),true);
  assert.equal(rt.host.stats().resourcePaused,false);assert.equal(rt.host.stats().pendingSourceGrants,0);assert.equal(rt.host.stats().unresolved,0);assert.equal(rt.host.stats().accepting,true);
  for(const c of records)assert.equal((await store.getOwned(c.binding.accountId,c.record.characterId)).checkpoint.progress.xp,20);
  resumed=await client(rt,records[0]);await until(()=>resumed.state);assert.equal(resumed.binding.area,area);assert.equal(resumed.state.self.player.xp,20);assert.deepEqual(resumed.errors,[]);
  assert.equal(await rt.host.retryDurability({maxEntries:3,maxPayloadBytes:8*1024*1024,timeoutMs:5000}),false);
 }finally{for(const t of timers)clearInterval(t);for(const b of bots)b.ws.close();resumed?.ws.close();assert.equal((await rt.close()).durable,true);}
});

 test('generic actual PG checkpoint failure never becomes a resumable outcome resource pause', { timeout: 10000 }, async () => {
  const c=await character(), rt=await runtime({victimRetry:true});let bot;
  try {
   bot=await client(rt,c);await ready(rt,bot);await until(()=>!rt.host.stats().durableBarrier);
   await pool.query("CREATE FUNCTION qa_checkpoint_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.character_id::text=TG_ARGV[0] THEN RAISE EXCEPTION 'qa failure' USING ERRCODE='XX000'; END IF; RETURN NEW; END $$");
   await pool.query(`CREATE TRIGGER qa_checkpoint_failure BEFORE UPDATE ON world_characters FOR EACH ROW EXECUTE FUNCTION qa_checkpoint_failure('${c.record.characterId}')`);
   bot.send([{kind:'questAccept',questId:'q1',npcId:'brinebeard'}]);await until(()=>rt.host.stats().frozen&&!rt.host.stats().durableBarrier);
   assert.equal(rt.host.stats().resourcePaused,false);assert.equal(await rt.host.retryDurability({maxEntries:2048,maxPayloadBytes:8*1024*1024,timeoutMs:5000}),false);assert.equal(rt.host.stats().accepting,false);
   assert.equal((await store.getOwned(c.binding.accountId,c.record.characterId)).checkpoint.progress.quests.status.q1,'available');
  }finally{await pool.query('DROP TRIGGER IF EXISTS qa_checkpoint_failure ON world_characters');await pool.query('DROP FUNCTION IF EXISTS qa_checkpoint_failure()');bot?.ws.close();assert.equal((await rt.close()).durable,false);}
});

 test('actual host certifies a pending candidate against a newer committed checkpoint before any replay', { timeout: 10000 }, async () => {
  const c=await character(),victim={area:'trusted-certification-fixture',id:1,life:1},id=JSON.stringify([victim.area,victim.id,victim.life,c.record.characterId]);
  await store.recordGrant(c.binding.accountId,c.record.characterId,id,{id,victim,recipient:c.record.characterId,xp:25,coins:1,objectives:[],flags:[]});
  let raced=false;
  const racing=new Proxy(store,{get(target,key){if(key==='pendingGrants')return async(...args)=>{const candidates=await target.pendingGrants(...args);if(!raced&&args[1]===c.record.characterId){raced=true;const checkpoint=structuredClone(c.record.checkpoint);checkpoint.progress.xp=25;checkpoint.progress.coins=1;await target.saveCheckpoint(c.binding.accountId,c.record.characterId,0,checkpoint,[id]);}return candidates;};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  const rt=await runtime({characters:racing});let bot;
  try{bot=await client(rt,c);await ready(rt,bot);assert.equal(raced,true);assert.equal(bot.state.self.player.xp,25);assert.equal(bot.state.self.player.coins,1);assert.equal(rt.host.stats().recoveries,1);assert.equal((await store.loadForRecovery(c.binding.accountId,c.record.characterId,[id])).grants[0].appliedRevision,1);assert.deepEqual(rt.failures,[]);assert.deepEqual(bot.errors,[]);}
  finally{bot?.ws.close();await rt.close();}
});

test('disconnect during a certified read discards the old connection lease and recertifies before reconnect delivery', { timeout: 10000 }, async () => {
 const c=await character();let armed=false,entered=false,release;const gate=new Promise(resolve=>{release=resolve;});
 const delayed=new Proxy(store,{get(target,key){if(key==='pendingGrants')return async(...args)=>{const rows=await target.pendingGrants(...args);if(armed){armed=false;entered=true;await gate;}return rows;};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 const rt=await runtime({characters:delayed,grace:10000});let bot,resumed;
 try{
  bot=await client(rt,c);await ready(rt,bot);await until(()=>!rt.host.stats().durableBarrier);
  const victim={area:'trusted-lease-fixture',id:1,life:1},id=JSON.stringify([victim.area,victim.id,victim.life,c.record.characterId]);
  await store.recordGrant(c.binding.accountId,c.record.characterId,id,{id,victim,recipient:c.record.characterId,xp:1,coins:1,objectives:[],flags:[]});
  armed=true;bot.send([{kind:'questAccept',questId:'q1',npcId:'brinebeard'}]);await until(()=>entered);
  bot.ws.close();await once(bot.ws,'close');await delay(20);release();await until(()=>!rt.host.stats().durableBarrier);
  resumed=await client(rt,c);await ready(rt,resumed);assert.equal(resumed.state.self.player.xp,1);assert.equal(resumed.state.self.player.coins,1);assert.equal(resumed.state.self.player.quests.status.q1,'active');
  assert.equal((await store.loadForRecovery(c.binding.accountId,c.record.characterId,[id])).grants[0].appliedRevision!==null,true);assert.deepEqual(rt.failures,[]);assert.deepEqual(resumed.errors,[]);
 }finally{release();bot?.ws.close();resumed?.ws.close();await rt.close();}
});
