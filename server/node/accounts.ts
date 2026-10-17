import { createHash, pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { promisify } from 'node:util';
import type { Pool } from 'pg';
import { specOf } from '../protocol.ts';

// Same account contract as server/cloudflare/accounts.ts, stored in Postgres.
const pbkdf2Async = promisify(pbkdf2);
const random = () => randomBytes(32).toString('hex');
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
// The salt is the hex string itself, as in the Worker, so stored hashes stay interchangeable.
const passwordHash = async (password: string, salt: string) => (await pbkdf2Async(password, salt, 100000, 32, 'sha256')).toString('hex');
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const accountName = (v: unknown) => typeof v === 'string' && /^[a-zA-Z0-9_]{3,24}$/.test(v) ? v.toLowerCase() : null;

type Bundle = Record<string, string>;
export function bundleOf(value: unknown): Bundle | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value); if (entries.length > 18 || JSON.stringify(value).length > 48000) return null;
  for (const [k, v] of entries) {
    if (!(k === 'cc.spec' || k === 'cc.lighthouseSecret.v1' || k.startsWith('cc.journey.v1:')) || k.length > 180 || typeof v !== 'string' || v.length > 16000) return null;
    if (k === 'cc.lighthouseSecret.v1') { if (v !== 'found') return null; continue; }
    try { const data = JSON.parse(v); if (k === 'cc.spec' ? !specOf(data) : (!data || !Number.isSafeInteger(data.xp) || data.xp < 0)) return null; } catch { return null; }
  }
  return Object.fromEntries(entries);
}

type Body = Record<string, unknown>;
type Result = { status: number; body: { error?: string; ok?: boolean; username?: string; revision?: number; save?: Bundle; updated?: number }; token?: string; clear?: boolean };
type AccountRow = { revision: string; save: string; updated: string };
const DAY = 86400000;

/** Fixed-window counter shared by every process: allows `max` calls per window, and blocked calls do not extend it. */
export async function limit(db: Pool, key: string, max: number, seconds: number): Promise<boolean> {
  const r = await db.query(`INSERT INTO rate_limits AS r (id, count, until) VALUES ($1, 1, $2::bigint + $3::bigint)
    ON CONFLICT (id) DO UPDATE SET
      count = CASE WHEN r.until > $2::bigint THEN r.count + 1 ELSE 1 END,
      until = CASE WHEN r.until > $2::bigint THEN r.until ELSE $2::bigint + $3::bigint END
    WHERE r.until <= $2::bigint OR r.count < $4::integer
    RETURNING count`, [key, Date.now(), seconds * 1000, max]);
  return r.rowCount === 1;
}

const account = async (db: Pool, username: string) => {
  const row = (await db.query<AccountRow>('SELECT revision, save, updated FROM accounts WHERE username = $1', [username])).rows[0];
  return { revision: Number(row.revision), save: JSON.parse(row.save) as Bundle, updated: Number(row.updated) };
};

async function handle(db: Pool, action: string, username: string, token: string, body: Body): Promise<Result> {
  const now = Date.now();
  const fail = (status: number, error: string): Result => ({ status, body: { error } });
  if (action === 'signup' || action === 'login') {
    if (!await limit(db, 'login:' + username, 20, 900)) return fail(429, 'rate');
    if (typeof body.password !== 'string' || body.password.length < 10 || body.password.length > 128) return fail(400, 'password');
    const existing = (await db.query<{ salt: string; hash: string }>('SELECT salt, hash FROM accounts WHERE username = $1', [username])).rows[0];
    // Hash even for unknown names so a missing account takes as long as a wrong password.
    const salt = existing?.salt ?? random(), hash = await passwordHash(body.password, salt);
    if (action === 'signup') {
      if (existing) return fail(409, 'taken');
      const initial = bundleOf(body.save ?? {}); if (!initial) return fail(400, 'save');
      // Concurrent signups must never replace an account.
      const inserted = await db.query('INSERT INTO accounts (username, salt, hash, save, updated, created) VALUES ($1, $2, $3, $4, $5, $5) ON CONFLICT (username) DO NOTHING', [username, salt, hash, JSON.stringify(initial), now]);
      if (!inserted.rowCount) return fail(409, 'taken');
    } else if (!existing || !sameHash(hash, existing.hash)) return fail(401, 'credentials');
    const fresh = random();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT 1 FROM accounts WHERE username = $1 FOR UPDATE', [username]);
      await client.query('DELETE FROM sessions WHERE username = $1 AND expires < $2', [username, now]);
      // Bound storage to the ten most recent devices; signed-in sessions expire after seven days.
      await client.query('DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE username = $1 ORDER BY expires DESC OFFSET 9)', [username]);
      await client.query('INSERT INTO sessions (token_hash, username, expires) VALUES ($1, $2, $3)', [digest(fresh), username, now + 7 * DAY]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
    const row = await account(db, username);
    return { status: 200, token: fresh, body: { username, revision: row.revision, save: row.save, updated: row.updated } };
  }
  if (!/^[a-f0-9]{64}$/.test(token)) return fail(401, 'session');
  const key = digest(token), session = (await db.query<{ expires: string }>('SELECT expires FROM sessions WHERE token_hash = $1 AND username = $2', [key, username])).rows[0];
  if (!session || Number(session.expires) <= now) return fail(401, 'session');
  if (action === 'logout') { await db.query('DELETE FROM sessions WHERE token_hash = $1', [key]); return { status: 200, clear: true, body: { ok: true } }; }
  if (action === 'save') {
    if (!await limit(db, 'save:' + username, 60, 60)) return fail(429, 'rate');
    const save = bundleOf(body.save); if (!save || !Number.isSafeInteger(body.revision)) return fail(400, 'save');
    const r = await db.query<{ revision: string; updated: string }>('UPDATE accounts SET save = $1, revision = revision + 1, updated = $2 WHERE username = $3 AND revision = $4 RETURNING revision, updated', [JSON.stringify(save), now, username, body.revision]);
    if (!r.rowCount) return fail(409, 'conflict');
    return { status: 200, body: { username, revision: Number(r.rows[0].revision), updated: Number(r.rows[0].updated) } };
  } else if (action !== 'session') return fail(404, 'route');
  const row = await account(db, username);
  return { status: 200, body: { username, revision: row.revision, save: row.save, updated: row.updated } };
}

function boundedBody(req: IncomingMessage): Promise<Body> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0, done = false;
    const finish = (error: Error | null, value?: Body) => { if (done) return; done = true; if (error) reject(error); else resolve(value!); };
    if (Number(req.headers['content-length']) > 65536) { finish(new Error('large')); req.resume(); return; }
    req.on('data', (chunk: Buffer) => { if (done) return; size += chunk.length; if (size > 65536) finish(new Error('large')); else chunks.push(chunk); });
    req.on('error', e => finish(e));
    req.on('end', () => {
      if (!size) { finish(null, {}); return; }
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('body');
        finish(null, value);
      } catch (e) { finish(e as Error); }
    });
  });
}

export const localHost = (host: string | undefined) => {
  try { return ['127.0.0.1', 'localhost'].includes(new URL('http://' + host).hostname); } catch { return false; }
};
/** Allowed origins, plus any local dev origin when the request itself is local (as the Worker allowed). */
export const originAllowed = (origin: string, origins: readonly string[], host: string | undefined) =>
  origins.includes(origin) || (localHost(host) && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin));

export function accountHandler(db: Pool, origins: readonly string[], clientIp: (req: IncomingMessage) => string) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const headers: Record<string, string> = { 'Cache-Control': 'no-store, private', 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' };
    const respond = (status: number, body: Record<string, unknown>) => { if (!res.headersSent) { res.writeHead(status, headers); res.end(JSON.stringify(body)); } };
    const origin = req.headers.origin, local = localHost(req.headers.host);
    if (req.headers['x-crabcraft-account'] !== '1' || (origin && !originAllowed(origin, origins, req.headers.host))) return respond(403, { error: 'origin' });
    const action = new URL(req.url ?? '/', 'http://localhost').pathname.split('/').pop()!;
    if (!['signup', 'login', 'session', 'save', 'logout'].includes(action) || (action === 'session' ? req.method !== 'GET' : req.method !== 'POST')) return respond(405, { error: 'method' });
    let body: Body;
    try { body = req.method === 'POST' ? await boundedBody(req) : {}; }
    catch { headers.Connection = 'close'; return respond(400, { error: 'request' }); }
    const cookie = req.headers.cookie?.match(/(?:^|;\s*)cc_account=([a-z0-9_]{3,24})\.([a-f0-9]{64})(?:;|$)/);
    const credentials = action === 'signup' || action === 'login';
    const username = credentials ? accountName(body.username) : cookie?.[1];
    if (!username) return respond(credentials ? 400 : 401, { error: credentials ? 'username' : 'session' });
    try {
      if (credentials && !await limit(db, 'ip:' + digest(clientIp(req)), 100, 900)) return respond(429, { error: 'rate' });
      const result = await handle(db, action, username, cookie?.[2] ?? '', body);
      if (result.token || result.clear) headers['Set-Cookie'] = `cc_account=${result.clear ? '' : username + '.' + result.token}; Path=/api/account; HttpOnly; SameSite=Strict; ${local ? '' : 'Secure; '}Max-Age=${result.clear ? 0 : 604800}`;
      respond(result.status, result.body);
    } catch (e) {
      // Only the database can fail here; its messages never contain passwords or tokens.
      console.error(`account ${action}: ${e instanceof Error ? e.message : String(e)}`);
      respond(503, { error: 'unavailable' });
    }
  };
}
