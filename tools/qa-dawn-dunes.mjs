// Goldsand Harbor (World III) open desert, round 5 (dawn-dunes): the dunes tell stories, the rocks are carved
// sandstone, the dune sea has no seams. Checks:
//  - ground, numbers only: every piece of gameplay ground keeps the dawn coast's height (dawnCoastHeight) and lies
//    where this round's coast change cannot reach it (inside the shore's start, or off the mainland's bearing); the
//    mainland's coast no longer breaks into a sea bluff inside the dune sea (max slope in that band under 0.95,
//    the slip faces' 0.66 plus margin);
//  - the clusters (dawnDuneClusters.ts): every kind built, one draw for their pieces, tracks and scrub present; every
//    solid is registered in the collision the server bakes, stays off the paths, out of the arena, clear of every
//    quest point, villager and enemy home, and of the palms and rock groups;
//  - the rocks (dawnBoulders.ts strataGeometry): built bed by bed with flat caps and ledges (over 5 % of vertex normals
//    level; the noise-carved boulders of c82accf had 1.4 %);
//  - the dune views (east, west, dunes, dunes2): at least 60 % of the frame is open sand (a mask render: everything
//    but the sand in one flat colour, sky black), and the greyscale p10-p99 spread stays at least 115 (dunes2, not a
//    standard view, at least its c82accf 103);
//  - zero page, shader or GL errors at high and low quality; low quality builds the same clusters.
//   CC_QA_BASE=http://127.0.0.1:5626 node tools/qa-dawn-dunes.mjs [--measure-only]
// --measure-only prints the open-sand shares and spreads without asserting this round's work (to measure a base).
// Writes tmp/qa/dawn-dunes-*.png.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {launchBrowser} from './lib/browser.mjs';
import {dawnHeight, DAWN_ARENA_HEIGHT} from '../src/sim/world/ground.ts';
import {dawnCoastHeight, dawnShoreStart, sandMainland, RX, RZ, CZ} from '../src/sim/world/dawnGround.ts';
import {DAWN_POINTS} from '../src/sim/data/quests.ts';

const base = process.env.CC_QA_BASE ?? 'http://127.0.0.1:5626';
const measureOnly = process.argv.includes('--measure-only');
await mkdir('tmp/qa', {recursive: true});

// --- Ground, numbers only -----------------------------------------------------------------------------------------
if (!measureOnly) {
  const keep = [[-12, 84], [0, 82], [14, 84], [-16, 48], [16, 48], [-26, 38], [26, 38], [-20, 64], [20, 80], [20, 64], [-55, 36], [55, 36], [55, -25], [0, -40], [0, -44], [67, 72], ...Object.values(DAWN_POINTS)];
  for (let x = -40; x <= 20; x += 1) for (let z = 90; z <= 160; z += 2) keep.push([x, z]);
  for (let x = -60; x <= 60; x += 2) for (let z = -110; z <= -30; z += 2) if (Math.hypot(x / RX, (z - CZ) / RZ) < .84) keep.push([x, z]);
  for (let z = 94; z >= -49; z -= 1) for (const x of [-4.2, 0, 4.2]) keep.push([x, z]);
  for (let r = 0; r <= 21; r += 3) for (let i = 0; i < 24; i++) keep.push([Math.sin(i / 24 * Math.PI * 2) * r, -72 + Math.cos(i / 24 * Math.PI * 2) * r]);
  let off = 0, reach = 0;
  for (const [x, z] of keep) {
    off = Math.max(off, Math.abs(dawnHeight(x, z) - dawnCoastHeight(x, z, DAWN_ARENA_HEIGHT)));
    // The coast change acts only past the shore's start on a bearing the mainland claims.
    if (Math.hypot(x / RX, (z - CZ) / RZ) >= dawnShoreStart(x, z) && sandMainland(x, z) > 0) reach++;
  }
  assert.equal(off, 0, 'gameplay ground keeps the dawn coast height');
  assert.equal(reach, 0, 'no gameplay point lies where the coast change acts');
  let bluff = 0, n = 0;
  for (let x = -260; x <= 120; x += 1) for (let z = -260; z <= 200; z += 1) {
    const r = Math.hypot(x / RX, (z - CZ) / RZ);
    if (r < .83 || r > 1 || sandMainland(x, z) < .5) continue;
    const g = Math.hypot(dawnHeight(x + .25, z) - dawnHeight(x - .25, z), dawnHeight(x, z + .25) - dawnHeight(x, z - .25)) / .5;
    bluff = Math.max(bluff, g); n++;
  }
  assert.ok(n > 1000 && bluff < .95, `no sea bluff inside the dune sea: max slope ${bluff.toFixed(2)} over ${n} samples`);
  console.log(`PASS ground: ${keep.length} gameplay points keep their height and lie outside the coast change; mainland coast band max slope ${bluff.toFixed(2)} (${n} samples)`);
}

// --- In the game --------------------------------------------------------------------------------------------------
const browser = await launchBrowser({headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio']});
const errors = [];
const VIEWS = {east: [60, -5, -1.57, .3, 26], west: [-60, -5, 1.57, .3, 26], dunes: [-95, -20, 1.2, .15, 14], dunes2: [-125, 30, -2.2, .22, 30]};
async function open(quality) {
  const p = await browser.newPage({viewport: {width: 1600, height: 900}});
  p.on('pageerror', (e) => errors.push(`${quality} page: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && /shader|program|WebGL|GL_|THREE/i.test(m.text())) errors.push(`${quality} console: ${m.text().slice(0, 300)}`); });
  p.setDefaultTimeout(180000);
  await p.routeWebSocket('**/multiplayer*', (ws) => ws.close());
  await p.addInitScript((q) => { localStorage.setItem('cc.spec', JSON.stringify({race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'Dunes QA'})); localStorage.setItem('cc.hintsSeen', '1'); localStorage.setItem('cc.language', 'ko'); localStorage.setItem('cc.quality', q); }, quality);
  await p.goto(base + '/?screen=game'); await p.locator('.launch-notice-start').click();
  await p.waitForFunction(() => window.app?.current?.game?.loaded && !document.querySelector('.loading'), null, {timeout: 180000});
  await p.evaluate(() => { const g = window.app.current.game; g.god = true; g.player.nextSwing = Infinity; g.creatorTravel = true; g.world2.go(3); });
  await p.waitForFunction(() => window.app.current.game.world2.chapter === 3 && !document.querySelector('.loading') && window.app.current.game.world2.third.contact.baked, null, {timeout: 180000});
  await p.waitForTimeout(2500);
  return p;
}

/** Greyscale p10 and p99 of a PNG, decoded in a blank page. */
let decoder;
async function spread(buf) {
  decoder ??= await browser.newPage();
  return decoder.evaluate(async (b64) => {
    const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob()), c = new OffscreenCanvas(img.width, img.height), g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data, hist = new Float64Array(256);
    for (let i = 0; i < d.length; i += 4) hist[Math.min(255, Math.round(.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]))]++;
    const n = img.width * img.height, pct = (k) => { let a = 0; for (let v = 0; v < 256; v++) { a += hist[v]; if (a >= n * k) return v; } return 255; };
    return {p1: pct(.01), p10: pct(.1), p99: pct(.99)};
  }, buf.toString('base64'));
}

/** Frame each dune view as the review cameras do; screenshot, then a mask render: sand as drawn, everything else magenta, sky black. */
async function measure(p, tag) {
  await p.evaluate(() => {
    const c = window.app.engine.renderer.domElement; c.id = 'qa-main';
    const s = document.createElement('style'); s.textContent = 'body *{visibility:hidden!important}#qa-main{visibility:visible!important}'; document.head.appendChild(s);
    const g = window.app.current.game; g.follow.__orig = g.follow.update;
    g.follow.update = function () { const s = window.__cam; if (!s) return this.__orig.apply(this, arguments); const cp = Math.cos(s.pitch); this.camera.position.set(s.tx + Math.sin(s.yaw) * cp * s.dist, s.ty + Math.sin(s.pitch) * s.dist, s.tz + Math.cos(s.yaw) * cp * s.dist); this.camera.lookAt(s.tx, s.ty, s.tz); };
    const away = () => { let i = 0; for (const e of g.enemies) e.unit.teleport?.(g.world, 200, 200); for (const u of g.units) if (u !== g.player.unit) { i++; if (Math.hypot(u.pos.x - 210, u.pos.z - 200 - i * 3) > 1) u.teleport?.(g.world, 210, 200 + i * 3, 0); } requestAnimationFrame(away); }; away();
  });
  const out = {};
  for (const [name, v] of Object.entries(VIEWS)) {
    await p.evaluate(([x, z, yaw, pitch, dist]) => { const g = window.app.current.game; g.player.unit.teleport(g.world, x, z, yaw + Math.PI); const u = g.player.unit.pos; window.__cam = {tx: u.x, ty: u.y + 1.2, tz: u.z, yaw, pitch, dist}; }, v);
    await p.waitForTimeout(2600);
    const buf = await p.screenshot(); await p.screenshot({path: `tmp/qa/dawn-dunes-${tag}-${name}.png`});
    const s = await spread(buf);
    const share = await p.evaluate(() => {
      const g = window.app.current.game, t = g.world2.third, r = window.app.engine.renderer, scene = t.root.parent, cam = g.follow.camera;
      // The scene graph, swapped: sand keeps its material, the sky goes, everything else one flat magenta.
      // The app's own three.js classes, taken from objects it built (a second three instance would not render).
      let Basic = null; scene.traverse((o) => { if (!Basic && o.isMesh && o.material?.isMeshBasicMaterial) Basic = o.material.constructor; });
      const Target = t.terrain.near.constructor, Color = t.sky.sunColor.constructor;
      const flat = new Basic({color: 0xff00ff}); flat.toneMapped = false; flat.fog = false; flat.color.setRGB(1, 0, 1);
      const swaps = [], hides = [];
      scene.traverse((o) => {
        if (o === t.terrain.mesh) return;
        if (o === t.sky.mesh || o.isPoints || o.isSprite || o.isLine || o === t.drift.mesh || o === t.spray?.mesh) { if (o.visible) { hides.push(o); o.visible = false; } return; }
        if (o.isMesh) { swaps.push([o, o.material]); o.material = flat; }
      });
      const bg = scene.background; scene.background = null;
      const w = 400, h = 225, target = new Target(w, h);
      const prev = r.getRenderTarget(), clear = r.getClearColor(new Color()), alpha = r.getClearAlpha(), aspect = cam.aspect;
      r.setRenderTarget(target); r.setClearColor(0x000000, 1); r.clear(); r.render(scene, cam);
      const px = new Uint8Array(w * h * 4); r.readRenderTargetPixels(target, 0, 0, w, h, px);
      r.setRenderTarget(prev); r.setClearColor(clear, alpha); target.dispose(); flat.dispose(); cam.aspect = aspect;
      for (const [o, m] of swaps) o.material = m; for (const o of hides) o.visible = true; scene.background = bg;
      let sand = 0, obj = 0, sky = 0;
      for (let i = 0; i < px.length; i += 4) { const R = px[i], G = px[i + 1], B = px[i + 2]; if (R > 200 && G < 60 && B > 200) obj++; else if (R < 6 && G < 6 && B < 6) sky++; else sand++; }
      const n = w * h; return {sand: sand / n, obj: obj / n, sky: sky / n};
    });
    out[name] = {...s, spread: s.p99 - s.p10, ...share};
  }
  console.log(`view      open sand  objects  sky    p1  p10  p99  spread  (${tag})`);
  for (const [name, o] of Object.entries(out)) console.log(`${name.padEnd(9)} ${(o.sand * 100).toFixed(1).padStart(8)} % ${(o.obj * 100).toFixed(1).padStart(6)} % ${(o.sky * 100).toFixed(1).padStart(5)} % ${String(o.p1).padStart(4)} ${String(o.p10).padStart(4)} ${String(o.p99).padStart(4)} ${String(o.spread).padStart(6)}`);
  return out;
}

try {
  const p = await open('high');
  if (!measureOnly) {
    const r = await p.evaluate(async () => {
      const g = window.app.current.game, t = g.world2.third, root = t.root, named = (n) => root.getObjectByName(n);
      const clusters = named('goldsand-dune-clusters'), pieces = named('goldsand-dune-cluster-pieces');
      const m = await import('/src/game/dawnDuneClusters.ts'), w3 = await import('/src/game/world3Colliders.ts'), q = await import('/src/sim/data/quests.ts'), plan = await import('/src/game/dawnHousePlan.ts');
      const parts = m.duneClusterParts((x, z) => t.height(x, z)); for (const pc of parts.pieces) pc.g.dispose();
      // Is each solid in the collision the island (and the server bake) uses? Its centre, a little over the ground.
      const registered = parts.solids.filter((s) => t.collision.solidAt(s.x, t.height(s.x, s.z) + Math.min(.4, s.h * .5), s.z)).length;
      const homes = g.enemies.map((e) => [e.home?.x ?? e.unit.pos.x, e.home?.z ?? e.unit.pos.z]).filter(([x, z]) => Math.hypot(x, z) > .5);
      const folk = g.units.filter((u) => !g.enemies.some((e) => e.unit === u) && u !== g.player.unit).map((u) => [u.pos.x, u.pos.z]);
      const quests = Object.values(q.DAWN_POINTS);
      const trees = [...w3.dawnForest().map(({x, z, scale}) => [x, z, .5 * scale]), ...w3.dawnGrove().map(({x, z}) => [x, z, .4]), ...w3.dawnRocks().map(({x, z, r}) => [x, z, r + 1]), ...plan.quarterPalms().map(([x, z]) => [x, z, .4])];
      let worst = {path: Infinity, arena: Infinity, quest: Infinity, folk: Infinity, enemy: Infinity, tree: Infinity};
      for (const s of parts.solids) {
        worst.path = Math.min(worst.path, w3.roadClearance(s.x, s.z) - s.r);
        worst.arena = Math.min(worst.arena, Math.hypot(s.x, s.z + 72) - s.r);
        for (const [x, z] of quests) worst.quest = Math.min(worst.quest, Math.hypot(s.x - x, s.z - z) - s.r);
        for (const [x, z] of folk) worst.folk = Math.min(worst.folk, Math.hypot(s.x - x, s.z - z) - s.r);
        for (const [x, z] of homes) worst.enemy = Math.min(worst.enemy, Math.hypot(s.x - x, s.z - z) - s.r);
        for (const [x, z, r] of trees) worst.tree = Math.min(worst.tree, Math.hypot(s.x - x, s.z - z) - s.r - r);
      }
      const kinds = [...new Set(m.DUNE_CLUSTERS.map((c) => c.kind))];
      // The rocks: share of level faces (caps and ledges) in the merged strata.
      const rock = named('dawnreach-boulder-groups'), nrm = rock.geometry.getAttribute('normal'); let level = 0; for (let i = 0; i < nrm.count; i++) if (nrm.getY(i) > .98) level++;
      return {group: !!clusters, draws: clusters ? clusters.children.filter((o) => o.isMesh && o.name === 'goldsand-dune-cluster-pieces').length : 0, ud: clusters?.userData, verts: pieces?.geometry.getAttribute('position').count ?? 0,
        tracks: !!named('goldsand-caravan-tracks'), scrub: named('goldsand-dune-scrub')?.children.length ?? 0, kinds, solids: parts.solids.length, registered, worst, homes: homes.length, folk: folk.length,
        level: level / nrm.count, stones: named('dawnreach-boulders').userData.stones, sites: named('dawnreach-boulders').userData.sites};
    });
    assert.ok(r.group && r.draws === 1 && r.tracks && r.scrub > 0, `clusters built, one draw for their pieces, tracks and scrub: ${JSON.stringify({group: r.group, draws: r.draws, tracks: r.tracks, scrub: r.scrub})}`);
    assert.deepEqual([...r.kinds].sort(), ['amphorae', 'bones', 'fence', 'obelisk', 'ruin'], 'every story kind is in the desert');
    assert.ok(r.ud.clusters >= 5 && r.ud.clusters <= 8 && r.ud.pieces > 150 && r.ud.tree, `a handful of clusters, not a scatter: ${JSON.stringify(r.ud)}`);
    assert.ok(r.solids >= 20 && r.registered === r.solids, `every solid is registered in the island's collision: ${r.registered}/${r.solids}`);
    assert.ok(r.worst.path > 1 && r.worst.arena > 8 && r.worst.quest > 5 && r.worst.folk > 5 && r.worst.enemy > 3 && r.worst.tree > 0, `solids stay clear: ${JSON.stringify(Object.fromEntries(Object.entries(r.worst).map(([k, v]) => [k, +v.toFixed(2)])))}`);
    assert.ok(r.homes > 10 && r.folk > 5, `the clearance saw the enemy homes and villagers: ${r.homes} homes, ${r.folk} villagers`);
    assert.ok(r.level > .05 && r.stones >= r.sites * 3, `rocks are bedded sandstone with level caps and ledges: ${(r.level * 100).toFixed(1)} % level normals, ${r.stones} stones on ${r.sites} sites`);
    console.log(`PASS clusters: ${r.ud.clusters} clusters (${r.kinds.join(', ')}), ${r.ud.pieces} pieces in one draw (${r.verts} vertices), ${r.ud.tracks} tracks, ${r.ud.scrub} scrub plants; ${r.registered}/${r.solids} solids registered; clearance ${JSON.stringify(Object.fromEntries(Object.entries(r.worst).map(([k, v]) => [k, +v.toFixed(1)])))}`);
    console.log(`PASS rocks: ${r.stones} stones on ${r.sites} sites, ${(r.level * 100).toFixed(1)} % level normals (caps and ledges)`);
  }
  const views = await measure(p, measureOnly ? 'measure' : 'high');
  if (!measureOnly) {
    for (const [name, o] of Object.entries(views)) {
      assert.ok(o.sand >= .6, `${name}: at least 60 % of the frame is open sand: ${(o.sand * 100).toFixed(1)} %`);
      // dunes2 is not a standard view and sat at 103 on c82accf: it must not lose spread; the others hold 115.
      const min = name === 'dunes2' ? 103 : 115;
      assert.ok(o.spread >= min, `${name}: p10-p99 spread >= ${min}: ${o.spread}`);
    }
    console.log('PASS dune views: open sand >= 60 % of every frame, spread >= 115 (dunes2 >= its base 103)');
  }
  await p.close();
  if (!measureOnly) {
    const low = await open('low');
    const lr = await low.evaluate(() => { const t = window.app.current.game.world2.third; return {quality: window.app.engine.quality, clusters: !!t.root.getObjectByName('goldsand-dune-cluster-pieces'), tracks: !!t.root.getObjectByName('goldsand-caravan-tracks')}; });
    assert.deepEqual(lr, {quality: 'low', clusters: true, tracks: true}, 'low quality builds the clusters and tracks');
    await low.screenshot({path: 'tmp/qa/dawn-dunes-low.png'});
    console.log('PASS low quality: clusters and tracks built');
    await low.close();
  }
  assert.deepEqual(errors, [], 'no page, shader or GL errors');
  console.log(measureOnly ? 'measured' : 'PASS qa-dawn-dunes');
} finally {
  await browser.close();
}
