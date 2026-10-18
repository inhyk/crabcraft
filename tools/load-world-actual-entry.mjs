/** Measurement entry for tools/load-world-actual.mjs: runs the unchanged server/node/main.ts and, only on
 * LOAD_STATS_PORT (127.0.0.1), exposes the host's own per-tick timings, process /proc counters and a seed route.
 * The per-tick hook is injected at bundle time by tools/load-world-actual-build.mjs; no source file is edited.
 * Never point this at a production database: /seed inserts accounts and sessions. */
import { createServer } from 'node:http';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const statsPort = Number(process.env.LOAD_STATS_PORT);
if (!Number.isInteger(statsPort) || statsPort < 1024) { console.error('LOAD_STATS_PORT is required'); process.exit(1); }
let samples = new Map(); let host = null; let baseline = null; let windowStarted = performance.now(); let procStart = null;
globalThis.__crabLoadObserve = (name, ms) => { let list = samples.get(name); if (!list) samples.set(name, list = []); list.push(ms); };
globalThis.__crabLoadHost = value => { host = value; };
const loop = monitorEventLoopDelay({ resolution: 1 }); loop.enable();

const quantile = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] : 0;
function summarize(values, budgets) {
  const s = [...values].sort((a, b) => a - b), sum = s.reduce((n, v) => n + v, 0);
  return { count: s.length, mean: s.length ? sum / s.length : 0, p50: quantile(s, .5), p95: quantile(s, .95), p99: quantile(s, .99), max: s.at(-1) ?? 0,
    ...Object.fromEntries(budgets.map(b => [`over${b}ms`, s.filter(v => v > b).length])) };
}
function proc() {
  try {
    const stat = readFileSync('/proc/self/stat', 'utf8'), fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const status = readFileSync('/proc/self/status', 'utf8'), rssKb = Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? NaN);
    const cpu = readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/).slice(1).map(Number); // whole VM: user nice system idle iowait irq softirq steal
    return { utimeTicks: Number(fields[11]), stimeTicks: Number(fields[12]), rssKb, loadavg: readFileSync('/proc/loadavg', 'utf8').trim(), pid: process.pid,
      vmBusyTicks: cpu.reduce((n, v) => n + v, 0) - cpu[3] - cpu[4], vmTotalTicks: cpu.reduce((n, v) => n + v, 0), vmStealTicks: cpu[7] ?? 0 };
  } catch { return { utimeTicks: null, stimeTicks: null, rssKb: Math.round(process.memoryUsage().rss / 1024), loadavg: null, pid: process.pid }; }
}
const GAUGES = new Set(['connections', 'actors', 'waiting']);
const hostCounters = () => host ? { ...host.metrics, droppedTicks: [...host.allSlots].reduce((n, s) => n + s.tick.dropped, 0),
  droppedSnapshots: [...host.allSlots].reduce((n, s) => n + s.snapshot.dropped, 0), connections: host.connections.size, actors: host.actors.size, waiting: host.waiting.length } : null;
function snapshot() {
  // connections/actors/waiting are gauges (current value); every other counter is reported as the delta since /reset.
  const counters = hostCounters(), delta = counters && baseline ? Object.fromEntries(Object.entries(counters).map(([k, v]) => [k, typeof v === 'number' && typeof baseline[k] === 'number' && !GAUGES.has(k) ? v - baseline[k] : v])) : counters;
  return { windowMs: performance.now() - windowStarted, tick: summarize(samples.get('tick') ?? [], [10, 33.333]), snapshotBatch: summarize(samples.get('snapshotBatch') ?? [], [10, 33.333]),
    eventLoopDelayMs: { p50: loop.percentile(50) / 1e6, p99: loop.percentile(99) / 1e6, max: loop.max / 1e6, mean: loop.mean / 1e6 },
    counters: delta, proc: proc(), procStart, clockTicksPerSecond: 100, cpuUsage: process.cpuUsage(), rss: process.memoryUsage().rss };
}
function reset() { samples = new Map(); loop.reset(); baseline = hostCounters(); windowStarted = performance.now(); procStart = proc(); }

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
async function seed(count, prefix) {
  if (!Number.isInteger(count) || count < 1 || count > 500 || !/^[a-z0-9]{1,8}$/.test(prefix)) throw new Error('seed arguments');
  const out = [], now = Date.now();
  for (let i = 0; i < count; i++) {
    const account = 'g' + randomBytes(12).toString('hex').slice(0, 23), token = randomBytes(32).toString('hex'); // accounts_google: ^g[a-f0-9]{23}$
    await pool.query('INSERT INTO accounts(username,updated,created) VALUES($1,$2,$2)', [account, now]);
    await pool.query('INSERT INTO sessions(token_hash,username,expires) VALUES($1,$2,$3)', [createHash('sha256').update(token).digest('hex'), account, now + 3600000]);
    out.push({ account, cookie: `cc_account=${account}.${token}` });
  }
  return out;
}
const stats = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1'), send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (req.method === 'GET' && url.pathname === '/stats') return send(200, snapshot());
  if (req.method === 'POST' && url.pathname === '/reset') { reset(); return send(200, { ok: true }); }
  if (req.method === 'POST' && url.pathname === '/seed') { void seed(Number(url.searchParams.get('n')), url.searchParams.get('prefix') ?? '').then(v => send(200, v), e => send(400, { error: e.message })); return; }
  send(404, {});
});
stats.listen(statsPort, '127.0.0.1', () => console.log(`load stats listening on 127.0.0.1:${statsPort}`));
reset();
await import('../server/node/main.ts');
