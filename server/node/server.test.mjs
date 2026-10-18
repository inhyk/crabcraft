// pnpm test:server — runs server-dist/main.mjs against a throwaway Postgres cluster on a free port and a fake Google.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { once } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import WebSocket from 'ws';
import { fakeGoogle } from './fake-google.mjs';
import { freePort, startPostgres } from './local-postgres.mjs';
import { Link } from '../../src/multiplayer/link.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const ORIGIN = 'https://crab.seonn.dev', OTHER_ORIGIN = 'https://crab-dev.seonn.dev';
const CLIENT_ID = 'qa-client.apps.googleusercontent.com', CLIENT_SECRET = 'GOCSPX-' + randomBytes(18).toString('base64url');

let postgres, db, server, base, port, google, DATABASE_URL, output = '';
const serverEnv = () => ({ PATH: process.env.PATH, PORT: String(port), HOST: '127.0.0.1', DATABASE_URL, ALLOWED_ORIGINS: `${ORIGIN}, ${OTHER_ORIGIN}`, TRUST_PROXY: '1',
  GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: CLIENT_SECRET, GOOGLE_AUTH_URL: google.authUrl, GOOGLE_TOKEN_URL: google.tokenUrl });
async function startServer() {
  server = spawn(process.execPath, [join(root, 'server-dist/main.mjs')], { env: serverEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  const started = output.length;
  server.stdout.on('data', d => { output += d; });
  server.stderr.on('data', d => { output += d; });
  const until = Date.now() + 20000;
  while (!/listening on/.test(output.slice(started))) {
    if (server.exitCode !== null || Date.now() > until) throw new Error('server did not start:\n' + output);
    await new Promise(r => setTimeout(r, 50));
  }
}
before(async () => {
  postgres = await startPostgres();
  DATABASE_URL = postgres.url;
  google = await fakeGoogle({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
  db = new pg.Pool({ connectionString: DATABASE_URL });
  // A database from before Google sign-in: 001 applied, with a password account and its session.
  await db.query(readFileSync(join(root, 'server/node/migrations/001_accounts.sql'), 'utf8'));
  await db.query(`CREATE TABLE schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()); INSERT INTO schema_migrations (version) VALUES ('001_accounts')`);
  await db.query(`INSERT INTO accounts (username, salt, hash, save, updated, created) VALUES ('qa_password', repeat('a', 64), repeat('b', 64), '{}', 1, 1)`);
  await db.query(`INSERT INTO sessions (token_hash, username, expires) VALUES (repeat('c', 64), 'qa_password', 9999999999999); INSERT INTO rate_limits (id, count, until) VALUES ('login:qa_password', 1, 9999999999999)`);
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  await startServer();
});

after(async () => {
  if (server && server.exitCode === null) { server.kill('SIGKILL'); await once(server, 'exit'); }
  await db?.end().catch(() => {});
  await google?.close();
  postgres?.stop();
});

/** Raw HTTP so tests can set Host and read every Set-Cookie header. */
function http(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const req = request(base + path, { method, headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', c => { text += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ } resolve({ status: res.statusCode, headers: res.headers, text, json }); });
    });
    req.on('error', reject);
    req.end(payload);
  });
}
const accountHeaders = (extra = {}) => ({ 'X-Crabcraft-Account': '1', Origin: ORIGIN, ...extra });
const api = (action, body, { cookie, ip, ...extra } = {}) => http(body === undefined ? 'GET' : 'POST', '/api/account/' + action, {
  headers: accountHeaders({ ...(cookie ? { Cookie: cookie } : {}), ...(ip ? { 'X-Forwarded-For': `203.0.113.250, ${ip}` } : {}), ...extra }), body,
});
const cookieOf = res => (res.headers['set-cookie']?.[0] ?? '').split(';')[0];
let ipSeq = 1;
const freshIp = () => `198.51.100.${ipSeq++}`;

const spec = { race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'Test crab' };
const state = { x: 3, y: 0, z: 5, yaw: 1, hp: 80, maxHp: 100, alive: true };
const world = { weather: { mood: 1, beacon: true, clock: 123 }, entities: [{ id: 'e0', ...state, level: 1, hidden: false, invulnerable: false, targetable: true, stun: 0, slow: 0, slowPct: 0, rust: 0, rustFor: 0, enemyState: 'idle', xp: 20 }],
  bosses: [{ id: 'b3', state: 'dormant', phase: 1, enraged: false, mech: null }, { id: 'b10', state: 'dormant', phase: 1, enraged: false, mech: null }, { id: 'b20', state: 'dormant', phase: 1, enraged: false, mech: null }], rust: false, abyss: false, chapter: 1, firstEnding: false, trueCleared: false };

const sockets = [];
async function client(mode, room = '', origin = ORIGIN, extra = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/multiplayer?mode=${mode}${room ? '&room=' + room : ''}`, { origin });
  const queue = [];
  ws.on('message', raw => queue.push(JSON.parse(raw.toString())));
  await once(ws, 'open');
  sockets.push(ws);
  const c = { ws, queue, send: m => ws.send(JSON.stringify(m)), async next(type) {
    const until = Date.now() + 3000;
    while (Date.now() < until) {
      const i = queue.findIndex(m => m.type === type);
      if (i >= 0) return queue.splice(i, 1)[0];
      await new Promise(r => setTimeout(r, 10));
    }
    throw new Error(`Timed out waiting for ${type}: ${JSON.stringify(queue)}`);
  } };
  c.send({ type: mode, room, spec, combatVersion: 1, ...extra });
  return c;
}
after(() => { for (const ws of sockets) ws.terminate(); });

test('healthz reports the database; other paths answer like the Worker', async () => {
  assert.equal((await http('GET', '/healthz')).status, 200);
  assert.deepEqual((await http('GET', '/health')).json, { ok: true, game: 'crabcraft-multiplayer' });
  assert.equal((await http('GET', '/multiplayer')).status, 426);
  assert.equal((await http('GET', '/nope')).status, 404);
  // A request target that is no URL is refused instead of taking the process down.
  assert.equal((await http('GET', '//')).status, 400);
  assert.equal((await http('GET', '/healthz')).status, 200);
  const { rows } = await db.query('SELECT version FROM schema_migrations ORDER BY version');
  assert.deepEqual(rows.map(r => r.version), ['001_accounts', '002_google_only', '003_chat_reports', '004_world_characters']);
  // 002 removed the password account, its session and its login counter.
  const counts = await db.query(`SELECT (SELECT count(*) FROM accounts)::int AS a, (SELECT count(*) FROM sessions)::int AS s, (SELECT count(*) FROM rate_limits WHERE id LIKE 'login:%')::int AS r`);
  assert.deepEqual(counts.rows[0], { a: 0, s: 0, r: 0 });
  await assert.rejects(db.query(`INSERT INTO accounts (username, save, updated, created) VALUES ('qa_password', '{}', 1, 1)`), /accounts_google/);
});

test('two clients share a room: join, state, action, chat, combat world and departure', async () => {
  const a = await client('create');
  const r = await a.next('welcome');
  assert.match(r.room, /^[A-F0-9]{6}$/); assert.equal(r.host, r.id);
  a.send({ type: 'state', state });
  const b = await client('join', r.room, OTHER_ORIGIN);
  const joined = await b.next('welcome');
  assert.equal(joined.room, r.room); assert.equal(joined.host, r.id);
  assert.deepEqual(joined.players.map(p => [p.id, p.state]), [[r.id, state]]);
  assert.equal((await a.next('joined')).id, joined.id);
  b.send({ type: 'state', state: { ...state, x: 7 } });
  assert.equal((await a.next('state')).state.x, 7);
  b.send({ type: 'action', action: 'jump' });
  assert.equal((await a.next('action')).action, 'jump');
  b.send({ type: 'chat', text: 'hello over the VM' });
  assert.equal((await a.next('chat')).text, 'hello over the VM');
  assert.equal((await b.next('chat')).name, 'Test crab');
  a.send({ type: 'world', world });
  assert.deepEqual((await b.next('world')).world, world);
  b.send({ type: 'combat', event: { kind: 'attack', target: 'e0', amount: 23 } });
  assert.equal((await a.next('combat')).id, joined.id);
  b.ws.close();
  assert.equal((await a.next('left')).id, joined.id);
});

test('a room and its checkpoint outlive its last player, as Worker rooms did', async () => {
  const a = await client('create');
  const r = await a.next('welcome');
  a.send({ type: 'world', world: { ...world, rust: true } });
  await new Promise(res => setTimeout(res, 100));
  a.ws.close(); await once(a.ws, 'close');
  await new Promise(res => setTimeout(res, 100));
  const b = await client('join', r.room);
  const back = await b.next('welcome');
  assert.equal(back.room, r.room); assert.equal(back.players.length, 0);
  assert.equal(back.world.rust, true);
  const lost = await client('join', 'ABCDEF');
  assert.match((await lost.next('error')).message, /not found/);
});

test('entering the world puts players in a public shard of their area, dropped once empty though rooms are kept', async () => {
  const a = await client('enter', '', ORIGIN, { area: 3 });
  const ar = await a.next('welcome');
  const b = await client('enter', '', OTHER_ORIGIN, { area: 3, spec: { ...spec, name: 'Stranger' } });
  const br = await b.next('welcome');
  assert.match(ar.room, /^W3[A-F0-9]{4}$/); assert.equal(ar.public, true); assert.equal(ar.host, '');
  assert.equal(br.room, ar.room);
  assert.equal((await a.next('joined')).spec.name, 'Stranger');
  b.send({ type: 'chat', text: 'hello, World III' });
  assert.equal((await a.next('chat')).text, 'hello, World III');
  a.ws.close(); await once(a.ws, 'close');
  assert.equal((await b.next('left')).id, ar.id);
  b.ws.close(); await once(b.ws, 'close');
  await new Promise(res => setTimeout(res, 100));
  // Unlike a created room, an empty shard is not kept: the next player starts a new one.
  const c = await client('enter', '', ORIGIN, { area: 3 });
  const cr = await c.next('welcome');
  assert.match(cr.room, /^W3/); assert.notEqual(cr.room, ar.room); assert.deepEqual(cr.players, []);
  const lost = await client('join', ar.room);
  assert.match((await lost.next('error')).message, /not found/);
});

test('chat is masked and reports are stored in Postgres; three reporters mute a player, who still hears themselves', async () => {
  const sid = i => `server-test-${i}-${'y'.repeat(10)}`;
  const target = await client('enter', '', ORIGIN, { area: 2, session: sid('t'), spec: { ...spec, name: 'Rude crab' } });
  const tr = await target.next('welcome');
  const kids = [];
  for (let i = 0; i < 3; i++) { const c = await client('enter', '', OTHER_ORIGIN, { area: 2, session: sid(i), spec: { ...spec, name: `Kid ${i}` } }); assert.equal((await c.next('welcome')).room, tr.room); kids.push(c); }
  const renamed = await client('enter', '', ORIGIN, { area: 2, spec: { ...spec, name: 'ㅅㅂ crab' } });
  assert.equal((await renamed.next('welcome')).renamed, '게 모험가');
  assert.equal((await kids[0].next('joined')).spec.name, 'Kid 1');
  target.send({ type: 'chat', text: '병신아 010 1234 5678 로 문자해' });
  for (const c of kids) assert.equal((await c.next('chat')).text, '**아 *** **** **** 로 문자해');
  for (const [i, c] of kids.entries()) {
    c.send({ type: 'report', id: tr.id, reason: ['abuse', 'personal', 'harassment'][i] });
    assert.deepEqual(await c.next('reported'), { type: 'reported', id: tr.id, ok: true });
  }
  let rows = [];
  for (const until = Date.now() + 3000; rows.length < 3 && Date.now() < until; await new Promise(r => setTimeout(r, 50)))
    ({ rows } = await db.query('SELECT * FROM chat_reports WHERE target_session = $1 ORDER BY id', [sid('t')]));
  assert.deepEqual(rows.map(r => [r.reason, r.muted, r.reporter_name, r.reporter_session, r.reporter_account, r.target_name, r.room]), [
    ['abuse', false, 'Kid 0', sid(0), null, 'Rude crab', tr.room], ['personal', false, 'Kid 1', sid(1), null, 'Rude crab', tr.room], ['harassment', true, 'Kid 2', sid(2), null, 'Rude crab', tr.room]]);
  assert.deepEqual(rows[0].target_lines.map(l => l.text), ['**아 *** **** **** 로 문자해']);
  assert.ok(rows[0].created instanceof Date && Math.abs(rows[0].created - Date.now()) < 60000);
  // Nothing in a row looks like an address: the relay never hands one over.
  assert.equal(/\b\d{1,3}(\.\d{1,3}){3}\b/.test(JSON.stringify(rows)), false);
  await new Promise(r => setTimeout(r, 720));
  target.send({ type: 'chat', text: 'anyone?' });
  assert.equal((await target.next('chat')).text, '**아 *** **** **** 로 문자해');
  assert.equal((await target.next('chat')).text, 'anyone?');
  await new Promise(r => setTimeout(r, 150));
  for (const c of kids) assert.equal(c.queue.some(m => m.type === 'chat'), false);
  // The lister on the VM reads them back.
  const lister = spawn(process.execPath, [join(root, 'server-dist/reports.mjs'), '--hours', '1'], { env: { PATH: process.env.PATH, DATABASE_URL }, stdio: ['ignore', 'pipe', 'pipe'] });
  let listed = ''; lister.stdout.on('data', d => { listed += d; }); lister.stderr.on('data', d => { listed += d; });
  assert.equal((await once(lister, 'exit'))[0], 0, listed);
  assert.match(listed, /chat reports in the last 1 h: 3/);
  assert.match(listed, /괴롭힘 harassment {2}-> muted for 30 min/);
  assert.match(listed, /target {4}Rude crab/);
  assert.ok(listed.includes('**아 *** **** **** 로 문자해'), listed);
  for (const c of [target, renamed, ...kids]) c.ws.close();
});

test('disallowed origins, oversized messages and other upgrade paths are refused', async () => {
  const refused = new WebSocket(`ws://127.0.0.1:${port}/multiplayer?mode=create`, { origin: 'https://evil.example' });
  refused.on('error', () => {});
  const [, res] = await once(refused, 'unexpected-response');
  assert.equal(res.statusCode, 403);
  refused.terminate();
  const elsewhere = new WebSocket(`ws://127.0.0.1:${port}/other`, { origin: ORIGIN });
  elsewhere.on('error', () => {});
  assert.equal((await once(elsewhere, 'unexpected-response'))[1].statusCode, 404);
  elsewhere.terminate();
  const big = await client('create');
  await big.next('welcome');
  big.ws.send(JSON.stringify({ type: 'chat', text: 'x'.repeat(70000) }));
  const [code] = await once(big.ws, 'close');
  assert.equal(code, 1009);
});

const xff = ip => ({ 'X-Forwarded-For': `203.0.113.250, ${ip}` });
const hostHeader = host => (host ? { Host: host } : {});
const setCookies = res => res.headers['set-cookie'] ?? [];
const googleStart = ({ ret = '/', ip = freshIp(), host } = {}) =>
  http('GET', '/api/account/google/start?return=' + encodeURIComponent(ret), { headers: { ...xff(ip), ...hostHeader(host) } });
/** The whole round trip: start, the fake Google redirecting back with a code, then the callback with the state cookie. */
async function googleSignIn({ sub, ret = '/', ip = freshIp(), host, claims = {}, state } = {}) {
  const start = await googleStart({ ret, ip, host });
  assert.equal(start.status, 302, start.text);
  const auth = new URL(start.headers.location);
  for (const [k, v] of Object.entries({ sub, ...claims })) if (v !== undefined) auth.searchParams.set(k, String(v));
  const google = await fetch(auth, { redirect: 'manual' });
  assert.equal(google.status, 302);
  const back = new URL(google.headers.get('location'));
  if (state !== undefined) back.searchParams.set('state', state);
  const callback = await http('GET', back.pathname + back.search, { headers: { Cookie: cookieOf(start), ...xff(ip), ...hostHeader(host) } });
  const session = setCookies(callback).find(c => c.startsWith('cc_account='));
  const cookie = session?.split(';')[0];
  if (cookie) tokens.push(cookie.split('.')[1]);
  return { start, back, callback, session, cookie };
}
const usernameOf = sub => 'g' + createHash('sha256').update('google:' + sub).digest('hex').slice(0, 23);
const tokens = [];

test('Google start sets a Lax state cookie and redirects to Google with an S256 challenge', async () => {
  const start = await googleStart({ ret: '/?screen=title' });
  assert.equal(start.status, 302);
  assert.match(start.headers['cache-control'], /no-store/);
  const location = new URL(start.headers.location), q = location.searchParams;
  assert.equal(location.origin + location.pathname, google.authUrl);
  assert.deepEqual([q.get('client_id'), q.get('redirect_uri'), q.get('response_type'), q.get('scope'), q.get('code_challenge_method'), q.get('prompt')],
    [CLIENT_ID, `${base}/api/account/google/callback`, 'code', 'openid', 'S256', 'select_account']);
  const [setCookie] = setCookies(start);
  const m = setCookie.match(/^cc_oauth=([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]+); Path=\/api\/account\/google; HttpOnly; SameSite=Lax; Max-Age=600$/);
  assert.ok(m, setCookie);
  assert.equal(q.get('state'), m[1]);
  assert.equal(q.get('code_challenge'), createHash('sha256').update(m[2]).digest('base64url'));
  assert.equal(Buffer.from(m[3], 'base64url').toString(), '/?screen=title');
  // Behind Caddy the Host is public: Google returns to that origin, and the cookie is Secure.
  const pub = await googleStart({ host: 'crab-dev.seonn.dev' });
  assert.equal(new URL(pub.headers.location).searchParams.get('redirect_uri'), 'https://crab-dev.seonn.dev/api/account/google/callback');
  assert.match(setCookies(pub)[0], /; HttpOnly; SameSite=Lax; Secure; Max-Age=600$/);
  for (const host of ['evil.example', 'crab.seonn.dev.evil.example', 'crab.seonn.dev:8443']) assert.deepEqual((await googleStart({ host })).json, { error: 'origin' });
  assert.equal((await http('POST', '/api/account/google/start', { headers: xff(freshIp()) })).status, 405);
});

test('the first Google sign-in creates an account, the next reuses it; session, save and logout keep their contract', async () => {
  const sub = 'qa-' + randomBytes(6).toString('hex'), username = usernameOf(sub);
  assert.match(username, /^g[a-f0-9]{23}$/);
  const first = await googleSignIn({ sub, ret: '/?screen=title' });
  assert.equal(first.callback.status, 302);
  assert.equal(first.callback.headers.location, '/?screen=title');
  assert.equal(first.callback.headers['referrer-policy'], 'no-referrer');
  assert.match(setCookies(first.callback)[0], /^cc_oauth=; Path=\/api\/account\/google; HttpOnly; SameSite=Lax; Max-Age=0$/);
  assert.match(first.session, /^cc_account=g[a-f0-9]{23}\.[a-f0-9]{64}; Path=\/api\/account; HttpOnly; SameSite=Strict; Max-Age=604800$/);
  assert.equal(first.cookie.split('=')[1].split('.')[0], username);
  const fresh = await api('session', undefined, { cookie: first.cookie });
  assert.deepEqual(fresh.json, { username, revision: 0, save: {}, updated: fresh.json.updated });
  const save = { 'cc.spec': JSON.stringify(spec), 'cc.journey.v1:human:male:warrior:Test crab': JSON.stringify({ xp: 137, coins: 73, chapter: 1 }) };
  const saved = await api('save', { revision: 0, save }, { cookie: first.cookie });
  assert.deepEqual([saved.status, saved.json.username, saved.json.revision, saved.json.save], [200, username, 1, undefined]);
  // The same Google account on another device lands on the same save.
  const second = await googleSignIn({ sub });
  assert.equal(second.callback.headers.location, '/');
  assert.notEqual(second.cookie, first.cookie);
  const loaded = await api('session', undefined, { cookie: second.cookie });
  assert.deepEqual([loaded.json.username, loaded.json.revision, loaded.json.save], [username, 1, save]);
  assert.deepEqual(Object.keys(loaded.json.save), Object.keys(save));
  assert.equal((await api('save', { revision: 0, save }, { cookie: second.cookie })).json.error, 'conflict');
  assert.equal((await api('save', { revision: 1, save: { 'cc.musicVol': '1' } }, { cookie: second.cookie })).json.error, 'save');
  assert.equal((await api('save', { revision: 1, save: { 'cc.spec': 'null' } }, { cookie: second.cookie })).json.error, 'save');
  const other = await googleSignIn({ sub: sub + '-other' });
  assert.notEqual(other.cookie.split('=')[1].split('.')[0], username);
  assert.equal((await api('session', undefined, { cookie: other.cookie })).json.revision, 0);
  const logout = await api('logout', {}, { cookie: first.cookie });
  assert.deepEqual([logout.status, logout.json], [200, { ok: true }]);
  assert.match(logout.headers['set-cookie'][0], /^cc_account=; Path=\/api\/account; HttpOnly; SameSite=Strict; Max-Age=0$/);
  assert.equal((await api('session', undefined, { cookie: first.cookie })).status, 401);
  assert.equal((await api('session', undefined, { cookie: second.cookie })).status, 200);
  // Only the hashed account key, the save and hashed session tokens are stored: no Google sub, email or name.
  const { rows: columns } = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'accounts' ORDER BY ordinal_position`);
  assert.deepEqual(columns.map(c => c.column_name), ['username', 'revision', 'save', 'updated', 'created']);
  const { rows: [row] } = await db.query('SELECT * FROM accounts WHERE username = $1', [username]);
  assert.ok(!JSON.stringify(row).includes(sub));
  const { rows: sessions } = await db.query('SELECT token_hash FROM sessions WHERE username = $1', [username]);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].token_hash, createHash('sha256').update(second.cookie.split('.')[1]).digest('hex'));
  assert.equal((await db.query('SELECT count(*)::int AS n FROM accounts WHERE username = $1', [username])).rows[0].n, 1);
});

test('the callback refuses a wrong or missing state, a refusal at Google and bad id tokens', async () => {
  const sub = 'qa-' + randomBytes(6).toString('hex');
  const refused = async (result, location = '/?account=error') => {
    assert.equal(result.callback.status, 302);
    assert.equal(result.callback.headers.location, location);
    assert.equal(result.session, undefined);
    assert.match(setCookies(result.callback)[0], /^cc_oauth=; .*Max-Age=0$/);
  };
  await refused(await googleSignIn({ sub, state: 'A'.repeat(43) }));
  await refused(await googleSignIn({ sub, state: '' }));
  // Same length in characters, longer in bytes: must not throw inside the comparison.
  await refused(await googleSignIn({ sub, state: 'é' + 'A'.repeat(42) }));
  await refused(await googleSignIn({ sub, ret: '/?screen=title', claims: { aud: 'someone-else.apps.googleusercontent.com' } }), '/?screen=title&account=error');
  await refused(await googleSignIn({ sub, claims: { exp: Math.floor(Date.now() / 1000) - 60 } }));
  await refused(await googleSignIn({ sub, claims: { iss: 'https://evil.example' } }));
  await refused(await googleSignIn({ sub, claims: { sub: '' } }));
  // No state cookie at all (another browser, or it expired).
  const start = await googleStart();
  const state = new URL(start.headers.location).searchParams.get('state');
  const bare = await http('GET', `/api/account/google/callback?code=x&state=${state}`, { headers: xff(freshIp()) });
  assert.deepEqual([bare.status, bare.headers.location], [302, '/?account=error']);
  // The player cancels at Google.
  const denied = await http('GET', `/api/account/google/callback?error=access_denied&state=${state}`, { headers: { Cookie: cookieOf(start), ...xff(freshIp()) } });
  assert.deepEqual([denied.status, denied.headers.location], [302, '/?account=error']);
  assert.ok(!setCookies(denied).some(c => c.startsWith('cc_account=')));
  // A code can be redeemed once: replaying the callback with a new state cookie fails at the token endpoint.
  const ok = await googleSignIn({ sub });
  assert.ok(ok.cookie);
  const again = await googleStart();
  const replay = new URL(ok.back); replay.searchParams.set('state', new URL(again.headers.location).searchParams.get('state'));
  const replayed = await http('GET', replay.pathname + replay.search, { headers: { Cookie: cookieOf(again), ...xff(freshIp()) } });
  assert.equal(replayed.headers.location, '/?account=error');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM accounts WHERE username = $1', [usernameOf(sub)])).rows[0].n, 1);
});

test('return paths stay on this site', async () => {
  const sub = 'qa-' + randomBytes(6).toString('hex');
  for (const ret of ['//evil.example', 'https://evil.example', '/\\evil.example', '\\\\evil.example', '/\t/evil.example', '/\n/evil.example', 'javascript:alert(1)', 'evil.example', '', '/' + 'a'.repeat(600)]) {
    const r = await googleSignIn({ sub, ret });
    assert.equal(r.callback.headers.location, '/', JSON.stringify(ret));
    const error = await googleSignIn({ sub, ret, claims: { aud: 'nope' } });
    assert.equal(error.callback.headers.location, '/?account=error', JSON.stringify(ret));
  }
  assert.equal((await googleSignIn({ sub, ret: '/?screen=game&multiplayer=1' })).callback.headers.location, '/?screen=game&multiplayer=1');
  assert.equal((await googleSignIn({ sub, ret: '/play/index.html?lang=en' })).callback.headers.location, '/play/index.html?lang=en');
});

test('username and password sign-in is gone', async () => {
  const ip = freshIp();
  assert.deepEqual([(await api('signup', { username: 'qa_gone', password: 'long enough password', save: {} }, { ip })).status, (await api('signup', {}, { ip })).json], [404, { error: 'route' }]);
  assert.deepEqual([(await api('login', { username: 'qa_gone', password: 'long enough password' }, { ip })).status, (await api('login', undefined, { ip })).json], [404, { error: 'route' }]);
  assert.equal((await api('google', undefined)).status, 404);
  assert.equal((await api('session/extra', undefined)).status, 404);
});

test('origin, header, method, body size and public-host cookie rules', async () => {
  assert.deepEqual((await api('session', undefined, { Origin: 'https://evil.example' })).json, { error: 'origin' });
  assert.deepEqual((await api('session', undefined, { 'X-Crabcraft-Account': '' })).json, { error: 'origin' });
  assert.equal((await http('GET', '/api/account/session', { headers: { Origin: ORIGIN } })).status, 403);
  assert.equal((await api('save', undefined)).status, 405);
  assert.equal((await api('session', {})).status, 405);
  // A guest (no session cookie) is an answer, not an error the browser logs; a cookie that is there but bad is still 401.
  for (const extra of [{}, { Origin: 'http://localhost:5173' }, { Cookie: 'cc_lang=en' }]) {
    const guest = await api('session', undefined, extra);
    assert.deepEqual([guest.status, guest.json, guest.headers['cache-control']], [200, { signedIn: false }, 'no-store, private']);
  }
  for (const cookie of ['cc_account=', 'cc_account=nope', `cc_account=g${'0'.repeat(23)}.${'a'.repeat(64)}`]) assert.deepEqual((await api('session', undefined, { cookie })).json, { error: 'session' }, cookie);
  assert.equal((await api('session', undefined, { cookie: 'cc_account=nope' })).status, 401);
  // Saving and signing out still need a session.
  assert.deepEqual([(await api('save', { revision: 0, save: {} })).status, (await api('logout', {})).status], [401, 401]);
  assert.equal((await api('save', { revision: 0, save: { 'cc.spec': 'x'.repeat(70000) } })).json.error, 'request');
  assert.equal((await api('save', '[1]')).json.error, 'request');
  // Behind Caddy the Host is public: local origins stop working and the cookies become Secure.
  const publicHost = 'crab.seonn.dev';
  assert.equal((await api('session', undefined, { Host: publicHost, Origin: 'http://localhost:5173' })).status, 403);
  const signedIn = await googleSignIn({ sub: 'qa-' + randomBytes(6).toString('hex'), host: publicHost });
  assert.match(signedIn.session, /; HttpOnly; SameSite=Strict; Secure; Max-Age=604800$/);
  assert.match(setCookies(signedIn.callback)[0], /; HttpOnly; SameSite=Lax; Secure; Max-Age=0$/);
  assert.equal((await api('session', undefined, { cookie: signedIn.cookie, Host: publicHost })).status, 200);
  assert.match((await api('logout', {}, { cookie: signedIn.cookie, Host: publicHost })).headers['set-cookie'][0], /; HttpOnly; SameSite=Strict; Secure; Max-Age=0$/);
});

test('per-IP limits on Google start and callback, per-account limit on save', async () => {
  // The IP window counts every start and callback from the last X-Forwarded-For hop.
  const busy = freshIp(), sub = 'qa-' + randomBytes(6).toString('hex');
  const starts = await Promise.all(Array.from({ length: 99 }, () => googleStart({ ip: busy })));
  assert.ok(starts.every(r => r.status === 302));
  const last = await googleSignIn({ sub, ip: busy });
  assert.equal(last.callback.headers.location, '/?account=error');
  assert.deepEqual((await googleStart({ ip: busy })).json, { error: 'rate' });
  assert.equal((await googleStart({ ip: freshIp() })).status, 302);
  const { cookie } = await googleSignIn({ sub });
  for (let revision = 0; revision < 60; revision++) assert.equal((await api('save', { revision, save: {} }, { cookie })).status, 200);
  assert.deepEqual((await api('save', { revision: 60, save: {} }, { cookie })).json, { error: 'rate' });
});

test('without GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, start answers 503 and the callback sends players back', async () => {
  const bare = spawn(process.execPath, [join(root, 'server-dist/main.mjs')], {
    env: { PATH: process.env.PATH, PORT: String(await freePort()), HOST: '127.0.0.1', DATABASE_URL, ALLOWED_ORIGINS: ORIGIN },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  bare.stdout.on('data', d => { log += d; }); bare.stderr.on('data', d => { log += d; });
  try {
    const until = Date.now() + 20000;
    while (!/listening on 127\.0\.0\.1:(\d+)/.test(log)) {
      if (bare.exitCode !== null || Date.now() > until) throw new Error('server did not start:\n' + log);
      await new Promise(r => setTimeout(r, 50));
    }
    const at = 'http://127.0.0.1:' + log.match(/listening on 127\.0\.0\.1:(\d+)/)[1];
    const start = await fetch(at + '/api/account/google/start?return=%2F', { redirect: 'manual' });
    assert.deepEqual([start.status, await start.json()], [503, { error: 'google' }]);
    const callback = await fetch(at + '/api/account/google/callback?code=x&state=y', { redirect: 'manual' });
    assert.deepEqual([callback.status, callback.headers.get('location')], [302, '/?account=error']);
    assert.match(log, /GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is not set/);
  } finally { bare.kill('SIGKILL'); await once(bare, 'exit'); }
});

test('bundled account HTTP issues same-origin world tickets without widening cookies or opening /world', async () => {
  const signed = await googleSignIn({ sub: 'ticket-' + randomBytes(6).toString('hex'), host: 'crab.seonn.dev' });
  assert.match(signed.session, /Path=\/api\/account; HttpOnly; SameSite=Strict; Secure;/);
  const issued = await api('world-ticket', {}, { cookie: signed.cookie, Host: 'crab.seonn.dev' });
  assert.equal(issued.status, 200); assert.match(issued.json.ticket, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(Object.keys(issued.json).sort(), ['expiresAt', 'ticket']); assert.match(issued.headers['cache-control'], /no-store/);
  assert.equal((await api('world-ticket', {}, { cookie: signed.cookie, Host: 'crab.seonn.dev', Origin: OTHER_ORIGIN })).status, 403);
  assert.equal((await http('GET', '/world')).status, 404);
  assert.equal((await api('logout', {}, { cookie: signed.cookie, Host: 'crab.seonn.dev' })).status, 200);
  assert.equal((await api('world-ticket', {}, { cookie: signed.cookie, Host: 'crab.seonn.dev' })).status, 401);
  assert.ok(!output.includes(issued.json.ticket), 'ticket leaked into server log');
});

test('the server log never holds the client secret, codes, tokens or session tokens', async () => {
  assert.ok(google.issued.length > 20 && tokens.length > 10);
  assert.match(output, /account google callback: (state|aud|exp|iss|token-400)/);
  for (const secret of [CLIENT_SECRET, ...google.issued, ...google.issued.map(encodeURIComponent), ...tokens]) assert.ok(!output.includes(secret), 'leaked into the log');
});

test('SIGTERM tells every socket the server is restarting, exits cleanly, and public-shard players come back to the new process', async t => {
  const a = await client('create');
  await a.next('welcome');
  const closed = once(a.ws, 'close');
  // Two players in a public shard, connected the way the game connects (src/multiplayer/link.ts).
  const crabs = ['Ada', 'Bo'].map(name => {
    const seen = { welcomes: [], back: [] };
    const link = new Link(() => `ws://127.0.0.1:${port}/multiplayer`, {
      hello: () => ({ type: 'enter', area: 1, spec: { ...spec, name } }),
      message: msg => { if (msg.type === 'welcome') seen.welcomes.push(msg); },
      lost: () => {},
      back: info => seen.back.push(info),
    });
    t.after(() => link.dispose());
    link.connect('enter');
    return { link, seen };
  });
  const welcomed = n => Promise.all(crabs.map(async c => { for (const until = Date.now() + 20000; !(c.seen.welcomes.length >= n && c.link.open);) { if (Date.now() > until) throw new Error('no welcome #' + n); await new Promise(r => setTimeout(r, 20)); } }));
  await welcomed(1);
  assert.equal(crabs[0].seen.welcomes[0].room, crabs[1].seen.welcomes[0].room);
  const stopped = Date.now();
  server.kill('SIGTERM');
  const [code] = await once(server, 'exit');
  assert.equal(code, 0);
  const [closeCode] = await closed;
  assert.equal(closeCode, 1012);
  assert.ok(a.queue.some(m => m.type === 'restarting'), JSON.stringify(a.queue));
  assert.match(output, /SIGTERM: shutting down/);
  // A deploy starts the new process on the same port; nobody clicks anything. (How soon depends on how long the
  // process takes to start here; tools/qa-shard-restart.mjs times it in the browser.)
  await startServer();
  const listening = Date.now();
  await welcomed(2);
  // Within one backoff step (at most 8 s +25%) of the new process listening.
  assert.ok(Date.now() - listening < 10000, `back ${Date.now() - listening} ms after the new process listened, ${Date.now() - stopped} ms after SIGTERM`);
  assert.equal(crabs[0].seen.welcomes[1].room, crabs[1].seen.welcomes[1].room);
  assert.match(crabs[0].seen.welcomes[1].room, /^W1/);
  for (const c of crabs) assert.equal(c.seen.back[0].restart, true);
  server.kill('SIGTERM');
  assert.equal((await once(server, 'exit'))[0], 0);
});
