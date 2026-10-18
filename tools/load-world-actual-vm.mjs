/** Launcher bundled next to load-main.mjs by tools/load-world-actual-build.mjs. Starts a throwaway Postgres
 * (local-postgres.mjs, 127.0.0.1 only, under TMPDIR) and the instrumented real host on 127.0.0.1:PORT.
 * Env: PORT, LOAD_STATS_PORT, TMPDIR (the run directory). SIGTERM stops the host, then the cluster.
 * The World I population below is a measurement config, not a tuning recommendation. */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startPostgres } from '../server/node/local-postgres.mjs';

const port = Number(process.env.PORT), statsPort = Number(process.env.LOAD_STATS_PORT);
if (!Number.isInteger(port) || port < 10000 || [8080, 8081].includes(port) || !Number.isInteger(statsPort)) throw new Error('PORT (>=10000, not 8080/8081) and LOAD_STATS_PORT required');
const dir = new URL('./', import.meta.url), manifest = JSON.parse(readFileSync(new URL('world/world-manifest.json', dir), 'utf8'));
const canonical = { w1: [1, 2, 2], w2: [10, 12, 10], w3: [20, 22, 20], w4: [100, 102, 100] };
const respawn = { w1: [30, 45, 40], w2: [12, 6, 12], w3: [12, 6, 12], w4: [12, 12, 12] };
const population = { w1: { scrapling: Number(process.env.LOAD_SCRAPLINGS ?? 60), scavenger: Number(process.env.LOAD_SCAVENGERS ?? 30), jellyfish: Number(process.env.LOAD_JELLYFISH ?? 10), shallowPatrols: 0 } };
export const config = { schema: 'world-startup-v1', ownership: { key: 'load-world-actual' }, assets: { source: manifest.source, manifest: 'world-manifest.json' },
  worlds: Object.fromEntries(['w1', 'w2', 'w3', 'w4'].map((w, i) => [w, { seed: i + 1, populationMode: 'fixed-slots',
    fixedLevels: { scrapling: canonical[w][0], scavenger: canonical[w][1], jellyfish: canonical[w][2], echo: 10 },
    population: population[w] ?? { scrapling: 1, scavenger: 0, jellyfish: 0, shallowPatrols: 0 },
    respawnSeconds: { scrapling: respawn[w][0], scavenger: respawn[w][1], jellyfish: respawn[w][2], echo: 120 } }])),
  // victimOutcome and chat are required since the world-startup-v1 schema gained them; values copied from deploy/vm/world-dev.json.
  victimOutcome: { maxEntries: 1024, maxPayloadBytes: 4194304, timeoutMs: 3000 }, chat: { maxPending: 16 },
  restore: { cooldowns: 'pause', statuses: 'pause', death: 'pause', history: 'pause', hp: 'preserve', resource: 'preserve', location: 'saved', activity: 'cancel' },
  limits: { maxConnections: 400, maxConnectionsPerIp: 400, maxWaiting: 400 }, party: { enabled: false }, characters: { maxCharactersPerAccount: 1 } };

const cluster = await startPostgres();
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [fileURLToPath(new URL('load-main.mjs', dir))], { stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env, DATABASE_URL: cluster.url, HOST: '127.0.0.1', PORT: String(port), LOAD_STATS_PORT: String(statsPort), ALLOWED_ORIGINS: origin,
    TRUST_PROXY: '1', WORLD_ENABLED: '1', WORLD_CONFIG_JSON: JSON.stringify(config) } });
console.log(JSON.stringify({ launcher: process.pid, host: child.pid, origin, config }));
let stopping = false;
const stop = async () => {
  if (stopping) return; stopping = true;
  if (child.exitCode === null) { child.kill('SIGTERM'); const t = setTimeout(() => child.kill('SIGKILL'), 12000); await once(child, 'exit').catch(() => {}); clearTimeout(t); }
  cluster.stop(); console.log('launcher stopped'); process.exit(0);
};
process.on('SIGTERM', stop); process.on('SIGINT', stop); process.on('SIGHUP', stop);
child.on('exit', (code, signal) => { console.log(`host exited ${code}/${signal}`); void stop(); });
