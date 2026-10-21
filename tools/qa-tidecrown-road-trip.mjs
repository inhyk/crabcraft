// The road trip between World I and Tidecrown on foot (Shift+W with the right mouse button steering, no teleport):
// from the chapel plaza up the King's Road across the zone line into Tidecrown at its arrival, facing up the road;
// three seconds standing at the arrival fire nothing; south across Tidecrown's return line back onto the King's Road
// in World I, facing south; north again for a second entry. The quest chapter never changes. Writes four 1600x900
// shots (the road before the King's Gate, the first view of Tidecrown, the return line, the arrival back in World I)
// to CC_QA_SHOTS (default tmp/qa/tidecrown-road).
// Usage: CC_QA_BASE=http://127.0.0.1:5251 node tools/qa-tidecrown-road-trip.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { launchBrowser } from './lib/browser.mjs';

const base = process.env.CC_QA_BASE ?? 'http://127.0.0.1:5241';
const shots = process.env.CC_QA_SHOTS ?? 'tmp/qa/tidecrown-road';
await mkdir(shots, { recursive: true });
const browser = await launchBrowser({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const errors = [];
try {
  const p = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && /shader|program|WebGL|merge|geometr|tidecrown|zone line/i.test(m.text())) errors.push(m.text().slice(0, 300)); });
  p.setDefaultTimeout(60000);
  await p.addInitScript(() => {
    localStorage.setItem('cc.spec', JSON.stringify({ race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'Road tripper' }));
    localStorage.setItem('cc.hintsSeen', '1');
    localStorage.setItem('cc.language', 'ko');
    localStorage.setItem('cc.quality', 'high');
  });
  await p.goto(base + '/?screen=game');
  await p.locator('.launch-notice-start').click();
  await p.waitForFunction(() => window.app?.current?.game?.loaded && !document.querySelector('.loading'), null, { timeout: 240000 });
  // A quiet road: no enemies to start a fight, which would hold the player at the line.
  const start = await p.evaluate(async () => {
    const g = window.app.current.game;
    g.god = true;
    for (const e of g.enemies) if (e.state !== 'gone') e.despawn();
    window.__L = await import('/src/world/layout.ts');
    window.__T = await import('/src/game/tidecrown/layout.ts');
    const [kings, back] = g.zoneLines.lines;
    window.__kings = kings; window.__back = back;
    const s0 = window.__L.kingsRoadAt(0);
    g.player.unit.teleport(g.world, s0.x, s0.z, Math.atan2(s0.dx, s0.dz));
    g.follow.yaw = g.player.unit.yaw + Math.PI; g.follow.cut();
    // Steering: aim the camera (and so the crab, while the right button is held) `ahead` along a polyline from the
    // nearest point at or past the last one.
    window.__steer = (pts, ahead) => {
      const u = g.player.unit, px = u.pos.x, pz = u.pos.z;
      const segs = [];
      let acc = 0;
      for (let i = 0; i < pts.length - 1; i++) { const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); segs.push({ a: pts[i], b: pts[i + 1], s: acc, len }); acc += len; }
      const last = window.__steerS ?? null;
      let best = Infinity, bestS = 0;
      for (const q of segs) {
        if (last !== null && (q.s + q.len < last - 4 || q.s > last + 30)) continue;
        const ex = q.b[0] - q.a[0], ez = q.b[1] - q.a[1], t = Math.max(0, Math.min(1, ((px - q.a[0]) * ex + (pz - q.a[1]) * ez) / (q.len * q.len)));
        const d = Math.hypot(px - q.a[0] - ex * t, pz - q.a[1] - ez * t);
        if (d < best) { best = d; bestS = q.s + q.len * t; }
      }
      window.__steerS = Math.max(last ?? 0, bestS);
      const s = Math.min(acc, window.__steerS + ahead);
      const q = segs.find((q) => q.s + q.len >= s) ?? segs[segs.length - 1], k = Math.min(1, (s - q.s) / q.len);
      const tx = q.a[0] + (q.b[0] - q.a[0]) * k, tz = q.a[1] + (q.b[1] - q.a[1]) * k;
      g.follow.yaw = Math.atan2(tx - px, tz - pz) - Math.PI;
      return { s: window.__steerS, total: acc, off: best };
    };
    const lineS = (() => { const pts = window.__L.KINGS_ROAD.points; let acc = 0; for (let i = 0; i < pts.length - 1; i++) { const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); if (pts[i + 1][1] <= window.__L.KINGS_ROAD_LINE.a[1]) return acc + (len * (pts[i][1] - window.__L.KINGS_ROAD_LINE.a[1])) / (pts[i][1] - pts[i + 1][1]); acc += len; } return acc; })();
    return { quest: g.quests.chapter, chapter: g.world2.chapter, lineS, plaza: [s0.x, s0.z], line: window.__L.KINGS_ROAD_LINE, ret: window.__L.KINGS_ROAD_RETURN, arrival: window.__T.TC_ARRIVAL, arrivalYaw: window.__T.TC_ARRIVAL_YAW, back: window.__T.TC_RETURN_LINE };
  });
  console.log(JSON.stringify(start));
  await p.waitForTimeout(800);

  const hold = async (on, sprint = true) => {
    if (on) { await p.mouse.move(800, 450); await p.mouse.down({ button: 'right' }); if (sprint) await p.keyboard.down('ShiftLeft'); await p.keyboard.down('KeyW'); }
    else { await p.keyboard.up('KeyW'); await p.keyboard.up('ShiftLeft'); await p.mouse.up({ button: 'right' }); }
  };
  /** Walk along `pts` until `stop` holds: { s } arc length reached, { z } that far south, or { line, fired } count. */
  const walk = async (pts, stop, { sprint = true, timeout = 90000, ahead = 5 } = {}) => {
    await hold(true, sprint);
    try {
      await p.waitForFunction(([pts, stop, ahead]) => {
        const st = window.__steer(pts, ahead), u = window.app.current.game.player.unit;
        return stop.line ? window[stop.line].fired >= stop.fired : stop.z !== undefined ? u.pos.z >= stop.z : st.s >= stop.s;
      }, [pts, stop, ahead], { timeout, polling: 'raf' });
    } finally { await hold(false); }
  };
  const settled = () => p.waitForFunction(() => !document.querySelector('.cc-blackout.on') && !document.querySelector('.tidecrown-loading'), null, { timeout: 60000 });
  const where = () => p.evaluate(() => { const g = window.app.current.game, u = g.player.unit; return { x: +u.pos.x.toFixed(2), z: +u.pos.z.toFixed(2), yaw: +u.yaw.toFixed(3), inTidecrown: g.world2.inTidecrown, chapter: g.world2.chapter, quest: g.quests.chapter, w1: g.world.root.visible, zone: g.zone, kings: window.__kings.fired, back: window.__back.fired }; });
  const yawGap = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const road = await p.evaluate(() => window.__L.KINGS_ROAD.points.map(([x, z]) => [x, z]));

  // 1. The plaza to the King's Gate on foot; a shot of the road before the arch.
  const t0 = Date.now();
  await p.evaluate(() => { window.__steerS = null; });
  await walk(road, { s: start.lineS - 15 });
  assert.equal((await where()).kings, 0, 'walking up the road does not fire the line');
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${shots}/1-w1-road-to-the-arch.png` });
  const walkMs = Date.now() - t0;

  // 2. Across the line: the fade, then Tidecrown at its arrival.
  let fired = 0;
  await walk(road, { line: '__kings', fired: 1 });
  fired = Date.now();
  await p.waitForFunction(() => window.app.current.game.world2.inTidecrown, null, { timeout: 60000 });
  const firstEntryMs = Date.now() - fired;
  await settled();
  const arrived = await where();
  const entryMs = await p.evaluate(() => Math.round(window.app.current.game.world2.tidecrownEntryMs));
  console.log(JSON.stringify({ walkMs, firstEntryMs, entryMs, arrived }));
  assert.ok(arrived.inTidecrown && !arrived.w1, 'in Tidecrown');
  assert.ok(Math.hypot(arrived.x - start.arrival[0], arrived.z - start.arrival[1]) < 0.6, `at the arrival: ${JSON.stringify(arrived)}`);
  assert.ok(yawGap(arrived.yaw, start.arrivalYaw) < 0.05, `facing up the road: ${arrived.yaw} vs ${start.arrivalYaw}`);
  assert.equal(arrived.quest, start.quest, 'the quest chapter is unchanged');
  assert.equal(arrived.chapter, start.chapter, 'the world chapter is unchanged');
  assert.deepEqual([arrived.kings, arrived.back], [1, 0], 'the King\'s Road line fired once, the return line not at all');
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${shots}/2-tidecrown-first-view.png` });
  assert.equal((await where()).zone, '타이드크라운', 'the zone reads Tidecrown');
  console.log(`PASS walked the King's Road into Tidecrown (${(walkMs / 1000).toFixed(1)} s to the arch); entry took ${firstEntryMs} ms from the line (${entryMs} ms to build and enter)`);

  // 3. Standing at the arrival fires nothing.
  await p.waitForTimeout(3000);
  const stood = await where();
  assert.ok(stood.inTidecrown, 'still in Tidecrown');
  assert.deepEqual([stood.kings, stood.back], [1, 0], 'no line fired while standing at the arrival');
  assert.ok(Math.hypot(stood.x - start.arrival[0], stood.z - start.arrival[1]) < 0.6, 'still at the arrival');
  console.log('PASS three seconds at the arrival fire neither line');

  // 4. South down the forest road across the return line, with a shot just before it.
  const south = [[start.arrival[0], start.arrival[1]], [-70, 345], [-72, 354]];
  await p.evaluate(() => { window.__steerS = null; });
  await walk(south, { z: start.back.a[1] - 6 }, { sprint: false, ahead: 4 });
  await p.waitForTimeout(700);
  assert.equal((await where()).back, 0, 'walking toward the line does not fire it');
  await p.screenshot({ path: `${shots}/3-tidecrown-return-line.png` });
  await walk(south, { line: '__back', fired: 1 }, { sprint: false, ahead: 4 });
  fired = Date.now();
  await p.waitForFunction(() => !window.app.current.game.world2.inTidecrown, null, { timeout: 30000 });
  const exitMs = Date.now() - fired;
  await settled();
  const home = await where();
  console.log(JSON.stringify({ exitMs, home }));
  assert.ok(!home.inTidecrown && home.w1 && home.chapter === 1, 'back in World I');
  assert.ok(Math.hypot(home.x - start.ret.x, home.z - start.ret.z) < 1, `near KINGS_ROAD_RETURN: ${JSON.stringify(home)}`);
  assert.ok(yawGap(home.yaw, start.ret.yaw) < 0.05 && Math.cos(home.yaw) > 0.8, `facing south down the road: ${home.yaw}`);
  assert.equal(home.quest, start.quest, 'the quest chapter is unchanged');
  assert.deepEqual([home.kings, home.back], [1, 1], 'each line fired once');
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${shots}/4-w1-back-on-the-kings-road.png` });
  await p.waitForTimeout(1500);
  assert.deepEqual([(await where()).kings, (await where()).back], [1, 1], 'arriving back next to the King\'s Road line does not fire it');
  console.log(`PASS south across the return line: World I at (${home.x}, ${home.z}) facing ${home.yaw} (KINGS_ROAD_RETURN ${start.ret.x.toFixed(1)}, ${start.ret.z.toFixed(1)}), ${exitMs} ms from the line`);

  // 5. North again: a second entry, the island already built.
  await p.evaluate(() => { window.__steerS = null; });
  await walk(road, { line: '__kings', fired: 2 });
  fired = Date.now();
  await p.waitForFunction(() => window.app.current.game.world2.inTidecrown, null, { timeout: 30000 });
  const secondEntryMs = Date.now() - fired;
  await settled();
  const again = await where();
  const secondBuildMs = await p.evaluate(() => Math.round(window.app.current.game.world2.tidecrownEntryMs));
  assert.ok(again.inTidecrown && Math.hypot(again.x - start.arrival[0], again.z - start.arrival[1]) < 0.6, `second entry at the arrival: ${JSON.stringify(again)}`);
  assert.equal(again.quest, start.quest, 'the quest chapter is unchanged');
  assert.deepEqual([again.kings, again.back], [2, 1]);
  console.log(`PASS second entry: ${secondEntryMs} ms from the line to Tidecrown (${secondBuildMs} ms to enter)`);

  assert.deepEqual(errors, []);
  console.log('PASS zero page or shader errors');
} finally {
  await browser.close();
}
