// Real HTTP account handler + throwaway Postgres. Sessions are fixtures; Google flow remains in test:server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { startPostgres } from '../node/local-postgres.mjs';
import { migrate } from '../node/db.ts';
import { accountHandler, createWorldAdmission, resolveAccountBinding, resolveAccountSession } from '../node/accounts.ts';
import { WorldTicketRegistry, WorldAdmissionError } from './admission.ts';

const ORIGIN = 'https://crab.seonn.dev', OTHER = 'https://crab-dev.seonn.dev';
const hash = s => createHash('sha256').update(s).digest('hex');
const admissionError = code => e => e instanceof WorldAdmissionError && e.code === code;
let postgres, pool;
before(async () => {
  try { postgres = await startPostgres(); pool = new pg.Pool({ connectionString: postgres.url }); await migrate(pool); }
  catch (e) { await pool?.end(); postgres?.stop(); throw e; }
});
after(async () => { try { await pool?.end(); } finally { postgres?.stop(); } });
async function session(expiresAt = Date.now() + 60000) {
  const accountId = 'g' + randomBytes(12).toString('hex').slice(0, 23), token = randomBytes(32).toString('hex'), sessionKey = hash(token);
  await pool.query("INSERT INTO accounts(username,save,updated,created) VALUES($1,'{}',1,1)", [accountId]);
  await pool.query('INSERT INTO sessions(token_hash,username,expires) VALUES($1,$2,$3)', [sessionKey, accountId, expiresAt]);
  return { accountId, sessionKey, expiresAt, cookie: `cc_account=${accountId}.${token}`, token };
}
async function withHttp(fn, options = {}) {
  const admission = createWorldAdmission(pool, options), clientIp = 'fixture-' + randomBytes(8).toString('hex');
  const accounts = accountHandler(pool, [ORIGIN, OTHER], req => String(req.headers['x-forwarded-for'] ?? clientIp), null, admission);
  const server = createServer((req, res) => { void accounts(req, res); }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port;
  const http = (method, path, { cookie, body, headers = {} } = {}) => new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    const req = request({ hostname: '127.0.0.1', port, method, path, headers: {
      Host: 'crab.seonn.dev', Origin: ORIGIN, 'X-Crabcraft-Account': '1', ...(cookie ? { Cookie: cookie } : {}),
      ...(payload ? { 'Content-Length': Buffer.byteLength(payload), 'Content-Type': 'application/json' } : {}), ...headers,
    } }, res => { let text = ''; res.on('data', d => text += d); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: JSON.parse(text) })); });
    req.on('error', reject); req.end(payload);
  });
  const post = (cookie, options = {}) => http('POST', '/api/account/world-ticket', { cookie, body: {}, ...options });
  try { await fn({ admission, http, post }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('shared session resolver is read only, Google-account-bound and uses the unchanged scoped cookie', async () => {
  const a = await session(), b = await session();
  const before = (await pool.query('SELECT * FROM sessions WHERE token_hash=$1', [a.sessionKey])).rows[0];
  const binding = await resolveAccountSession(pool, { headers: { cookie: a.cookie } });
  assert.deepEqual(binding, { accountId: a.accountId, sessionKey: a.sessionKey, expiresAt: a.expiresAt });
  assert.deepEqual((await pool.query('SELECT * FROM sessions WHERE token_hash=$1', [a.sessionKey])).rows[0], before);
  for (const cookie of [undefined, 'cc_account=nope', `cc_account=${a.accountId}.${b.token}`]) assert.equal(await resolveAccountSession(pool, { headers: { cookie } }), null);
  assert.equal(await resolveAccountBinding(pool, { accountId: b.accountId, sessionKey: a.sessionKey }), null);
  assert.equal(await resolveAccountBinding(pool, { accountId: 'guest', sessionKey: a.sessionKey }), null);
});

test('HTTP ticket is opaque, one use, same-origin and does not change legacy session/save/logout', async () => {
  const a = await session();
  await withHttp(async ({ admission, http, post }) => {
    const issued = await post(a.cookie); assert.equal(issued.status, 200); assert.deepEqual(Object.keys(issued.json).sort(), ['expiresAt', 'ticket']);
    assert.match(issued.json.ticket, /^[A-Za-z0-9_-]{43}$/); assert(issued.json.expiresAt <= a.expiresAt && issued.json.expiresAt <= Date.now() + 30000);
    assert.match(issued.headers['cache-control'], /no-store/); assert.equal(issued.headers['set-cookie'], undefined);
    assert(!issued.text.includes(a.accountId) && !issued.text.includes(a.sessionKey) && !issued.text.includes(a.token));
    const binding = await admission.consume(issued.json.ticket, ORIGIN); assert.equal(binding.accountId, a.accountId); assert.equal(binding.sessionKey, a.sessionKey);
    await assert.rejects(admission.consume(issued.json.ticket, ORIGIN), admissionError('ticket'));
    const save = { 'cc.lighthouseSecret.v1': 'found' };
    assert.equal((await http('POST', '/api/account/save', { cookie: a.cookie, body: { revision: 0, save } })).status, 200);
    const current = await http('GET', '/api/account/session', { cookie: a.cookie }); assert.deepEqual(current.json.save, save); assert.equal(current.json.revision, 1);
    const unused = await post(a.cookie), logout = await http('POST', '/api/account/logout', { cookie: a.cookie, body: {} });
    assert.equal(logout.status, 200); assert.match(logout.headers['set-cookie'][0], /^cc_account=; Path=\/api\/account; HttpOnly; SameSite=Strict; Secure; Max-Age=0$/);
    await assert.rejects(admission.consume(unused.json.ticket, ORIGIN), admissionError('session'));
    assert.equal(await admission.revalidate(binding), null); assert.equal((await post(a.cookie)).status, 401);
    assert.deepEqual((await http('GET', '/api/account/session')).json, { signedIn: false });
  });
});

test('HTTP ticket requires exact same-origin, CSRF header, POST, empty bounded object and valid session', async () => {
  const a = await session();
  await withHttp(async ({ http, post }) => {
    for (const headers of [{ Origin: '' }, { Origin: 'null' }, { Origin: 'https://evil.example' }, { Origin: OTHER }, { Origin: ORIGIN, Host: 'evil.example' }, { 'X-Crabcraft-Account': '' }]) assert.equal((await post(a.cookie, { headers })).status, 403);
    assert.equal((await http('GET', '/api/account/world-ticket', { cookie: a.cookie })).status, 405);
    for (const body of [{ accountId: a.accountId }, { ticket: 'client-supplied' }, [], 'broken', ' '.repeat(257)]) assert.equal((await post(a.cookie, { body })).status, 400);
    assert.equal((await post()).status, 401); assert.equal((await post('cc_account=broken')).status, 401);
    const b = await session(); assert.equal((await post(`cc_account=${a.accountId}.${b.token}`)).status, 401);
  });
});

test('consume rejects missing/different origins and ticket replay, including after an origin rejection', async () => {
  const a = await session();
  await withHttp(async ({ admission, post }) => {
    for (const origin of [undefined, '', 'null', OTHER, 'https://evil.example']) {
      const issued = await post(a.cookie); assert.equal(issued.status, 200);
      await assert.rejects(admission.consume(issued.json.ticket, origin), admissionError('origin'));
      await assert.rejects(admission.consume(issued.json.ticket, ORIGIN), admissionError('ticket'));
    }
    for (const ticket of [undefined, '', 'x'.repeat(42), 'x'.repeat(44), 'x'.repeat(100000), 'x'.repeat(43)]) await assert.rejects(admission.consume(ticket, ORIGIN), admissionError('ticket'));
  });
});

test('racing consumes authorize exactly one caller and revalidate session with real Postgres', async () => {
  const a = await session();
  await withHttp(async ({ admission, post }) => {
    const issued = await post(a.cookie);
    const results = await Promise.allSettled([admission.consume(issued.json.ticket, ORIGIN), admission.consume(issued.json.ticket, ORIGIN)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.code, 'ticket');
  });
});

test('ticket TTL and original session expiry are enforced, and expired tickets free registry capacity', async () => {
  const a = await session(); let now = Date.now();
  await withHttp(async ({ admission, post }) => {
    const issued = await post(a.cookie); assert.equal(issued.status, 200); assert.equal((await post(a.cookie)).status, 503);
    now += 31; await assert.rejects(admission.consume(issued.json.ticket, ORIGIN), admissionError('ticket'));
    assert.equal((await post(a.cookie)).status, 200);
  }, { ttlMs: 30, maxTickets: 1, now: () => now });
  await withHttp(async ({ admission, post }) => {
    const issued = await post(a.cookie); await pool.query('UPDATE sessions SET expires=$1 WHERE token_hash=$2', [Date.now() - 1, a.sessionKey]);
    await assert.rejects(admission.consume(issued.json.ticket, ORIGIN), admissionError('session'));
    assert.equal((await post(a.cookie)).status, 401);
    const rebound = await session(), other = await session(), beforeRebind = await post(rebound.cookie);
    await pool.query('UPDATE sessions SET username=$1 WHERE token_hash=$2', [other.accountId, rebound.sessionKey]);
    await assert.rejects(admission.consume(beforeRebind.json.ticket, ORIGIN), admissionError('session'));
  });
});

test('per-account/global pending caps reject without evicting outstanding tickets', async () => {
  const a = await session(), b = await session();
  await withHttp(async ({ admission, post }) => {
    const first = await post(a.cookie); assert.equal(first.status, 200); assert.equal((await post(a.cookie)).status, 503);
    const second = await post(b.cookie); assert.equal(second.status, 200); const c = await session(); assert.equal((await post(c.cookie)).status, 503);
    assert.equal((await admission.consume(first.json.ticket, ORIGIN)).accountId, a.accountId);
    assert.equal((await admission.consume(second.json.ticket, ORIGIN)).accountId, b.accountId);
    assert.equal((await post(c.cookie)).status, 200);
  }, { maxTickets: 2, maxPerAccount: 1 });
});

test('DB fixed-window limits bound authenticated account issuance and unauthenticated IP attempts', async () => {
  const a = await session();
  await withHttp(async ({ admission, post }) => {
    for (let i = 0; i < 20; i++) { const issued = await post(a.cookie); assert.equal(issued.status, 200); await admission.consume(issued.json.ticket, ORIGIN); }
    assert.equal((await post(a.cookie)).status, 429);
    for (let i = 0; i < 100; i++) assert.equal((await post(undefined, { headers: { 'X-Forwarded-For': 'fixture-denied-ip' } })).status, 401);
    assert.equal((await post(undefined, { headers: { 'X-Forwarded-For': 'fixture-denied-ip' } })).status, 429);
  });
});

test('DB lookup failure consumes ticket and never permits retry authorization', async () => {
  const a = await session(); let failLookup = true;
  const admission = new WorldTicketRegistry(async binding => { if (failLookup) throw new Error('injected DB failure'); return resolveAccountBinding(pool, binding); });
  const issued = admission.issue(a, ORIGIN); await assert.rejects(admission.consume(issued.ticket, ORIGIN), /injected DB failure/);
  failLookup = false; await assert.rejects(admission.consume(issued.ticket, ORIGIN), admissionError('ticket'));
  const valid = admission.issue(a, ORIGIN); assert.equal((await admission.consume(valid.ticket, ORIGIN)).accountId, a.accountId);
  const minimal = new WorldTicketRegistry(async binding => {
    assert.deepEqual(Object.keys(binding).sort(), ['accountId', 'expiresAt', 'sessionKey']);
    return { ...await resolveAccountBinding(pool, binding), cookie: a.cookie, token: a.token };
  });
  const extraFields = minimal.issue(a, ORIGIN), resolved = await minimal.consume(extraFields.ticket, ORIGIN);
  assert.deepEqual(Object.keys(resolved).sort(), ['accountId', 'expiresAt', 'sessionKey']);
});

test('registry prevents resolver account/session substitution and expiration during async consume', async () => {
  const a = await session(), b = await session(); let now = Date.now();
  const substitute = new WorldTicketRegistry(async () => b); const ticket = substitute.issue(a, ORIGIN);
  await assert.rejects(substitute.consume(ticket.ticket, ORIGIN), admissionError('session'));
  const slow = new WorldTicketRegistry(async binding => { now += 31; return resolveAccountBinding(pool, binding); }, { ttlMs: 30, now: () => now });
  const expiredInFlight = slow.issue(a, ORIGIN); await assert.rejects(slow.consume(expiredInFlight.ticket, ORIGIN), admissionError('session'));
});
