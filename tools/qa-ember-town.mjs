// World V forge town QA (emberTown.ts): the town, street and quay are built for chapter 5 only, from a handful of
// draw calls; none of the old primitives in that scope are left (box houses with cone roofs, brick instancing, thin lamp
// posts with octahedron bulbs, flag-quad banners, box stalls and benches, the box furnace); the new solids keep every
// quest point, NPC spot, the spawn, the portals and the lava clear; zero page or shader errors at high and low quality.
//
// Usage: CC_QA_BASE=http://127.0.0.1:5653 node tools/qa-ember-town.mjs
//   CC_QA_OUT=tmp/qa   where the PNGs go       CC_QA_QUALITY=high,low   qualities to run (default both)
import assert from 'node:assert/strict';
import {launchBrowser} from './lib/browser.mjs';
import {mkdir} from 'node:fs/promises';

const base = process.env.CC_QA_BASE ?? 'http://127.0.0.1:5653';
const out = process.env.CC_QA_OUT ?? 'tmp/qa';
const qualities = (process.env.CC_QA_QUALITY ?? 'high,low').split(',');
await mkdir(out, {recursive: true});

const SHOTS = {
  street: {x: 0, z: 45, yaw: .3, pitch: .12, distance: 9},
  smithy: {x: -24, z: 40, yaw: 1.9, pitch: .25, distance: 14},
  harbour: {x: 0, z: 92, yaw: 3.14, pitch: .3, distance: 30},
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
      localStorage.setItem('cc.spec', JSON.stringify({race: 'human', sex: 'male', classId: 'mage', shell: 0, crest: 0, led: 0, name: 'Town QA'}));
      localStorage.setItem('cc.hintsSeen', '1'); localStorage.setItem('cc.language', 'ko'); localStorage.setItem('cc.quality', q);
    }, [quality]);
    await p.goto(base + '/?screen=game');
    await p.locator('.launch-notice-start').click();
    await p.waitForFunction(() => window.app?.current?.game?.loaded && !document.querySelector('.loading'), null, {timeout: 180000});
    await p.evaluate(() => { const g = window.app.current.game; g.god = true; g.player.nextSwing = Infinity; g.creatorTravel = true; g.world2.go(5); });
    await p.waitForFunction(() => window.app.current.game.world2.chapter === 5 && !document.querySelector('.loading'), null, {timeout: 180000});
    await p.waitForTimeout(4000);

    const r = await p.evaluate(async () => {
      const g = window.app.current.game, w = g.world2, fifth = w.fifth, forge = fifth.forge;
      const plan = await import('/src/game/emberTownLayout.ts'), quests = await import('/src/game/frontierQuests.ts'), realm = await import('/src/game/realmLayout.ts');
      const res = {hasForge: !!forge, sixthForge: !!w.sixth.forge || !!w.sixth.root.getObjectByName('ember-forge-town'), stats: forge?.stats ?? null, forgeMeshes: 0, forgeNames: [], leftovers: {}, blocked: [], lavaHits: [], tris: forge?.root.userData.emberTownTris ?? 0};
      forge.root.traverse(o => { if (o.isMesh || o.isPoints) { res.forgeMeshes++; res.forgeNames.push(o.name); } });
      // Old primitives in this lane's scope, anywhere in World V outside the new town group.
      const left = {houseParts: 0, lampBulbs: 0, banners: 0, stalls: 0, furnace: 0};
      const v = new (fifth.root.position.constructor)();
      fifth.root.updateMatrixWorld(true);
      fifth.root.traverse(o => {
        if (!o.isMesh || forge.root.getObjectById(o.id) || o === forge.root) return;
        let inForge = false; for (let q = o; q; q = q.parent) if (q === forge.root) inForge = true; if (inForge) return;
        if (o.isInstancedMesh) { if (o.count && o.geometry.type === 'BoxGeometry' && o.count > 200 && o.count < 400) left.houseParts++; return; }
        o.getWorldPosition(v);
        const t = o.geometry.type;
        for (const h of plan.FORGE_HOUSES) if (Math.abs(v.x - h.x) < 9 && Math.abs(v.z - h.z) < 9 && v.y < 40) left.houseParts++;
        if (t === 'OctahedronGeometry' && Math.abs(Math.abs(v.x) - 6) < 1.5 && v.z > -64 && v.z < 84) left.lampBulbs++;
        if (t === 'OctahedronGeometry' && Math.abs(Math.abs(v.x) - 10) < 1.5) left.lampBulbs++;
        if (o.userData.banner) left.banners++;
        if (Math.abs(Math.abs(v.x) - 20) < 6 && Math.abs(v.z - 22) < 4) left.stalls++;
        if (Math.abs(v.x + 46) < 8 && Math.abs(v.z - 55) < 5) left.furnace++;
      });
      res.leftovers = left;
      // Solids: every quest point, NPC spot, the spawn, the two portals, the avenue and the side roads stay clear.
      const solids = plan.forgeSolids();
      const inside = (s, x, z, pad) => s.r !== undefined ? Math.hypot(x - s.x, z - s.z) < s.r + pad : Math.abs(x - s.x) < s.hx + pad && Math.abs(z - s.z) < s.hz + pad;
      const points = [...Object.entries(quests.FRONTIER_POINTS['5']).map(([k, [x, z]]) => [k, x, z]), ...realm.FRONTIER_TOWN.map(([x, z], i) => ['npc' + i, x, z]), ['spawn', fifth.spawn.x, fifth.spawn.z], ['next', fifth.next.root.position.x, fifth.next.root.position.z]];
      for (const s of solids) {
        for (const [k, x, z] of points) if (inside(s, x, z, 1.2)) res.blocked.push(k + '@' + s.x.toFixed(1) + ',' + s.z.toFixed(1));
        for (let z = -60; z <= 94; z += 2) if (inside(s, 0, z, .2) || inside(s, 3.9, z, .2) || inside(s, -3.9, z, .2)) res.blocked.push('avenue z' + z);
        for (const rz of [38, 56, 74]) for (let x = -23; x <= 23; x += 1) if (inside(s, x, rz, .1)) res.blocked.push('road ' + rz + ' x' + x);
        for (const zn of fifth.lava.zones) if (Math.hypot(s.x - zn.x, s.z - zn.z) < zn.radius + 1) res.lavaHits.push(s.x + ',' + s.z);
      }
      // Same solids in the live collision (the browser's World V collider set comes from layoutFrontier(5)).
      const col = realm.layoutFrontier(5), col6 = realm.layoutFrontier(6);
      res.colliders = {w5: col.shapes.length, w6: col6.shapes.length, solids: solids.length};
      res.smoke = !!forge.root.getObjectByName('ember-town-smoke'); res.sparks = !!forge.root.getObjectByName('ember-town-sparks');
      return res;
    });

    console.log(`[${quality}]`, JSON.stringify({stats: r.stats, forgeMeshes: r.forgeMeshes, names: r.forgeNames, tris: r.tris, leftovers: r.leftovers, colliders: r.colliders}));
    const check = (ok, msg) => { if (!ok) { failed++; console.log('FAIL', quality, msg); } else console.log('ok  ', quality, msg); };
    check(r.hasForge && !r.sixthForge, 'forge town exists in World V only');
    check(r.stats.houses === 6 && r.stats.chimneys === 6 && r.stats.forgeMouths === 5, `six houses with chimneys, five forge mouths (${r.stats.houses}/${r.stats.chimneys}/${r.stats.forgeMouths})`);
    check(r.stats.lanterns === 24 && r.stats.banners === 8, `24 avenue lanterns, 8 street banners (${r.stats.lanterns}/${r.stats.banners})`);
    check(r.stats.braziers >= 8 && r.stats.carts >= 5 && r.stats.blades >= 20, `braziers ${r.stats.braziers}, carts ${r.stats.carts}, blades ${r.stats.blades}`);
    check(r.stats.skipped === 0, `nothing placed in lava (${r.stats.skipped} skipped)`);
    check(r.forgeMeshes <= 8, `forge town draws in ${r.forgeMeshes} calls (<= 8)`);
    check(Object.values(r.leftovers).every(n => n === 0), 'no old primitives left in scope ' + JSON.stringify(r.leftovers));
    check(r.blocked.length === 0, 'quest points, NPCs, spawn, portals, avenue and side roads clear ' + r.blocked.slice(0, 6).join(' '));
    check(r.lavaHits.length === 0, 'no solid in a lava zone');
    check(quality === 'low' ? !r.sparks : r.sparks && r.smoke, `particles by quality (smoke ${r.smoke}, sparks ${r.sparks})`);

    await p.evaluate(() => { window.app.ui.style.visibility = 'hidden'; });
    for (const [name, c] of Object.entries(SHOTS)) {
      await p.evaluate(c => { const g = window.app.current.game; g.player.unit.teleport(g.world, c.x, c.z, c.yaw - Math.PI); g.follow.yaw = c.yaw; g.follow.pitch = c.pitch; g.follow.distance = c.distance; g.follow.cut(); }, c);
      await p.waitForTimeout(1800);
      await p.screenshot({path: `${out}/ember-town-${quality}-${name}.png`});
    }
    check(errors.length === 0, `page and shader errors: ${errors.length} ${errors.slice(0, 3).join(' | ')}`);
    await p.close();
  }
} finally { await browser.close(); }
console.log(failed ? `FAIL ${failed}` : 'PASS');
process.exit(failed ? 1 : 0);
