import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { attachRooms } from '../rooms.ts';
import { accountHandler, GOOGLE_AUTH_URL, GOOGLE_TOKEN_URL, originAllowed } from './accounts.ts';
import { createPool, migrate } from './db.ts';

// Rooms and accounts for the browser client: what server/cloudflare/worker.ts served, on one VM behind Caddy.
// Env: PORT (8080), HOST (127.0.0.1), DATABASE_URL, ALLOWED_ORIGINS (comma separated, e.g. https://crab.seonn.dev,https://crab-dev.seonn.dev), TRUST_PROXY=1 behind Caddy,
// GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET for sign-in (GOOGLE_AUTH_URL and GOOGLE_TOKEN_URL override Google's endpoints in tests).
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

const accounts = accountHandler(pool, origins, clientIp, google);
const text = (res: ServerResponse, status: number, body: string) => { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body); };
async function healthy() {
  try { await pool.query('SELECT 1'); return true; } catch { return false; }
}

const server = createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (path.startsWith('/api/account/')) { void accounts(req, res); return; }
  if (path === '/healthz') { void healthy().then(ok => text(res, ok ? 200 : 503, ok ? 'ok\n' : 'database unavailable\n')); return; }
  if (path === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, game: 'crabcraft-multiplayer' })); return; }
  if (path === '/multiplayer') { text(res, 426, 'Expected WebSocket'); return; }
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
});
// attachRooms only answers /multiplayer upgrades; refuse the rest instead of leaving them open.
server.on('upgrade', (req: IncomingMessage, socket: Duplex) => {
  if (req.url?.split('?')[0] !== '/multiplayer') socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
});

// Expired sessions and rate-limit windows are only ever read to be rejected; drop them hourly.
const cleanup = setInterval(() => {
  const now = Date.now();
  void Promise.all([pool.query('DELETE FROM sessions WHERE expires < $1', [now]), pool.query('DELETE FROM rate_limits WHERE until < $1', [now])])
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
  relay.close();
  const closed = new Promise(resolve => server.close(resolve));
  server.closeIdleConnections();
  await closed;
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
