// World V air QA (ember-sky lane): the baked sky, low amber sun, violet fill, ash fog and environment, the lava's heat
// light on the island's materials, the volcano's plume, strata and ash, and the basalt coast. Checks the objects exist
// for chapter 5 only, the old gradient sphere and spark points are gone, the coast stays out of the play area and the
// lava, the environment and heat light are bound only while World V is shown, both quality tiers build, and no page,
// three or shader errors. Writes three screenshots per tier.
// Values (high tier, the standard design views of D/scripts/cap.mjs): values.py's numbers per view (greyscale p10/p50/
// p99, saturation median, share of the brightest 1% in the upper 35% of the frame) plus the share of the brightest 1%
// that is sky (the same view drawn again with the dome hidden). Targets from the W5 style sheet, owned by this lane:
// p50 55-85, saturation median 0.25-0.40, the sky under 15% of the brightest 1% (lava, forges and windows are the
// brightest), emitters reaching 230+, p10 not crushed. The upper-35% share is printed, not asserted: in east, west and
// arrivalF the glowing lava sea itself sits on the horizon in that band.
//
// Usage: CC_QA_BASE=http://127.0.0.1:5651 node tools/qa-ember-sky.mjs     CC_QA_OUT=tmp/qa (where the PNGs go)
import assert from 'node:assert/strict';
import {launchBrowser} from './lib/browser.mjs';
import {mkdir} from 'node:fs/promises';

const base = process.env.CC_QA_BASE ?? 'http://127.0.0.1:5651';
const out = process.env.CC_QA_OUT ?? 'tmp/qa';
await mkdir(out, {recursive: true});

// [x, z, yaw, pitch, dist] as in cap.mjs: the camera orbits the crab standing at (x, z).
const VALUE_VIEWS = {arrivalF: [-3, 68, -.75, .28, 20], village: [0, 55, .5, .5, 40], street: [0, 45, .3, .12, 9], east: [60, -5, -1.57, .3, 26], west: [-60, -5, 1.57, .3, 26], approach: [0, -30, 0, .22, 26], arena: [0, -75, 0, .5, 34], aerial: [0, 0, 0, 1.25, 180], tree: [0, -40, 0, .12, 30]};
const TARGET = {p50: [55, 85], sat: [.25, .4], skyTop: .15, max: 230, p10: 20};

/** values.py in the page: greyscale percentiles, clip, saturation median, where the brightest 1% sits, and how much of it is sky. */
async function frameValues(p, png, bare, unlit) {
  return p.evaluate(async ([a, b, c]) => {
    const load = async b64 => { const bm = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob()); const c = new OffscreenCanvas(bm.width, bm.height), x = c.getContext('2d'); x.drawImage(bm, 0, 0); return x.getImageData(0, 0, bm.width, bm.height); };
    const im = await load(a), sky = await load(b), dark = (await load(c)).data, d = im.data, s = sky.data, n = im.width * im.height, h = im.height;
    const g = new Float32Array(n), sat = new Float32Array(n);
    for (let i = 0; i < n; i++) { const r = d[i * 4] / 255, gg = d[i * 4 + 1] / 255, bb = d[i * 4 + 2] / 255, mx = Math.max(r, gg, bb), mn = Math.min(r, gg, bb); g[i] = (.299 * r + .587 * gg + .114 * bb) * 255; sat[i] = mx > 0 ? (mx - mn) / mx : 0; }
    const sorted = Float32Array.from(g).sort(), pct = q => sorted[Math.min(n - 1, Math.floor(q / 100 * n))];
    const top = pct(99); let topN = 0, upper = 0, skyN = 0, emitN = 0;
    for (let i = 0; i < n; i++) if (g[i] >= top) {
      topN++; if (Math.floor(i / im.width) < h * .35) upper++;
      // Sky: the pixel goes (almost) black once the dome is hidden.
      const gs = .299 * s[i * 4] + .587 * s[i * 4 + 1] + .114 * s[i * 4 + 2]; if (gs < 12 && g[i] - gs > 20) { skyN++; continue; }
      // Emissive: keeps at least half its value with the sun, fill, environment, rim and heat light off.
      if (.299 * dark[i * 4] + .587 * dark[i * 4 + 1] + .114 * dark[i * 4 + 2] >= g[i] * .5) emitN++;
    }
    return {p10: Math.round(pct(10)), p50: Math.round(pct(50)), p99: Math.round(pct(99)), max: Math.round(sorted[n - 1]), clip: +(sorted.filter(v => v >= 254.5).length / n * 100).toFixed(2), sat: +Float32Array.from(sat).sort()[n >> 1].toFixed(2), upper35: +(upper / topN).toFixed(2), skyTop: +(skyN / topN).toFixed(2), emitTop: +(emitN / topN).toFixed(2)};
  }, [png.toString('base64'), bare.toString('base64'), unlit.toString('base64')]);
}

const VIEWS = [
  {name: 'volcano', x: 0, z: -60, yaw: 0, pitch: -.1, distance: 70},
  {name: 'coast-north', x: -60, z: -100, yaw: 2.4, pitch: .25, distance: 40},
  {name: 'edge-east', x: 98, z: -10, yaw: -1.2, pitch: .3, distance: 34},
];

const browser = await launchBrowser({headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio']});
const errors = [];
const results = {};
async function run(quality) {
  const p = await browser.newPage({viewport: {width: 1600, height: 900}});
  p.on('pageerror', e => errors.push(`${quality}: ${e.message}`));
  p.on('console', m => { if (m.type() === 'error' && /THREE|WebGL|shader|program/i.test(m.text())) errors.push(`${quality}: ${m.text().slice(0, 600)}`); });
  p.setDefaultTimeout(30000);
  await p.addInitScript(([q]) => {
    localStorage.setItem('cc.spec', JSON.stringify({race: 'human', sex: 'male', classId: 'mage', shell: 0, crest: 0, led: 0, name: 'Sky QA'}));
    localStorage.setItem('cc.hintsSeen', '1'); localStorage.setItem('cc.language', 'ko'); localStorage.setItem('cc.quality', q);
    if (location.hostname === '127.0.0.1') { const WS = window.WebSocket; window.WebSocket = class extends WS { constructor(url, protocols) { const u = new URL(String(url)); if (u.pathname === '/multiplayer') { u.host = location.host; u.protocol = 'ws:'; } super(u.href, protocols); } }; }
  }, [quality]);
  await p.goto(base + '/?screen=game');
  await p.locator('.launch-notice-start').click();
  await p.waitForFunction(() => window.app?.current?.game?.loaded && !document.querySelector('.loading'), null, {timeout: 90000});
  await p.evaluate(() => { const g = window.app.current.game; g.god = true; g.player.nextSwing = Infinity; });
  await p.waitForTimeout(1000); await p.keyboard.press('Space');
  await p.evaluate(() => { const g = window.app.current.game; g.creatorTravel = true; g.world2.go(5); });
  await p.waitForTimeout(6000);

  const r = await p.evaluate(() => {
    const g = window.app.current.game, f = g.world2.fifth, a = f.air, root = f.root;
    const named = n => root.getObjectByName(n);
    const cols = named('ember-coast-columns'), spat = named('ember-coast-spatter');
    // Old primitives in this lane's scope: the two-colour gradient sphere and the 360 spark points.
    let gradientSky = 0, oldSparks = 0, heat = 0, lit = 0;
    root.traverse(o => {
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of ms) {
        if (m.uniforms?.top && m.uniforms?.bottom) gradientSky++;
        if (o.isPoints && m.uniforms?.tint) oldSparks++;
        // Lit materials outside the subtrees the heat leaves alone (the lava itself, the portals shared with other worlds).
        let skipped = false; for (let q = o; q; q = q.parent) if (a.noHeat.includes(q)) skipped = true;
        if (o.isMesh && !skipped && (m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) { lit++; if (String(m.customProgramCacheKey()).includes('|ember-heat')) heat++; }
      }
    });
    // Coast: every column and lump outside the walkable ellipse (FRONTIER_BOUNDS max .8) and outside the lava zones.
    const m = new root.matrix.constructor(), bad = {inside: 0, lava: 0};
    const zones = f.lava.zones;
    const check = mesh => { for (let i = 0; i < mesh.count; i++) { mesh.getMatrixAt(i, m); const e = m.elements, x = e[12], z = e[14], rad = Math.hypot(e[0], e[2]); const ell = Math.hypot(x / 128, (z - 2) / 155); if (ell - rad / 128 < .8) bad.inside++; if (zones.some(zn => Math.hypot(x - zn.x, z - zn.z) < zn.radius)) bad.lava++; } };
    check(cols); check(spat);
    const sun = a.sun, d = sun.position.clone().sub(sun.target.position).normalize();
    return {
      sky: !!named('ember-sky'), plume: !!named('ember-volcano-plume'), air: !!named('ember-ash-and-embers'),
      columns: cols?.count ?? 0, spatter: spat?.count ?? 0, particles: named('ember-ash-and-embers')?.geometry.getAttribute('aSeed').count ?? 0,
      puffs: named('ember-volcano-plume')?.geometry.instanceCount ?? 0,
      volcano: named('ember-volcano')?.material.name, gradientSky, oldSparks, heat, lit, bad,
      sunElevation: Math.asin(d.y) * 180 / Math.PI, sunCastsShadow: sun.castShadow,
      envBound: g.scene.environment !== null && g.scene.environment === a.env, heatOn: a.heat.uniforms.uHeatOn.value,
      fog: '#' + g.scene.fog.color.getHexString(),
      exposure: g.engine.renderer.toneMappingExposure, grade: g.engine.viewOptions.grade ?? null, rim: '#' + a.rim.color.getHexString(),
      rimNear: a.rim.position.distanceTo(g.player.unit.pos) < 2.5,
      sixth: { coast: !!g.world2.sixth.root.getObjectByName('ember-coast-columns'), sky: !!g.world2.sixth.root.getObjectByName('ember-sky') },
    };
  });
  results[quality] = r;
  assert.ok(r.sky && r.plume && r.air, `${quality}: sky, plume and ash objects`);
  assert.equal(r.volcano, 'ember-volcano-strata', `${quality}: volcano strata material`);
  assert.equal(r.gradientSky, 0, `${quality}: old gradient sky sphere gone`);
  assert.equal(r.oldSparks, 0, `${quality}: old spark points gone`);
  assert.ok(r.columns > (quality === 'high' ? 1000 : 600), `${quality}: coast columns ${r.columns}`);
  assert.ok(r.spatter > 200, `${quality}: waterline spatter ${r.spatter}`);
  assert.deepEqual(r.bad, {inside: 0, lava: 0}, `${quality}: coast outside the play area and the lava`);
  assert.ok(r.sunElevation >= 15 && r.sunElevation <= 25, `${quality}: low sun ${r.sunElevation}`);
  assert.ok(r.sunCastsShadow, `${quality}: sun shadows`);
  assert.ok(r.heat > 30 && r.heat === r.lit, `${quality}: heat light on ${r.heat} of ${r.lit} lit materials`);
  assert.ok(r.envBound && r.heatOn === 1, `${quality}: environment and heat bound in World V`);
  assert.notEqual(r.fog, '#a07b70', `${quality}: fog follows the sky`);
  assert.ok(r.exposure > 1.5 && r.grade === null, `${quality}: World V view: exposure ${r.exposure}, no colour grade`);
  assert.ok(r.rim === '#9fc4ff' && r.rimNear, `${quality}: cool rim light on the crab`);
  assert.deepEqual(r.sixth, {coast: false, sky: false}, `${quality}: nothing in World VI`);

  await p.evaluate(() => { window.app.ui.style.visibility = 'hidden'; const u = window.app.current.game.player.unit; u.hidden = true; u.rig.root.visible = false; });
  for (const v of VIEWS) {
    await p.evaluate(v => { const g = window.app.current.game; g.player.unit.teleport(g.world, v.x, v.z, v.yaw + Math.PI); g.follow.yaw = v.yaw; g.follow.pitch = v.pitch; g.follow.distance = v.distance; g.follow.cut(); }, v);
    await p.waitForTimeout(1600);
    await p.screenshot({path: `${out}/ember-sky-${quality}-${v.name}.png`});
  }

  if (quality === 'high') {
    // Standard views with a fixed orbit camera, enemies and other crabs moved away (cap.mjs's set-up).
    await p.evaluate(() => {
      const g = window.app.current.game; g.player.unit.hidden = false; g.player.unit.rig.root.visible = true;
      g.follow.__orig = g.follow.update; g.follow.update = function () { const s = window.__cam; if (!s) return this.__orig.apply(this, arguments); const cp = Math.cos(s.pitch); this.camera.position.set(s.tx + Math.sin(s.yaw) * cp * s.dist, s.ty + Math.sin(s.pitch) * s.dist, s.tz + Math.cos(s.yaw) * cp * s.dist); this.camera.lookAt(s.tx, s.ty, s.tz); };
      const away = () => { if (window.__stopAway) return; let i = 0; for (const e of g.enemies) e.unit.teleport?.(g.world, 200, 200); for (const u of g.units) if (u !== g.player.unit) { i++; if (Math.hypot(u.pos.x - 210, u.pos.z - 200 - i * 3) > 1) u.teleport?.(g.world, 210, 200 + i * 3, 0); } requestAnimationFrame(away); }; away();
    });
    const values = {};
    for (const [name, v] of Object.entries(VALUE_VIEWS)) {
      await p.evaluate(([x, z, yaw, pitch, dist]) => { const g = window.app.current.game; g.player.unit.teleport(g.world, x, z, yaw + Math.PI); const u = g.player.unit.pos; window.__cam = {tx: u.x, ty: u.y + 1.2, tz: u.z, yaw, pitch, dist}; }, v);
      await p.waitForTimeout(2200);
      const png = await p.screenshot({path: `${out}/ember-sky-values-${name}.png`});
      await p.evaluate(() => { const a = window.app.current.game.world2.fifth.air; a.sky.mesh.visible = false; window.__bg = window.app.current.game.scene.background; window.app.current.game.scene.background = null; });
      await p.waitForTimeout(400);
      const bare = await p.screenshot();
      await p.evaluate(() => { const a = window.app.current.game.world2.fifth.air; a.sky.mesh.visible = true; window.app.current.game.scene.background = window.__bg; });
      await p.evaluate(() => { const a = window.app.current.game.world2.fifth.air; window.__lights = [a.sun.intensity, a.hemi.intensity, a.rim.intensity, a.sky.envIntensity, a.heat.uniforms.uHeatColor.value.clone()]; a.sun.intensity = a.hemi.intensity = a.rim.intensity = 0; a.sky.envIntensity = 0; a.heat.uniforms.uHeatColor.value.setRGB(0, 0, 0); });
      await p.waitForTimeout(400);
      const unlit = await p.screenshot();
      await p.evaluate(() => { const a = window.app.current.game.world2.fifth.air, l = window.__lights; a.sun.intensity = l[0]; a.hemi.intensity = l[1]; a.rim.intensity = l[2]; a.sky.envIntensity = l[3]; a.heat.uniforms.uHeatColor.value.copy(l[4]); });
      values[name] = await frameValues(p, png, bare, unlit);
    }
    await p.evaluate(() => { window.__cam = null; window.__stopAway = true; const g = window.app.current.game; g.follow.update = g.follow.__orig; });
    r.values = values;
    console.log('view p10 p50 p99 max clip% satMed top1%InUpper35% skyShareOfTop1% emissiveShareOfTop1%');
    for (const [n, v] of Object.entries(values)) console.log(n, v.p10, v.p50, v.p99, v.max, v.clip, v.sat, v.upper35, v.skyTop, v.emitTop);
    for (const [n, v] of Object.entries(values)) {
      assert.ok(v.p50 >= TARGET.p50[0] && v.p50 <= TARGET.p50[1], `${n}: p50 ${v.p50} outside ${TARGET.p50}`);
      assert.ok(v.sat >= TARGET.sat[0] && v.sat <= TARGET.sat[1], `${n}: saturation median ${v.sat} outside ${TARGET.sat}`);
      assert.ok(v.skyTop <= TARGET.skyTop, `${n}: sky is ${v.skyTop} of the brightest 1%`);
      assert.ok(v.max >= TARGET.max, `${n}: brightest pixel ${v.max} under ${TARGET.max} (emitters)`);
      assert.ok(v.p10 >= TARGET.p10, `${n}: p10 ${v.p10} crushed`);
    }
  }

  // Leaving World V hands the environment back and switches the heat light off.
  const left = await p.evaluate(async () => {
    const g = window.app.current.game, a = g.world2.fifth.air; g.world2.go(1);
    await new Promise(r => setTimeout(r, 2500));
    return {envBound: g.scene.environment === a.env, heatOn: a.heat.uniforms.uHeatOn.value};
  });
  assert.deepEqual(left, {envBound: false, heatOn: 0}, `${quality}: released after leaving World V`);
  await p.close();
}

try {
  await run('high');
  await run('low');
  assert.ok(results.low.columns < results.high.columns && results.low.particles < results.high.particles && results.low.puffs < results.high.puffs, 'low quality is lighter');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(results, null, 1));
  console.log('PASS qa-ember-sky');
} finally { await browser.close(); }
