// Tidecrown scenery: creator travel builds the capital on first entry; six fixed cameras (reveal from the ridge, the
// bridge, the King's Stair, an aerial, the harbour, the Pincer Gate) and a World I arrival shot for comparison, with
// draw calls and triangles; the walk from the arrival over the crest, across the bridge, through the gate and up the
// King's Way and the stair to the ward gate is open and gently graded; no page errors.
// Usage: CC_QA_BASE=http://127.0.0.1:5241 node tools/qa-tidecrown-scenery.mjs  (CC_QA_SHOTS sets the output folder)
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.CC_QA_BASE ?? 'http://127.0.0.1:5241';
const out = process.env.CC_QA_SHOTS ?? 'tmp/qa/tidecrown';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const errors = [];
try {
  const p = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && /shader|program|WebGL|merge|geometr|tidecrown/i.test(m.text())) errors.push(m.text().slice(0, 300)); });
  p.setDefaultTimeout(60000);
  await p.addInitScript(() => {
    localStorage.setItem('cc.spec', JSON.stringify({ race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'Tidecrown walker' }));
    localStorage.setItem('cc.hintsSeen', '1');
    localStorage.setItem('cc.language', 'ko');
    localStorage.setItem('cc.quality', 'high');
  });
  await p.goto(base + '/?screen=game');
  await p.locator('.launch-notice-start').click();
  await p.waitForFunction(() => window.app?.current?.game?.loaded && !document.querySelector('.loading'), null, { timeout: 240000 });
  await p.evaluate(() => { const g = window.app.current.game; g.god = true; g.player.nextSwing = Infinity; });
  await p.waitForTimeout(2500);

  // Draw calls and triangles of one whole frame (shadow passes and post included).
  const frameStats = () => p.evaluate(() => new Promise((resolve) => {
    const e = window.app.engine, off = e.onAfterFrame(() => { off(); const r = e.renderer.info.render; resolve({ calls: r.calls, triangles: r.triangles }); });
  }));
  // Scenery shots without the HUD, so they compare with the concept art.
  const hud = (on) => p.evaluate((on) => {
    // Every overlay beside the canvas (HUD, side panels, menus).
    const canvas = document.querySelector('canvas');
    for (let a = canvas; a && a !== document.body; a = a.parentElement) for (const el of a.parentElement.children) if (el !== a && !el.contains(canvas)) el.style.visibility = on ? '' : 'hidden';
  }, on);
  await hud(false);
  const w1 = await frameStats();
  await p.screenshot({ path: `${out}/w1-arrival.png` });
  await hud(true);

  const entry = await p.evaluate(async () => {
    const g = window.app.current.game, t0 = performance.now();
    g.creatorTravel = true;
    const ok = await g.world2.enterTidecrown();
    return { ok, ms: Math.round(performance.now() - t0), entryMs: Math.round(g.world2.tidecrownEntryMs), info: g.world2.tidecrown.info, chapter: g.world2.chapter, quest: g.quests.chapter };
  });
  assert.equal(entry.ok, true, 'enterTidecrown() resolves true');
  await p.waitForFunction(() => !document.querySelector('.tidecrown-veil'), null, { timeout: 30000 });
  await p.waitForTimeout(2500);

  // The walk: arrival, up the road to the crest, down to the bridge, across it, through the gate, up the King's Way
  // and the King's Stair to the ward gate.
  const walk = await p.evaluate(async () => {
    const g = window.app.current.game, w = g.world;
    const L = await import('/src/game/tidecrown/layout.ts');
    const pts = [...L.TC_ROAD.slice(1).map(([x, z]) => [x, z])];
    for (const t of [-100, -60, -20, -8, 0, 30, 60, 104, 140, 165, 183, 201, 206, 214]) pts.push(L.tcAxis(t));
    const out = { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; return this; } };
    const r = g.player.unit.radius;
    let samples = 0, worstStep = 0, worstAt = null;
    const pushed = [];
    let prev = null;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5);
      for (let k = 0; k < n; k++) {
        const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n, y = w.heightAt(x, z);
        w.resolveCollision(x, z, r, out);
        if (Math.hypot(out.x - x, out.y - z) > 0.02) pushed.push([+x.toFixed(1), +z.toFixed(1)]);
        if (prev !== null && Math.abs(y - prev) > worstStep) { worstStep = Math.abs(y - prev); worstAt = [+x.toFixed(1), +z.toFixed(1)]; }
        prev = y;
        samples++;
      }
    }
    return { zone: g.zone, minimap: g.hud.minimap.snap === g.world2.tidecrown.map, samples, pushed: pushed.slice(0, 12), pushedCount: pushed.length, worstStep: +worstStep.toFixed(3), worstAt, crest: +w.heightAt(...L.tcAxis(-135)).toFixed(2), deck: +w.heightAt(...L.tcAxis(-53)).toFixed(2), ward: +w.heightAt(...L.tcAxis(209.3)).toFixed(2) };
  });
  console.log(JSON.stringify({ entry, walk }));
  assert.equal(entry.chapter, 1, 'Tidecrown is laid over the current world chapter');
  assert.equal(walk.zone, '타이드크라운', 'the zone reads Tidecrown');
  assert.ok(walk.minimap, 'the minimap shows Tidecrown');
  assert.equal(walk.pushedCount, 0, `the walk is open: ${JSON.stringify(walk.pushed)}`);
  assert.ok(walk.worstStep < 0.45, `height steps stay walkable: ${walk.worstStep} at ${walk.worstAt}`);
  assert.ok(Math.abs(walk.deck - 8) < 0.01 && Math.abs(walk.crest - 28) < 0.3 && Math.abs(walk.ward - 40) < 0.6, JSON.stringify(walk));
  console.log(`PASS walk: ${walk.samples} samples from the arrival to the ward gate, none blocked, worst step ${walk.worstStep}`);

  /** Fixed camera at (x, eye above ground, z) looking at (x, height above ground or absolute, z); the player stands at `crab`. */
  async function shot(name, cam, at, crab) {
    await p.evaluate(([cam, at, crab]) => {
      const g = window.app.current.game, h = (x, z) => g.world.heightAt(x, z);
      if (crab) g.player.unit.teleport(g.world, crab[0], crab[1], crab[2]);
      const c = [cam[0], cam[3] ? cam[1] : h(cam[0], cam[2]) + cam[1], cam[2]], t = [at[0], at[3] ? at[1] : h(at[0], at[2]) + at[1], at[2]];
      g.follow.update = function () { this.camera.position.set(...c); this.camera.lookAt(...t); };
    }, [cam, at, crab]);
    await p.waitForTimeout(1800);
    const stats = await frameStats();
    await p.screenshot({ path: `${out}/${name}.png` });
    return stats;
  }
  const L = await p.evaluate(async () => {
    const L = await import('/src/game/tidecrown/layout.ts');
    const a = (t, s = 0) => L.tcAxis(t, s);
    return { crest: a(-133, -2.5), overlookBack: a(-147, 0), keep: [L.TC_KEEP.x, L.TC_KEEP.z], deckSouth: a(-92, 1.5), deckCrab: a(-86, 2.5), gate: a(0), gateFront: a(-14, 2), stairFoot: a(158, 0), stairCrab: a(162, 1), aerial: a(-210, -230), centre: a(130, 0), harbourSea: [330, -20], harbourAim: [L.TC_KEEP.x, L.TC_KEEP.z], yaw: Math.atan2(-L.TC_AXIS.ux, -L.TC_AXIS.uz) + Math.PI };
  });
  await hud(false);
  const shots = {};
  shots.reveal = await shot('1-reveal', [L.overlookBack[0], 7.5, L.overlookBack[1]], [L.keep[0], 50, L.keep[1], 1], [L.crest[0], L.crest[1], L.yaw]);
  shots.bridge = await shot('2-bridge', [L.deckSouth[0], 2.5, L.deckSouth[1]], [L.gate[0], 13, L.gate[1]], [L.deckCrab[0], L.deckCrab[1], L.yaw]);
  shots.keep = await shot('3-keep', [L.stairFoot[0], 2.4, L.stairFoot[1]], [L.keep[0], 108, L.keep[1], 1], [L.stairCrab[0], L.stairCrab[1], L.yaw]);
  shots.aerial = await shot('4-aerial', [L.aerial[0], 210, L.aerial[1], 1], [L.centre[0], 10, L.centre[1]], null);
  shots.harbour = await shot('5-harbour', [L.harbourSea[0], 9, L.harbourSea[1], 1], [L.harbourAim[0], 70, L.harbourAim[1], 1], null);
  shots.gate = await shot('6-gate', [L.gateFront[0], 2.2, L.gateFront[1]], [L.gate[0], 30, L.gate[1]], null);
  await hud(true);
  console.log(JSON.stringify({ w1Arrival: w1, tidecrown: shots }));
  console.log(`PASS six Tidecrown shots and a World I arrival shot in ${out}`);

  const left = await p.evaluate(() => { const g = window.app.current.game; g.world2.go(1); return { inside: g.world2.inTidecrown, visible: g.world2.tidecrown.root.visible, base: g.world.root.visible, quest: g.quests.chapter }; });
  assert.deepEqual({ inside: left.inside, visible: left.visible, base: left.base }, { inside: false, visible: false, base: true }, 'leaving restores World I');
  assert.equal(left.quest, entry.quest, 'the quest chapter never changed');
  // A second entry reuses the built island.
  const again = await p.evaluate(async () => { const g = window.app.current.game, t0 = performance.now(); await g.world2.enterTidecrown(); const ms = Math.round(performance.now() - t0); g.world2.returnToShore(); return { ms, inside: g.world2.inTidecrown, base: g.world.root.visible }; });
  assert.deepEqual({ inside: again.inside, base: again.base }, { inside: false, base: true });
  console.log(`PASS leaving Tidecrown restores World I and the quest chapter; a second entry took ${again.ms} ms`);
  assert.deepEqual(errors, []);
  console.log('PASS zero page or shader errors');
} finally {
  await browser.close();
}
