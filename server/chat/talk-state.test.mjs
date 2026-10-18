import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAT, Talk } from './safety.ts';

test('server Talk state restore and snapshot do not alias caller arrays or lines', () => {
  const source = new Talk(); source.say('hello', 1000);
  const state = source.snapshot(), restored = new Talk(state);
  state.sent.length = 0; state.lines[0].text = 'changed'; state.lines.length = 0;
  assert.deepEqual(restored.say('again', 1699), { refused: 'fast' });
  assert.deepEqual(restored.say('hello', 1700), { refused: 'repeat' });
  const copy = restored.snapshot(); copy.lines[0].at = 0; copy.lines[0].text = 'changed'; copy.sent[0] = 0;
  assert.deepEqual(restored.snapshot(), { sent: [1000], lines: [{ at: 1000, text: 'hello' }] });
});

test('server Talk state preserves split phone and burst state exactly at restart', () => {
  let talk = new Talk(); talk.say('010', 0); talk.say('1234', 700);
  talk = new Talk(talk.snapshot()); assert.deepEqual(talk.say('5678', 1400), { text: '****' });
  talk.say('four', 2100); talk.say('five', 2800);
  talk = new Talk(talk.snapshot()); assert.deepEqual(talk.say('six', 3500), { refused: 'burst' });
  assert.deepEqual(talk.say('six', CHAT.burstMs), { text: 'six' });
});

test('restore rejects corrupt shape, accessors, sparse arrays, nonfinite times, excess history and unfiltered text', () => {
  let getterCalls = 0;
  const getter = Object.defineProperty({}, 'sent', { get() { getterCalls++; return []; }, enumerable: true }); getter.lines = [];
  const lineGetter = Object.defineProperty({ at: 1 }, 'text', { get() { getterCalls++; return 'hello'; }, enumerable: true });
  const arrayGetter = [1]; Object.defineProperty(arrayGetter, 0, { get() { getterCalls++; return 1; } });
  const bad = [null, [], {}, { sent: [], lines: [], extra: true }, getter, { sent: arrayGetter, lines: [] },
    { sent: [], lines: [lineGetter] }, { sent: Array(1), lines: [] }, { sent: [Infinity], lines: [] },
    { sent: [NaN], lines: [] }, { sent: [-1], lines: [] }, { sent: [1.5], lines: [] }, { sent: [2, 1], lines: [] },
    { sent: Array(CHAT.burst + 1).fill(0), lines: [] }, { sent: [], lines: Array(CHAT.lines + 1).fill({ at: 0, text: 'hello' }) },
    { sent: [], lines: [{ at: 0, text: '시발' }] }, { sent: [], lines: [{ at: 0, text: '01012345678' }] },
    { sent: [], lines: [{ at: 0, text: 'x'.repeat(201) }] }, { sent: [], lines: [{ at: 0, text: '' }] },
    { sent: [], lines: [{ at: -1, text: 'hello' }] }, { sent: [], lines: [{ at: 2, text: 'hello' }, { at: 1, text: 'bye' }] }];
  for (const state of bad) assert.throws(() => new Talk(state), /invalid talk state/);
  assert.equal(getterCalls, 0);
  assert.deepEqual(new Talk().snapshot(), { sent: [], lines: [] });
});
