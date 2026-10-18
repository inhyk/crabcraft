import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// The browser's blocklist (src/multiplayer/chatSafety.ts) with in-memory storage; a new Blocklist reads it like a reload.
const require = createRequire(import.meta.url), esbuild = require(require.resolve('esbuild', { paths: [require.resolve('wrangler')] }));
esbuild.buildSync({ entryPoints: ['src/multiplayer/chatSafety.ts'], bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: 'tmp/test-modules/chatSafety.js' });
const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear() }; };
globalThis.localStorage = memory(); globalThis.sessionStorage = memory();
const { Blocklist } = await import(pathToFileURL('tmp/test-modules/chatSafety.js').href);
const fresh = () => { localStorage.clear(); sessionStorage.clear(); };

test('a block follows the chosen name, not the arrival number the server added to it', () => {
  fresh();
  new Blocklist().block('p2', 'Crab #2');
  sessionStorage.clear(); // next visit: the server ids are gone, the name stays
  const later = new Blocklist();
  assert.equal(later.has('p7', 'Crab'), true, 'the same player back without a number is still blocked');
  assert.equal(later.has('p8', 'Crab #3'), true);
  assert.equal(later.has('p9', 'Crabby'), false);
  assert.deepEqual(later.list(), ['Crab']);
  later.unblock('Crab #4');
  assert.equal(new Blocklist().has('p7', 'Crab'), false);
});

test('a numbered neutral name is blocked by server id only, so the next renamed stranger is not', () => {
  fresh();
  new Blocklist().block('n2', '게 모험가 #2');
  const same = new Blocklist();
  assert.equal(same.has('n2', '게 모험가 #2'), true);
  assert.equal(same.has('n5', '게 모험가 #2'), false);
  assert.equal(same.has('n6', '게 모험가'), false);
  assert.equal(localStorage.getItem('cc.chat.blockedNames'), null);
  same.unblock('게 모험가 #2');
  assert.equal(new Blocklist().has('n2', '게 모험가 #2'), false);
});

test('names saved with a number before this change are read as the chosen name', () => {
  fresh();
  localStorage.setItem('cc.chat.blockedNames', JSON.stringify(['Crab #2', 'Crab', 'Shelly #3']));
  const list = new Blocklist();
  assert.deepEqual(list.list(), ['Crab', 'Shelly']);
  assert.equal(list.has('x', 'Shelly'), true);
});
