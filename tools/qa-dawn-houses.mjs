// World III desert quarter QA (src/game/dawnHouses.ts, dawnHousePlan.ts): the crafted quarter stands in place of the
// kit houses (no village kit piece or material, no primitive geometry in it); its counts (blocks, windows, doors,
// vigas, windcatchers, the shrine's dome, palms, roof life, scenes); the plan keeps clear of trees, lamps, quest
// points, gates and roads; villagers' posts, quest points, POIs, the gates and every door front stay reachable from
// the avenue by a walk over the world's own collision (flood fill), and the side lanes, the cross street and both
// harbour roads (one under the sabat) stay open; zero page/GL errors at high and low quality.
//   CC_QA_BASE=http://127.0.0.1:5617 node tools/qa-dawn-houses.mjs
import assert from 'node:assert/strict';
import {mkdir, rm} from 'node:fs/promises';
import {build} from 'esbuild';
import {launchBrowser} from './lib/browser.mjs';

const base = process.env.CC_QA_BASE ?? 'http://127.0.0.1:5205';
await mkdir('tmp/qa', {recursive: true});

// Plan checks in node: footprints against trees, lamps, quest points, gates, roads and each other.
const out = 'tmp/qa/dawn-house-plan.mjs';
await build({stdin: {contents: `export * from './src/game/dawnHousePlan.ts'; export {dawnForest, dawnGrove, dawnLampPosts, DAWN_GATES, DAWN_PATHS, roadClearance} from './src/game/world3Colliders.ts'; export {DAWN_POINTS} from './src/game/dawnQuests.ts';`, resolveDir: process.cwd(), loader: 'ts'}, bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error'});
const plan = await import(new URL('../' + out, import.meta.url).href);
await rm(out);
const blocks = plan.dawnBlocks(), solid = blocks.filter(b => b.role !== 'bridge');
// Footprint tests in each block's own (turned) frame.
const local = (b, x, z) => { const c = Math.cos(b.yaw), s = Math.sin(b.yaw), dx = x - b.x, dz = z - b.z; return [dx * c - dz * s, dx * s + dz * c]; };
const inBox = (b, x, z, m) => { const [lx, lz] = local(b, x, z); return Math.abs(lx) < b.w / 2 + m && Math.abs(lz) < b.d / 2 + m; };
const issues = [];
for (const b of solid) {
  for (const t of [...plan.dawnForest(), ...plan.dawnGrove()]) if (inBox(b, t.x, t.z, 1)) issues.push(`tree in ${b.id}`);
  for (const l of plan.dawnLampPosts()) if (inBox(b, l.x, l.z, 1)) issues.push(`lamp in ${b.id}`);
  for (const [k, [x, z]] of Object.entries(plan.DAWN_POINTS)) if (inBox(b, x, z, 2)) issues.push(`${k} by ${b.id}`);
  for (const g of plan.DAWN_GATES) if (inBox(b, g.x, g.z, 5)) issues.push(`gate by ${b.id}`);
  // Roads: no footprint corner or edge midpoint on a road.
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 1], [0, -1], [1, 0], [-1, 0], [0, 0]]) {
    const [x, z] = plan.turnAbout(b, b.x + sx * b.w / 2, b.z + sz * b.d / 2);
    if (plan.roadClearance(x, z) < .3) issues.push(`${b.id} on a road at ${x.toFixed(1)},${z.toFixed(1)}`);
  }
}
for (const [x, z] of plan.quarterPalms()) if (plan.roadClearance(x, z) < .8) issues.push(`palm on a road ${x},${z}`);
for (const [x, z] of plan.quarterPalms()) for (const b of solid) if (inBox(b, x, z, .45)) issues.push(`palm ${x},${z} in ${b.id}`);
console.log('PLAN', JSON.stringify({blocks: blocks.length, turned: blocks.filter(b => b.yaw).length, windcatchers: blocks.filter(b => b.wind).length, stairs: blocks.filter(b => b.stair).length, palms: plan.quarterPalms().length, issues}));
assert.deepEqual(issues, [], 'the quarter keeps clear of trees, lamps, quest points, gates and roads');
assert.equal(blocks.filter(b => b.wind).length, 3, 'three windcatchers');
for (const role of ['shrine', 'forge', 'tavern', 'healer', 'shop', 'bridge']) assert.ok(blocks.some(b => b.role === role), role);
assert.equal(blocks.filter(b => b.lot).length, 8, 'every old lot keeps a block');

const browser = await launchBrowser({headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio']});
const errors = [];
async function open(quality) {
  const p = await browser.newPage({viewport: {width: 1280, height: 800}});
  p.on('pageerror', e => errors.push(`${quality} page: ${e.message}`));
  p.on('console', m => { if (m.type() === 'error' && /shader|program|WebGL|GL_|THREE/i.test(m.text())) errors.push(`${quality} console: ${m.text().slice(0, 300)}`); });
  await p.routeWebSocket('**/multiplayer*', ws => ws.close());
  await p.addInitScript(q => { localStorage.setItem('cc.spec', JSON.stringify({race: 'human', sex: 'male', classId: 'mage', shell: 0, crest: 0, led: 0, name: 'Houses QA'})); localStorage.setItem('cc.hintsSeen', '1'); localStorage.setItem('cc.language', 'ko'); localStorage.setItem('cc.quality', q); }, quality);
  await p.goto(base + '/?screen=game'); await p.locator('.launch-notice-start').click();
  await p.waitForFunction(() => window.app?.current?.game?.loaded && !document.querySelector('.loading'), null, {timeout: 180000});
  await p.evaluate(() => { const g = window.app.current.game; g.creatorTravel = true; g.god = true; g.ending.cancel(); g.journey.firstEndingSeen = true; g.world2.go(3); });
  await p.waitForFunction(() => window.app.current.game.world2.chapter === 3 && !document.querySelector('.loading') && window.app.current.game.world2.third.quarter, null, {timeout: 120000});
  await p.waitForTimeout(2500);
  return p;
}
try {
  const p = await open('high');
  const r = await p.evaluate(() => {
    const g = window.app.current.game, t = g.world2.third, root = t.root, q = root.getObjectByName('goldsand-quarter'), out = {};
    out.stats = q?.userData.stats ?? null;
    out.parts = ['goldsand-walls', 'goldsand-craft', 'goldsand-cloth', 'goldsand-wood'].filter(n => !q?.getObjectByName(n));
    // No village kit in World III; no primitive geometry inside the quarter.
    const mats = new Set(), prim = [];
    root.traverse(o => { if (o.isMesh) for (const m of [o.material].flat()) mats.add(m.name); });
    out.kitMaterials = [...mats].filter(n => /MI_(Plaster|RoundTiles|WoodTrim|UnevenBrick|Brick|RockTrim)/.test(n));
    out.kitHomes = !!root.getObjectByName('dawnharbor-homes');
    q?.traverse(o => { if (o.isMesh && o.geometry.type !== 'BufferGeometry' && !o.isBatchedMesh && !o.isInstancedMesh) prim.push(`${o.name}:${o.geometry.type}`); });
    out.primitives = prim;
    out.draws = 0; q?.traverse(o => { if (o.isMesh) out.draws++; });
    out.tris = 0; q?.traverse(o => { if (o.isMesh && o.geometry) { const n = o.geometry.index ? o.geometry.index.count : o.geometry.getAttribute('position').count; out.tris += o.isInstancedMesh ? n / 3 * o.count : n / 3; } });
    out.tris = Math.round(out.tris);
    // Reachability: flood fill a 0.5 m grid over the town from the square, a cell open when the world's collision
    // leaves a crab there unmoved; then every target must be reached (or have an open cell within 0.75 m).
    const w = g.world, rr = g.player.unit.radius, v = g.player.unit.pos.clone();
    const X0 = -75, Z0 = 8, S = .5, NX = 300, NZ = 220, open = new Uint8Array(NX * NZ), seen = new Uint8Array(NX * NZ);
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { const x = X0 + i * S, z = Z0 + j * S; w.resolveCollision(x, z, rr, v); open[j * NX + i] = Math.hypot(v.x - x, v.y - z) < .02 && t.height(x, z) > .5 ? 1 : 0; }
    const cell = (x, z) => [Math.round((x - X0) / S), Math.round((z - Z0) / S)];
    const [si, sj] = cell(0, 53), stack = [sj * NX + si]; seen[stack[0]] = 1;
    while (stack.length) { const k = stack.pop(), i = k % NX, j = (k - i) / NX; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= NX || b >= NZ) continue; const n = b * NX + a; if (!seen[n] && open[n]) { seen[n] = 1; stack.push(n); } } }
    const reach = (x, z) => { const [i, j] = cell(x, z); for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < NX && b < NZ && seen[b * NX + a]) return true; } return false; };
    const targets = [
      ...t.town.map(([x, z], k) => [`npc${k}`, x, z]),
      ...g.world2.dawnRequests.nodes.filter(n => n.position.z > 8 && Math.abs(n.position.x) < 74).map(n => [n.kind, n.position.x, n.position.z]),
      ...['forge', 'chapel', 'tavern'].map(id => [id, g.world.pois[id].position.x, g.world.pois[id].position.z]),
      ['gate-dawn', -12, 86.4], ['gate-frost', 14, 86.4],
      ...[26, 45, 64, 83].flatMap(z => [[`lane${z}e`, 28.4, z], [`lane${z}w`, -28.4, z]]),
      ...t.quarter.doors.map((d, k) => [`door${k}`, d.pos.x + Math.sin(d.yaw) * 1.1 - Math.cos(d.yaw) * 1.0, d.pos.z + Math.cos(d.yaw) * 1.1 + Math.sin(d.yaw) * 1.0]),
    ];
    out.unreached = targets.filter(([, x, z]) => !reach(x, z)).map(([n, x, z]) => `${n}@${(+x).toFixed(1)},${(+z).toFixed(1)}`);
    out.targets = targets.length;
    out.npcPushed = t.town.map(([x, z]) => { w.resolveCollision(x, z, rr, v); return +Math.hypot(v.x - x, v.y - z).toFixed(2); }).filter(d => d > .02);
    out.doors = t.quarter.doors.length;
    return out;
  });
  const routes = await p.evaluate(() => {
    const g = window.app.current.game, t = g.world2.third, w = g.world, V = g.player.unit.pos.constructor, hits = [];
    const ways = [[[0, 92], [0, 20]], [[-26, 53], [26, 53]], ...[26, 45, 64, 83].flatMap(z => [[[4.5, z], [28.5, z]], [[-4.5, z], [-28.5, z]]]), [[28, 84], [48, 84], [61, 76]], [[-5, 74], [-28, 75], [-50, 64], [-62, 48]]];
    for (const way of ways) for (let s = 1; s < way.length; s++) {
      const a = way[s - 1], b = way[s], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]));
      for (let i = 0; i < n; i++) {
        const p0 = [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n], p1 = [a[0] + (b[0] - a[0]) * (i + 1) / n, a[1] + (b[1] - a[1]) * (i + 1) / n];
        if (w.raycastSolid(new V(p0[0], t.height(p0[0], p0[1]) + 1, p0[1]), new V(p1[0], t.height(p1[0], p1[1]) + 1, p1[1]))) hits.push(p0.map(v => v.toFixed(1)).join(','));
      }
    }
    return hits;
  });
  console.log('QUARTER', JSON.stringify(r));
  console.log('ROUTE_HITS', JSON.stringify(routes));
  const s = r.stats;
  assert.ok(s, 'goldsand-quarter present');
  assert.deepEqual(r.parts, [], 'quarter meshes present');
  assert.ok(s.blocks >= 28 && s.windows >= 60 && s.doors >= 14 && s.vigas >= 200 && s.bays >= 3, JSON.stringify(s));
  assert.ok(s.windcatchers === 3 && s.domes === 1 && s.stairs >= 4, JSON.stringify(s));
  assert.ok(s.jars >= 20 && s.rugs >= 6 && s.laundry >= 10 && s.ladders >= 2 && s.sails >= 3 && s.carpets >= 6 && s.baskets >= 8 && s.awnings >= 5, JSON.stringify(s));
  assert.equal(r.kitHomes, false, 'kit houses gone');
  assert.deepEqual(r.kitMaterials, [], 'no village kit materials in World III');
  assert.deepEqual(r.primitives, [], 'quarter meshes are merged geometry');
  assert.ok(r.draws <= 16, `quarter draw objects ${r.draws}`);
  assert.deepEqual(r.npcPushed, [], "villagers' posts clear");
  assert.deepEqual(r.unreached, [], 'every target reachable from the square');
  assert.deepEqual(routes, [], 'lanes, cross street and both harbour roads open');
  for (const [name, x, z, yaw, pitch, dist] of [['street', 27, 64, -1.4, .14, 9], ['square', 4, 50, -1.0, .35, 22], ['shrine', 24, 53.4, -1.57, .18, 10], ['tavern', -26, 64, 1.57, .16, 9], ['roofs', 36, 62, -.6, .62, 16], ['sabat', 29, 84, -1.57, .12, 8]]) {
    await p.evaluate(([x, z, yaw, pitch, dist]) => { const g = window.app.current.game; g.player.unit.teleport(g.world, x, z, yaw + Math.PI); g.follow.yaw = yaw; g.follow.pitch = pitch; g.follow.distance = dist; g.follow.cut(); }, [x, z, yaw, pitch, dist]);
    await p.waitForTimeout(900);
    await p.screenshot({path: `tmp/qa/dawn-houses-${name}.png`});
  }
  console.log('PASS high quality: quarter counts, no kit houses or primitives, targets reachable, routes open');
  await p.close();
  const low = await open('low');
  const lr = await low.evaluate(() => { const g = window.app.current.game, q = g.world2.third.root.getObjectByName('goldsand-quarter'); return {quality: window.app.engine.quality, quarter: !!q, blocks: q?.userData.stats.blocks, calls: window.app.engine.renderer.info.render.calls}; });
  await low.screenshot({path: 'tmp/qa/dawn-houses-low.png'});
  console.log('LOW', JSON.stringify(lr));
  assert.equal(lr.quality, 'low'); assert.ok(lr.quarter && lr.blocks >= 28);
  console.log('PASS low quality renders the quarter');
  assert.deepEqual(errors, [], errors.join('\n'));
  console.log('PASS zero page and GL errors');
} finally { await browser.close(); }
