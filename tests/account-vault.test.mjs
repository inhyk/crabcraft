// The Royal Vault's account handling: the account servers' bundle check (server/node/accounts.ts bundleOf; the
// Cloudflare copy keeps the same rules), the browser's bundle and its load (src/accountStorage.ts) on a stand-in
// localStorage, and the vault's arithmetic (src/game/tidecrown/vaultLedger.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bundleOf, VAULT_KEY, vaultOf } from '../server/node/accounts.ts';
import { applyBundle, progressKey, readBundle, setSaveProfile, storageKey, VAULT_KEY as CLIENT_VAULT_KEY } from '../src/accountStorage.ts';
import { VAULT_AMOUNTS, vaultAfter, vaultAmount, vaultCoins, vaultValue } from '../src/game/tidecrown/vaultLedger.ts';

/** localStorage as the browser keeps it, enough for accountStorage.ts (keys in sorted order, as Chromium lists them). */
class Storage {
  map = new Map();
  get length() { return this.map.size; }
  key(i) { return [...this.map.keys()].sort()[i] ?? null; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
const fresh = () => (globalThis.localStorage = new Storage());

const SPEC = { race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'Vault crab' };
const OTHER = { ...SPEC, classId: 'mage', name: 'Second crab' };
const journeyKey = (s) => `cc.journey.v1:${s.race}:${s.sex}:${s.classId}:${s.name}`;
const journey = (coins, xp = 137) => JSON.stringify({ xp, coins, chapter: 1 });
const MAX = Number.MAX_SAFE_INTEGER;

test('the account server accepts a bundle with a valid vault, and one without it', () => {
  assert.equal(VAULT_KEY, 'cc.vault.v1');
  assert.equal(CLIENT_VAULT_KEY, VAULT_KEY);
  const base = { 'cc.spec': JSON.stringify(SPEC), [journeyKey(SPEC)]: journey(73) };
  assert.deepEqual(bundleOf(base), base, 'a bundle from a page before the vault is still valid');
  for (const coins of [0, 1, 100, 123456789, MAX]) {
    const save = { ...base, [VAULT_KEY]: JSON.stringify({ coins }) };
    assert.deepEqual(bundleOf(save), save, `coins ${coins}`);
  }
  // The vault alone (no character yet) is a valid bundle too.
  assert.deepEqual(bundleOf({ [VAULT_KEY]: '{"coins":5}' }), { [VAULT_KEY]: '{"coins":5}' });
});

test('the account server rejects a vault that is not a whole, non-negative, safe number of coins, or is oversize', () => {
  const base = { 'cc.spec': JSON.stringify(SPEC), [journeyKey(SPEC)]: journey(73) };
  const bad = [
    '{"coins":1.5}', '{"coins":-1}', '{"coins":"100"}', '{"coins":null}', '{"coins":true}', '{}', '[]', 'null', '7', '"coins"', 'not json',
    `{"coins":${MAX + 1}}`, '{"coins":1e300}', '{"coins":NaN}', `{"coins":1,"note":"${'x'.repeat(200)}"}`, '',
  ];
  for (const v of bad) {
    assert.equal(vaultOf(v), false, v.slice(0, 40));
    assert.equal(bundleOf({ ...base, [VAULT_KEY]: v }), null, v.slice(0, 40));
  }
  // Not a string at all.
  for (const v of [100, { coins: 100 }, null]) assert.equal(bundleOf({ ...base, [VAULT_KEY]: v }), null, JSON.stringify(v));
  // The other keys keep their own checks.
  assert.equal(bundleOf({ ...base, [VAULT_KEY]: '{"coins":1}', 'cc.musicVol': '1' }), null);
  assert.equal(bundleOf({ 'cc.spec': 'null', [VAULT_KEY]: '{"coins":1}' }), null);
  assert.equal(bundleOf({ [journeyKey(SPEC)]: JSON.stringify({ xp: -1 }), [VAULT_KEY]: '{"coins":1}' }), null);
});

test('the vault is a progress key: per account when signed in, per device for a guest', () => {
  fresh();
  assert.equal(progressKey(VAULT_KEY), true);
  setSaveProfile('');
  assert.equal(storageKey(VAULT_KEY), VAULT_KEY);
  setSaveProfile('g0123456789abcdef0123456');
  assert.equal(storageKey(VAULT_KEY), 'cc.account.v1:g0123456789abcdef0123456:cc.vault.v1');
  assert.equal(storageKey('cc.language'), 'cc.language', 'settings stay per device');
  setSaveProfile('');
});

test('the bundle carries the vault with the selected character only, for a guest and for an account', () => {
  fresh();
  const user = 'g0123456789abcdef0123456', pre = `cc.account.v1:${user}:`;
  // Guest keys, and an account's keys beside them.
  localStorage.setItem('cc.spec', JSON.stringify(SPEC));
  localStorage.setItem(journeyKey(SPEC), journey(10));
  localStorage.setItem(journeyKey(OTHER), journey(20));
  localStorage.setItem(VAULT_KEY, vaultValue(30));
  localStorage.setItem('cc.language', 'ko');
  localStorage.setItem(pre + 'cc.spec', JSON.stringify(OTHER));
  localStorage.setItem(pre + journeyKey(OTHER), journey(40));
  localStorage.setItem(pre + journeyKey(SPEC), journey(50));
  localStorage.setItem(pre + VAULT_KEY, vaultValue(60));
  assert.deepEqual(readBundle(''), { 'cc.spec': JSON.stringify(SPEC), [journeyKey(SPEC)]: journey(10), [VAULT_KEY]: vaultValue(30) });
  assert.deepEqual(readBundle(user), { 'cc.spec': JSON.stringify(OTHER), [journeyKey(OTHER)]: journey(40), [VAULT_KEY]: vaultValue(60) });
  // The bundle a page saves passes the server's check as it is.
  assert.ok(bundleOf(readBundle(user)));
  // Without a character there is nothing to save, vault or not.
  localStorage.removeItem(pre + 'cc.spec');
  assert.deepEqual(readBundle(user), {});
});

test('loading a cloud save takes its vault with its journey, and never keeps a vault the save does not hold', () => {
  fresh();
  const user = 'g0123456789abcdef0123456', pre = `cc.account.v1:${user}:`;
  // This device: an unsynced deposit (journey 0, vault 100), another character's journey, the guest vault.
  localStorage.setItem(pre + 'cc.spec', JSON.stringify(SPEC));
  localStorage.setItem(pre + journeyKey(SPEC), journey(0));
  localStorage.setItem(pre + journeyKey(OTHER), journey(5));
  localStorage.setItem(pre + VAULT_KEY, vaultValue(100));
  localStorage.setItem(VAULT_KEY, vaultValue(7));
  // The cloud holds the other device's newer save, from before the deposit: 100 coins carried, no vault yet.
  const cloud = { 'cc.spec': JSON.stringify(SPEC), [journeyKey(SPEC)]: journey(100) };
  applyBundle(user, cloud);
  assert.equal(localStorage.getItem(pre + journeyKey(SPEC)), journey(100));
  assert.equal(localStorage.getItem(pre + VAULT_KEY), null, 'the unsynced vault goes with the unsynced journey: 100 coins, not 200');
  assert.equal(localStorage.getItem(pre + journeyKey(OTHER)), null);
  assert.equal(localStorage.getItem(VAULT_KEY), vaultValue(7), 'the guest vault is untouched');
  // A cloud save with a vault brings both halves of its moves.
  applyBundle(user, { ...cloud, [journeyKey(SPEC)]: journey(40), [VAULT_KEY]: vaultValue(60) });
  assert.equal(localStorage.getItem(pre + journeyKey(SPEC)), journey(40));
  assert.equal(localStorage.getItem(pre + VAULT_KEY), vaultValue(60));
  // A first sign-in takes the guest adventure, vault included.
  fresh();
  localStorage.setItem('cc.spec', JSON.stringify(SPEC));
  localStorage.setItem(journeyKey(SPEC), journey(1));
  localStorage.setItem(VAULT_KEY, vaultValue(2));
  applyBundle(user, readBundle(''));
  assert.deepEqual(readBundle(user), { 'cc.spec': JSON.stringify(SPEC), [journeyKey(SPEC)]: journey(1), [VAULT_KEY]: vaultValue(2) });
});

test('vault arithmetic: exact amounts, "all", short and full sides, and safe integers throughout', () => {
  assert.deepEqual([...VAULT_AMOUNTS], [100, 1000, 10000]);
  assert.equal(vaultCoins(null), 0);
  assert.equal(vaultCoins(vaultValue(250)), 250);
  for (const broken of ['{"coins":-3}', '{"coins":2.5}', 'x', '[]', 'null', `{"coins":${MAX + 1}}`]) assert.equal(vaultCoins(broken), null, broken);
  assert.equal(vaultAmount(1234, 0, 'deposit', 100), 100);
  assert.equal(vaultAmount(1234, 0, 'deposit', 1000), 1000);
  assert.equal(vaultAmount(1234, 0, 'deposit', 10000), 0, 'not enough carried');
  assert.equal(vaultAmount(1234, 0, 'deposit', 'all'), 1234);
  assert.equal(vaultAmount(0, 0, 'deposit', 'all'), 0);
  assert.equal(vaultAmount(5, 99, 'withdraw', 100), 0, 'not enough in the vault');
  assert.equal(vaultAmount(5, 99, 'withdraw', 'all'), 99);
  assert.deepEqual(vaultAfter(1234, 0, 'deposit', 1000), { carried: 234, vault: 1000 });
  assert.deepEqual(vaultAfter(234, 1000, 'withdraw', 100), { carried: 334, vault: 900 });
  // Never above the safe-integer limit on the taking side: "all" moves what fits.
  assert.equal(vaultAmount(500, MAX - 100, 'deposit', 1000), 0);
  assert.equal(vaultAmount(500, MAX - 100, 'deposit', 100), 100);
  assert.equal(vaultAmount(500, MAX - 100, 'deposit', 'all'), 100);
  assert.equal(vaultAmount(MAX, MAX, 'withdraw', 'all'), 0);
  assert.equal(vaultAmount(MAX - 10, 50, 'withdraw', 'all'), 10);
  // Anything that is not a whole positive amount, or sides that are not coins, move nothing.
  for (const amount of [0, -100, 1.5, NaN, Infinity]) assert.equal(vaultAmount(1000, 1000, 'deposit', amount), 0, String(amount));
  assert.equal(vaultAmount(-1, 1000, 'withdraw', 100), 0);
  assert.equal(vaultAmount(1000, 0.5, 'deposit', 100), 0);
  // Every move keeps the total.
  for (const [c, v, move, a] of [[1234, 0, 'deposit', 'all'], [10, 99999, 'withdraw', 10000], [MAX - 100, 50, 'withdraw', 'all']]) {
    const n = vaultAmount(c, v, move, a), after = vaultAfter(c, v, move, n);
    assert.equal(after.carried + after.vault, c + v);
    assert.ok(Number.isSafeInteger(after.carried) && Number.isSafeInteger(after.vault) && after.carried >= 0 && after.vault >= 0);
  }
});
