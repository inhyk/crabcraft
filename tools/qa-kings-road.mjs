// The King's Road from Clawhaven to the Tidecrown zone line: the centre line is open and gentle from the
// chapel plaza to the line; a walk along it fires the zone line exactly once (turned back with the notice
// while Tidecrown is not built, through the fade when world2.enterTidecrown exists); Tidecrown's skyline
// stays inside its budget and adds no colliders; its lantern answers the beacon after a delay, once, and
// at once on a restore. Writes the review shots to CC_QA_SHOTS (default tmp/qa/kings-road).
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const base = process.env.CC_QA_BASE ?? 'http://127.0.0.1:5243';
const shots = process.env.CC_QA_SHOTS ?? 'tmp/qa/kings-road';
await mkdir(shots, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const errors = [];
try {
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && /shader|program|WebGL|merge|geometr/i.test(m.text())) errors.push(m.text().slice(0, 300)); });
  p.setDefaultTimeout(30000);
  await p.addInitScript(() => {
    localStorage.setItem('cc.spec', JSON.stringify({ race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'Road walker' }));
    localStorage.setItem('cc.hintsSeen', '1');
    localStorage.setItem('cc.language', 'ko');
    localStorage.setItem('cc.quality', 'high');
  });
  await p.goto(base + '/?screen=game');
  await p.locator('.launch-notice-start').click();
  await p.waitForFunction(() => window.app?.current?.game?.loaded && !document.querySelector('.loading'), null, { timeout: 240000 });
  await p.evaluate(() => { const g = window.app.current.game; g.god = true; for (const e of g.enemies) e.unit.teleport?.(g.world, 200, 200); });
  await p.waitForTimeout(1000);

  // 1. Walkability of the centre line, plaza to zone line.
  const walk = await p.evaluate(async () => {
    const g = window.app.current.game, w = g.world, col = w.debug.collision;
    const L = await import('/src/world/layout.ts');
    const K = await import('/src/world/kingsRoad.ts');
    const out = { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; return this; } };
    const r = g.player.unit.radius;
    const blocked = [], solid = [], narrow = [];
    let maxGrade = 0, maxCross = 0, prev = null;
    for (let s = 0; s <= K.KINGS_LINE_ARC + 2; s += 0.5) {
      const p = L.kingsRoadAt(s);
      if (col.isBlockedCell(p.x, p.z)) blocked.push([+p.x.toFixed(1), +p.z.toFixed(1)]);
      w.resolveCollision(p.x, p.z, r, out);
      if (Math.hypot(out.x - p.x, out.y - p.z) > 0.05) solid.push([+p.x.toFixed(1), +p.z.toFixed(1)]);
      for (const side of [-1, 1]) { const x = p.x + p.dz * side * 1.6, z = p.z - p.dx * side * 1.6; if (col.isBlockedCell(x, z)) narrow.push([+x.toFixed(1), +z.toFixed(1)]); }
      const h = w.heightAt(p.x, p.z);
      if (prev) maxGrade = Math.max(maxGrade, Math.abs(h - prev.h) / Math.max(0.01, Math.hypot(p.x - prev.x, p.z - prev.z)));
      const hl = w.heightAt(p.x + p.dz * 1.6, p.z - p.dx * 1.6), hr = w.heightAt(p.x - p.dz * 1.6, p.z + p.dx * 1.6);
      maxCross = Math.max(maxCross, Math.abs(hl - hr) / 3.2);
      prev = { x: p.x, z: p.z, h };
    }
    return { length: K.KINGS_LINE_ARC, blocked, solid, narrow, maxGrade, maxCross, ret: L.KINGS_ROAD_RETURN, gate: L.KINGS_GATE, line: L.KINGS_ROAD_LINE };
  });
  console.log(JSON.stringify({ length: +walk.length.toFixed(1), maxGrade: +walk.maxGrade.toFixed(3), maxCross: +walk.maxCross.toFixed(3), blocked: walk.blocked.length, solid: walk.solid.length, narrow: walk.narrow.length, ret: walk.ret }));
  assert.deepEqual(walk.blocked, [], 'no blocked cell on the road centre');
  assert.deepEqual(walk.solid, [], 'no solid on the road centre');
  assert.deepEqual(walk.narrow, [], 'the road is open 1.6 either side of the centre');
  assert.ok(walk.maxGrade <= 0.22, `grade at most 0.22 (12 degrees): ${walk.maxGrade}`);
  assert.ok(walk.maxCross <= 0.12, `nearly level across the road: ${walk.maxCross}`);
  assert.ok(walk.ret.z > walk.line.a[1] + 4, 'the return point is south of the line');
  console.log(`PASS road ${walk.length.toFixed(0)} units from the plaza to the zone line: no blocked cell or solid, grade <= ${walk.maxGrade.toFixed(3)}`);

  // 2. Walk it: step along the road a frame at a time, then hold W across the line.
  const frame = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await p.evaluate(() => { window.__line = window.app.current.game.zoneLines.lines[0]; });
  const n = await p.evaluate(async () => (await import('/src/world/kingsRoad.ts')).KINGS_LINE_ARC);
  for (let s = 0; s < n - 3; s += 1.2) {
    await p.evaluate((s) => import('/src/world/layout.ts').then((L) => { const g = window.app.current.game, q = L.kingsRoadAt(s); g.player.unit.teleport(g.world, q.x, q.z, Math.atan2(q.dx, q.dz)); }), s);
    if (Math.round(s / 1.2) % 2 === 0) await frame();
  }
  await frame();
  assert.equal(await p.evaluate(() => window.__line.fired), 0, 'walking up to the line does not fire it');
  const cross = async () => {
    await p.evaluate((s) => import('/src/world/layout.ts').then((L) => { const g = window.app.current.game, u = g.player.unit, q = L.kingsRoadAt(s); u.teleport(g.world, q.x, q.z, Math.atan2(q.dx, q.dz)); u.setYaw(Math.PI); g.follow.yaw = u.yaw + Math.PI; g.follow.cut(); }), n - 4);
    await frame();
    const before = await p.evaluate(() => window.__line.fired);
    await p.keyboard.down('KeyW');
    await p.waitForFunction((b) => window.__line.fired > b, before, { timeout: 8000 });
    await p.keyboard.up('KeyW');
    await p.waitForTimeout(1500);
  };
  await cross();
  const fallback = await p.evaluate(() => ({ fired: window.__line.fired, z: window.app.current.game.player.unit.pos.z, chat: [...document.querySelectorAll('.chat .line.sys')].map((e) => e.textContent).join('\n') }));
  assert.equal(fallback.fired, 1, 'the zone line fired exactly once');
  assert.ok(fallback.z > walk.line.a[1] + 1, `turned back south of the line: z ${fallback.z}`);
  assert.ok(fallback.chat.includes('타이드크라운으로 가는 길은 곧 열려요'), 'the not-yet-open notice is in the chat');
  console.log(`PASS walked the road: the zone line fired once, the notice showed and the player stands back at z ${fallback.z.toFixed(1)}`);

  // 3. With Tidecrown present the same crossing goes through the fade into world2.enterTidecrown.
  await p.evaluate(() => {
    const g = window.app.current.game;
    window.__tc = 0; window.__dark = false;
    g.world2.enterTidecrown = () => { window.__tc++; window.__dark = !!document.querySelector('.cc-blackout.on'); return new Promise((r) => setTimeout(r, 300)); };
  });
  await cross();
  const enter = await p.evaluate(() => ({ fired: window.__line.fired, calls: window.__tc, dark: window.__dark, still: !!document.querySelector('.cc-blackout.on') }));
  await p.evaluate(() => { delete window.app.current.game.world2.enterTidecrown; });
  await p.waitForTimeout(800);
  assert.equal(enter.fired, 2, 'the line fired once more');
  assert.equal(enter.calls, 1, 'enterTidecrown called once');
  assert.ok(enter.dark, 'enterTidecrown runs under the black');
  assert.equal(await p.evaluate(() => !!document.querySelector('.cc-blackout.on')), false, 'the fade lifts again');
  console.log('PASS with world2.enterTidecrown present the crossing calls it once, under the fade, and the fade lifts');

  // 4. Skyline budget, no colliders north of World I, lantern answers the beacon.
  const sky = await p.evaluate(() => {
    const g = window.app.current.game, d = g.world.debug, grp = d.skyline.group;
    let tris = 0, draws = 0, shadows = 0;
    const unfogged = [];
    grp.traverse((m) => { if (!(m.isMesh || m.isPoints || m.isSprite)) return; draws++; if (m.castShadow) shadows++; if (m.material.fog === false) unfogged.push(m.name); if (m.isMesh) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3; else if (m.isSprite) tris += 2; });
    const north = d.collision.shapes.filter((s) => (s.kind === 0 ? s.c.z : s.b.z) < -251).length;
    return { tris, draws, shadows, unfogged: unfogged.sort(), north, underRoot: grp.parent === g.world.root };
  });
  console.log(JSON.stringify(sky));
  assert.ok(sky.tris <= 6000, `skyline triangles ${sky.tris}`);
  assert.ok(sky.draws <= 4, `skyline draws ${sky.draws}`);
  assert.equal(sky.shadows, 0, 'skyline casts no shadows');
  assert.deepEqual(sky.unfogged, ['tidecrown-lantern-beam', 'tidecrown-lantern-glow', 'tidecrown-skyline-windows'], 'only the lights skip the fog');
  assert.equal(sky.north, 0, 'no collider north of World I');
  assert.ok(sky.underRoot, 'skyline lives under the World I root');
  const lantern = await p.evaluate(async () => {
    const g = window.app.current.game, st = g.world.debug.skyline.state, wait = (ms) => new Promise((r) => setTimeout(r, ms));
    g.world.setBeaconLit(false, true);
    const off = st.level;
    const t0 = performance.now();
    g.world.setBeaconLit(true);
    await wait(1200);
    const early = st.level;
    g.world.setBeaconLit(true); // a repeated call (a snapshot) must not restart the wait
    let first = null;
    while (performance.now() - t0 < 7000) { if (first === null && st.level > 0) first = (performance.now() - t0) / 1000; if (st.level >= 1) break; await wait(50); }
    const full = (performance.now() - t0) / 1000;
    const glow = g.world.debug.skyline.group.getObjectByName('tidecrown-lantern-glow').visible;
    g.world.setBeaconLit(false, true);
    const unlit = st.level;
    g.world.setBeaconLit(true, true);
    const restored = st.level;
    g.world.setBeaconLit(false, true);
    return { off, early, first, full, glow, unlit, restored };
  });
  console.log(JSON.stringify(lantern));
  assert.equal(lantern.off, 0);
  assert.equal(lantern.early, 0, 'still dark 1.2 s after the beacon');
  assert.ok(lantern.first > 2.2 && lantern.first < 3.2, `the lantern answers about 2.5 s later: ${lantern.first}`);
  assert.ok(lantern.full > 4.0 && lantern.full < 5.6, `and is full about 2 s after that: ${lantern.full}`);
  assert.ok(lantern.glow, 'the glow shows when lit');
  assert.equal(lantern.unlit, 0, 'instant off');
  assert.equal(lantern.restored, 1, 'a restore shows it lit at once');
  console.log(`PASS skyline ${sky.tris} triangles in ${sky.draws} draws, no shadows or colliders; the lantern answers ${lantern.first.toFixed(2)} s after the beacon (not restarted by a repeated call), full at ${lantern.full.toFixed(2)} s, at once on a restore`);

  // 5. Draw calls and triangles the road and the skyline add to two World I views; then the review shots.
  await p.evaluate(() => { const g = window.app.current.game; window.app.ui.style.visibility = 'hidden'; g.objective.update = () => {}; g.objective.group.visible = false; g.player.unit.teleport(g.world, -70, 40, 0); });
  const VIEWS = {
    'a-square-north-dusk': { mood: 0, beacon: false, cam: [2, 5.5, 18], at: [60, 34, -300], ground: true },
    'b-signpost-fork': { mood: 0, beacon: false, cam: [-2.5, 2.4, -29.5], at: [-8.2, 3.3, -35.2], ground: true },
    'c-road-mid-ridge': { mood: 0, beacon: false, cam: [-30, 4, -168], at: [-20, 2, -190], ground: true },
    'd-kings-gate-north': { mood: 0, beacon: false, cam: [-56.5, 3.0, -213], at: [-60, 6.5, -240], ground: true },
    'e-lighthouse-night-lit': { mood: 1, beacon: true, cam: [190, 30.6, -136.6], at: [150, 70, -648], ground: false },
    'f-lighthouse-night-unlit': { mood: 1, beacon: false, cam: [190, 30.6, -136.6], at: [150, 70, -648], ground: false },
    'g-lighthouse-dusk': { mood: 0, beacon: false, cam: [190, 30.6, -136.6], at: [150, 70, -648], ground: false },
    'h-fork-from-square': { mood: 0, beacon: false, cam: [3, 3.2, -18], at: [-9, 5.5, -40], ground: true },
  };
  const place = (v) => p.evaluate((v) => {
    const g = window.app.current.game, h = (x, z) => g.world.heightAt(x, z);
    g.world.setBeaconLit(v.beacon, true); g.world.setMood(v.mood, true);
    const c = [v.cam[0], (v.ground ? h(v.cam[0], v.cam[2]) : 0) + v.cam[1], v.cam[2]];
    const t = [v.at[0], v.ground && v.at[2] > -250 ? h(v.at[0], v.at[2]) + v.at[1] : v.at[1], v.at[2]];
    g.follow.update = function () { this.camera.position.set(...c); this.camera.lookAt(...t); };
  }, v);
  const cost = {};
  for (const name of ['a-square-north-dusk', 'd-kings-gate-north']) {
    await place(VIEWS[name]);
    await p.waitForTimeout(1500);
    cost[name] = await p.evaluate(async () => {
      const g = window.app.current.game, d = g.world.debug, info = g.engine.renderer.info;
      const sample = async () => { await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return { calls: info.render.calls, tris: info.render.triangles }; };
      const on = await sample();
      d.skyline.group.visible = false; d.kingsRoad.visible = false;
      const off = await sample();
      d.skyline.group.visible = true; d.kingsRoad.visible = true;
      return { calls: on.calls - off.calls, tris: on.tris - off.tris };
    });
  }
  console.log('added by the road and skyline meshes (draw calls, triangles):', JSON.stringify(cost));
  for (const [name, v] of Object.entries(VIEWS)) {
    await place(v);
    await p.waitForTimeout(v.mood === 1 ? 3500 : 2200);
    await p.screenshot({ path: `${shots}/${name}.png`, timeout: 180000 });
  }
  console.log(`PASS wrote ${Object.keys(VIEWS).length} shots to ${shots}`);
  assert.deepEqual(errors, []);
  console.log('PASS zero browser or shader errors');
} finally {
  await browser.close();
}
