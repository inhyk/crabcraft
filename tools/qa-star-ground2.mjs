// World II ground (2026-10-28): moonlit paving, the night ground, the meadow, the field boulders and the story spots.
// Checks presence and counts, that no old grid flagstone or kit rock is left, that the browser's ground equals the
// server's baked ground, that the grass stays off the ways, zero page/shader errors at high and low quality, and
// saves close-ups to tmp/qa/star-ground2-*.png.
//   CC_QA_URL=http://127.0.0.1:5614 node tools/qa-star-ground2.mjs
import {launchBrowser} from './lib/browser.mjs';
import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';

await mkdir('tmp/qa', {recursive: true});
const base = process.env.CC_QA_URL || 'http://127.0.0.1:5192';
const baked = JSON.parse(await readFile('public/world/collision-w2.json', 'utf8'));
const browser = await launchBrowser({headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio']});
const views = {street: [0, 40, 0, .38, 10], fountain: [0, 62, .4, .5, 12], trail: [-30, 13, 2.2, .38, 8], meadow: [-60, -5, 1.57, .4, 8], crater: [-36, -22, 0, .6, 13], camp: [44, -57, 2.6, .3, 7], boat: [-93, 31, -1.9, .35, 9]};

async function run(quality) {
  const page = await browser.newPage({viewport: {width: 1280, height: 720}}), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && /shader|program|WebGL|GL_/i.test(m.text())) errors.push(m.text().slice(0, 300)); });
  await page.addInitScript((q) => { localStorage.setItem('cc.hintsSeen', '1'); localStorage.setItem('cc.quality', q); }, quality);
  await page.goto(base + '/?screen=game');
  await page.locator('.launch-notice-start').click();
  await page.waitForFunction(() => window.app?.current?.game?.loaded && !document.querySelector('.loading'), null, {timeout: 180000});
  await page.evaluate(() => { const g = window.app.current.game; g.god = true; g.creatorTravel = true; g.world2.go(2); });
  await page.waitForFunction(() => window.app.current.game.world2.chapter === 2, null, {timeout: 120000});
  await page.waitForTimeout(1500);
  const r = await page.evaluate((h64) => {
    const g = window.app.current.game, w = g.world2, root = w.root;
    const ground = root.getObjectByName('star-island-ground'), paving = root.getObjectByName('world2-moonlit-paving');
    const meadow = root.getObjectByName('starhaven-meadow'), fields = root.getObjectByName('starhaven-fields'), forest = root.getObjectByName('star-island-forests');
    // Old primitives in this lane's scope: grid flagstones and the kit's medium rocks.
    const old = [];
    root.traverse((o) => { if (o.name === 'world2-flagstone-paths' || o.name === 'weathered-bevelled-paving') old.push(o.name); });
    for (const m of forest.children) if (m.material?.name === 'Rocks') old.push('kit rocks');
    // The server's baked ground against the browser's, vertex by vertex.
    const bin = atob(h64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const serverH = new Float32Array(bytes.buffer), pos = ground.geometry.attributes.position;
    let worst = 0;
    for (let i = 0; i < pos.count; i++) worst = Math.max(worst, Math.abs(pos.getY(i) - serverH[i]));
    // Grass never grows on the ways: sample along the avenue, the square, the lanes and the trails.
    const mk = meadow.userData.mask, covers = paving.userData.covers;
    let onWays = 0, sampled = 0;
    for (let z = -50; z < 90; z += .7) for (let x = -26; x <= 26; x += .7) {
      if (!covers(x, z)) continue;
      const i = Math.floor((x - mk.minX) / mk.cell), j = Math.floor((z - mk.minZ) / mk.cell);
      sampled++; if (mk.data[(j * mk.width + i) * 4] > 0) onWays++;
    }
    for (const t of w.trails) for (let k = 1; k < t.length; k++) for (let s = 0; s <= 1; s += .05) {
      const x = t[k - 1][0] + (t[k][0] - t[k - 1][0]) * s, z = t[k - 1][1] + (t[k][1] - t[k - 1][1]) * s;
      const i = Math.floor((x - mk.minX) / mk.cell), j = Math.floor((z - mk.minZ) / mk.cell);
      sampled++; if (mk.data[(j * mk.width + i) * 4] > 0) onWays++;
    }
    return {
      groundMaterial: ground.material.name, vertices: pos.count, worst,
      paving: paving?.children[0]?.userData && root.getObjectByName('starhaven-paving-surface') ? root.getObjectByName('world2-moonlit-paving').userData.stats : null,
      coversAvenue: covers(0, 30), coversField: covers(40, -60), coversFountain: covers(0, 55),
      meadowInstances: meadow.geometry.instanceCount, meadowMaterial: meadow.material.name, onWays, sampled,
      fields: fields.userData, old,
      stories: ['starhaven-camp-canvas', 'starhaven-skiff-hull', 'starhaven-camp-brass', 'starhaven-camp-flame'].filter((n) => !root.getObjectByName(n)),
      boulders: !!root.getObjectByName('starhaven-field-boulders'), moonflowers: root.getObjectByName('starhaven-moonflowers').count,
      quality: g.engine.quality,
    };
  }, baked.ground.h);
  const shots = {};
  for (const [name, [x, z, yaw, pitch, dist]] of Object.entries(views)) {
    await page.evaluate(([x, z, yaw, pitch, dist]) => {
      // Residents wander in and out of frame (their gear alone is a dozen draws): count the world, not them (nor the roaming enemies).
      const g = window.app.current.game; for (const u of [...g.npcs.map((n) => n.unit), ...g.townsfolk.map((t) => t.unit), ...g.enemies.map((e) => e.unit)]) u.hidden = true; g.player.unit.teleport(g.world, x, z, yaw + Math.PI);
      g.follow.cut(); g.follow.yaw = yaw; g.follow.pitch = pitch; g.follow.distance = dist;
    }, [x, z, yaw, pitch, dist]);
    await page.waitForTimeout(900);
    if (quality === 'high' || name === 'street' || name === 'meadow') await page.screenshot({path: `tmp/qa/star-ground2-${quality}-${name}.png`});
    shots[name] = await page.evaluate(() => window.app.engine.renderer.info.render.calls);
  }
  await page.close();
  return {...r, shots, errors};
}

try {
  const high = await run('high');
  console.log('high', JSON.stringify(high));
  const low = await run('low');
  console.log('low', JSON.stringify({quality: low.quality, meadowInstances: low.meadowInstances, shots: low.shots, errors: low.errors}));
  assert.equal(high.groundMaterial, 'starhaven-night-ground');
  assert.equal(high.vertices, 141 * 161);
  assert.equal(high.worst, 0, 'browser ground differs from the server bake');
  assert.ok(high.paving && high.paving.segments >= 20 && high.paving.pads === 2 && high.paving.holes === 1, 'moonlit paving present (the square and the keepers\' ring floor)');
  assert.ok(high.coversAvenue && !high.coversField && !high.coversFountain, 'paving covers() agrees with the layout');
  assert.equal(high.meadowMaterial, 'starhaven-meadow-grass');
  assert.ok(high.meadowInstances > 25000, 'meadow density at high quality');
  assert.ok(high.sampled > 3000 && high.onWays === 0, `grass on the ways: ${high.onWays}`);
  assert.deepEqual(high.old, [], 'old grid flagstones or kit rocks remain');
  assert.ok(high.boulders && high.fields.boulders >= 50 && high.fields.solidBoulders >= 20, 'field boulders');
  assert.ok(high.fields.shards === 10 && high.moonflowers >= 200 && high.fields.accents >= 150, 'shards, moon-flowers, kit accents');
  assert.deepEqual(high.stories, [], 'story props');
  assert.equal(low.quality, 'low');
  assert.ok(low.meadowInstances < high.meadowInstances / 2, 'low quality grows less grass');
  for (const v of Object.keys(views)) assert.ok(low.shots[v] <= high.shots[v] + 2, `low quality draws no more than high at ${v}`);
  assert.deepEqual(high.errors, []);
  assert.deepEqual(low.errors, []);
  console.log('PASS: moonlit paving, night ground equal to the server bake, meadow off the ways, boulders, shards, moon-flowers, camp and skiff; no old flagstones or kit rocks; zero errors at high and low quality');
} finally { await browser.close(); }
