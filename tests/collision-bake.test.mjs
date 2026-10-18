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
    assert.equal(disk.source, source, `${w}: source changed; run node tools/bake-collision.mjs`);
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
    assert.equal(d.rayHitMismatch, 0, `${w}: line of sight disagrees`);
    for (const k of ['height', 'resolve', 'ray']) assert.ok(d[k] <= 1e-6, `${w}: ${k} differs by ${d[k]}`);
    console.log(`# ${w}: ${JSON.stringify(d)}`);
  }
});

// Graphic settings may reduce decoration, never the tree/rock walls used by the server.
test('low and high quality share the same solid collision and queries', async () => {
  const { url } = await bundle('src/game/collisionBake.ts', 'quality-layouts');
  const { layoutWorlds } = await import(url);
  const high = layoutWorlds(glbPieceNames(), 'high'), low = layoutWorlds(glbPieceNames(), 'low');
  for (const w of WORLDS) {
    assert.deepEqual(low[w].col.shapes, high[w].col.shapes, `${w}: solids depend on quality`);
    const pts = samplePoints(w, readBaked(w));
    assert.deepEqual(runQueries(low[w], pts), runQueries(high[w], pts), `${w}: queries depend on quality`);
  }
});

test('the standalone collision loader has no render, asset or Node dependencies', async () => {
  const { inputs, imports } = await bundle('src/sim/world/baked.ts', 'boundary');
  assert.ok(inputs.every(p => p.startsWith('src/sim/world/')), inputs.join(', '));
  assert.deepEqual(imports, []);
});

// Independent known landmarks catch accidentally aliasing snow to Dawnreach or restoring the removed fountain.
test('current Dawnreach and Frostlight geometry keep distinct landmarks and bounds', async () => {
  const sim = await loadSim();
  const dawn = sim.loadBakedWorld(readBaked('w3'));
  const snowData = readBaked('w4'), snow = sim.loadBakedWorld(snowData);
  assert.equal(snowData.ground.kind, 'snow');
  assert.deepEqual(snowData.bounds, { cz: 2, rx: 128, rz: 155, max: .8 });
  assert.equal(snow.heightAt(0, -78), 19);
  assert.equal(snow.heightAt(0, 70), 5);
  assert.equal(dawn.heightAt(0, 70), 4);
  assert.equal(dawn.collision.shapes.some(s => s.kind === 0 && s.c.x === -11 && s.c.z === 53), false);
  assert.equal(snowData.shapes.filter(s => s[0] === 1).length, 6);
  const fountain = snowData.shapes.find(s => s[0] === 0 && s[1] === -10 && s[2] === 56);
  assert.ok(fountain);
  const y = (fountain[4] + fountain[5]) / 2;
  assert.notEqual(snow.raycastSolid({x:-14,y,z:56}, {x:-6,y,z:56}), null);
  assert.equal(snow.raycastSolid({x:-14,y:fountain[5]+1,z:56}, {x:-6,y:fountain[5]+1,z:56}), null);
  const out = {x:0,y:0,set(x,y){this.x=x;this.y=y;return this;}};
  snow.resolveCollision(200, 2, .5, out);
  assert.ok(Math.abs(out.x - 102.4) < 1e-6);
  assert.equal(out.y, 2);
});

test('stale checking rejects collider, height and topology fault probes', async () => {
  const sim = await loadSim(), data = readBaked('w4');
  for (const mutate of [
    b => b.shapes[0][1] += .001,
    b => b.shapes.pop(),
    b => b.ground.kind = 'dawn',
    b => b.bounds.max = .81,
    b => b.cells.nx++,
  ]) {
    const corrupted = structuredClone(data);mutate(corrupted);
    assert.notEqual(bakedDifference(data, corrupted, sim.base64ToFloats), null);
  }
  const invalid = structuredClone(data);invalid.ground.kind = 'unknown';
  assert.throws(() => sim.loadBakedWorld(invalid), /unknown baked ground/);
});
