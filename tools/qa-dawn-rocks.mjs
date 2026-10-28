// Goldsand Harbor (World III) rocks, the dawn-rocks fix: carved masses bedded in the sand, set back from the dune
// views, and the fallen obelisk drowned a third. Checks:
//  - placement, numbers only: every rock group a dune view (east, west, dunes, dunes2) can see stands 25-60 m from its
//    camera or beyond 60 m (none in the foreground), the east and west views each see one outcrop; every site keeps
//    clear of the paths, the arena, every quest point and the other sites;
//  - sand, numbers only: rockSand() is exactly 0 on every quest point, the avenue and the arena, and every rock with
//    room for it (not on or beside a quest point's, the avenue's or the citadel's kept ground) carries a lee tail: sand
//    at least 0.15 radii deep 2 radii downwind (lee minus windward reported; a neighbour's tail can lie upwind);
//  - in the game: every main stone is buried 20-40 % of its height by the sand round its foot, each hoodoo is one
//    column narrowing downward (its lowest band above the sand under 0.85 of its widest band under the cap) under a cap
//    at most 1.3 times that; every site is registered in the island's collision (and so in the server bake), clear of villagers
//    and enemy homes, and pushes no quest prop off its point;
//  - the obelisk: the sand over its axis a third of the way up its shaft, a drift over its foot;
//  - zero page, shader or GL errors at high and low quality; low quality builds the same rocks.
//   CC_QA_BASE=http://127.0.0.1:5630 node tools/qa-dawn-rocks.mjs
// Writes tmp/qa/dawn-rocks-*.png.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {launchBrowser} from './lib/browser.mjs';
import {DAWN_ARENA_HEIGHT, dawnHeight} from '../src/sim/world/ground.ts';
import {DAWN_ROCKS, DAWN_OBELISK_DRIFT, DAWN_WIND, dawnCoastHeight, rockSand, rockSandRoom} from '../src/sim/world/dawnGround.ts';
import {DAWN_POINTS} from '../src/sim/data/quests.ts';

const base = process.env.CC_QA_BASE ?? 'http://127.0.0.1:5630';
await mkdir('tmp/qa', {recursive: true});

// --- Placement and sand, numbers only -----------------------------------------------------------------------------
const VIEWS = {east: [60, -5, -1.57, .3, 26], west: [-60, -5, 1.57, .3, 26], dunes: [-95, -20, 1.2, .15, 14], dunes2: [-125, 30, -2.2, .22, 30]};
const half = Math.atan(Math.tan(27.5 * Math.PI / 180) * 16 / 9) + .05;
const seen = {};
for (const [name, [x, z, yaw, pitch, dist]] of Object.entries(VIEWS)) {
  const cx = x + Math.sin(yaw) * Math.cos(pitch) * dist, cz = z + Math.cos(yaw) * Math.cos(pitch) * dist, fa = Math.atan2(x - cx, z - cz);
  seen[name] = [];
  for (const k of DAWN_ROCKS) {
    const d = Math.hypot(k.x - cx, k.z - cz), a = Math.atan2(k.x - cx, k.z - cz) - fa;
    // A site's edge (its collider, r + 1) inside the horizontal field of view.
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) - Math.atan((k.r + 1) / d) > half) continue;
    seen[name].push({i: k.i, d: +d.toFixed(1)});
    assert.ok(d >= 25, `${name}: rock ${k.i} ${d.toFixed(1)} m from the camera is in the foreground`);
  }
}
const groups = (list) => { const g = []; for (const s of list) { const k = DAWN_ROCKS.find((r) => r.i === s.i); const near = g.find((o) => o.some((j) => Math.hypot(j.x - k.x, j.z - k.z) < 16)); near ? near.push(k) : g.push([k]); } return g.length; };
assert.ok(groups(seen.east) <= 1 && groups(seen.west) <= 1, `one outcrop each in the east and west views: ${groups(seen.east)}, ${groups(seen.west)}`);
for (const k of DAWN_ROCKS) {
  for (const [id, [x, z]] of Object.entries(DAWN_POINTS)) assert.ok(Math.hypot(k.x - x, k.z - z) - k.r - 1 > 3, `rock ${k.i} clear of ${id}`);
  assert.ok(Math.abs(k.x) - k.r - 1 > 4.2 + 1, `rock ${k.i} clear of the avenue`);
  assert.ok(Math.hypot(k.x, k.z + 72) - k.r - 1 > 31, `rock ${k.i} clear of the arena`);
  for (const o of DAWN_ROCKS) if (o !== k) assert.ok(Math.hypot(k.x - o.x, k.z - o.z) > Math.max(k.r, o.r) + 2, `rock ${k.i} apart from rock ${o.i}`);
}
const keep = [...Object.values(DAWN_POINTS)];
for (let z = 94; z >= -49; z -= 1) for (const x of [-4.2, 0, 4.2]) keep.push([x, z]);
for (let r = 0; r <= 31; r += 3) for (let i = 0; i < 24; i++) keep.push([Math.sin(i / 24 * Math.PI * 2) * r, -72 + Math.cos(i / 24 * Math.PI * 2) * r]);
let off = 0;
for (const [x, z] of keep) off = Math.max(off, Math.abs(rockSand(x, z)), Math.abs(dawnHeight(x, z) - dawnCoastHeight(x, z, DAWN_ARENA_HEIGHT)));
assert.equal(off, 0, 'no rock sand on quest points, the avenue or the arena, and they keep the dawn coast height');
const tails = [], noRoom = [];
for (const k of DAWN_ROCKS) {
  const [wx, wz] = DAWN_WIND, lx = k.x + wx * k.r * 2, lz = k.z + wz * k.r * 2, lee = rockSand(lx, lz), up = rockSand(k.x - wx * k.r * 2, k.z - wz * k.r * 2);
  // Rocks on or beside kept ground (a quest point, the avenue, the citadel) get what room allows; report them.
  if (rockSandRoom(k.x, k.z) < .9 || rockSandRoom(lx, lz) < .9) { noRoom.push(k.i); continue; }
  tails.push(+(lee - up).toFixed(2));
  assert.ok(lee >= .15 * k.r, `rock ${k.i}: a lee tail (sand 2 radii downwind ${lee.toFixed(2)} m, upwind ${up.toFixed(2)} m)`);
}
assert.ok(tails.length >= 16, `most rocks carry a full skirt and tail: ${tails.length} of ${DAWN_ROCKS.length}`);
assert.ok(rockSand(DAWN_OBELISK_DRIFT[0], DAWN_OBELISK_DRIFT[1]) > .7, 'a drift over the obelisk\'s foot');
console.log(`PASS placement: ${DAWN_ROCKS.length} sites; dune views see ${Object.entries(seen).map(([v, l]) => `${v} [${l.map((s) => `${s.i}@${s.d}m`).join(' ')}]`).join(', ')}`);
console.log(`PASS sand: ${keep.length} kept points untouched; lee tails on ${tails.length} rocks (lee minus windward ${Math.min(...tails)}..${Math.max(...tails)} m), kept ground limits rocks ${noRoom.join(', ') || 'none'}`);

// --- In the game --------------------------------------------------------------------------------------------------
const browser = await launchBrowser({headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio']});
const errors = [];
async function open(quality) {
  const p = await browser.newPage({viewport: {width: 1600, height: 900}});
  p.on('pageerror', (e) => errors.push(`${quality} page: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && /shader|program|WebGL|GL_|THREE/i.test(m.text())) errors.push(`${quality} console: ${m.text().slice(0, 300)}`); });
  p.setDefaultTimeout(180000);
  await p.routeWebSocket('**/multiplayer*', (ws) => ws.close());
  await p.addInitScript((q) => { localStorage.setItem('cc.spec', JSON.stringify({race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'Rocks QA'})); localStorage.setItem('cc.hintsSeen', '1'); localStorage.setItem('cc.language', 'ko'); localStorage.setItem('cc.quality', q); }, quality);
  await p.goto(base + '/?screen=game'); await p.locator('.launch-notice-start').click();
  await p.waitForFunction(() => window.app?.current?.game?.loaded && !document.querySelector('.loading'), null, {timeout: 180000});
  await p.evaluate(() => { const g = window.app.current.game; g.god = true; g.player.nextSwing = Infinity; g.creatorTravel = true; g.world2.go(3); });
  await p.waitForFunction(() => window.app.current.game.world2.chapter === 3 && !document.querySelector('.loading') && window.app.current.game.world2.third.contact.baked, null, {timeout: 180000});
  await p.waitForTimeout(2500);
  return p;
}

try {
  const p = await open('high');
  const r = await p.evaluate(async () => {
    const g = window.app.current.game, t = g.world2.third, rocks = t.root.getObjectByName('dawnreach-boulders');
    const w3 = await import('/src/game/world3Colliders.ts'), m = await import('/src/game/dawnDuneClusters.ts');
    const sites = w3.dawnRocks();
    const registered = sites.filter((s) => t.collision.solidAt(s.x, t.height(s.x, s.z) + 1, s.z)).length;
    // No rock pushes a quest prop off its point (dawnRequests.ts resolves each prop, radius 1, against the collision).
    const q = await import('/src/sim/data/quests.ts'), pushed = [];
    for (const [id, [x, z]] of Object.entries(q.DAWN_POINTS)) {
      const out = t.collision.resolve(x, z, 1, {x: 0, y: 0, set(a, b) { this.x = a; this.y = b; return this; }});
      if (Math.hypot(out.x - x, out.y - z) > 1e-6 && sites.some((s) => Math.hypot(s.x - x, s.z - z) < s.r + 3)) pushed.push(id);
    }
    const homes = g.enemies.map((e) => [e.home?.x ?? e.unit.pos.x, e.home?.z ?? e.unit.pos.z]).filter(([x, z]) => Math.hypot(x, z) > .5);
    const folk = g.units.filter((u) => !g.enemies.some((e) => e.unit === u) && u !== g.player.unit).map((u) => [u.pos.x, u.pos.z]);
    let enemy = Infinity, villager = Infinity, worst = '';
    for (const s of sites) {
      for (const [x, z] of homes) { const d = Math.hypot(s.x - x, s.z - z) - s.r - 1; if (d < enemy) { enemy = d; worst = `rock ${s.i} and the enemy home at ${x.toFixed(1)}, ${z.toFixed(1)}`; } }
      for (const [x, z] of folk) villager = Math.min(villager, Math.hypot(s.x - x, s.z - z) - s.r - 1);
    }
    // The obelisk: its shaft piece (rose granite, kind 5) in the clusters; how deep its axis lies at a third of its length.
    const ob = m.DUNE_CLUSTERS.find((c) => c.kind === 'obelisk'), parts = m.duneClusterParts((x, z) => t.height(x, z));
    // The shaft: the granite piece whose stone-local y runs from its foot (0) to the pyramidion's seat (10.5).
    const shaft = parts.pieces.find((pc) => { if (pc.kind !== 5) return false; let a = Infinity, b = -Infinity; for (let v = 1; v < pc.local.length; v += 3) { a = Math.min(a, pc.local[v]); b = Math.max(b, pc.local[v]); } return a > -.01 && a < .01 && b > 10.49; });
    const pp = shaft.g.getAttribute('position'), L = shaft.local;
    // Axis points from the shaft's foot ring centre to its top (stone-local y 0 and 10.5): sample the axis a third up.
    let fx = 0, fy = 0, fz = 0, tx = 0, ty = 0, tz = 0, nf = 0, nt = 0;
    for (let v = 0; v < pp.count; v++) { const y = L[v * 3 + 1]; if (y < .01) { fx += pp.getX(v); fy += pp.getY(v); fz += pp.getZ(v); nf++; } else if (y > 10.49) { tx += pp.getX(v); ty += pp.getY(v); tz += pp.getZ(v); nt++; } }
    fx /= nf; fy /= nf; fz /= nf; tx /= nt; ty /= nt; tz /= nt;
    const axis = (f) => { const x = fx + (tx - fx) * f, y = fy + (ty - fy) * f, z = fz + (tz - fz) * f; return +(t.height(x, z) - y).toFixed(2); };
    for (const pc of parts.pieces) pc.g.dispose();
    return {pushed, worst, mains: rocks.userData.mains, stones: rocks.userData.stones, sites: sites.length, registered, enemy, villager, homes: homes.length, folk: folk.length,
      obelisk: {at: [ob.x, ob.z], third: axis(1 / 3), quarter: axis(.25), half: axis(.5), foot: axis(0)}};
  });
  const bury = r.mains.map((s) => ({i: s.i, tall: s.tall, f: (s.foot - s.base) / (s.top - s.base)}));
  const sandy = bury.filter((b) => !noRoom.includes(b.i));
  for (const b of sandy) assert.ok(b.f >= .2 && b.f <= .4, `rock ${b.i}: buried ${(b.f * 100).toFixed(0)} % of its height (20-40 %)`);
  for (const s of r.mains.filter((m) => m.tall)) {
    // Bands without a ring of vertices in them read 0: the lowest band that has one, the widest band under the cap.
    const w = s.width, low = w.slice(0, 3).find((v) => v > 0), col = Math.max(...w.slice(3, 8)), cap = Math.max(...w.slice(8));
    assert.ok(low < .85 * col && cap <= 1.3 * col, `hoodoo ${s.i}: one column narrowing downward under a cap a little wider: ${w.join(' ')}`);
  }
  assert.deepEqual(r.pushed, [], 'no rock pushes a quest prop off its point');
  assert.equal(r.registered, r.sites, `every rock site registered in the island's collision: ${r.registered}/${r.sites}`);
  assert.ok(r.homes > 10 && r.folk > 5 && r.enemy > 1.5 && r.villager > 4, `rocks clear of enemy homes (${r.enemy.toFixed(1)} m, ${r.worst}) and villagers (${r.villager.toFixed(1)} m)`);
  assert.ok(r.obelisk.third > 0 && r.obelisk.foot > 1, `the obelisk's axis is under the sand a third of the way up: ${JSON.stringify(r.obelisk)}`);
  assert.ok(r.obelisk.half < 0, `the obelisk's upper half stands clear: ${JSON.stringify(r.obelisk)}`);
  console.log(`PASS rocks: ${r.stones} stones on ${r.sites} sites, ${r.registered} registered; buried ${bury.map((b) => `${b.i}:${(b.f * 100).toFixed(0)}%`).join(' ')}; clear of enemy homes by ${r.enemy.toFixed(1)} m, villagers by ${r.villager.toFixed(1)} m`);
  console.log(`PASS hoodoos (mean radius, foot to cap, m): ${r.mains.filter((m) => m.tall).map((s) => `${s.i} [${s.width.filter((v) => v > 0).join(' ')}]`).join('; ')}`);
  console.log(`PASS obelisk: axis depth under the sand foot ${r.obelisk.foot} m, quarter ${r.obelisk.quarter} m, third ${r.obelisk.third} m, half ${r.obelisk.half} m`);
  await p.screenshot({path: 'tmp/qa/dawn-rocks-high.png'});
  await p.close();
  const low = await open('low');
  const lr = await low.evaluate(() => { const t = window.app.current.game.world2.third, b = t.root.getObjectByName('dawnreach-boulders'); return {quality: window.app.engine.quality, stones: b?.userData.stones}; });
  assert.deepEqual(lr, {quality: 'low', stones: r.stones}, 'low quality builds the same rocks');
  await low.screenshot({path: 'tmp/qa/dawn-rocks-low.png'});
  console.log('PASS low quality: same rocks');
  await low.close();
  assert.deepEqual(errors, [], 'no page, shader or GL errors');
  console.log('PASS qa-dawn-rocks');
} finally {
  await browser.close();
}
