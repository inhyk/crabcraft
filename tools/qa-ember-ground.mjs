// World V ground lane QA (emberWilds.ts and friends): rocks, crystals, plants, paving, the forge court, the miners'
// camp and the quest guidance are built for chapter 5 only; nothing stands in a lava zone; every solid keeps the quest
// points, NPC spots, enemy homes, the spawn and the portals clear; the paving follows EMBER_PATHS (no other road
// layout); the gold crumb dots are gone in World V (EmberGuide's brass studs instead) and still there elsewhere;
// the cut-basalt paving reads lighter than the ground; zero page or shader errors at high and low quality.
//
// Usage: CC_QA_BASE=http://127.0.0.1:5652 node tools/qa-ember-ground.mjs
//   CC_QA_OUT=tmp/qa   where the PNGs go       CC_QA_QUALITY=high,low   qualities to run (default both)
import assert from 'node:assert/strict';
import {launchBrowser} from './lib/browser.mjs';
import {mkdir} from 'node:fs/promises';

const base = process.env.CC_QA_BASE ?? 'http://127.0.0.1:5652';
const out = process.env.CC_QA_OUT ?? 'tmp/qa';
const qualities = (process.env.CC_QA_QUALITY ?? 'high,low').split(',');
await mkdir(out, {recursive: true});
assert.ok(qualities.length);

const SHOTS = {
  east: {x: 60, z: -5, yaw: -1.57, pitch: .3, distance: 26},
  west: {x: -60, z: -5, yaw: 1.57, pitch: .3, distance: 26},
  organ: {x: 62, z: -40, yaw: -1.2, pitch: .15, distance: 22},
};

const browser = await launchBrowser({headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio']});
let failed = 0;
try {
  for (const quality of qualities) {
    const errors = [];
    const p = await browser.newPage({viewport: {width: 1280, height: 800}});
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => { if (m.type() === 'error' && /THREE|WebGL|shader|GL_/i.test(m.text())) errors.push(m.text().slice(0, 600)); });
    p.setDefaultTimeout(60000);
    await p.addInitScript(([q]) => {
      localStorage.setItem('cc.spec', JSON.stringify({race: 'human', sex: 'male', classId: 'mage', shell: 0, crest: 0, led: 0, name: 'Ground QA'}));
      localStorage.setItem('cc.hintsSeen', '1'); localStorage.setItem('cc.language', 'ko'); localStorage.setItem('cc.quality', q);
    }, [quality]);
    await p.goto(base + '/?screen=game');
    await p.locator('.launch-notice-start').click();
    await p.waitForFunction(() => window.app?.current?.game?.loaded && !document.querySelector('.loading'), null, {timeout: 180000});
    // World I first: the shared gold crumbs still lead the way there.
    await p.evaluate(() => { const g = window.app.current.game; g.god = true; g.player.nextSwing = Infinity; g.creatorTravel = true; });
    await p.waitForTimeout(1500);
    const w1 = await p.evaluate(() => { const o = window.app.current.game.objective; return {ember: o.ember, studs: !!o.emberGuide?.studs?.visible}; });
    await p.evaluate(() => window.app.current.game.world2.go(5));
    await p.waitForFunction(() => window.app.current.game.world2.chapter === 5 && !document.querySelector('.loading'), null, {timeout: 180000});
    await p.waitForFunction(() => window.app.current.game.world2.fifth.wilds?.root.userData.camp > 0, null, {timeout: 60000}).catch(() => {});
    await p.waitForTimeout(3000);

    const r = await p.evaluate(async () => {
      const g = window.app.current.game, w = g.world2, fifth = w.fifth, wilds = fifth.wilds;
      const lay = await import('/src/game/emberGroundLayout.ts'), quests = await import('/src/game/frontierQuests.ts'), realm = await import('/src/game/realmLayout.ts');
      const res = {hasWilds: !!wilds, sixthWilds: !!w.sixth.root.getObjectByName('ember-wilds'), meshes: 0, rocks: wilds?.root.userData.rocks ?? null, camp: wilds?.root.userData.camp ?? 0, blocked: [], lavaHits: [], paving: null, pathSegs: 0};
      wilds.root.traverse(o => { if (o.isMesh || o.isPoints) res.meshes++; });
      // Features and solids: out of the lava; quest points, NPC spots, enemy homes, spawn and portals clear.
      const solids = lay.emberSolids();
      const points = [...Object.entries(quests.FRONTIER_POINTS['5']).map(([k, [x, z]]) => [k, x, z, 4]), ...realm.FRONTIER_TOWN.map(([x, z], i) => ['npc' + i, x, z, 3]),
        ['spawn', fifth.spawn.x, fifth.spawn.z, 4], ['next', fifth.next.root.position.x, fifth.next.root.position.z, 4]];
      for (const s of solids) {
        for (const [k, x, z, pad] of points) if (Math.hypot(x - s.x, z - s.z) < s.r + pad) res.blocked.push(`${k}@${s.x.toFixed(1)},${s.z.toFixed(1)}`);
        for (const zn of fifth.lava.zones) if (Math.hypot(s.x - zn.x, s.z - zn.z) < zn.radius + s.r) res.lavaHits.push(`${s.x.toFixed(1)},${s.z.toFixed(1)}`);
      }
      for (const e of g.enemies) { const h = e.unit.home ?? e.home; if (!h) continue; for (const s of solids) if (Math.hypot(h.x - s.x, h.z - s.z) < s.r + 4) res.blocked.push('enemy@' + h.x.toFixed(0) + ',' + h.z.toFixed(0)); }
      for (const path of lay.EMBER_PATHS) res.pathSegs += path.points.length - 1;
      res.paving = wilds.root.getObjectByName('world5-ember-paving')?.userData.stats ?? null;
      // Guidance: a far goal, the crab standing still; the crumbs are hidden and the brass studs show.
      const o = g.objective;
      res.guide = {ember: o.ember, crumbs: o.crumbs.visible, studs: !!o.emberGuide?.studs.visible, arrow: !!o.emberGuide?.arrow.visible};
      return res;
    });
    // Paving against ground: a camera straight down on the avenue (8 m wide) at z -10, road in the middle third.
    await p.evaluate(() => { window.app.ui.style.visibility = 'hidden'; });
    await p.evaluate(() => { const g = window.app.current.game; g.player.unit.teleport(g.world, 0, -10, 0); g.follow.yaw = 0; g.follow.pitch = 1.5; g.follow.distance = 16; g.follow.cut(); });
    await p.waitForTimeout(2200);
    const shot = await p.screenshot({path: `${out}/ember-ground-${quality}-paving.png`});
    const vals = await p.evaluate(async (b64) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const med = (x0, x1, y0, y1) => { const d = x.getImageData(Math.round(x0 * c.width), Math.round(y0 * c.height), Math.round((x1 - x0) * c.width), Math.round((y1 - y0) * c.height)).data, v = []; for (let i = 0; i < d.length; i += 4) v.push(.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]); v.sort((a, b) => a - b); return Math.round(v[v.length >> 1]); };
      // The crab and the guide stand in the middle: sample the road above and below them, the ground at both sides.
      return {road: Math.round((med(.42, .58, .05, .3) + med(.42, .58, .75, .95)) / 2), ground: Math.round((med(.02, .12, .1, .9) + med(.88, .98, .1, .9)) / 2)};
    }, shot.toString('base64'));
    // Elsewhere the shared crumbs come back: World VI.
    await p.evaluate(() => window.app.current.game.world2.go(6));
    await p.waitForFunction(() => window.app.current.game.world2.chapter === 6 && !document.querySelector('.loading'), null, {timeout: 180000});
    await p.waitForTimeout(1500);
    const w6 = await p.evaluate(() => { const o = window.app.current.game.objective; return {ember: o.ember, studs: !!o.emberGuide?.studs?.visible}; });
    await p.evaluate(() => window.app.current.game.world2.go(5));
    await p.waitForFunction(() => window.app.current.game.world2.chapter === 5 && !document.querySelector('.loading'), null, {timeout: 180000});
    await p.waitForTimeout(1500);

    console.log(`[${quality}]`, JSON.stringify({rocks: r.rocks, meshes: r.meshes, camp: r.camp, paving: r.paving, pathSegs: r.pathSegs, guide: r.guide, w1, w6, values: vals}));
    const check = (ok, msg) => { if (!ok) { failed++; console.log('FAIL', quality, msg); } else console.log('ok  ', quality, msg); };
    check(r.hasWilds && !r.sixthWilds, 'ground lane exists in World V only');
    check(r.rocks && r.rocks.rockTriangles > 40000 && r.rocks.features >= 40, `rocks built (${r.rocks?.features} features, ${r.rocks?.rockTriangles} triangles)`);
    check(r.rocks.skippedOnLava === 0, `no feature in a lava zone (${r.rocks.skippedOnLava} skipped)`);
    check(r.camp > 0, `miners' camp loaded (${r.camp} batches)`);
    check(r.meshes <= 16, `ground lane draws in ${r.meshes} meshes (<= 16)`);
    check(r.paving && r.paving.segments === r.pathSegs, `paving follows EMBER_PATHS (${r.paving?.segments} of ${r.pathSegs} segments)`);
    check(r.blocked.length === 0, 'quest points, NPCs, enemy homes, spawn and portals clear ' + r.blocked.slice(0, 6).join(' '));
    check(r.lavaHits.length === 0, 'no solid in a lava zone ' + r.lavaHits.slice(0, 4).join(' '));
    check(r.guide.ember && !r.guide.crumbs, `World V hides the gold crumbs (ember ${r.guide.ember}, crumbs ${r.guide.crumbs}, studs ${r.guide.studs}, arrow ${r.guide.arrow})`);
    check(!w1.ember && !w1.studs && !w6.ember && !w6.studs, 'other worlds keep their own guidance (no ember studs in W1 or W6)');
    // Albedo bands (style-w5.md: paths 105-130, ground 75-95) depend on ember-sky's exposure; the lane owns the order.
    check(vals.road >= vals.ground + 12, `paving lighter than the ground (road ${vals.road}, ground ${vals.ground}; bands 105-130 / 75-95)`);
    for (const [name, c] of Object.entries(SHOTS)) {
      await p.evaluate(c => { const g = window.app.current.game; g.player.unit.teleport(g.world, c.x, c.z, c.yaw - Math.PI); g.follow.yaw = c.yaw; g.follow.pitch = c.pitch; g.follow.distance = c.distance; g.follow.cut(); }, c);
      await p.waitForTimeout(1800);
      await p.screenshot({path: `${out}/ember-ground-${quality}-${name}.png`});
    }
    check(errors.length === 0, `page and shader errors: ${errors.length} ${errors.slice(0, 3).join(' | ')}`);
    await p.close();
  }
} finally { await browser.close(); }
console.log(failed ? `FAIL ${failed}` : 'PASS');
process.exit(failed ? 1 : 0);
