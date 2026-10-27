// World III square, streets and court QA (dawn-plaza, 2026-10-28): the square's scenes (well, trough, hitching rail,
// cargo, hand cart, shade canopy) and the offerings before the gate stand where dawnPlazaPlan.ts puts them, clear of
// the roads, the lanes, the villagers' posts, the quest points, the lamps and the houses, and their solids are in the
// world's collision; the court's ruins stay outside the dais kerb and clear of the sun pillars and the colonnade; the
// quarter has its parapet profiles and painted door frames; the street paving and the dial floor read warm (hue under
// 60 degrees, not the old blue-grey) on the street and arena views; zero page/GL errors at high and low quality.
//   CC_QA_BASE=http://127.0.0.1:5627 node tools/qa-dawn-plaza.mjs
import assert from 'node:assert/strict';
import {mkdir, rm} from 'node:fs/promises';
import {build} from 'esbuild';
import {launchBrowser} from './lib/browser.mjs';

const base = process.env.CC_QA_BASE ?? 'http://127.0.0.1:5627';
await mkdir('tmp/qa', {recursive: true});

// ---- Plan checks in node.
const out = 'tmp/qa/dawn-plaza-plan.mjs';
await build({stdin: {contents: `export * from './src/game/dawnPlazaPlan.ts'; export {dawnBlocks} from './src/game/dawnHousePlan.ts'; export {COURT_RUINS, CITADEL_DAIS, CITADEL_ARENA, citadelObelisks, colonnadeColumns} from './src/game/dawnCitadelLayout.ts'; export {dawnLampPosts, DAWN_PATHS, roadClearance} from './src/game/world3Colliders.ts'; export {DAWN_POINTS} from './src/game/dawnQuests.ts';`, resolveDir: process.cwd(), loader: 'ts'}, bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error'});
const plan = await import(new URL('../' + out, import.meta.url).href);
await rm(out);
const TOWN = [[-16, 48], [16, 48], [-26, 38], [26, 38], [-20, 64], [20, 80], [20, 64]];
const issues = [];
const solids = plan.plazaSolids();
const reach = s => 'r' in s ? s.r : Math.hypot(s.hx, s.hz);
for (const s of solids) {
  const r = reach(s);
  // Roads and lanes: a circle's edge, or every corner and edge midpoint of a box, at least 0.3 m off the paving.
  const edge = 'r' in s ? [[s.x, s.z, s.r]] : [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 1], [0, -1], [1, 0], [-1, 0]].map(([a, b]) => { const c = Math.cos(s.yaw), sn = Math.sin(s.yaw), lx = a * s.hx, lz = b * s.hz; return [s.x + lx * c + lz * sn, s.z - lx * sn + lz * c, 0]; });
  for (const [x, z, rad] of edge) if (plan.roadClearance(x, z) < rad + .3) issues.push(`solid at ${s.x.toFixed(1)},${s.z.toFixed(1)} on a road or lane (${plan.roadClearance(x, z).toFixed(2)})`);
  for (const [k, [x, z]] of Object.entries(plan.DAWN_POINTS)) if (Math.hypot(x - s.x, z - s.z) < r + 2.5) issues.push(`${k} by the solid at ${s.x.toFixed(1)},${s.z.toFixed(1)}`);
  for (const [x, z] of TOWN) if (Math.hypot(x - s.x, z - s.z) < r + 2.6) issues.push(`villager post ${x},${z} by the solid at ${s.x.toFixed(1)},${s.z.toFixed(1)}`);
  for (const l of plan.dawnLampPosts()) if (Math.hypot(l.x - s.x, l.z - s.z) < r + 1) issues.push(`lamp ${l.x},${l.z} by the solid at ${s.x.toFixed(1)},${s.z.toFixed(1)}`);
  for (const b of plan.dawnBlocks()) {
    if (b.role === 'bridge') continue;
    const c = Math.cos(b.yaw), sn = Math.sin(b.yaw), dx = s.x - b.x, dz = s.z - b.z, lx = dx * c - dz * sn, lz = dx * sn + dz * c;
    if (Math.abs(lx) < b.w / 2 + r + .6 && Math.abs(lz) < b.d / 2 + r + .6) issues.push(`solid at ${s.x.toFixed(1)},${s.z.toFixed(1)} against ${b.id}`);
  }
}
const kinds = new Set(plan.DAWN_PLAZA.map(s => s.kind));
for (const k of ['well', 'trough', 'hitch', 'cargo', 'cart', 'canopy', 'offering']) if (!kinds.has(k)) issues.push(`no ${k}`);
for (const r of plan.COURT_RUINS) {
  const d = Math.hypot(r.x - plan.CITADEL_ARENA.x, r.z - plan.CITADEL_ARENA.z);
  if (d < plan.CITADEL_DAIS + .6) issues.push(`ruin ${r.kind} at ${r.x},${r.z} inside the dais (${d.toFixed(1)})`);
  for (const o of plan.citadelObelisks()) if (Math.hypot(o.x - r.x, o.z - r.z) < 2.6) issues.push(`ruin at ${r.x},${r.z} by a sun pillar`);
  for (const c of plan.colonnadeColumns()) if (Math.hypot(c.x - r.x, c.z - r.z) < 2.4) issues.push(`ruin at ${r.x},${r.z} by a column`);
}
console.log('PLAN', JSON.stringify({scenes: plan.DAWN_PLAZA.length, solids: solids.length, ruins: plan.COURT_RUINS.length, issues}));
assert.deepEqual(issues, [], 'the square and the court keep clear');

// ---- In the game.
const browser = await launchBrowser({headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio']});
const errors = [];
async function open(quality) {
  const p = await browser.newPage({viewport: {width: 1280, height: 720}});
  p.on('pageerror', e => errors.push(`${quality} page: ${e.message}`));
  p.on('console', m => { if (m.type() === 'error' && /shader|program|WebGL|GL_|THREE/i.test(m.text())) errors.push(`${quality} console: ${m.text().slice(0, 300)}`); });
  await p.routeWebSocket('**/multiplayer*', ws => ws.close());
  await p.addInitScript(q => { localStorage.setItem('cc.spec', JSON.stringify({race: 'human', sex: 'male', classId: 'mage', shell: 0, crest: 0, led: 0, name: 'Plaza QA'})); localStorage.setItem('cc.hintsSeen', '1'); localStorage.setItem('cc.language', 'ko'); localStorage.setItem('cc.quality', q); }, quality);
  await p.goto(base + '/?screen=game'); await p.locator('.launch-notice-start').click();
  await p.waitForFunction(() => window.app?.current?.game?.loaded && !document.querySelector('.loading'), null, {timeout: 180000});
  await p.evaluate(() => { const g = window.app.current.game; g.creatorTravel = true; g.god = true; g.player.nextSwing = Infinity; g.ending.cancel(); g.journey.firstEndingSeen = true; g.world2.go(3); });
  await p.waitForFunction(() => window.app.current.game.world2.chapter === 3 && !document.querySelector('.loading') && window.app.current.game.world2.third.quarter, null, {timeout: 120000});
  await p.waitForTimeout(2500);
  return p;
}
/** Mean colour of a screen rectangle (fractions of the viewport) of the canvas, decoded from a screenshot in the page. */
async function hueAt(p, view, rect) {
  await p.evaluate(([x, z, yaw, pitch, dist]) => {
    const g = window.app.current.game, s = document.getElementById('qa-hide') ?? document.head.appendChild(Object.assign(document.createElement('style'), {id: 'qa-hide'}));
    s.textContent = 'body *{visibility:hidden!important}canvas{visibility:visible!important}';
    for (const e of g.enemies) e.unit.teleport?.(g.world, 200, 200);
    g.player.unit.teleport(g.world, x, z, yaw + Math.PI);
    if (!g.follow.__qa) { g.follow.__qa = g.follow.update; g.follow.update = function () { const c = window.__qaCam; if (!c) return this.__qa.apply(this, arguments); const u = g.player.unit.pos, cp = Math.cos(c.pitch); this.camera.position.set(u.x + Math.sin(c.yaw) * cp * c.dist, u.y + 1.2 + Math.sin(c.pitch) * c.dist, u.z + Math.cos(c.yaw) * cp * c.dist); this.camera.lookAt(u.x, u.y + 1.2, u.z); }; }
    window.__qaCam = {yaw, pitch, dist};
  }, view);
  await p.waitForTimeout(2500);
  const b64 = (await p.screenshot()).toString('base64');
  return p.evaluate(async ([b64, r]) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(Math.round(r[0] * img.width), Math.round(r[1] * img.height), Math.round((r[2] - r[0]) * img.width), Math.round((r[3] - r[1]) * img.height)).data;
    let R = 0, G = 0, B = 0; const n = d.length / 4; for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; }
    R /= n; G /= n; B /= n; const mx = Math.max(R, G, B), mn = Math.min(R, G, B), dd = mx - mn;
    let h = 0; if (dd > 0) h = mx === R ? 60 * (((G - B) / dd) % 6) : mx === G ? 60 * ((B - R) / dd + 2) : 60 * ((R - G) / dd + 4);
    return {rgb: [R, G, B].map(v => Math.round(v)), hue: Math.round((h + 360) % 360)};
  }, [b64, rect]);
}
try {
  const p = await open('high');
  const r = await p.evaluate(() => {
    const g = window.app.current.game, t = g.world2.third, w = g.world, goods = t.root.getObjectByName('goldsand-goods'), out = {};
    out.scenes = goods?.userData.scenes ?? 0; out.pieces = goods?.userData.pieces ?? 0;
    out.parts = ['goldsand-goods-stone', 'goldsand-goods-wood', 'goldsand-goods-cloth', 'goldsand-goods-pottery', 'goldsand-goods-rope'].filter(n => !goods?.getObjectByName(n));
    out.quarter = t.quarter.stats;
    out.dressing = t.root.getObjectByName('dawnharbor-dressing')?.userData.stats ?? null;
    out.citadelBanners = (() => { let n = 0; t.root.traverse(o => { if (o.userData?.citadel?.banners) n = o.userData.citadel.banners; }); return n; })();
    // Solids: a crab dropped on each scene's centre is pushed out.
    const v = g.player.unit.pos.clone(), rr = g.player.unit.radius;
    // A little off each centre (a point dead on a circle's centre has no direction to be pushed in).
    const probe = [[-6.0, 58.3], [-5.35, 60.9], [-7.1, 67.4], [6.2, 79.6], [-24.5, -73.0], [24.3, -87.8]];
    out.notSolid = probe.filter(([x, z]) => { w.resolveCollision(x, z, rr, v); return Math.hypot(v.x - x, v.y - z) < .2; }).map(a => a.join(','));
    return out;
  });
  console.log('SQUARE', JSON.stringify(r));
  assert.ok(r.scenes >= 14, `goods scenes ${r.scenes}`);
  assert.deepEqual(r.parts, [], 'goods meshes present');
  assert.deepEqual(r.notSolid, [], 'the well, trough, rail, cart and ruins are solid');
  assert.ok(r.quarter.parapets >= 20 && r.quarter.frames >= 10, `parapet profiles ${r.quarter.parapets}, door frames ${r.quarter.frames}`);
  assert.ok(r.citadelBanners >= 22, `citadel banners ${r.citadelBanners} (14 before, four on the back wall and four on the colonnades added)`);
  const street = await hueAt(p, [0, 45, .3, .12, 9], [.25, .7, .75, .9]);
  const arena = await hueAt(p, [0, -75, 0, .5, 34], [.19, .72, .81, .98]);
  console.log('WARMTH', JSON.stringify({street, arena}));
  for (const [n, c] of [['street paving', street], ['arena floor', arena]]) assert.ok(c.hue <= 60 && c.rgb[0] > c.rgb[2], `${n} reads warm: ${JSON.stringify(c)}`);
  await p.close();
  const lp = await open('low');
  const lr = await lp.evaluate(() => { const g = window.app.current.game, t = g.world2.third; return {quality: localStorage.getItem('cc.quality'), scenes: t.root.getObjectByName('goldsand-goods')?.userData.scenes ?? 0}; });
  console.log('LOW', JSON.stringify(lr));
  assert.equal(lr.quality, 'low'); assert.ok(lr.scenes >= 14);
  await lp.close();
  assert.deepEqual(errors, [], errors.join('\n'));
  console.log('PASS qa-dawn-plaza');
} finally {
  await browser.close();
}
