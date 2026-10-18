import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import { resolveAccountSession } from './accounts.ts';

type Denied = 'signin' | 'monitor_forbidden' | 'monitor_unconfigured' | 'unavailable';
const STATUS: Record<Denied, number> = { signin: 401, monitor_forbidden: 403, monitor_unconfigured: 503, unavailable: 503 };

/** The one monitor rule, for snapshots, observe tickets and observer sockets.
 * `places`: client addresses (MONITOR_IPS, e.g. a home network's public IP) whose screens, such as a TV
 * that cannot sign in, see the monitor without an account. Everyone else needs a session of an account in `accounts`. */
export function monitorAccess(db: Pool, accounts: ReadonlySet<string>, places: ReadonlySet<string> = new Set(),
  clientIp: (req: IncomingMessage) => string = req => req.socket.remoteAddress ?? '') {
  return async (req: IncomingMessage): Promise<'ok' | Denied> => {
    if (places.has(clientIp(req))) return 'ok';
    if (!accounts.size) return 'monitor_unconfigured';
    try {
      const session = await resolveAccountSession(db, req);
      if (!session) return 'signin';
      return accounts.has(session.accountId) ? 'ok' : 'monitor_forbidden';
    } catch {
      return 'unavailable';
    }
  };
}

/** Shares the existing /api/account cookie scope. Authorization is checked on every poll.
 * `body` is what an authorized request gets: the snapshot, or an observe ticket. */
export function monitorHandler(db: Pool, accounts: ReadonlySet<string>, body: () => unknown,
  places: ReadonlySet<string> = new Set(), clientIp: (req: IncomingMessage) => string = req => req.socket.remoteAddress ?? '') {
  const access = monitorAccess(db, accounts, places, clientIp);
  return async (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, value: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(value));
    };
    if (req.method !== 'GET') return send(405, { error: 'method' });
    // Browsers cannot add this header across origins without a preflight. Do not enable CORS here.
    const origin = req.headers.origin;
    let sameOrigin = !origin;
    try { if (origin) sameOrigin = new URL(origin).host === req.headers.host; } catch { /* reject malformed origins */ }
    if (req.headers['x-crabcraft-account'] !== '1' || !sameOrigin || req.headers['sec-fetch-site'] === 'cross-site') return send(403, { error: 'origin' });
    const result = await access(req);
    if (result === 'ok') send(200, body());
    else send(STATUS[result], { error: result });
  };
}

/** Short-lived proof that a page passed the monitor rule, for its observer socket on /multiplayer: the account
 * cookie is scoped to /api/account and never reaches that socket. Signed with a per-process key, so nothing is stored;
 * a restart only makes the spectator fetch a new one. */
export function observeTickets(ttl = 120000, secret = randomBytes(32), now = Date.now) {
  const sign = (expires: string) => createHmac('sha256', secret).update(expires).digest('base64url');
  return {
    issue() { const expires = String(now() + ttl); return { ticket: `${expires}.${sign(expires)}`, expires: Number(expires) }; },
    valid(ticket: unknown) {
      if (typeof ticket !== 'string' || ticket.length > 128) return false;
      const [expires, mac, extra] = ticket.split('.');
      if (extra !== undefined || !/^\d{13}$/.test(expires ?? '') || !mac || Number(expires) < now()) return false;
      const want = Buffer.from(sign(expires!)), got = Buffer.from(mac);
      return got.length === want.length && timingSafeEqual(got, want);
    },
  };
}
