import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { startPostgres } from '../node/local-postgres.mjs';
import { createPool, migrate } from '../node/db.ts';
import { CharacterStore } from './character-store.ts';
import { DungeonCompletionStore } from './dungeon-completion-store.ts';
import { WorldTicketRegistry } from './admission.ts';
import { acquireHostOwnership } from './ownership.ts';
import { WorldChatService } from './chat.ts';
import { loadWorldCatalog, createGameplayCatalog } from './catalog.ts';
import { createActualWorldHost } from './host.ts';
import { createArea } from '../../src/sim/area.ts';
import { deliverCertifiedAreaPage, PagedOutcomeRecovery, verifyPagedOutcomeSeal, AreaSourceDrain } from './persistence-coordinator.ts';
import { DurableOutcomeStore } from './contribution-store.ts';
import { planOutcomePage } from '../../src/sim/ledger.ts';

import { createCoreCharacterCodec } from '../../src/sim/persistence.ts';
import { createWorldVariants, personalNpcVisible } from '../../src/sim/areas/variants.ts';
import { createGameplayProtocol, GameplayReceiver, FragmentAssembler, encodeMessage, projectObservationExtras } from './gameplay/protocol.ts';
import { WorldClient } from '../../src/multiplayer/worldClient.ts';
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
  // options.enemies (default 1) places that many copies of it in a small grid there, for steady kills.
  if (options.combat) worlds.set('w1', { ...base, publicDefinition: { ...base.publicDefinition, enemies: Array.from({ length: options.enemies ?? 1 }, (_, k) => {
    const x = spawn.x + 3 + (k % 3) * 1.5, z = spawn.z + Math.floor(k / 3) * 1.5;
    return { ...base.publicDefinition.enemies[0], ...(k ? { id: base.publicDefinition.enemies[0].id.replace(/:\d+$/, `:${k}`) } : {}), home: { x, y: base.query.heightAt(x, z), z }, wanderRadius: 0 };
  }) } });
  const failures = [];
  let host;
  try { host = createActualWorldHost({ admission, characters: options.characters ?? store, worlds, codec, ownership, dungeonCompletions: options.dungeons ? new DungeonCompletionStore(pool) : undefined, outcomes: options.withoutOutcomes ? undefined : options.ledger ? options.outcomes ?? new DurableOutcomeStore(pool,codec,{planOutcomePage}) : options.outcomes, chat: options.chat ? new WorldChatService(pool) : undefined,
    gameplay: { catalog: gameplayCatalog, create: () => createGameplayProtocol(gameplayCatalog, { verify: options.verify ?? true }), verifyObservations: options.verify ?? true },
    policies: { authTimeoutMs: options.capacity ? 2000 : 500, inputTimeoutMs: 250, reconnectGraceMs: options.grace ?? 2000, sessionRevalidateMs: 100,
      checkpointIntervalMs: options.checkpointIntervalMs ?? 1000, maxConnections: options.capacity ? 110 : 16, maxConnectionsPerIp: options.capacity ? 110 : 16, maxWaiting: options.capacity ? 110 : 16,
      maxAuthFrameBytes: 1024, maxFrameBytes: 65536, maxBufferedBytes: 8 * 1024 * 1024, maxQueuedInputs: 128,
      maxMutationSourcesPerTick: 64, loopIntervalMs: 2, ledger: options.ledger ? {sourceLimits:options.ledgerSourceLimits??sourceLimits,drainLimits:{pageSize:100,creditBatchesPerSlice:1,outcomesPerSlice:1,summaryVictimsPerSlice:10,writeAttempts:2},recoveryLimits:{draftsPerSlice:10,pageSize:options.recoveryPageSize??100},recoveryIntervalMs:options.recoveryIntervalMs??100} : undefined, chat: options.chat ? { maxPending: 4 } : undefined,
      victimOutcome: { maxEntries: options.victimMaxEntries ?? 2048, maxPayloadBytes: 8 * 1024 * 1024, timeoutMs: 5000 },
      victimOutcomeRetryCeiling: options.victimRetry ? { maxEntries: 2048, maxPayloadBytes: 8 * 1024 * 1024, timeoutMs: 5000 } : undefined,
      persistence: { maxQueuedPerCharacter: 1, maxAttempts: 2, retryMs: 1, maxRecoveryRounds: 2 },
      areaLimits: { eventCount: 4096, inputCommandsPerTick: 32, timers: 256, projectiles: 256 }, restore: explicitRestore,
      party: options.party || options.dungeons ? { maxParties: 8, maxEncounters: 8, returnSpawn: () => 'bossArena' } : undefined,
      dungeons: options.dungeons ? { tiers: [35, 50], maxPendingAwards: 8 } : undefined,
      offlineSeconds: (record, now) => Math.max(0, now - record.updatedAt) / 1000,
      visible: (unit, viewer) => personalNpcVisible(worlds.get(viewer.quests.chapter === 1 ? 'w1' : 'w' + viewer.quests.chapter).publicDefinition, unit.npcId, viewer.flags),
      observationExtras: projectObservationExtras },
    originAllowed: value => value === origin, clientIp: () => '127.0.0.1', nowMonotonicMs: () => options.capacity ? 0 : performance.now(), nowWallMs: Date.now,
    onFailure: (stage, error) => { failures.push({ stage, message: error.message }); },
  }); } catch(error) { await ownership.release(); throw error; }
  const server = createServer(); server.on('upgrade', host.handleUpgrade); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `ws://127.0.0.1:${server.address().port}/world`;
  if(!options.deferReady)try{await host.ready();}catch(error){await host.shutdown(1000);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await ownership.release();throw error;}
  return { host, admission, ownership, url, failures, async close() {
    const result = await host.shutdown(3000); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await ownership.release();
    return result;
  } };
}
async function client(rt, c, auth = true) {
  const ws = new WebSocket(rt.url, { headers: { Origin: origin } });
  const bot = { ws, state: null, receiver: null, binding: null, sequence: 0, events: [], results: [], errors: [], controls: [], messages: [], packets: 0 };
  ws.on('message', (bytes, binary) => {
    try {
      if (!binary) {
        const value = JSON.parse(bytes.toString()); bot.controls.push(value);
        if (value.type === 'world-bound') { const { type: _type, ...binding } = value; bot.binding = binding; bot.sequence = 0; bot.receiver = new GameplayReceiver(binding, gameplayCatalog); bot.tap = new FragmentAssembler(binding); }
      } else {
        bot.packets++; const captured=bot.tap.accept(bytes,performance.now()/1000);if(captured)bot.messages.push({kind:captured.kind,header:captured.header,control:captured.kind===17?captured.payload:null});const result = bot.receiver.accept(bytes, performance.now() / 1000);
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
// Retained saves are batched once per checkpointIntervalMs while the world keeps running, so progress a client already sees
// is in PG once the next save round that starts after it has finished (persistenceBarriers counts started rounds).
async function afterSave(rt, ms = 5000) { const next = rt.host.stats().persistenceBarriers + 1; await until(() => rt.host.stats().persistenceBarriers >= next && !rt.host.stats().durableBarrier || rt.failures.length, ms); }
async function ready(rt, bot) { await until(() => bot.state || bot.controls.some(v => v.type === 'error') || rt.failures.length); assert.deepEqual(rt.failures, []); assert.deepEqual(bot.errors, []); assert.ok(bot.state, JSON.stringify(bot.controls)); }

for(const ledger of [false,true])test(ledger?'external delayed ability has full reward/save and live reconnect':'real PG+WS login, level1 ability hit/death/full reward, durable save and authenticated live reconnect', { timeout: 20000 }, async () => {
  const rt = await runtime({ combat: true, ledger });
  try {
    const c = await character('mage'), bot = await client(rt, c); await ready(rt, bot);
    assert.equal(bot.state.self.player.xp, 0); assert.equal(bot.state.actors.find(a => a.ref.id === bot.state.selfRef.id).level, 1);
    const target = bot.state.actors.find(a => a.kind === 'scrapling'); assert.ok(target);
    bot.send([{ kind: 'target', target: target.ref }, { kind: 'ability', slot: 1 }]);
    const heartbeat = setInterval(() => { if (bot.ws.readyState === WebSocket.OPEN) bot.send([]); }, 50);
    try { await until(() => bot.state.self.player.xp > 0 || rt.failures.length || bot.controls.some(v => v.type === 'error'), 10000); }
    catch { throw new Error(JSON.stringify({ self: bot.state.self.player, target: bot.state.actors.find(a => a.ref.id === target.ref.id), selfActor: bot.state.actors.find(a => a.ref.id === bot.state.selfRef.id), events: bot.events.map(e => e.event), controls: bot.controls, errors: bot.errors, stats: rt.host.stats() })); }
    clearInterval(heartbeat); await afterSave(rt);
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
    await afterSave(rt); assert.deepEqual(rt.failures, []);
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
    const original = bot.binding.epoch, entry = base.encounterDefinitions.get('rust').pois['encounter:entry'];
    // A genuine external revision forces the host's freeze/load/restore path, then validates the real entrance.
    let written = false;
    for (let attempt = 0; attempt < 10 && !written; attempt++) {
      const current = await store.getOwned(c.binding.accountId, c.record.characterId), next = structuredClone(current.checkpoint);
      next.location = { ...entry.position, yaw: entry.yaw };
      try { await store.saveCheckpoint(c.binding.accountId, c.record.characterId, current.revision, next, []); written = true; }
      catch (error) { if (error.code !== 'conflict') throw error; }
    }
    assert.equal(written, true);
    await until(() => bot.binding.epoch > original && Math.abs(bot.state.actors.find(a => a.ref.id === bot.state.selfRef.id).x - entry.position.x) < .5 || rt.failures.length, 5000);
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

for(const ledger of [false,true])test(ledger?'external 100 actual sockets and 101st queue preserve one public Area and cancel cleanly (paused simulation clock)':'100 actual authenticated sockets occupy one public Area; 101st queues, takes a released seat and cancels cleanly (paused simulation clock)', { timeout: 30000 }, async () => {
  const rt = await runtime({ capacity: true, grace: 0, ledger }); const bots = [];
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

for(const ledger of [false,true])test(ledger?'external four real worlds round-trip through validated gate intents with unchanged XP and retained ultimate cooldown':'all four real worlds round-trip through validated gate intents with unchanged XP and retained ultimate cooldown', { timeout: 25000 }, async () => {
  const rt = await runtime({ledger}); let bot;
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
      const world = loaded.get(from), gate = world.publicDefinition.interactions.find(i => i.id === `gate:${to}`), oldEpoch = bot.binding.epoch;
      await afterSave(rt); // The fixture below rewrites the stored checkpoint; it must contain the progress shown so far.
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
      await until(() => bot.binding.epoch > oldEpoch && bot.state.world === from || rt.failures.length, 5000);
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
    const oldEpoch = bot.binding.epoch, pip = loaded.get('w1').publicDefinition.npcs.find(n => n.id === 'pip');
    // Trusted shop-readiness fixture only; the actual two purchases and failures run through core commands.
    let written = false;
    for (let attempt = 0; attempt < 10 && !written; attempt++) {
      const current = await store.getOwned(c.binding.accountId, c.record.characterId), checkpoint = structuredClone(current.checkpoint);
      checkpoint.location = { ...pip.position, yaw: 0 }; checkpoint.progress.coins = 200;
      try { await store.saveCheckpoint(c.binding.accountId, c.record.characterId, current.revision, checkpoint, []); written = true; }
      catch (error) { if (error.code !== 'conflict') throw error; }
    }
    assert.equal(written, true); await until(() => bot.binding.epoch > oldEpoch || rt.failures.length); assert.deepEqual(rt.failures, []);
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

for(const ledger of [false,true])test(ledger?'external 257 offline pages commit and prune before first baseline without duplicate rewards':'257 trusted offline journal fixtures drain through committed bounded pages before the first public baseline without duplicate rewards', { timeout: 10000 }, async () => {
 const c=await character();
 for(let offset=0;offset<257;offset+=100){const entries=[];for(let i=offset;i<Math.min(257,offset+100);i++){const victim={area:'trusted-offline-fixture',id:i+1,life:1},id=JSON.stringify([victim.area,victim.id,victim.life,c.record.characterId]);entries.push({accountId:c.binding.accountId,characterId:c.record.characterId,id,payload:{id,victim,recipient:c.record.characterId,xp:0,coins:1,objectives:[],flags:[]}});}await store.recordGrantBatch(entries);}
 const rt=await runtime({ledger});let bot;
 try{bot=await client(rt,c);await ready(rt,bot);assert.equal(bot.state.self.player.coins,257);assert.equal(bot.state.self.player.xp,0);
  const receipts=await pool.query('SELECT applied_revision,count(*)::int n FROM world_character_grant_receipts WHERE character_id=$1 GROUP BY applied_revision ORDER BY applied_revision',[c.record.characterId]);
  assert.deepEqual(receipts.rows.map(r=>r.n),[100,100,57]);assert.equal((await store.pendingGrants(c.binding.accountId,c.record.characterId)).length,0);assert.deepEqual(bot.errors,[]);assert.deepEqual(rt.failures,[]);
 }finally{bot?.ws.close();await rt.close();}
 const resumed=await runtime({ledger});let next;try{next=await client(resumed,c);await ready(resumed,next);assert.equal(next.state.self.player.coins,257);}finally{next?.ws.close();await resumed.close();}
});

 test('insufficient whole outcome budget freezes complete two-contributor source with no journal or saved reward', { timeout: 12000 }, async () => {
  const rt=await runtime({combat:true,victimMaxEntries:1}),bots=[],records=[],timers=[];
  try {
    for(let i=0;i<2;i++){const record=await character('mage'),bot=await client(rt,record);records.push(record);bots.push(bot);await ready(rt,bot);}
    for(const bot of bots){const target=bot.state.actors.find(a=>a.kind==='scrapling');bot.send([{kind:'target',target:target.ref},{kind:'ability',slot:1}]);timers.push(setInterval(()=>{if(bot.ws.readyState===WebSocket.OPEN)bot.send([]);},50));}
    await until(()=>rt.host.stats().frozen,10000);assert.equal(rt.host.stats().pendingSourceGrants,2);
    assert.ok(rt.failures.some(f=>f.stage==='durability'&&f.message.includes('complete source retained')));
    assert.equal((await pool.query('SELECT 1 FROM world_character_grants WHERE character_id=ANY($1::uuid[])',[records.map(c=>c.record.characterId)])).rowCount,0);
    // The kill's reward is applied in the Area and may be shown before the save round; nothing of it is durable.
    for(const c of records)assert.equal((await store.getOwned(c.binding.accountId,c.record.characterId)).checkpoint.progress.xp,0);
    for(const bot of bots)assert.deepEqual(bot.errors,[]);
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

test('retained barriers read grant pages only for actors with something to read, under production observation checks', { timeout: 20000 }, async () => {
 const reads=new Map(),count=id=>reads.get(id)??0;
 const counted=new Proxy(store,{get(target,key){if(key==='pendingGrants')return async(...args)=>{reads.set(args[1],count(args[1])+1);return target.pendingGrants(...args);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 const rt=await runtime({characters:counted,verify:false,combat:true});let first,second;
 try{
  const a=await character('mage'),b=await character();first=await client(rt,a);await ready(rt,first);second=await client(rt,b);await ready(rt,second);
  await until(()=>!rt.host.stats().durableBarrier);assert.ok(count(a.record.characterId)>=1&&count(b.record.characterId)>=1,'admission replays its pages');
  // Interval barriers with nothing journaled read no page.
  reads.clear();const barriers=rt.host.stats().persistenceBarriers;await until(()=>rt.host.stats().persistenceBarriers>=barriers+2&&!rt.host.stats().durableBarrier,6000);
  assert.equal(reads.size,0,JSON.stringify([...reads]));
  // A row another writer journals for one actor is read and delivered for that actor only.
  const victim={area:'unread-row-writer',id:1,life:1},id=JSON.stringify([victim.area,victim.id,victim.life,b.record.characterId]);
  await store.recordGrant(b.binding.accountId,b.record.characterId,id,{id,victim,recipient:b.record.characterId,xp:1,coins:1,objectives:[],flags:[]});
  await until(()=>second.state.self.player.xp===1||rt.failures.length,6000);assert.ok(count(b.record.characterId)>=1);assert.equal(count(a.record.characterId),0);
  // This host's own kill reward is applied in the Area and its receipt commits with the recipient's next checkpoint, so the
  // save round reads no page for the recipient or the other actor.
  reads.clear();const target=first.state.actors.find(actor=>actor.kind==='scrapling');assert.ok(target);
  first.send([{kind:'target',target:target.ref},{kind:'ability',slot:1}]);const heartbeat=setInterval(()=>{if(first.ws.readyState===WebSocket.OPEN)first.send([]);},50);
  try{await until(()=>first.state.self.player.xp>0||rt.failures.length,10000);}finally{clearInterval(heartbeat);}
  await afterSave(rt);assert.equal(count(a.record.characterId),0);assert.equal(count(b.record.characterId),0);
  assert.equal((await store.getOwned(a.binding.accountId,a.record.characterId)).checkpoint.progress.xp,first.state.self.player.xp);
  assert.equal((await store.pendingGrants(a.binding.accountId,a.record.characterId)).length,0);
  assert.equal((await pool.query('SELECT count(*)::int n FROM world_character_grant_receipts WHERE character_id=$1',[a.record.characterId])).rows[0].n,1);
  assert.deepEqual(rt.failures,[]);assert.deepEqual(first.errors,[]);assert.deepEqual(second.errors,[]);
 }finally{first?.ws.close();second?.ws.close();await rt.close();}
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

 test('real Area and PG certified adapter drains 257 grants with exact receipt pruning and no retained saved ID history', { timeout: 15000 }, async () => {
  const c=await character(), ownership=await acquireHostOwnership(pool,'certified-area-page-test'),world=loaded.get('w1');
  let area,barrier;
  try {
  for(let offset=0;offset<257;offset+=100){const entries=[];for(let i=offset;i<Math.min(257,offset+100);i++){const victim={area:'adapter-offline',id:i+1,life:1},id=JSON.stringify([victim.area,victim.id,victim.life,c.record.characterId]);entries.push({accountId:c.binding.accountId,characterId:c.record.characterId,id,payload:{id,victim,recipient:c.record.characterId,xp:0,coins:1,objectives:[],flags:[]}});}await store.recordGrantBatch(entries);}
  area=createArea({id:'actual-external-adapter',ledgerMode:'external-durable',ledgerLimits:{maxDirtyCreditEntries:10000,maxDirtyCreditBytes:16777216,maxPendingDeaths:32,maxStagedBytes:8388608},limits:{eventCount:4096,inputCommandsPerTick:32,timers:256,projectiles:256},definition:world.publicDefinition,query:world.query,actionData:world.actionData,policy:world.policy,seed:1,context:{mode:'public',pvp:'disabled',members:[]}});
  const ref=area.attachFresh(c.record.characterId,'warrior','human','spawn',0);barrier=area.beginDurabilityBarrier('certified-adapter');let record=c.record;const pageCounts=[];
   for(;;){const expectedRevision=record.revision,result=await deliverCertifiedAreaPage({area,ref,accountId:c.binding.accountId,characterId:c.record.characterId,expectedRevision,store,codec,ownership,boundary:async run=>run(),isCurrent:()=>record.revision===expectedRevision});
    assert.equal(result.kind,'applied');pageCounts.push(result.results.length);const capture=area.capturePlayerCheckpoint(ref);record=await store.saveCheckpoint(c.binding.accountId,c.record.characterId,record.revision,codec.toJson(capture.checkpoint),capture.appliedGrantIds);area.markCheckpointDurable(capture.captureId,record.revision,capture.appliedGrantIds);
    const usage=area.resourceUsage();assert.equal(usage.appliedGrantIds,0);assert.equal(usage.replayTokens,0);assert.equal(usage.captures,0);assert.equal(usage.durableCharacters,0);assert.equal(usage.ledgerOwners,1);if(!result.more)break;
   }
   assert.deepEqual(pageCounts,[100,100,57]);assert.equal(area.services.player(ref).state.coins,257);assert.equal(record.checkpoint.progress.coins,257);
   const fresh=await deliverCertifiedAreaPage({area,ref,accountId:c.binding.accountId,characterId:c.record.characterId,expectedRevision:record.revision,store,codec,ownership,boundary:async run=>run(),isCurrent:()=>true});assert.equal(fresh.kind,'applied');assert.deepEqual(fresh.results,[]);assert.equal(area.services.player(ref).state.coins,257);
   const victim={area:'late-adapter-proof',id:1,life:1},id=JSON.stringify([victim.area,victim.id,victim.life,c.record.characterId]),payload={id,victim,recipient:c.record.characterId,xp:0,coins:1,objectives:[],flags:[]};await store.recordGrant(c.binding.accountId,c.record.characterId,id,payload);
   const oldRevision=record.revision;
   const superseded={async pendingGrants(...args){const candidates=await store.pendingGrants(...args),proof=await store.loadForRecovery(c.binding.accountId,c.record.characterId,[id]);area.applyCertifiedGrants(area.beginGrantRead(ref,proof.character.revision),{revision:proof.character.revision,grants:proof.grants.filter(g=>g.appliedRevision===null).map(g=>codec.grantFromJson(g.payload))});const capture=area.capturePlayerCheckpoint(ref);record=await store.saveCheckpoint(c.binding.accountId,c.record.characterId,record.revision,codec.toJson(capture.checkpoint),capture.appliedGrantIds);area.markCheckpointDurable(capture.captureId,record.revision,capture.appliedGrantIds);return candidates;},loadForRecovery:(...args)=>store.loadForRecovery(...args)};
   const late=await deliverCertifiedAreaPage({area,ref,accountId:c.binding.accountId,characterId:c.record.characterId,expectedRevision:oldRevision,store:superseded,codec,ownership,boundary:async run=>run(),isCurrent:()=>record.revision===oldRevision});assert.equal(late.kind,'stale');assert.equal(area.services.player(ref).state.coins,258);assert.equal(area.resourceUsage().appliedGrantIds,0);assert.equal(area.resourceUsage().replayTokens,0);

  }finally{try{if(area){if(barrier)area.releaseDurabilityBarrier(barrier);area.dispose();}}finally{await ownership.release();}}
});

for(const ledger of [false,true])test(ledger?'external private party second member joins fighting Rust without wake/refill/global close':'second authoritative party member joins fighting Rust without duplicate wake, respawn refill or closing an unrelated public client', { timeout: 20000 }, async () => {
 const rt=await runtime({party:true,ledger}),bots=[];let heartbeat;
 try{
  const base=loaded.get('w1'),entry=base.encounterDefinitions.get('rust').pois['encounter:entry'],beacon=base.publicDefinition.interactions.find(i=>i.id==='beacon'),records=[];
  for(let i=0;i<2;i++){const c=await character('mage'),checkpoint=structuredClone(c.record.checkpoint);checkpoint.progress.xp=900;checkpoint.survival.maxHp=Math.round(checkpoint.progress.baseMaxHp*1.3);checkpoint.survival.hp=i?Math.floor(checkpoint.survival.maxHp/2):checkpoint.survival.maxHp;checkpoint.survival.maxResource=160;checkpoint.survival.resource=i?60:160;checkpoint.progress.quests.status.q1=checkpoint.progress.quests.status.q2='done';checkpoint.progress.quests.status.q3='active';checkpoint.progress.quests.progress['q1-kill']=6;checkpoint.progress.quests.progress['q1-cog']=4;checkpoint.progress.quests.progress['q2-deliver']=1;checkpoint.progress.quests.cogs=4;checkpoint.location={...(i?entry.position:beacon.position),yaw:0};c.record=await store.saveCheckpoint(c.binding.accountId,c.record.characterId,c.record.revision,checkpoint,[]);records.push(c);const b=await client(rt,c);bots.push(b);await ready(rt,b);}
  const [leader,member]=bots,observer=await client(rt,await character());bots.push(observer);await ready(rt,observer);
  leader.send([{kind:'partyCreate'}]);await until(()=>leader.controls.some(c=>c.type==='party'&&c.state));const code=leader.controls.findLast(c=>c.type==='party'&&c.state).state.code;member.send([{kind:'partyJoin',code}]);await until(()=>leader.controls.findLast(c=>c.type==='party')?.state?.members.length===2);
  // The qualified member at the entrance is still denied while the real shared beacon is unlit.
  const publicRef=member.state.selfRef;member.send([{kind:'bossChallenge',profile:'rust'}]);await until(()=>member.controls.some(c=>c.code==='encounter-prerequisites'));assert.deepEqual(member.state.selfRef,publicRef);
  leader.send([{kind:'interact',targetId:'beacon'}],{heldChannel:'beacon'});heartbeat=setInterval(()=>{if(leader.ws.readyState===WebSocket.OPEN)leader.send([],{heldChannel:'beacon'});},50);await until(()=>leader.state.features.environment.beacon,5000);clearInterval(heartbeat);heartbeat=undefined;
  const oldEpoch=leader.binding.epoch;let written=false;for(let i=0;i<10&&!written;i++){const current=await store.getOwned(records[0].binding.accountId,records[0].record.characterId),checkpoint=structuredClone(current.checkpoint);checkpoint.location={...entry.position,yaw:entry.yaw};try{await store.saveCheckpoint(records[0].binding.accountId,current.characterId,current.revision,checkpoint,[]);written=true;}catch(e){if(e.code!=='conflict')throw e;}}
  assert.equal(written,true);await until(()=>leader.binding.epoch>oldEpoch,5000);leader.send([{kind:'bossChallenge',profile:'rust'}]);
  const boss=b=>b.state?.recovery.bosses?.find(b=>b.profile==='rust');await until(()=>leader.binding.area.startsWith('party:')&&boss(leader)?.state==='waking'||rt.failures.length,5000);assert.deepEqual(rt.failures,[]);
  heartbeat=setInterval(()=>{if(leader.ws.readyState===WebSocket.OPEN)leader.send([]);},50);
  await until(()=>boss(leader)?.state==='fight'||rt.failures.length,6000);assert.deepEqual(rt.failures,[]);const originalBoss={...boss(leader).unit},originalSession=leader.binding.session;
  const sourceHp=member.state.actors.find(a=>a.ref.id===member.state.selfRef.id).hp,sourceResource=member.state.self.player.resource;
  member.send([{kind:'bossChallenge',profile:'rust'}]);await until(()=>member.binding.area===leader.binding.area&&boss(member)?.state==='fight'||rt.failures.length,5000);
  assert.deepEqual(rt.failures,[]);assert.deepEqual(boss(member).unit,originalBoss);assert.equal(leader.binding.session,originalSession);const joined=member.state.actors.find(a=>a.ref.id===member.state.selfRef.id);assert.ok(joined.hp>=sourceHp&&joined.hp<joined.maxHp);assert.ok(joined.hp-sourceHp<joined.maxHp*.05*.25);assert.ok(member.state.self.player.resource<member.state.self.player.maxResource);assert.ok(member.state.self.player.resource>=sourceResource);
  assert.equal(member.state.selfRef.life,1); // Joining preserves HP/resource and never invokes respawn.
  member.send([{kind:'bossChallenge',profile:'rust'}]);const duplicateSequence=member.sequence;await until(()=>member.state.header.consumedInput>=duplicateSequence);assert.deepEqual(boss(member).unit,originalBoss);assert.equal(boss(member).state,'fight');
  const observerSequence=observer.sequence+1;observer.send([]);await until(()=>observer.state.header.consumedInput>=observerSequence);assert.equal(observer.ws.readyState,WebSocket.OPEN);assert.ok(observer.binding.area.startsWith('w1:'));assert.equal(rt.host.stats().frozen,false);assert.equal(rt.host.stats().encounterAreas,1);assert.deepEqual(bots.flatMap(b=>b.errors),[]);
 }finally{if(heartbeat)clearInterval(heartbeat);for(const b of bots)b.ws.close();await rt.close();}
});

 test('real Rust core predicates distinguish start, active local challenge, dying refusal and level/beacon gates', () => {
  const base=loaded.get('w1');
  function probe(state,level=3,lit=true){const area=createArea({id:'predicate-'+state+'-'+level+'-'+lit,definition:base.encounterDefinitions.get('rust'),query:base.query,actionData:base.actionData,policy:base.policy,seed:1,context:{mode:'party-encounter',pvp:'disabled',members:[]},limits:{eventCount:4096,inputCommandsPerTick:32,timers:256,projectiles:256}});area.bootstrapEncounter('rust',{beaconLit:lit});const ref=area.attachFresh('predicate-hero','mage','human','encounter:entry'),player=area.services.player(ref);player.restoreXp(level===3?900:300);const unit=area.services.getUnit(ref),boss=area.services.bossByProfile('rust');unit.hp=1;player.state.resource=1;boss.state=state;const bossLife=boss.unit.life;try{const result=area.services.runCommand(ref,{kind:'bossChallenge',profile:'rust'});return{result,state:boss.state,life:boss.unit.life,bossLife,hp:area.services.getUnit(player.state.unit).hp,resource:player.state.resource};}finally{area.dispose();}}
  for(const state of ['dormant','dead']){const result=probe(state);assert.equal(result.result,true);assert.equal(result.state,'waking');assert.ok(result.hp>1);if(state==='dead')assert.ok(result.life>result.bossLife);}
  for(const state of ['waking','idle']){const result=probe(state);assert.equal(result.result,true);assert.equal(result.state,state);assert.ok(result.hp>1);}// A local re-challenge refills, so host joins must never call it.
  const fight=probe('fight');assert.equal(fight.result,false);assert.equal(fight.state,'fight');assert.equal(fight.hp,1);assert.equal(fight.resource,1);
  for(const denied of [probe('dying'),probe('dormant',2),probe('dormant',3,false)]){assert.equal(denied.result,false);assert.equal(denied.hp,1);assert.equal(denied.resource,1);assert.equal(denied.life,denied.bossLife);}
 });

async function recoveryDraft(ledger,victim,records,eligible=true){const writes=records.map((c,i)=>({victim,character:c.record.characterId,version:i+1,credit:{character:c.record.characterId,cogEligible:eligible,cogMisses:0,flags:{}}}));await ledger.recordContributionBatch(writes);const summary=await ledger.readContributionSummary(victim,[]);return ledger.beginVictimDraft({fence:summary,recipe:{schema:'world-death-v1',victim,world:'w1',throughVersion:summary.throughVersion,expectedContributors:summary.totalContributors,expectedRandomDraws:summary.storedEligibleTotal,facts:{kind:'scrapling',level:1,role:'ordinary',profile:null,xp:20,coins:5},overrides:[],random:{algorithm:'mulberry32-v1',state:42}}});}

test('actual PG recovery sweeps bound every slice, fairly advance large drafts, recover lost append/seal responses and revisit late drafts', {timeout:15000}, async()=>{
 const ownership=await acquireHostOwnership(pool,'recovery-sweep-test');
 try{
  const ledger=new DurableOutcomeStore(pool,codec,{planOutcomePage}),records=[await character(),await character(),await character()];
  const a=await recoveryDraft(ledger,{area:'recovery-large',id:1,life:1},records),b=await recoveryDraft(ledger,{area:'recovery-small',id:1,life:1},records.slice(0,1));let lostAppend=false,lostSeal=false;
  const ambiguous=new Proxy(ledger,{get(target,key){if(key==='appendVictimPage')return async(...args)=>{const r=await target.appendVictimPage(...args);if(!lostAppend){lostAppend=true;throw new Error('lost append response');}return r;};if(key==='sealVictimDraft')return async(...args)=>{const r=await target.sealVictimDraft(...args);if(!lostSeal){lostSeal=true;throw new Error('lost seal response');}return r;};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  const recovery=new PagedOutcomeRecovery(ambiguous,ownership,{draftsPerSlice:1,pageSize:1,codecVersion:codec.version});
  const first=await recovery.sweep();assert.equal(first.visited,1);assert.equal(first.appended,1);assert.equal(first.sealed,0);assert.equal((await ledger.getVictimDraft(a.draftId)).cursor.recipientCount,1);
  const second=await recovery.sweep();assert.equal(second.visited,1);assert.equal(second.sealed,1);assert.equal((await ledger.getVictimSeal(b.victim)).recipientCount,1);assert.equal((await ledger.getVictimDraft(a.draftId)).cursor.recipientCount,1);
  for(let i=0;;i++){const slice=await recovery.sweep();assert.ok(slice.visited<=1&&slice.appended<=1&&slice.sealed<=1);if(slice.cycleComplete&&!slice.cycleHasPending)break;if(i>20)throw new Error('draft recovery failed to drain');}
  const aSeal=await ledger.getVictimSeal(a.victim);assert.equal(verifyPagedOutcomeSeal(a.recipe,codec.version,aSeal).recipientCount,3);assert.throws(()=>verifyPagedOutcomeSeal({...a.recipe,victim:{...a.victim,life:2}},codec.version,aSeal),/proof mismatch/);assert.throws(()=>verifyPagedOutcomeSeal(a.recipe,codec.version,{...aSeal,finalCursor:{...aSeal.finalCursor,randomDraws:2}}),/proof mismatch/);assert.equal(lostAppend,true);assert.equal(lostSeal,true);assert.equal(recovery.metrics.maxPage,1);
  const before=recovery.metrics.cycles,late=await recoveryDraft(ledger,{area:'recovery-late-after-empty',id:1,life:1},records.slice(1,2));
  const protectedSlice=await recovery.sweep({isLiveArea:areaId=>areaId===late.victim.area});assert.equal(protectedSlice.skippedLive,1);assert.equal(await ledger.getVictimSeal(late.victim),null);
  for(let i=0;!(await ledger.getVictimSeal(late.victim));i++){await recovery.sweep();if(i>10)throw new Error('late draft missed');}
  assert.ok(recovery.metrics.cycles>=before);assert.equal((await ledger.getVictimSeal(late.victim)).recipientCount,1);
 }finally{await ownership.release();}
});

test('active actual WS actor receives a late-sealed older journal row after a previous empty pending read', {timeout:12000}, async()=>{
 const c=await character(),ledger=new DurableOutcomeStore(pool,codec,{planOutcomePage}),draft=await recoveryDraft(ledger,{area:'late-sealed-old-sequence',id:1,life:1},[c],false),page=await ledger.readContributionPage(draft.draftId,null,100),planned=planOutcomePage(draft.recipe,draft.cursor,page.credits.map(w=>w.credit));await ledger.appendVictimPage(draft.draftId,planned);
 const victim={area:'newer-already-visible',id:1,life:1},id=JSON.stringify([victim.area,1,1,c.record.characterId]);const newer=await store.recordGrant(c.binding.accountId,c.record.characterId,id,{id,victim,recipient:c.record.characterId,xp:1,coins:1,objectives:[],flags:[]});

 const rt=await runtime();let bot;
 try{
  bot=await client(rt,c);await ready(rt,bot);assert.equal(bot.state.self.player.xp,1);await until(()=>!rt.host.stats().durableBarrier);assert.deepEqual(await store.pendingGrants(c.binding.accountId,c.record.characterId),[]);
  const recovery=new PagedOutcomeRecovery(ledger,rt.ownership,{draftsPerSlice:10,pageSize:100,codecVersion:codec.version});const slice=await recovery.sweep();assert.ok(slice.sealed>=1);
  await until(()=>bot.state.self.player.xp===21||rt.failures.length,5000);assert.deepEqual(rt.failures,[]);assert.equal(bot.state.self.player.coins,6);assert.deepEqual(bot.errors,[]);assert.equal((await store.getOwned(c.binding.accountId,c.record.characterId)).checkpoint.progress.xp,21);const oldProof=await store.loadForRecovery(c.binding.accountId,c.record.characterId,[planned.grants[0].id]);assert.ok(BigInt(oldProof.grants[0].sequence)<BigInt(newer.sequence));
 }finally{bot?.ws.close();await rt.close();}
});

test('external factory recurring recovery catches a late old-owner draft after an empty startup scan and an actor pending read', {timeout:12000}, async()=>{
 const c=await character(),ledger=new DurableOutcomeStore(pool,codec,{planOutcomePage}),rt=await runtime({ledger:true,recoveryIntervalMs:2000});let bot;
 try{
  bot=await client(rt,c);await ready(rt,bot);await until(()=>!rt.host.stats().durableBarrier);assert.deepEqual(await store.pendingGrants(c.binding.accountId,c.record.characterId),[]);
  // A late old-owner draft has a different Area UUID and is discoverable in a later bounded cycle.
  const draft=await recoveryDraft(ledger,{area:'late-old-owner-after-ready',id:1,life:1},[c],false),page=await ledger.readContributionPage(draft.draftId,null,100),planned=planOutcomePage(draft.recipe,draft.cursor,page.credits.map(w=>w.credit));await ledger.appendVictimPage(draft.draftId,planned);
  await until(()=>bot.state.self.player.xp===20||rt.failures.length,7000);assert.deepEqual(rt.failures,[]);assert.equal(bot.state.self.player.coins,5);assert.equal((await ledger.getVictimSeal(draft.victim)).recipientCount,1);assert.equal((await store.getOwned(c.binding.accountId,c.record.characterId)).checkpoint.progress.xp,20);assert.deepEqual(await store.pendingGrants(c.binding.accountId,c.record.characterId),[]);assert.deepEqual(bot.errors,[]);
 }finally{bot?.ws.close();await rt.close();}
});

const sourceLimits={maxDirtyCreditEntries:10000,maxDirtyCreditBytes:16777216,maxPendingDeaths:32,maxStagedBytes:8388608};
const sourceDrainLimits={pageSize:100,creditBatchesPerSlice:1,outcomesPerSlice:1,summaryVictimsPerSlice:10,writeAttempts:2,codecVersion:1};
function actualExternalSource(id,options={}){const base=loaded.get('w1'),spawn=base.publicDefinition.spawn.position,definition={...base.publicDefinition,...(options.bare?{npcs:[],townsfolk:[],interactions:[]}:{}),enemies:[{...base.publicDefinition.enemies[0],home:{x:spawn.x+3,y:base.query.heightAt(spawn.x+3,spawn.z),z:spawn.z},wanderRadius:0}]};return createArea({id,ledgerMode:'external-durable',ledgerLimits:sourceLimits,definition,query:base.query,actionData:base.actionData,policy:base.policy,seed:1,context:{mode:'public',pvp:'disabled',members:[]},limits:{eventCount:options.eventCount??4096,inputCommandsPerTick:32,timers:256,projectiles:256}});}
const neutralIntent=(seq,commands=[])=>({seq,forward:0,strafe:0,turn:0,sprint:false,steeringYaw:null,heldChannel:null,commands});

test('actual baked Area ability death spills credits, seals exact source outcome, certifies local duplicate and saves/prunes once through PG', {timeout:15000}, async()=>{
 const c=await character(),ownership=await acquireHostOwnership(pool,'actual-source-drain');let area,barrier;
 try{area=actualExternalSource('actual-source-drain');
  const ref=area.attachFresh(c.record.characterId,'warrior','human','spawn',0);area.step(new Map([[ref.id,neutralIntent(1,[{kind:'ability',slot:5}])]]));assert.equal(area.services.player(ref).state.xp,20);assert.equal(area.resourceUsage().dirtyCreditEntries,1);assert.equal(area.resourceUsage().pendingDeaths,1);
  barrier=area.beginDurabilityBarrier('actual-source-journal');const ledger=new DurableOutcomeStore(pool,codec,{planOutcomePage}),background=new PagedOutcomeRecovery(ledger,ownership,{draftsPerSlice:10,pageSize:100,codecVersion:codec.version});let lostCredit=false,lostAppend=false,lostSeal=false,skippedLive=0;
  const ambiguous=new Proxy(ledger,{get(target,key){if(key==='beginVictimDraft')return async(...args)=>{const draft=await target.beginVictimDraft(...args),sweep=await background.sweep({isLiveArea:areaId=>areaId===area.services.id});skippedLive+=sweep.skippedLive;assert.equal(sweep.appended,0);assert.equal(sweep.sealed,0);return draft;};if(['recordContributionBatch','appendVictimPage','sealVictimDraft'].includes(key))return async(...args)=>{const value=await target[key](...args);const lose=key==='recordContributionBatch'?!lostCredit:key==='appendVictimPage'?!lostAppend:!lostSeal;if(lose){if(key==='recordContributionBatch')lostCredit=true;else if(key==='appendVictimPage')lostAppend=true;else lostSeal=true;throw new Error('lost committed source IO response');}return value;};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  const drain=new AreaSourceDrain(area,ambiguous,ownership,sourceDrainLimits,async run=>run(),()=>true),progress=await drain.drain({refreshSummaries:true});assert.equal(progress.more,false);assert.equal(progress.credits,1);assert.equal(progress.pages,1);assert.equal(progress.retired,1);assert.equal(area.resourceUsage().pendingDeaths,0);assert.equal(area.resourceUsage().dirtyCreditEntries,0);assert.equal(lostCredit&&lostAppend&&lostSeal,true);assert.equal(skippedLive,1);
  const certified=await deliverCertifiedAreaPage({area,ref,accountId:c.binding.accountId,characterId:c.record.characterId,expectedRevision:0,store,codec,ownership,boundary:async run=>run(),isCurrent:()=>true});assert.equal(certified.kind,'applied');assert.equal(certified.results[0].result,'duplicate');assert.equal(area.services.player(ref).state.xp,20);
  const capture=area.capturePlayerCheckpoint(ref),saved=await store.saveCheckpoint(c.binding.accountId,c.record.characterId,0,codec.toJson(capture.checkpoint),capture.appliedGrantIds);area.markCheckpointDurable(capture.captureId,saved.revision,capture.appliedGrantIds);assert.equal(saved.checkpoint.progress.xp,20);assert.equal(area.resourceUsage().appliedGrantIds,0);assert.deepEqual(await store.pendingGrants(c.binding.accountId,c.record.characterId),[]);assert.deepEqual(area.prepareLedgerStep(),{ready:true});const oldRecord=await character(),old=await recoveryDraft(ledger,{area:'old-source-after-restart-fixture',id:1,life:1},[oldRecord],false);await background.sweep({isLiveArea:areaId=>areaId===area.services.id});assert.equal((await ledger.getVictimSeal(old.victim)).recipientCount,1);
 }finally{try{if(barrier)area.releaseDurabilityBarrier(barrier);area?.dispose();}finally{await ownership.release();}}
});

test('zero-resident actual Area still flushes accepted hit eligibility and refreshes its empty-roster summary', {timeout:10000}, async()=>{
 const c=await character(),ownership=await acquireHostOwnership(pool,'empty-source-drain');let area,barrier;
 try{area=actualExternalSource('empty-source-drain');
  const ref=area.attachFresh(c.record.characterId,'warrior','human','spawn',0),victim=[...area.enemies.values()][0].unit;area.services.getUnit(victim).hp=area.services.getUnit(victim).maxHp=1000;area.step(new Map([[ref.id,neutralIntent(1,[{kind:'ability',slot:5}])]]));assert.equal(area.resourceUsage().dirtyCreditEntries,1);
  const retirement=area.quiescePlayer(ref,'source-test-disconnect'),saved=await store.saveCheckpoint(c.binding.accountId,c.record.characterId,0,codec.toJson(retirement.capture.checkpoint),retirement.capture.appliedGrantIds);area.markCheckpointDurable(retirement.capture.captureId,saved.revision,retirement.capture.appliedGrantIds);area.commitPlayerRetirement(retirement.token);assert.equal(area.players.size,0);
  barrier=area.beginDurabilityBarrier('empty-source');const ledger=new DurableOutcomeStore(pool,codec,{planOutcomePage}),drain=new AreaSourceDrain(area,ledger,ownership,sourceDrainLimits,async run=>run(),()=>true),progress=await drain.drain({refreshSummaries:true});assert.equal(progress.credits,1);assert.equal(progress.more,false);assert.equal(progress.summaries,1);assert.equal(area.resourceUsage().dirtyCreditEntries,0);assert.equal((await ledger.readContributionSummary(victim,[])).totalContributors,1);assert.equal(area.resourceUsage().ledgerOwners,0);
 }finally{try{if(barrier)area.releaseDurabilityBarrier(barrier);area?.dispose();}finally{await ownership.release();}}
});

test('actual failed Area drains only preserved source obligations to PG without checkpointing its failed actor prefix', {timeout:10000}, async()=>{
 const c=await character(),ownership=await acquireHostOwnership(pool,'failed-source-drain');let area;
 try{area=actualExternalSource('failed-source-drain',{eventCount:1,bare:true});
  const ref=area.attachFresh(c.record.characterId,'warrior','human','spawn',0),victim=[...area.enemies.values()][0].unit;area.services.getUnit(victim).hp=1;Object.assign(area.services.getUnit(ref),{x:area.services.getUnit(victim).x,y:area.services.getUnit(victim).y,z:area.services.getUnit(victim).z});area.services.getUnit(victim).stunUntil=100;area.services.player(ref).state.nextSwing=100;area.drainEvents();area.services.getUnit(ref).pendingHit={left:0,plan:{attack:'warrior-auto',source:ref,target:victim}};assert.throws(()=>area.step(new Map()),/capacity/);assert.equal(area.pendingDeathRecipes(1).length,1);assert.throws(()=>area.step(new Map()),/failed/);
  const ledger=new DurableOutcomeStore(pool,codec,{planOutcomePage}),drain=new AreaSourceDrain(area,ledger,ownership,sourceDrainLimits,async run=>run(),()=>true),progress=await drain.drain({refreshSummaries:false});assert.equal(progress.more,false);assert.equal(progress.retired,1);assert.equal(area.resourceUsage().pendingDeaths,0);assert.equal((await store.getOwned(c.binding.accountId,c.record.characterId)).checkpoint.progress.xp,0);assert.equal((await store.pendingGrants(c.binding.accountId,c.record.characterId))[0].payload.xp,20);
 }finally{try{area?.dispose();}finally{await ownership.release();}}
});

for(const controlPath of ['invalid-input','restarting'])test('actual external factory withholds published ACK on '+controlPath+' until a real death seal and reconnects with one reward', {timeout:15000},async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});let entered=false;const ledger=new DurableOutcomeStore(pool,codec,{planOutcomePage}),blocked=new Proxy(ledger,{get(target,key){if(key==='recordContributionBatch')return async(...args)=>{entered=true;await gate;return target.recordContributionBatch(...args);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 const c=await character(),rt=await runtime({ledger:true,combat:true,outcomes:blocked});let bot,resumed,next,closed=false;
 try{
  assert.equal(rt.host.stats().ready,true);bot=await client(rt,c);await ready(rt,bot);assert.equal(bot.state.header.consumedInput,0);bot.send([{kind:'ability',slot:5}]);await until(()=>entered||rt.failures.length,5000);assert.deepEqual(rt.failures,[]);assert.equal(bot.state.self.player.xp,0);
  if(controlPath==='invalid-input'){
   bot.ws.send(Buffer.from([0,1,2]));await until(()=>bot.messages.some(m=>m.control?.type==='error'&&m.control.code==='invalid-input'));const rejected=bot.messages.find(m=>m.control?.type==='error'&&m.control.code==='invalid-input');assert.equal(rejected.header.consumedInput,0);await until(()=>bot.ws.readyState===WebSocket.CLOSED);release();await until(()=>!rt.host.stats().durableBarrier);
   resumed=await client(rt,c);await ready(rt,resumed);assert.equal(resumed.state.self.player.xp,20);assert.equal((await store.getOwned(c.binding.accountId,c.record.characterId)).checkpoint.progress.xp,20);assert.equal(rt.host.stats().frozen,false);
  }else{
   const ending=rt.close();await until(()=>bot.messages.some(m=>m.control?.type==='restarting'));assert.equal(bot.messages.find(m=>m.control?.type==='restarting').header.consumedInput,0);release();assert.equal((await ending).durable,true);closed=true;next=await runtime({ledger:true});resumed=await client(next,c);await ready(next,resumed);assert.equal(resumed.state.self.player.xp,20);
  }
  assert.deepEqual(bot.errors,[]);assert.deepEqual(resumed.errors,[]);assert.deepEqual(rt.failures,[]);
 }finally{release();bot?.ws.close();resumed?.ws.close();if(next)await next.close();if(!closed)await rt.close();}
});

test('actual external factory.ready holds admission until currently discoverable draft recovery completes', {timeout:10000},async()=>{
 const ledger=new DurableOutcomeStore(pool,codec,{planOutcomePage});let release,entered=false;const gate=new Promise(resolve=>{release=resolve;}),blocked=new Proxy(ledger,{get(target,key){if(key==='getDraftRecoveryHighWater')return async()=>{entered=true;await gate;return target.getDraftRecoveryHighWater();};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}}),rt=await runtime({ledger:true,deferReady:true,outcomes:blocked});let ws;
 try{
  await until(()=>entered);assert.equal(rt.host.stats().ready,false);assert.equal(rt.host.stats().accepting,false);ws=new WebSocket(rt.url,{headers:{Origin:origin}});ws.on('error',()=>{});const status=await new Promise(resolve=>ws.on('unexpected-response',(_req,res)=>{resolve(res.statusCode);res.resume();}));assert.equal(status,503);ws.terminate();release();await rt.host.ready();assert.equal(rt.host.stats().ready,true);assert.equal(rt.host.stats().accepting,true);assert.deepEqual(rt.failures,[]);
 }finally{release();ws?.terminate();await rt.close();}
});

test('actual factory.ready waits across known three-recipient one-row pages and the final PG seal before admitting', {timeout:10000},async()=>{
 const ledger=new DurableOutcomeStore(pool,codec,{planOutcomePage}),records=[await character(),await character(),await character()],draft=await recoveryDraft(ledger,{area:'factory-known-multipage',id:1,life:1},records,false);
 let releasePage,releaseSeal,appends=0,pageBlocked=false,sealBlocked=false,readyResolved=false;
 const pageGate=new Promise(resolve=>{releasePage=resolve;}),sealGate=new Promise(resolve=>{releaseSeal=resolve;});
 const blocked=new Proxy(ledger,{get(target,key){
  if(key==='appendVictimPage')return async(...args)=>{appends++;if(appends===2){pageBlocked=true;await pageGate;}return target.appendVictimPage(...args);};
  if(key==='sealVictimDraft')return async(...args)=>{sealBlocked=true;await sealGate;return target.sealVictimDraft(...args);};
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }}),rt=await runtime({ledger:true,deferReady:true,outcomes:blocked,recoveryPageSize:1});
 void rt.host.ready().then(()=>{readyResolved=true;});
 const denied=async()=>{const ws=new WebSocket(rt.url,{headers:{Origin:origin}});ws.on('error',()=>{});try{const status=await new Promise(resolve=>ws.on('unexpected-response',(_req,res)=>{resolve(res.statusCode);res.resume();}));assert.equal(status,503);}finally{ws.terminate();}};
 try{
  await until(()=>pageBlocked||rt.failures.length);assert.deepEqual(rt.failures,[]);assert.equal((await ledger.getVictimDraft(draft.draftId)).cursor.recipientCount,1);assert.equal(readyResolved,false);assert.equal(rt.host.stats().ready,false);assert.equal(rt.host.stats().accepting,false);await denied();
  releasePage();await until(()=>sealBlocked||rt.failures.length);assert.deepEqual(rt.failures,[]);assert.equal(appends,3);assert.equal((await ledger.getVictimDraft(draft.draftId)).cursor.recipientCount,3);assert.equal(await ledger.getVictimSeal(draft.victim),null);assert.equal(readyResolved,false);assert.equal(rt.host.stats().accepting,false);await denied();
  for(const c of records)assert.deepEqual(await store.pendingGrants(c.binding.accountId,c.record.characterId),[]);
  releaseSeal();await rt.host.ready();assert.equal(readyResolved,true);assert.equal(rt.host.stats().ready,true);assert.equal(rt.host.stats().accepting,true);assert.equal((await ledger.getVictimSeal(draft.victim)).recipientCount,3);
  for(const c of records){const grants=await store.pendingGrants(c.binding.accountId,c.record.characterId);assert.equal(grants.length,1);assert.equal(grants[0].payload.xp,20);assert.equal(grants[0].payload.coins,5);}
  assert.deepEqual(rt.failures,[]);
 }finally{releasePage();releaseSeal();await rt.close();}
});

test('external optional pair and full-roster capacity reject before admission while absent pair stays retained',async()=>{
 await assert.rejects(runtime({ledger:true,withoutOutcomes:true}),/must be paired/);
 await assert.rejects(runtime({outcomes:new DurableOutcomeStore(pool,codec,{planOutcomePage})}),/must be paired/);
 await assert.rejects(runtime({ledger:true,ledgerSourceLimits:{...sourceLimits,maxDirtyCreditEntries:1}}),/unsupported-step-capacity/);
 const rt=await runtime();try{await rt.host.ready();assert.equal(rt.host.stats().ready,true);assert.equal('ledgerDirtyCreditEntries' in rt.host.stats(),false);}finally{await rt.close();}
});


const rawIntent=(seq,commands=[],held={})=>({seq,forward:0,strafe:0,turn:0,sprint:false,steeringYaw:null,heldChannel:null,commands,...held});
const clientControl=(binding,sequence=1)=>createGameplayProtocol(gameplayCatalog).encodeControl({...binding,sequence,tick:0,acceptedInput:0,consumedInput:0},{type:'resync',lastSequence:0,reason:'baseline'})[0];

test('actual WorldClient survives real enemy death/respawn with delayed revoked input and resync before current input, while a public peer stays live', {timeout:15000},async()=>{
 const c=await character('mage'),checkpoint=structuredClone(c.record.checkpoint);checkpoint.survival.hp=1;c.record=await store.saveCheckpoint(c.binding.accountId,c.record.characterId,c.record.revision,checkpoint,[]);
 const rt=await runtime({combat:true}),states=[],frames=[];let socket,peer,tap,live;
 try{
  live=new WorldClient({catalog:gameplayCatalog,origin,windowTarget:null,documentTarget:null,hidden:()=>false,maxReconnects:0,
   fetch:async()=>new Response(JSON.stringify(rt.admission.issue(c.binding,origin))),
   socket:()=>{socket=new WebSocket(rt.url,{headers:{Origin:origin}});socket.addEventListener('message',event=>{if(typeof event.data==='string'){const v=JSON.parse(event.data);if(v.type==='world-bound'){const {type,...binding}=v;tap=new FragmentAssembler(binding);}}else if(tap){const m=tap.accept(new Uint8Array(event.data),performance.now()/1000);if(m?.kind===1)frames.push({header:m.header,full:m.payload.full});}});return socket;},onState:(state,code)=>states.push({state,code})});
  await live.connect(c.record.characterId);peer=await client(rt,await character());await ready(rt,peer);const {session,area,epoch,catalog}=live.view.header,old={session,area,epoch,catalog},life=live.view.selfRef.life;
  live.command({kind:'jump'});live.pump(performance.now());await until(()=>live.inputWatermarks.consumed===1);await until(()=>live.view?.actors.find(a=>a.ref.id===live.view.selfRef.id)?.alive===false,5000);
  const oldInput=encodeInput({binding:old,intent:rawIntent(2,[{kind:'ability',slot:5}],{forward:1})},gameplayCatalog),oldResync=clientControl(old);
  await until(()=>live.view?.selfRef.life>life||rt.failures.length,7000);assert.deepEqual(rt.failures,[]);assert.equal(live.state,'admitted');assert.equal(live.view.header.session,old.session);assert.ok(live.view.header.epoch>old.epoch);assert.equal(live.inputWatermarks.consumed,0);const start=live.view,priorFrames=frames.length;
  socket.send(oldInput);socket.send(oldResync);await until(()=>rt.host.stats().discardedRevokedFrames===2&&frames.length>priorFrames);assert.equal(socket.readyState,WebSocket.OPEN);assert.equal(live.inputWatermarks.accepted,0);assert.equal(live.inputWatermarks.consumed,0);assert.equal(live.view.self.player.resource,start.self.player.resource);assert.ok(frames.slice(priorFrames).every(f=>!f.full));
  const keys=new Set(['KeyW']);live.capture({controlsLocked:false,input:{isDown:key=>keys.has(key),isButtonDown:()=>false,wasPressed:()=>false},follow:{yaw:0,steering:false}},.04);live.pump(performance.now());await until(()=>live.inputWatermarks.consumed===1);assert.equal(live.state,'admitted');assert.equal(socket.readyState,WebSocket.OPEN);
  peer.send([]);await until(()=>peer.receiver.header.consumedInput===1);assert.equal(peer.ws.readyState,WebSocket.OPEN);assert.equal(states.some(s=>s.code==='bootstrap'||s.code==='invalid-input'),false);
  // TCP orders all legitimately old messages before the first valid new-epoch frame.
  socket.send(encodeInput({binding:old,intent:rawIntent(3)},gameplayCatalog));await once(socket,'close');assert.ok(states.some(s=>s.code==='invalid-input'));peer.send([]);await until(()=>peer.receiver.header.consumedInput===2);assert.equal(peer.ws.readyState,WebSocket.OPEN);assert.deepEqual(rt.failures,[]);
 }finally{live?.dispose();peer?.ws.close();await rt.close();}
});

async function respawnFixture(rt){const c=await character(),checkpoint=structuredClone(c.record.checkpoint);checkpoint.survival.alive=false;checkpoint.survival.hp=0;checkpoint.survival.respawnRemaining=.2;c.record=await store.saveCheckpoint(c.binding.accountId,c.record.characterId,c.record.revision,checkpoint,[]);const bot=await client(rt,c);await until(()=>bot.binding);const old={...bot.binding};await until(()=>bot.binding.epoch>old.epoch&&bot.state?.selfRef.life>1);assert.equal(bot.binding.session,old.session);return{c,bot,old};}

test('revoked grace still rejects malformed, unknown session/area, duplicate recovery, and closes grace on current resync', {timeout:15000},async()=>{
 const rt=await runtime({grace:20}),bots=[];
 try{
  for(const kind of ['malformed','session','area','duplicate-resync','current-resync','two-old']){
   const {c,bot,old}=await respawnFixture(rt);bots.push(bot);let packet;
   if(kind==='two-old'){
    const previous={...bot.binding},epoch=bot.binding.epoch,current=await store.getOwned(c.binding.accountId,c.record.characterId),checkpoint=structuredClone(current.checkpoint);
    // A genuine newer orientation checkpoint forces a second bootstrap without modifying HP/XP/rewards.
    checkpoint.location.yaw=Math.atan2(Math.sin(checkpoint.location.yaw+.1),Math.cos(checkpoint.location.yaw+.1));await store.saveCheckpoint(c.binding.accountId,c.record.characterId,current.revision,checkpoint,[]);await until(()=>bot.binding.epoch>epoch,5000);
    const count=rt.host.stats().discardedRevokedFrames;bot.ws.send(encodeInput({binding:previous,intent:rawIntent(1)},gameplayCatalog));await until(()=>rt.host.stats().discardedRevokedFrames===count+1);packet=encodeInput({binding:old,intent:rawIntent(1)},gameplayCatalog);
   }
   else if(kind==='malformed')packet=encodeMessage(16,{...old,sequence:1,tick:0,acceptedInput:0,consumedInput:0},{...rawIntent(1),hp:999})[0];
   else if(kind==='session'||kind==='area')packet=encodeInput({binding:{...old,[kind]:old[kind]+'-forged'},intent:rawIntent(1)},gameplayCatalog);
   else{if(kind==='duplicate-resync'){bot.ws.send(clientControl(old));await until(()=>rt.host.stats().discardedRevokedFrames>0);packet=clientControl(old);}else{bot.ws.send(clientControl(bot.binding));packet=encodeInput({binding:old,intent:rawIntent(1)},gameplayCatalog);}}
   bot.ws.send(packet);await once(bot.ws,'close');assert.ok(bot.controls.some(c=>c.code==='invalid-input'),kind);assert.deepEqual(rt.failures,[]);
  }
 }finally{for(const bot of bots)bot.ws.close();await rt.close();}
});

// Retained saves (decision "1초마다 묶어 저장, 저장 중에도 세계는 계속"), on the actual PG+WS host.
const gatedStore = () => {
  const gate = { armed: null, entered: 0 };
  const characters = new Proxy(store, { get(target, key) {
    if (key === 'saveCheckpoint' || key === 'saveCheckpoints') return async (...args) => { const armed = gate.armed; if (armed) { gate.entered++; await armed(); } return target[key](...args); };
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } });
  return { gate, characters };
};
const attackLoop = bot => setInterval(() => {
  if (bot.ws.readyState !== WebSocket.OPEN || !bot.state) return;
  const self = bot.state.actors.find(a => a.ref.id === bot.state.selfRef.id);
  const target = bot.state.actors.filter(a => a.kind === 'scrapling' && a.alive).sort((a, b) => Math.hypot(a.x - self.x, a.z - self.z) - Math.hypot(b.x - self.x, b.z - self.z))[0];
  bot.send(target ? [{ kind: 'target', target: target.ref }, { kind: 'ability', slot: 1 }] : []);
}, 100);
const kills = bots => new Set(bots.flatMap(b => b.events.filter(e => e.event.type === 'death' && e.event.unit.id !== b.state.selfRef.id).map(e => JSON.stringify(e.event.unit)))).size;
async function grantLedger(c) {
  const grants = (await pool.query('SELECT grant_id,payload_json FROM world_character_grants WHERE character_id=$1 ORDER BY grant_id', [c.record.characterId])).rows;
  const receipts = (await pool.query('SELECT grant_id FROM world_character_grant_receipts WHERE character_id=$1 ORDER BY grant_id', [c.record.characterId])).rows;
  return { ids: grants.map(g => g.grant_id), xp: grants.reduce((n, g) => n + JSON.parse(g.payload_json).xp, 0), receipts: receipts.map(r => r.grant_id) };
}

test('retained saves run at most once per second under constant kills without holding the world, and every reward is journaled and receipted once', { timeout: 30000 }, async () => {
  const rt = await runtime({ combat: true, enemies: 6 }), bots = [], records = [], timers = [];
  try {
    for (let i = 0; i < 2; i++) { const c = await character('mage'), bot = await client(rt, c); records.push(c); bots.push(bot); await ready(rt, bot); }
    await until(() => !rt.host.stats().durableBarrier);
    const start = rt.host.stats(), t0 = performance.now();
    for (const bot of bots) timers.push(attackLoop(bot));
    await until(() => kills(bots) >= 4 || rt.failures.length, 20000);
    const end = rt.host.stats(), seconds = (performance.now() - t0) / 1000;
    for (const t of timers) clearInterval(t); timers.length = 0;
    assert.deepEqual(rt.failures, []);
    // Kills no longer start rounds: at most one per checkpointIntervalMs (1000 ms here), and none of them holds the world.
    const rounds = end.persistenceBarriers - start.persistenceBarriers;
    assert.ok(rounds >= 1 && rounds <= Math.floor(seconds) + 1, JSON.stringify({ rounds, seconds }));
    assert.equal(end.haltingBarriers, start.haltingBarriers); assert.equal(end.saveRounds - start.saveRounds, rounds);
    assert.ok(end.ticks - start.ticks >= seconds * 30 * .6, JSON.stringify({ ticks: end.ticks - start.ticks, seconds }));
    assert.ok(end.checkpointBatches > start.checkpointBatches); assert.equal(end.checkpointBatchFallbacks, 0);
    await afterSave(rt); assert.deepEqual(rt.failures, []);
    let rewarded = 0;
    for (const [i, c] of records.entries()) {
      const ledger = await grantLedger(c), saved = await store.getOwned(c.binding.accountId, c.record.characterId);
      assert.deepEqual(ledger.receipts, ledger.ids, 'every journaled reward has exactly one receipt');
      assert.equal(saved.checkpoint.progress.xp, ledger.xp); assert.equal(bots[i].state.self.player.xp, ledger.xp);
      assert.deepEqual(await store.pendingGrants(c.binding.accountId, c.record.characterId), []);
      rewarded += ledger.ids.length;
    }
    assert.ok(rewarded >= 4, `rewards ${rewarded}`);
    for (const bot of bots) assert.deepEqual(bot.errors, []);
  } finally { for (const t of timers) clearInterval(t); for (const b of bots) b.ws.close(); await rt.close(); }
});

test('ticks and snapshots go on while a save is in flight, and a result is sent only after the save that contains it commits', { timeout: 20000 }, async () => {
  const { gate, characters } = gatedStore(), rt = await runtime({ characters }); let bot;
  try {
    const c = await character('mage'); bot = await client(rt, c); await ready(rt, bot); await until(() => !rt.host.stats().durableBarrier);
    let release; const blocked = new Promise(resolve => { release = resolve; }); gate.armed = () => blocked;
    bot.send([{ kind: 'questAccept', questId: 'q1', npcId: 'brinebeard' }]); const accepted = bot.sequence;
    await until(() => gate.entered > 0 || rt.failures.length); gate.armed = null;
    const held = rt.host.stats(), sequence = bot.state.sequence;
    assert.equal(held.durableBarrier, true); assert.equal(held.haltingBarrier, false);
    const heartbeat = setInterval(() => { if (bot.ws.readyState === WebSocket.OPEN) bot.send([], { turn: 1 }); }, 50);
    try { await delay(500); } finally { clearInterval(heartbeat); }
    const during = rt.host.stats();
    assert.equal(during.durableBarrier, true); assert.equal(during.persistenceBarriers, held.persistenceBarriers);
    assert.ok(during.ticks - held.ticks >= 8, JSON.stringify({ ticks: during.ticks - held.ticks }));
    assert.ok(bot.state.sequence - sequence >= 4, JSON.stringify({ snapshots: bot.state.sequence - sequence }));
    // The accepted quest is in the world and in snapshots, but not acknowledged and not in PG yet.
    assert.equal(bot.state.self.player.quests.status.q1, 'active');
    assert.equal(bot.results.some(r => r.inputSequence === accepted), false);
    assert.equal((await store.getOwned(c.binding.accountId, c.record.characterId)).checkpoint.progress.quests.status.q1, 'available');
    release();
    await until(() => bot.results.some(r => r.inputSequence === accepted) || rt.failures.length);
    assert.deepEqual(rt.failures, []);
    const result = bot.results.find(r => r.inputSequence === accepted), saved = await store.getOwned(c.binding.accountId, c.record.characterId);
    assert.equal(result.status, 'durable'); assert.equal(result.code, 'quest-accepted'); assert.equal(saved.checkpoint.progress.quests.status.q1, 'active'); assert.ok(result.revision <= saved.revision);
    assert.deepEqual(bot.errors, []);
  } finally { bot?.ws.close(); await rt.close(); }
});

test('a crash between save rounds loses only progress after the last committed round, never an acknowledged result', { timeout: 20000 }, async () => {
  const { gate, characters } = gatedStore(), rt = await runtime({ characters }); let bot, resumed, next, acked;
  const c = await character('mage');
  try {
    bot = await client(rt, c); await ready(rt, bot);
    bot.send([{ kind: 'questAccept', questId: 'q1', npcId: 'brinebeard' }]); const accepted = bot.sequence;
    await until(() => bot.results.some(r => r.inputSequence === accepted && r.status === 'durable') || rt.failures.length); assert.deepEqual(rt.failures, []);
    // From here every save attempt hangs until the "crash", then fails: nothing after the acknowledged round commits.
    let crash; const crashed = new Promise(resolve => { crash = resolve; }); gate.armed = async () => { await crashed; throw new Error('host crashed before COMMIT'); };
    acked = await store.getOwned(c.binding.accountId, c.record.characterId);
    const moving = setInterval(() => { if (bot.ws.readyState === WebSocket.OPEN) bot.send([], { forward: 1, steeringYaw: 1 }); }, 50);
    try { await until(() => gate.entered > 0 || rt.failures.length); await delay(300); } finally { clearInterval(moving); }
    bot.send([{ kind: 'questTrack', questId: 'q1' }]); const tracked = bot.sequence; await until(() => bot.receiver.header.consumedInput >= tracked);
    const moved = bot.state.actors.find(a => a.ref.id === bot.state.selfRef.id);
    assert.ok(Math.hypot(moved.x - acked.checkpoint.location.x, moved.z - acked.checkpoint.location.z) > 1, 'the unsaved window has visible progress');
    await rt.ownership.release(); await until(() => rt.host.stats().frozen); crash();
    await delay(50);
    assert.equal(bot.results.some(r => r.inputSequence === tracked), false, 'no result for unsaved progress');
  } finally { bot?.ws.close(); next = await rt.close(); }
  assert.equal(next.durable, false);
  const after = await store.getOwned(c.binding.accountId, c.record.characterId);
  assert.equal(after.revision, acked.revision, 'nothing committed after the acknowledged round'); assert.deepEqual(after.checkpoint, acked.checkpoint);
  const restarted = await runtime();
  try {
    resumed = await client(restarted, c); await ready(restarted, resumed);
    const self = resumed.state.actors.find(a => a.ref.id === resumed.state.selfRef.id);
    assert.equal(resumed.state.self.player.quests.status.q1, 'active', 'the acknowledged result survived');
    assert.ok(Math.hypot(self.x - after.checkpoint.location.x, self.z - after.checkpoint.location.z) < .5, 'the new host resumes from the last committed round');
    assert.deepEqual(resumed.errors, []);
  } finally { resumed?.ws.close(); await restarted.close(); }
});

test('rewards earned while a save is in flight are journaled and applied exactly once, also after a restart', { timeout: 30000 }, async () => {
  const { gate, characters } = gatedStore(), rt = await runtime({ combat: true, enemies: 6, characters }), bots = [], records = [], timers = [];
  try {
    for (let i = 0; i < 2; i++) { const c = await character('mage'), bot = await client(rt, c); records.push(c); bots.push(bot); await ready(rt, bot); }
    await until(() => !rt.host.stats().durableBarrier);
    // Hold the next save in its PG IO until a kill happens during it.
    let release; const blocked = new Promise(resolve => { release = resolve; }); gate.armed = () => blocked;
    for (const bot of bots) timers.push(attackLoop(bot));
    await until(() => gate.entered > 0 || rt.failures.length, 5000); gate.armed = null;
    const before = kills(bots); await until(() => kills(bots) > before || rt.failures.length, 15000);
    assert.equal(rt.host.stats().durableBarrier, true, 'the kill happened while the save was in flight'); release();
    await until(() => kills(bots) >= before + 3 || rt.failures.length, 20000);
    for (const t of timers) clearInterval(t); timers.length = 0;
    await afterSave(rt); await afterSave(rt); assert.deepEqual(rt.failures, []);
    for (const [i, c] of records.entries()) {
      const ledger = await grantLedger(c);
      assert.deepEqual(ledger.receipts, ledger.ids); assert.equal(bots[i].state.self.player.xp, ledger.xp);
      assert.equal((await store.getOwned(c.binding.accountId, c.record.characterId)).checkpoint.progress.xp, ledger.xp);
    }
  } finally { for (const t of timers) clearInterval(t); for (const b of bots) b.ws.close(); assert.deepEqual(await rt.close(), { durable: true, unresolved: 0 }); }
  const restarted = await runtime(), again = [];
  try {
    for (const c of records) { const bot = await client(restarted, c); again.push(bot); await ready(restarted, bot); }
    for (const [i, c] of records.entries()) {
      const ledger = await grantLedger(c);
      assert.equal(again[i].state.self.player.xp, ledger.xp, 'no reward is applied a second time'); assert.deepEqual(ledger.receipts, ledger.ids);
      assert.deepEqual(await store.pendingGrants(c.binding.accountId, c.record.characterId), []);
    }
  } finally { for (const b of again) b.ws.close(); await restarted.close(); }
});

test('a far actor (40 to 80 m) is refreshed every 4th snapshot and never removed on the client, near ones every snapshot', { timeout: 20000 }, async () => {
  const rt = await runtime(); let viewer, mover;
  try {
    const w1 = loaded.get('w1'), spawn = w1.publicDefinition.spawn.position, a = await character('mage'), b = await character('warrior');
    const out = { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; return this; } };
    w1.query.resolveCollision(spawn.x + 58, spawn.z, w1.actionData.archetype('human').radius, out);
    const checkpoint = structuredClone(b.record.checkpoint); checkpoint.location = { x: out.x, y: w1.query.heightAt(out.x, out.y), z: out.y, yaw: 0 };
    b.record = await store.saveCheckpoint(b.binding.accountId, b.record.characterId, b.record.revision, checkpoint, []); // Trusted placement fixture.
    viewer = await client(rt, a); await ready(rt, viewer); mover = await client(rt, b); await ready(rt, mover);
    await until(() => viewer.state.actors.some(x => x.ref.id === mover.state.selfRef.id));
    const id = mover.state.selfRef.id, me = viewer.state.selfRef.id;
    const distance = () => { const v = viewer.state.actors.find(x => x.ref.id === me), m = mover.state.actors.find(x => x.ref.id === id); return Math.hypot(v.x - m.x, v.z - m.z); };
    assert.ok(distance() > 42 && distance() < 78, `fixture distance ${distance()}`);
    // Both turn in place every tick, so both yaws change in every snapshot of the Area.
    const seen = [];
    const turning = setInterval(() => { for (const bot of [viewer, mover]) if (bot.ws.readyState === WebSocket.OPEN) bot.send([], { turn: 1 }); }, 30);
    const own = new Map(); let last = null;
    const onMessage = () => {
      const state = viewer.state; if (!state || state.sequence === last) return; last = state.sequence;
      const far = state.actors.find(x => x.ref.id === id), self = state.actors.find(x => x.ref.id === me);
      seen.push({ sequence: state.sequence, tick: state.header.tick, present: !!far, yaw: far?.yaw, self: self.yaw });
    };
    const ownTrack = () => { if (mover.state) own.set(mover.state.header.tick, mover.state.actors.find(x => x.ref.id === id).yaw); };
    viewer.ws.on('message', onMessage); mover.ws.on('message', ownTrack);
    const startStats = rt.host.stats();
    try { await delay(2500); } finally { clearInterval(turning); viewer.ws.off('message', onMessage); mover.ws.off('message', ownTrack); }
    const endStats = rt.host.stats();
    assert.ok(seen.length >= 20, `snapshots ${seen.length}`); assert.ok(seen.every(s => s.present), 'the far actor is in every snapshot');
    let changes = 0, consecutive = 0, gaps = [];
    for (let i = 1; i < seen.length; i++) {
      if (seen[i].sequence !== seen[i - 1].sequence + 1) continue; consecutive++;
      assert.notEqual(seen[i].self, seen[i - 1].self, 'the viewer itself (near) changes in every snapshot');
      if (seen[i].yaw !== seen[i - 1].yaw) { changes++; gaps.push(seen[i].sequence); if (own.has(seen[i].tick)) assert.equal(seen[i].yaw, own.get(seen[i].tick), 'a refresh carries the current value'); }
    }
    const spacing = gaps.slice(1).map((s, i) => s - gaps[i]);
    assert.ok(spacing.length >= 3 && spacing.every(gap => gap % 4 === 0), JSON.stringify({ spacing, changes, consecutive }));
    assert.ok(changes >= Math.floor(consecutive / 4) - 1 && changes <= Math.ceil(consecutive / 4) + 1, JSON.stringify({ changes, consecutive }));
    assert.ok(endStats.aoiFar > startStats.aoiFar && endStats.aoiFarHeld > startStats.aoiFarHeld);
    assert.deepEqual(viewer.errors, []); assert.deepEqual(mover.errors, []); assert.deepEqual(rt.failures, []);
  } finally { viewer?.ws.close(); mover?.ws.close(); await rt.close(); }
});


test('a save round whose journal write fails is given up without acknowledging or leaking anything, and the next round holds the world and pays every reward once', { timeout: 30000 }, async () => {
  let failNext = 0, failed = 0;
  // The first victim outcome write of the armed round fails as a client-side query deadline would, after nothing committed.
  const characters = new Proxy(store, { get(target, key) {
    if (key === 'recordVictimOutcome') return async (...args) => { if (failNext > 0) { failNext--; failed++; throw new Error('Query read timeout'); } return target.recordVictimOutcome(...args); };
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const rt = await runtime({ combat: true, enemies: 6, characters }), bots = [], records = [], timers = [];
  try {
    for (let i = 0; i < 2; i++) { const c = await character('mage'), bot = await client(rt, c); records.push(c); bots.push(bot); await ready(rt, bot); }
    await until(() => !rt.host.stats().durableBarrier);
    const start = rt.host.stats(); failNext = 1;
    for (const bot of bots) timers.push(attackLoop(bot));
    await until(() => failed === 1 || rt.failures.length, 20000);
    await until(() => rt.host.stats().saveRetries > start.saveRetries || rt.failures.some(f => f.stage !== 'save-journal-retry'), 10000);
    const retried = rt.host.stats();
    assert.equal(retried.frozen, false); assert.equal(retried.saveRetries - start.saveRetries, 1);
    // The retry is a halting round (the world held while it journals), started right after the failure.
    await until(() => rt.host.stats().haltingBarriers > start.haltingBarriers && !rt.host.stats().durableBarrier || rt.failures.some(f => f.stage !== 'save-journal-retry'), 10000);
    const before = kills(bots); await until(() => kills(bots) >= before + 2 || rt.failures.some(f => f.stage !== 'save-journal-retry'), 20000);
    for (const t of timers) clearInterval(t); timers.length = 0;
    bots[0].send([{ kind: 'questAccept', questId: 'q1', npcId: 'brinebeard' }]); const accepted = bots[0].sequence;
    await until(() => bots[0].results.some(r => r.inputSequence === accepted) || rt.failures.some(f => f.stage !== 'save-journal-retry'), 10000);
    await afterSave(rt); await afterSave(rt);
    assert.deepEqual(rt.failures.map(f => [f.stage, f.message]), [['save-journal-retry', 'Query read timeout']]);
    const end = rt.host.stats();
    assert.equal(end.frozen, false); assert.equal(end.checkpointCaptures, 0, 'the given-up captures are not left behind'); assert.equal(end.pendingSourceGrants, 0);
    assert.ok(end.saveRounds - start.saveRounds >= 2, 'the non-halting rounds resume after the retry');
    for (const [i, c] of records.entries()) {
      const ledger = await grantLedger(c), saved = await store.getOwned(c.binding.accountId, c.record.characterId);
      assert.deepEqual(ledger.receipts, ledger.ids, 'every journaled reward has exactly one receipt');
      assert.equal(saved.checkpoint.progress.xp, ledger.xp); assert.equal(bots[i].state.self.player.xp, ledger.xp);
      assert.deepEqual(await store.pendingGrants(c.binding.accountId, c.record.characterId), []);
    }
    const result = bots[0].results.find(r => r.inputSequence === accepted);
    assert.equal(result.status, 'durable'); assert.equal((await store.getOwned(records[0].binding.accountId, records[0].record.characterId)).checkpoint.progress.quests.status.q1, 'active');
    for (const bot of bots) assert.deepEqual(bot.errors, []);
  } finally { for (const t of timers) clearInterval(t); for (const b of bots) b.ws.close(); assert.deepEqual(await rt.close(), { durable: true, unresolved: 0 }); }
});

for (const dungeons of [false, true]) test(`${dungeons ? 'dungeons enabled: ' : ''}a gate travel right after another player's kill journals that reward before the transfer can acknowledge it, and nothing fails closed`, { timeout: 30000 }, async () => {
  // A save interval longer than the test keeps the kill's grant unjournaled until the travel; on a real host that window is
  // up to one interval (1 s). The transfer records every unacknowledged grant of its source Area (any recipient) in an
  // in-memory mailbox and acknowledges it there, so a grant it takes must already be in PG.
  const rt = await runtime({ combat: true, dungeons, checkpointIntervalMs: 60000 }), bots = [];
  let closed;
  try {
    const x = await character('mage'), y = await character('mage');
    const w1 = loaded.get('w1'), gate = w1.publicDefinition.interactions.find(i => i.id === 'gate:w2');
    // Trusted navigation/unlock fixture for Y only, not earned progression or client position input.
    const checkpoint = structuredClone(y.record.checkpoint);
    checkpoint.progress.flags = { ...checkpoint.progress.flags, abyssCleared: true, trueCleared: true, finalCleared: true };
    const out = { x: 0, y: 0, set(a, b) { this.x = a; this.y = b; return this; } };
    w1.query.resolveCollision(gate.position.x, gate.position.z, w1.actionData.archetype('human').radius, out);
    checkpoint.location = { x: out.x, y: w1.query.heightAt(out.x, out.y), z: out.y, yaw: 0 };
    y.record = await store.saveCheckpoint(y.binding.accountId, y.record.characterId, y.record.revision, checkpoint, []);
    const bx = await client(rt, x); bots.push(bx); await ready(rt, bx);
    const by = await client(rt, y); bots.push(by); await ready(rt, by);
    await until(() => !rt.host.stats().durableBarrier);
    const rounds = rt.host.stats().persistenceBarriers;
    const target = bx.state.actors.find(a => a.kind === 'scrapling'); assert.ok(target);
    bx.send([{ kind: 'target', target: target.ref }, { kind: 'ability', slot: 1 }]);
    const heartbeat = setInterval(() => { if (bx.ws.readyState === WebSocket.OPEN) bx.send([]); }, 50);
    try { await until(() => bx.state.self.player.xp > 0 || rt.failures.length, 10000); } finally { clearInterval(heartbeat); }
    assert.equal(rt.host.stats().persistenceBarriers, rounds, 'no save round ran since the kill, so its grant is not journaled yet');
    const before = by.binding.area;
    by.send([{ kind: 'travel', gateId: 'gate:w2' }]);
    await until(() => by.binding.area !== before && by.state.world === 'w2' || by.controls.some(v => v.type === 'error') || rt.failures.length || rt.host.stats().frozen, 8000);
    await until(() => !rt.host.stats().durableBarrier || rt.failures.length);
    const ledger = await grantLedger(x), saved = await store.getOwned(x.binding.accountId, x.record.characterId);
    const result = { traveled: by.binding.area !== before && by.state.world === 'w2', failures: rt.failures, frozen: rt.host.stats().frozen,
      journaled: ledger.ids.length, receipted: ledger.receipts.length, savedXp: saved.checkpoint.progress.xp, shownXp: bx.state.self.player.xp };
    assert.deepEqual(result, { traveled: true, failures: [], frozen: false, journaled: 1, receipted: 1, savedXp: ledger.xp, shownXp: ledger.xp });
    assert.ok(ledger.xp > 0); assert.deepEqual(ledger.receipts, ledger.ids);
    assert.equal((await store.getOwned(y.binding.accountId, y.record.characterId)).checkpoint.world, 'w2');
    for (const bot of bots) assert.deepEqual(bot.errors, []);
  } finally { for (const b of bots) b.ws.close(); closed = await rt.close(); }
  assert.deepEqual(closed, { durable: true, unresolved: 0 });
});
