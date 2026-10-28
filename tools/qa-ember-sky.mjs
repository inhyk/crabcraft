// World V air QA (ember-sky lane): the baked sky, low amber sun, violet fill, ash fog and environment, the lava's heat
// light on the island's materials, the volcano's plume, strata and ash, and the basalt coast. Checks the objects exist
// for chapter 5 only, the old gradient sphere and spark points are gone, the coast stays out of the play area and the
// lava, the environment and heat light are bound only while World V is shown, both quality tiers build, and no page,
// three or shader errors. Writes three screenshots per tier.
//
// Usage: CC_QA_BASE=http://127.0.0.1:5651 node tools/qa-ember-sky.mjs     CC_QA_OUT=tmp/qa (where the PNGs go)
import assert from 'node:assert/strict';
import {launchBrowser} from './lib/browser.mjs';
import {mkdir} from 'node:fs/promises';

const base = process.env.CC_QA_BASE ?? 'http://127.0.0.1:5651';
const out = process.env.CC_QA_OUT ?? 'tmp/qa';
await mkdir(out, {recursive: true});

const VIEWS = [
  {name: 'volcano', x: 0, z: -60, yaw: 0, pitch: -.1, distance: 70},
  {name: 'coast-north', x: -60, z: -100, yaw: 2.4, pitch: .25, distance: 40},
  {name: 'edge-east', x: 98, z: -10, yaw: -1.2, pitch: .3, distance: 34},
];

const browser = await launchBrowser({headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio']});
const errors = [];
const results = {};
async function run(quality) {
  const p = await browser.newPage({viewport: {width: 1280, height: 800}});
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
        if (o.isMesh && (m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) { lit++; if (String(m.customProgramCacheKey()).includes('|ember-heat')) heat++; }
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
  assert.ok(r.heat > 100 && r.heat >= r.lit * .8, `${quality}: heat light on ${r.heat} of ${r.lit} lit materials`);
  assert.ok(r.envBound && r.heatOn === 1, `${quality}: environment and heat bound in World V`);
  assert.notEqual(r.fog, '#a07b70', `${quality}: fog follows the sky`);
  assert.deepEqual(r.sixth, {coast: false, sky: false}, `${quality}: nothing in World VI`);

  await p.evaluate(() => { window.app.ui.style.visibility = 'hidden'; const u = window.app.current.game.player.unit; u.hidden = true; u.rig.root.visible = false; });
  for (const v of VIEWS) {
    await p.evaluate(v => { const g = window.app.current.game; g.player.unit.teleport(g.world, v.x, v.z, v.yaw + Math.PI); g.follow.yaw = v.yaw; g.follow.pitch = v.pitch; g.follow.distance = v.distance; g.follow.cut(); }, v);
    await p.waitForTimeout(1600);
    await p.screenshot({path: `${out}/ember-sky-${quality}-${v.name}.png`});
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
