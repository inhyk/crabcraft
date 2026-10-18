// The baked collision (public/world/collision-w*.json) must match the layout it was baked from, and the
// numbers-only loader in src/sim/world must answer exactly like the collision the browser builds.
import assert from 'node:assert/strict';
import test from 'node:test';
import { bundle, bakedDifference, compareRuns, glbPieceNames, loadSim, readBaked, runBake, runQueries, samplePoints, WORLDS } from '../tools/collision-bake-lib.mjs';

test('baked collision files are up to date with the layout and collision sources', async () => {
  const [{ baked, source }, sim] = await Promise.all([runBake(), loadSim()]);
  for (const w of WORLDS) {
    const disk = readBaked(w);
    const diff = bakedDifference(disk, baked[w], sim.base64ToFloats);
    assert.equal(diff, null, `public/world/collision-${w}.json is stale (${diff}). Run: node tools/bake-collision.mjs`);
    if (disk.source !== source) console.log(`# ${w}: source files changed since the bake, but its colliders did not`);
  }
});

test('the loader answers heightAt, resolveCollision and raycastSolid like the live collision', async () => {
  const [{ url }, sim] = await Promise.all([bundle('src/game/collisionBake.ts', 'bake-live'), loadSim()]);
  const live = (await import(url)).layoutWorlds(glbPieceNames());
  for (const w of WORLDS) {
    const data = readBaked(w);
    const loaded = sim.loadBakedWorld(data);
    assert.equal(loaded.collision.shapes.length, live[w].col.shapes.length);
    const pts = samplePoints(w, data);
    const d = compareRuns(runQueries(live[w], pts), runQueries(loaded, pts));
    assert.ok(pts.length >= 10000, `${w}: ${pts.length} points`);
    assert.deepEqual(d, { points: pts.length, height: 0, resolve: 0, ray: 0, rayHitMismatch: 0 }, `${w} differs`);
  }
});
