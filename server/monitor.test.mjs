import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import WebSocket from 'ws';
import { attachRooms } from './rooms.ts';
import { monitorHandler } from './node/monitor.ts';

const account = 'g' + 'a'.repeat(23), token = 'b'.repeat(64);
const cookie = `cc_account=${account}.${token}`;
const spec = { race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'Observer QA' };
const state = { x: 3, y: 4, z: 5, yaw: 1, hp: 80, maxHp: 100, alive: true, area: 1 };
async function setup(t, allowed = [account]) {
  let expires = Date.now() + 60000, fail = false;
  const db = { async query(_sql, [hash, username]) {
    if (fail) throw new Error('database unavailable');
    return { rows: hash === createHash('sha256').update(token).digest('hex') && username === account ? [{ expires: String(expires) }] : [] };
  } };
  const server = createServer((req, res) => void handler(req, res));
  const relay = attachRooms(server, { maxMembers: 64 });
  const handler = monitorHandler(db, new Set(allowed), relay.monitorSnapshot);
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
  return { base, relay, client, get, expire: () => { expires = 0; }, fail: () => { fail = true; } };
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
