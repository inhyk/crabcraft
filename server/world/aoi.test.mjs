import test from 'node:test';
import assert from 'node:assert/strict';
import { AoiGrid } from './aoi.ts';
import { ClientStream, SnapshotReceiver } from './protocol.ts';
import { fixtureEntity } from './fixture.ts';
const ids = entities => entities.map(e => e.id);
test('16m cells,80 enter/88 leave inclusive, motion and negative cell boundaries', () => {
  const grid = new AoiGrid(); assert.equal(grid.cellSize, 16);
  grid.rebuild([fixtureEntity(1), fixtureEntity(2, 80), fixtureEntity(3, 80.01), fixtureEntity(4, -80), fixtureEntity(5, 0, 88), fixtureEntity(6, 0, 88.01)]);
  assert.deepEqual(ids(grid.query({ selfId: 1 })), [1, 2, 4]);
  assert.deepEqual(ids(grid.query({ selfId: 1 }, new Set([3, 5, 6]))), [1, 2, 3, 4, 5]);
  grid.rebuild([fixtureEntity(1, -16), fixtureEntity(2, 64), fixtureEntity(3, -96)]);
  assert.deepEqual(ids(grid.query({ selfId: 1 })), [1, 2, 3]);
});
test('hidden policy and server party/target/boss pins change dynamically', () => {
  const grid = new AoiGrid();
  grid.rebuild([{ ...fixtureEntity(1), flags: 2 }, { ...fixtureEntity(2, 500), flags: 2 }, { ...fixtureEntity(3, -500), flags: 2 }, { ...fixtureEntity(4, 600), flags: 2 }, { ...fixtureEntity(5, 1), flags: 2 }]);
  assert.deepEqual(ids(grid.query({ selfId: 1, partyIds: new Set([2]), targetId: 3, engagedBossId: 4 })), [1, 2, 3, 4]);
  assert.deepEqual(ids(grid.query({ selfId: 1 }, new Set([2, 3, 4, 5]))), [1]);
});
test('AOI stream removes out-of-range entity and fully restores on re-entry', () => {
  const grid = new AoiGrid(); const stream = new ClientStream(1, 1); const receiver = new SnapshotReceiver(); let previous = new Set();
  for (const [tick, x, expected] of [[1, 80, true], [2, 88, true], [3, 89, false], [4, 84, false], [5, 79, true]]) {
    grid.rebuild([fixtureEntity(1), fixtureEntity(2, x)]); const view = grid.query({ selfId: 1 }, previous); previous = new Set(ids(view));
    receiver.apply(stream.encode(tick, view)); assert.equal(receiver.state.has(2), expected);
  }
});
test('rebuild rejects invalid entities atomically and constructors bound work', () => {
  const grid = new AoiGrid(); grid.rebuild([fixtureEntity(1)]);
  for (const value of [[fixtureEntity(1), fixtureEntity(1)], [{ ...fixtureEntity(1), x: NaN }]]) assert.throws(() => grid.rebuild(value));
  assert.deepEqual(ids(grid.query({ selfId: 1 })), [1]); assert.throws(() => grid.query({ selfId: 2 }));
  for (const args of [[0], [Infinity], [80, -1], [80, 81], [80, 8, 0]]) assert.throws(() => new AoiGrid(...args));
});
