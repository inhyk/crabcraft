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
  // The village's 56 boxes (17 kit buildings and the chapel's bell tower; benches, the stall, the cart, two terrace tables, the forge yard's
  // bench and weapon stand, two wagons and 14 garden fences; six woodpiles; seven door steps; snowVillageLayout.ts), the seven rock outcrops of src/sim/world/snowGround.ts,
  // 14 from frostThroneLayout.ts (the throne dais, curtain wall, gatehouse and keep, the lean-to, its woodpile and sled, six overlook parapet runs and the ridge camp's chest)
  // and the open fields' 18 (six fence segments of the miners' trail, the ore wagon, two crates and nine logs; snowFieldsLayout.ts).
  assert.equal(snowData.shapes.filter(s => s[0] === 1).length, 56 + 7 + 14 + 18);
  const fountain = snowData.shapes.find(s => s[0] === 0 && s[1] === -13 && s[2] === 65);
  assert.ok(fountain);
  // Frostlight's own street plan (src/sim/world/snowLayout.ts): nothing solid stands on the centreline of any street, lane or road.
  const plan = await import((await bundle('src/sim/world/snowLayout.ts', 'snow-layout')).url);
  // A metre over the ground in steps of at most a metre, so the ray never dips into a rise.
  for (const w of plan.FROST_WAYS) for (let k = 1; k < w.points.length; k++) {
    const [ax, az] = w.points[k - 1], [bx, bz] = w.points[k], n = Math.ceil(Math.hypot(bx - ax, bz - az));
    for (let i = 0; i < n; i++) {
      const x0 = ax + (bx - ax) * i / n, z0 = az + (bz - az) * i / n, x1 = ax + (bx - ax) * (i + 1) / n, z1 = az + (bz - az) * (i + 1) / n;
      assert.equal(snow.raycastSolid({x:x0,y:snow.heightAt(x0,z0)+1,z:z0},{x:x1,y:snow.heightAt(x1,z1)+1,z:z1}), null, `${w.id} segment ${k} is open`);
    }
  }
  const y = (fountain[4] + fountain[5]) / 2;
  assert.notEqual(snow.raycastSolid({x:-17,y,z:65}, {x:-9,y,z:65}), null);
  assert.equal(snow.raycastSolid({x:-17,y:fountain[5]+1,z:65}, {x:-9,y:fountain[5]+1,z:65}), null);
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
