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
import { loadWorldCatalog } from './catalog.ts';
import { createActualWorldHost } from './host.ts';
import { createCoreCharacterCodec, PERSONAL_FLAG_IDS } from '../../src/sim/persistence.ts';
import { createWorldVariants, personalNpcVisible } from '../../src/sim/areas/variants.ts';
import { QUESTS } from '../../src/sim/data/quests.ts';
import { RACES } from '../../src/data/races.ts';
import { createGameplayProtocol, GameplayReceiver } from './gameplay/protocol.ts';
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
  damageAllowed: (_context, source, target) => !(source?.kind === 'player' && target.kind === 'player'), canInteract: () => true };
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
  const motion = JSON.parse(await readFile(new URL('../../src/sim/data/pose-data.json', import.meta.url), 'utf8'));
  const definitions = [...loaded.values()].map(w => w.publicDefinition);
  gameplayCatalog = { version: motion.version, archetypes: [...Object.keys(motion.archetypes), 'boss-rust', 'boss-abyss', 'boss-eclipse', 'boss-dawn', 'boss-frost'],
    actions: Object.keys(motion.clips), abilities: ['pincer-strike','shell-bash','sideways-charge','whirlpool','bubble-bolt','frost-spray','steam-blink','tidal-nova','smite','mend-shell','bubble-bolt','holy-tide','crown-burst'],
    quests: Object.keys(QUESTS), npcs: [...new Set(definitions.flatMap(d => d.npcs.map(n => n.id)))],
    interactions: [...new Set(definitions.flatMap(d => [...d.interactions.map(i => i.id), ...d.npcs.map(n => 'npc:' + n.id)]))],
    gates: [...new Set(definitions.flatMap(d => d.interactions.filter(i => i.kind === 'gate').map(i => i.id)))],
    objectives: [...new Set([...Object.values(QUESTS).flatMap(q => q.objectives.map(o => o.id)), 'patrol-kills'])],
    flags: PERSONAL_FLAG_IDS, jointCount: 22, appearanceLimits: Object.fromEntries(Object.entries(RACES).map(([id, r]) => [id, { shell: r.shellColors.length, crest: r.crestStyles.length, led: r.ledColors.length }])) };
});
after(async () => { await pool?.end(); cluster?.stop(); });

async function character(classId = 'warrior') {
  const accountId = 'g' + (++accountNumber).toString(16).padStart(23, '0'), sessionKey = accountNumber.toString(16).padStart(64, '0'), expiresAt = Date.now() + 60000;
  await pool.query('INSERT INTO accounts(username,updated,created) VALUES($1,0,0)', [accountId]);
  await pool.query('INSERT INTO sessions(token_hash,username,expires) VALUES($1,$2,$3)', [sessionKey, accountId, expiresAt]);
  return { record: await store.create(accountId, { ...identity, classId, appearance: { ...appearance, classId } }), binding: { accountId, sessionKey, expiresAt } };
}
function extras(snapshot, characterId) {
  const p = snapshot.players.find(p => p.character === characterId), f = snapshot.features;
  const ref = id => id === null ? null : f.bindings[id];
  const v = f.village;
  return { features: { environment: { beacon: f.beaconLit, clock: snapshot.time }, boat: { ...f.boat, seats: f.boat.seats.map(ref) },
    village: v ? { ...v, starter: ref(v.starter), seeker: ref(v.seeker), members: v.members.map(ref), caught: v.caught.map(ref) } : null },
    recovery: snapshot.recovery, achievements: p.achievements };
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
      offlineSeconds: (record, now) => Math.max(0, now - record.updatedAt) / 1000,
      visible: (unit, viewer) => personalNpcVisible(worlds.get(viewer.quests.chapter === 1 ? 'w1' : 'w' + viewer.quests.chapter).publicDefinition, unit.npcId, viewer.flags),
      observationExtras: extras },
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
      }
    } catch (error) { bot.errors.push(error.message); }
  });
  await once(ws, 'open');
  if (auth) ws.send(JSON.stringify({ type: 'authenticate', ticket: rt.admission.issue(c.binding, origin).ticket, characterId: c.record.characterId }));
  bot.send = commands => ws.send(encodeInput({ binding: bot.binding, intent: { seq: ++bot.sequence, forward: 0, strafe: 0, turn: 0, sprint: false, steeringYaw: null, heldChannel: null, commands } }, gameplayCatalog));
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

test('disconnect retirement saves dead-independent checkpoint, releases capacity and resumes from PG after new host', { timeout: 10000 }, async () => {
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
