#!/usr/bin/env node
/** Disposable loopback QA: real PG, account handler, tickets, collision, Area and binary host.
 * Seeds a Google-shaped QA account/session and a NEW level-1 character; never calls OAuth.
 * Its operational/balance/restore values below are explicit QA settings, not production defaults.
 */
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import { startPostgres } from '../server/node/local-postgres.mjs';
import { createPool, migrate } from '../server/node/db.ts';
import { accountHandler, createWorldAdmission, originAllowed } from '../server/node/accounts.ts';
import { CharacterStore } from '../server/world/character-store.ts';
import { DurableOutcomeStore } from '../server/world/contribution-store.ts';
import { planOutcomePage } from '../src/sim/ledger.ts';
import { createCharacterHandler } from '../server/world/characters-http.ts';
import { acquireHostOwnership } from '../server/world/ownership.ts';
import { loadWorldCatalog, createGameplayCatalog } from '../server/world/catalog.ts';
import { createActualWorldHost } from '../server/world/host.ts';
import { WorldChatService } from '../server/world/chat.ts';
import { createCoreCharacterCodec } from '../src/sim/persistence.ts';
import { setQuestChapter } from '../src/sim/data/quests.ts';
import { canonicalEnemyLevel, canonicalEnemyRespawn } from '../src/sim/data/enemies.ts';
import { CLASSES } from '../src/sim/data/classes.ts';
import { RACES } from '../src/data/races.ts';
import { createWorldVariants, personalNpcVisible } from '../src/sim/areas/variants.ts';
import { createGameplayProtocol, projectObservationExtras } from '../server/world/gameplay/protocol.ts';

const args = { port: 5287, clientOrigin: 'http://127.0.0.1:5276', metadata: '', world: 'w1', party: '0', ledger: '0' };
for (let i = 2; i < process.argv.length; i += 2) {
  const key = { '--port': 'port', '--client-origin': 'clientOrigin', '--metadata': 'metadata', '--world': 'world', '--party': 'party', '--ledger': 'ledger' }[process.argv[i]];
  if (!key || process.argv[i + 1] === undefined) throw new Error('expected --port N --client-origin URL --metadata ABSOLUTE_TMP_PATH');
  args[key] = key === 'port' ? Number(process.argv[i + 1]) : process.argv[i + 1];
}
const clientURL = new URL(args.clientOrigin);
if (!['127.0.0.1', 'localhost'].includes(clientURL.hostname) || clientURL.protocol !== 'http:' || clientURL.origin !== args.clientOrigin || !Number.isInteger(args.port) || args.port < 0 || args.port > 65535) throw new Error('QA launcher requires HTTP loopback');
if (!isAbsolute(args.metadata) || !['/tmp/', '/private/tmp/'].some(prefix => resolve(args.metadata).startsWith(prefix))) throw new Error('metadata must be an absolute temporary path');
if (!['w1', 'w2', 'w3', 'w4'].includes(args.world)) throw new Error('QA world must be w1..w4');
if (!['0', '1'].includes(args.party)) throw new Error('QA party must be 0 or 1');
if (!['0', '1'].includes(args.ledger)) throw new Error('QA ledger must be 0 or 1');

let cluster, pool, ownership, host, server, metadataWritten = false, closing;
async function cleanup() {
  if (closing) return closing;
  closing = (async () => {
    const result = host ? await host.shutdown(5000) : { durable: true, unresolved: 0 };
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await ownership?.release(); await pool?.end(); cluster?.stop();
    if (metadataWritten) await unlink(args.metadata).catch(() => {});
    return result;
  })();
  return closing;
}
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
  void cleanup().then(result => { process.stdout.write(JSON.stringify({ stopped: true, ...result }) + '\n'); process.exit(result.durable ? 0 : 1); }, () => process.exit(1));
});
try {
  cluster = await startPostgres(); pool = createPool(cluster.url); await migrate(pool);
  ownership = await acquireHostOwnership(pool, 'qa-actual-world-host');
  const directory = new URL('../public/world/', import.meta.url);
  const source = JSON.parse(await readFile(new URL('collision-w1.json', directory), 'utf8')).source;
  const ids = ['w1', 'w2', 'w3', 'w4'];
  const policies = Object.fromEntries(ids.map(id => [id, { enemyLevel: spawn => spawn.fixedLevel,
    enemyPopulation: spawn => ({ desired: 1, respawnSeconds: canonicalEnemyRespawn(spawn.kind, Number(id.slice(1)), spawn.role) }),
    damageAllowed: (context, source, target) => !(source?.kind === 'player' && target.kind === 'player') || context.pvp === 'party-only', canInteract: () => true }]));
  const worlds = await loadWorldCatalog({ directory, expectedBakeSource: source, maxBakeBytes: 16 * 1024 * 1024, maxCells: 1000000,
    configs: Object.fromEntries(ids.map(id => [id, { fixedLevels: {
      scrapling: canonicalEnemyLevel('scrapling', Number(id.slice(1)), 'ordinary'), scavenger: canonicalEnemyLevel('scavenger', Number(id.slice(1)), 'ordinary'),
      jellyfish: canonicalEnemyLevel('jellyfish', Number(id.slice(1)), 'ordinary'), echo: canonicalEnemyLevel('scavenger', Number(id.slice(1)), 'echo'),
    }, population: { scrapling: 3, scavenger: 1, jellyfish: 0 } }])),
    policies, seeds: { w1: 11, w2: 22, w3: 33, w4: 44 }, variants: createWorldVariants });
  const spawn = worlds.get('w1').publicDefinition.spawn;
  const codec = createCoreCharacterCodec({ identities: Object.keys(CLASSES).flatMap(classId => Object.keys(RACES).map(archetype => ({ classId, archetype }))), freshLocation: { ...spawn.position, yaw: spawn.yaw } });
  const characters = new CharacterStore(pool, codec), admission = createWorldAdmission(pool), catalog = createGameplayCatalog(worlds);
  const accountId = 'g' + randomBytes(12).toString('hex').slice(0, 23), rawToken = randomBytes(32).toString('hex'), expiresAt = Date.now() + 3600000;
  await pool.query('INSERT INTO accounts(username,updated,created) VALUES($1,$2,$2)', [accountId, Date.now()]);
  await pool.query('INSERT INTO sessions(token_hash,username,expires) VALUES($1,$2,$3)', [createHash('sha256').update(rawToken).digest('hex'), accountId, expiresAt]);
  let character = await characters.create(accountId, { schema: 'world-identity-v1', classId: 'mage', archetype: 'human',
    appearance: { race: 'human', sex: 'female', classId: 'mage', shell: 0, crest: 0, led: 0, name: 'World QA' } });
  if (args.world !== 'w1') {
    // Trusted render fixture only. No XP, coins or story/unlock flags are granted, and no browser teleport occurs.
    const checkpoint = structuredClone(character.checkpoint), loaded = worlds.get(args.world), destination = loaded.publicDefinition.spawn;
    const out = { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; return this; } };
    loaded.query.resolveCollision(destination.position.x, destination.position.z, loaded.actionData.archetype('human').radius, out);
    checkpoint.world = args.world; checkpoint.location = { x: out.x, y: loaded.query.heightAt(out.x, out.y), z: out.y, yaw: destination.yaw };
    setQuestChapter(checkpoint.progress.quests, Number(args.world.slice(1)));
    character = await characters.saveCheckpoint(accountId, character.characterId, character.revision, checkpoint, []);
  }
  const allowed = [args.clientOrigin];
  const ip = req => req.socket.remoteAddress ?? 'unknown';
  const accounts = accountHandler(pool, allowed, ip, null, admission);
  const characterPolicy = { maxCharactersPerAccount: 16 }; // Explicit QA bound, not a deployment slot policy.
  const characterHttp = createCharacterHandler({ pool, characters, codec, origins: allowed, clientIp: ip, policy: characterPolicy });
  host = createActualWorldHost({ admission, characters, worlds, codec, ownership, chat: new WorldChatService(pool),
    outcomes: args.ledger === '1' ? new DurableOutcomeStore(pool, codec, { planOutcomePage, queryTimeoutMs: 5000 }) : undefined,
    gameplay: { catalog, create: () => createGameplayProtocol(catalog) },
    policies: { authTimeoutMs: 2000, inputTimeoutMs: 300, reconnectGraceMs: 3000, sessionRevalidateMs: 1000, checkpointIntervalMs: 2000,
      maxConnections: 16, maxConnectionsPerIp: 16, maxWaiting: 16, maxAuthFrameBytes: 2048, maxFrameBytes: 65536,
      maxBufferedBytes: 8 * 1024 * 1024, maxQueuedInputs: 128, maxMutationSourcesPerTick: 64, loopIntervalMs: 2, chat: { maxPending: 16 },
      // Explicit QA-only source/page budgets. They do not define production capacity or eligibility.
      ledger: args.ledger === '1' ? {
        sourceLimits: { maxDirtyCreditEntries: 10000, maxDirtyCreditBytes: 16 * 1024 * 1024, maxPendingDeaths: 32, maxStagedBytes: 8 * 1024 * 1024 },
        drainLimits: { pageSize: 100, creditBatchesPerSlice: 1, outcomesPerSlice: 1, summaryVictimsPerSlice: 10, writeAttempts: 3 },
        recoveryLimits: { draftsPerSlice: 10, pageSize: 100 }, recoveryIntervalMs: 1000,
      } : undefined,
      victimOutcome: { maxEntries: 2048, maxPayloadBytes: 8 * 1024 * 1024, timeoutMs: 5000 }, // Explicit QA backpressure, not an eligibility cut.
      persistence: { maxQueuedPerCharacter: 1, maxAttempts: 3, retryMs: 20, maxRecoveryRounds: 2 },
      areaLimits: { eventCount: 4096, inputCommandsPerTick: 32, timers: 512, projectiles: 512 },
      party: args.party === '1' ? { maxParties: 8, maxEncounters: 8, returnSpawn: () => 'spawn' } : undefined,
      restore: { version: 'qa-preserve-survival-pause-offline-cancel-activity', restore: c => ({ ...c, activity: {
        seated: false, village: false, controlsLocked: false, cast: null, channel: null, dash: false, pendingHit: false, rootPending: false,
        motion: { velocityX: 0, velocityZ: 0, jumpRemaining: 0, spinRemaining: 0, pushX: 0, pushZ: 0, pushRemaining: 0, lift: 0, dashElapsed: null } } }) },
      offlineSeconds: (record, now) => Math.max(0, now - record.updatedAt) / 1000,
      visible: (unit, viewer) => personalNpcVisible(worlds.get(`w${viewer.quests.chapter}`).publicDefinition, unit.npcId, viewer.flags),
      observationExtras: projectObservationExtras },
    originAllowed: (origin, req) => originAllowed(origin, allowed, req.headers.host), clientIp: ip,
    nowMonotonicMs: () => performance.now(), nowWallMs: Date.now,
    onFailure: stage => process.stderr.write(`world QA host failed at ${stage}\n`),
  });
  await host.ready();
  server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/api/account/world-catalog' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(catalog)); return; }
    if (path === '/api/account/world-characters') { void characterHttp(req, res); return; }
    if (path.startsWith('/api/account/')) { void accounts(req, res); return; }
    res.writeHead(path === '/world' ? 426 : path === '/healthz' ? 200 : 404); res.end(path === '/healthz' ? 'ok\n' : '');
  });
  server.on('upgrade', (req, socket, head) => { if (req.url?.split('?')[0] === '/world') host.handleUpgrade(req, socket, head); else socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(args.port, '127.0.0.1', resolve); });
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  await writeFile(args.metadata, JSON.stringify({ origin: baseURL, clientOrigin: args.clientOrigin, characterId: character.characterId,
    cookie: { name: 'cc_account', value: `${accountId}.${rawToken}`, path: '/api/account' }, catalog, appearance: character.identity.appearance, initialWorld: args.world,
    earnedTravel: false, renderFixture: args.world !== 'w1', world: args.world, chapter: character.checkpoint.progress.quests.chapter, spawn: character.checkpoint.location,
    partyEnabled: args.party === '1', ledgerMode: args.ledger === '1' ? 'external-durable' : 'retained', characterPolicy,
    fixture: 'Seeded Google-shaped QA session and new level-1 mage. No OAuth/provider call. Actual Node Area/bakes; QA population and explicit restore policy. Non-W1 selection is a trusted saved-world render fixture with zero XP and no earned unlock claims.' }), { flag: 'wx', mode: 0o600 });
  metadataWritten = true;
  process.stdout.write(JSON.stringify({ ready: true, baseURL, metadataPath: args.metadata }) + '\n');
} catch {
  process.stderr.write('world QA launcher failed; no credentials were logged\n'); await cleanup(); process.exit(1);
}
