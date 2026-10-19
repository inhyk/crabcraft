// Tidecrown townhouses: opens the studio's street, district and market views (dev/tidecrown.html) and checks
// that the pages load without errors, that no house overlaps a street, a lane, a reserved plaza or another house
// (party walls may touch), that every house has a door facing a street or lane, that market stalls keep off the
// streets and houses, and that the district plans the same from the same seed. Prints draw calls and triangles
// and writes PNGs to TIDECROWN_SHOTS (default: the session scratchpad's houses-shots/, outside the repo).
//   CC_QA_BASE=http://127.0.0.1:5244 node tools/qa-tidecrown-houses.mjs
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.CC_QA_BASE ?? 'http://127.0.0.1:5244';
const out = process.env.TIDECROWN_SHOTS ?? '/private/tmp/claude-501/-Users-inkeun-projects-crabcraft/78bf7b2c-07a0-4bdb-9652-08ca659106a1/scratchpad/houses-shots';
await mkdir(out, { recursive: true });

// --- plane geometry (x, z pairs) ---------------------------------------------------------------
const segDist = (px, pz, ax, az, bx, bz) => {
  const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l));
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
};
const inPoly = (x, z, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const cross = (a, b, c, d) => {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};
const lineDist = (x, z, line) => Math.min(...line.slice(0, -1).map((p, i) => segDist(x, z, p[0], p[1], line[i + 1][0], line[i + 1][1])));
/** Distance from a closed polygon to a polyline (0 when they cross or the line runs inside). */
function polyLineDist(poly, line) {
  if (line.some(([x, z]) => inPoly(x, z, poly))) return 0;
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    for (let j = 0; j < line.length - 1; j++) {
      const s = line[j], t = line[j + 1];
      if (cross(p, q, s, t)) return 0;
      d = Math.min(d, segDist(p[0], p[1], s[0], s[1], t[0], t[1]), segDist(s[0], s[1], p[0], p[1], q[0], q[1]));
    }
  }
  return d;
}
const polysOverlap = (a, b) => a.some(([x, z]) => inPoly(x, z, b)) || b.some(([x, z]) => inPoly(x, z, a)) || a.some((p, i) => b.some((s, j) => cross(p, a[(i + 1) % a.length], s, b[(j + 1) % b.length])));
/** Convex quads overlap by more than `tol` (touching party walls are fine). */
function quadsOverlap(a, b, tol = 0.02) {
  for (const poly of [a, b])
    for (let i = 0; i < 4; i++) {
      const p = poly[i], q = poly[(i + 1) % 4];
      const nx = -(q[1] - p[1]), nz = q[0] - p[0], l = Math.hypot(nx, nz) || 1;
      const proj = (pts) => pts.map(([x, z]) => (x * nx + z * nz) / l);
      const pa = proj(a), pb = proj(b);
      if (Math.max(...pa) - tol <= Math.min(...pb) || Math.max(...pb) - tol <= Math.min(...pa)) return false;
    }
  return true;
}
const quad = (x, z, hx, hz, yaw) => {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [[-hx, hz], [hx, hz], [hx, -hz], [-hx, -hz]].map(([lx, lz]) => [x + c * lx + s * lz, z - s * lx + c * lz]);
};

function checkDistrict(name, d) {
  const problems = [];
  d.lots.forEach((l, i) => {
    d.streets.forEach((s, j) => {
      const dist = polyLineDist(l.corners, s.points);
      if (dist < s.width / 2 - 1e-3) problems.push(`house ${i} on street/lane ${j} (${dist.toFixed(2)} < ${s.width / 2})`);
    });
    d.reserved.forEach((p, j) => polysOverlap(l.corners, p) && problems.push(`house ${i} on reserved ${j}`));
    if (!l.corners.every(([x, z]) => inPoly(x, z, d.polygon))) problems.push(`house ${i} outside the district`);
    for (let k = i + 1; k < d.lots.length; k++) if (quadsOverlap(l.corners, d.lots[k].corners)) problems.push(`houses ${i} and ${k} overlap`);
    // A door faces a street when a short walk straight out of it reaches the paving.
    const facing = l.doors.some((door) => {
      for (let t = 0.2; t <= 2.6; t += 0.1) {
        const x = door.x + door.nx * t, z = door.z + door.nz * t;
        if (d.streets.some((s) => lineDist(x, z, s.points) <= s.width / 2)) return true;
      }
      return false;
    });
    if (!l.doors.length || !facing) problems.push(`house ${i} has no door facing a street`);
  });
  for (const [i, st] of d.stalls.entries()) {
    const q = quad(st.x, st.z, st.hx, st.hz, st.yaw);
    d.lots.forEach((l, j) => quadsOverlap(q, l.corners, 0) && problems.push(`stall ${i} overlaps house ${j}`));
    d.streets.forEach((s, j) => polyLineDist(q, s.points) < s.width / 2 && problems.push(`stall ${i} stands on street/lane ${j}`));
  }
  console.log(`${name}: ${d.lots.length} houses, ${d.streets.length} streets and lanes, ${d.stalls.length} stalls, ${d.colliders} colliders; ${problems.length} layout problems`);
  return problems;
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const errors = [];
try {
  const views = [
    ['street', 'tidecrown-street.png'],
    ['district', 'tidecrown-district.png'],
    ['market', 'tidecrown-market.png'],
  ];
  const results = {};
  for (const [view, file] of views) {
    const p = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    p.setDefaultTimeout(300000);
    p.on('pageerror', (e) => errors.push(`${view}: ${e.message}`));
    p.on('console', (m) => {
      if (m.type() === 'error' && /shader|program|WebGL|merge|geometr|kit piece/i.test(m.text())) errors.push(`${view}: ${m.text().slice(0, 300)}`);
    });
    await p.goto(`${base}/dev/tidecrown.html?view=${view}&clean`);
    await p.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
    // The canvas is read back right after a frame renders (page screenshots stall on a busy GPU).
    await p.evaluate(() => { window.__shot = undefined; window.__shoot = true; });
    await p.waitForFunction(() => !!window.__shot, null, { timeout: 300000 });
    const png = await p.evaluate(() => window.__shot);
    await writeFile(`${out}/${file}`, Buffer.from(png.split(',')[1], 'base64'));
    const r = await p.evaluate(() => ({ info: window.__info, district: window.__district }));
    results[view] = r;
    const i = r.info;
    console.log(`${view}: frame ${i.frameCalls} draw calls, ${i.frameTriangles} triangles (shadow pass included); houses ${i.houses} in ${i.districtMeshes} meshes, ${i.districtTriangles} triangles${i.stalls ? `; ${i.stalls} stalls` : ''}; wrote ${out}/${file}`);
    await p.close();
  }

  const problems = [...checkDistrict('street', results.street.district), ...checkDistrict('district', results.district.district)];
  assert.deepEqual(problems.slice(0, 20), [], 'no house on a street, lane, plaza or another house; every door faces a street; stalls clear');
  assert.ok(results.street.info.houses >= 18, `street has about 20 houses: ${results.street.info.houses}`);
  assert.ok(results.district.info.houses >= 60, `district has at least 60 houses: ${results.district.info.houses}`);
  assert.ok(results.district.info.lanes >= 1, 'district adds back lanes');
  assert.ok(results.market.info.stalls >= 8, `market has stalls: ${results.market.info.stalls}`);
  assert.equal(results.district.info.deterministic, true, 'same seed, same district');
  const lots = results.district.district.lots;
  const floors = new Set(lots.map((l) => l.floors));
  assert.ok(floors.size >= 3, `skyline varies: storeys ${[...floors].sort()}`);
  assert.ok(lots.some((l) => l.shop) && lots.some((l) => !l.shop), 'some shop fronts, some plain');
  console.log(`PASS layout: no overlaps, every door faces a street, ${floors.size} storey heights, deterministic`);
  assert.deepEqual(errors, []);
  console.log('PASS zero page or shader errors');
} finally {
  await browser.close();
}
