import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import pg from 'pg';
import { startPostgres } from '../node/local-postgres.mjs';
import { migrate } from '../node/db.ts';
import { CHAT } from '../chat/safety.ts';
import { WorldChatService, MAX_CHAT_TARGETS, MAX_CHAT_AUDIENCE } from './chat.ts';

const A = 'g' + 'a'.repeat(23), B = 'g' + 'b'.repeat(23), C = 'g' + 'c'.repeat(23), D = 'g' + 'd'.repeat(23);
const member = (accountId, id, extra = {}) => ({ accountId, ref: { area: 'w1:public:1', id, life: 1 }, name: '모험가' + id, partyId: null, ...extra });
const a = member(A, 1), b = member(B, 2), c = member(C, 3), d = member(D, 4);
const refs = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.recipients.map(r => r.id).sort((x, y) => x - y); };
let postgres, pool, service, now;
const live = new Set();
before(async () => {
  postgres = await startPostgres(); pool = new pg.Pool({ connectionString: postgres.url });
  pool.on('connect', client => { live.add(client); client.once('end', () => live.delete(client)); });
  await migrate(pool);
});
beforeEach(async () => {
  now = 1_800_000_000_000;
  await pool.query('TRUNCATE world_chat_targets,world_chat_accounts,chat_reports RESTART IDENTITY');
  await pool.query(`INSERT INTO accounts(username,updated,created) SELECT unnest($1::text[]),1,1 ON CONFLICT DO NOTHING`, [[A, B, C, D]]);
  service = new WorldChatService(pool, () => now);
});
after(async () => {
  const closed = [...live].map(client => once(client, 'end'));
  await pool?.end(); await Promise.all(closed); postgres?.stop();
});

test('preferences are private account state; changing one account never changes another', async () => {
  assert.deepEqual(await service.preferences(A), { ok: true, enabled: true, partyOnly: false });
  assert.deepEqual(await service.setPreferences(A, { enabled: false, partyOnly: true }), { ok: true, enabled: false, partyOnly: true });
  assert.deepEqual(await service.preferences(B), { ok: true, enabled: true, partyOnly: false });
  assert.deepEqual(await service.say(a, 'hello', [a, b]), { ok: false, error: 'off' });
  for (const value of [undefined, [], {}, { accountId: B }, { enabled: 'true' }, { partyOnly: 1 }]) assert.deepEqual(await service.setPreferences(A, value), { ok: false, error: 'invalid' });
  assert.deepEqual(await service.preferences('guest'), { ok: false, error: 'invalid' });
  assert.deepEqual(await service.preferences('g' + 'e'.repeat(23)), { ok: false, error: 'unavailable' });
});

test('the actual Talk filter masks Korean abuse, contact, links and names before presentation or storage', async () => {
  const result = await service.say({ ...a, name: '시발크랩' }, '시발 010-1234-5678 example.com 카톡 abc123', [a, b]);
  assert.deepEqual(refs(result), [1, 2]);
  assert.equal(result.line.name, '게 모험가');
  for (const raw of ['시발', '010-1234-5678', 'example.com', 'abc123', A, B]) assert(!JSON.stringify(result).includes(raw));
  assert(result.line.text.includes('*'));
  const state = (await pool.query('SELECT talk FROM world_chat_accounts WHERE account_id=$1', [A])).rows[0].talk;
  assert.deepEqual(state.lines, [{ at: now, text: result.line.text }]);
  assert(Object.isFrozen(result.line)); assert(Object.isFrozen(result.line.sender)); assert(Object.isFrozen(result.recipients));
});

test('reconnect and alternate characters share exact gap, burst, repeat and split-phone state across pools', async () => {
  assert.equal((await service.say(a, '010', [a, b])).ok, true);
  const otherPool = new pg.Pool({ connectionString: postgres.url });
  try {
    const reconnect = new WorldChatService(otherPool, () => now), alt = member(A, 21);
    now += 699; assert.deepEqual(await reconnect.say(alt, '1234', [alt, b]), { ok: false, error: 'fast' });
    now += 1; assert.equal((await reconnect.say(alt, '1234', [alt, b])).ok, true);
    now += 700; assert.equal((await new WorldChatService(pool, () => now).say(a, '5678', [a, b])).line.text, '****');
    now += 700; await service.say(a, 'four', [a, b]);
    now += 700; await reconnect.say(alt, 'five', [alt, b]);
    now += 700; assert.deepEqual(await service.say(a, 'six', [a, b]), { ok: false, error: 'burst' });
    now += 10_000; assert.deepEqual(await reconnect.say(alt, '010', [alt, b]), { ok: false, error: 'repeat' });
    now += 30_000; assert.equal((await reconnect.say(alt, '010', [alt, b])).ok, true);
  } finally { await otherPool.end(); }
});

test('same-account self/alt reports and duplicate reporter alts cannot manufacture distinct reporters', async () => {
  assert.deepEqual(await service.report(a, member(A, 22), a.ref.area, 'abuse'), { ok: false, error: 'invalid' });
  assert.deepEqual(await service.report(b, a, a.ref.area, 'abuse'), { ok: true, muted: false });
  assert.deepEqual(await service.report(member(B, 23), member(A, 24), a.ref.area, 'other'), { ok: false, error: 'duplicate' });
  assert.equal((await pool.query('SELECT count(*)::int n FROM chat_reports')).rows[0].n, 1);
  assert.equal((await pool.query('SELECT mute_until FROM world_chat_accounts WHERE account_id=$1', [A])).rows[0].mute_until, '0');
});

test('three concurrent distinct account reports commit exactly one persistent shadow mute', async () => {
  const other = new pg.Pool({ connectionString: postgres.url });
  try {
    const second = new WorldChatService(other, () => now);
    const results = await Promise.all([service.report(b, a, a.ref.area, 'abuse'), second.report(c, a, a.ref.area, 'personal'), service.report(d, a, a.ref.area, 'harassment')]);
    assert(results.every(r => r.ok)); assert.equal(results.filter(r => r.muted).length, 1);
    assert.equal((await pool.query('SELECT count(*)::int n FROM chat_reports WHERE muted')).rows[0].n, 1);
    const restart = new WorldChatService(other, () => now);
    assert.deepEqual(refs(await restart.say(member(A, 10), 'after restart', [member(A, 10), b, c, d])), [10]);
    now += CHAT.muteMs;
    assert.deepEqual(refs(await restart.say(a, 'mute expired', [a, b])), [1, 2]);
  } finally { await other.end(); }
});

test('report window expiry and ten reports per reporter use persisted account records', async () => {
  const targets = Array.from({ length: 11 }, (_, i) => 'g' + (100 + i).toString(16).padStart(23, '0'));
  await pool.query('INSERT INTO accounts(username,updated,created) SELECT unnest($1::text[]),1,1', [targets]);
  for (let i = 0; i < CHAT.reportsEach; i++) assert.equal((await service.report(a, member(targets[i], 10 + i), a.ref.area, 'other')).ok, true);
  assert.deepEqual(await new WorldChatService(pool, () => now).report(member(A, 99), member(targets[10], 50), a.ref.area, 'other'), { ok: false, error: 'limit' });
  now += CHAT.reportMs;
  assert.deepEqual(await service.report(a, member(targets[10], 50), a.ref.area, 'other'), { ok: true, muted: false });
  await service.report(b, d, a.ref.area, 'other'); now += CHAT.reportMs;
  await service.report(c, d, a.ref.area, 'other');
  assert.deepEqual(await service.report(a, d, a.ref.area, 'other'), { ok: true, muted: false });
});

test('block and local mute persist across restart and hide all characters of the target account', async () => {
  assert.deepEqual(await service.block(B, a, true), { ok: true });
  assert.deepEqual(refs(await new WorldChatService(pool, () => now).say(member(A, 11), 'hidden alt', [member(A, 11), b, c])), [3, 11]);
  assert.deepEqual(await service.mute(B, a, true), { ok: true });
  await service.block(B, member(A, 12), false);
  now += 1000; assert.deepEqual(refs(await service.say(a, 'still locally muted', [a, b])), [1]);
  await service.mute(B, a, false);
  now += 1000; assert.deepEqual(refs(await service.say(a, 'visible again', [a, b])), [1, 2]);
  assert.equal((await pool.query('SELECT count(*)::int n FROM world_chat_targets')).rows[0].n, 0);
  assert.deepEqual(await service.block(A, member(A, 12), true), { ok: false, error: 'invalid' });
});

test('off and party-only apply to sender and recipients, with host-bound area and party audience', async () => {
  const pa = { ...a, partyId: 'ABCDEF' }, pb = { ...b, partyId: 'ABCDEF' }, pc = { ...c, partyId: '123456' };
  await service.setPreferences(B, { partyOnly: true });
  assert.deepEqual(refs(await service.say(a, 'public no party', [a, b, c])), [1, 3]);
  now += 1000; assert.deepEqual(refs(await service.say(pa, 'shared party', [pa, pb, pc])), [1, 2, 3]);
  await service.setPreferences(A, { partyOnly: true });
  now += 1000; assert.deepEqual(refs(await new WorldChatService(pool, () => now).say(pa, 'party preference', [pa, pb, pc])), [1, 2]);
  now += 1000; assert.deepEqual(await service.say(a, 'no party', [a, b]), { ok: false, error: 'party' });
  await service.setPreferences(B, { enabled: false });
  now += 1000; assert.deepEqual(refs(await service.say(pa, 'recipient off', [pa, pb])), [1]);
  await service.setPreferences(B, { enabled: true });
  const away = { ...pb, ref: { ...pb.ref, area: 'w2:public:2' } };
  now += 1000; assert.deepEqual(refs(await service.say(pa, 'area boundary', [pa, away])), [1]);
  now += 10_000; assert.deepEqual(refs(await service.say(pa, 'party across worlds', [pa, away], 'party')), [1, 2]);
});

test('reports retain at most twenty masked lines and public references, without session/provider metadata', async () => {
  for (let i = 0; i < 25; i++) { await service.say(a, `시발 example.com 01012345678 line ${i}`, [a, b]); now += 11_000; }
  assert.deepEqual(await service.report({ ...b, name: '카톡 abc123' }, { ...a, name: '01012345678' }, a.ref.area, 'personal'), { ok: true, muted: false });
  const row = (await pool.query('SELECT * FROM chat_reports')).rows[0];
  assert.equal(row.reporter_account, B); assert.equal(row.target_account, A);
  assert.equal(row.target_lines.length, CHAT.lines);
  assert.equal(row.reporter_session, JSON.stringify([b.ref.area, b.ref.id, b.ref.life]));
  assert.equal(row.target_session, JSON.stringify([a.ref.area, a.ref.id, a.ref.life]));
  const json = JSON.stringify(row);
  for (const raw of ['시발', 'example.com', '01012345678', 'abc123', 'token', 'email', 'google_sub', 'sessionKey']) assert(!json.includes(raw));
  assert.equal(row.reporter_name, '게 모험가'); assert.equal(row.target_name, '게 모험가');
});

test('failed talk write rolls back rate state and returns unavailable before any delivery', async () => {
  await service.preferences(A);
  await pool.query(`CREATE FUNCTION test_chat_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$;
    CREATE TRIGGER test_chat_failure BEFORE UPDATE ON world_chat_accounts FOR EACH ROW EXECUTE FUNCTION test_chat_failure()`);
  try { assert.deepEqual(await service.say(a, 'retry same line', [a, b]), { ok: false, error: 'unavailable' }); }
  finally { await pool.query('DROP TRIGGER test_chat_failure ON world_chat_accounts; DROP FUNCTION test_chat_failure()'); }
  assert.deepEqual((await pool.query('SELECT talk FROM world_chat_accounts WHERE account_id=$1', [A])).rows[0].talk, { sent: [], lines: [] });
  assert.deepEqual(refs(await service.say(a, 'retry same line', [a, b])), [1, 2]);
});

test('third-report database failure rolls back its report, mute and watermark atomically', async () => {
  await service.report(b, a, a.ref.area, 'abuse'); await service.report(c, a, a.ref.area, 'abuse');
  await pool.query(`CREATE FUNCTION test_report_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$;
    CREATE TRIGGER test_report_failure BEFORE UPDATE ON chat_reports FOR EACH ROW EXECUTE FUNCTION test_report_failure()`);
  try { assert.deepEqual(await service.report(d, a, a.ref.area, 'abuse'), { ok: false, error: 'unavailable' }); }
  finally { await pool.query('DROP TRIGGER test_report_failure ON chat_reports; DROP FUNCTION test_report_failure()'); }
  assert.equal((await pool.query('SELECT count(*)::int n FROM chat_reports')).rows[0].n, 2);
  const state = (await pool.query('SELECT mute_until,report_watermark FROM world_chat_accounts WHERE account_id=$1', [A])).rows[0];
  assert.deepEqual(state, { mute_until: '0', report_watermark: '0' });
  assert.deepEqual(await service.report(d, a, a.ref.area, 'abuse'), { ok: true, muted: true });
});

test('corrupt persisted Talk, closed database and oversized audience fail closed without throwing', async () => {
  await service.preferences(A);
  await pool.query(`UPDATE world_chat_accounts SET talk='{"sent":[],"lines":[{"at":1,"text":"01012345678"}]}' WHERE account_id=$1`, [A]);
  assert.deepEqual(await service.say(a, 'must not send', [a, b]), { ok: false, error: 'unavailable' });
  assert.deepEqual(await service.report(b, a, a.ref.area, 'other'), { ok: false, error: 'unavailable' });
  assert.equal((await pool.query('SELECT count(*)::int n FROM chat_reports')).rows[0].n, 0);
  assert.deepEqual(await service.say(a, 'large', Array(MAX_CHAT_AUDIENCE + 1).fill(b)), { ok: false, error: 'invalid' });
  const closed = new pg.Pool({ connectionString: postgres.url }); await closed.end();
  assert.deepEqual(await new WorldChatService(closed).setPreferences(A, { enabled: false }), { ok: false, error: 'unavailable' });
});

test('account target storage has a fixed cap and an existing edge remains removable at capacity', async () => {
  const ids = Array.from({ length: MAX_CHAT_TARGETS + 1 }, (_, i) => 'g' + (10000 + i).toString(16).padStart(23, '0'));
  await pool.query('INSERT INTO accounts(username,updated,created) SELECT unnest($1::text[]),1,1', [ids]);
  await service.preferences(A);
  await pool.query('INSERT INTO world_chat_targets(owner_account,target_account,blocked) SELECT $1,unnest($2::text[]),true', [A, ids.slice(0, MAX_CHAT_TARGETS)]);
  assert.deepEqual(await service.block(A, member(ids.at(-1), 700), true), { ok: false, error: 'limit' });
  assert.deepEqual(await service.block(A, member(ids[0], 701), false), { ok: true });
  assert.deepEqual(await service.mute(A, member(ids.at(-1), 700), true), { ok: true });
  assert.equal((await pool.query('SELECT count(*)::int n FROM world_chat_targets WHERE owner_account=$1', [A])).rows[0].n, MAX_CHAT_TARGETS);
});
