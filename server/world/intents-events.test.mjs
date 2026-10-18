import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeIntent, decodeIntent, IntentSession } from './intents.ts';
import { encodeEvents, decodeEvents, EventReceiver } from './events.ts';
import { DeadlineScheduler } from './scheduler.ts';
const move = sequence => ({ kind: 'move', sequence, x: 1, z: -.5, yaw: Math.PI, flags: 3 });
test('bounded movement, sprint/jump flags, ability/target action intents roundtrip', () => {
  const decoded = decodeIntent(encodeIntent(move(1))); assert.equal(decoded.x, 1); assert.equal(decoded.flags, 3); assert.equal(decoded.yaw, Math.PI);
  const action = { kind: 'action', sequence: 2, action: 2, slot: 7, target: 0xffffffff }; assert.deepEqual(decodeIntent(encodeIntent(action)), action);
});
test('malicious intent authority, unknown variants, truncation and overflows reject', () => {
  for (const extra of [{ damage: 10 }, { xp: 100 }, { position: [1, 2, 3] }, { hp: 100 }, { admin: true }]) assert.throws(() => encodeIntent({ ...move(1), ...extra }));
  for (const change of [{ x: 2 }, { yaw: Infinity }, { yaw: -1 }, { flags: 4 }, { sequence: 0 }, { sequence: 2 ** 32 }]) assert.throws(() => encodeIntent({ ...move(1), ...change }));
  const bytes = encodeIntent(move(1)); for (let n = 0; n < bytes.length; n++) assert.throws(() => decodeIntent(bytes.subarray(0, n)));
  for (const [offset, value] of [[3, 1], [8, 128], [12, 4]]) { const bad = bytes.slice(); bad[offset] = value; assert.throws(() => decodeIntent(bad)); }
  assert.throws(() => decodeIntent(new Uint8Array([...bytes, 0]))); assert.throws(() => decodeIntent(new Uint8Array(65536)));
  assert.throws(() => encodeIntent({ kind: 'action', sequence: 1, action: 3, slot: 0, target: 0 }));
});
test('intent sequence/rate/action queue are bounded; acceptance does not imply consumption', () => {
  const session = new IntentSession(); session.accept(encodeIntent(move(1)), 0); assert.equal(session.movement.sequence, 1);
  assert.throws(() => session.accept(encodeIntent(move(1)), 0)); assert.equal(session.sequence, 1);
  for (let sequence = 2; sequence <= 120; sequence++) session.accept(encodeIntent(move(sequence)), 0);
  assert.throws(() => session.accept(encodeIntent(move(121)), 0)); session.accept(encodeIntent(move(121)), 1);
  assert.throws(() => session.accept(encodeIntent(move(122)), .5));
  const actions = new IntentSession(); for (let sequence = 1; sequence <= 4; sequence++) actions.accept(encodeIntent({ kind: 'action', sequence, action: 1, slot: 0, target: 1 }), 0);
  assert.throws(() => actions.accept(encodeIntent({ kind: 'action', sequence: 5, action: 1, slot: 0, target: 1 }), 0));
  assert.equal(actions.drainActions().length, 4); assert.equal(actions.drainActions().length, 0);
});
const events = [
  { kind: 'damage', source: 1, target: 2, amount: 40 }, { kind: 'heal', source: 1, target: 2, amount: 10 }, { kind: 'death', target: 2 },
  { kind: 'action', source: 1, target: 2, code: 1 }, { kind: 'cast', source: 1, target: 2, code: 2 },
  { kind: 'telegraph', source: 1, x: -32768, z: 32767, radius: 160, durationTicks: 60 }, { kind: 'result', source: 1, target: 2, code: 3, success: true },
];
test('typed event variants roundtrip and preserve ordered event stream', () => {
  const p = { epoch: 1, sequence: 1, tick: 10, events }; const bytes = encodeEvents(p); assert.deepEqual(decodeEvents(bytes), p);
  const receiver = new EventReceiver(); receiver.apply(bytes); assert.throws(() => receiver.apply(bytes));
  assert.throws(() => receiver.apply(encodeEvents({ ...p, sequence: 3 }))); assert.equal(receiver.sequence, 1);
  receiver.apply(encodeEvents({ ...p, sequence: 2 })); receiver.apply(encodeEvents({ ...p, epoch: 2 })); assert.equal(receiver.sequence, 1);
  assert.throws(() => receiver.apply(bytes)); receiver.reset(); receiver.apply(bytes);
});
test('malformed/truncated/oversized events and nonboolean results reject atomically', () => {
  const p = { epoch: 1, sequence: 1, tick: 10, events }; const bytes = encodeEvents(p);
  for (let n = 0; n < bytes.length; n++) assert.throws(() => decodeEvents(bytes.subarray(0, n)));
  assert.throws(() => decodeEvents(new Uint8Array([...bytes, 0]))); assert.throws(() => decodeEvents(new Uint8Array(131073)));
  assert.throws(() => encodeEvents({ ...p, events: Array(257).fill(events[0]) }));
  assert.throws(() => encodeEvents({ ...p, events: [{ kind: 'result', source: 1, target: 2, code: 1, success: 1 }] }));
  const bad = bytes.slice(); bad[18] = 255; assert.throws(() => decodeEvents(bad));
});
test('30/20Hz deadline scheduling, bounded catchup and empty-world idle reset', () => {
  const tick = new DeadlineScheduler(30, 0); const snapshots = new DeadlineScheduler(20, 0, 1); let ticks = 0; let packets = 0;
  for (let now = 0; now <= 1001; now++) { tick.run(now, () => ticks++); snapshots.run(now, () => packets++); }
  assert.equal(ticks, 30); assert.equal(packets, 20);
  const stalled = new DeadlineScheduler(30, 0); assert.equal(stalled.run(10000, () => {}), 4); assert(stalled.dropped >= 295); assert(stalled.next > 10000);
  stalled.idle(20000); assert.equal(stalled.run(20000, () => {}), 0); assert.throws(() => new DeadlineScheduler(0, 0));
});
