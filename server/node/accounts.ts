import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import { specOf } from '../protocol.ts';
import { WorldAdmissionError, WorldTicketRegistry, type SessionBinding, type WorldAdmissionOptions } from '../world/admission.ts';

// Session, save and logout keep the contract of server/cloudflare/accounts.ts; sign-in is Google only.
const random = () => randomBytes(32).toString('hex');
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const b64url = (b: Buffer) => b.toString('base64url');

export type GoogleConfig = { clientId: string; clientSecret: string; authUrl: string; tokenUrl: string };
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** The account key for a Google subject. Nothing else from Google (sub, email, name, picture) is stored. */
export const googleAccount = (sub: string) => 'g' + digest('google:' + sub).slice(0, 23);

type Bundle = Record<string, string>;
/** The Royal Vault: `{"coins": n}`, coins shared by the account's characters. Optional, so pages from before it still save. */
export const VAULT_KEY = 'cc.vault.v1';
/** A vault value: a JSON object whose `coins` is a safe integer of at least 0, in at most 200 characters. */
export const vaultOf = (v: string): boolean => {
  if (v.length > 200) return false;
  try { const data = JSON.parse(v); return !!data && typeof data === 'object' && !Array.isArray(data) && Number.isSafeInteger(data.coins) && data.coins >= 0; } catch { return false; }
};
export function bundleOf(value: unknown): Bundle | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value); if (entries.length > 18 || JSON.stringify(value).length > 48000) return null;
  for (const [k, v] of entries) {
    if (!(k === 'cc.spec' || k === 'cc.lighthouseSecret.v1' || k === VAULT_KEY || k.startsWith('cc.journey.v1:')) || k.length > 180 || typeof v !== 'string' || v.length > 16000) return null;
    if (k === 'cc.lighthouseSecret.v1') { if (v !== 'found') return null; continue; }
    if (k === VAULT_KEY) { if (!vaultOf(v)) return null; continue; }
    try { const data = JSON.parse(v); if (k === 'cc.spec' ? !specOf(data) : (!data || !Number.isSafeInteger(data.xp) || data.xp < 0)) return null; } catch { return null; }
  }
  return Object.fromEntries(entries);
}

type Body = Record<string, unknown>;
type Result = { status: number; body: { error?: string; ok?: boolean; username?: string; revision?: number; save?: Bundle; updated?: number }; clear?: boolean };
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

/** Creates the account on first sign-in and returns a new session token for it. */
async function signIn(db: Pool, username: string): Promise<string> {
  const now = Date.now(), fresh = random();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO accounts (username, save, updated, created) VALUES ($1, '{}', $2, $2) ON CONFLICT (username) DO NOTHING`, [username, now]);
    await client.query('SELECT 1 FROM accounts WHERE username = $1 FOR UPDATE', [username]);
    await client.query('DELETE FROM sessions WHERE username = $1 AND expires < $2', [username, now]);
    // Bound storage to the ten most recent devices; signed-in sessions expire after seven days.
    await client.query('DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE username = $1 ORDER BY expires DESC OFFSET 9)', [username]);
    await client.query('INSERT INTO sessions (token_hash, username, expires) VALUES ($1, $2, $3)', [digest(fresh), username, now + 7 * DAY]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  return fresh;
}

const ACCOUNT_COOKIE = /(?:^|;\s*)cc_account=([a-z0-9_]{3,24})\.([a-f0-9]{64})(?:;|$)/;
/** Shared read-only DB check; accepts only a server-internal hash binding, never client account assertions. */
export async function resolveAccountBinding(db: Pool, binding: Pick<SessionBinding, 'accountId' | 'sessionKey'>): Promise<SessionBinding | null> {
  if (!/^g[a-f0-9]{23}$/.test(binding.accountId) || !/^[a-f0-9]{64}$/.test(binding.sessionKey)) return null;
  const row = (await db.query<{ expires: string }>('SELECT expires FROM sessions WHERE token_hash=$1 AND username=$2', [binding.sessionKey, binding.accountId])).rows[0];
  const expiresAt = Number(row?.expires);
  return Number.isSafeInteger(expiresAt) && expiresAt > Date.now() ? { accountId: binding.accountId, sessionKey: binding.sessionKey, expiresAt } : null;
}
/** Reads the unchanged scoped account cookie and resolves its current DB session. Does not write or refresh it. */
export async function resolveAccountSession(db: Pool, req: Pick<IncomingMessage, 'headers'>): Promise<SessionBinding | null> {
  const cookie = req.headers.cookie?.match(ACCOUNT_COOKIE);
  return cookie ? resolveAccountBinding(db, { accountId: cookie[1], sessionKey: digest(cookie[2]) }) : null;
}
export const createWorldAdmission = (db: Pool, options: WorldAdmissionOptions = {}) =>
  new WorldTicketRegistry(binding => resolveAccountBinding(db, binding), options);

async function handle(db: Pool, action: string, session: SessionBinding, body: Body): Promise<Result> {
  const now = Date.now(), username = session.accountId;
  const fail = (status: number, error: string): Result => ({ status, body: { error } });
  if (action === 'logout') { await db.query('DELETE FROM sessions WHERE token_hash = $1', [session.sessionKey]); return { status: 200, clear: true, body: { ok: true } }; }
  if (action === 'save') {
    if (!await limit(db, 'save:' + username, 60, 60)) return fail(429, 'rate');
    const save = bundleOf(body.save); if (!save || !Number.isSafeInteger(body.revision)) return fail(400, 'save');
    // A page from before the vault leaves it out: the stored one stays. Read at the revision the write below must
    // still find, so a vault changed in between turns this save into a conflict instead of being dropped.
    if (!(VAULT_KEY in save)) {
      const stored = (await db.query<{ save: string }>('SELECT save FROM accounts WHERE username = $1 AND revision = $2', [username, body.revision])).rows[0];
      const vault = stored ? (JSON.parse(stored.save) as Bundle)[VAULT_KEY] : undefined;
      if (typeof vault === 'string') save[VAULT_KEY] = vault;
    }
    const r = await db.query<{ revision: string; updated: string }>('UPDATE accounts SET save = $1, revision = revision + 1, updated = $2 WHERE username = $3 AND revision = $4 RETURNING revision, updated', [JSON.stringify(save), now, username, body.revision]);
    if (!r.rowCount) return fail(409, 'conflict');
    return { status: 200, body: { username, revision: Number(r.rows[0].revision), updated: Number(r.rows[0].updated) } };
  }
  const row = await account(db, username);
  return { status: 200, body: { username, revision: row.revision, save: row.save, updated: row.updated } };
}

function boundedBody(req: IncomingMessage, maxBytes = 65536): Promise<Body> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0, done = false;
    const finish = (error: Error | null, value?: Body) => { if (done) return; done = true; if (error) reject(error); else resolve(value!); };
    if (Number(req.headers['content-length']) > maxBytes) { finish(new Error('large')); req.resume(); return; }
    req.on('data', (chunk: Buffer) => { if (done) return; size += chunk.length; if (size > maxBytes) finish(new Error('large')); else chunks.push(chunk); });
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
/** The origin this request was addressed to, if it is one we serve; Google redirects back to it. */
const hostOrigin = (host: string | undefined, origins: readonly string[]) => {
  if (!host) return null;
  const origin = (localHost(host) ? 'http://' : 'https://') + host.toLowerCase();
  return originAllowed(origin, origins, host) ? origin : null;
};
/** Same-origin path to land on after sign-in: one leading slash, no scheme, backslash, whitespace or control characters. */
export const returnPath = (value: unknown) =>
  typeof value === 'string' && value.length <= 512 && /^\/(?![/\\])[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/.test(value) ? value : '/';

/** Reads the claims of an ID token that came straight from Google's token endpoint. */
function idTokenSub(idToken: unknown, clientId: string): string {
  // OIDC Core 3.1.3.7: a token received directly from the token endpoint over TLS may skip the JWS signature check.
  const parts = typeof idToken === 'string' ? idToken.split('.') : [];
  if (parts.length !== 3) throw new Error('id-token');
  let claims: Record<string, unknown>;
  try { claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { throw new Error('id-token'); }
  if (!claims || typeof claims !== 'object') throw new Error('id-token');
  if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') throw new Error('iss');
  const aud = claims.aud;
  if (!(aud === clientId || (Array.isArray(aud) && aud.includes(clientId) && claims.azp === clientId))) throw new Error('aud');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) throw new Error('exp');
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) throw new Error('sub');
  return claims.sub;
}

async function exchange(google: GoogleConfig, code: string, redirectUri: string, verifier: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(google.tokenUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, signal: AbortSignal.timeout(10000),
      body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: google.clientId, client_secret: google.clientSecret, redirect_uri: redirectUri, code_verifier: verifier }),
    });
  } catch { throw new Error('token-network'); }
  if (!res.ok) { await res.body?.cancel(); throw new Error('token-' + res.status); }
  let data: { id_token?: unknown };
  try { data = await res.json() as { id_token?: unknown }; } catch { throw new Error('token-body'); }
  return idTokenSub(data?.id_token, google.clientId);
}

const OAUTH_COOKIE = /(?:^|;\s*)cc_oauth=([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{0,700})(?:;|$)/;
const sessionCookie = (value: string, local: boolean, maxAge: number) => `cc_account=${value}; Path=/api/account; HttpOnly; SameSite=Strict; ${local ? '' : 'Secure; '}Max-Age=${maxAge}`;
// Lax, unlike the session cookie: Google's redirect back to the callback is a cross-site navigation.
const oauthCookie = (value: string, local: boolean, maxAge: number) => `cc_oauth=${value}; Path=/api/account/google; HttpOnly; SameSite=Lax; ${local ? '' : 'Secure; '}Max-Age=${maxAge}`;

/** GET /api/account/google/start and /callback: the authorization code flow with PKCE, as full-page redirects. */
function googleHandler(db: Pool, origins: readonly string[], clientIp: (req: IncomingMessage) => string, google: GoogleConfig | null) {
  return async (req: IncomingMessage, res: ServerResponse, action: string) => {
    const headers: Record<string, string | string[]> = { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
    const json = (status: number, body: Record<string, unknown>) => { if (!res.headersSent) { res.writeHead(status, { ...headers, 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); } };
    const redirect = (location: string) => { if (!res.headersSent) { res.writeHead(302, { ...headers, Location: location }); res.end(); } };
    if (req.method !== 'GET') return json(405, { error: 'method' });
    const url = new URL(req.url ?? '/', 'http://localhost'), origin = hostOrigin(req.headers.host, origins), local = localHost(req.headers.host);
    if (!origin) return json(403, { error: 'origin' });
    const redirectUri = origin + '/api/account/google/callback';
    if (action === 'start') {
      if (!google) return json(503, { error: 'google' });
      try { if (!await limit(db, 'ip:' + digest(clientIp(req)), 100, 900)) return json(429, { error: 'rate' }); }
      catch (e) { console.error(`account google start: database (${(e as { code?: string }).code ?? 'error'})`); return json(503, { error: 'unavailable' }); }
      const state = b64url(randomBytes(32)), verifier = b64url(randomBytes(32));
      headers['Set-Cookie'] = oauthCookie(`${state}.${verifier}.${b64url(Buffer.from(returnPath(url.searchParams.get('return'))))}`, local, 600);
      const target = new URL(google.authUrl);
      for (const [k, v] of Object.entries({ client_id: google.clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid', state, code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', prompt: 'select_account' })) target.searchParams.set(k, v);
      return redirect(target.href);
    }
    // callback: whatever happens, the one-time state cookie goes.
    const cookie = req.headers.cookie?.match(OAUTH_COOKIE);
    const back = returnPath(cookie ? Buffer.from(cookie[3], 'base64url').toString('utf8') : '/');
    headers['Set-Cookie'] = [oauthCookie('', local, 0)];
    const fail = (why: string) => { console.error(`account google callback: ${why}`); redirect(back + (back.includes('?') ? '&' : '?') + 'account=error'); };
    if (!google) return fail('config');
    const state = url.searchParams.get('state') ?? '', code = url.searchParams.get('code') ?? '';
    if (!cookie) return fail('cookie');
    // The shape check first: timingSafeEqual throws on buffers of different byte length.
    if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !timingSafeEqual(Buffer.from(state), Buffer.from(cookie[1]))) return fail('state');
    if (url.searchParams.has('error')) return fail('denied');
    if (!code || code.length > 2048) return fail('code');
    try { if (!await limit(db, 'ip:' + digest(clientIp(req)), 100, 900)) return fail('rate'); }
    catch (e) { return fail(`database (${(e as { code?: string }).code ?? 'error'})`); }
    let username: string;
    try { username = googleAccount(await exchange(google, code, redirectUri, cookie[2])); }
    catch (e) { return fail(e instanceof Error && /^[a-z0-9-]+$/.test(e.message) ? e.message : 'token'); }
    let token: string;
    try { token = await signIn(db, username); }
    catch (e) { return fail(`database (${(e as { code?: string }).code ?? 'error'})`); }
    headers['Set-Cookie'].push(sessionCookie(username + '.' + token, local, 604800));
    redirect(back);
  };
}

export function accountHandler(db: Pool, origins: readonly string[], clientIp: (req: IncomingMessage) => string, google: GoogleConfig | null, admission: WorldTicketRegistry = createWorldAdmission(db)) {
  const googleRoute = googleHandler(db, origins, clientIp, google);
  return async (req: IncomingMessage, res: ServerResponse) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/api/account/google/start' || path === '/api/account/google/callback') return googleRoute(req, res, path.slice(20));
    const headers: Record<string, string> = { 'Cache-Control': 'no-store, private', 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' };
    const respond = (status: number, body: Record<string, unknown>) => { if (!res.headersSent) { res.writeHead(status, headers); res.end(JSON.stringify(body)); } };
    const origin = req.headers.origin, local = localHost(req.headers.host);
    if (req.headers['x-crabcraft-account'] !== '1' || (origin && !originAllowed(origin, origins, req.headers.host))) return respond(403, { error: 'origin' });
    const action = path.split('/').pop()!;
    if (!['session', 'save', 'logout', 'world-ticket'].includes(action) || path !== '/api/account/' + action) return respond(404, { error: 'route' });
    if (action === 'world-ticket' && (!origin || origin !== hostOrigin(req.headers.host, origins))) return respond(403, { error: 'origin' });
    if (action === 'session' ? req.method !== 'GET' : req.method !== 'POST') return respond(405, { error: 'method' });
    let body: Body;
    try { body = req.method === 'POST' ? await boundedBody(req, action === 'world-ticket' ? 256 : 65536) : {}; }
    catch { headers.Connection = 'close'; return respond(400, { error: 'request' }); }
    // A guest has no session cookie: that is an answer, not an error the browser should log. A cookie that is there but bad stays 401.
    if (action === 'session' && !/(?:^|;\s*)cc_account=/.test(req.headers.cookie ?? '')) return respond(200, { signedIn: false });
    try {
      if (action === 'world-ticket' && !await limit(db, 'world-ticket:ip:' + digest(clientIp(req)), 100, 900)) return respond(429, { error: 'rate' });
      const session = await resolveAccountSession(db, req);
      if (!session) return respond(401, { error: 'session' });
      if (action === 'world-ticket') {
        if (Object.keys(body).length) return respond(400, { error: 'request' });
        if (!await limit(db, 'world-ticket:account:' + session.accountId, 20, 60)) return respond(429, { error: 'rate' });
        return respond(200, admission.issue(session, origin!));
      }
      const result = await handle(db, action, session, body);
      if (result.clear) headers['Set-Cookie'] = sessionCookie('', local, 0);
      respond(result.status, result.body);
    } catch (e) {
      if (e instanceof WorldAdmissionError) return respond(e.code === 'capacity' ? 503 : 401, { error: e.code });
      // Do not log request bodies, cookies or tickets, including on DB failure.
      const code = (e as { code?: string }).code;
      console.error(`account ${action}: database (${code && /^[A-Z0-9]{5}$/.test(code) ? code : 'error'})`);
      respond(503, { error: 'unavailable' });
    }
  };
}
