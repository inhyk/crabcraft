import test from 'node:test';
import assert from 'node:assert/strict';
import { ClientStream, SnapshotReceiver, encodeSnapshot, decodeSnapshot, quantizeEntity, dequantizeEntity, MAX_PACKET_BYTES, HEADER_BYTES, MASK } from './protocol.ts';
import { fixtureEntity } from './fixture.ts';
const entity = (id = 1, change = {}) => ({ ...fixtureEntity(id), ...change });
const packet = (change = {}) => ({ kind: 'full', epoch: 1, sequence: 1, baseline: 0, tick: 1, ack: 0, selfId: 0, records: [], ...change });
const record = (id = 1, change = {}) => ({ id, mask: MASK.all, values: quantizeEntity(entity(id, change)) });
test('full/delta/removal/re-entry roundtrip, owned packets and field groups', () => {
  const stream = new ClientStream(7, 1); const receiver = new SnapshotReceiver();
  const first = stream.encode(1, [entity(), entity(2, { x: 3 })]); const copy = first.slice();
  assert.equal(receiver.apply(first).kind, 'full'); assert.equal(receiver.state.size, 2);
  const second = stream.encode(2, [entity(1, { x: 1, y: .5, z: -2, yaw: Math.PI, hp: 30, maxHp: 200, level: 2, flags: 3, stunTick: 100, slowTick: 101, slowPct: 25, rust: 2, rustTick: 102 })], false, 4);
  assert.deepEqual(first, copy); assert.notEqual(first.buffer, second.buffer);
  const delta = receiver.apply(second); assert.equal(delta.kind, 'delta'); assert.equal(delta.records[0].mask, MASK.all); assert.equal(delta.records[1].mask, MASK.remove);
  assert.equal(receiver.ack, 4); assert.equal(receiver.state.size, 1); assert.equal(receiver.state.get(1).stunTick, 100);
  receiver.apply(stream.encode(3, [entity(), entity(2, { x: 4 })], false, 4));
  assert.equal(dequantizeEntity(receiver.state.get(2)).x, 4);
  const unchanged = stream.encode(4, [entity(), entity(2, { x: 4 })], false, 4); assert.equal(unchanged.length, HEADER_BYTES); receiver.apply(unchanged);
});
test('quantization bounds and finite validation, no silent overflow', () => {
  for (const change of [{ x: 2048 }, { x: -2048.1 }, { y: 512 }, { z: Infinity }, { yaw: NaN }, { hp: -1 }, { hp: 101 }, { maxHp: 0 }, { level: 0 }, { flags: 128 }, { slowPct: 101 }, { rust: 256 }, { stunTick: 2 ** 32 }, { id: 0 }]) assert.throws(() => quantizeEntity(entity(1, change)));
  const q = quantizeEntity(entity(1, { x: -2048, y: -512, z: 2047.9375, yaw: Number.MAX_VALUE }));
  assert.equal(q.x, -32768); assert.equal(q.z, 32767); assert(Number.isInteger(q.yaw)); assert(q.yaw >= 0 && q.yaw <= 255);
  assert.equal(quantizeEntity(entity(1, { yaw: -Math.PI })).yaw, 128);
});
test('every full packet truncation, trailing data, oversized and malformed fields reject', () => {
  const bytes = encodeSnapshot(packet({ records: [record()] }));
  for (let n = 0; n < bytes.length; n++) assert.throws(() => decodeSnapshot(bytes.subarray(0, n)), `length${n}`);
  assert.throws(() => decodeSnapshot(new Uint8Array(MAX_PACKET_BYTES + 1)));
  assert.throws(() => decodeSnapshot(new Uint8Array([...bytes, 0])));
  for (const [offset, value] of [[0, 0], [2, 1], [3, 99], [28, 255], [34, 64]]) { const bad = bytes.slice(); bad[offset] = value; assert.throws(() => decodeSnapshot(bad)); }
  assert.throws(() => encodeSnapshot(packet({ records: [record(), record()] })));
  const duplicate = encodeSnapshot(packet({ records: [record(1), record(2)] })); new DataView(duplicate.buffer).setUint32(HEADER_BYTES + 37, 1, true); assert.throws(() => decodeSnapshot(duplicate), /duplicate/);
  assert.throws(() => encodeSnapshot(packet({ records: [{ id: 1, mask: MASK.remove }] })));
  assert.throws(() => encodeSnapshot(packet({ kind: 'delta', baseline: 3, sequence: 5 })));
});
test('ordered baseline, stale/full recovery, ack and epoch reset', () => {
  const stream = new ClientStream(2, 1); const receiver = new SnapshotReceiver();
  const first = stream.encode(1, [entity()]); receiver.apply(first);
  const second = stream.encode(2, [entity(1, { x: 1 })], false, 2);
  const third = stream.encode(3, [entity(1, { x: 2 })], false, 3);
  assert.throws(() => receiver.apply(third), /baseline/); assert.equal(receiver.sequence, 1);
  receiver.apply(second); assert.throws(() => receiver.apply(second));
  const recovered = stream.encode(4, [entity(1, { x: 3 })], true, 4); receiver.apply(recovered); assert.equal(receiver.sequence, 4);
  assert.throws(() => receiver.apply(first), /stale/);
  stream.reset(); const reset = stream.encode(0, [entity()], false, 0); receiver.apply(reset); assert.equal(receiver.epoch, 3); assert.equal(receiver.ack, 0);
  assert.throws(() => receiver.apply(recovered)); receiver.reset(); receiver.apply(first); assert.equal(receiver.epoch, 2);
  assert.throws(() => stream.encode(1, [entity()], false, -1));
  const max = new ClientStream(0xffffffff); assert.throws(() => max.reset()); assert.equal(max.epoch, 0xffffffff);
});
test('all apply failures are atomic including later records and cross-field invalidity', () => {
  const stream = new ClientStream(); const receiver = new SnapshotReceiver(); receiver.apply(stream.encode(1, [entity()]));
  const state = receiver.state;
  for (const records of [
    [{ id: 1, mask: 4, values: { hp: 40 } }, { id: 2, mask: 1, values: { x: 0, y: 0, z: 0 } }],
    [{ id: 1, mask: 4, values: { hp: 101 } }], [{ id: 2, mask: MASK.remove }],
  ]) {
    const bytes = encodeSnapshot(packet({ kind: 'delta', baseline: 1, sequence: 2, tick: 2, records }));
    assert.throws(() => receiver.apply(bytes)); assert.equal(receiver.state, state); assert.equal(receiver.sequence, 1); assert.equal(receiver.state.get(1).hp, 100);
  }
  assert.throws(() => receiver.apply(encodeSnapshot(packet({ sequence: 2, tick: 0 })))); assert.equal(receiver.state, state);
});
test('failed encoders do not advance baseline;2048 entity churn can remove and add4096 records', () => {
  const stream = new ClientStream(); const receiver = new SnapshotReceiver();
  receiver.apply(stream.encode(1, [entity()]));
  assert.throws(() => stream.encode(2, [entity(), entity(1)])); assert.equal(stream.sequence, 1);
  assert.throws(() => stream.encode(2, [entity(1, { x: Infinity })])); assert.equal(stream.sequence, 1);
  receiver.apply(stream.encode(2, [entity(1, { hp: 99 })])); assert.equal(receiver.state.get(1).hp, 99);
  const large = new ClientStream(); const target = new SnapshotReceiver();
  target.apply(large.encode(1, Array.from({ length: 2048 }, (_, i) => entity(i + 1))));
  const churn = large.encode(2, Array.from({ length: 2048 }, (_, i) => entity(i + 2049)));
  assert.equal(decodeSnapshot(churn).records.length, 4096); target.apply(churn); assert.equal(target.state.size, 2048); assert(target.state.has(4096));
});
