// Browser regression checks for the tribute opening: pole clearance, the old 57 s cut,
// footprints beside the moving cast at the end of the wide shot, and restoration on clear().
// CC_QA_BASE=http://127.0.0.1:5343 node tools/cinema/qa-snow-opening.mjs
import assert from 'node:assert/strict';
import { advance, openApp } from '../trailer/lib.mjs';
import { shots } from './tribute/program.mjs';

const face = shots.find((s) => s.id === 'snow-face');
const wide = shots.find((s) => s.id === 'snow-wide');
assert.equal(face.at + face.length, wide.at);
const app = await openApp({ base: process.env.CC_QA_BASE ?? 'http://127.0.0.1:5343', query: 'screen=game', dsf: 1, size: [960, 436], spec: { race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'Camera' } });
const { page } = app;
try {
  const start = page.locator('.launch-notice-start');
  if (await start.count()) await start.first().click({ timeout: 30000 });
  await page.waitForFunction(() => window.app?.current?.game?.loaded && !document.querySelector('.loading'), null, { timeout: 180000 });
  await page.evaluate(async () => {
    (await import('/src/capture/cinema/index.ts')).default.init();
    window.__capture.begin();
    window.__cinema.travel(4);
  });
  for (let i = 0; i < 40; i++) {
    await advance(app, 0.5, 30);
    if (await page.evaluate(() => window.__cinema.chapter === 4 && !document.querySelector('.loading'))) break;
  }
  await advance(app, 2, 30);
  await page.evaluate(() => {
    const scene = window.app.current.game.scene;
    window.__lampOriginals = [];
    scene.traverse((o) => {
      if (['frostlight-lamp-posts', 'frostlight-lantern-flames', 'frostlight-lantern-glow'].includes(o.name) || o.name.startsWith('frostlight-props:')) window.__lampOriginals.push([o, o.geometry]);
    });
  });
  await page.evaluate((s) => window.__cinema.stage(s), face);
  await page.evaluate(() => window.__cinema.seek(10));
  await advance(app, 1, 24);
  const lamp = await page.evaluate(() => {
    const old = window.__lampOriginals;
    return { replaced: old.filter(([o, g]) => o.geometry !== g).map(([o]) => o.name), poles: !!old.find(([o, g]) => o.name === 'frostlight-lamp-posts' && o.geometry !== g) };
  });
  assert.ok(lamp.poles);
  assert.ok(lamp.replaced.includes('frostlight-lantern-flames'));
  assert.ok(lamp.replaced.includes('frostlight-lantern-glow'));
  assert.ok(lamp.replaced.some((n) => n.startsWith('frostlight-props:')));
  const frames = [];
  for (let i = 0; i < 252; i++) { // 50.5 s through 61 s, including the original cut and the walk.
    await advance(app, 1 / 24, 24);
    frames.push(await page.evaluate(() => {
      const g = window.app.current.game;
      const units = ['dwarf', 'beast'].map((name) => g.units.find((u) => u.name === name));
      const beast = units[1];
      const feet = ['LM', 'RM', 'LR', 'RR'].map((leg) => {
        const p = beast.rig.linkNode(`${leg}_foot_tip_link`).getWorldPosition(beast.pos.clone());
        return Math.hypot(p.x + 3.921372725951869, p.z + 18.125775308568286);
      });
      return { t: window.__cinema.time, camera: g.camera.position.toArray(), actors: units.map((u) => u.pos.toArray()), clearance: Math.min(...feet) };
    }));
  }
  const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
  const cut = frames.filter((f) => f.t >= 16.9 && f.t <= 18.1);
  let cameraStep = 0, actorStep = 0;
  for (let i = 1; i < cut.length; i++) {
    cameraStep = Math.max(cameraStep, distance(cut[i].camera, cut[i - 1].camera));
    for (let j = 0; j < 2; j++) actorStep = Math.max(actorStep, distance(cut[i].actors[j], cut[i - 1].actors[j]));
  }
  const clearance = Math.min(...frames.map((f) => f.clearance));
  assert.ok(clearance > 1, `feet clear the relocated pole: ${clearance}`);
  assert.ok(cameraStep < 0.08 && actorStep < 0.1, `no jump at 57 s: ${JSON.stringify({ cameraStep, actorStep })}`);
  const last = frames.at(-1);
  await page.evaluate((s) => window.__cinema.stage(s), wide);
  await page.evaluate(() => window.__cinema.seek(0));
  await advance(app, 1 / 24, 24);
  const next = await page.evaluate(() => ['dwarf', 'beast'].map((name) => window.app.current.game.units.find((u) => u.name === name).pos.toArray()));
  assert.ok(next.every((p, i) => distance(p, last.actors[i]) < 0.1), 'cast continues across the 61 s wide cut');
  await advance(app, 5.5, 24);
  const stampsBefore = await page.evaluate(() => window.app.current.game.world2.fourth.deform.stats.stamps);
  await advance(app, 0.5, 24);
  const footprints = await page.evaluate(() => {
    const g = window.app.current.game, d = g.world2.fourth.deform;
    const actors = ['dwarf', 'beast'].map((name) => {
      const u = g.units.find((u) => u.name === name);
      let depth = 0;
      for (const leg of ['LM', 'RM', 'LR', 'RR']) {
        const p = u.rig.linkNode(`${leg}_foot_tip_link`).getWorldPosition(u.pos.clone());
        for (let x = -0.3; x <= 0.3; x += 0.15) for (let z = -0.3; z <= 0.3; z += 0.15) depth = Math.max(depth, d.sample(g.engine.renderer, p.x + x, p.z + z)[0]);
      }
      return { name, depth, distanceFromField: Math.max(Math.abs(u.pos.x - d.uniforms.snowDeformCenter.value.x), Math.abs(u.pos.z - d.uniforms.snowDeformCenter.value.y)) };
    });
    return { stamps: d.stats.stamps, actors };
  });
  assert.ok(footprints.stamps > stampsBefore, 'footprints still accumulate near the end of the wide shot');
  assert.ok(footprints.actors.every((a) => a.depth > 0.005 && a.distanceFromField < 12), JSON.stringify(footprints));
  await page.evaluate(() => window.__cinema.clear());
  const restored = await page.evaluate(() => window.__lampOriginals.every(([o, g]) => o.geometry === g));
  assert.ok(restored, 'all original lamp geometry restored after the cinematic');
  assert.deepEqual(app.errors, []);
  console.log(JSON.stringify({ passed: 5, failed: 0, lamp, clearance, cameraStep, actorStep, footprints, newStamps: footprints.stamps - stampsBefore, restored, pageErrors: app.errors }, null, 2));
} finally {
  await app.browser.close();
}
