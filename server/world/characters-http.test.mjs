import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { startPostgres } from '../node/local-postgres.mjs';
import { migrate } from '../node/db.ts';
import { accountHandler } from '../node/accounts.ts';
import { CharacterStore } from './character-store.ts';
import { createCharacterHandler } from './characters-http.ts';
import { createCoreCharacterCodec } from '../../src/sim/persistence.ts';
import { CLASSES } from '../../src/sim/data/classes.ts';

const ROUTE = '/api/account/world-characters', ORIGIN = 'https://crab.seonn.dev', OTHER = 'https://crab-dev.seonn.dev';
const appearance = { race: 'human', sex: 'female', classId: 'warrior', shell: 3, crest: 2, led: 1, name: '새 게' };
const races = ['human', 'orc', 'dwarf', 'undead', 'nightelf', 'tauren'];
const codec = createCoreCharacterCodec({ identities: races.flatMap(archetype => Object.keys(CLASSES).map(classId => ({ classId, archetype }))), freshLocation: { x: 0, y: 0, z: 0, yaw: 0 } });
let postgres, pool, characters;
before(async () => {
  try { postgres = await startPostgres(); pool = new pg.Pool({ connectionString: postgres.url }); await migrate(pool); characters = new CharacterStore(pool, codec); }
  catch (e) { await pool?.end(); postgres?.stop(); throw e; }
});
after(async () => { try { await pool?.end(); } finally { postgres?.stop(); } });
async function session() {
  const accountId = 'g' + randomBytes(12).toString('hex').slice(0, 23), token = randomBytes(32).toString('hex'), key = createHash('sha256').update(token).digest('hex');
  await pool.query('INSERT INTO accounts(username,save,revision,updated,created) VALUES($1,$2,47,123,100)', [accountId, '{"legacy-progress":{"xp":999999,"coins":999999}}']);
  await pool.query('INSERT INTO sessions(token_hash,username,expires) VALUES($1,$2,$3)', [key, accountId, Date.now() + 60000]);
  return { accountId, key, token, cookie: `cc_account=${accountId}.${token}` };
}
async function withHttp(fn, policy = { maxCharactersPerAccount: 10 }, options = {}) {
  const ip = 'character-test-' + randomBytes(8).toString('hex'), clientIp = req => String(req.headers['x-forwarded-for'] ?? ip);
  const handler = createCharacterHandler({ pool, characters, codec, origins: [ORIGIN, OTHER], clientIp, policy, ...options });
  const legacy = accountHandler(pool, [ORIGIN, OTHER], clientIp, null);
  const server = createServer((req, res) => { void (req.url?.startsWith(ROUTE) ? handler(req, res) : legacy(req, res)); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port;
  const http = (method, { cookie, path = ROUTE, body, headers = {} } = {}) => new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : Buffer.isBuffer(body) ? body : typeof body === 'string' ? body : JSON.stringify(body);
    const req = request({ hostname: '127.0.0.1', port, method, path, headers: {
      Host: 'crab.seonn.dev', Origin: ORIGIN, 'X-Crabcraft-Account': '1', ...(cookie ? { Cookie: cookie } : {}),
      ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers,
    } }, res => { let text = ''; res.on('data', data => text += data); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: JSON.parse(text) })); });
    req.on('error', reject); req.end(payload);
  });
  const create = (cookie, value = appearance) => http('POST', { cookie, body: { appearance: value } });
  try { await fn({ http, create }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('actual core codec creates fresh level 1 from full appearance; legacy save and sessions stay unchanged', async () => {
  const a = await session(), before = (await pool.query('SELECT * FROM accounts WHERE username=$1', [a.accountId])).rows[0];
  await withHttp(async ({ create, http }) => {
    const created = await create(a.cookie); assert.equal(created.status, 201); assert.match(created.headers['cache-control'], /no-store/);
    assert.deepEqual(Object.keys(created.json.character).sort(), ['characterId', 'identity', 'updatedAt']);
    assert.deepEqual(created.json.character.identity, { schema: 'world-identity-v1', classId: appearance.classId, archetype: appearance.race, appearance });
    const saved = await characters.getOwned(a.accountId, created.json.character.characterId);
    assert.equal(saved.checkpoint.progress.xp, 0); assert.equal(saved.checkpoint.progress.coins, 0); assert.equal(saved.revision, 0);
    assert.deepEqual(saved.checkpoint.progress.flags, {}); assert.equal(saved.checkpoint.progress.attackRank, 0);
    assert.equal(saved.checkpoint.world, 'w1'); assert.equal(saved.checkpoint.character, saved.characterId);
    assert.deepEqual((await pool.query('SELECT * FROM accounts WHERE username=$1', [a.accountId])).rows[0], before);
    const listed = await http('GET', { cookie: a.cookie }); assert.equal(listed.status, 200); assert.deepEqual(listed.json, { characters: [created.json.character], nextAfter: null });
    for (const secret of [a.token, a.key, a.accountId, 'checkpoint', '999999']) assert(!listed.text.includes(secret));
    const logout = await http('POST', { path: '/api/account/logout', cookie: a.cookie, body: {} }); assert.equal(logout.status, 200);
    assert.match(logout.headers['set-cookie'][0], /Path=\/api\/account; HttpOnly; SameSite=Strict;/);
    assert.equal((await http('GET', { cookie: a.cookie })).status, 401);
  });
});

test('public character names reject existing prohibited terms and contact details before insertion', async () => {
  const a = await session();
  await withHttp(async ({ create }) => {
    for (const name of ['fuck', '01012345678', 'a@example.com']) {
      const result = await create(a.cookie, { ...appearance, name });
      assert.equal(result.status, 400); assert.equal(result.json.error, 'identity');
    }
    assert.equal((await characters.listOwned(a.accountId)).length, 0);
    const allowed = await create(a.cookie); assert.equal(allowed.status, 201);
    assert.equal(allowed.json.character.identity.appearance.name, appearance.name);
  });
});

test('configured real catalog supports every race and class with all appearance fields preserved', async () => {
  const a = await session(), classes = Object.keys(CLASSES);
  await withHttp(async ({ create }) => {
    for (let i = 0; i < Math.max(races.length, classes.length); i++) {
      const selected = { ...appearance, race: races[i % races.length], classId: classes[i % classes.length], sex: i % 2 ? 'male' : 'female', shell: i % 4, crest: (i + 1) % 4, led: i % 3, name: `새 캐릭터${i}` };
      const result = await create(a.cookie, selected); assert.equal(result.status, 201);
      assert.deepEqual(result.json.character.identity.appearance, selected); assert.equal(result.json.character.identity.archetype, selected.race);
      assert.equal((await characters.getOwned(a.accountId, result.json.character.characterId)).checkpoint.progress.xp, 0);
    }
  });
});

test('two accounts receive only their own UUID-paginated characters, never the other owner or progress', async () => {
  const a = await session(), b = await session();
  await withHttp(async ({ create, http }) => {
    const aIds = []; for (let i = 0; i < 3; i++) aIds.push((await create(a.cookie, { ...appearance, name: `A${i}` })).json.character.characterId);
    const bId = (await create(b.cookie, { ...appearance, name: 'B' })).json.character.characterId;
    const first = await http('GET', { cookie: a.cookie, path: ROUTE + '?limit=2' }); assert.equal(first.json.characters.length, 2); assert(first.json.nextAfter);
    const second = await http('GET', { cookie: a.cookie, path: ROUTE + '?limit=2&after=' + first.json.nextAfter }); assert.equal(second.json.characters.length, 1); assert.equal(second.json.nextAfter, null);
    assert.deepEqual([...first.json.characters, ...second.json.characters].map(c => c.characterId), aIds.sort()); assert(!first.text.includes(bId) && !second.text.includes(bId));
    const ownB = await http('GET', { cookie: b.cookie }); assert.deepEqual(ownB.json.characters.map(c => c.characterId), [bId]);
    const foreignCursor = await http('GET', { cookie: b.cookie, path: ROUTE + '?after=' + aIds[0] });
    assert(foreignCursor.json.characters.every(c => c.characterId === bId));
    assert.equal((await http('GET', { cookie: `cc_account=${a.accountId}.${b.token}` })).status, 401);
  });
});

test('forged owner, identity wrapper, revision, import and all progression fields are rejected without creating rows', async () => {
  const a = await session();
  await withHttp(async ({ http }) => {
    for (const key of ['accountId', 'owner', 'characterId', 'schema', 'classId', 'archetype', 'xp', 'coins', 'flags', 'checkpoint', 'revision', 'save', 'import']) {
      const response = await http('POST', { cookie: a.cookie, body: { appearance, [key]: key === 'revision' ? 0 : 999999 } }); assert.equal(response.status, 400, key);
    }
    for (const key of ['xp', 'coins', 'flags', 'checkpoint', 'revision', 'owner']) {
      assert.equal((await http('POST', { cookie: a.cookie, body: { appearance: { ...appearance, [key]: 999999 } } })).status, 400, key);
    }
    assert.deepEqual(await characters.listOwned(a.accountId), []);
  });
});

test('actual identity catalog strictly rejects appearance shape, bounds, names and unavailable combinations', async () => {
  const a = await session();
  await withHttp(async ({ create, http }) => {
    const values = [null, [], {}, { ...appearance, race: 'dragon' }, { ...appearance, classId: 'unknown' }, { ...appearance, shell: 4 }, { ...appearance, crest: -1 }, { ...appearance, led: 3 }, { ...appearance, sex: 'unknown' }, { ...appearance, name: ' name ' }, { ...appearance, name: 'x'.repeat(25) }, { ...appearance, shell: 1.5 }];
    for (const value of values) assert.equal((await create(a.cookie, value)).status, 400);
    const invalidUtf8 = Buffer.from(JSON.stringify({ appearance })); invalidUtf8[invalidUtf8.indexOf(Buffer.from(appearance.name))] = 255;
    assert.equal((await http('POST', { cookie: a.cookie, body: invalidUtf8 })).status, 400);
    for (const body of ['', 'broken', [], { appearance }, ' '.repeat(4097)]) {
      if (body && !Array.isArray(body) && typeof body === 'object') continue;
      assert.equal((await http('POST', { cookie: a.cookie, body })).status, 400);
    }
  });
  const restricted = createCoreCharacterCodec({ identities: [{ classId: 'warrior', archetype: 'human' }], freshLocation: { x: 0, y: 0, z: 0, yaw: 0 } });
  await withHttp(async ({ create }) => { assert.equal((await create(a.cookie, { ...appearance, race: 'orc' })).status, 400); }, { maxCharactersPerAccount: 2 }, { codec: restricted, characters: new CharacterStore(pool, restricted) });
});

test('Origin, CSRF, method, query bounds, stale sessions and endpoint policy fail closed', async () => {
  const a = await session();
  await withHttp(async ({ http }) => {
    for (const headers of [{ Origin: '' }, { Origin: 'null' }, { Origin: OTHER }, { Origin: 'https://evil.example' }, { Host: 'evil.example' }, { 'X-Crabcraft-Account': '' }, { 'Sec-Fetch-Site': 'cross-site' }]) assert.equal((await http('GET', { cookie: a.cookie, headers })).status, 403);
    assert.equal((await http('GET', { cookie: a.cookie, headers: { Origin: '', 'Sec-Fetch-Site': 'same-origin' } })).status, 200);
    assert.equal((await http('POST', { cookie: a.cookie, body: { appearance }, headers: { Origin: '', 'Sec-Fetch-Site': 'same-origin' } })).status, 403);
    assert.equal((await http('PUT', { cookie: a.cookie })).status, 405);
    for (const query of ['?limit=0', '?limit=101', '?limit=1.0', '?limit=1e2', '?limit=', '?after=bad', '?limit=1&limit=2', '?accountId=' + a.accountId]) assert.equal((await http('GET', { cookie: a.cookie, path: ROUTE + query })).status, 400, query);
    assert.equal((await http('POST', { cookie: a.cookie, path: ROUTE + '?limit=1', body: { appearance } })).status, 400);
    assert.equal((await http('GET', { cookie: a.cookie, body: { xp: 999 } })).status, 400);
    assert.equal((await http('GET')).status, 401); await pool.query('UPDATE sessions SET expires=0 WHERE token_hash=$1', [a.key]);
    assert.equal((await http('GET', { cookie: a.cookie })).status, 401);
    assert.equal((await http('POST', { cookie: a.cookie, body: { appearance } })).status, 401);
    assert.equal((await http('GET', { cookie: a.cookie, path: ROUTE + '/other' })).status, 404);
  });
  for (const policy of [undefined, {}, { maxCharactersPerAccount: 0 }, { maxCharactersPerAccount: 1.5 }]) await withHttp(async ({ http }) => { assert.equal((await http('GET', { cookie: a.cookie })).status, 503); }, policy === undefined ? {} : policy);
});

test('concurrent HTTP creates serialize count and insertion and cannot exceed explicit account limit', async () => {
  const a = await session(), b = await session();
  await withHttp(async ({ create }) => {
    const responses = await Promise.all(Array.from({ length: 8 }, () => create(a.cookie)));
    assert.equal(responses.filter(r => r.status === 201).length, 2); assert.equal(responses.filter(r => r.status === 409 && r.json.error === 'character_limit').length, 6);
    assert.equal((await characters.listOwned(a.accountId)).length, 2);
    assert.equal((await create(b.cookie)).status, 201);
  }, { maxCharactersPerAccount: 2 });
});

test('POST insert failure rolls back fresh character creation and preserves account save/revision', async () => {
  const a = await session(), before = (await pool.query('SELECT * FROM accounts WHERE username=$1', [a.accountId])).rows[0];
  await pool.query(`CREATE FUNCTION fail_character_api_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected character create failure'; END; $$;
    CREATE TRIGGER fail_character_api_insert AFTER INSERT ON world_characters FOR EACH ROW EXECUTE FUNCTION fail_character_api_insert()`);
  try { await withHttp(async ({ create }) => { assert.equal((await create(a.cookie)).status, 503); }); }
  finally { await pool.query('DROP TRIGGER fail_character_api_insert ON world_characters; DROP FUNCTION fail_character_api_insert()'); }
  assert.deepEqual(await characters.listOwned(a.accountId), []); assert.deepEqual((await pool.query('SELECT * FROM accounts WHERE username=$1', [a.accountId])).rows[0], before);
  await withHttp(async ({ create }) => { assert.equal((await create(a.cookie)).status, 201); });
});

test('DB fixed-window rate limits bound account and invalid-session IP requests', async () => {
  const a = await session();
  await withHttp(async ({ http }) => {
    for (let i = 0; i < 20; i++) assert.equal((await http('GET', { cookie: a.cookie })).status, 200);
    assert.equal((await http('GET', { cookie: a.cookie })).status, 429);
    for (let i = 0; i < 100; i++) assert.equal((await http('GET', { headers: { 'X-Forwarded-For': 'character-denied-ip' } })).status, 401);
    assert.equal((await http('GET', { headers: { 'X-Forwarded-For': 'character-denied-ip' } })).status, 429);
  });
});
