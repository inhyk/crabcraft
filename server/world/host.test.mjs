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
  const host = createActualWorldHost({ admission, characters: store, worlds, codec, ownership,
    gameplay: { catalog: gameplayCatalog, create: () => createGameplayProtocol(gameplayCatalog) },
    policies: { authTimeoutMs: 500, inputTimeoutMs: 250, reconnectGraceMs: options.grace ?? 2000, sessionRevalidateMs: 100,
      checkpointIntervalMs: 1000, maxConnections: 16, maxConnectionsPerIp: 16, maxWaiting: 16,
      maxAuthFrameBytes: 1024, maxFrameBytes: 65536, maxBufferedBytes: 8 * 1024 * 1024, maxQueuedInputs: 128,
      maxMutationSourcesPerTick: 64, loopIntervalMs: 2,
      persistence: { maxQueuedPerCharacter: 1, maxAttempts: 2, retryMs: 1, maxRecoveryRounds: 2 },
      areaLimits: { eventCount: 4096, inputCommandsPerTick: 32, timers: 256, projectiles: 256 }, restore: explicitRestore,
      party: options.party ? { maxParties: 8, maxEncounters: 8, returnSpawn: () => 'bossArena' } : undefined,
      offlineSeconds: (record, now) => Math.max(0, now - record.updatedAt) / 1000,
      visible: (unit, viewer) => personalNpcVisible(worlds.get(viewer.quests.chapter === 1 ? 'w1' : 'w' + viewer.quests.chapter).publicDefinition, unit.npcId, viewer.flags),
      observationExtras: projectObservationExtras },
    originAllowed: value => value === origin, clientIp: () => '127.0.0.1', nowMonotonicMs: () => performance.now(), nowWallMs: Date.now,
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
  const bot = { ws, state: null, receiver: null, binding: null, sequence: 0, events: [], errors: [], controls: [], packets: 0 };
  ws.on('message', (bytes, binary) => {
    try {
      if (!binary) {
        const value = JSON.parse(bytes.toString()); bot.controls.push(value);
        if (value.type === 'world-bound') { const { type: _type, ...binding } = value; bot.binding = binding; bot.sequence = 0; bot.receiver = new GameplayReceiver(binding, gameplayCatalog); }
      } else {
        bot.packets++; const result = bot.receiver.accept(bytes, performance.now() / 1000);
        if (result?.kind === 'snapshot') { bot.state = result.state; bot.events.push(...result.events); }
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
