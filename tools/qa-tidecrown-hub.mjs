// Tidecrown as the hub (real Chrome on the dev server, a new save, no creator travel). Through F and walk-ins, never a
// direct call for the trips: World I's crown portal into Tidecrown (the loading screen, the harbour quay facing the
// sea gate); the captain's travel choice shows every world open or locked exactly as canTravel says; a locked world
// refuses with its own message; sailing to World I restores everything Tidecrown changed and lands at the crown portal;
// walking back into it returns to the quay; with World II unlocked the Seaglass portal (walked into) sends the player
// to World II, onto its crown portal, with the quest chapter rules; that crown portal leads back to the quay; and the
// forest road south leads to Clawhaven's King's Road even from World II. Then on a server world (a loopback host with
// a disposable PG, as qa-tidecrown-road-server) none of it is built or reachable. Zero page errors throughout.
// Writes the 1600x900 shots to CC_QA_SHOTS (default tmp/hub-shots).
// Usage: CC_QA_BASE=http://127.0.0.1:5261 node tools/qa-tidecrown-hub.mjs   (CC_QA_SERVER=0 skips the server world;
//   WORLD_QA_BROWSER_PORT, WORLD_QA_HOST_PORT pick its ports)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = process.env.CC_QA_BASE ?? 'http://127.0.0.1:5261';
const shots = process.env.CC_QA_SHOTS ?? join(root, 'tmp/hub-shots');
await mkdir(shots, { recursive: true });
const args = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'];
const errors = [];
const watch = (p) => {
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && /shader|program|WebGL|tidecrown|portal|hub|zone line/i.test(m.text())) errors.push(m.text().slice(0, 300)); });
};

const browser = await chromium.launch({ channel: 'chrome', headless: true, args });
try {
  const p = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  p.setDefaultTimeout(90000);
  watch(p);
  await p.routeWebSocket('**/multiplayer*', (ws) => ws.close());
  await p.addInitScript(() => {
    localStorage.setItem('cc.spec', JSON.stringify({ race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'Hub traveller' }));
    localStorage.setItem('cc.hintsSeen', '1');
    localStorage.setItem('cc.language', 'ko');
    localStorage.setItem('cc.quality', 'high');
  });
  await p.goto(base + '/?screen=game');
  await p.locator('.launch-notice-start').click();
  await p.waitForFunction(() => window.app?.current?.game?.loaded && !document.querySelector('.loading'), null, { timeout: 240000 });

  const start = await p.evaluate(async () => {
    const g = window.app.current.game, w2 = g.world2, hub = w2.hub;
    g.god = true;
    // A quiet start: no enemies, whose fights would hold the player at a portal.
    for (const e of g.enemies) if (e.state !== 'gone') e.despawn();
    const L = await import('/src/world/layout.ts'), T = await import('/src/game/tidecrownHub.ts'), G = await import('/src/sim/world/tidecrownGround.ts');
    const roots = { 1: g.world.root, 2: w2.root, 3: w2.third.root, 4: w2.fourth.root, 5: w2.fifth.root, 6: w2.sixth.root };
    window.__H = {
      L, T, G,
      state: () => ({
        in: w2.inTidecrown, chapter: w2.chapter, quest: g.quests.chapter, status: JSON.stringify(g.quests.status),
        x: +g.player.unit.pos.x.toFixed(2), z: +g.player.unit.pos.z.toFixed(2), yaw: +g.player.unit.yaw.toFixed(3),
        shown: Object.entries(roots).filter(([, r]) => r.visible).map(([c]) => +c), tc: !!w2.tidecrown?.root.visible,
      }),
      // World I as Tidecrown finds it, to compare once the player is back.
      world: () => ({
        heightAt: g.world.heightAt, resolve: g.world.resolveCollision, ray: g.world.raycastSolid, env: g.scene.environment,
        fog: g.scene.fog.color.getHexString(), density: g.scene.fog.density, spawn: [g.world.pois.spawn.position.x, g.world.pois.spawn.position.z],
        units: [...g.npcs.map((n) => n.unit), ...g.townsfolk.map((f) => f.unit)].map((u) => ({ hidden: u.hidden, x: u.pos.x, z: u.pos.z })),
      }),
      // A fixed camera for a shot, and back to the game's own.
      cam: (cam, at) => { g.follow.update = function () { this.camera.position.set(...cam); this.camera.lookAt(...at); }; },
      free: () => { delete g.follow.update; },
      // Stand `d` in front of a point facing it (the camera behind), or `d` in front facing away.
      face: (x, z, yaw, d, toward = true) => {
        const px = x + Math.sin(yaw) * d, pz = z + Math.cos(yaw) * d, y = toward ? yaw + Math.PI : yaw;
        g.player.setTarget(null);
        g.player.unit.teleport(g.world, px, pz, y);
        g.follow.yaw = y + Math.PI;
        g.follow.cut();
      },
      text: () => document.querySelector('.dlg-text')?.textContent ?? '',
      buttons: () => [...document.querySelectorAll('.dlg-buttons .cc-btn')].map((b) => ({ label: b.textContent, ghost: b.classList.contains('ghost') })),
      prompt: () => (document.querySelector('.prompt.on')?.textContent ?? ''),
    };
    const portals = hub.crownPortals.map((r) => ({ ...r, parent: g.scene.getObjectByName(`crown-portal-w${r.chapter}`)?.parent === roots[r.chapter] }));
    return { ...window.__H.state(), portals, arrival: T.TC_HARBOUR_ARRIVAL, kings: L.KINGS_ROAD_RETURN };
  });
  assert.equal(start.chapter, 1);
  assert.equal(start.portals.length, 6);
  assert.ok(start.portals.every((r) => r.parent), `every crown portal stands in its own world: ${JSON.stringify(start.portals)}`);
  console.log('PASS six crown portals, one in each world beside its own gateway');
  const crown = (c) => start.portals.find((r) => r.chapter === c);
  const near = (s, x, z, tol = 0.6) => Math.hypot(s.x - x, s.z - z) < tol;
  const reveal = async () => {
    await p.locator('.dlg-text').click();
    await p.waitForFunction(() => { const d = window.app.current.game.hud.dialogue; return !d.typing; });
  };
  const travelled = (fn, arg) => p.waitForFunction(fn, arg, { timeout: 120000 });
  /** Walk in (W held) from where the player stands until `done` holds. */
  const walkUntil = async (done, arg, ms = 8000) => {
    await p.keyboard.down('KeyW');
    try { await p.waitForFunction(done, arg, { timeout: ms }); } finally { await p.keyboard.up('KeyW'); }
  };

  // 1. World I's crown portal, by F: the loading screen, then the quay before the sea gate, facing it.
  const w1 = crown(1);
  await p.evaluate(({ x, z, yaw }) => window.__H.face(x, z, yaw, 3), w1);
  await p.waitForFunction(() => window.__H.prompt().includes('타이드크라운 · 왕관 항구로'));
  const before = await p.evaluate(() => { window.__before = window.__H.world(); return window.__H.state(); });
  const t0 = Date.now();
  await p.keyboard.press('KeyF');
  await p.locator('.tidecrown-loading').first().waitFor({ state: 'attached', timeout: 10000 });
  await travelled(() => window.app.current.game.world2.inTidecrown && !document.querySelector('.tidecrown-loading'));
  const firstWall = Date.now() - t0;
  const quay = await p.evaluate(() => ({ ...window.__H.state(), entry: Math.round(window.app.current.game.world2.tidecrownEntryMs) }));
  assert.ok(near(quay, start.arrival.x, start.arrival.z) && Math.abs(quay.yaw - start.arrival.yaw) < 0.05, `on the quay facing the sea gate: ${JSON.stringify(quay)}`);
  assert.equal(quay.chapter, 1);
  assert.equal(quay.quest, before.quest);
  assert.equal(quay.status, before.status);
  assert.deepEqual(quay.shown, []);
  console.log(`PASS F at World I's crown portal: the Tidecrown loading screen, then the harbour quay facing the sea gate (first entry ${quay.entry} ms build and settle, ${firstWall} ms from F to the screen gone); quest chapter unchanged`);
  // The zone banner fades before the shots.
  await p.waitForTimeout(4500);
  await p.screenshot({ path: `${shots}/quay-arrival.png` });

  // 2. The captain on the long pier: the prompt, then the choice, every world as canTravel says.
  const choice = async (by) => {
    const name = by === 'ship' ? '아라 선장' : '포탈지기 오팔';
    await p.waitForFunction((n) => window.app.current.game.hud.dialogue.unit?.name === n, name);
    await reveal();
    const r = await p.evaluate(() => ({ text: window.__H.text(), buttons: window.__H.buttons(), can: [1, 2, 3, 4, 5, 6].map((c) => window.app.current.game.world2.canTravel(c)) }));
    const worlds = r.buttons.slice(0, 6);
    assert.equal(worlds.length, 6, JSON.stringify(r.buttons));
    worlds.forEach((b, i) => {
      assert.ok(b.label.includes(`월드 ${['I', 'II', 'III', 'IV', 'V', 'VI'][i]} ·`), b.label);
      assert.equal(b.label.startsWith('🔒'), !r.can[i], `world ${i + 1}: ${b.label} vs canTravel ${r.can[i]}`);
      assert.equal(b.ghost, !r.can[i]);
    });
    return r;
  };
  await p.evaluate(() => window.__H.face(261, 8.9, -Math.PI / 2, 3.6));
  await p.waitForFunction(() => window.__H.prompt().includes('아라 선장에게 말 걸기'));
  await p.evaluate(() => window.__H.cam([247, 14, 22], [262, 4.5, 6]));
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${shots}/captain-and-galleon.png` });
  await p.evaluate(() => window.__H.free());
  await p.keyboard.press('KeyF');
  const fresh = await choice('ship');
  assert.deepEqual(fresh.can, [true, false, false, false, false, false]);
  await p.screenshot({ path: `${shots}/travel-choice.png` });
  console.log(`PASS the captain's F opens the choice: ${fresh.buttons.map((b) => b.label).join(' | ')}; open and locked match canTravel`);

  // 3. A locked world refuses with its own message, in the dialogue and from the sail itself.
  await p.getByRole('button', { name: '🔒 월드 III · 새벽 항구', exact: true }).click();
  await reveal();
  const lock3 = await p.evaluate(() => window.app.current.game.world2.travelLock(3));
  assert.equal(await p.evaluate(() => window.__H.text()), lock3);
  await p.getByRole('button', { name: '다른 곳 고르기', exact: true }).click();
  await choice('ship');
  await p.getByRole('button', { name: '다음에 갈게요', exact: true }).click();
  const refused = await p.evaluate(() => { const g = window.app.current.game, ok = g.world2.hub.sail(3); return { ok, ...window.__H.state(), info: [...document.querySelectorAll('.info')].map((e) => e.textContent) }; });
  assert.equal(refused.ok, false);
  assert.ok(refused.in && refused.chapter === 1 && refused.info.includes(lock3), JSON.stringify(refused));
  console.log(`PASS a locked world refuses: "${lock3}" in the captain's reply and as the notice; still in Tidecrown, chapter unchanged`);
  await p.evaluate(async () => { const { setLanguage } = await import('/src/i18n.ts'); setLanguage('en'); });
  await p.keyboard.press('KeyF');
  await p.getByRole('button', { name: 'World I · Clawhaven', exact: true }).waitFor();
  await p.getByRole('button', { name: 'Not now', exact: true }).click();
  await p.evaluate(async () => { const { setLanguage } = await import('/src/i18n.ts'); setLanguage('ko'); });
  console.log('PASS the choice in English');

  // 4. Sail to World I, the world under Tidecrown: everything restored, standing before its crown portal.
  await p.keyboard.press('KeyF');
  await choice('ship');
  await p.getByRole('button', { name: '월드 I · 클로헤이븐', exact: true }).click();
  await reveal();
  assert.ok((await p.evaluate(() => window.__H.text())).includes('클로헤이븐으로 출항할까요?'));
  await p.getByRole('button', { name: '출항하기', exact: true }).click();
  await travelled(() => !window.app.current.game.world2.inTidecrown);
  await p.waitForTimeout(800);
  const home = await p.evaluate(() => {
    const g = window.app.current.game, b = window.__before, now = window.__H.world(), hub = g.world2.hub;
    const drift = Math.max(...now.units.map((u, i) => (u.hidden === b.units[i].hidden ? Math.hypot(u.x - b.units[i].x, u.z - b.units[i].z) : 1e9)));
    return {
      ...window.__H.state(), drift: +drift.toFixed(2), same: ['heightAt', 'resolve', 'ray', 'env', 'fog', 'density'].filter((k) => now[k] !== b[k]),
      spawn: now.spawn.every((v, i) => Math.abs(v - b.spawn[i]) < 1e-6), plates: g.hud.plates.also.size, keepers: hub.units.every((u) => u.hidden && !u.rig.root.visible),
      residents: g.world2.tidecrownPeople.people.every((r) => r.unit.hidden), units: now.units.length === b.units.length,
    };
  });
  assert.deepEqual(home.same, [], `World I's ground, collision and sky are back: ${home.same}`);
  assert.ok(home.spawn && home.units && home.plates === 0 && home.keepers && home.residents && !home.tc, JSON.stringify(home));
  assert.ok(home.drift < 8, `the villagers are back where they were (largest move ${home.drift})`);
  assert.deepEqual(home.shown, [1]);
  assert.ok(home.chapter === 1 && home.quest === before.quest && home.status === before.status, JSON.stringify(home));
  const dock1 = { x: w1.x + Math.sin(w1.yaw) * 4, z: w1.z + Math.cos(w1.yaw) * 4 };
  assert.ok(near(home, dock1.x, dock1.z), `before World I's crown portal: ${JSON.stringify(home)} vs ${JSON.stringify(dock1)}`);
  console.log(`PASS sailing to World I: Tidecrown left cleanly (ground, collision, sky, spawn, villagers within ${home.drift} m, quests), standing before the crown portal`);

  // 5. Back through World I's crown portal by walking into it.
  await p.evaluate(({ x, z, yaw }) => window.__H.face(x, z, yaw, 5.5), w1);
  await p.waitForTimeout(3300);
  await walkUntil(() => window.app.current.game.world2.inTidecrown || !!document.querySelector('.tidecrown-loading'));
  await travelled(() => window.app.current.game.world2.inTidecrown && !document.querySelector('.tidecrown-loading'));
  const again = await p.evaluate(() => ({ ...window.__H.state(), entry: Math.round(window.app.current.game.world2.tidecrownEntryMs) }));
  assert.ok(near(again, start.arrival.x, start.arrival.z) && again.chapter === 1, JSON.stringify(again));
  console.log(`PASS walking into World I's crown portal returns to the quay (re-entry ${again.entry} ms)`);

  // 6. World II opens; the Seaglass portal, walked into, offers it; through it to World II, before its crown portal.
  const sg = await p.evaluate(() => { const g = window.app.current.game, s = g.world2.tidecrown.root.getObjectByName('seaglass-portal'); return { x: s.position.x, y: s.position.y, z: s.position.z, yaw: s.rotation.y }; });
  await p.evaluate(({ x, z, yaw }) => window.__H.face(x, z, yaw, 7), sg);
  // From the plaza, to the side of the lamp that stands between the portal and the tower.
  await p.evaluate(({ x, y, z, yaw }) => window.__H.cam([x + Math.sin(yaw) * 10 + Math.cos(yaw) * 3.5, y + 4.2, z + Math.cos(yaw) * 10 - Math.sin(yaw) * 3.5], [x, y + 2.8, z]), sg);
  await p.waitForTimeout(4500);
  await p.screenshot({ path: `${shots}/seaglass-portal.png` });
  await p.evaluate(() => window.__H.free());
  await p.evaluate(() => { window.app.current.game.journey.abyssCleared = true; });
  await p.evaluate(({ x, z, yaw }) => window.__H.face(x, z, yaw, 5.5), sg);
  await p.waitForTimeout(300);
  await walkUntil(() => window.app.current.game.hud.dialogue.isOpen);
  const portalChoice = await choice('portal');
  assert.deepEqual(portalChoice.can, [true, true, false, false, false, false]);
  console.log('PASS walking into the Seaglass portal opens the keeper\'s choice; World II now open, as canTravel says');
  await p.getByRole('button', { name: '월드 II · 별빛 항구', exact: true }).click();
  await reveal();
  assert.ok((await p.evaluate(() => window.__H.text())).includes('별빛 항구로 가는 포탈을 열까요?'));
  await p.getByRole('button', { name: '포탈로 들어가기', exact: true }).click();
  await travelled(() => { const w2 = window.app.current.game.world2; return !w2.inTidecrown && w2.chapter === 2; });
  await p.waitForTimeout(800);
  const star = await p.evaluate(() => ({ ...window.__H.state(), plates: window.app.current.game.hud.plates.also.size }));
  const w2c = crown(2), dock2 = { x: w2c.x + Math.sin(w2c.yaw) * 4, z: w2c.z + Math.cos(w2c.yaw) * 4 };
  assert.ok(star.quest === 2 && star.chapter === 2 && !star.tc && star.plates === 0, JSON.stringify(star));
  assert.deepEqual(star.shown, [2]);
  assert.ok(near(star, dock2.x, dock2.z), `before World II's crown portal: ${JSON.stringify(star)}`);
  console.log('PASS through the Seaglass portal to World II: Tidecrown left, quest chapter 2 as go() sets it, standing before its crown portal');
  const gy = await p.evaluate(({ x, z }) => window.app.current.game.world.heightAt(x, z), w2c);
  // World II's own portal and the crown portal south-east of it, from the open ground south of both.
  await p.evaluate(({ gy }) => window.__H.cam([4, gy + 6.5, 113], [6, gy + 2.6, 93]), { gy });
  await p.waitForTimeout(4500);
  await p.screenshot({ path: `${shots}/return-point-world2.png` });
  await p.evaluate(() => window.__H.free());

  // 7. World II's crown portal back to the quay; Tidecrown lies over World II and keeps its quest chapter.
  await p.evaluate(({ x, z, yaw }) => window.__H.face(x, z, yaw, 5.5), w2c);
  await p.waitForTimeout(3300);
  await walkUntil(() => window.app.current.game.world2.inTidecrown || !!document.querySelector('.tidecrown-loading'));
  await travelled(() => window.app.current.game.world2.inTidecrown && !document.querySelector('.tidecrown-loading'));
  const over2 = await p.evaluate(() => window.__H.state());
  assert.ok(near(over2, start.arrival.x, start.arrival.z) && over2.chapter === 2 && over2.quest === 2, JSON.stringify(over2));
  console.log('PASS walking into World II\'s crown portal returns to the quay, over World II, quest chapter 2 kept');

  // 8. The forest road south still leads to Clawhaven's King's Road, from World II too.
  await p.evaluate(() => { const g = window.app.current.game, { a, b, dir } = window.__H.G.TC_RETURN_LINE, x = (a[0] + b[0]) / 2, z = a[1] - dir[1] * 3; g.player.unit.teleport(g.world, x, z, 0); });
  await p.waitForTimeout(400);
  await p.evaluate(() => { const g = window.app.current.game, { a, b, dir } = window.__H.G.TC_RETURN_LINE; g.player.unit.teleport(g.world, (a[0] + b[0]) / 2, a[1] + dir[1] * 1.5, 0); });
  await travelled(() => { const w2 = window.app.current.game.world2; return !w2.inTidecrown && w2.chapter === 1; });
  await p.waitForTimeout(600);
  const road = await p.evaluate(() => window.__H.state());
  assert.ok(near(road, start.kings.x, start.kings.z, 1) && road.quest === 1, `on the King's Road in World I: ${JSON.stringify(road)}`);
  assert.deepEqual(road.shown, [1]);
  console.log('PASS from Tidecrown over World II, the south road leads to the King\'s Road in World I (quest chapter 1)');
  assert.deepEqual(errors, []);
  console.log('PASS zero page errors on the local world');
} finally {
  await browser.close();
}

// 9. A server world: the server does not host Tidecrown yet, so no crown portal is built and the hub's travel refuses.
if (process.env.CC_QA_SERVER !== '0') {
  const browserPort = Number(process.env.WORLD_QA_BROWSER_PORT ?? 5273), hostPort = Number(process.env.WORLD_QA_HOST_PORT ?? 5274), clientOrigin = `http://127.0.0.1:${browserPort}`;
  const scratch = await mkdtemp('/private/tmp/crabcraft-hub-server-'), metadataPath = join(scratch, 'host.json');
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  let host, server, sb;
  try {
    host = spawn(process.execPath, ['tools/qa-world-host-server.mjs', '--port', String(hostPort), '--metadata', metadataPath, '--client-origin', clientOrigin, '--world', 'w1'], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
    host.stderr.on('data', () => {});
    let metadata;
    for (let i = 0; i < 300 && !metadata; i++) {
      try { metadata = JSON.parse(await readFile(metadataPath, 'utf8')); } catch { if (host.exitCode !== null) throw new Error('QA host exited before readiness'); await pause(100); }
    }
    if (!metadata) throw new Error('QA host readiness timed out');
    const origin = new URL(metadata.origin);
    server = await createServer({ root, configFile: false, server: { host: '127.0.0.1', port: browserPort, strictPort: true, proxy: { '/world': { target: origin.origin, ws: true }, '/api/account': { target: origin.origin } } }, logLevel: 'error' });
    await server.listen();
    sb = await chromium.launch({ channel: 'chrome', headless: true, args });
    const context = await sb.newContext({ viewport: { width: 1600, height: 900 } });
    await context.grantPermissions(['local-network-access'], { origin: clientOrigin });
    await context.addCookies([{ name: metadata.cookie.name, value: metadata.cookie.value, domain: '127.0.0.1', path: metadata.cookie.path, httpOnly: true, sameSite: 'Strict', secure: false }]);
    const page = await context.newPage();
    watch(page);
    await page.addInitScript(() => { localStorage.setItem('cc.language', 'ko'); localStorage.setItem('cc.hintsSeen', '1'); });
    await page.goto(`${clientOrigin}/?screen=game&world=server&character=${encodeURIComponent(metadata.characterId)}`, { waitUntil: 'load' });
    await page.locator('.launch-notice-start').click();
    await page.waitForFunction(() => window.__ready && window.cc?.game?.server?.ready, undefined, { timeout: 120000 });
    await page.locator('.loading').waitFor({ state: 'detached' });
    const s = await page.evaluate(async () => {
      const g = window.cc.game, hub = g.world2.hub, built = [];
      g.scene.traverse((o) => { if (/^crown-portal|^seaglass-portal/.test(o.name)) built.push(o.name); });
      const ok = await hub.toTidecrown();
      return { built, portals: hub.crownPortals.length, open: hub.open, ok, in: g.world2.inTidecrown, point: hub.point(), info: [...document.querySelectorAll('.info')].map((e) => e.textContent), chapter: g.world2.chapter };
    });
    assert.deepEqual(s.built, []);
    assert.ok(s.portals === 0 && !s.open && s.ok === false && !s.in && s.point === null && s.chapter === 1, JSON.stringify(s));
    assert.ok(s.info.some((t) => t.includes('곧 열려요')), JSON.stringify(s.info));
    assert.deepEqual(errors, []);
    console.log('PASS ?world=server: no crown portal or Seaglass portal is built, the hub\'s travel refuses ("곧 열려요"), the player stays in World I; zero page errors');
  } finally {
    await sb?.close();
    await server?.close();
    if (host && host.exitCode === null) { host.kill('SIGTERM'); await pause(500); }
  }
}
