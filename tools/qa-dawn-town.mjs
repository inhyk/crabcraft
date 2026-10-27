// World III Dawnharbor town QA: the sandstone paving, road lamps, boulder groups, harbour, market dressing, the desert
// quarter in place of the kit houses and the two sun gates are present; no primitive of the old town is left (dodecahedron rocks, lava
// octahedra, cylinder lamps, flagstone tiles, box-ring portals); villagers' posts, quest points and enemy homes stay
// clear of the new solids and the main ways stay walkable; zero page/GL errors at high and low quality.
//   CC_QA_BASE=http://127.0.0.1:5613 node tools/qa-dawn-town.mjs
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {launchBrowser} from './lib/browser.mjs';

const base = process.env.CC_QA_BASE ?? 'http://127.0.0.1:5205';
await mkdir('tmp/qa', {recursive: true});
const browser = await launchBrowser({headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio']});
const errors = [];
async function open(quality) {
  const p = await browser.newPage({viewport: {width: 1280, height: 800}});
  p.on('pageerror', e => errors.push(`${quality} page: ${e.message}`));
  p.on('console', m => { if (m.type() === 'error' && /shader|program|WebGL|GL_|THREE/i.test(m.text())) errors.push(`${quality} console: ${m.text().slice(0, 300)}`); });
  await p.routeWebSocket('**/multiplayer*', ws => ws.close());
  await p.addInitScript(q => { localStorage.setItem('cc.spec', JSON.stringify({race: 'human', sex: 'male', classId: 'mage', shell: 0, crest: 0, led: 0, name: 'Town QA'})); localStorage.setItem('cc.hintsSeen', '1'); localStorage.setItem('cc.language', 'ko'); localStorage.setItem('cc.quality', q); }, quality);
  await p.goto(base + '/?screen=game'); await p.locator('.launch-notice-start').click();
  await p.waitForFunction(() => window.app?.current?.game?.loaded && !document.querySelector('.loading'), null, {timeout: 180000});
  await p.evaluate(() => { const g = window.app.current.game; g.creatorTravel = true; g.god = true; g.ending.cancel(); g.journey.firstEndingSeen = true; g.world2.go(3); });
  await p.waitForFunction(() => window.app.current.game.world2.chapter === 3 && !document.querySelector('.loading'), null, {timeout: 120000});
  await p.waitForTimeout(2500);
  return p;
}
try {
  const p = await open('high');
  const r = await p.evaluate(() => {
    const g = window.app.current.game, t = g.world2.third, root = t.root, out = {};
    const named = n => root.getObjectByName(n);
    const pav = named('world3-sandstone-paving');
    out.paving = pav?.userData.stats ?? null;
    out.oldFlagstones = !!named('world3-flagstone-paths');
    out.covers = pav ? [[0, 70], [0, 20], [0, 53], [-10, 82], [0, 105], [-20, 116]].map(([x, z]) => pav.userData.covers(x, z)) : [];
    out.lamps = named('dawnharbor-road-lamps')?.userData.lamps ?? 0;
    const b = named('dawnreach-boulders');
    out.boulders = b ? {stones: b.userData.stones, sites: b.userData.sites, vents: b.userData.vents} : null;
    out.boats = named('dawnharbor-harbour')?.userData.boats ?? 0;
    out.harbour = ['dawnharbor-quay-wall', 'dawnharbor-pier', 'dawnharbor-quay-stone', 'dawnharbor-nets', 'dawnharbor-ropes'].filter(n => !named(n));
    out.dressing = named('dawnharbor-dressing')?.userData.stats ?? null;
    // Houses: the desert quarter (dawnHouses.ts, checked in qa-dawn-houses.mjs) replaced the kit houses; no village
    // kit material is left in World III.
    const mats = new Set(); root.traverse(o => { if (o.isMesh) for (const m of [o.material].flat()) mats.add(m.name); });
    out.palette = [...mats].filter(n => /MI_(Plaster|RoundTiles|WoodTrim|UnevenBrick|Brick|RockTrim)/.test(n));
    out.quarter = named('goldsand-quarter')?.userData.stats ?? null;
    out.palms = named('goldsand-date-palms') ? root.userData.palms : 0;
    out.braziers = named('goldsand-braziers')?.userData.braziers ?? 0;
    out.souk = named('goldsand-souk')?.userData ?? null;
    out.gates = [];
    root.traverse(o => { if (o.userData?.dawnGate) out.gates.push([o.name, o.userData.dawnGate, +o.position.x.toFixed(1), +o.position.z.toFixed(1)]); });
    // Old primitives: anything in World III (outside the quest markers, which are their own module) built from
    // dodecahedra or octahedra, cylinder-and-octahedron lamp posts, and StarPortal's torus rings.
    const prim = [];
    root.traverse(o => {
      if (!o.isMesh) return;
      // Quest markers are their own module; the capital's crown portal is shared by every world.
      let p = o; while (p && p !== root) { if (p.name === 'Island village requests' || p.name.startsWith('crown-portal')) return; p = p.parent; }
      const type = o.geometry?.type;
      if (type === 'DodecahedronGeometry' || type === 'OctahedronGeometry') prim.push(`${type}@${o.position.x.toFixed(0)},${o.position.z.toFixed(0)}`);
      if (type === 'TorusGeometry' && o.parent?.name?.includes('→')) prim.push(`portal-torus ${o.parent.name}`);
    });
    out.primitives = prim;
    // Clearance: villagers' posts, quest points (as dawnRequests placed them) and enemy homes must not be pushed by solids.
    const w = g.world, rr = g.player.unit.radius, v = g.player.unit.pos.clone();
    const pushed = (x, z) => { w.resolveCollision(x, z, rr, v); return Math.hypot(v.x - x, v.y - z); };
    out.npc = t.town.map(([x, z]) => +pushed(x, z).toFixed(2));
    out.quests = g.world2.dawnRequests.nodes.map(n => [n.kind, +pushed(n.position.x, n.position.z).toFixed(2)]).filter(([, d]) => d > .05);
    // Enemy homes: some were already pushed by the rock ring and the sea before this town; none may be near a new solid.
    const solids = [...named('dawnharbor-road-lamps').userData.posts, ...out.gates.flatMap(([, , x, z]) => [[x - 3.1, z], [x + 3.1, z]])];
    out.enemies = g.enemies.filter(e => !e.isAdd && !e.isEcho).filter(e => solids.some(([x, z]) => Math.hypot(x - e.home.x, z - e.home.z) < 3)).map(e => [e.kind, e.home.x, e.home.z]);
    out.npcNear = t.town.filter(([x, z]) => solids.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 3));
    out.portals = [[-12, 86.4], [14, 86.4]].map(([x, z]) => +pushed(x, z).toFixed(2));
    return out;
  });
  // Walking routes: nothing solid across the avenue, the cross street, the harbour link, the gates' squares or the
  // promenade, by the world's own raycast (vectors of the page's THREE type).
  const routes = await p.evaluate(() => {
    const g = window.app.current.game, t = g.world2.third, w = g.world, V = g.player.unit.pos.constructor, hits = [];
    const ways = [[[0, 92], [0, -40]], [[-26, 53], [26, 53]], [[0, 93], [0, 117]], [[-12, 86], [-3, 86]], [[14, 86.4], [14, 95]], [[-20, 116], [20, 116]]];
    for (const [a, b] of ways) {
      const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]));
      for (let i = 0; i < n; i++) {
        const p0 = [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n], p1 = [a[0] + (b[0] - a[0]) * (i + 1) / n, a[1] + (b[1] - a[1]) * (i + 1) / n];
        const A = new V(p0[0], t.height(p0[0], p0[1]) + 1, p0[1]), B = new V(p1[0], t.height(p1[0], p1[1]) + 1, p1[1]);
        if (w.raycastSolid(A, B)) hits.push(`${p0.map(v => v.toFixed(1))}`);
      }
    }
    return hits;
  });
  console.log('TOWN', JSON.stringify(r));
  console.log('ROUTE_HITS', JSON.stringify(routes));
  assert.ok(r.paving && r.paving.segments >= 15 && r.paving.pads === 2 && r.paving.kerbed >= 10, JSON.stringify(r.paving));
  assert.equal(r.oldFlagstones, false, 'the shared grid flagstones are gone from World III');
  assert.ok(r.covers.every(Boolean), `covers() on avenue, square, arrival square and harbour: ${r.covers}`);
  assert.ok(r.lamps >= 20, `road and harbour lamps: ${r.lamps}`);
  assert.ok(r.boulders && r.boulders.sites >= 25 && r.boulders.stones >= r.boulders.sites * 3 && r.boulders.vents === 0, JSON.stringify(r.boulders));
  assert.ok(r.boats >= 5, `boats ${r.boats}`);
  assert.deepEqual(r.harbour, [], 'harbour parts present');
  assert.ok(r.dressing && r.dressing.stalls >= 10 && r.dressing.goods >= 60 && r.dressing.benches >= 6 && r.dressing.doorPots >= 4 && r.dressing.lanterns >= 6, JSON.stringify(r.dressing));
  assert.ok(r.quarter && r.quarter.blocks >= 28 && r.quarter.windcatchers === 3 && r.quarter.laundry >= 10, `desert quarter (rooftop laundry): ${JSON.stringify(r.quarter)}`);
  assert.deepEqual(r.palette, [], 'no village kit house materials left');
  // Date palms on every old tree site (32) and the quarter's own (dawnHousePlan.ts quarterPalms, 18).
  assert.equal(r.palms, 32 + 18, 'date palms on the old tree sites and in the quarter');
  assert.ok(r.braziers >= 4, `braziers ${r.braziers}`);
  assert.ok(r.souk && r.souk.stalls >= 8 && r.souk.goods >= 80, JSON.stringify(r.souk));
  assert.deepEqual(r.gates.map(g => g[1]).sort(), ['dawn', 'frost'], JSON.stringify(r.gates));
  assert.deepEqual(r.primitives, [], 'no old primitives left in the town');
  assert.ok(r.npc.every(d => d < .05), `villagers' posts clear: ${r.npc}`);
  assert.deepEqual(r.quests, [], 'quest points clear');
  assert.deepEqual(r.enemies, [], 'enemy homes clear of the new solids');
  assert.deepEqual(r.npcNear, [], "villagers' posts clear of the new solids");
  assert.ok(r.portals.every(d => d < .05), `gate interaction spots clear: ${r.portals}`);
  assert.deepEqual(routes, [], 'main ways walkable');
  // Same-camera stills for the record.
  for (const [name, x, z, yaw, pitch, dist] of [['street', 0, 70, 0, .3, 9], ['square', 4, 50, .6, .6, 14], ['harbour', -8, 122, 0, .3, 34], ['gate', -12, 92, 0, .15, 12], ['rocks', 58, -60, -1.6, .3, 16]]) {
    await p.evaluate(([x, z, yaw, pitch, dist]) => { const g = window.app.current.game; g.player.unit.teleport(g.world, x, z, yaw + Math.PI); g.follow.yaw = yaw; g.follow.pitch = pitch; g.follow.distance = dist; g.follow.cut(); }, [x, z, yaw, pitch, dist]);
    await p.waitForTimeout(900);
    await p.screenshot({path: `tmp/qa/dawn-town-${name}.png`});
  }
  console.log('PASS high quality: paving, lamps, boulders, harbour, dressing, palette, gates; no primitives; posts, quests, enemies and routes clear');
  await p.close();
  const low = await open('low');
  const lr = await low.evaluate(() => { const g = window.app.current.game, root = g.world2.third.root; return {quality: window.app.engine.quality, paving: !!root.getObjectByName('world3-sandstone-paving'), boulders: !!root.getObjectByName('dawnreach-boulder-groups'), calls: window.app.engine.renderer.info.render.calls}; });
  await low.screenshot({path: 'tmp/qa/dawn-town-low.png'});
  console.log('LOW', JSON.stringify(lr));
  assert.equal(lr.quality, 'low'); assert.ok(lr.paving && lr.boulders);
  console.log('PASS low quality renders the town');
  assert.deepEqual(errors, [], errors.join('\n'));
  console.log('PASS zero page and GL errors');
} finally { await browser.close(); }
