import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import WebSocket from 'ws';
import { attachRooms } from './rooms.ts';
import {worldOf} from './combatProtocol.ts';

const spec = { race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'Test crab' };
const state = { x: 3, y: 0, z: 5, yaw: 1, hp: 80, maxHp: 100, alive: true };

async function setup(t) {
  const server = createServer();
  const relay = attachRooms(server);
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
