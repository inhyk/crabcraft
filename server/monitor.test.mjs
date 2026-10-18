import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import WebSocket from 'ws';
import { attachRooms } from './rooms.ts';
import { monitorAccess, monitorHandler, observeTickets } from './node/monitor.ts';

const account = 'g' + 'a'.repeat(23), token = 'b'.repeat(64);
const cookie = `cc_account=${account}.${token}`;
const spec = { race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'Observer QA' };
const state = { x: 3, y: 4, z: 5, yaw: 1, hp: 80, maxHp: 100, alive: true, area: 1 };
async function setup(t, allowed = [account], places = []) {
  let expires = Date.now() + 60000, fail = false;
  const db = { async query(_sql, [hash, username]) {
    if (fail) throw new Error('database unavailable');
    return { rows: hash === createHash('sha256').update(token).digest('hex') && username === account ? [{ expires: String(expires) }] : [] };
  } };
  const ip = req => String(req.headers['x-test-ip'] ?? '');
  const server = createServer((req, res) => void (req.url === '/api/account/monitor-ticket' ? ticketHandler : handler)(req, res));
  // Observers are wired as server/node/main.ts wires them: the monitor rule, or a ticket from it.
  const tickets = observeTickets(), access = monitorAccess(db, new Set(allowed), new Set(places), ip);
  const relay = attachRooms(server, { maxMembers: 64, observe: async (req, ticket) => tickets.valid(ticket) || await access(req) === 'ok' });
  const handler = monitorHandler(db, new Set(allowed), relay.monitorSnapshot, new Set(places), ip);
  const ticketHandler = monitorHandler(db, new Set(allowed), () => tickets.issue(), new Set(places), ip);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`, clients = [];
  t.after(async () => { for (const ws of clients) ws.terminate(); relay.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); });
  async function client(hello = { type: 'enter', area: 1, spec }) {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/multiplayer');
    clients.push(ws); await once(ws, 'open');
    const received = once(ws, 'message'); ws.send(JSON.stringify(hello));
    const welcome = JSON.parse(String((await received)[0]));
    return { ws, welcome, send: data => ws.send(JSON.stringify(data)) };
  }
  const get = (headers = {}, options = {}) => fetch(base + '/api/account/monitor', { headers: { 'X-Crabcraft-Account': '1', Cookie: cookie, ...headers }, ...options });
  const ticket = (headers = {}) => fetch(base + '/api/account/monitor-ticket', { headers: { 'X-Crabcraft-Account': '1', Cookie: cookie, ...headers } });
  /** An observer socket: its upgrade headers (cookie, address) and what it sends; resolves with the first answer and the close code. */
  async function observe(room, { headers = {}, ticket: proof } = {}) {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/multiplayer', { headers });
    clients.push(ws); await once(ws, 'open');
    const closed = new Promise(resolve => ws.on('close', code => resolve(code)));
    const received = once(ws, 'message'); ws.send(JSON.stringify({ type: 'observe', room, ...(proof === undefined ? {} : { ticket: proof }) }));
    return { ws, first: JSON.parse(String((await received)[0])), closed };
  }
  return { base, relay, client, get, ticket, observe, expire: () => { expires = 0; }, fail: () => { fail = true; } };
}
const tick = () => new Promise(r => setTimeout(r, 25));

test('monitor fails closed without configured developers, login, or valid session', async t => {
  const missing = await setup(t, []);
  assert.equal((await missing.get()).status, 503);
  const app = await setup(t);
  assert.equal((await app.get({ Cookie: '' })).status, 401);
  assert.equal((await app.get({ Cookie: `cc_account=${account}.${'c'.repeat(64)}` })).status, 401);
  const other = await setup(t, ['g' + 'd'.repeat(23)]);
  assert.equal((await other.get()).status, 403);
});

test('monitor checks same origin, method and revocation on every request', async t => {
  const app = await setup(t);
  assert.equal((await app.get({ 'X-Crabcraft-Account': '' })).status, 403);
  assert.equal((await app.get({ Origin: 'https://elsewhere.invalid' })).status, 403);
  assert.equal((await app.get({ Origin: app.base })).status, 200);
  assert.equal((await app.get({}, { method: 'POST' })).status, 405);
  app.expire(); assert.equal((await app.get()).status, 401);
});

test('authorized monitor sees all public shards and private rooms without entering them', async t => {
  const app = await setup(t);
  const players = [];
  for (let i = 0; i < 10; i++) players.push(await app.client());
  const otherWorld = await app.client({ type: 'enter', area: 4, spec });
  const privatePlayer = await app.client({ type: 'create', spec });
  players[0].send({ type: 'state', state });
  privatePlayer.send({ type: 'state', state: { ...state, area: 3 } });
  await tick();
  const before = [...app.relay.rooms].map(([room, members]) => [room, members.size]);
  const res = await app.get(), data = await res.json();
  assert.equal(res.status, 200); assert.match(res.headers.get('cache-control'), /no-store/);
  assert.equal(data.players.length, 12);
  assert.equal(data.players.filter(p => p.area === 1).length, 10);
  assert.equal(new Set(data.players.filter(p => p.area === 1).map(p => p.room)).size, 2);
  assert.equal(data.players.find(p => p.id === otherWorld.welcome.id).area, 4);
  assert.equal(data.players.find(p => p.id === privatePlayer.welcome.id).area, 3);
  assert.equal(data.players.find(p => p.id === players[0].welcome.id).state.hp, 80);
  assert.deepEqual([...app.relay.rooms].map(([room, members]) => [room, members.size]), before);
  for (const p of data.players) assert.deepEqual(Object.keys(p).sort(), ['action', 'area', 'id', 'public', 'room', 'spec', 'state', 'updatedAt']);
  assert.ok(!JSON.stringify(data).includes(token));
});

test('unknown locations stay unknown; actions, travel, leave and disconnect update presence', async t => {
  const app = await setup(t), p = await app.client({ type: 'create', spec });
  assert.equal((await (await app.get()).json()).players[0].area, null);
  p.send({ type: 'state', state: { ...state, area: 2 } });
  p.send({ type: 'action', action: 'gesture_hello' }); await tick();
  const first = (await (await app.get()).json()).players[0];
  assert.equal(first.area, 2); assert.equal(first.action.name, 'gesture_hello'); assert.ok(first.updatedAt > 0);
  p.send({ type: 'enter', area: 4, spec }); await tick();
  const next = (await (await app.get()).json()).players[0];
  assert.equal(next.area, 4); assert.equal(next.state, null); assert.equal(next.action, null);
  p.send({ type: 'leave' }); await tick(); assert.equal((await (await app.get()).json()).players.length, 0);
  const q = await app.client(); q.ws.close(); await once(q.ws, 'close'); await tick();
  assert.equal((await (await app.get()).json()).players.length, 0);
});

test('snapshot copies cannot mutate relay state and separate server instances never mix users', async t => {
  const dev = await setup(t), main = await setup(t), p = await dev.client();
  p.send({ type: 'state', state }); await tick();
  const copy = dev.relay.monitorSnapshot(); copy.players[0].state.x = 999; copy.players[0].spec.name = 'changed';
  assert.equal(dev.relay.monitorSnapshot().players[0].state.x, 3);
  assert.equal(dev.relay.monitorSnapshot().players[0].spec.name, spec.name);
  assert.equal((await (await main.get()).json()).players.length, 0);
});

test('database failure returns unavailable without exposing presence', async t => {
  const app = await setup(t); await app.client(); app.fail();
  const res = await app.get(); assert.equal(res.status, 503); assert.deepEqual(await res.json(), { error: 'unavailable' });
});

test('frontier worlds V and VI keep their area; an unknown world number stays unknown', async t => {
  const app = await setup(t), p = await app.client({ type: 'create', spec });
  p.send({ type: 'state', state: { ...state, area: 6 } }); await tick();
  assert.equal((await (await app.get()).json()).players[0].area, 6);
  p.send({ type: 'state', state: { ...state, area: 7 } }); await tick();
  assert.equal((await (await app.get()).json()).players[0].area, null);
});

test('a listed network address sees the monitor without signing in; other addresses still need an account', async t => {
  const app = await setup(t, [], ['203.0.113.7']), p = await app.client();
  p.send({ type: 'state', state }); await tick();
  const home = await app.get({ Cookie: '', 'X-Test-IP': '203.0.113.7' });
  assert.equal(home.status, 200); assert.equal((await home.json()).players.length, 1);
  assert.equal((await app.get({ Cookie: '', 'X-Test-IP': '203.0.113.8' })).status, 503);
  assert.equal((await app.get({ Cookie: '', 'X-Test-IP': '203.0.113.7', Origin: 'https://elsewhere.invalid' })).status, 403);
  const both = await setup(t, [account], ['203.0.113.7']);
  assert.equal((await both.get({ Cookie: '', 'X-Test-IP': '198.51.100.1' })).status, 401);
  assert.equal((await both.get({ 'X-Test-IP': '198.51.100.1' })).status, 200);
});

test('observer sockets follow the monitor rule: listed address, allowed account session, or a ticket from the monitor', async t => {
  const app = await setup(t, [account], ['203.0.113.7']), p = await app.client();
  p.send({ type: 'state', state }); await tick();
  const room = p.welcome.room;
  const denied = async (options, why) => {
    const o = await app.observe(room, options);
    assert.deepEqual(o.first, { type: 'error', message: 'Monitor access required.' }, why);
    assert.equal(await o.closed, 1008, why);
  };
  await denied({}, 'no cookie, unlisted address');
  await denied({ headers: { Cookie: `cc_account=${account}.${'c'.repeat(64)}` } }, 'stale session');
  await denied({ ticket: `${Date.now() + 60000}.forged` }, 'forged ticket');
  const home = await app.observe(room, { headers: { 'X-Test-IP': '203.0.113.7' } });
  assert.equal(home.first.type, 'welcome'); assert.equal(home.first.observer, true); assert.equal(home.first.players[0].id, p.welcome.id);
  const developer = await app.observe(room, { headers: { Cookie: cookie } });
  assert.equal(developer.first.observer, true);
  // A browser's account cookie stays on /api/account, so the spectator page brings a ticket instead.
  const res = await app.ticket(), body = await res.json();
  assert.equal(res.status, 200); assert.match(res.headers.get('cache-control'), /no-store/); assert.ok(body.expires > Date.now());
  const page = await app.observe(room, { ticket: body.ticket });
  assert.equal(page.first.observer, true);
  // Observers are not players: the monitor still lists one, and the player is told about none of them.
  p.send({ type: 'action', action: 'jump' });
  assert.equal(JSON.parse(String((await once(page.ws, 'message'))[0])).action, 'jump');
  assert.deepEqual((await (await app.get()).json()).players.map(x => x.id), [p.welcome.id]);
  assert.equal(app.relay.rooms.get(room).size, 1);
});

test('the ticket endpoint answers exactly like the monitor; tickets expire and cannot be forged', async t => {
  const app = await setup(t);
  assert.equal((await app.ticket({ Cookie: '' })).status, 401);
  assert.equal((await app.ticket({ 'X-Crabcraft-Account': '' })).status, 403);
  assert.equal((await app.ticket({ Origin: 'https://elsewhere.invalid' })).status, 403);
  assert.equal((await (await setup(t, ['g' + 'd'.repeat(23)])).ticket()).status, 403);
  assert.equal((await (await setup(t, [])).ticket()).status, 503);
  let now = 1_800_000_000_000;
  const tickets = observeTickets(1000, Buffer.alloc(32, 7), () => now), other = observeTickets(1000, Buffer.alloc(32, 8), () => now);
  const { ticket } = tickets.issue();
  assert.equal(tickets.valid(ticket), true);
  assert.equal(other.valid(ticket), false);
  for (const bad of [null, 7, '', 'x'.repeat(200), ticket + '.x', ticket.replace(/^\d/, '9'), ticket.slice(0, -2)]) assert.equal(tickets.valid(bad), false, String(bad));
  now += 1001; assert.equal(tickets.valid(ticket), false);
});
