import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import type { MonitorSnapshot } from '../monitor.ts';
import { resolveAccountSession } from './accounts.ts';

/** Shares the existing /api/account cookie scope. Authorization is checked on every poll.
 * `places`: client addresses (MONITOR_IPS, e.g. a home network's public IP) whose screens, such as a TV
 * that cannot sign in, see the monitor without an account. Everyone else still signs in. */
export function monitorHandler(db: Pool, accounts: ReadonlySet<string>, snapshot: () => MonitorSnapshot,
  places: ReadonlySet<string> = new Set(), clientIp: (req: IncomingMessage) => string = req => req.socket.remoteAddress ?? '') {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'GET') return send(405, { error: 'method' });
    // Browsers cannot add this header across origins without a preflight. Do not enable CORS here.
    const origin = req.headers.origin;
    let sameOrigin = !origin;
    try { if (origin) sameOrigin = new URL(origin).host === req.headers.host; } catch { /* reject malformed origins */ }
    if (req.headers['x-crabcraft-account'] !== '1' || !sameOrigin || req.headers['sec-fetch-site'] === 'cross-site') return send(403, { error: 'origin' });
    if (places.has(clientIp(req))) return send(200, snapshot());
    if (!accounts.size) return send(503, { error: 'monitor_unconfigured' });
    try {
      const session = await resolveAccountSession(db, req);
      if (!session) return send(401, { error: 'signin' });
      if (!accounts.has(session.accountId)) return send(403, { error: 'monitor_forbidden' });
      send(200, snapshot());
    } catch {
      send(503, { error: 'unavailable' });
    }
  };
}
