import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import type { Duplex } from 'node:stream';
import { attachRooms } from '../rooms.ts';
import { accountHandler, createWorldAdmission, GOOGLE_AUTH_URL, GOOGLE_TOKEN_URL, originAllowed } from './accounts.ts';
import { createPool, migrate } from './db.ts';
import { storeReport } from './reports.ts';
import { createCharacterHandler } from '../world/characters-http.ts';
import { WorldConfigError, describeWorldStartupFailure } from '../world/startup-error.ts';
import { monitorHandler } from './monitor.ts';

// Rooms and accounts for the browser client: what server/cloudflare/worker.ts served, on one VM behind Caddy.
// Env: PORT (8080), HOST (127.0.0.1), DATABASE_URL, ALLOWED_ORIGINS (comma separated, e.g. https://crab.seonn.dev,https://crab-dev.seonn.dev), TRUST_PROXY=1 behind Caddy,
// GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET for sign-in (GOOGLE_AUTH_URL and GOOGLE_TOKEN_URL override Google's endpoints in tests),
// MONITOR_ACCOUNTS and MONITOR_IPS for /monitor (docs/features/developer-monitor.md).
const env = process.env;
const port = Number(env.PORT || 8080), host = env.HOST || '127.0.0.1';
const origins = (env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
const trustProxy = env.TRUST_PROXY === '1';
if (!env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(1); }
if (!Number.isInteger(port) || port < 0 || port > 65535) { console.error(`Invalid PORT: ${env.PORT}`); process.exit(1); }
if (!origins.length) console.warn('ALLOWED_ORIGINS is empty: only local origins and clients without an Origin header are accepted');
const google = env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
  ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, authUrl: env.GOOGLE_AUTH_URL || GOOGLE_AUTH_URL, tokenUrl: env.GOOGLE_TOKEN_URL || GOOGLE_TOKEN_URL }
  : null;
if (!google) console.warn('GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is not set: Google sign-in answers 503');

const pool = createPool(env.DATABASE_URL);
for (let attempt = 1; ; attempt++) {
  try {
    const applied = await migrate(pool);
    if (applied.length) console.log(`applied migrations: ${applied.join(', ')}`);
    break;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // A migration that fails is a bug; an unreachable database may still be starting.
    if (message.startsWith('migration ') || attempt >= 10) { console.error(message); await pool.end(); process.exit(1); }
    console.error(`database not ready (${message}), retrying`);
    await new Promise(r => setTimeout(r, 2000));
  }
}

/** Caddy appends the peer address to X-Forwarded-For, so its last hop is the client. */
function clientIp(req: IncomingMessage) {
  if (trustProxy) {
    const hops = String(req.headers['x-forwarded-for'] ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return req.socket.remoteAddress ?? 'unknown';
}

const admission = createWorldAdmission(pool);
let world: Awaited<ReturnType<typeof import('../world/startup.ts').startConfiguredWorld>> | null = null;
let worldStartupFailed = false;
if (env.WORLD_ENABLED === '1') {
  try {
    if (!env.WORLD_CONFIG_JSON) throw new WorldConfigError('WORLD_CONFIG_JSON is required');
    const { startConfiguredWorld } = await import('../world/startup.ts');
    world = await startConfiguredWorld({ pool, admission, assets: new URL('./world/', import.meta.url),
      config: JSON.parse(env.WORLD_CONFIG_JSON), clientIp,
      originAllowed: (origin, req) => originAllowed(origin, origins, req.headers.host) });
  } catch (error) {
    worldStartupFailed = true;
    console.error(`world startup failed: ${describeWorldStartupFailure(error)}; legacy routes remain active`);
  }
}
const accounts = accountHandler(pool, origins, clientIp, google, admission);
const worldCharacters = world ? createCharacterHandler({ pool, characters: world.characters, codec: world.codec,
  origins, clientIp, policy: world.config.characters ?? {} }) : null;
const text = (res: ServerResponse, status: number, body: string) => { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body); };
async function healthy() {
  if (stopping || world?.ownership.closed.aborted || world?.host.stats().frozen) return false;
  try { await pool.query('SELECT 1'); return true; } catch { return false; }
}

const server = createServer((req, res) => {
  let path: string;
  // A request target such as '//' is no URL; throwing here would take the whole process down.
  try { path = new URL(req.url ?? '/', 'http://localhost').pathname; } catch { text(res, 400, 'Bad request'); return; }
  if (worldStartupFailed && ['/world', '/api/account/world-catalog', '/api/account/world-characters', '/api/account/world-ticket'].includes(path)) {
    text(res, 503, 'World unavailable'); return;
  }
  if (path === '/api/account/world-catalog' && world) {
    if (req.method !== 'GET') { text(res, 405, 'Expected GET'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(world.gameplayCatalog)); return;
  }
  if (path === '/api/account/world-characters' && worldCharacters) {
    if (stopping) { text(res, 503, 'Server restarting'); return; }
    void worldCharacters(req, res); return;
  }
  if (stopping && path === '/api/account/world-ticket') { text(res, 503, 'Server restarting'); return; }
  if (path === '/api/account/monitor') { void monitor(req, res); return; }
  if (path.startsWith('/api/account/')) { void accounts(req, res); return; }
  if (path === '/healthz') { void healthy().then(ok => text(res, ok ? 200 : 503, ok ? 'ok\n' : 'database unavailable\n')); return; }
  if (path === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, game: 'crabcraft-multiplayer' })); return; }
  if (path === '/multiplayer') { text(res, 426, 'Expected WebSocket'); return; }
  if (path === '/world' && world) { text(res, 426, 'Expected WebSocket'); return; }
  text(res, 404, 'Not found');
});
server.requestTimeout = 30000;
server.headersTimeout = 20000;

const relay = attachRooms(server, {
  allowOrigin: (origin, req) => originAllowed(origin, origins, req.headers.host),
  // A created room and its world checkpoint outlive its players for a day, as the Worker's rooms did.
  keepRooms: 24 * 60 * 60 * 1000,
  maxRooms: 512,
  maxMembers: 512,
  // Read with server-dist/reports.mjs on the VM.
  report: r => storeReport(pool, r),
});
const monitor = monitorHandler(pool, new Set((env.MONITOR_ACCOUNTS ?? '').split(',').map(s => s.trim()).filter(s => /^g[a-f0-9]{23}$/.test(s))), relay.monitorSnapshot,
  new Set((env.MONITOR_IPS ?? '').split(',').map(s => s.trim()).filter(s => isIP(s))), clientIp);
// Each upgrade has exactly one route owner; the legacy relay ignores /world.
server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
  const path = req.url?.split('?')[0];
  if (path === '/multiplayer') return;
  if (path === '/world' && world) { world.host.handleUpgrade(req, socket, head); return; }
  if (path === '/world' && worldStartupFailed) { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return; }
  socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
});

// Expired sessions and rate-limit windows are only ever read to be rejected; drop them hourly. Chat reports go after 90 days.
const cleanup = setInterval(() => {
  const now = Date.now();
  void Promise.all([pool.query('DELETE FROM sessions WHERE expires < $1', [now]), pool.query('DELETE FROM rate_limits WHERE until < $1', [now]),
    pool.query(`DELETE FROM chat_reports WHERE created < now() - interval '90 days'`)])
    .catch(e => console.error(`cleanup: ${e instanceof Error ? e.message : String(e)}`));
}, 60 * 60 * 1000);
cleanup.unref();

server.listen(port, host, () => {
  const address = server.address();
  console.log(`crabcraft server listening on ${typeof address === 'object' && address ? `${address.address}:${address.port}` : address}`);
});

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: shutting down`);
  setTimeout(() => { console.error('shutdown timed out'); process.exit(1); }, 10000).unref();
  clearInterval(cleanup);
  let durable = true;
  if (world) {
    world.host.stopAdmission();
    const result = await world.host.shutdown(7000);
    durable = result.durable;
    if (!durable) console.error(`world shutdown unresolved: ${result.unresolved}`);
    await world.ownership.release();
  }
  // Players hear `restarting` and reconnect after a short random delay instead of finding out from a dead socket.
  await relay.restart();
  const closed = new Promise(resolve => server.close(resolve));
  server.closeIdleConnections();
  await closed;
  await pool.end();
  process.exit(durable ? 0 : 1);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
