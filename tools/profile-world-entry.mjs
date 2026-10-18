/** Profiling entry for the real world host. Same contract as tools/load-world-actual-entry.mjs (stats, reset, seed on
 * LOAD_STATS_PORT, 127.0.0.1 only) plus, for this measurement only:
 * - POST /reset also starts an in-process V8 CPU profile (node:inspector) when PROFILE_DIR is set; it stops by itself
 *   after PROFILE_SECONDS (default 60) and is written to PROFILE_DIR/host-<n>-<connections>c.cpuprofile;
 * - every host observe(name, ms) series is summarized (tick, snapshotBatch, snapshotPrepare, recipientEncode, persistenceBarrier);
 * - pg Client.query count, wall time and parameter bytes by statement; GC pauses by kind; entities per snapshot and per recipient;
 *   the reason each durability barrier was started from a tick.
 * The hooks are injected at bundle time by tools/profile-world-build.mjs; no source file is edited.
 * Never point this at a production database: /seed inserts accounts and sessions. */
import { createServer } from 'node:http';
import { monitorEventLoopDelay, PerformanceObserver } from 'node:perf_hooks';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import pg from 'pg';

const statsPort = Number(process.env.LOAD_STATS_PORT);
if (!Number.isInteger(statsPort) || statsPort < 1024) { console.error('LOAD_STATS_PORT is required'); process.exit(1); }
const profileDir = process.env.PROFILE_DIR || '', profileSeconds = Number(process.env.PROFILE_SECONDS || 60), profileInterval = Number(process.env.PROFILE_INTERVAL_US || 1000);
let samples = new Map(); let host = null; let baseline = null; let windowStarted = performance.now(); let procStart = null;
let extra = null;
const freshExtra = () => ({ pg: new Map(), gc: new Map(), snapshots: { count: 0, units: [], players: [], projectiles: [], events: [] },
  recipients: { count: 0, visible: [], bytes: [], chunks: [], events: [] }, barrierReasons: {}, barriersStarted: 0, barrierActors: [] });
extra = freshExtra();
globalThis.__crabLoadObserve = (name, ms) => { let list = samples.get(name); if (!list) samples.set(name, list = []); list.push(ms); };
globalThis.__crabLoadHost = value => { host = value; };
globalThis.__crabLoadSnapshot = (snapshot, events) => {
  const s = extra.snapshots; s.count++; s.events.push(events); s.units.push(snapshot.units.length); s.players.push(snapshot.players.length); s.projectiles.push(snapshot.projectiles.length);
};
globalThis.__crabLoadRecipient = (visible, chunks, events) => {
  const r = extra.recipients; r.count++; r.visible.push(visible); r.chunks.push(chunks.length); r.bytes.push(chunks.reduce((n, c) => n + c.byteLength, 0)); r.events.push(events);
};
globalThis.__crabLoadBarrierReason = reason => { extra.barrierReasons[reason] = (extra.barrierReasons[reason] ?? 0) + 1; };
globalThis.__crabLoadBarrierStart = actors => { extra.barriersStarted++; extra.barrierActors.push(actors); };
const loop = monitorEventLoopDelay({ resolution: 1 }); loop.enable();

// pg: every Client.query (Pool.query goes through it) with wall time to completion and parameter bytes.
const statement = text => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 72);
const pgRecord = (key, ms, bytes) => { let e = extra.pg.get(key); if (!e) extra.pg.set(key, e = { count: 0, ms: 0, paramBytes: 0, maxMs: 0 }); e.count++; e.ms += ms; e.paramBytes += bytes; if (ms > e.maxMs) e.maxMs = ms; };
const originalQuery = pg.Client.prototype.query;
pg.Client.prototype.query = function (config, values, callback) {
  const text = typeof config === 'string' ? config : config?.text;
  if (typeof text !== 'string') return originalQuery.apply(this, arguments);
  const params = Array.isArray(values) ? values : Array.isArray(config?.values) ? config.values : [];
  let bytes = 0; for (const v of params) bytes += v == null ? 0 : typeof v === 'string' ? Buffer.byteLength(v) : String(v).length;
  const key = statement(text), started = performance.now();
  const cb = typeof values === 'function' ? values : typeof callback === 'function' ? callback : null;
  if (cb) {
    const wrapped = function (...rest) { pgRecord(key, performance.now() - started, bytes); return cb.apply(this, rest); };
    return typeof values === 'function' ? originalQuery.call(this, config, wrapped) : originalQuery.call(this, config, values, wrapped);
  }
  const result = originalQuery.apply(this, arguments);
  if (result && typeof result.then === 'function') result.then(() => pgRecord(key, performance.now() - started, bytes), () => pgRecord(key + ' [error]', performance.now() - started, bytes));
  return result;
};
const gcKinds = { 1: 'scavenge', 2: 'minorMarkSweep', 4: 'markSweepCompact', 8: 'incremental', 16: 'weakCallbacks' };
new PerformanceObserver(list => { for (const e of list.getEntries()) { const k = gcKinds[e.detail?.kind] ?? String(e.detail?.kind); let g = extra.gc.get(k); if (!g) extra.gc.set(k, g = { count: 0, ms: 0, maxMs: 0 }); g.count++; g.ms += e.duration; if (e.duration > g.maxMs) g.maxMs = e.duration; } }).observe({ entryTypes: ['gc'] });

const quantile = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] : 0;
function summarize(values, budgets = []) {
  const s = [...values].sort((a, b) => a - b), sum = s.reduce((n, v) => n + v, 0);
  return { count: s.length, sum, mean: s.length ? sum / s.length : 0, p50: quantile(s, .5), p95: quantile(s, .95), p99: quantile(s, .99), max: s.at(-1) ?? 0,
    ...Object.fromEntries(budgets.map(b => [`over${b}ms`, s.filter(v => v > b).length])) };
}
function proc() {
  try {
    const stat = readFileSync('/proc/self/stat', 'utf8'), fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const status = readFileSync('/proc/self/status', 'utf8'), rssKb = Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? NaN);
    const cpu = readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
    return { utimeTicks: Number(fields[11]), stimeTicks: Number(fields[12]), rssKb, loadavg: readFileSync('/proc/loadavg', 'utf8').trim(), pid: process.pid,
      vmBusyTicks: cpu.reduce((n, v) => n + v, 0) - cpu[3] - cpu[4], vmTotalTicks: cpu.reduce((n, v) => n + v, 0), vmStealTicks: cpu[7] ?? 0 };
  } catch { return { utimeTicks: null, stimeTicks: null, rssKb: Math.round(process.memoryUsage().rss / 1024), loadavg: null, pid: process.pid }; }
}
const GAUGES = new Set(['connections', 'actors', 'waiting']);
const hostCounters = () => host ? { ...host.metrics, droppedTicks: [...host.allSlots].reduce((n, s) => n + s.tick.dropped, 0),
  droppedSnapshots: [...host.allSlots].reduce((n, s) => n + s.snapshot.dropped, 0), connections: host.connections.size, actors: host.actors.size, waiting: host.waiting.length } : null;
function extraSummary() {
  const s = extra.snapshots, r = extra.recipients;
  return { pg: Object.fromEntries([...extra.pg].sort((a, b) => b[1].ms - a[1].ms)), pgTotal: [...extra.pg.values()].reduce((t, e) => ({ count: t.count + e.count, ms: t.ms + e.ms, paramBytes: t.paramBytes + e.paramBytes }), { count: 0, ms: 0, paramBytes: 0 }),
    gc: Object.fromEntries(extra.gc), gcTotalMs: [...extra.gc.values()].reduce((n, g) => n + g.ms, 0),
    snapshots: { count: s.count, units: summarize(s.units), players: summarize(s.players), projectiles: summarize(s.projectiles), events: summarize(s.events) },
    recipients: { count: r.count, visible: summarize(r.visible), bytes: summarize(r.bytes), chunks: summarize(r.chunks), events: summarize(r.events) },
    barrierReasons: extra.barrierReasons, barriersStarted: extra.barriersStarted, barrierActors: summarize(extra.barrierActors), profile: profileState.last };
}
function snapshot() {
  const counters = hostCounters(), delta = counters && baseline ? Object.fromEntries(Object.entries(counters).map(([k, v]) => [k, typeof v === 'number' && typeof baseline[k] === 'number' && !GAUGES.has(k) ? v - baseline[k] : v])) : counters;
  return { windowMs: performance.now() - windowStarted, tick: summarize(samples.get('tick') ?? [], [10, 33.333]), snapshotBatch: summarize(samples.get('snapshotBatch') ?? [], [10, 33.333]),
    observed: Object.fromEntries([...samples].map(([k, v]) => [k, summarize(v, [10, 33.333])])),
    eventLoopDelayMs: { p50: loop.percentile(50) / 1e6, p99: loop.percentile(99) / 1e6, max: loop.max / 1e6, mean: loop.mean / 1e6 },
    counters: delta, proc: proc(), procStart, clockTicksPerSecond: 100, cpuUsage: process.cpuUsage(), rss: process.memoryUsage().rss, extra: extraSummary() };
}

// In-process CPU profile, one per /reset, stopped after profileSeconds.
const session = new Session(); session.connect();
const profileState = { running: false, timer: null, n: 0, last: null };
async function stopProfile() {
  if (!profileState.running) return; profileState.running = false; clearTimeout(profileState.timer);
  const { profile } = await session.post('Profiler.stop');
  const file = `${profileDir}/host-${++profileState.n}-${host?.connections.size ?? 0}c.cpuprofile`;
  writeFileSync(file, JSON.stringify(profile)); profileState.last = { file, startTime: profile.startTime, endTime: profile.endTime, samples: profile.samples.length };
  console.log(`cpu profile written ${file} (${profile.samples.length} samples)`);
}
async function startProfile() {
  if (!profileDir) return;
  if (profileState.running) { await session.post('Profiler.stop'); profileState.running = false; clearTimeout(profileState.timer); }
  mkdirSync(profileDir, { recursive: true });
  await session.post('Profiler.enable'); await session.post('Profiler.setSamplingInterval', { interval: profileInterval }); await session.post('Profiler.start');
  profileState.running = true; profileState.timer = setTimeout(() => void stopProfile().catch(e => console.error('profile stop', e)), profileSeconds * 1000);
}
function reset() { samples = new Map(); extra = freshExtra(); loop.reset(); baseline = hostCounters(); windowStarted = performance.now(); procStart = proc(); }

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
async function seed(count, prefix) {
  if (!Number.isInteger(count) || count < 1 || count > 500 || !/^[a-z0-9]{1,8}$/.test(prefix)) throw new Error('seed arguments');
  const out = [], now = Date.now();
  for (let i = 0; i < count; i++) {
    const account = 'g' + randomBytes(12).toString('hex').slice(0, 23), token = randomBytes(32).toString('hex');
    await pool.query('INSERT INTO accounts(username,updated,created) VALUES($1,$2,$2)', [account, now]);
    await pool.query('INSERT INTO sessions(token_hash,username,expires) VALUES($1,$2,$3)', [createHash('sha256').update(token).digest('hex'), account, now + 3600000]);
    out.push({ account, cookie: `cc_account=${account}.${token}` });
  }
  return out;
}
const stats = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1'), send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (req.method === 'GET' && url.pathname === '/stats') return send(200, snapshot());
  if (req.method === 'POST' && url.pathname === '/reset') { reset(); void startProfile().then(() => send(200, { ok: true, profiling: profileState.running }), e => send(500, { error: e.message })); return; }
  if (req.method === 'POST' && url.pathname === '/profile/stop') { void stopProfile().then(() => send(200, profileState.last ?? {}), e => send(500, { error: e.message })); return; }
  if (req.method === 'POST' && url.pathname === '/seed') { void seed(Number(url.searchParams.get('n')), url.searchParams.get('prefix') ?? '').then(v => send(200, v), e => send(400, { error: e.message })); return; }
  send(404, {});
});
stats.listen(statsPort, '127.0.0.1', () => console.log(`load stats listening on 127.0.0.1:${statsPort}`));
reset();
await import('../server/node/main.ts');
