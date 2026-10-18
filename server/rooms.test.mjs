import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import WebSocket from 'ws';
import { attachRooms } from './rooms.ts';
import {worldOf,eventOf} from './combatProtocol.ts';
import { Link, ROOM_RETRIES, backoff, restartDelay } from '../src/multiplayer/link.ts';

const spec = { race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'Test crab' };
const state = { x: 3, y: 0, z: 5, yaw: 1, hp: 80, maxHp: 100, alive: true };

async function setup(t, options) {
  const server = createServer();
  const relay = attachRooms(server, options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const clients = [];
  t.after(async () => { for (const c of clients) c.ws.terminate(); relay.close(); await new Promise(r => server.close(r)); });
  async function client(origin) {
    const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/multiplayer`, origin ? { origin } : {});
    const queue = [];
    ws.on('message', raw => queue.push(JSON.parse(raw.toString())));
    await once(ws, 'open');
    const c = { ws, queue, send: data => ws.send(JSON.stringify(data)), async next(type) {
      const until = Date.now() + 2000;
      while (Date.now() < until) {
        const idx = queue.findIndex(m => m.type === type);
        if (idx >= 0) return queue.splice(idx, 1)[0];
        await new Promise(r => setTimeout(r, 10));
      }
      throw new Error(`Timed out waiting for ${type}: ${JSON.stringify(queue)}`);
    } };
    clients.push(c); return c;
  }
  return { client, relay, server };
}

test('rooms synchronize appearance, state, action and chat; isolate other rooms; remove departed players', async t => {
  const { client, relay } = await setup(t);
  const a = await client(), b = await client(), other = await client();
  a.send({ type: 'create', spec });
  const room = await a.next('welcome');
  assert.match(room.room, /^[A-F0-9]{6}$/);
  a.send({ type: 'state', state });
  b.send({ type: 'join', room: room.room.toLowerCase(), spec: { ...spec, race: 'orc', name: 'Friend' } });
  const joined = await b.next('welcome');
  assert.equal(joined.players.length, 1);
  assert.deepEqual(joined.players[0].state, state);
  assert.equal((await a.next('joined')).spec.race, 'orc');
  other.send({ type: 'create', spec }); await other.next('welcome');
  b.send({ type: 'state', state: { ...state, x: 7 } });
  assert.equal((await a.next('state')).state.x, 7);
  b.send({ type: 'action', action: 'jump' });
  assert.equal((await a.next('action')).action, 'jump');
  b.send({ type: 'chat', text: '<img onerror=alert(1)> hello' });
  assert.equal((await a.next('chat')).text, '<img onerror=alert(1)> hello');
  assert.equal((await b.next('chat')).name, 'Friend');
  assert.equal(other.queue.some(m=>m.type !== 'authority'), false);
  b.ws.close();
  assert.equal((await a.next('left')).id, joined.id);
  assert.equal(relay.rooms.get(room.room).size, 1);
  a.send({ type: 'leave' }); await a.next('leftRoom');
  assert.equal(relay.rooms.has(room.room), false);
});

test('invalid joins, malformed states and unsupported actions do not corrupt a room', async t => {
  const { client, relay } = await setup(t);
  const a = await client(), b = await client();
  a.send({ type: 'join', room: '000000', spec }); assert.match((await a.next('error')).message, /not found/);
  a.send({ type: 'create', spec: { ...spec, race: 'oops' } }); assert.equal((await a.next('error')).message, 'Invalid character.');
  a.send({ type: 'create', spec }); const r = await a.next('welcome');
  b.send({ type: 'join', room: r.room, spec }); await b.next('welcome'); await a.next('joined');
  a.ws.send('{broken'); a.ws.send('null');
  a.send({ type: 'state', state: { ...state, x: null } });
  a.send({ type: 'state', state: { ...state, x: 9999999 } });
  a.send({ type: 'action', action: '__proto__' });
  a.send({ type: 'state', state });
  assert.deepEqual((await b.next('state')).state, state);
  assert.equal(b.queue.some(m => m.type === 'action'), false);
  assert.equal(relay.rooms.get(r.room).size, 2);
});

test('the breakdance reaches the rest of the room move by move, and its stop; other clips do not', async t => {
  const { client } = await setup(t);
  const a = await client(), b = await client();
  a.send({ type: 'create', spec }); const r = await a.next('welcome');
  b.send({ type: 'join', room: r.room, spec }); const br = await b.next('welcome'); await a.next('joined');
  const moves = ['break_toprock', 'break_sixstep', 'break_spin', 'break_jumpspin', 'break_backflip', 'break_oneclaw'];
  // The claw stand is recorded but not in the routine; a made-up move or the old start name is dropped.
  for (const action of ['break_clawstand', 'break_windmill', 'breakdance', ...moves, 'breakdance_stop']) b.send({ type: 'action', action });
  for (const action of [...moves, 'breakdance_stop']) assert.deepEqual(await a.next('action'), { type: 'action', id: br.id, action });
  b.send({ type: 'state', state }); await a.next('state');
  assert.equal(a.queue.some(m => m.type === 'action'), false);
  assert.equal(b.queue.some(m => m.type === 'action'), false);
});

test('room limit is eight; joining a full room preserves the previous room', async t => {
  const { client, relay } = await setup(t);
  const a = await client(); a.send({ type: 'create', spec }); const r = await a.next('welcome');
  for (let i = 0; i < 7; i++) { const c = await client(); c.send({ type: 'join', room: r.room, spec }); await c.next('welcome'); }
  const ninth = await client(); ninth.send({ type: 'create', spec }); const own = await ninth.next('welcome');
  ninth.send({ type: 'join', room: r.room, spec }); assert.match((await ninth.next('error')).message, /full/);
  assert.equal(relay.rooms.get(r.room).size, 8);
  assert.equal(relay.rooms.get(own.room).size, 1);
});

test('late join and reconnect get the current player state', async t => {
  const { client } = await setup(t);
  const a = await client(); a.send({ type: 'create', spec }); const r = await a.next('welcome');
  a.send({ type: 'state', state });
  const b = await client(); b.send({ type: 'join', room: r.room, spec }); const old = await b.next('welcome');
  await a.next('joined'); b.ws.close(); await a.next('left');
  const c = await client(); c.send({ type: 'join', room: r.room, spec }); const fresh = await c.next('welcome');
  assert.notEqual(old.id, fresh.id); assert.deepEqual(fresh.players[0].state, state);
});

test('foreign browser origins are rejected', async t => {
  const { server } = await setup(t);
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/multiplayer`, { origin: 'https://unrelated.invalid' });
  ws.on('error', () => {});
  const code = await new Promise(resolve => ws.on('close', resolve)); assert.equal(code, 1006);
});

const world = { weather:{mood:1,beacon:true,clock:123}, entities: [{ id:'e0',...state,level:1,hidden:false,invulnerable:false,targetable:true,stun:0,slow:0,slowPct:0,rust:0,rustFor:0,enemyState:'idle',xp:20 }],
  bosses:[{id:'b3',state:'dormant',phase:1,enraged:false,mech:null},{id:'b10',state:'dormant',phase:1,enraged:false,mech:null},{id:'b20',state:'dormant',phase:1,enraged:false,mech:null}],rust:false,abyss:false,chapter:1,firstEnding:false,trueCleared:false };

test('combat uses one host, routes guest attacks only to host, checkpoints late joins and transfers authority', async t => {
  const {client}=await setup(t);
  const a=await client(),b=await client(),c=await client(),isolated=await client();
  a.send({type:'create',spec,combatVersion:1}); const r=await a.next('welcome');assert.equal(r.host,r.id);
  b.send({type:'join',room:r.room,spec,combatVersion:1});const br=await b.next('welcome');assert.equal(br.host,r.id);
  a.send({type:'world',world});assert.deepEqual((await b.next('world')).world,world);
  isolated.send({type:'create',spec,combatVersion:1});await isolated.next('welcome');
  b.send({type:'combat',event:{kind:'attack',target:'e0',amount:23,source:'forged'}});
  const attack=await a.next('combat');assert.equal(attack.id,br.id);assert.equal(attack.event.amount,23);assert.equal(attack.event.source,undefined);
  b.send({type:'world',world:{...world,rust:true}}); // A guest cannot publish health or wins.
  b.send({type:'combat',event:{kind:'death',target:'e0'}});
  a.send({type:'combat',event:{kind:'hit',target:'e0',amount:23}});assert.equal((await b.next('combat')).event.kind,'hit');
  c.send({type:'join',room:r.room,spec,combatVersion:1});const cr=await c.next('welcome');assert.deepEqual(cr.world,world);
  assert.equal(cr.world.rust,false);
  a.ws.close();await b.next('left');
  let elected; do {elected=await b.next('authority');} while(elected.host!==br.id);
  b.send({type:'world',world:{...world,rust:true}});assert.equal((await c.next('world')).world.rust,true);
  assert.equal(isolated.queue.some(m=>['world','combat'].includes(m.type)),false);
});

test('malformed combat checkpoints and impossible packets are rejected', async t => {
  const {client}=await setup(t);const a=await client(),b=await client();
  a.send({type:'create',spec,combatVersion:1});const r=await a.next('welcome');
  b.send({type:'join',room:r.room,spec,combatVersion:1});await b.next('welcome');
  a.send({type:'world',world:{...world,entities:[{...world.entities[0],hp:null}]}});
  a.send({type:'world',world:{...world,bosses:[world.bosses[0],world.bosses[0]]}});
  b.send({type:'combat',event:{kind:'attack',target:'e0',amount:Infinity}});
  b.send({type:'combat',event:{kind:'attack',target:'e0',amount:Number.MAX_SAFE_INTEGER+1}});
  b.send({type:'combat',event:{kind:'condition',target:'e0',condition:{stun:999}}});
  a.send({type:'world',world});assert.deepEqual((await b.next('world')).world,world);
  assert.equal(a.queue.some(m=>m.type==='combat'),false);assert.equal(b.queue.some(m=>m.type==='world'),false);
});


test('optional boss cinematic timelines preserve legacy checkpoints and reject malformed values',()=>{
 assert.ok(worldOf(world));
 const timeline={state:7.5,freed:5.3,freedYaw:1.2,released:true};
 const checkpoint={...world,bosses:world.bosses.map(b=>({...b,timeline}))};
 assert.deepEqual(worldOf(checkpoint),checkpoint);
 for(const invalid of [null,{}, {...timeline,state:-1},{...timeline,state:61},{...timeline,freed:-2},{...timeline,freed:14},{...timeline,freedYaw:Infinity},{...timeline,released:'yes'}])
  assert.equal(worldOf({...world,bosses:world.bosses.map(b=>({...b,timeline:invalid}))}),null);
});


test('World III requires a complete four-boss checkpoint and accepts level30 challenges',()=>{
 const third={...world,chapter:3,finalCleared:false,bosses:[...world.bosses,{id:'b30',state:'fight',phase:2,enraged:false,mech:{id:5,kind:'barrage',at:[0,17,-72],yaw:0,left:2.6}}]};
 assert.ok(worldOf(third));assert.equal(worldOf({...world,chapter:3}),null);assert.equal(worldOf({...world,finalCleared:true}),null);
 assert.equal(worldOf({...third,bosses:third.bosses.filter(b=>b.id!=='b10')}),null);
});

test('boat controls route to host and two-seat checkpoints survive late joins',async t=>{
 const {client}=await setup(t);const a=await client(),b=await client(),c=await client();
 a.send({type:'create',spec,combatVersion:1});const ar=await a.next('welcome');b.send({type:'join',room:ar.room,spec,combatVersion:1});const br=await b.next('welcome');
 const boat={x:155,z:19,yaw:1.5,speed:3,seats:[ar.id,br.id]},checkpoint={...world,boat};
 a.send({type:'world',world:checkpoint});assert.deepEqual((await b.next('world')).world.boat,boat);
 b.send({type:'combat',event:{kind:'boat',target:'world',boat:{action:'drive',throttle:1,steer:-1},seats:['forged']}});const input=await a.next('combat');assert.equal(input.id,br.id);assert.deepEqual(input.event,{kind:'boat',target:'world',boat:{action:'drive',throttle:1,steer:-1}});
 c.send({type:'join',room:ar.room,spec,combatVersion:1});assert.deepEqual((await c.next('welcome')).world.boat,boat);
 b.send({type:'combat',event:{kind:'boat',target:'world',boat:{action:'drive',throttle:9,steer:0}}});
 a.send({type:'world',world});await b.next('world');assert.equal(a.queue.some(p=>p.type==='combat'),false);
 assert.equal(worldOf({...checkpoint,boat:{...boat,seats:[ar.id,ar.id]}}),null);assert.equal(worldOf({...checkpoint,boat:{...boat,seats:[ar.id,br.id,'third']}}),null);assert.equal(worldOf({...checkpoint,boat:{...boat,x:NaN}}),null);
});

test('boat shore exits are validated and authenticated empty-boat calls route to host',async t=>{
 const {client}=await setup(t);const a=await client(),b=await client();a.send({type:'create',spec,combatVersion:1});const ar=await a.next('welcome');b.send({type:'join',room:ar.room,spec,combatVersion:1});const br=await b.next('welcome');
 const boat={x:207,z:-22,yaw:1.5,speed:0,seats:[ar.id,null],exits:{[br.id]:{x:216,z:-22,shore:true}}};a.send({type:'world',world:{...world,boat}});assert.deepEqual((await b.next('world')).world.boat,boat);
 b.send({type:'combat',event:{kind:'boat',target:'world',boat:{action:'call',throttle:0,steer:0}}});assert.equal((await a.next('combat')).id,br.id);
 assert.equal(worldOf({...world,boat:{...boat,exits:{bad:{x:Infinity,z:0,shore:true}}}}),null);assert.equal(worldOf({...world,boat:{...boat,exits:{bad:{x:1,z:0,shore:'yes'}}}}),null);
});

test('village games authenticate guest initiator, isolate commands and checkpoint spectators',async t=>{
 const {client}=await setup(t),a=await client(),b=await client(),c=await client(),other=await client();
 a.send({type:'create',spec,combatVersion:1});const ar=await a.next('welcome');
 b.send({type:'join',room:ar.room,spec,combatVersion:1});const br=await b.next('welcome');
 other.send({type:'create',spec,combatVersion:1});await other.next('welcome');
 b.send({type:'combat',event:{kind:'village',target:'world',village:'hide',source:ar.id,seeker:ar.id}});
 const request=await a.next('combat');assert.equal(request.id,br.id);assert.deepEqual(request.event,{kind:'village',target:'world',village:'hide'});
 const village={id:'round-1',mode:'hide',phase:'ready',left:15,starter:br.id,seeker:br.id,members:[ar.id,br.id],caught:[],result:''};
 a.send({type:'world',world:{...world,village}});assert.deepEqual((await b.next('world')).world.village,village);
 b.send({type:'world',world:{...world,village:{...village,seeker:ar.id}}});
 b.send({type:'combat',event:{kind:'village',target:'world',village:'win'}});
 c.send({type:'join',room:ar.room,spec,combatVersion:1});assert.deepEqual((await c.next('welcome')).world.village,village);
 assert.equal(a.queue.some(x=>x.type==='combat'),false);assert.equal(other.queue.some(x=>['world','combat'].includes(x.type)),false);
});

test('village checkpoints reject invalid members, duplicate catches and unbounded clocks',()=>{
 const village={id:'round-1',mode:'tag',phase:'play',left:90,starter:'solo',seeker:'npc0',members:['solo'],caught:[],result:''};
 assert.ok(worldOf({...world,village}));assert.ok(worldOf({...world,village:null}));
 for(const patch of [{left:Infinity},{left:181},{members:['solo','solo']},{members:Array(9).fill('solo')},{members:[]},{starter:'stranger'},{seeker:'stranger'},{caught:['stranger']},{caught:['solo','solo']},{phase:'invented'},{mode:'pvp'}])assert.equal(worldOf({...world,village:{...village,...patch}}),null);
 assert.equal(worldOf({...world,village:{...village,seeker:'solo',caught:['solo']}}),null);
});

const until = async (check, what) => {
  const end = Date.now() + 2000;
  while (!check()) { if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`); await new Promise(r => setTimeout(r, 10)); }
};

test('entering the world joins a public shard of the same area without a code; shards relay presence but no combat', async t => {
  const { client, relay } = await setup(t);
  const a = await client(), b = await client(), far = await client();
  a.send({ type: 'enter', area: 1, spec, combatVersion: 1 });
  const ar = await a.next('welcome');
  assert.match(ar.room, /^W1[A-F0-9]{4}$/);
  assert.deepEqual([ar.public, ar.area, ar.host, ar.world, ar.players], [true, 1, '', null, []]);
  a.send({ type: 'state', state });
  b.send({ type: 'enter', area: 1, spec: { ...spec, name: 'Stranger' } });
  const br = await b.next('welcome');
  assert.equal(br.room, ar.room);
  assert.deepEqual(br.players.map(p => [p.id, p.state]), [[ar.id, state]]);
  assert.equal((await a.next('joined')).spec.name, 'Stranger');
  far.send({ type: 'enter', area: 2, spec });
  const fr = await far.next('welcome');
  assert.match(fr.room, /^W2[A-F0-9]{4}$/); assert.equal(fr.area, 2);
  b.send({ type: 'state', state: { ...state, x: 9 } });
  assert.equal((await a.next('state')).state.x, 9);
  b.send({ type: 'action', action: 'dance_crab' });
  assert.equal((await a.next('action')).action, 'dance_crab');
  b.send({ type: 'chat', text: 'hello, world one' });
  assert.equal((await a.next('chat')).text, 'hello, world one');
  // Nobody in a shard is a combat authority: checkpoints and combat events go nowhere.
  a.send({ type: 'world', world });
  b.send({ type: 'combat', event: { kind: 'attack', target: 'e0', amount: 5 } });
  a.send({ type: 'combat', event: { kind: 'hit', target: br.id, amount: 5 } });
  b.send({ type: 'state', state }); await a.next('state');
  a.send({ type: 'state', state }); await b.next('state');
  for (const c of [a, b]) assert.equal(c.queue.some(m => ['world', 'combat', 'authority'].includes(m.type)), false);
  assert.equal(far.queue.some(m => ['joined', 'state', 'action', 'chat'].includes(m.type)), false);
  // A shard cannot be joined by its code, and a bad area falls back to World I.
  far.send({ type: 'join', room: ar.room, spec }); assert.match((await far.next('error')).message, /not found/);
  const odd = await client(); odd.send({ type: 'enter', area: 'sky', spec }); assert.equal((await odd.next('welcome')).room, ar.room);
  odd.send({ type: 'enter', area: 1, spec: { ...spec, race: 'oops' } }); assert.equal((await odd.next('error')).message, 'Invalid character.');
  // Travelling to another area moves the player to that area's shard on the same socket.
  a.send({ type: 'enter', area: 2, spec });
  const moved = await a.next('welcome');
  assert.equal(moved.room, fr.room); assert.equal(moved.id, ar.id);
  assert.equal((await b.next('left')).id, ar.id);
  assert.equal((await far.next('joined')).id, ar.id);
  assert.deepEqual([...relay.publics].sort(), [[ar.room, 1], [fr.room, 2]].sort());
});

test('public shards fill the least-full shard first, open a new one only when all are full, and hold eight', async t => {
  const { client, relay } = await setup(t);
  const enter = async () => { const c = await client(); c.send({ type: 'enter', area: 1, spec }); c.welcome = await c.next('welcome'); return c; };
  const first = [];
  for (let i = 0; i < 8; i++) first.push(await enter());
  const one = first[0].welcome.room;
  assert.ok(first.every(c => c.welcome.room === one));
  assert.equal(relay.rooms.get(one).size, 8);
  const ninth = await enter(), tenth = await enter();
  const two = ninth.welcome.room;
  assert.notEqual(two, one); assert.equal(tenth.welcome.room, two);
  assert.deepEqual(ninth.welcome.players, []);
  // Another area never shares these shards, however empty they are.
  const elsewhere = await client(); elsewhere.send({ type: 'enter', area: 3, spec });
  assert.match((await elsewhere.next('welcome')).room, /^W3/);
  for (const c of first.slice(1)) c.ws.close();
  await until(() => relay.rooms.get(one)?.size === 1, 'the first shard to empty out');
  // One player in the first shard, two in the second: the next goes to the first; a tie goes to the older shard.
  const order = [];
  for (let i = 0; i < 4; i++) order.push((await enter()).welcome.room);
  assert.deepEqual(order, [one, one, two, one]);
  assert.deepEqual([relay.rooms.get(one).size, relay.rooms.get(two).size], [4, 3]);
});

test('an empty public shard is dropped at once while private rooms keep their checkpoint', async t => {
  const { client, relay } = await setup(t, { keepRooms: 60000 });
  const a = await client(), b = await client(), host = await client();
  a.send({ type: 'enter', area: 2, spec }); const shard = (await a.next('welcome')).room;
  b.send({ type: 'enter', area: 2, spec }); assert.equal((await b.next('welcome')).room, shard);
  host.send({ type: 'create', spec, combatVersion: 1 }); const room = (await host.next('welcome')).room;
  host.send({ type: 'world', world });
  a.ws.close();
  await until(() => relay.rooms.get(shard)?.size === 1, 'one player left in the shard');
  assert.equal(relay.publics.get(shard), 2);
  b.send({ type: 'leave' }); await b.next('leftRoom');
  assert.equal(relay.rooms.has(shard), false); assert.equal(relay.publics.has(shard), false);
  host.ws.close();
  await until(() => relay.rooms.get(room)?.size === 0, 'the private room to empty out');
  const back = await client(); back.send({ type: 'join', room, spec, combatVersion: 1 });
  const rejoined = await back.next('welcome');
  assert.equal(rejoined.room, room); assert.deepEqual(rejoined.world, world);
  const later = await client(); later.send({ type: 'enter', area: 2, spec });
  const fresh = await later.next('welcome');
  assert.notEqual(fresh.room, shard); assert.deepEqual(fresh.players, []);
});

test('private code rooms work as before next to public shards', async t => {
  const { client, relay } = await setup(t, { maxRooms: 3 });
  const a = await client(), b = await client(), c = await client();
  for (const x of [a, b, c]) x.send({ type: 'enter', area: 1, spec });
  const shard = (await a.next('welcome')).room;
  await b.next('welcome'); await c.next('welcome');
  a.send({ type: 'create', spec, combatVersion: 1 });
  const room = await a.next('welcome');
  assert.match(room.room, /^[A-F0-9]{6}$/);
  assert.equal(room.public, undefined); assert.equal(room.host, room.id);
  assert.equal((await b.next('left')).id, room.id);
  b.send({ type: 'join', room: room.room.toLowerCase(), spec, combatVersion: 1 });
  const joined = await b.next('welcome');
  assert.equal(joined.host, room.id); assert.deepEqual(joined.players.map(p => p.id), [room.id]);
  a.send({ type: 'world', world }); assert.deepEqual((await b.next('world')).world, world);
  b.send({ type: 'combat', event: { kind: 'attack', target: 'e0', amount: 7 } }); assert.equal((await a.next('combat')).event.amount, 7);
  assert.equal(c.queue.some(m => ['world', 'combat', 'joined'].includes(m.type)), false);
  assert.equal(relay.rooms.get(shard).size, 1);
  // Shards count toward the room limit; a full server refuses a new room but leaves the shard alone.
  const d = await client(), e = await client();
  d.send({ type: 'create', spec, combatVersion: 1 }); await d.next('welcome');
  e.send({ type: 'create', spec, combatVersion: 1 }); assert.match((await e.next('error')).message, /Server full/);
  e.send({ type: 'enter', area: 1, spec }); assert.equal((await e.next('welcome')).room, shard);
  // Leaving a private room for the world puts the player back in a shard.
  b.send({ type: 'enter', area: 1, spec }); assert.equal((await b.next('welcome')).room, shard);
  assert.equal((await a.next('left')).id, joined.id);
});

// The browser's socket handling (src/multiplayer/link.ts) against the real relay, with Node's WebSocket.
const eventually = async (check, what, ms = 8000) => {
  const end = Date.now() + ms;
  while (!check()) { if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`); await new Promise(r => setTimeout(r, 20)); }
};
async function relayAt(port = 0, options = {}) {
  const server = createServer(), relay = attachRooms(server, options);
  server.listen(port, '127.0.0.1'); await once(server, 'listening');
  const stop = async () => { relay.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); };
  return { server, relay, port: server.address().port, stop };
}
/** A crab in the world as the game connects it; `random: () => 0` takes the shortest delay of each step. */
function crab(t, port, name) {
  const seen = { welcomes: [], lost: [], back: [] };
  const link = new Link(() => `ws://127.0.0.1:${port}/multiplayer`, {
    hello: (mode, room) => mode === 'enter' ? { type: 'enter', area: 2, spec: { ...spec, name } } : { type: mode, room, spec: { ...spec, name }, combatVersion: 1 },
    message: msg => { if (msg.type === 'welcome') seen.welcomes.push(msg); },
    lost: info => seen.lost.push(info),
    back: info => seen.back.push(info),
  }, { random: () => 0 });
  t.after(() => link.dispose());
  return { link, seen, welcomed: n => eventually(() => seen.welcomes.length >= n && link.open, `${name}'s welcome #${n}`) };
}

test('reconnect delays: about 1, 2, 4, 8, 16 s, then every 30 s with jitter; 0.5 to 3 s after a restart notice', async () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 20].map(a => backoff(a, () => 0.5)), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  assert.deepEqual([backoff(0, () => 0), backoff(0, () => 1), backoff(9, () => 0), backoff(9, () => 1)], [750, 1250, 22500, 37500]);
  assert.deepEqual([restartDelay(() => 0), restartDelay(() => 1)], [500, 3000]);
});

test('relay.restart tells every socket the server is restarting before closing it', async t => {
  const { client, relay, server } = await setup(t);
  const a = await client(), b = await client();
  a.send({ type: 'enter', area: 1, spec }); await a.next('welcome');
  b.send({ type: 'create', spec, combatVersion: 1 }); await b.next('welcome');
  const closed = [a, b].map(c => once(c.ws, 'close'));
  await relay.restart();
  for (const c of [a, b]) assert.ok(c.queue.some(m => m.type === 'restarting'));
  assert.deepEqual((await Promise.all(closed)).map(([code]) => code), [1012, 1012]);
  // Nobody new gets in while it stops.
  const late = new WebSocket(`ws://127.0.0.1:${server.address().port}/multiplayer`);
  late.on('error', () => {});
  assert.equal((await once(late, 'unexpected-response'))[1].statusCode, 503);
  late.terminate();
});

test('a public-shard crab comes back by itself when the server drops every socket, and after a full restart', async t => {
  let relay = await relayAt();
  const port = relay.port;
  t.after(() => relay.stop());
  const a = crab(t, port, 'Ada'), b = crab(t, port, 'Bo');
  a.link.connect('enter'); await a.welcomed(1);
  b.link.connect('enter'); await b.welcomed(1);
  const shard = a.seen.welcomes[0].room;
  assert.match(shard, /^W2/); assert.equal(b.seen.welcomes[0].room, shard);
  // Every socket drops without a word (a network blip, a proxy reload): both back in a shard within a second or so.
  for (const room of relay.relay.rooms.values()) for (const m of room.values()) m.ws.terminate();
  await a.welcomed(2); await b.welcomed(2);
  for (const c of [a, b]) assert.deepEqual(c.seen.lost.map(l => [l.mode, l.attempt, l.delay]), [['enter', 1, 750]]);
  assert.equal(a.seen.welcomes[1].public, true);
  assert.equal(relay.relay.rooms.get(a.seen.welcomes[1].room).size, 2);
  // A deploy: SIGTERM's restart notice, then the process is gone for a moment and a new one listens on the same port.
  const stopped = Date.now();
  await relay.relay.restart();
  await relay.stop();
  await eventually(() => a.seen.lost.length >= 3 && b.seen.lost.length >= 3, 'tries against the stopped server');
  relay = await relayAt(port);
  await a.welcomed(3); await b.welcomed(3);
  const gap = Date.now() - stopped;
  for (const c of [a, b]) {
    // The first try waits the restart delay, the rest back off; nothing gives up.
    assert.equal(c.seen.lost[1].delay, 500);
    assert.ok(c.seen.lost.slice(2).every((l, i) => l.mode === 'enter' && l.delay === backoff(i, () => 0)), JSON.stringify(c.seen.lost));
    assert.equal(c.seen.back.at(-1).restart, true);
    assert.ok(c.seen.back.at(-1).gap > 1000);
  }
  assert.ok(gap < 10000, `back in ${gap} ms`);
  assert.equal(a.seen.welcomes[2].room, b.seen.welcomes[2].room);
  assert.equal(relay.relay.rooms.get(a.seen.welcomes[2].room).size, 2);
  // Whoever is back second finds the other already there.
  const [first, second] = a.seen.welcomes[2].players.length ? [b, a] : [a, b];
  assert.deepEqual(first.seen.welcomes[2].players, []);
  assert.deepEqual(second.seen.welcomes[2].players.map(p => p.spec.name), [first === a ? 'Ada' : 'Bo']);
});

test('a code room retries five times as before, then gives up so the game can return to the public world', async t => {
  const relay = await relayAt(0, { keepRooms: 60000 });
  t.after(() => relay.stop());
  const a = crab(t, relay.port, 'Host');
  a.link.connect('create'); await a.welcomed(1);
  const room = a.seen.welcomes[0].room;
  assert.match(room, /^[A-F0-9]{6}$/);
  assert.deepEqual([a.link.mode, a.link.room], ['join', room]);
  // A socket that drops while the room is still there comes back to the same room.
  for (const m of relay.relay.rooms.get(room).values()) m.ws.terminate();
  await a.welcomed(2);
  assert.equal(a.seen.welcomes[1].room, room);
  await relay.stop();
  await eventually(() => a.seen.lost.at(-1)?.delay === null, 'the room to give up', 15000);
  assert.deepEqual(a.seen.lost.slice(1).map(l => [l.mode, l.attempt, l.delay]), [1, 2, 3, 4, 5, 6].map(n => ['join', n, n <= ROOM_RETRIES ? 1500 : null]));
  assert.equal(a.link.retry, null);
  // A room that was never reached gives up at once, as before.
  const never = crab(t, relay.port, 'Late');
  never.link.connect('join', 'ABCDEF');
  await eventually(() => never.seen.lost.length === 1, 'the failed join');
  assert.deepEqual([never.seen.lost[0].delay, never.seen.lost[0].welcomed], [null, false]);
});

test('relayed chat is masked before anyone sees it, and a name with a bad word or contact details is replaced', async t => {
  const { client } = await setup(t);
  const a = await client(), b = await client(), c = await client();
  a.send({ type: 'enter', area: 3, spec }); const ar = await a.next('welcome');
  assert.equal(ar.renamed, undefined);
  b.send({ type: 'enter', area: 3, spec: { ...spec, name: '시발크랩' } });
  const br = await b.next('welcome');
  assert.equal(br.renamed, '게 모험가');
  assert.equal((await a.next('joined')).spec.name, '게 모험가');
  c.send({ type: 'enter', area: 3, spec: { ...spec, name: 'kakao kid_99' } });
  assert.deepEqual((await c.next('welcome')).players.map(p => p.spec.name).sort(), ['Test crab', '게 모험가']);
  assert.equal((await a.next('joined')).spec.name, '게 모험가 #2');
  b.send({ type: 'chat', text: '시발 내 번호 010-1234-5678 이야' });
  const line = await a.next('chat');
  assert.deepEqual([line.id, line.name, line.text], [br.id, '게 모험가', '** 내 번호 ************* 이야']);
  assert.equal((await b.next('chat')).text, '** 내 번호 ************* 이야');
  assert.equal((await c.next('chat')).text, '** 내 번호 ************* 이야');
  await new Promise(r => setTimeout(r, 700));
  b.send({ type: 'chat', text: '카톡 아이디 abc123 naver.com' });
  assert.equal((await c.next('chat')).text, '** *** ****** *********');
});

test('a line too soon, or the same line again, is dropped and the sender is told why', async t => {
  const { client } = await setup(t);
  const a = await client(), b = await client();
  a.send({ type: 'create', spec }); const r = await a.next('welcome');
  b.send({ type: 'join', room: r.room, spec }); await b.next('welcome'); await a.next('joined');
  b.send({ type: 'chat', text: 'hello' });
  assert.equal((await a.next('chat')).text, 'hello');
  b.send({ type: 'chat', text: 'hello again' });
  assert.deepEqual(await b.next('chatRefused'), { type: 'chatRefused', reason: 'fast' });
  await new Promise(r => setTimeout(r, 720));
  b.send({ type: 'chat', text: 'hello' });
  assert.deepEqual(await b.next('chatRefused'), { type: 'chatRefused', reason: 'repeat' });
  b.send({ type: 'chat', text: 'something new' });
  assert.equal((await a.next('chat')).text, 'something new');
  assert.equal(a.queue.some(m => m.type === 'chat' || m.type === 'chatRefused'), false);
});

test('reports keep the target\'s last lines; three reporters mute them, and a muted player only hears themselves', async t => {
  const reports = [];
  const { client, relay } = await setup(t, { report: r => { reports.push(r); } });
  const target = await client(), ones = [await client(), await client(), await client()], away = await client();
  const sid = i => `session-${i}-${'x'.repeat(12)}`;
  target.send({ type: 'enter', area: 2, spec: { ...spec, name: 'Rude crab' }, session: sid('t') }); const tr = await target.next('welcome');
  const ids = [];
  for (const [i, c] of ones.entries()) { c.send({ type: 'enter', area: 2, spec: { ...spec, name: `Kid ${i}` }, session: sid(i) }); ids.push((await c.next('welcome')).id); }
  away.send({ type: 'enter', area: 3, spec, session: sid('away') }); await away.next('welcome');
  target.send({ type: 'chat', text: '너 학교 어디야?' });
  for (const c of [target, ...ones]) assert.equal((await c.next('chat')).text, '너 학교 어디야?');
  // A bad reason, an unknown id, oneself, and someone never met are refused.
  ones[0].send({ type: 'report', id: tr.id, reason: '욕설' });
  assert.deepEqual(await ones[0].next('reported'), { type: 'reported', id: tr.id, ok: false });
  ones[0].send({ type: 'report', id: 'nobody', reason: 'other' }); assert.equal((await ones[0].next('reported')).ok, false);
  ones[0].send({ type: 'report', id: ids[0], reason: 'other' }); assert.equal((await ones[0].next('reported')).ok, false);
  away.send({ type: 'report', id: tr.id, reason: 'other' }); assert.equal((await away.next('reported')).ok, false);
  ones[0].send({ type: 'report', id: tr.id, reason: 'personal' });
  assert.deepEqual(await ones[0].next('reported'), { type: 'reported', id: tr.id, ok: true });
  ones[0].send({ type: 'report', id: tr.id, reason: 'abuse' }); assert.equal((await ones[0].next('reported')).ok, false);
  ones[1].send({ type: 'report', id: tr.id, reason: 'harassment' }); assert.equal((await ones[1].next('reported')).ok, true);
  assert.equal(relay.moderation.muted(sid('t'), Date.now()), false);
  await new Promise(r => setTimeout(r, 720));
  target.send({ type: 'chat', text: 'still here' });
  for (const c of [target, ...ones]) assert.equal((await c.next('chat')).text, 'still here');
  ones[2].send({ type: 'report', id: tr.id, reason: 'other' }); assert.equal((await ones[2].next('reported')).ok, true);
  await until(() => reports.length === 3, 'three stored reports');
  assert.deepEqual(reports.map(r => [r.reason, r.muted, r.reporter.name, r.target.name, r.room]), [
    ['personal', false, 'Kid 0', 'Rude crab', tr.room], ['harassment', false, 'Kid 1', 'Rude crab', tr.room], ['other', true, 'Kid 2', 'Rude crab', tr.room]]);
  assert.deepEqual(reports[0].target.lines.map(l => l.text), ['너 학교 어디야?']);
  assert.deepEqual(reports[2].target.lines.map(l => l.text), ['너 학교 어디야?', 'still here']);
  assert.deepEqual([reports[0].reporter.session, reports[0].target.session], [sid(0), sid('t')]);
  assert.equal(JSON.stringify(reports).includes('127.0.0.1'), false);
  // Muted: the line comes back to its sender as usual and reaches nobody else.
  await new Promise(r => setTimeout(r, 720));
  target.send({ type: 'chat', text: 'can you hear me' });
  assert.deepEqual(await target.next('chat'), { type: 'chat', id: tr.id, name: 'Rude crab', text: 'can you hear me' });
  ones[0].send({ type: 'chat', text: 'bye' });
  assert.equal((await target.next('chat')).text, 'bye');
  for (const c of ones) { assert.equal((await c.next('chat')).text, 'bye'); assert.equal(c.queue.some(m => m.type === 'chat'), false); }
  // The mute follows the player's session to a new socket; a player who left can still be reported for a while.
  target.ws.close(); await ones[0].next('left');
  const back = await client(); back.send({ type: 'enter', area: 2, spec: { ...spec, name: 'Rude crab' }, session: sid('t') }); const bk = await back.next('welcome');
  assert.equal(bk.room, tr.room); await ones[0].next('joined');
  back.send({ type: 'chat', text: 'hello?' });
  assert.equal((await back.next('chat')).text, 'hello?');
  await new Promise(r => setTimeout(r, 100));
  for (const c of ones) assert.equal(c.queue.some(m => m.type === 'chat'), false);
  ones[1].ws.close(); await ones[0].next('left');
  ones[0].send({ type: 'report', id: ids[1], reason: 'other' }); assert.equal((await ones[0].next('reported')).ok, true);
  await until(() => reports.length === 4, 'a report on a player who left');
  assert.deepEqual(reports[3].target.name, 'Kid 1');
});


test('Frostlight validates five bosses, b300/f300 keys and chapter4 while retaining legacy checkpoints',()=>{
 const fourth={...world,chapter:4,finalCleared:true,frostCleared:false,bosses:[...world.bosses,...['b30','b300'].map(id=>({id,state:'dormant',phase:1,enraged:false,mech:null}))]};
 assert.ok(worldOf(world));assert.ok(worldOf(fourth));assert.equal(worldOf({...fourth,bosses:fourth.bosses.filter(b=>b.id!=='b300')}),null);
 assert.equal(worldOf({...fourth,frostCleared:'yes'}),null);assert.equal(worldOf({...fourth,chapter:7}),null);
 assert.deepEqual(eventOf({kind:'chapter',target:'world',chapter:4},false),{kind:'chapter',target:'world',chapter:4});
 assert.ok(eventOf({kind:'challenge',target:'b300'},false));assert.ok(eventOf({kind:'attack',target:'b300',amount:100},false));assert.ok(eventOf({kind:'animation',target:'f300',action:'walk'},true));
});

test('snow-capable rooms cannot mix old screens, including empty retained rooms; old rooms still work',async t=>{
 const {client}=await setup(t,{keepRooms:60000});const a=await client(),b=await client(),c=await client();
 a.send({type:'create',spec,combatVersion:1,snowWorld:true});const r=await a.next('welcome');
 b.send({type:'join',room:r.room,spec,combatVersion:1});assert.match((await b.next('error')).message,/refresh/);
 a.send({type:'leave'});await a.next('leftRoom');
 b.send({type:'join',room:r.room,spec,combatVersion:1});assert.match((await b.next('error')).message,/refresh/);
 c.send({type:'join',room:r.room,spec,combatVersion:1,snowWorld:true});await c.next('welcome');
 a.send({type:'create',spec,combatVersion:1});const old=await a.next('welcome');
 b.send({type:'join',room:old.room,spec,combatVersion:1});await b.next('welcome');
 c.send({type:'join',room:old.room,spec,combatVersion:1,snowWorld:true});assert.match((await c.next('error')).message,/refresh/);
 b.send({type:'combat',event:{kind:'challenge',target:'b300'}});b.send({type:'combat',event:{kind:'attack',target:'e0',amount:20}});assert.equal((await a.next('combat')).event.target,'e0');
});


test('opt-in public worlds relay combat, lighthouse and boat checkpoints and elect a successor',async t=>{
 const {client}=await setup(t);const a=await client(),b=await client(),legacy=await client(),far=await client();
 const enter=area=>({type:'enter',area,spec,combatVersion:1,snowWorld:true,sharedWorld:1});
 a.send(enter(1));const ar=await a.next('welcome');assert.equal(ar.sharedWorld,1);assert.equal(ar.host,ar.id);
 b.send(enter(1));const br=await b.next('welcome');assert.equal(br.room,ar.room);assert.equal(br.host,ar.id);
 legacy.send({type:'enter',area:1,spec});assert.notEqual((await legacy.next('welcome')).room,ar.room);
 far.send(enter(2));assert.notEqual((await far.next('welcome')).room,ar.room);
 const checkpoint={...world,weather:{mood:1,beacon:true,clock:7},boat:{x:171,z:22,yaw:1,speed:3,seats:[ar.id,br.id]}};
 a.send({type:'world',world:checkpoint});assert.deepEqual((await b.next('world')).world,checkpoint);
 b.send({type:'combat',event:{kind:'attack',target:'e0',amount:23}});assert.equal((await a.next('combat')).event.amount,23);
 b.send({type:'combat',event:{kind:'environment',target:'world',environment:{beacon:false,mood:3}}});assert.equal((await a.next('combat')).event.environment.beacon,false);
 b.send({type:'combat',event:{kind:'boat',target:'world',boat:{action:'drive',throttle:1,steer:-1}}});assert.equal((await a.next('combat')).event.boat.throttle,1);
 const c=await client();c.send(enter(1));assert.deepEqual((await c.next('welcome')).world,checkpoint);
 a.ws.close();await b.next('left');let next;do{next=await b.next('authority');}while(next.host===ar.id);assert.equal(next.host,br.id);
 b.send({type:'world',world:checkpoint});assert.deepEqual((await c.next('world')).world,checkpoint);
 assert.equal(legacy.queue.some(m=>['world','combat'].includes(m.type)),false);assert.equal(far.queue.some(m=>['world','combat'].includes(m.type)),false);
});
test('shared public worlds reject guest checkpoints, cross-area travel and room-only commands',async t=>{
 const {client}=await setup(t);const a=await client(),b=await client();const enter={type:'enter',area:1,spec,combatVersion:1,snowWorld:true,sharedWorld:1};
 a.send(enter);await a.next('welcome');b.send(enter);await b.next('welcome');
 a.send({type:'world',world:{...world,chapter:2}});b.send({type:'world',world});
 for(const e of [{kind:'dungeon-return',target:'world',run:'public-run'},{kind:'chapter',target:'world',chapter:2},{kind:'party',target:'world',party:2},{kind:'duel',target:'other',amount:20}])b.send({type:'combat',event:e});
 b.send({type:'state',state});await a.next('state');a.send({type:'state',state});await b.next('state');
 assert.equal(a.queue.some(m=>m.type==='world'||m.type==='combat'),false);assert.equal(b.queue.some(m=>m.type==='world'),false);
});

test('online display names are unique across private rooms and worlds without changing character identity',async t=>{
 const {client}=await setup(t);const a=await client(),b=await client(),c=await client();
 a.send({type:'create',spec});const first=await a.next('welcome');assert.equal(first.displayName,'Test crab');
 b.send({type:'create',spec});const second=await b.next('welcome');assert.equal(second.displayName,'Test crab #2');assert.equal(second.nameConflict,true);assert.equal(second.renamed,undefined);
 c.send({type:'enter',area:3,spec:{...spec,name:'Ｔｅｓｔ crab'}});const third=await c.next('welcome');assert.equal(third.nameConflict,true);assert.match(third.displayName,/#3$/);
 b.send({type:'join',room:first.room,spec});const moved=await b.next('welcome');assert.equal(moved.displayName,second.displayName);assert.equal((await a.next('joined')).spec.name,second.displayName);
 b.send({type:'chat',text:'Hello there'});assert.equal((await a.next('chat')).name,second.displayName);
 b.ws.close();await a.next('left');const d=await client();d.send({type:'join',room:first.room,spec});assert.equal((await d.next('welcome')).displayName,'Test crab #2');
});
test('long, manually suffixed and filtered names cannot collide after suffixing',async t=>{
 const {client}=await setup(t);const names=[];
 for(const name of ['A'.repeat(24),'A'.repeat(24),'A'.repeat(21)+' #2','게 모험가','게 모험가','🦀'.repeat(12),'🦀'.repeat(12)]){const c=await client();c.send({type:'create',spec:{...spec,name}});const w=await c.next('welcome');assert.ok(w.displayName.length<=24);names.push(w.displayName);}
 assert.equal(new Set(names.map(n=>n.toLowerCase())).size,names.length);
});

test('dungeon checkpoints preserve old clients and reject invalid expedition state',()=>{
 const third={...world,chapter:3,bosses:[...world.bosses,{id:'b30',state:'dormant',phase:1,enraged:false,mech:null}]};
 const dungeon={level:35,run:'run-35',stage:1,phase:'wave',left:0,clock:2,hazard:0,members:['Test crab']};
 assert.ok(worldOf(third));assert.ok(worldOf({...third,dungeon:null}));assert.ok(worldOf({...third,dungeon}));
 for(const patch of [{level:36},{level:150},{run:'bad run'},{stage:0},{stage:4},{phase:'unknown'},{left:Infinity},{clock:-1},{hazard:.5},{members:Array(9).fill('a')},{members:['same','same']}])assert.equal(worldOf({...third,dungeon:{...dungeon,...patch}}),null);
});


test('dungeon return requests authenticate the guest and route only to its private host',async t=>{
 const {client}=await setup(t),a=await client(),b=await client(),c=await client();
 a.send({type:'create',spec,combatVersion:1});const host=await a.next('welcome');
 b.send({type:'join',room:host.room,spec,combatVersion:1});const guest=await b.next('welcome');
 c.send({type:'join',room:host.room,spec,combatVersion:1});await c.next('welcome');
 const event={kind:'dungeon-return',target:'world',run:'run-123'};
 b.send({type:'combat',id:'forged-host',event:{...event,source:'forged'}});
 const packet=await a.next('combat');assert.equal(packet.id,guest.id);assert.deepEqual(packet.event,event);
 a.send({type:'world',world});await c.next('world');
 assert.equal(c.queue.some(p=>p.type==='combat'),false);
 assert.equal(eventOf(event,true),null);
 for(const bad of [{...event,target:'e0'},{...event,run:''},{...event,run:'x'.repeat(65)},{...event,run:123},{...event,run:'<script>'}])assert.equal(eventOf(bad,false),null);
 assert.ok(eventOf({kind:'attack',target:'e0',amount:10},false));
});

 test('world five and six checkpoints and travel retain five bosses and reject invalid chapters',()=>{
 const expanded={...world,finalCleared:true,frostCleared:true,bosses:[...world.bosses,...['b30','b300'].map(id=>({id,state:'dead',phase:1,enraged:false,mech:null}))]};
 for(const chapter of [5,6]){assert.ok(worldOf({...expanded,chapter}));assert.deepEqual(eventOf({kind:'chapter',target:'world',chapter},false),{kind:'chapter',target:'world',chapter});assert.equal(worldOf({...expanded,chapter,bosses:world.bosses}),null);}
 for(const chapter of [0,7,5.5,'5']){assert.equal(worldOf({...expanded,chapter}),null);assert.equal(eventOf({kind:'chapter',target:'world',chapter},false),null);}
 });


test('frontier bosses and ten expedition tiers coexist with legacy five-boss checkpoints',()=>{
 const bosses=[...world.bosses,...['b30','b300','b500','b750'].map(id=>({id,state:'dormant',phase:1,enraged:false,mech:null}))];
 const six={...world,chapter:6,bosses,emberCleared:true,skyCleared:false};
 assert.ok(worldOf(six));assert.ok(worldOf({...six,bosses:bosses.slice(0,5),emberCleared:undefined}));
 for(const target of ['b500','b750']){assert.ok(eventOf({kind:'challenge',target},false));assert.ok(eventOf({kind:'attack',target,amount:20},false));}
 for(const [level,chapter]of [[350,5],[450,5],[550,6],[650,6]]){
  const dungeon={level,run:`run-${level}`,stage:3,phase:'wave',left:0,clock:8,hazard:1,members:['crab']};
  assert.ok(worldOf({...six,chapter,dungeon}));assert.equal(worldOf({...six,chapter:4,dungeon}),null);
 }
 assert.equal(worldOf({...six,skyCleared:'yes'}),null);
 assert.equal(worldOf({...six,bosses:[...bosses.slice(0,6),bosses[5]]}),null);
});


test('lantern healing requests are bounded skill IDs and only authority can publish healing',()=>{
 for(const authority of [false,true]){assert.deepEqual(eventOf({kind:'heal-cast',target:'world',ability:'mend-shell',amount:999999,source:'forged'},authority),{kind:'heal-cast',target:'world',ability:'mend-shell'});assert.equal(eventOf({kind:'heal-cast',target:'world',ability:'smite'},authority),null);}
 assert.equal(eventOf({kind:'heal',target:'peer',source:'healer',amount:35},false),null);
 assert.deepEqual(eventOf({kind:'heal',target:'peer',source:'healer',amount:35},true),{kind:'heal',target:'peer',source:'healer',amount:35});
 for(const amount of [-1,0,NaN,Infinity])assert.equal(eventOf({kind:'heal',target:'peer',source:'healer',amount},true),null);
});

test('lantern relay authenticates priest requests, host results and room isolation',async t=>{
 const {client}=await setup(t),host=await client(),healer=await client(),warrior=await client(),outside=await client();
 host.send({type:'create',spec,combatVersion:1});const h=await host.next('welcome');
 healer.send({type:'join',room:h.room,spec:{...spec,classId:'priest'},combatVersion:1});const priest=await healer.next('welcome');
 warrior.send({type:'join',room:h.room,spec,combatVersion:1});await warrior.next('welcome');
 outside.send({type:'create',spec,combatVersion:1});await outside.next('welcome');
 healer.send({type:'combat',event:{kind:'heal-cast',target:'world',ability:'holy-tide'}});const cast=await host.next('combat');assert.equal(cast.id,priest.id);assert.equal(cast.event.ability,'holy-tide');
 warrior.send({type:'combat',event:{kind:'heal-cast',target:'world',ability:'holy-tide'}});
 healer.send({type:'combat',event:{kind:'heal',target:h.id,source:priest.id,amount:999}});
 host.send({type:'combat',event:{kind:'heal',target:priest.id,source:h.id,amount:35}});assert.equal((await healer.next('combat')).event.kind,'heal');
 await new Promise(r=>setTimeout(r,30));assert.equal(host.queue.filter(p=>p.type==='combat').length,0);assert.equal(outside.queue.filter(p=>p.type==='combat').length,0);
});

// The developer monitor's spectator views (docs/features/developer-monitor.md): invisible observers of one room.
const allowTicket = { observe: (_req, ticket) => ticket === 'monitor-ok' };
test('without an observe rule (the Vite relay) nobody may observe', async t => {
  const { client } = await setup(t);
  const a = await client(), o = await client();
  a.send({ type: 'create', spec, combatVersion: 1 }); const r = await a.next('welcome');
  const closed = once(o.ws, 'close');
  o.send({ type: 'observe', room: r.room, ticket: 'monitor-ok' });
  assert.equal((await o.next('error')).message, 'Monitor access required.');
  assert.equal((await closed)[0], 1008);
  assert.equal(a.queue.some(m => m.type === 'joined'), false);
});

test('an unauthorized observer is refused and closed; an unknown room is refused', async t => {
  const { client, relay } = await setup(t, allowTicket);
  const a = await client(), bad = await client(), lost = await client();
  a.send({ type: 'enter', area: 1, spec, combatVersion: 1, snowWorld: true, sharedWorld: 1 }); const r = await a.next('welcome');
  const closed = once(bad.ws, 'close');
  bad.send({ type: 'observe', room: r.room, ticket: 'forged' });
  assert.equal((await bad.next('error')).message, 'Monitor access required.');
  assert.equal((await closed)[0], 1008);
  assert.equal(bad.queue.some(m => m.type === 'welcome'), false);
  lost.send({ type: 'observe', room: 'W1FFFF', ticket: 'monitor-ok' });
  assert.match((await lost.next('error')).message, /Room not found/);
  assert.equal(relay.rooms.get(r.room).size, 1);
});

test('an authorized observer gets the room and every broadcast; players never see it', async t => {
  const { client, relay } = await setup(t, allowTicket);
  const enter = { type: 'enter', area: 1, spec, combatVersion: 1, snowWorld: true, sharedWorld: 1 };
  const a = await client(), b = await client(), o = await client();
  a.send(enter); const ar = await a.next('welcome');
  b.send({ ...enter, spec: { ...spec, name: 'Friend' } }); const br = await b.next('welcome'); await a.next('joined');
  a.send({ type: 'state', state }); await b.next('state');
  a.send({ type: 'world', world }); await b.next('world');
  o.send({ type: 'observe', room: ar.room.toLowerCase(), ticket: 'monitor-ok' });
  const ow = await o.next('welcome');
  assert.equal(ow.observer, true); assert.equal(ow.room, ar.room); assert.equal(ow.public, true); assert.equal(ow.area, 1); assert.equal(ow.sharedWorld, 1);
  assert.equal(ow.host, ar.id); assert.deepEqual(ow.world, world);
  assert.deepEqual(ow.players.map(p => p.id).sort(), [ar.id, br.id].sort());
  assert.deepEqual(ow.players.find(p => p.id === ar.id).state, state);
  // Everything the room hears, the observer hears.
  a.send({ type: 'state', state: { ...state, x: 9 } }); assert.equal((await o.next('state')).state.x, 9);
  b.send({ type: 'action', action: 'attack_swipe' }); assert.deepEqual(await o.next('action'), { type: 'action', id: br.id, action: 'attack_swipe' });
  a.send({ type: 'world', world: { ...world, rust: true } }); assert.equal((await o.next('world')).world.rust, true);
  a.send({ type: 'combat', event: { kind: 'hit', target: 'e0', amount: 23 } }); assert.equal((await o.next('combat')).event.amount, 23);
  b.send({ type: 'chat', text: 'hello' }); assert.equal((await o.next('chat')).text, 'hello');
  // A guest's attack goes to the host only, as before.
  b.send({ type: 'combat', event: { kind: 'attack', target: 'e0', amount: 5 } }); await a.next('combat');
  // Nobody is told, nobody counts it, the monitor does not list it.
  const c = await client(); c.send({ ...enter, spec: { ...spec, name: 'Crab' } }); const cr = await c.next('welcome');
  assert.equal(cr.room, ar.room); assert.equal(cr.displayName, 'Crab'); assert.equal(cr.players.length, 2);
  assert.equal((await o.next('joined')).id, cr.id);
  assert.equal(relay.rooms.get(ar.room).size, 3);
  assert.deepEqual(relay.monitorSnapshot().players.map(p => p.id).sort(), [ar.id, br.id, cr.id].sort());
  for (const p of [a, b, c]) assert.equal(p.queue.some(m => (m.type === 'joined' || m.type === 'left') && m.id === ow.id), false);
  assert.equal(o.queue.some(m => m.type === 'combat' && m.event.kind === 'attack'), false);
});

test('an observer cannot play, send, chat, join or become the host, and leaving changes nothing', async t => {
  const { client, relay } = await setup(t, allowTicket);
  const a = await client(), b = await client(), o = await client();
  a.send({ type: 'create', spec, combatVersion: 1 }); const r = await a.next('welcome');
  b.send({ type: 'join', room: r.room, spec, combatVersion: 1 }); const br = await b.next('welcome'); await a.next('joined');
  o.send({ type: 'observe', room: r.room, ticket: 'monitor-ok' }); const ow = await o.next('welcome');
  assert.equal(ow.public, undefined); assert.equal(ow.host, r.id);
  for (const m of [{ type: 'state', state }, { type: 'action', action: 'jump' }, { type: 'world', world: { ...world, rust: true } },
    { type: 'combat', event: { kind: 'attack', target: 'e0', amount: 99 } }, { type: 'combat', event: { kind: 'hit', target: br.id, amount: 99 } },
    { type: 'chat', text: 'sneaky' }, { type: 'report', id: r.id, reason: 'spam' }, { type: 'join', room: r.room, spec }, { type: 'create', spec }, { type: 'enter', area: 1, spec }]) o.send(m);
  b.send({ type: 'state', state }); await a.next('state');
  for (const p of [a, b]) assert.equal(p.queue.some(m => ['state', 'action', 'world', 'combat', 'chat', 'joined'].includes(m.type)), false);
  assert.equal(o.queue.some(m => m.type === 'welcome' || m.type === 'reported'), false);
  assert.equal(relay.rooms.get(r.room).size, 2);
  // Seven players and an observer: the eighth player still fits.
  for (let i = 0; i < 5; i++) { const c = await client(); c.send({ type: 'join', room: r.room, spec, combatVersion: 1 }); await c.next('welcome'); }
  const eighth = await client(); eighth.send({ type: 'join', room: r.room, spec, combatVersion: 1 }); assert.equal((await eighth.next('welcome')).room, r.room);
  assert.equal(relay.rooms.get(r.room).size, 8);
  // The host leaves: a player takes over, never the observer.
  a.ws.close(); await b.next('left');
  let elected; do { elected = await o.next('authority'); } while (elected.host === r.id);
  assert.notEqual(elected.host, ow.id); assert.ok([...relay.rooms.get(r.room).keys()].includes(elected.host));
  // Leaving and closing tell nobody.
  o.send({ type: 'leave' }); await o.next('leftRoom'); o.queue.length = 0;
  b.send({ type: 'state', state }); await eighth.next('state');
  assert.equal(o.queue.some(m => m.type === 'state'), false);
  o.ws.close(); await once(o.ws, 'close');
  b.send({ type: 'action', action: 'jump' }); await eighth.next('action');
  assert.equal(b.queue.some(m => m.type === 'left' && m.id === ow.id), false);
  assert.equal(relay.rooms.get(r.room).size, 7);
});
