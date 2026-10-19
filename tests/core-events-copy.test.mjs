// copyValue and immutable (src/sim/events.ts) copy the whole Area at every server snapshot. Their walk was rewritten without
// per-object entry arrays; this checks it against the previous implementation, kept here verbatim as the reference.
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyValue, freezeValue, immutable } from '../src/sim/events.ts';

function referenceCopy(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'undefined') return value;
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TypeError('Nonfinite simulation value'); return value; }
  if (typeof value !== 'object') throw new TypeError('Non-value simulation payload');
  if (seen.has(value)) throw new TypeError('Cyclic simulation payload');
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) throw new TypeError('Non-plain simulation payload');
  seen.add(value);
  const result = Array.isArray(value) ? value.map(v => referenceCopy(v, seen)) : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, referenceCopy(v, seen)]));
  seen.delete(value); return result;
}
const referenceImmutable = value => freezeValue(referenceCopy(value));

// Everything observable about a copied value: prototypes, own keys in order, holes, -0, frozenness and object identity
// (which nodes are the same object), and that no node is shared with the input.
function describe(value, input) {
  const ids = new Map(), inputs = new Set();
  const collect = v => { if (v && typeof v === 'object' && !inputs.has(v)) { inputs.add(v); for (const k of Reflect.ownKeys(v)) { const d = Object.getOwnPropertyDescriptor(v, k); if ('value' in d) collect(d.value); } } };
  collect(input);
  const walk = v => {
    if (typeof v === 'number') return Object.is(v, -0) ? '-0' : v;
    if (!v || typeof v !== 'object') return v === undefined ? '<undefined>' : v;
    assert.ok(!inputs.has(v), 'a copy never shares an object with its input');
    if (ids.has(v)) return `<same ${ids.get(v)}>`;
    ids.set(v, ids.size);
    const proto = Object.getPrototypeOf(v), kind = Array.isArray(v) ? `array ${v.length}` : proto === Object.prototype ? 'object' : proto === null ? 'null-proto' : 'other';
    return { kind, frozen: Object.isFrozen(v), keys: Reflect.ownKeys(v).map(k => {
      const d = Object.getOwnPropertyDescriptor(v, k);
      return [String(k), d.enumerable, d.writable, 'value' in d ? walk(d.value) : '<accessor>'];
    }) };
  };
  return walk(value);
}
const outcome = (run, input) => { try { return { value: describe(run(), input) }; } catch (error) { return { error: `${error.constructor.name}: ${error.message}` }; } };

test('copyValue and immutable match the previous walk for random valid and invalid values', () => {
  let seed = 0x2f6b9e17; const random = () => { seed = Math.imul(seed ^ seed >>> 15, 0x2c1b3c6d) + 0x9e3779b9 | 0; return ((seed ^ seed >>> 13) >>> 0) / 2 ** 32; };
  const pick = list => list[Math.floor(random() * list.length)];
  class Vector { constructor() { this.x = 1; } }
  class Items extends Array {}
  const shared = { s: 1, t: [1, 2] };
  const leaf = () => pick([null, undefined, true, false, 0, -0, 1.5, -7, 2 ** 53, 'a', '', 'w1', NaN, Infinity, -Infinity, shared, shared.t]);
  const odd = () => pick([() => 1, Symbol('s'), 10n, new Date(0), new Map(), new Vector(), Object.create({ inherited: 1 }), new Float32Array(2), /x/, Items.from([1, 2])]);
  const value = depth => {
    const r = random();
    if (depth > 4 || r < .3) return leaf();
    if (r < .33) return odd();
    if (r < .5) { const n = Math.floor(random() * 6), a = Array.from({ length: n }, () => value(depth + 1)); if (n > 2 && random() < .2) delete a[1]; if (random() < .1) a.extra = { e: 1 }; return a; }
    if (r < .53) { const o = Object.create(null); o.k = value(depth + 1); return o; }
    if (r < .55) return JSON.parse('{"__proto__":{"p":1},"z":2}');
    if (r < .57) { const o = { a: 1 }; o.self = random() < .5 ? o : { back: o }; return o; }
    if (r < .59) { const o = { b: 2 }; Object.defineProperty(o, 'hidden', { value: 3, enumerable: false }); return o; }
    const o = {}, n = Math.floor(random() * 6);
    for (let i = 0; i < n; i++) o[pick(['x', 'y', 'hp', 'pose', '10', '2', 'name', 'k' + i])] = value(depth + 1);
    if (random() < .1) o.again = o.x; // the same value twice in one object is copied twice, not a cycle
    return o;
  };
  let valid = 0, invalid = 0;
  for (let i = 0; i < 6000; i++) {
    const v = value(0);
    const expected = outcome(() => referenceCopy(v), v);
    assert.deepEqual(outcome(() => copyValue(v), v), expected, `copyValue case ${i}`);
    assert.deepEqual(outcome(() => immutable(v), v), outcome(() => referenceImmutable(v), v), `immutable case ${i}`);
    if (expected.error) invalid++; else valid++;
  }
  assert.ok(valid > 2000 && invalid > 500, JSON.stringify({ valid, invalid }));
});

test('immutable deep-freezes a detached copy and leaves the input mutable', () => {
  const input = { units: [{ ref: { id: 1 }, pose: { q: [0, 1, 2] } }, { ref: { id: 2 } }], tick: 3 };
  const out = immutable(input);
  assert.deepEqual(out, input); assert.ok(Object.isFrozen(out) && Object.isFrozen(out.units[0].pose.q));
  assert.ok(!Object.isFrozen(input) && !Object.isFrozen(input.units[0].pose.q));
  input.units[0].pose.q[0] = 9; assert.equal(out.units[0].pose.q[0], 0);
});
