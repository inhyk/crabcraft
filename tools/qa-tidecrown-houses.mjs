// Tidecrown townhouses: opens the studio's street, district, market and city views (dev/tidecrown.html) and checks
// that the pages load without errors, that no house overlaps a street, a lane, a reserved plaza or another house
// (party walls may touch), that every house has a door facing a street or lane, that market stalls keep off the
// streets and houses, and that the district plans the same from the same seed. The city (about 300 houses on one
// LOD) is measured from a street, from 300 units away, from the air and from the castle stair: the houses' own
// draw calls and triangles (camera and shadow pass) must stay under the city budget. The near/far swap is checked
// at the switch distance: the same frame with every chunk near, every chunk far and no houses; the mean pixel
// difference over the houses is reported. Writes PNGs to TIDECROWN_SHOTS (default: the session scratchpad's
// houses-lod-shots/, outside the repo).
//   CC_QA_BASE=http://127.0.0.1:5244 node tools/qa-tidecrown-houses.mjs
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchBrowser } from './lib/browser.mjs';

const base = process.env.CC_QA_BASE ?? 'http://127.0.0.1:5244';
const out = process.env.TIDECROWN_SHOTS ?? '/private/tmp/claude-501/-Users-inkeun-projects-crabcraft/78bf7b2c-07a0-4bdb-9652-08ca659106a1/scratchpad/houses-lod-shots';
/** The city budget for the houses, camera and shadow pass together. */
const BUDGET = { triangles: 1.2e6, calls: 120 };
/** Mean pixel difference (0..255) over the houses allowed when a whole view swaps near and far at the switch distance. */
const SWAP_LIMIT = 12;
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

const browser = await launchBrowser({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const errors = [];

async function open(query, tag) {
  const p = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  p.setDefaultTimeout(300000);
  p.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
  p.on('console', (m) => {
    if (m.type() === 'error' && /shader|program|WebGL|merge|geometr|kit piece|BatchedMesh/i.test(m.text())) errors.push(`${tag}: ${m.text().slice(0, 300)}`);
  });
  await p.goto(`${base}/dev/tidecrown.html?${query}&clean`);
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
  return p;
}
/** The canvas right after the next rendered frame (page screenshots stall on a busy GPU). */
async function grab(p) {
  await p.evaluate(() => { window.__shot = undefined; window.__shoot = true; });
  await p.waitForFunction(() => !!window.__shot, null, { timeout: 300000 });
  return p.evaluate(() => window.__shot);
}
const save = (file, png) => writeFile(`${out}/${file}`, Buffer.from(png.split(',')[1], 'base64'));
const houseLine = (i) => (i.houseCalls !== undefined ? `; houses ${i.houseCalls} draw calls (${i.houseShadowCalls} shadow), ${i.houseTriangles} triangles (${i.houseShadowTriangles} shadow), ${i.nearChunks} chunks near` : '');

try {
  const views = [
    ['street', 'tidecrown-street.png'],
    ['district', 'tidecrown-district.png'],
    ['market', 'tidecrown-market.png'],
  ];
  const results = {};
  for (const [view, file] of views) {
    const p = await open(`view=${view}`, view);
    await save(file, await grab(p));
    const r = await p.evaluate(() => ({ info: window.__info, district: window.__district }));
    results[view] = r;
    const i = r.info;
    console.log(`${view}: frame ${i.frameCalls} draw calls, ${i.frameTriangles} triangles (shadow pass included)${houseLine(i)}; ${i.houses} houses in ${i.chunks} chunks, ${i.districtTriangles} near / ${i.districtFarTriangles} far triangles${i.stalls ? `; ${i.stalls} stalls` : ''}; wrote ${out}/${file}`);
    await p.close();
  }

  // The city: about 300 houses on one LOD, from each viewpoint.
  const presets = ['street', 'far', 'aerial', 'castle'];
  const city = {};
  for (const preset of presets) {
    const p = await open(`view=city&preset=${preset}`, `city ${preset}`);
    const file = `tidecrown-city-${preset}.png`;
    await save(file, await grab(p));
    const r = await p.evaluate(() => ({ info: window.__info, district: window.__district }));
    city[preset] = r;
    const i = r.info;
    console.log(`city ${preset}: houses ${i.houseCalls} draw calls (${i.houseShadowCalls} shadow), ${i.houseTriangles} triangles (${i.houseShadowTriangles} shadow), ${i.nearChunks}/${i.chunks} chunks near; frame ${i.frameCalls} calls, ${i.frameTriangles} triangles; wrote ${out}/${file}`);
    await p.close();
  }
  const ci = city.street.info;
  console.log(`city: ${ci.houses} houses, ${ci.chunks} chunks of ${ci.lod.chunk}, near build ${ci.nearTriangles} triangles (${ci.nearPerHouse} a house), far build ${ci.farTriangles} (${ci.farPerHouse} a house); switch at ${ci.lod.near} (+${ci.lod.hysteresis}), own shadows within ${ci.lod.shadow}; built in ${ci.buildMs} ms`);

  // Near/far swap at the switch distance, at crab eye (edge) and 30 up (high): near, far, then no houses.
  const swaps = {};
  for (const preset of ['edge', 'high']) {
    const p = await open(`view=city&preset=${preset}`, `swap ${preset}`);
    const shots = [];
    for (const mode of ['near', 'far', 'none']) {
      await p.evaluate((mode) => {
        window.__lod.visible = mode !== 'none';
        window.__lod.force = mode === 'none' ? null : mode;
      }, mode);
      // A few frames so the shadow map follows the swap.
      await p.evaluate(() => new Promise((res) => { let n = 0; const f = () => (++n < 4 ? requestAnimationFrame(f) : res()); requestAnimationFrame(f); }));
      shots.push(await grab(p));
    }
    const d = await p.evaluate(async (urls) => {
      const imgs = await Promise.all(urls.map((u) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = u; })));
      const w = imgs[0].width;
      const h = imgs[0].height;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      const px = imgs.map((im) => { g.clearRect(0, 0, w, h); g.drawImage(im, 0, 0); return g.getImageData(0, 0, w, h).data; });
      const [a, b, n] = px;
      const diff = g.createImageData(w, h);
      let houses = 0;
      let sum = 0;
      let over = 0;
      for (let i = 0; i < w * h * 4; i += 4) {
        const dn = Math.abs(a[i] - n[i]) + Math.abs(a[i + 1] - n[i + 1]) + Math.abs(a[i + 2] - n[i + 2]);
        const df = Math.abs(b[i] - n[i]) + Math.abs(b[i + 1] - n[i + 1]) + Math.abs(b[i + 2] - n[i + 2]);
        const dd = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
        diff.data[i] = diff.data[i + 1] = diff.data[i + 2] = Math.min(255, dd * 4);
        diff.data[i + 3] = 255;
        // House pixels: where either build differs from the frame without houses.
        if (dn > 24 || df > 24) {
          houses++;
          sum += dd;
          if (dd > 32) over++;
        }
      }
      g.putImageData(diff, 0, 0);
      return { region: houses / (w * h), mean: sum / Math.max(1, houses), over: over / Math.max(1, houses), png: c.toDataURL('image/png') };
    }, shots);
    const info = await p.evaluate(() => ({ near: window.__lod.opts.near }));
    await save(`tidecrown-swap-${preset}-near.png`, shots[0]);
    await save(`tidecrown-swap-${preset}-far.png`, shots[1]);
    await save(`tidecrown-swap-${preset}-diff.png`, d.png);
    swaps[preset] = d;
    console.log(`swap ${preset} (camera 2 units inside the ${info.near}-unit switch distance from the nearest houses): houses cover ${(d.region * 100).toFixed(1)}% of the frame; mean |near - far| ${d.mean.toFixed(2)}/255 over them, ${(d.over * 100).toFixed(1)}% of their pixels differ by more than 32; wrote ${out}/tidecrown-swap-${preset}-{near,far,diff}.png`);
    await p.close();
  }

  const problems = [...checkDistrict('street', results.street.district), ...checkDistrict('district', results.district.district), ...checkDistrict('city', city.street.district)];
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
  assert.ok(ci.houses >= 250 && ci.houses <= 350, `the city holds 250-350 houses: ${ci.houses}`);
  for (const preset of presets) {
    const i = city[preset].info;
    assert.ok(i.houseTriangles < BUDGET.triangles, `city ${preset}: houses ${i.houseTriangles} triangles, budget ${BUDGET.triangles}`);
    assert.ok(i.houseCalls < BUDGET.calls, `city ${preset}: houses ${i.houseCalls} draw calls, budget ${BUDGET.calls}`);
  }
  assert.ok(city.street.info.nearChunks > 0 && city.far.info.nearChunks === 0, 'the street view has near chunks, the view from 300 units none');
  console.log(`PASS city budget: ${presets.map((k) => `${k} ${city[k].info.houseCalls} calls / ${(city[k].info.houseTriangles / 1e6).toFixed(2)}M`).join(', ')} (houses under ${BUDGET.calls} calls and ${BUDGET.triangles / 1e6}M triangles, shadow pass included)`);
  for (const [k, d] of Object.entries(swaps)) assert.ok(d.mean < SWAP_LIMIT, `swap ${k}: mean difference ${d.mean.toFixed(2)} under ${SWAP_LIMIT}`);
  console.log(`PASS near/far swap: ${Object.entries(swaps).map(([k, d]) => `${k} ${d.mean.toFixed(2)}/255`).join(', ')} (limit ${SWAP_LIMIT})`);
  assert.deepEqual(errors, []);
  console.log('PASS zero page or shader errors');
} finally {
  await browser.close();
}
