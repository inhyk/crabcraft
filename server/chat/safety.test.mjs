import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAT, Moderation, Talk, reasonOf, sessionOf, shownName } from './safety.ts';

test('a player may send one line per 700 ms, five per ten seconds, and no exact repeat within thirty seconds', () => {
  const talk = new Talk();
  assert.deepEqual(talk.say('hello', 0), { text: 'hello' });
  assert.deepEqual(talk.say('again', 699), { refused: 'fast' });
  assert.deepEqual(talk.say('hello', 700), { refused: 'repeat' });
  for (const [i, at] of [700, 1400, 2100, 2800].entries()) assert.deepEqual(talk.say(`line ${i}`, at), { text: `line ${i}` });
  // Five lines since 0 ms: the sixth waits until the first is ten seconds old.
  assert.deepEqual(talk.say('one more', 3500), { refused: 'burst' });
  assert.deepEqual(talk.say('one more', 10000), { text: 'one more' });
  assert.deepEqual(talk.say('hello', 29999), { refused: 'repeat' });
  assert.deepEqual(talk.say('hello', 30000), { text: 'hello' });
  // Refused lines are not kept; nothing to send is not a refusal.
  assert.deepEqual(talk.lines.map(l => l.text), ['hello', 'line 0', 'line 1', 'line 2', 'line 3', 'one more', 'hello']);
  assert.equal(talk.say('   ', 40000), null);
  assert.equal(talk.say(42, 40000), null);
});

test('lines are filtered, a phone number split over lines is masked, and only the last twenty are kept', () => {
  const talk = new Talk();
  assert.deepEqual(talk.say('내 번호 010-1234-5678 이야', 0), { text: '내 번호 ************* 이야' });
  assert.deepEqual(talk.say('010', 1000), { text: '010' });
  assert.deepEqual(talk.say('1234', 2000), { text: '1234' });
  assert.deepEqual(talk.say('5678', 3000), { text: '****' });
  for (let i = 0; i < 30; i++) talk.say(`line ${i}`, 20000 + i * 2000);
  assert.equal(talk.lines.length, CHAT.lines);
  assert.equal(talk.lines.at(-1).text, 'line 29');
});

test('three different players reporting one player within ten minutes mute them for thirty minutes', () => {
  const mod = new Moderation(), min = 60_000;
  assert.deepEqual(mod.report('a', 'bad', 0), { ok: true, muted: false });
  // The same reporter twice, and a player reporting themselves, do not count.
  assert.deepEqual(mod.report('a', 'bad', 1000), { ok: false, muted: false });
  assert.deepEqual(mod.report('bad', 'bad', 1000), { ok: false, muted: false });
  assert.deepEqual(mod.report('b', 'bad', 2000), { ok: true, muted: false });
  assert.equal(mod.muted('bad', 2000), false);
  assert.deepEqual(mod.report('c', 'bad', 3000), { ok: true, muted: true });
  assert.equal(mod.muted('bad', 3000 + 30 * min - 1), true);
  assert.equal(mod.muted('bad', 3000 + 30 * min), false);
  // Reports older than ten minutes no longer count toward a mute.
  const slow = new Moderation();
  slow.report('a', 'x', 0); slow.report('b', 'x', 5 * min);
  assert.deepEqual(slow.report('c', 'x', 10 * min), { ok: true, muted: false });
  assert.equal(slow.muted('x', 10 * min), false);
  // One player can send ten reports in ten minutes.
  const busy = new Moderation();
  for (let i = 0; i < 10; i++) assert.equal(busy.report('r', `t${i}`, i).ok, true);
  assert.equal(busy.report('r', 't10', 11).ok, false);
  assert.equal(busy.report('r', 't10', 10 * min).ok, true);
  busy.sweep(40 * min); mod.sweep(40 * min);
  assert.equal(mod.muted('bad', 40 * min), false);
});

test('names, sessions and reasons from the client are checked', () => {
  assert.equal(shownName('Test crab'), 'Test crab');
  assert.equal(shownName('시발크랩'), '게 모험가');
  assert.equal(shownName('call 01012345678'), '게 모험가');
  assert.equal(sessionOf('abcdefghijklmnop', 'fallback'), 'abcdefghijklmnop');
  for (const bad of ['short', 'has space in it at all', 42, null, 'x'.repeat(65)]) assert.equal(sessionOf(bad, 'fallback'), 'fallback');
  assert.equal(reasonOf('personal'), 'personal');
  assert.equal(reasonOf('욕설'), null);
  assert.equal(reasonOf('__proto__'), null);
});
