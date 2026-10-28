// World V forge town QA (emberTown.ts): the town is a ring of six houses facing one furnace yard with the blast furnace
// in its middle (not World VI's straight cross), built for chapter 5 only from a handful of draw calls; iron roofs on
// the two forges only; lantern posts and banners only at the yard, the quay and the sanctuary gate, lanterns on every
// house; none of the old primitives in that scope are left; the solids (houses included, World V only) keep every quest
// point, NPC spot, the spawn, the portals, the roads, a walk round the furnace and the lava clear, and World VI keeps its
// six street-house boxes; zero page or shader errors at high and low quality.
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
  furnace: {x: 3, z: 72, yaw: .2, pitch: .12, distance: 10},
  smithy: {x: -21.3, z: 45.1, yaw: .96, pitch: .2, distance: 12},
  yard: {x: 0, z: 55, yaw: .5, pitch: .5, distance: 40},
  quay: {x: 2, z: 122, yaw: 2.7, pitch: .35, distance: 24},
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
        // Not this lane's: the town group itself, the portals and the quest props (waystones are drawn by DawnRequests).
        let skip = false; for (let q = o; q; q = q.parent) if (q === forge.root || q === fifth.back.root || q === fifth.next?.root || q.name === 'Island village requests') skip = true; if (skip) return;
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
      // Solids: every quest point, NPC spot, the spawn, the two portals, the roads and a walk round the furnace stay clear.
      const solids = plan.forgeSolids(), ground = await import('/src/game/emberGroundLayout.ts');
      const inside = (s, x, z, pad) => { if (s.r !== undefined) return Math.hypot(x - s.x, z - s.z) < s.r + pad; const c = Math.cos(s.yaw ?? 0), n = Math.sin(s.yaw ?? 0), dx = x - s.x, dz = z - s.z; return Math.abs(dx * c - dz * n) < s.hx + pad && Math.abs(dx * n + dz * c) < s.hz + pad; };
      const points = [...Object.entries(quests.FRONTIER_POINTS['5']).map(([k, [x, z]]) => [k, x, z]), ...realm.FRONTIER_TOWN.map(([x, z], i) => ['npc' + i, x, z]), ['spawn', fifth.spawn.x, fifth.spawn.z], ['next', fifth.next.root.position.x, fifth.next.root.position.z]];
      for (const s of solids) {
        for (const [k, x, z] of points) if (inside(s, x, z, 1.2)) res.blocked.push(k + '@' + s.x.toFixed(1) + ',' + s.z.toFixed(1));
        for (const p of ground.EMBER_PATHS) for (let k = 1; k < p.points.length; k++) {
          const [ax, az] = p.points[k - 1], [bx, bz] = p.points[k], len = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / len, nz = (bx - ax) / len;
          for (let t = 0; t <= len; t += 1) for (const o of [-1, 0, 1]) { const x = ax + (bx - ax) * t / len + nx * o * (p.width / 2 - .3), z = az + (bz - az) * t / len + nz * o * (p.width / 2 - .3); if (inside(s, x, z, .1)) res.blocked.push(`road ${ax},${az} t${t}`); }
        }
        // Through the yard: from the harbour mouth round either side of the furnace to the north mouth.
        for (const side of [-1, 1]) for (let a = 0; a <= 180; a += 3) { const [x, z] = plan.yardAt(side * a, 15); if (inside(s, x, z, .8)) res.blocked.push(`yard walk ${side * a}`); }
        for (const z of [34, 38, 42, 46, 74, 78, 82, 86]) if (inside(s, 0, z, .8)) res.blocked.push('yard mouth z' + z);
        for (const zn of fifth.lava.zones) if (Math.hypot(s.x - zn.x, s.z - zn.z) < zn.radius + 1) res.lavaHits.push(s.x + ',' + s.z);
      }
      // Same solids in the live collision (the browser's World V collider set comes from layoutFrontier(5)).
      const col = realm.layoutFrontier(5), col6 = realm.layoutFrontier(6);
      res.colliders = {w5: col.shapes.length, w6: col6.shapes.length, solids: solids.length};
      res.smoke = !!forge.root.getObjectByName('ember-town-smoke'); res.sparks = !!forge.root.getObjectByName('ember-town-sparks');
      // The plan: houses ring the furnace and face it; iron roofs on the two forges only; lamps and banners clustered.
      const C = plan.FORGE_C;
      res.ring = plan.FORGE_HOUSES.map(h => { const [fx, fz] = plan.forgeLocal(h, 0, 1), r = Math.hypot(h.x - C.x, h.z - C.z); return {role: h.role, r: +r.toFixed(1), faces: Math.hypot(fx - C.x, fz - C.z) < r - .9, roof: h.roof}; });
      const clusters = [[C.x, C.z, C.r + 4], [0, 118, 30], [0, -45, 10]];
      res.loose = [...plan.FORGE_LANTERNS, ...plan.FORGE_BANNERS].filter(([x, z]) => !clusters.some(([cx, cz, r]) => Math.hypot(x - cx, z - cz) <= r)).map(p => p.join(','));
      res.plan = {lanterns: plan.FORGE_LANTERNS.length, banners: plan.FORGE_BANNERS.length};
      // World VI keeps its six street-house boxes (x = +-30, z = 38/56/74); World V has none of them.
      const boxAt = (c, x, z) => c.shapes.some(sh => sh.kind === 1 && Math.abs(sh.b.x - x) < .01 && Math.abs(sh.b.z - z) < .01);
      res.w6Houses = [-30, 30].flatMap(x => [38, 56, 74].map(z => boxAt(col6, x, z))).filter(Boolean).length;
      res.w5OldHouses = [-30, 30].flatMap(x => [38, 56, 74].map(z => boxAt(col, x, z))).filter(Boolean).length;
      return res;
    });

    console.log(`[${quality}]`, JSON.stringify({stats: r.stats, forgeMeshes: r.forgeMeshes, names: r.forgeNames, tris: r.tris, leftovers: r.leftovers, colliders: r.colliders}));
    const check = (ok, msg) => { if (!ok) { failed++; console.log('FAIL', quality, msg); } else console.log('ok  ', quality, msg); };
    check(r.hasForge && !r.sixthForge, 'forge town exists in World V only');
    check(r.stats.houses === 6 && r.stats.chimneys === 6 && r.stats.forgeMouths === 2 && r.stats.wallLanterns === 6, `six houses with chimneys and wall lanterns, two forge mouths (${r.stats.houses}/${r.stats.chimneys}/${r.stats.wallLanterns}/${r.stats.forgeMouths})`);
    check(r.stats.furnace === 1, 'the blast furnace stands in the yard');
    check(r.ring.every(h => h.faces && h.r > 30 && h.r < 40), 'six houses ring the yard and face the furnace ' + JSON.stringify(r.ring.map(h => h.role + ':' + h.r)));
    check(r.ring.filter(h => h.roof === 'iron').map(h => h.role).sort().join() === 'armourer,smithy', 'iron roofs on the two forges only');
    check(r.stats.lanterns === r.plan.lanterns && r.stats.banners === r.plan.banners && r.loose.length === 0, `lanterns ${r.stats.lanterns}, banners ${r.stats.banners}, all at the yard, quay or sanctuary gate ${r.loose.join(' ')}`);
    check(r.w6Houses === 6 && r.w5OldHouses === 0, `World VI keeps its 6 street-house boxes (${r.w6Houses}), World V has none (${r.w5OldHouses})`);
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
