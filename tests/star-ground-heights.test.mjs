// World II's shaped countryside (2026-10-28) must leave every gameplay point on its old ground: the town, the avenue,
// the arena, the objectives, residents, POIs and spawn keep their exact heights, and no new solid lands on a quest,
// resident or enemy point. Bundles the browser's own layout code (as tools/bake-collision.mjs does).
import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const ROOT = new URL('..', import.meta.url).pathname;
mkdirSync(join(ROOT, 'tmp'), {recursive: true});
const outfile = join(ROOT, 'tmp', 'star-ground-heights.mjs');
await esbuild.build({
  stdin: {contents: `export {buildStarHeights,starBaseHeight,starReliefKeep} from './src/game/world2Height.ts';
export {STAR_GRID,starSurfaceHeight} from './src/sim/world/ground.ts';
export {STAR_TOWN,STAR_WALKS,STAR_OBJECTIVES,STAR_TRAILS} from './src/game/world2Settlement.ts';
export {starBoulders,starEnemyHomes,STAR_STORY_SOLIDS,starCraterShards} from './src/game/starFieldSpots.ts';`, resolveDir: ROOT, loader: 'ts'},
  bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'error', define: {'import.meta.env': '{"BASE_URL":"./"}'},
});
const m = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
const {nx, nz, step, minX, minZ} = m.STAR_GRID;
const shaped = m.buildStarHeights(), base = new Float32Array(nx * nz);
for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) base[j * nx + i] = m.starBaseHeight(minX + i * step, minZ + j * step);

// Every place the game puts something or someone.
const points = [
  ...Object.values(m.STAR_TOWN), ...m.STAR_WALKS, ...Object.values(m.STAR_OBJECTIVES),
  [0, 86], [0, -75], [0, -41], [-3, -55], [3, -55], [-14, -60], [14, -60], [-6, 49], [-6, 61], [6, 49], [6, 61],
  [-70, 5], [70, -15], [25, 55], [-25, 36], [-20, 58], [20, 35], [0, -48], [0, -45], [0, -22],
];
// The town, the avenue and the arena floor, sampled densely, off the grid's vertices too.
for (let z = 3.3; z < 100; z += 1.7) for (let x = -53.7; x < 54; x += 1.9) points.push([x, z]);
for (let z = -99.6; z < 105; z += 1.3) for (let x = -8.8; x <= 8.8; x += 1.1) points.push([x, z]);
for (let k = 0; k < 400; k++) { const a = k * 2.39996, r = 23.5 * Math.sqrt(k / 400); points.push([Math.sin(a) * r, -75 + Math.cos(a) * r]); }
// Objectives' surroundings: the exploration medallions (13 m) and the quest props (4 m).
for (const [kind, [px, pz]] of Object.entries(m.STAR_OBJECTIVES)) {
  const R = kind.startsWith('explore-') ? 13 : 4;
  for (let k = 0; k < 120; k++) { const a = k * 2.39996, r = R * Math.sqrt(k / 120); points.push([px + Math.cos(a) * r, pz + Math.sin(a) * r]); }
}

test('every gameplay point keeps its exact pre-shaping height', () => {
  let worst = 0, where = null;
  for (const [x, z] of points) {
    const d = Math.abs(m.starSurfaceHeight(shaped, x, z) - m.starSurfaceHeight(base, x, z));
    if (d > worst) { worst = d; where = [x, z]; }
  }
  assert.equal(worst, 0, `height moved by ${worst} at ${where}`);
  assert.ok(points.length > 6000);
});

test('the countryside outside the play areas is actually shaped', () => {
  let moved = 0, maxRise = 0, maxDrop = 0;
  for (let k = 0; k < shaped.length; k++) { const d = shaped[k] - base[k]; if (Math.abs(d) > .25) moved++; maxRise = Math.max(maxRise, d); maxDrop = Math.min(maxDrop, d); }
  assert.ok(moved > 4000, `only ${moved} vertices moved`);
  assert.ok(maxRise > 4 && maxDrop < -2, `rise ${maxRise}, drop ${maxDrop}`);
});

test('no new solid stands on a quest, resident, POI or enemy point', () => {
  const solids = [...m.starBoulders().filter((b) => b.solid).map((b) => ({x: b.x, z: b.z, r: b.r * .82})), ...m.STAR_STORY_SOLIDS, {x: m.starCraterShards()[0].x, z: m.starCraterShards()[0].z, r: .85}];
  const keep = [...Object.values(m.STAR_TOWN), ...m.STAR_WALKS, ...Object.values(m.STAR_OBJECTIVES), ...m.starEnemyHomes(), [-70, 5], [70, -15], [0, 86]];
  for (const s of solids) for (const [x, z] of keep) assert.ok(Math.hypot(s.x - x, s.z - z) > s.r + 1.2, `solid at ${s.x},${s.z} on point ${x},${z}`);
  // Nor on a trail.
  for (const s of solids) for (const trail of m.STAR_TRAILS) for (let i = 1; i < trail.length; i++) {
    const [ax, az] = trail[i - 1], [bx, bz] = trail[i], dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((s.x - ax) * dx + (s.z - az) * dz) / (dx * dx + dz * dz)));
    assert.ok(Math.hypot(s.x - ax - dx * t, s.z - az - dz * t) > s.r + 1.2, `solid at ${s.x},${s.z} on a trail`);
  }
});
