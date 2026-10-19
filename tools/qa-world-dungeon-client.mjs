#!/usr/bin/env node
// Server-world dungeon QA: production browser bundle -> bundled Node main (six worlds, party and dungeons on) -> throwaway PG.
// Two Chrome clients form a party, the leader starts the level 35 expedition from World III, both stand in the chamber,
// the leader fights the three waves with ordinary target/ability input, a follower brings everyone home after the clear and
// both see the rewards the server paid. Before login the two characters are written to PG as trusted level and world
// fixtures (no XP, coins, gear or flags are granted); everything after that is earned through the real host.
// Requires `pnpm build` and `pnpm build:server`. Usage: node tools/qa-world-dungeon-client.mjs [--out ABSOLUTE_DIR]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isAbsolute, join } from 'node:path';
import { preview } from 'vite';
import { chromium } from 'playwright';
import { startPostgres, freePort } from '../server/node/local-postgres.mjs';
import { createPool, migrate } from '../server/node/db.ts';
import { CharacterStore } from '../server/world/character-store.ts';
import { GameplayReceiver } from '../server/world/gameplay/protocol.ts';
import { createCoreCharacterCodec } from '../src/sim/persistence.ts';
import { loadBakedWorld } from '../src/sim/world/baked.ts';
import { createWorld3Definition } from '../src/sim/areas/world3.ts';
import { setQuestChapter } from '../src/sim/data/quests.ts';
import { xpForLevel, levelForXp } from '../src/sim/data/progression.ts';
import { CLASSES } from '../src/sim/data/classes.ts';
import { DUNGEON_CHAMBER } from '../src/sim/data/dungeons.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const outArg = process.argv.indexOf('--out'), out = outArg > 0 ? process.argv[outArg + 1] : join(root, 'output/playwright/world-dungeon');
if (!isAbsolute(out)) throw new Error('--out must be an absolute directory');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 15000, what = 'condition') { const end = performance.now() + timeout; while (!(await check())) { if (performance.now() > end) throw new Error(`Dungeon QA timed out: ${what}`); await pause(50); } }
let cluster, pool, child, exit, frontend, browser;
const clients = new Set(), result = { scope: 'Production dist + bundled Node main (world-dev-6 worlds, party, dungeons; QA populations 0) + throwaway PG; trusted level/world fixtures before login only', captures: [], checks: {} };
try {
  cluster = await startPostgres(); pool = createPool(cluster.url); pool.on('connect', c => { clients.add(c); c.once('end', () => clients.delete(c)); }); await migrate(pool);
  const manifest = JSON.parse(await readFile(new URL('../server-dist/world/world-manifest.json', import.meta.url), 'utf8'));
  const config = JSON.parse(await readFile(new URL('../deploy/vm/world-dev-6.json', import.meta.url), 'utf8'));
  config.ownership = { key: 'qa-world-dungeon' }; config.assets.source = manifest.source;
  // QA only: no public enemies, so nothing outside the run puts the fixtures in combat before the start.
  for (const world of Object.values(config.worlds)) world.population = { scrapling: 0, scavenger: 0, jellyfish: 0, shallowPatrols: 0 };
  assert.deepEqual(config.dungeons, { enabled: true, tiers: [35, 50, 75, 150, 200, 250, 350, 450, 550, 650], maxPendingAwards: 8 });

  // Accounts, sessions and the two trusted level/world fixtures, written the way the server's own codec reads them.
  const query = loadBakedWorld(JSON.parse(await readFile(new URL('../public/world/collision-w3.json', import.meta.url), 'utf8')));
  const w3 = createWorld3Definition({ query, personalProps: { heightAt: query.heightAt, resolveCollision: (x, z, r, o) => query.collision.resolve(x, z, r, o) }, fixedLevels: { scrapling: 20, scavenger: 22, jellyfish: 20, echo: 10 }, population: { scrapling: 0, scavenger: 0, jellyfish: 0, shallowPatrols: 0 } });
  const codec = createCoreCharacterCodec({ identities: ['human', 'orc', 'dwarf', 'undead', 'nightelf', 'tauren'].flatMap(archetype => Object.keys(CLASSES).map(classId => ({ classId, archetype }))), freshLocation: { ...w3.pois.arrival.position, yaw: 0 } });
  const store = new CharacterStore(pool, codec);
  async function player(name, classId, race, level, offset) {
    const account = 'g' + randomBytes(12).toString('hex').slice(0, 23), token = randomBytes(32).toString('hex');
    await pool.query('INSERT INTO accounts(username,updated,created) VALUES($1,$2,$2)', [account, Date.now()]);
    await pool.query('INSERT INTO sessions(token_hash,username,expires) VALUES($1,$2,$3)', [createHash('sha256').update(token).digest('hex'), account, Date.now() + 3600000]);
    const appearance = { race, sex: 'female', classId, shell: 1, crest: 1, led: 2, name };
    let record = await store.create(account, { schema: 'world-identity-v1', classId, archetype: race, appearance });
    const checkpoint = structuredClone(record.checkpoint), out = { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; return this; } }, arrival = w3.pois.arrival.position;
    query.collision.resolve(arrival.x + offset, arrival.z, .6, out);
    checkpoint.world = 'w3'; checkpoint.location = { x: out.x, y: query.heightAt(out.x, out.y), z: out.y, yaw: Math.PI };
    // The level is the only progression written; HP and resource are its derived values, as the codec requires.
    setQuestChapter(checkpoint.progress.quests, 3); checkpoint.progress.xp = xpForLevel(level); const derived = levelForXp(checkpoint.progress.xp), cls = CLASSES[classId];
    checkpoint.survival.maxHp = checkpoint.survival.hp = Math.round(cls.baseHp * (1 + .15 * (derived - 1)));
    if (cls.resource !== 'rage') checkpoint.survival.maxResource = checkpoint.survival.resource = 120 + 20 * (derived - 1);
    record = await store.saveCheckpoint(account, record.characterId, record.revision, checkpoint, []);
    return { account, token, id: record.characterId, name, level };
  }
  const leader = await player('원정대장', 'warrior', 'human', 650, -1.5), member = await player('따라온게', 'mage', 'nightelf', 200, 1.5);

  const port = await freePort(), origin = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server-dist/main.mjs'], { cwd: root, env: { ...process.env, DATABASE_URL: cluster.url, HOST: '127.0.0.1', PORT: '0', ALLOWED_ORIGINS: origin, WORLD_ENABLED: '1', WORLD_CONFIG_JSON: JSON.stringify(config) }, stdio: ['ignore', 'pipe', 'pipe'] }); exit = once(child, 'exit');
  let output = '', errors = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', b => errors += b);
  await until(() => /listening on 127\.0\.0\.1:\d+/.test(output) || child.exitCode !== null, 120000, 'bundled main'); assert.equal(child.exitCode, null, 'bundled server startup: ' + errors.slice(-400));
  const backend = 'http://' + output.match(/listening on (127\.0\.0\.1:\d+)/)[1];
  frontend = await preview({ root, configFile: false, preview: { host: '127.0.0.1', port, strictPort: true, proxy: { '/api/account': { target: backend }, '/world': { target: backend, ws: true } } }, logLevel: 'error' });
  const catalog = await (await fetch(backend + '/api/account/world-catalog')).json();
  assert.deepEqual(catalog.dungeons, config.dungeons.tiers, 'the catalog advertises the configured tiers'); result.checks.schemaRevision = catalog.wireSchemaRevision;

  browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
  const pageErrors = [], wireErrors = [];
  async function open(who, viewport) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    await context.grantPermissions(['local-network-access'], { origin });
    await context.addCookies([{ name: 'cc_account', value: `${who.account}.${who.token}`, domain: '127.0.0.1', path: '/api/account', httpOnly: true, sameSite: 'Strict' }]);
    const page = await context.newPage(), tag = `${who.name}@${viewport.width}`;
    page.on('pageerror', e => pageErrors.push(`${tag}: ${e.message}`));
    // Independent wire check: every binary frame this page receives must decode and validate against the served catalog.
    page.on('websocket', ws => { if (new URL(ws.url()).pathname !== '/world') return; let receiver = null; ws.on('framereceived', ({ payload }) => { try { if (typeof payload === 'string') { const m = JSON.parse(payload); if (m.type === 'world-bound') { const { type: _type, ...binding } = m; receiver = new GameplayReceiver(binding, catalog); } else if (m.type === 'error') wireErrors.push(`${tag}: bootstrap ${m.code}`); } else if (receiver) receiver.accept(payload, performance.now() / 1000); } catch (e) { wireErrors.push(`${tag}: ${e.message}`); } }); });
    await page.addInitScript(() => { localStorage.setItem('cc.language', 'ko'); localStorage.setItem('cc.hintsSeen', '1'); });
    await page.goto(`${origin}/?screen=game&world=server&character=${encodeURIComponent(who.id)}`, { waitUntil: 'load' });
    await page.locator('.launch-notice-start').click();
    await page.waitForFunction(() => window.cc?.game?.server?.ready && !document.querySelector('.loading'), undefined, { timeout: 180000 });
    await page.waitForFunction(() => { const hud = document.querySelector('.hud'); return hud && getComputedStyle(hud).opacity === '1'; }, undefined, { timeout: 60000 });
    // Observation-only tap of controls; the native handler still runs.
    await page.evaluate(() => { const client = window.cc.game.server.client, previous = client.options.onControl; window.dungeonQA = { controls: [] }; client.options.onControl = control => { window.dungeonQA.controls.push(structuredClone(control)); previous?.(control); }; });
    return page;
  }
  const view = page => page.evaluate(() => { const s = window.cc.game.server.state; if (!s) return null; const self = s.actors.find(a => a.ref.id === s.selfRef.id && a.ref.life === s.selfRef.life); return { area: s.header.area, world: s.world, mode: s.features.environment.mode, run: s.features.dungeon ?? null, coins: s.self.player.coins, xp: s.self.player.xp, level: self?.level, alive: self?.alive, y: self?.y, x: self?.x, z: self?.z, cleared: !!s.self.player.flags.dungeonCleared35 }; });
  // Layout: the dungeon UI must not cover the player frame, nor the minimap where it is shown.
  const overlap = (page, a, b) => page.evaluate(([a, b]) => { const x = document.querySelector(a), y = document.querySelector(b); if (!x || !y || getComputedStyle(x).visibility === 'hidden' || getComputedStyle(y).visibility === 'hidden' || x.hidden || y.hidden) return 0; const r = x.getBoundingClientRect(), q = y.getBoundingClientRect(); return Math.max(0, Math.min(r.right, q.right) - Math.max(r.left, q.left)) * Math.max(0, Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top)); }, [a, b]);
  const rects = (page, selectors) => page.evaluate(selectors => selectors.map(s => { const e = document.querySelector(s), r = e?.getBoundingClientRect(); return r && [s, Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; }), selectors);
  async function layout(page, element, label) { const frame = await overlap(page, element, '.uf-player'), map = await overlap(page, element, '.mm'); (result.checks.layout ??= {})[`${label}@${page.viewportSize().width}`] = { frame, map }; assert.equal(frame + map, 0, `${element} covers the HUD at ${label}@${page.viewportSize().width}: ${JSON.stringify(await rects(page, [element, '.uf-player', '.mm']))}`); }
  async function shot(page, name) {
    await page.bringToFront(); await pause(400);
    const size = page.viewportSize(), file = join(out, `${name}-${size.width}x${size.height}.png`); await page.screenshot({ path: file }); result.captures.push(file);
  }
  await mkdir(out, { recursive: true });
  const A = await open(leader, { width: 1280, height: 800 }), B = await open(member, { width: 390, height: 844 });
  const start = { a: await view(A), b: await view(B) };
  for (const page of [A, B]) await layout(page, '.dungeon-menu', 'town');
  assert.equal(start.a.world, 'w3'); assert.equal(start.a.level, 650); assert.equal(start.b.level, 200);

  // Party through the native party panel.
  await A.bringToFront(); await A.evaluate(() => window.cc.game.server.showFriends());
  await A.getByRole('button', { name: '파티 만들기', exact: true }).click();
  await A.waitForFunction(() => window.dungeonQA.controls.some(c => c.type === 'party' && c.state));
  const code = await A.evaluate(() => window.dungeonQA.controls.filter(c => c.type === 'party' && c.state).at(-1).state.code);
  await A.getByRole('button', { name: '닫기', exact: true }).click();
  await B.bringToFront(); await B.evaluate(() => window.cc.game.server.showFriends());
  await B.getByRole('textbox', { name: '6자리 파티 코드', exact: true }).fill(code);
  await B.getByRole('button', { name: '참가', exact: true }).click();
  await A.waitForFunction(() => window.dungeonQA.controls.some(c => c.type === 'party' && c.state?.members.length === 2));
  await B.getByRole('button', { name: '닫기', exact: true }).click();

  // Menus: the leader can begin the World III tier; the follower is told the leader starts it.
  await A.bringToFront(); await A.locator('.dungeon-menu').click(); await A.locator('.dungeon-panel').waitFor();
  const leaderCard = A.locator('.dg-card[data-level="35"] .dg-enter');
  assert.equal(await leaderCard.isEnabled(), true); assert.equal(await A.locator('.dg-card[data-level="150"] .dg-enter').isEnabled(), false, 'other worlds start elsewhere');
  await shot(A, '1-menu-leader');
  await B.bringToFront(); await B.locator('.dungeon-menu').click(); await B.locator('.dungeon-panel').waitFor();
  assert.equal(await B.locator('.dg-card[data-level="35"] .dg-enter').isEnabled(), false); result.checks.followerNotice = await B.locator('.dg-notice').innerText();
  result.checks.followerButton = await B.locator('.dg-card[data-level="35"] .dg-enter').innerText();
  await shot(B, '1-menu-member');
  await B.locator('.dungeon-close').click();

  await A.bringToFront(); await leaderCard.click();
  await until(async () => (await view(A))?.mode === 'dungeon' && (await view(B))?.mode === 'dungeon', 20000, 'both in the chamber');
  const inside = { a: await view(A), b: await view(B) };
  assert.equal(inside.a.area, inside.b.area); assert.ok(Math.abs(inside.a.y - DUNGEON_CHAMBER.y) < .01 && Math.abs(inside.b.y - DUNGEON_CHAMBER.y) < .01, 'both stand on the chamber floor');
  result.checks.run = { area: inside.a.area, runId: inside.a.run.run.runId, tier: inside.a.run.tier };
  await until(async () => (await A.evaluate(() => window.dungeonQA.controls.filter(c => c.type === 'party').at(-1)?.state?.dungeon?.runId)) === inside.a.run.run.runId, 5000, 'party control carries the run');

  // A member steps out alone and comes back through the menu's join card for the party's running run.
  await B.bringToFront(); await B.locator('.dungeon-status').getByRole('button', { name: '혼자 나가기', exact: true }).click();
  await until(async () => (await view(B))?.mode === 'public', 10000, 'member steps out');
  assert.equal((await view(A)).mode, 'dungeon', 'the run goes on for the leader');
  await B.locator('.dungeon-menu').click(); await B.locator('.dungeon-panel').waitFor();
  const joinCard = B.locator('.dg-card[data-level="35"] .dg-enter'); await B.waitForFunction(() => document.querySelector('.dg-card[data-level="35"] .dg-enter')?.classList.contains('is-join'));
  result.checks.joinButton = await joinCard.innerText(); result.checks.joinNotice = await B.locator('.dg-notice').innerText();
  await shot(B, '1-menu-member-join'); await joinCard.click();
  await until(async () => (await view(B))?.mode === 'dungeon' && (await view(B)).run?.run.runId === inside.a.run.run.runId, 15000, 'member rejoins the run');
  // A wave with its hazard warning on both screens before anyone fights (the warning shows 2.5 s of every 7 s).
  await until(async () => { const [a, b] = [await view(A), await view(B)]; return [a, b].every(v => v.run?.phase === 'wave' && v.run.warning.length > 0 && v.run.clock % 7 < 1.2); }, 30000, 'wave with warning on both');
  await Promise.all([A.waitForFunction(() => document.querySelector('.dungeon-status')?.dataset.phase === 'wave'), B.waitForFunction(() => document.querySelector('.dungeon-status')?.dataset.phase === 'wave')]);
  result.checks.warningShapes = (await view(A)).run.warning.length;
  for (const page of [A, B]) await layout(page, '.dungeon-status', 'chamber');
  await shot(A, '2-chamber-wave-warning'); await shot(B, '2-chamber-wave-warning');
  assert.equal(await A.evaluate(() => window.cc.game.scene.getObjectByName('dungeon-chamber')?.visible), true);
  assert.equal(await B.evaluate(() => { const c = window.cc.game.scene.getObjectByName('dungeon-chamber'); return c?.visible && c.children[0].visible && c.children[0].children.length > 0; }), true, 'warning meshes drawn on the follower');

  // The leader fights with the same commands its keys send: target the nearest sentinel, charge, strike, whirlpool.
  await A.bringToFront(); const phases = [];
  const fight = setInterval(() => { void A.evaluate(() => { const g = window.cc.game, run = g.server.state?.features.dungeon; if (!run || run.phase !== 'wave') return run ? `${run.stage}:${run.phase}` : null; if (!g.player.target?.alive) g.player.tabTarget(); const turn = (window.dungeonQA.turn = (window.dungeonQA.turn ?? 0) + 1); g.player.useAbility([3, 1, 4][turn % 3]); return `${run.stage}:${run.phase}`; }).then(p => { if (p && phases.at(-1) !== p) phases.push(p); }, () => {}); }, 120);
  try { await until(async () => (await view(A))?.run?.phase === 'clear', 120000, 'clear'); } finally { clearInterval(fight); }
  result.checks.leaderPhases = phases;
  // The result: both clients show the clear, then the rewards the server actually paid.
  await until(async () => (await view(B)).cleared && (await view(A)).cleared, 20000, 'awards');
  await Promise.all([A, B].map(p => p.waitForFunction(() => /\+[\d,]+/.test(document.querySelector('.dungeon-status')?.innerText ?? ''), undefined, { timeout: 10000 })));
  result.checks.statusLeader = await A.locator('.dungeon-status').innerText(); result.checks.statusMember = await B.locator('.dungeon-status').innerText();
  await pause(3000); // the fight loop's cooldown notices fade; the run banner stays
  await shot(A, '3-result'); await shot(B, '3-result');

  // After the clear the follower may bring everyone home.
  await B.bringToFront(); await B.locator('.dungeon-status').getByRole('button', { name: '돌아가기', exact: true }).click();
  await until(async () => (await view(A))?.mode === 'public' && (await view(B))?.mode === 'public', 20000, 'back home');
  const home = { a: await view(A), b: await view(B) };
  for (const [who, before, after] of [['leader', start.a, home.a], ['member', start.b, home.b]]) {
    assert.ok(Math.hypot(after.x - before.x, after.z - before.z) < .01, `${who} returns to its origin`);
    assert.ok(after.coins > before.coins && after.xp > before.xp && after.cleared, `${who} received coins, XP and the cleared mark`);
  }
  result.checks.rewards = { leader: { coins: home.a.coins - start.a.coins, xp: home.a.xp - start.a.xp }, member: { coins: home.b.coins - start.b.coins, xp: home.b.xp - start.b.xp } };
  assert.deepEqual(result.checks.rewards.member, { coins: 1800, xp: 1800 }, 'a follower that did not fight receives exactly the tier award');
  assert.equal(await A.evaluate(() => window.cc.game.scene.getObjectByName('dungeon-chamber')?.visible), false);
  await shot(A, '4-home'); await shot(B, '4-home');
  await A.locator('.dungeon-menu').click(); await A.locator('.dungeon-panel').waitFor();
  result.checks.conquered = await A.locator('.dg-card[data-level="35"] .dg-state').innerText();
  await shot(A, '5-menu-after-clear'); await A.locator('.dungeon-close').click();
  await B.bringToFront(); await B.locator('.dungeon-menu').click(); await B.locator('.dungeon-panel').waitFor(); await shot(B, '5-menu-after-clear');

  result.checks.pageErrors = pageErrors; result.checks.wireErrors = wireErrors;
  assert.deepEqual(pageErrors, []); assert.deepEqual(wireErrors, []);
  const saved = await Promise.all([leader, member].map(p => store.getOwned(p.account, p.id)));
  result.checks.pg = saved.map(r => ({ world: r.checkpoint.world, cleared35: r.checkpoint.progress.flags.dungeonCleared35 ?? false, y: r.checkpoint.location.y }));
  console.log(JSON.stringify(result, null, 1));
  await browser.close(); browser = null; child.kill('SIGTERM'); const [codeExit, signal] = await exit; assert.equal(codeExit, 0); assert.equal(signal, null);
  assert(!output.includes(leader.token) && !errors.includes(leader.token), 'credential-free server logs');
} finally {
  await browser?.close(); if (frontend) { frontend.httpServer.closeAllConnections(); await new Promise(resolve => frontend.httpServer.close(resolve)); }
  if (child?.exitCode === null) { child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 10000); try { await exit; } finally { clearTimeout(timer); } }
  const ended = [...clients].map(c => once(c, 'end')); await pool?.end(); await Promise.all(ended); cluster?.stop();
}
