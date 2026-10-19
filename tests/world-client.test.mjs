import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldClient } from '../src/multiplayer/worldClient.ts';
import { decodeInput } from '../server/world/gameplay/intents.ts';
import { FragmentAssembler, encodeControl } from '../server/world/gameplay/protocol.ts';
import { actualWorld, catalog, TestSocket, tickAsync, deliver } from './world-client-fixture.mjs';

function clientFixture(world = actualWorld(), options = {}) {
  const sockets = [], requests = [], states = [], snapshots = [], resets = [], rejected = [];
  const window = new EventTarget(), document = new EventTarget();
  let now = 100;
  const client = new WorldClient({
    catalog, origin: 'https://game.example', now: () => now, windowTarget: window, documentTarget: document, hidden: () => false, maxReconnects: 0,
    fetch: async (url, init) => { requests.push({ url: String(url), init }); return new Response(JSON.stringify({ ticket: 'one-use-ticket', expiresAt: Date.now() + 30000 })); },
    socket: url => { const socket = new TestSocket(); socket.url = url; sockets.push(socket); return socket; },
    onState: state => states.push(state), onSnapshot: state => snapshots.push(state), onReset: reason => resets.push(reason), onRejected: code => rejected.push(code), ...options,
  });
  return {
    world, client, sockets, requests, states, snapshots, resets, rejected, window, document,
    setNow(value) { now = value; },
    async admitted() {
      const promise = client.connect('owned-character'); await tickAsync();
      const socket = sockets.at(-1); socket.open(); socket.receive(JSON.stringify({ type: 'world-bound', ...world.binding })); deliver(socket, world.packets()); await promise;
      return socket;
    },
  };
}
const game = (keys = new Set(), edges = new Set()) => ({ controlsLocked: false, input: { isDown: key => keys.has(key), isButtonDown: () => false, wasPressed: key => edges.has(key) }, follow: { yaw: .3, steering: true, forwardYaw: 11 } });

test('ticket POST, first auth frame and real Area baseline establish v3 without leaked URL authority', async () => {
  const f = clientFixture();
  try {
    const socket = await f.admitted();
    assert.equal(f.requests[0].url, 'https://game.example/api/account/world-ticket');
    assert.equal(f.requests[0].init.method, 'POST'); assert.equal(f.requests[0].init.credentials, 'same-origin'); assert.equal(f.requests[0].init.cache, 'no-store');
    assert.equal(f.requests[0].init.headers['X-Crabcraft-Account'], '1');
    assert.equal(socket.url, 'wss://game.example/world'); assert.equal(socket.binaryType, 'arraybuffer');
    assert.deepEqual(JSON.parse(socket.sent[0]), { type: 'authenticate', ticket: 'one-use-ticket', characterId: 'owned-character' });
    assert.equal(f.client.state, 'admitted');
    for (const key of ['appliedQ', 'appliedPosition', 'appliedRotation', 'localVx', 'localVz']) assert.deepEqual(f.client.view.actors[0].pose[key], f.world.actors[0].u.pose[key]);
    assert.deepEqual(Object.keys(f.client.view.actors[0].pose).sort(), ['appliedQ', 'appliedPosition', 'appliedRotation', 'localVx', 'localVz'].sort());
    assert.deepEqual(f.client.view.actors[0].appearance, f.world.observation().appearances[`${f.world.actors[0].ref.id}:1`]);
    assert.equal(f.client.command({ kind: 'ability', slot: 6 }), false);
  } finally { f.client.dispose(); }
});

test('one ordered core/feature/UI queue survives short frames and catch-up never replays an action', async () => {
  const f = clientFixture();
  try {
    const socket = await f.admitted(), keys = new Set(['KeyW']), edges = new Set(['Space']);
    f.client.capture(game(keys, edges), .004); edges.clear();
    f.client.command({ kind: 'ability', slot: 3 });
    f.client.command({ kind: 'village', mode: 'hide' });
    f.client.capture(game(keys, edges), .004); f.client.pump(100);
    let packet = decodeInput(socket.sent.at(-1), f.world.binding, catalog);
    assert.deepEqual(packet.commands, [{ kind: 'jump' }, { kind: 'ability', slot: 3 }, { kind: 'village', mode: 'hide' }]);
    assert.equal(packet.forward, 1); assert.ok(packet.steeringYaw >= -Math.PI && packet.steeringYaw <= Math.PI);
    const count = socket.sent.length; f.client.pump(100); f.client.pump(110); assert.equal(socket.sent.length, count);
    f.client.pump(1000); packet = decodeInput(socket.sent.at(-1), f.world.binding, catalog); assert.deepEqual(packet.commands, []); assert.equal(packet.seq, 2);
    assert.equal(f.client.inputWatermarks.unconsumed, 2);
  } finally { f.client.dispose(); }
});

test('accepted ACK retains command ledger until successful-step consumption, independently of command results', async () => {
  const f = clientFixture();
  try {
    const socket = await f.admitted(); f.client.command({ kind: 'jump' }); f.client.pump(100);
    deliver(socket, encodeControl({ ...f.world.binding, sequence: 2, tick: 0, acceptedInput: 1, consumedInput: 0 }, { type: 'inputAck' }));
    assert.deepEqual(f.client.inputWatermarks, { sent: 1, accepted: 1, consumed: 0, pending: 0, unconsumed: 1 });
    deliver(socket, encodeControl({ ...f.world.binding, sequence: 3, tick: 0, acceptedInput: 1, consumedInput: 1 }, { type: 'inputAck' }));
    assert.equal(f.client.inputWatermarks.unconsumed, 0);
  } finally { f.client.dispose(); }
});

test('missing publication keeps the last complete view, sends one resync, and full recovery never replays commands', async () => {
  const f = clientFixture();
  try {
    const socket = await f.admitted(); const before = f.client.view;
    f.client.command({ kind: 'ability', slot: 1 });
    deliver(socket, f.world.packets(3));
    assert.equal(f.client.state, 'recovering'); assert.deepEqual(f.client.view, before); assert.equal(f.client.command({ kind: 'jump' }), false);
    const outbound = socket.sent.length, assembler = new FragmentAssembler(f.world.binding);
    const control = assembler.accept(socket.sent.at(-1), 0); assert.equal(control.payload.type, 'resync');
    deliver(socket, f.world.packets(4)); assert.equal(socket.sent.length, outbound);
    deliver(socket, f.world.packets(5, { full: true })); assert.equal(f.client.state, 'admitted');
    f.client.pump(200); assert.deepEqual(decodeInput(socket.sent.at(-1), f.world.binding, catalog).commands, []);
  } finally { f.client.dispose(); }
});

test('fragmented actual Area observations do not commit partial actor or HUD state', async () => {
  const f = clientFixture(actualWorld(100));
  try {
    const pending = f.client.connect('owned-character'); pending.catch(() => {}); await tickAsync(); const socket = f.sockets[0]; socket.open(); socket.receive(JSON.stringify({ type: 'world-bound', ...f.world.binding }));
    const packets = f.world.packets(); assert.ok(packets.length > 1);
    deliver(socket, packets.slice(0, -1)); assert.equal(f.client.view, null); assert.equal(f.snapshots.length, 0);
    socket.receive(packets.at(-1)); await pending; assert.equal(f.client.view.actors.length, 100); assert.equal(f.snapshots.length, 1);
  } finally { f.client.dispose(); }
});

test('epoch reset clears input/targets and rejects old-frame mutation before fresh full baseline', async () => {
  const f = clientFixture();
  try {
    const socket = await f.admitted(), oldPackets = f.world.packets(2);
    f.client.command({ kind: 'ability', slot: 2 }); f.client.pump(100);
    socket.receive(JSON.stringify({ type: 'world-bound', ...f.world.binding, epoch: 2 }));
    assert.equal(f.client.state, 'loading'); assert.equal(f.client.view, null);
    assert.deepEqual(f.client.inputWatermarks, { sent: 0, accepted: 0, consumed: 0, pending: 0, unconsumed: 0 });
    deliver(socket, oldPackets); assert.equal(f.client.state, 'recovering'); assert.equal(f.client.view, null);
    f.world.codec.reset({ ...f.world.binding, epoch: 2 });
    deliver(socket, f.world.codec.encodeObservation(f.world.observation(1, { binding: { ...f.world.binding, epoch: 2 }, full: true })));
    assert.equal(f.client.state, 'admitted'); assert.equal(f.client.view.header.epoch, 2);
  } finally { f.client.dispose(); }
});

test('blur/focus clears unsent edges and promptly releases held keys and channels', async () => {
  let resets = 0;
  const f = clientFixture(actualWorld(), { resetInput: () => resets++ });
  try {
    const socket = await f.admitted(), keys = new Set(['KeyW', 'KeyF']);
    f.client.capture(game(keys), .02, 'waystone'); f.client.pump(100); f.client.command({ kind: 'jump' });
    f.setNow(101); f.window.dispatchEvent(new Event('blur'));
    const neutral = decodeInput(socket.sent.at(-1), f.world.binding, catalog);
    assert.equal(neutral.forward, 0); assert.equal(neutral.heldChannel, null); assert.deepEqual(neutral.commands, []);
    assert.equal(f.client.command({ kind: 'dance' }), false);
    f.setNow(102); f.window.dispatchEvent(new Event('focus')); assert.ok(resets >= 4);
    assert.deepEqual(decodeInput(socket.sent.at(-1), f.world.binding, catalog).commands, []);
  } finally { f.client.dispose(); }
});

test('forging under GUI lock sends its explicit command while capture suppresses movement and casts', async () => {
  const f = clientFixture();
  try {
    const socket = await f.admitted(), locked = game(new Set(['KeyW']), new Set(['Space', 'KeyB'])); locked.controlsLocked = true;
    f.client.command({ kind: 'forgeBuy', npcId: 'pip', slot: 'weapon', request: 7 });
    f.client.capture(locked, .03); f.client.pump(100);
    const frame = decodeInput(socket.sent.at(-1), f.world.binding, catalog);
    assert.equal(frame.forward, 0); assert.deepEqual(frame.commands, [{ kind: 'forgeBuy', npcId: 'pip', slot: 'weapon', request: 7 }]);
  } finally { f.client.dispose(); }
});

test('new connect and disposal invalidate unresolved ticket fetch/body completions', async () => {
  const deferred = []; const sockets = [];
  const f = clientFixture(actualWorld(), {
    fetch: () => new Promise(resolve => deferred.push(resolve)),
    socket: () => { const socket = new TestSocket(); sockets.push(socket); return socket; },
  });
  const first = f.client.connect('first'); const firstRejected = assert.rejects(first, /replaced/);
  const second = f.client.connect('second'); const secondRejected = assert.rejects(second, /disposed/);
  deferred[0](new Response(JSON.stringify({ ticket: 'stale-ticket' }))); await tickAsync(); assert.equal(sockets.length, 0);
  f.client.dispose(); deferred[1](new Response(JSON.stringify({ ticket: 'disposed-ticket' }))); await tickAsync();
  assert.equal(sockets.length, 0); await firstRejected; await secondRejected;
});

test('disconnect clears pending commands and a fresh authenticated connection never replays them', async () => {
  const f = clientFixture();
  try {
    const socket = await f.admitted(); f.client.command({ kind: 'jump' }); socket.close();
    assert.equal(f.client.state, 'closed'); assert.equal(f.client.inputWatermarks.pending, 0);
    const promise = f.client.connect('owned-character'); await tickAsync(); const next = f.sockets.at(-1); next.open();
    assert.equal(f.requests.length, 2); assert.notEqual(next, socket);
    const binding = { ...f.world.binding, session: 'new-incarnation' };
    next.receive(JSON.stringify({ type: 'world-bound', ...binding })); f.world.codec.reset(binding);
    deliver(next, f.world.codec.encodeObservation(f.world.observation(1, { binding, full: true }))); await promise;
    f.client.pump(200); assert.deepEqual(decodeInput(next.sent.at(-1), binding, catalog).commands, []);
    socket.receive(JSON.stringify({ type: 'error', code: 'stale', retryable: false })); assert.equal(f.client.state, 'admitted');
  } finally { f.client.dispose(); }
});

test('queue and network backpressure are bounded and do not silently discard accepted commands', async () => {
  const f = clientFixture();
  try {
    const socket = await f.admitted(); for (let i = 0; i < 128; i++) assert.equal(f.client.command({ kind: 'jump' }), true);
    assert.equal(f.client.command({ kind: 'jump' }), false); assert.equal(f.client.inputWatermarks.pending, 128);
    f.client.pump(100); assert.equal(decodeInput(socket.sent.at(-1), f.world.binding, catalog).commands.length, 32); assert.equal(f.client.inputWatermarks.pending, 96);
    socket.bufferedAmount = 65536; f.client.pump(200); assert.equal(f.client.state, 'closed'); assert.ok(f.rejected.includes('command-capacity'));
  } finally { f.client.dispose(); }
});

test('queue status has no gameplay actor and bounded ticket response/auth failures create no socket', async () => {
  const queued = clientFixture();
  try {
    const pending = queued.client.connect('owned-character'); pending.catch(() => {}); await tickAsync();
    const socket = queued.sockets[0]; socket.open(); socket.receive(JSON.stringify({ type: 'queued', world: 'w1', position: 101 }));
    assert.equal(queued.client.state, 'queued'); assert.deepEqual(queued.client.queue, { world: 'w1', position: 101 });
    assert.equal(queued.client.view, null); assert.equal(queued.client.command({ kind: 'jump' }), false);
    queued.client.dispose(); await assert.rejects(pending, /disposed/);
  } finally { queued.client.dispose(); }
  for (const response of [new Response('unauthorized', { status: 401 }), new Response('x'.repeat(4097))]) {
    const f = clientFixture(actualWorld(), { fetch: async () => response });
    try { await assert.rejects(f.client.connect('owned-character')); assert.equal(f.sockets.length, 0); }
    finally { f.client.dispose(); }
  }
});

test('stalled partial fragments trigger bounded recovery even when the server sends nothing else', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = clientFixture(actualWorld(100));
  try {
    const socket = await f.admitted(), before = f.client.view;
    f.world.area.step(new Map());
    const packets = f.world.packets(2, { full: true }); assert.ok(packets.length > 1);
    socket.receive(packets[0]); assert.equal(f.client.state, 'admitted');
    t.mock.timers.tick(5001); assert.equal(f.client.state, 'recovering'); assert.deepEqual(f.client.view, before);
    t.mock.timers.tick(5001); assert.equal(f.client.state, 'closed');
  } finally { f.client.dispose(); }
});

test('automatic retry obtains a fresh ticket and never resends a disconnected command', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = clientFixture(actualWorld(), { maxReconnects: 1 });
  try {
    const socket = await f.admitted(); f.client.command({ kind: 'jump' }); socket.close();
    assert.equal(f.client.state, 'reconnecting'); t.mock.timers.tick(1000); await tickAsync();
    assert.equal(f.requests.length, 2); const next = f.sockets.at(-1); next.open();
    assert.equal(next.sent.length, 1); assert.equal(JSON.parse(next.sent[0]).type, 'authenticate');
    assert.equal(f.client.inputWatermarks.pending, 0);
  } finally { f.client.dispose(); }
});

test('party host commands occupy exclusive frames while ordinary prefix and suffix preserve order and ACK distinctions', async () => {
  const f = clientFixture();
  try {
    const socket = await f.admitted();
    for (const command of [{ kind: 'jump' }, { kind: 'ability', slot: 2 }, { kind: 'partyCreate' }, { kind: 'partyPvp', enabled: true }, { kind: 'dance' }]) assert.equal(f.client.command(command), true);
    const frames = [];
    for (const now of [100, 200, 300, 400]) { f.client.pump(now); frames.push(decodeInput(socket.sent.at(-1), f.world.binding, catalog)); }
    assert.deepEqual(frames.map(frame => frame.commands), [[{ kind: 'jump' }, { kind: 'ability', slot: 2 }], [{ kind: 'partyCreate' }], [{ kind: 'partyPvp', enabled: true }], [{ kind: 'dance' }]]);
    deliver(socket, encodeControl({ ...f.world.binding, sequence: 2, tick: 0, acceptedInput: 4, consumedInput: 1 }, { type: 'inputAck' }));
    assert.equal(f.client.inputWatermarks.unconsumed, 3);
    deliver(socket, f.world.packets(4)); assert.equal(f.client.state, 'recovering');
    deliver(socket, f.world.packets(5, { full: true, acceptedInput: 4, consumedInput: 4 })); assert.equal(f.client.state, 'admitted'); assert.equal(f.client.inputWatermarks.unconsumed, 0);
    f.client.pump(500); assert.deepEqual(decodeInput(socket.sent.at(-1), f.world.binding, catalog).commands, []);
  } finally { f.client.dispose(); }
});

test('frontier queue notices are supported before binding and unknown worlds still close',async()=>{
 for(const world of ['w5','w6','w7']){const controls=[],f=clientFixture(actualWorld(),{onControl:c=>controls.push(c)});try{const promise=f.client.connect('owned-character');promise.catch(()=>{});await tickAsync();const socket=f.sockets.at(-1);socket.open();socket.receive(JSON.stringify({type:'queued',world,position:2}));await tickAsync();if(world==='w7')assert.equal(socket.closed,true);else{assert.equal(socket.closed,false);assert.equal(f.client.state,'queued');}}finally{f.client.dispose();}}
});

test('a denied host command arrives as an error control without ending the session; an error the host closes on still ends it with its code', async () => {
  for (const followUp of ['close', 'snapshot-then-close']) {
    const controls = [], states = [], f = clientFixture(actualWorld(), { onControl: control => controls.push(control), onState: (state, code) => states.push([state, code]) });
    try {
      const socket = await f.admitted(); let sequence = 2;
      const control = value => deliver(socket, encodeControl({ ...f.world.binding, sequence: sequence++, tick: 0, acceptedInput: 0, consumedInput: 0 }, value));
      control({ type: 'error', code: 'dungeon-level', retryable: false });
      assert.equal(f.client.state, 'admitted'); assert.deepEqual(controls.at(-1), { type: 'error', code: 'dungeon-level', retryable: false });
      assert.equal(f.client.command({ kind: 'dungeonStart', tier: 35 }), true, 'commands are still accepted');
      if (followUp === 'close') { control({ type: 'error', code: 'session-expired', retryable: false }); socket.close(); assert.deepEqual(states.at(-1), ['authRequired', 'session-expired']); }
      else { deliver(socket, f.world.packets(sequence, { full: true })); assert.equal(f.client.state, 'admitted'); socket.close(); assert.deepEqual(states.at(-1), ['closed', 'disconnected'], 'a later drop is not reported as the old denial'); }
    } finally { f.client.dispose(); }
  }
});

test('a server that closes an older schema with protocol-schema ends the attempt without retrying', async () => {
  const states = [], f = clientFixture(actualWorld(), { maxReconnects: 5, onState: (state, code) => states.push([state, code]) });
  try {
    const connecting = f.client.connect('owned-character').catch(error => error); await tickAsync();
    const socket = f.sockets.at(-1); socket.open();
    socket.receive(JSON.stringify({ type: 'error', code: 'protocol-schema', retryable: false })); socket.close();
    assert.match((await connecting).message, /protocol-schema/); assert.deepEqual(states.at(-1), ['authRequired', 'protocol-schema']);
    await new Promise(resolve => setTimeout(resolve, 50)); assert.equal(f.sockets.length, 1, 'no reconnect loop'); assert.equal(f.requests.length, 1, 'no second ticket');
  } finally { f.client.dispose(); }
});
