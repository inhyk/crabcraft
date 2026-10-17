// pnpm test:server — runs server-dist/main.mjs against a throwaway Postgres cluster on a free port.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import WebSocket from 'ws';

const root = fileURLToPath(new URL('../../', import.meta.url));
const ORIGIN = 'https://crabcraft.example', OTHER_ORIGIN = 'https://crabcraft-dev.example';

function pgBin() {
  const dirs = [process.env.PG_BIN, ...(process.env.PATH ?? '').split(delimiter), '/opt/homebrew/bin', '/usr/local/bin'];
  for (const base of ['/opt/homebrew/opt', '/usr/lib/postgresql']) {
    try { for (const d of readdirSync(base).sort().reverse()) dirs.push(base === '/usr/lib/postgresql' ? join(base, d, 'bin') : join(base, d, 'bin')); } catch { /* not installed here */ }
  }
  const dir = dirs.find(d => d && existsSync(join(d, 'initdb')) && existsSync(join(d, 'pg_ctl')));
  if (!dir) throw new Error('Postgres binaries (initdb, pg_ctl) not found; set PG_BIN');
  return dir;
}
async function freePort() {
  for (;;) {
    const s = createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening');
    const { port } = s.address(); s.close(); await once(s, 'close');
    if (port !== 5432) return port;
  }
}

let dir, bin, data, db, server, base, port, output = '';
before(async () => {
  bin = pgBin();
  dir = mkdtempSync(join(tmpdir(), 'crabcraft-pg-'));
  data = join(dir, 'data');
  const pgPort = await freePort();
  execFileSync(join(bin, 'initdb'), ['-D', data, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C', '--no-sync'], { stdio: 'ignore' });
  // TCP on 127.0.0.1 only, no Unix socket: nothing shared with any other cluster.
  execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-l', join(dir, 'postgres.log'), '-w', '-t', '30', '-o', `-c listen_addresses=127.0.0.1 -p ${pgPort} -c unix_socket_directories='' -c fsync=off`, 'start'], { stdio: 'ignore' });
  const admin = new pg.Client({ connectionString: `postgres://postgres@127.0.0.1:${pgPort}/postgres` });
  await admin.connect(); await admin.query('CREATE DATABASE crabcraft'); await admin.end();
  const DATABASE_URL = `postgres://postgres@127.0.0.1:${pgPort}/crabcraft`;
  db = new pg.Pool({ connectionString: DATABASE_URL });
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [join(root, 'server-dist/main.mjs')], {
    env: { PATH: process.env.PATH, PORT: String(port), HOST: '127.0.0.1', DATABASE_URL, ALLOWED_ORIGINS: `${ORIGIN}, ${OTHER_ORIGIN}`, TRUST_PROXY: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', d => { output += d; });
  server.stderr.on('data', d => { output += d; });
  const until = Date.now() + 20000;
  while (!/listening on/.test(output)) {
    if (server.exitCode !== null || Date.now() > until) throw new Error('server did not start:\n' + output);
    await new Promise(r => setTimeout(r, 50));
  }
});

after(async () => {
  if (server && server.exitCode === null) { server.kill('SIGKILL'); await once(server, 'exit'); }
  await db?.end().catch(() => {});
  if (data && existsSync(join(data, 'postmaster.pid'))) execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop'], { stdio: 'ignore' });
  if (dir) rmSync(dir, { recursive: true, force: true });
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
async function client(mode, room = '', origin = ORIGIN) {
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
  c.send({ type: mode, room, spec, combatVersion: 1 });
  return c;
}
after(() => { for (const ws of sockets) ws.terminate(); });

test('healthz reports the database; other paths answer like the Worker', async () => {
  assert.equal((await http('GET', '/healthz')).status, 200);
  assert.deepEqual((await http('GET', '/health')).json, { ok: true, game: 'crabcraft-multiplayer' });
  assert.equal((await http('GET', '/multiplayer')).status, 426);
  assert.equal((await http('GET', '/nope')).status, 404);
  const { rows } = await db.query('SELECT version FROM schema_migrations ORDER BY version');
  assert.deepEqual(rows.map(r => r.version), ['001_accounts']);
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

test('signup, login, save, load and logout with cookies; secrets stay hashed and unlogged', async () => {
  const username = 'qa_' + randomBytes(5).toString('hex'), password = randomBytes(18).toString('base64url');
  const save = { 'cc.spec': JSON.stringify(spec), 'cc.journey.v1:human:male:warrior:Test crab': JSON.stringify({ xp: 137, coins: 73, chapter: 1 }) };
  const ip = freshIp();
  assert.equal((await api('session')).status, 401);
  const signup = await api('signup', { username, password, save }, { ip });
  assert.equal(signup.status, 200);
  assert.deepEqual(signup.json, { username, revision: 0, save, updated: signup.json.updated });
  assert.equal(typeof signup.json.updated, 'number');
  const setCookie = signup.headers['set-cookie'][0];
  assert.match(setCookie, /^cc_account=[a-z0-9_]+\.[a-f0-9]{64}; Path=\/api\/account; HttpOnly; SameSite=Strict; Max-Age=604800$/);
  assert.match(signup.headers['cache-control'], /no-store/);
  assert.equal(signup.headers['x-content-type-options'], 'nosniff');
  const cookie = cookieOf(signup), token = cookie.split('.')[1];
  assert.equal((await api('signup', { username, password, save }, { ip })).json.error, 'taken');
  const wrong = await api('login', { username, password: password + 'x' }, { ip });
  assert.deepEqual([wrong.status, wrong.json], [401, { error: 'credentials' }]);
  const login = await api('login', { username: username.toUpperCase(), password }, { ip });
  assert.equal(login.status, 200); assert.deepEqual(login.json.save, save);
  const loaded = await api('session', undefined, { cookie });
  assert.deepEqual([loaded.status, loaded.json.save, loaded.json.revision], [200, save, 0]);
  const progressed = { ...save, 'cc.journey.v1:human:male:warrior:Test crab': JSON.stringify({ xp: 246, coins: 99, chapter: 1 }), 'cc.lighthouseSecret.v1': 'found' };
  const saved = await api('save', { revision: 0, save: progressed }, { cookie });
  assert.deepEqual([saved.status, saved.json.revision, saved.json.save], [200, 1, undefined]);
  assert.equal((await api('save', { revision: 0, save }, { cookie: cookieOf(login) })).json.error, 'conflict');
  assert.equal((await api('save', { revision: 1, save: { 'cc.musicVol': '1' } }, { cookie })).json.error, 'save');
  assert.equal((await api('save', { revision: 1, save: { 'cc.spec': 'null' } }, { cookie })).json.error, 'save');
  const reloaded = await api('session', undefined, { cookie: cookieOf(login) });
  assert.deepEqual([reloaded.json.revision, reloaded.json.save], [1, progressed]);
  assert.deepEqual(Object.keys(reloaded.json.save), Object.keys(progressed));
  const logout = await api('logout', {}, { cookie });
  assert.equal(logout.status, 200);
  assert.match(logout.headers['set-cookie'][0], /^cc_account=; Path=\/api\/account; HttpOnly; SameSite=Strict; Max-Age=0$/);
  assert.equal((await api('session', undefined, { cookie })).status, 401);
  assert.equal((await api('session', undefined, { cookie: cookieOf(login) })).status, 200);
  const { rows: [row] } = await db.query('SELECT salt, hash FROM accounts WHERE username = $1', [username]);
  assert.match(row.salt, /^[a-f0-9]{64}$/); assert.match(row.hash, /^[a-f0-9]{64}$/); assert.notEqual(row.hash, password);
  const { rows: sessions } = await db.query('SELECT token_hash FROM sessions WHERE username = $1', [username]);
  assert.equal(sessions.length, 1);
  assert.ok(sessions.every(s => /^[a-f0-9]{64}$/.test(s.token_hash) && s.token_hash !== token && s.token_hash !== cookieOf(login).split('.')[1]));
  assert.ok(!output.includes(password) && !output.includes(token));
});

test('origin, header, method, body size and public-host cookie rules', async () => {
  assert.deepEqual((await api('session', undefined, { Origin: 'https://evil.example' })).json, { error: 'origin' });
  assert.deepEqual((await api('session', undefined, { 'X-Crabcraft-Account': '' })).json, { error: 'origin' });
  assert.equal((await http('GET', '/api/account/session', { headers: { Origin: ORIGIN } })).status, 403);
  assert.equal((await api('login', undefined)).status, 405);
  assert.equal((await api('session', {})).status, 405);
  assert.equal((await api('session', undefined, { Origin: 'http://localhost:5173' })).status, 401);
  assert.equal((await api('login', { username: 'qa_big', password: 'x'.repeat(70000) }, { ip: freshIp() })).json.error, 'request');
  assert.equal((await api('login', '[1]', { ip: freshIp() })).json.error, 'request');
  assert.equal((await api('login', { username: 'no', password: 'long enough password' }, { ip: freshIp() })).json.error, 'username');
  // Behind Caddy the Host is public: local origins stop working and the cookie becomes Secure.
  const publicHost = { Host: 'crabcraft.example' };
  assert.equal((await api('session', undefined, { ...publicHost, Origin: 'http://localhost:5173' })).status, 403);
  const username = 'qa_' + randomBytes(5).toString('hex');
  const signup = await api('signup', { username, password: randomBytes(18).toString('base64url'), save: {} }, { ip: freshIp(), ...publicHost });
  assert.equal(signup.status, 200);
  assert.match(signup.headers['set-cookie'][0], /; HttpOnly; SameSite=Strict; Secure; Max-Age=604800$/);
});

test('per-account and per-IP rate limits', async () => {
  const missing = 'qa_' + randomBytes(5).toString('hex'), ip = freshIp();
  for (let i = 0; i < 20; i++) assert.equal((await api('login', { username: missing, password: 'not the password' }, { ip })).status, 401);
  assert.deepEqual((await api('login', { username: missing, password: 'not the password' }, { ip: freshIp() })).json, { error: 'rate' });
  // The IP window counts every signup or login attempt from the last X-Forwarded-For hop.
  const busy = freshIp();
  const attempts = await Promise.all(Array.from({ length: 100 }, (_, i) => api('login', { username: `qa_ip_${i}`, password: 'short' }, { ip: busy })));
  assert.ok(attempts.every(r => r.json.error === 'password'));
  assert.deepEqual((await api('login', { username: 'qa_ip_x', password: 'short' }, { ip: busy })).json, { error: 'rate' });
  assert.equal((await api('login', { username: 'qa_ip_x', password: 'short' }, { ip: freshIp() })).json.error, 'password');
});

test('SIGTERM closes sockets and exits cleanly', async () => {
  const a = await client('create');
  await a.next('welcome');
  const closed = once(a.ws, 'close');
  server.kill('SIGTERM');
  const [code] = await once(server, 'exit');
  assert.equal(code, 0);
  await closed;
  assert.match(output, /SIGTERM: shutting down/);
});
