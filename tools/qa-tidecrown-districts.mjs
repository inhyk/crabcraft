// Tidecrown districts (stage 2): enters the capital by creator travel and checks the city the districts add. The first
// entry is timed, and so is every frame for four seconds after it (none over 50 ms once the fade lifts); every
// district's main street is walked (none blocked, gently graded, canal bridges included) and so are the Grand Canal's
// quays and the harbour's quay and long pier; no house overlaps another house, a landmark, a street, the King's Way or
// a canal, and no landmark overlaps a street or a canal; nothing floats (houses' plinths, landmarks, terrace walls,
// stairs, lamps and banner poles reach the ground under them). Collision: a flood fill from the arrival reaches no
// point below +1 on the harbour side, the ground just off every canal wall's kerb is within 0.5 of the street, and
// every collider is in the plan (the near builds add none). Every camera (the six stage 1 views and the district
// views, near detail built for each) stays within the budget of 700 draw calls and 5.5M triangles, shadow pass
// included, with Tidecrown's geometry arrays at most 200 MB and the near pools' GPU data at most 200 MB in use; a
// sprint up the King's Way from outside the city shows every chunk near by its switch distance, with the near
// build's slices at p95 within their 6 ms budget and no frame over 50 ms; leaving frees every near build (pools,
// GPU geometries, back to the far-only arrays), and a second entry takes under a second. Zero page or shader errors.
// Writes the district shots (1600x900) to CC_QA_SHOTS.
// Usage: CC_QA_BASE=http://127.0.0.1:5253 node tools/qa-tidecrown-districts.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.CC_QA_BASE ?? 'http://127.0.0.1:5241';
const out = process.env.CC_QA_SHOTS ?? 'tmp/qa/tidecrown-districts';
const BUDGET = { calls: 700, triangles: 5.5e6 };
/** Tidecrown's geometry arrays (CPU) and the near pools' GPU data in use, MB; a near build slice's budget and the worst frame, ms. */
const MEMORY = { cpu: 200, nearGpu: 200, leave: 30 };
const SLICE = 6, FRAME = 50;
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

  // Memory: Tidecrown's (and the scene's) geometry arrays on the CPU, the near and far pools' GPU bytes.
  await p.evaluate(() => {
    const arrays = (root) => {
      const seen = new Set();
      let b = 0;
      const add = (a) => { if (a && a.byteLength && !seen.has(a)) { seen.add(a); b += a.byteLength; } };
      root.traverse((o) => {
        if (o.isInstancedMesh) { add(o.instanceMatrix.array); add(o.instanceColor?.array); }
        const g = o.geometry;
        if (!g) return;
        for (const a of Object.values(g.attributes)) add(a.isInterleavedBufferAttribute ? a.data.array : a.array);
        add(g.index?.array);
      });
      return b / 1048576;
    };
    window.__tcMem = () => {
      const g = window.app.current.game, i = g.world2.tidecrown, s = i.city.lod.stats, MB = 1048576;
      return { tidecrown: +arrays(i.root).toFixed(1), scene: +arrays(g.scene).toFixed(1), nearUsed: +(s.nearUsed / MB).toFixed(1), nearGpu: +(s.nearBytes / MB).toFixed(1), farGpu: +(s.farBytes / MB).toFixed(1), resident: s.resident, pools: i.city.lod.meshes.filter((m) => !m.far).length, geometries: window.app.engine.renderer.info.memory.geometries };
    };
  });

  // First entry, then every frame and near build slice for four seconds after it (the fade lifts as it resolves).
  const entry = await p.evaluate(async () => {
    const g = window.app.current.game, t0 = performance.now();
    g.creatorTravel = true;
    const ok = await g.world2.enterTidecrown();
    const ms = Math.round(performance.now() - t0), i = g.world2.tidecrown, frames = [], slices = [];
    const refine = i.refine;
    i.refine = function (b) { const t = performance.now(); const r = refine.call(this, b); slices.push(performance.now() - t); return r; };
    await new Promise((res) => { let last = performance.now(); const f = () => { const n = performance.now(); frames.push(n - last); last = n; if (n - t0 - ms < 4000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    delete i.refine;
    return { ok, ms, steps: i.info.steps, city: i.info.city, worstFrame: +Math.max(...frames).toFixed(1), frames: frames.length, worstSlice: +Math.max(...slices).toFixed(1) };
  });
  assert.equal(entry.ok, true, 'enterTidecrown() resolves true');
  await p.waitForFunction(() => !document.querySelector('.tidecrown-loading'), null, { timeout: 30000 });
  const detail = await p.evaluate(() => {
    const i = window.app.current.game.world2.tidecrown, t0 = performance.now();
    i.refine(1e9);
    return { forcedMs: Math.round(performance.now() - t0), stats: i.city.stats, lod: i.city.lod.opts };
  });
  const farOnly = await p.evaluate(() => window.__tcMem());
  console.log(JSON.stringify({ entry, detail, farOnly }));
  const houses = Object.values(detail.stats.houses).reduce((a, b) => a + b, 0);
  assert.ok(houses > 300, `the districts are filled: ${houses} houses ${JSON.stringify(detail.stats.houses)}`);
  assert.ok(entry.worstFrame <= FRAME, `no frame over ${FRAME} ms after the entry: ${entry.worstFrame} ms`);
  assert.ok(farOnly.tidecrown <= MEMORY.cpu, `far only: Tidecrown geometry ${farOnly.tidecrown} MB`);
  console.log(`PASS entry: first entry ${entry.ms} ms (city ${entry.steps.city} ms of it), ${houses} houses ${JSON.stringify(detail.stats.houses)}; ${entry.frames} frames in the 4 s after it, the worst ${entry.worstFrame} ms; far only, Tidecrown's geometry arrays are ${farOnly.tidecrown} MB (scene ${farOnly.scene} MB), its far pools ${farOnly.farGpu} MB on the GPU`);

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

  // Collision: a flood fill from the arrival over the playable box (0.5 apart): nothing below +1 on the harbour side;
  // the closest a crab gets to every canal wall (just off its kerb) stays within 0.5 of the street; every collider is
  // in the plan, so a fresh layout registers as many solids as the island holds after its near builds.
  const collision = await p.evaluate(async () => {
    const g = window.app.current.game, I = g.world2.tidecrown, r = g.player.unit.radius;
    const G = await import('/src/sim/world/tidecrownGround.ts');
    const C = await import('/src/sim/world/tidecrownCity.ts');
    const L = await import('/src/game/tidecrown/layout.ts');
    const o = { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; return this; } };
    const free = (x, z) => { I.resolve(x, z, r, o); return Math.hypot(o.x - x, o.y - z) < 0.02; };
    const step = 0.5, x0 = G.TC_BOUNDS.minX, z0 = G.TC_BOUNDS.minZ, nx = Math.floor((G.TC_BOUNDS.maxX - x0) / step) + 1, nz = Math.floor((G.TC_BOUNDS.maxZ - z0) / step) + 1;
    const state = new Int8Array(nx * nz).fill(-1), q = new Int32Array(nx * nz);
    const at = (i, j) => { const k = j * nx + i; if (state[k] < 0) state[k] = free(x0 + i * step, z0 + j * step) ? 1 : 0; return state[k]; };
    const ai = Math.round((G.TC_ARRIVAL[0] - x0) / step), aj = Math.round((G.TC_ARRIVAL[1] - z0) / step);
    const reached = new Uint8Array(nx * nz);
    let head = 0, tail = 0, n = 0;
    const low = [];
    if (at(ai, aj)) { q[tail++] = aj * nx + ai; reached[aj * nx + ai] = 1; }
    while (head < tail) {
      const k = q[head++], i = k % nx, j = (k - i) / nx, x = x0 + i * step, z = z0 + j * step;
      n++;
      // The harbour side: east of the quay wall, between the keep cliff and the estuary.
      if (x > 200 && z > -95 && z < 85 && I.height(x, z) < 1 && low.length < 10) low.push([x, z, +I.height(x, z).toFixed(2)]);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if ((!di && !dj) || ii < 0 || jj < 0 || ii >= nx || jj >= nz || reached[jj * nx + ii] || !at(ii, jj)) continue;
        reached[jj * nx + ii] = 1;
        q[tail++] = jj * nx + ii;
      }
    }
    let kerbs = 0, kerbLow = 0, kerbWorst = 0, kerbAt = null;
    for (const w of I.layout.city.canalWalls) {
      const len = Math.hypot(w.bx - w.ax, w.bz - w.az);
      for (let u = 0.5; u < len - 0.5; u += 0.5) {
        const f = u / len, lx = w.ax + (w.bx - w.ax) * f, lz = w.az + (w.bz - w.az) * f;
        let last = null;
        for (let d = 4; d >= 0; d -= 0.1) { const x = lx - w.nx * d, z = lz - w.nz * d; if (!free(x, z)) break; last = [x, z]; }
        if (!last) continue;
        kerbs++;
        const deficit = C.TC_CANAL.street - I.height(last[0], last[1]);
        if (deficit > 0.5) kerbLow++;
        if (deficit > kerbWorst) { kerbWorst = deficit; kerbAt = last.map((v) => +v.toFixed(1)); }
      }
    }
    const shapes = I.collision.shapes.length;
    I.refine(1e9);
    return { reached: n, low, kerbs, kerbLow, kerbWorst: +kerbWorst.toFixed(2), kerbAt, shapes, afterNear: I.collision.shapes.length, fresh: L.tidecrownLayout().col.shapes.length };
  });
  console.log(JSON.stringify(collision));
  assert.deepEqual(collision.low, [], 'the flood fill from the arrival reaches no point below +1 on the harbour side');
  assert.equal(collision.kerbLow, 0, `canal kerbs within 0.5 of the street: worst ${collision.kerbWorst} at ${collision.kerbAt}`);
  assert.ok(collision.kerbs > 500, `canal wall samples: ${collision.kerbs}`);
  assert.equal(collision.afterNear, collision.shapes, 'the near builds add no colliders');
  assert.equal(collision.fresh, collision.shapes, 'a fresh layout registers every solid the island holds');
  console.log(`PASS collision: ${collision.reached} points reached from the arrival, none below +1 on the harbour side; ${collision.kerbs} canal kerb samples within 0.5 of the street (worst ${collision.kerbWorst}); ${collision.shapes} solids, all from the plan`);

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
    // The LOD sees the camera on the next frame; then everything near it is built at once.
    await p.waitForTimeout(100);
    await p.evaluate(() => window.app.current.game.world2.tidecrown.refine(1e9));
    await p.waitForTimeout(1700);
    views[c.name] = { ...(await frameStats()), ...(await p.evaluate(() => window.__tcMem())) };
    await p.screenshot({ path: `${out}/${c.name}.png` });
  }
  console.log(JSON.stringify(views));
  for (const [name, v] of Object.entries(views)) {
    assert.ok(v.calls <= BUDGET.calls, `${name}: ${v.calls} draw calls`);
    assert.ok(v.triangles <= BUDGET.triangles, `${name}: ${v.triangles} triangles`);
    assert.ok(v.tidecrown <= MEMORY.cpu, `${name}: Tidecrown geometry arrays ${v.tidecrown} MB`);
    assert.ok(v.nearUsed <= MEMORY.nearGpu, `${name}: near pools ${v.nearUsed} MB in use on the GPU`);
  }
  const worst = Object.values(views).reduce((m, v) => ({ calls: Math.max(m.calls, v.calls), triangles: Math.max(m.triangles, v.triangles), tidecrown: Math.max(m.tidecrown, v.tidecrown), nearUsed: Math.max(m.nearUsed, v.nearUsed), nearGpu: Math.max(m.nearGpu, v.nearGpu) }), { calls: 0, triangles: 0, tidecrown: 0, nearUsed: 0, nearGpu: 0 });
  console.log(`PASS budget: ${cams.length} views at most ${worst.calls} draw calls and ${(worst.triangles / 1e6).toFixed(2)}M triangles; Tidecrown's geometry arrays at most ${worst.tidecrown} MB, the near pools at most ${worst.nearUsed} MB in use (${worst.nearGpu} MB allocated) on the GPU (shots in ${out})`);

  // A sprint up the King's Way from the Bridge of Six Shells to the keep's stair at crab eye: every chunk near by its
  // switch distance, the near build's slices within budget, no long frame, the memory budget held.
  const sprint = await p.evaluate(async () => {
    const g = window.app.current.game, I = g.world2.tidecrown, lod = I.city.lod, h = (x, z) => g.world.heightAt(x, z);
    const L = await import('/src/game/tidecrown/layout.ts');
    const [ax, az] = L.tcAxis(-150), [bx, bz] = L.tcAxis(150), len = Math.hypot(bx - ax, bz - az), speed = 5 * 1.65;
    let d = 0;
    g.follow.update = function () {
      const f = Math.min(1, d / len), f2 = Math.min(1, (d + 6) / len), x = ax + (bx - ax) * f, z = az + (bz - az) * f, x2 = ax + (bx - ax) * f2, z2 = az + (bz - az) * f2;
      this.camera.position.set(x, h(x, z) + 2.4, z);
      this.camera.lookAt(x2, h(x2, z2) + 2.2, z2);
    };
    // Start clear of the city with nothing near, then run.
    await new Promise((r) => setTimeout(r, 300));
    I.refine(1e9);
    const slices = [], frames = [], late = new Set();
    let worstLate = 0, memory = window.__tcMem();
    const refine = I.refine, update = lod.update;
    I.refine = function (b) { const t = performance.now(); const r = refine.call(this, b); slices.push(performance.now() - t); return r; };
    lod.update = function (cam) {
      update.call(this, cam);
      this.chunks.forEach((c, ci) => { if (c.recipe.length && !c.isNear && c.d < this.opts.near - 0.5) { late.add(ci); worstLate = Math.max(worstLate, this.opts.near - c.d); } });
    };
    await new Promise((res) => {
      let last = -1, t0 = -1;
      const f = () => {
        const n = performance.now();
        if (t0 < 0) t0 = n; else frames.push(n - last);
        last = n;
        d = ((n - t0) / 1000) * speed;
        if (frames.length % 30 === 0) { const m = window.__tcMem(); if (m.nearUsed > memory.nearUsed) memory = m; }
        if (d < len) requestAnimationFrame(f); else res();
      };
      requestAnimationFrame(f);
    });
    delete I.refine;
    delete lod.update;
    const q = (a, k) => { const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(s.length * k))].toFixed(1); };
    return { len: Math.round(len), speed, late: late.size, worstLate: +worstLate.toFixed(1), slices: slices.length, sliceP95: q(slices, 0.95), sliceMax: q(slices, 1), frames: frames.length, frameP95: q(frames, 0.95), frameMax: q(frames, 1), memory };
  });
  console.log(JSON.stringify(sprint));
  assert.equal(sprint.late, 0, `no chunk shows near later than its switch distance (worst ${sprint.worstLate} inside it)`);
  assert.ok(sprint.sliceP95 <= SLICE, `near build slices p95 ${sprint.sliceP95} ms within ${SLICE}`);
  assert.ok(sprint.frameMax <= FRAME, `no frame over ${FRAME} ms on the sprint: ${sprint.frameMax}`);
  assert.ok(sprint.memory.tidecrown <= MEMORY.cpu && sprint.memory.nearUsed <= MEMORY.nearGpu, `memory on the sprint: ${JSON.stringify(sprint.memory)}`);
  console.log(`PASS sprint: ${sprint.len} up the King's Way at ${sprint.speed} a second, every chunk near by ${detail.lod.near}; slices p95 ${sprint.sliceP95} ms (max ${sprint.sliceMax}), frames p95 ${sprint.frameP95} ms (max ${sprint.frameMax}); at most ${sprint.memory.nearUsed} MB of near detail in use on the GPU, Tidecrown's arrays ${sprint.memory.tidecrown} MB`);

  // Leaving frees every near build; a second entry is quick.
  const leave = await p.evaluate(async () => {
    const g = window.app.current.game, before = window.__tcMem();
    let disposed = 0;
    for (const m of g.world2.tidecrown.city.lod.meshes) if (!m.far) m.geometry.addEventListener('dispose', () => disposed++);
    g.world2.exitTidecrown();
    await new Promise((r) => setTimeout(r, 500));
    const after = window.__tcMem();
    const t0 = performance.now();
    await g.world2.enterTidecrown();
    const again = Math.round(performance.now() - t0);
    g.world2.exitTidecrown();
    return { before, after: { ...after, disposed }, again };
  });
  console.log(JSON.stringify(leave));
  assert.equal(leave.after.pools + leave.after.resident + leave.after.nearGpu, 0, 'leaving frees every near build and pool');
  // (World I's own geometries may go up a little: the minimap is redrawn on leaving.)
  assert.equal(leave.after.disposed, leave.before.pools, 'every near pool geometry is disposed');
  assert.ok(leave.after.geometries <= leave.before.geometries - leave.before.pools + 8, `the near pools leave the GPU: ${leave.after.geometries} geometries, ${leave.before.geometries} with ${leave.before.pools} pools before`);
  assert.ok(leave.after.scene - farOnly.scene <= MEMORY.leave, `after leaving the scene's arrays are ${leave.after.scene} MB, far only ${farOnly.scene} MB`);
  assert.ok(leave.again < 1000, `second entry in ${leave.again} ms`);
  console.log(`PASS leave: ${leave.before.pools} near pools (${leave.before.nearGpu} MB on the GPU) freed, ${leave.after.geometries} GPU geometries left (${leave.before.geometries} before), scene arrays ${leave.after.scene} MB (far only ${farOnly.scene}); second entry ${leave.again} ms`);
  assert.deepEqual(errors, []);
  console.log('PASS zero page or shader errors');
} finally {
  await browser.close();
}
