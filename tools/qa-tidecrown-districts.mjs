// Tidecrown districts (stage 2): enters the capital by creator travel and checks the city the districts add. The first
// entry is timed (the houses' far builds show at once; their near detail follows in the background, then is forced
// and timed); every district's main street is walked (none blocked, gently graded, canal bridges included) and so are
// the Grand Canal's quays and the harbour's quay and long pier; no house overlaps another house, a landmark, a street,
// the King's Way or a canal, and no landmark overlaps a street or a canal; nothing floats (houses' plinths, landmarks,
// terrace walls, stairs, lamps and banner poles reach the ground under them); every camera (the six stage 1 views and
// the district views) stays within the budget of 700 draw calls and 5.5M triangles, shadow pass included; zero page
// or shader errors. Writes the district shots (1600x900) to CC_QA_SHOTS.
// Usage: CC_QA_BASE=http://127.0.0.1:5253 node tools/qa-tidecrown-districts.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.CC_QA_BASE ?? 'http://127.0.0.1:5241';
const out = process.env.CC_QA_SHOTS ?? 'tmp/qa/tidecrown-districts';
const BUDGET = { calls: 700, triangles: 5.5e6 };
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
  await p.waitForTimeout(2000);

  // First entry, then the near detail: a few seconds in the background, the rest forced so the views see it all.
  const entry = await p.evaluate(async () => {
    const g = window.app.current.game, t0 = performance.now();
    g.creatorTravel = true;
    const ok = await g.world2.enterTidecrown();
    return { ok, ms: Math.round(performance.now() - t0), steps: g.world2.tidecrown.info.steps, city: g.world2.tidecrown.info.city };
  });
  assert.equal(entry.ok, true, 'enterTidecrown() resolves true');
  await p.waitForFunction(() => !document.querySelector('.tidecrown-veil'), null, { timeout: 30000 });
  await p.waitForTimeout(3000);
  const detail = await p.evaluate(() => {
    const i = window.app.current.game.world2.tidecrown, t0 = performance.now(), before = i.city.stats.nearMs;
    i.refine(1e9);
    return { forcedMs: Math.round(performance.now() - t0), totalMs: i.city.stats.nearMs, backgroundBefore: before, stats: i.city.stats };
  });
  console.log(JSON.stringify({ entry, detail }));
  const houses = Object.values(detail.stats.houses).reduce((a, b) => a + b, 0);
  assert.ok(houses > 300, `the districts are filled: ${houses} houses ${JSON.stringify(detail.stats.houses)}`);
  console.log(`PASS entry: first entry ${entry.ms} ms (city ${entry.steps.city} ms of it), ${houses} houses ${JSON.stringify(detail.stats.houses)}; the near detail took ${detail.totalMs} ms of work after it`);

  // Walks: every district's main street, the Grand Canal's quays, the harbour's quay and its long pier.
  const walks = await p.evaluate(async () => {
    const g = window.app.current.game, w = g.world;
    const P = await import('/src/game/tidecrown/cityPlan.ts');
    const C = await import('/src/sim/world/tidecrownCity.ts');
    const I = window.app.current.game.world2.tidecrown;
    const r = g.player.unit.radius, o = { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; return this; } };
    const lines = P.TC_CITY_STREETS.filter((s) => s.main).map((s) => ({ id: s.id, pts: s.points }));
    lines.push({ id: 'market-ring', pts: P.streetById('market-ring').points });
    // The Grand Canal's quays, 1.5 back from the copings (past the bridges' ends).
    const c = C.TC_CANALS[0], off = c.width / 2 + C.TC_CANAL.wall + 1.5;
    for (const side of [1, -1]) {
      const q = c.points.map(([x, z], i) => {
        const a = c.points[Math.max(0, i - 1)], b = c.points[Math.min(c.points.length - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        return [x - ((b[1] - a[1]) / l) * off * side, z + ((b[0] - a[0]) / l) * off * side];
      });
      lines.push({ id: `grand-canal-quay-${side > 0 ? 'south' : 'north'}`, pts: q.slice(0, -1) });
    }
    // The harbour: through the sea gate onto the quay, along it, down the ramp and out along the long pier to its crane.
    const hp = I.layout.city.harbour.pieces, piers = hp.filter((q) => q.piece === 'TC_Pier_10');
    const longPier = piers.filter((q) => Math.abs(q.z - piers[0].z) < 1);
    const ramp = hp.find((q) => q.ramp && Math.abs(q.z - longPier[0].z) < 1);
    lines.push({ id: 'harbour-quay', pts: I.layout.city.harbour.quayWalk });
    const top = [ramp.x - ramp.ramp.len / 2 - 1.5, ramp.z], foot = [ramp.x + ramp.ramp.len / 2, ramp.z];
    // In through the sea gate's passage (its centre, then 5 out along the quay wall's normal), onto the ramp's head.
    const gate = I.layout.placements.find((q) => q.piece === 'TC_WardGate' && q.sx > 1.1), gx = Math.sin(gate.yaw), gz = Math.cos(gate.yaw);
    lines.push({ id: 'harbour-pier', pts: [[gate.x - gx * 7, gate.z - gz * 7], [gate.x, gate.z], [gate.x + gx * 5, gate.z + gz * 5], top, foot, [longPier[0].x - 5, longPier[0].z], [longPier[longPier.length - 1].x - 8, longPier[0].z]] });
    return lines.map(({ id, pts }) => {
      let samples = 0, worst = 0, at = null, prev = null;
      const pushed = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1], n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5);
        for (let k = 0; k < n; k++) {
          const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n, y = w.heightAt(x, z);
          w.resolveCollision(x, z, r, o);
          if (Math.hypot(o.x - x, o.y - z) > 0.02) pushed.push([+x.toFixed(1), +z.toFixed(1)]);
          if (prev !== null && Math.abs(y - prev) > worst) { worst = Math.abs(y - prev); at = [+x.toFixed(1), +z.toFixed(1)]; }
          prev = y;
          samples++;
        }
      }
      return { id, samples, pushed: pushed.length, first: pushed.slice(0, 6), worst: +worst.toFixed(3), at };
    });
  });
  for (const wk of walks) {
    assert.equal(wk.pushed, 0, `${wk.id} is open: ${JSON.stringify(wk.first)}`);
    assert.ok(wk.worst < 0.45, `${wk.id} stays walkable: step ${wk.worst} at ${wk.at}`);
  }
  console.log(`PASS walks: ${walks.map((w) => `${w.id} ${w.samples}`).join(', ')} samples, none blocked, worst step ${Math.max(...walks.map((w) => w.worst))}`);

  // Overlaps, on the plan the island built from.
  const overlap = await p.evaluate(async () => {
    const P = await import('/src/game/tidecrown/cityPlan.ts');
    const H = await import('/src/game/tidecrown/houses.ts');
    const C = await import('/src/sim/world/tidecrownCity.ts');
    const G = await import('/src/sim/world/tidecrownGround.ts');
    const city = window.app.current.game.world2.tidecrown.layout.city;
    const lots = city.zones.flatMap((z) => z.plan.lots);
    const out = { houses: lots.length, houseHouse: [], houseLandmark: [], houseStreet: [], houseCanal: [], houseWay: [], landmarkStreet: [], landmarkCanal: [], landmarkLandmark: [] };
    const where = (q) => q.map(([x, z]) => [+x.toFixed(1), +z.toFixed(1)])[0];
    for (let i = 0; i < lots.length; i++) for (let j = i + 1; j < lots.length; j++) if (H.quadsOverlap(lots[i].corners, lots[j].corners)) out.houseHouse.push(where(lots[i].corners));
    // Landmarks by their solids (the keep-clear margins may touch); streets by their carriageways; canals by water and walls.
    const solids = P.TC_LANDMARKS.map((l) => ({ id: l.id, q: l.solids.map(([lx, lz, hx, hz]) => P.quad(l.x + Math.cos(l.yaw) * lx * l.scale + Math.sin(l.yaw) * lz * l.scale, l.z - Math.sin(l.yaw) * lx * l.scale + Math.cos(l.yaw) * lz * l.scale, hx * l.scale, hz * l.scale, l.yaw)) }));
    const streets = P.TC_CITY_STREETS.filter((s) => !s.id.includes('canal') && !s.id.startsWith('kings-way') && s.id !== 'gate-court');
    const canalHit = (q) => { for (let k = 0; k <= 16; k++) for (let m = 0; m <= 16; m++) { const u = k / 16, v = m / 16; const x = q[0][0] + (q[1][0] - q[0][0]) * u + (q[3][0] - q[0][0]) * v, z = q[0][1] + (q[1][1] - q[0][1]) * u + (q[3][1] - q[0][1]) * v; if (C.canalDistance(x, z) < C.TC_CANAL.wall) return true; } return false; };
    for (const l of lots) {
      for (const s of solids) if (s.q.some((q) => H.polyDist(l.corners, q) === 0)) out.houseLandmark.push([s.id, where(l.corners)]);
      for (const st of streets) if (H.polyLineDist(l.corners, st.points) < st.width / 2) out.houseStreet.push([st.id, where(l.corners)]);
      if (canalHit(l.corners)) out.houseCanal.push(where(l.corners));
      // The King's Way: its paving (6.5 each side) the whole way from the gate to the stair.
      for (const c of l.corners) { const [t, s] = G.tcAxisCoords(c[0], c[1]); if (t > -10 && t < 172 && Math.abs(s) < 6.5) out.houseWay.push(where(l.corners)); }
    }
    for (const s of solids) {
      for (const q of s.q) {
        for (const st of streets) if (H.polyLineDist(q, st.points) < st.width / 2) out.landmarkStreet.push([s.id, st.id]);
        if (canalHit(q)) out.landmarkCanal.push(s.id);
      }
      for (const o of solids) if (o !== s && s.q.some((a) => o.q.some((b) => H.quadsOverlap(a, b)))) out.landmarkLandmark.push([s.id, o.id]);
    }
    return out;
  });
  for (const k of ['houseHouse', 'houseLandmark', 'houseStreet', 'houseCanal', 'houseWay', 'landmarkStreet', 'landmarkCanal', 'landmarkLandmark']) assert.deepEqual(overlap[k], [], `no overlap: ${k}`);
  console.log(`PASS overlaps: ${overlap.houses} houses clear of each other, the landmarks, the streets, the King's Way and the canals; landmarks clear of streets, canals and each other`);

  // Nothing floats: the ground under every footprint is no lower than its base (a plinth or foundation reaches it).
  const floating = await p.evaluate(async () => {
    const P = await import('/src/game/tidecrown/cityPlan.ts');
    const I = window.app.current.game.world2.tidecrown, L = I.layout, city = L.city;
    const ground = (x, z) => L.col.terrain.heightAt(x, z);
    const out = { checked: 0, houses: [], landmarks: [], walls: [], furniture: [], stairs: [] };
    for (const z of city.zones) for (const l of z.plan.lots) {
      out.checked++;
      const s = l.spec, base = s.base ?? s.ground;
      for (const [x, zz] of l.corners) if (ground(x, zz) < base - 0.15) { out.houses.push([+x.toFixed(1), +zz.toFixed(1), +(base - ground(x, zz)).toFixed(2)]); break; }
    }
    for (const l of P.TC_LANDMARKS) {
      out.checked++;
      const y = ground(l.x, l.z) - 0.12;
      for (const [lx, lz, hx, hz] of l.solids.slice(0, 1)) for (const [ax, az] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) {
        const ox = lx + ax * hx * 0.95, oz = lz + az * hz * 0.95, x = l.x + (Math.cos(l.yaw) * ox + Math.sin(l.yaw) * oz) * l.scale, z = l.z + (-Math.sin(l.yaw) * ox + Math.cos(l.yaw) * oz) * l.scale;
        if (ground(x, z) < y - 0.6) out.landmarks.push([l.id, +x.toFixed(1), +z.toFixed(1), +(y - ground(x, z)).toFixed(2)]);
      }
    }
    for (const w of city.walls.runs) {
      out.checked++;
      const fx = w.x + Math.sin(w.yaw) * 1.2, fz = w.z + Math.cos(w.yaw) * 1.2;
      if (ground(fx, fz) < w.y - 0.05) out.walls.push([+w.x.toFixed(1), +w.z.toFixed(1), +(w.y - ground(fx, fz)).toFixed(2)]);
    }
    for (const s of P.TC_GRAND_STAIRS) {
      out.checked++;
      if (ground(s.x, s.z) < s.y - 0.4) out.stairs.push([s.id, +(s.y - ground(s.x, s.z)).toFixed(2)]);
    }
    for (const f of [...city.lamps, ...city.poles]) {
      out.checked++;
      const g0 = L.heightAt(f.x, f.z);
      if (Math.abs(ground(f.x, f.z) - g0) > 0.3 && !L.col.surfaceAt(f.x, f.z)) out.furniture.push([+f.x.toFixed(1), +f.z.toFixed(1)]);
    }
    return out;
  });
  for (const k of ['houses', 'landmarks', 'walls', 'stairs', 'furniture']) assert.deepEqual(floating[k], [], `nothing floats: ${k}`);
  console.log(`PASS footing: ${floating.checked} houses, landmarks, terrace walls, stairs, lamps and poles stand on the ground`);

  // Views: the six stage 1 cameras and the districts', within the budget.
  const frameStats = () => p.evaluate(() => new Promise((resolve) => {
    const e = window.app.engine, off = e.onAfterFrame(() => { off(); const r = e.renderer.info.render; resolve({ calls: r.calls, triangles: r.triangles }); });
  }));
  await p.evaluate(() => {
    const canvas = document.querySelector('canvas');
    for (let a = canvas; a && a !== document.body; a = a.parentElement) for (const el of a.parentElement.children) if (el !== a && !el.contains(canvas)) el.style.visibility = 'hidden';
  });
  const cams = await p.evaluate(async () => {
    const L = await import('/src/game/tidecrown/layout.ts');
    const a = (t, s = 0) => L.tcAxis(t, s), yaw = Math.atan2(-L.TC_AXIS.ux, -L.TC_AXIS.uz) + Math.PI, K = [L.TC_KEEP.x, L.TC_KEEP.z];
    return [
      { name: '1-reveal', cam: [...a(-177), 7.5], at: [K[0], K[1], 50, 1], crab: [...a(-163, -2.5), yaw] },
      { name: '2-bridge', cam: [...a(-92, 1.5), 2.5], at: [...a(0), 13], crab: [...a(-86, 2.5), yaw] },
      { name: '3-keep', cam: [...a(158), 2.4], at: [K[0], K[1], 108, 1], crab: [...a(162, 1), yaw] },
      { name: '4-aerial', cam: [...a(-270, -120), 190, 1], at: [...a(120), 4] },
      { name: '5-harbour', cam: [330, -20, 9, 1], at: [K[0], K[1], 70, 1] },
      { name: '6-gate', cam: [...a(-31, 1.5), 2.4], at: [...a(0), 27] },
      { name: 'market', cam: [35.8, 87, 2.4], at: [72.2, 65.7, 7], crab: [40, 84, 2.2] },
      { name: 'cathedral-square', cam: [-31, 32, 2.4], at: [-31, -42, 38, 1] },
      { name: 'seaglass-quarter', cam: [-44, -104, 2.4], at: [-66, -122, 46, 1] },
      { name: 'forge-waterwheel', cam: [-58, 22, 9], at: [-80, 20, 6] },
      { name: 'canal-gondolas', cam: [123.5, 102.8, 2.6], at: [175, 94, 5.5] },
      { name: 'harbour-galleon', cam: [300, 44, 14, 1], at: [226, 8, 14, 1] },
      { name: 'upper-town', cam: [150, 10, 4], at: [132, -6, 4] },
      { name: 'crab-street', cam: [-118, 33, 1.9], at: [-40, 43, 5], crab: [-112, 33.5, 1.6] },
      { name: 'aerial-low', cam: [-60, 190, 110, 1], at: [60, 0, 10] },
    ];
  });
  const views = {};
  for (const c of cams) {
    await p.evaluate((c) => {
      const g = window.app.current.game, h = (x, z) => g.world.heightAt(x, z);
      if (c.crab) g.player.unit.teleport(g.world, c.crab[0], c.crab[1], c.crab[2]);
      const pos = [c.cam[0], c.cam[3] ? c.cam[2] : h(c.cam[0], c.cam[1]) + c.cam[2], c.cam[1]], at = [c.at[0], c.at[3] ? c.at[2] : h(c.at[0], c.at[1]) + c.at[2], c.at[1]];
      g.follow.update = function () { this.camera.position.set(...pos); this.camera.lookAt(...at); };
    }, c);
    await p.waitForTimeout(1800);
    views[c.name] = await frameStats();
    await p.screenshot({ path: `${out}/${c.name}.png` });
  }
  console.log(JSON.stringify(views));
  for (const [name, v] of Object.entries(views)) {
    assert.ok(v.calls <= BUDGET.calls, `${name}: ${v.calls} draw calls`);
    assert.ok(v.triangles <= BUDGET.triangles, `${name}: ${v.triangles} triangles`);
  }
  const worst = Object.values(views).reduce((m, v) => ({ calls: Math.max(m.calls, v.calls), triangles: Math.max(m.triangles, v.triangles) }), { calls: 0, triangles: 0 });
  console.log(`PASS budget: ${cams.length} views at most ${worst.calls} draw calls and ${(worst.triangles / 1e6).toFixed(2)}M triangles (shots in ${out})`);
  assert.deepEqual(errors, []);
  console.log('PASS zero page or shader errors');
} finally {
  await browser.close();
}
