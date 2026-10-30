// World V lava QA: four fixed cameras (sanctuary to volcano, island edge to sea, aerial, a tongue's toe), the lava
// objects exist for chapter 5 only, no page errors, and the stillness of lava at rest.
// Stillness: with the camera fixed, 24 consecutive frames are read back; over the pixels the lava's own mask marks as
// having no time term (cooled crust, levees, stopped toes, the crater lip, clinker) the mean absolute difference
// between neighbouring frames (0-255) must stay near zero. Flowing lava is exempt.
// Simulated lava (emberLavaFlow.ts): it steps in real time; on bare ground the main flow's source fed as one of its
// episodes (0.9 m3/s for 20 s) grows a lobe whose volume rises while it feeds, whose front visibly advances (at least
// 1.2 m between 1 s and 10 s, 0.6 m in the first 4 s of that) and stops within a few seconds of the feed stopping; with
// the sources and subsidence off the volume holds to 0.1 %.
// Prints: a crab walking (5 m/s) across a hot lobe parts it into a trench that refills within 6 s; across cold crust it
// leaves a dent that is still there 10 s later; with prints on and off the volume holds to 0.1 %.
//
// Usage: CC_QA_BASE=http://127.0.0.1:5262 node tools/qa-ember-lava.mjs
//   CC_QA_OUT=tmp/qa   where the PNGs go       CC_QA_LABEL=after   file name prefix
//   CC_QA_QUALITY=high|low                     CC_QA_BEFORE=1      screenshots only (a build without emberLava)
import assert from 'node:assert/strict';
import {launchBrowser} from './lib/browser.mjs';
import {mkdir} from 'node:fs/promises';

const base = process.env.CC_QA_BASE ?? 'http://127.0.0.1:5231';
const out = process.env.CC_QA_OUT ?? 'tmp/qa';
const label = process.env.CC_QA_LABEL ?? 'after';
const quality = process.env.CC_QA_QUALITY ?? 'high';
const before = process.env.CC_QA_BEFORE === '1';
await mkdir(out, {recursive: true});

/** Player position the follow camera orbits, and the follow camera's yaw, pitch and distance. The player is turned to
 * face away from the camera, otherwise the idle camera eases round behind it (player.ts) and the shot drifts. */
export const LAVA_CAMERAS = {
  a: {name: 'sanctuary-volcano', x: 0, z: -60, yaw: 0, pitch: -.02, distance: 14},
  b: {name: 'edge-sea', x: 104, z: -50, yaw: -1.5, pitch: .3, distance: 10},
  c: {name: 'aerial', x: 0, z: -78, yaw: .35, pitch: 1.0, distance: 165},
  d: {name: 'toe-closeup', x: -9, z: -96, yaw: .2, pitch: .25, distance: 6},
};

const browser = await launchBrowser({headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio']});
const errors = [];
try {
  const p = await browser.newPage({viewport: {width: 1280, height: 800}});
  p.on('pageerror', e => errors.push(e.message));
  // A shader that fails to compile only logs (THREE.WebGLProgram), so catch WebGL and three errors too.
  p.on('console', m => { if (m.type() === 'error' && /THREE|WebGL|shader/i.test(m.text())) errors.push(m.text().slice(0, 600)); });
  p.setDefaultTimeout(30000);
  await p.addInitScript(([q]) => {
    localStorage.setItem('cc.spec', JSON.stringify({race: 'human', sex: 'male', classId: 'mage', shell: 0, crest: 0, led: 0, name: 'Lava QA'}));
    localStorage.setItem('cc.hintsSeen', '1'); localStorage.setItem('cc.language', 'ko'); localStorage.setItem('cc.quality', q);
    if (location.hostname === '127.0.0.1') { const WS = window.WebSocket; window.WebSocket = class extends WS { constructor(url, protocols) { const u = new URL(String(url)); if (u.pathname === '/multiplayer') { u.host = location.host; u.protocol = 'ws:'; } super(u.href, protocols); } }; }
  }, [quality]);
  await p.goto(base + '/?screen=game');
  await p.locator('.launch-notice-start').click();
  await p.waitForFunction(() => window.app?.current?.game?.loaded && !document.querySelector('.loading'), null, {timeout: 90000});
  await p.evaluate(() => { const g = window.app.current.game; g.god = true; g.player.nextSwing = Infinity; });
  await p.waitForTimeout(1000); await p.keyboard.press('Space');
  await p.evaluate(() => { const g = window.app.current.game; g.creatorTravel = true; g.world2.go(5); });
  await p.waitForTimeout(6500);

  const names = await p.evaluate(() => { const r = window.app.current.game.world2.fifth.root; return ['molten-sea', 'lava-crater', 'lava-tongues'].filter(n => r.getObjectByName(n)); });
  assert.ok(names.includes('molten-sea') && names.includes('lava-crater'), `chapter 5 lava objects: ${names}`);
  if (!before) assert.ok(names.includes('lava-tongues'), 'lava tongues');
  const sixth = await p.evaluate(() => { const r = window.app.current.game.world2.sixth.root; return {lava: !!r.getObjectByName('molten-sea') || !!r.getObjectByName('lava-tongues'), clouds: !!r.getObjectByName('sea-of-clouds') || !!r.getObjectByName('skybloom-cloud-sea')}; });
  assert.deepEqual(sixth, {lava: false, clouds: true});

  // Pictures of the place, not of the HUD or the player: hide both (the camera still orbits the player).
  await p.evaluate(() => { window.app.ui.style.visibility = 'hidden'; const u = window.app.current.game.player.unit; u.hidden = true; u.rig.root.visible = false; });
  const shoot = async (key) => {
    const c = LAVA_CAMERAS[key];
    await p.evaluate(c => { const g = window.app.current.game; g.player.unit.teleport(g.world, c.x, c.z, c.yaw - Math.PI); g.player.unit.rig.root.visible = false; g.follow.yaw = c.yaw; g.follow.pitch = c.pitch; g.follow.distance = c.distance; g.follow.cut(); }, c);
    await p.waitForTimeout(1800);
    const file = `${out}/ember-lava-${label}-${key}-${c.name}.png`;
    await p.screenshot({path: file});
    console.log('shot', file);
  };
  for (const key of Object.keys(LAVA_CAMERAS)) await shoot(key);

  if (!before) {
    for (const key of ['d', 'a']) {
      const c = LAVA_CAMERAS[key];
      await p.evaluate(c => { const g = window.app.current.game; g.player.unit.teleport(g.world, c.x, c.z, c.yaw - Math.PI); g.follow.yaw = c.yaw; g.follow.pitch = c.pitch; g.follow.distance = c.distance; g.follow.cut(); }, c);
      await p.waitForTimeout(1500);
      const r = await p.evaluate(async (noBloom) => {
        const g = window.app.current.game, eng = g.engine, gl = eng.renderer.getContext(), lava = g.world2.fifth.lava;
        // Particles, spinning gems and banners are not lava; hide them so they cannot cross the lava pixels.
        const hidden = [];
        g.world2.fifth.root.traverse(o => { if (o.isPoints || o.geometry?.type === 'OctahedronGeometry' || o.userData?.banner) { if (o.visible) { hidden.push(o); o.visible = false; } } });
        // CC_QA_NOBLOOM=1 (diagnostic): measure without bloom, to tell glow spilling from flowing lava apart from a resting surface that moves.
        if (noBloom) eng.setView(g.scene, g.camera, {vignette: {offset: .3, darkness: .5}});
        const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, n = W * H * 4;
        const read = () => { const px = new Uint8Array(n); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
        // Frames at display rate: wait for the next animation frame, render it, read it back.
        const step = async () => { await new Promise(requestAnimationFrame); eng.frame(); };
        eng.renderer.setAnimationLoop(null);
        await step(); await step();
        lava.setMask(1); await step(); const mask = read(); lava.setMask(2); await step(); const swap = read(); lava.setMask(0);
        await step(); await step();
        const frames = []; for (let i = 0; i < 24; i++) { await step(); frames.push(read()); }
        // Classify: lava pixels are the ones whose colour flips between the two mask renders; anything else is scenery.
        const cls = new Uint8Array(W * H); // 1 at rest, 2 flowing
        for (let p = 0, i = 0; p < W * H; p++, i += 4) {
          const r = mask[i], bb = mask[i + 2], r2 = swap[i], b2 = swap[i + 2];
          cls[p] = r - bb > 60 && b2 - r2 > 60 ? 1 : bb - r > 60 && r2 - b2 > 60 ? 2 : 0;
        }
        // Flowing lava within 8 px (dilated): bloom from its glow can reach the resting pixels next to it.
        const R = 8, near = new Uint8Array(W * H), tmp = new Uint8Array(W * H);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let f = 0; for (let k = -R; k <= R && !f; k++) { const xx = x + k; if (xx >= 0 && xx < W && cls[y * W + xx] === 2) f = 1; } tmp[y * W + x] = f; }
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let f = 0; for (let k = -R; k <= R && !f; k++) { const yy = y + k; if (yy >= 0 && yy < H && tmp[yy * W + x]) f = 1; } near[y * W + x] = f; }
        let still = 0, flow = 0, core = 0, sumS = 0, sumF = 0, sumC = 0, maxS = 0, scen = 0, sumN = 0;
        for (let p = 0, i = 0; p < W * H; p++, i += 4) {
          if (!cls[p]) { if (!near[p] && p % 7 === 0) { let d = 0; for (let f = 1; f < 24; f++) { const a = frames[f], b = frames[f - 1]; d += (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3; } scen++; sumN += d / 23; } continue; }
          let d = 0;
          for (let f = 1; f < 24; f++) { const a = frames[f], b = frames[f - 1]; d += (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3; }
          d /= 23;
          if (cls[p] === 1) { still++; sumS += d; maxS = Math.max(maxS, d); if (!near[p]) { core++; sumC += d; } } else { flow++; sumF += d; }
        }
        for (const o of hidden) o.visible = true;
        eng.renderer.setAnimationLoop(eng.frame);
        if (noBloom) eng.setView(g.scene, g.camera, {bloom: {intensity: .9, threshold: .9}, vignette: {offset: .3, darkness: .5}});
        return {stillPixels: still, flowPixels: flow, stillMAE: still ? sumS / still : NaN, stillMaxPixel: maxS, stillFar8pxPixels: core, stillFar8pxMAE: core ? sumC / core : NaN, flowMAE: flow ? sumF / flow : NaN, sceneryMAE: scen ? sumN / scen : NaN};
      }, process.env.CC_QA_NOBLOOM === '1');
      console.log(`stillness ${key}`, JSON.stringify(r));
      assert.ok(r.stillPixels > 2000, `camera ${key} sees lava at rest`);
      assert.ok(r.stillMAE < .5, `camera ${key} lava at rest is still: MAE ${r.stillMAE}`);
    }
  }
  if (!before) {
    const live = await p.evaluate(async () => {
      const lava = window.app.current.game.world2.fifth.lava, f = lava.flow, s0 = f.steps;
      await new Promise(r => setTimeout(r, 3000));
      return {on: lava.flowOn, supported: f.supported, steps: f.steps - s0};
    });
    console.log('flow live', JSON.stringify(live));
    assert.ok(live.on && live.supported, 'simulated lava is on');
    assert.ok(live.steps > 45, `the simulation steps in real time: ${live.steps} steps in 3 s`);
    const lobe = await p.evaluate(() => {
      const g = window.app.current.game, f = g.world2.fifth.lava.flow, R = g.engine.renderer, rows = [];
      f.reset(R, false);
      f.override = (i, t) => (i === 1 && t < 20 ? .9 : 0);
      for (let t = 0; t <= 120; t += t < 10 ? 1 : 5) { if (t) f.advance(R, (t <= 10 ? 1 : 5) * 30); const s = f.stats(R); rows.push({t: Math.round(s.time), volume: +s.total.toFixed(3), front: +s.fronts[1].toFixed(2), maxH: +s.maxH.toFixed(2)}); }
      f.override = null; f.feeding = false; f.subsiding = false;
      const m0 = f.stats(R).total; f.advance(R, 30 * 60); const m1 = f.stats(R).total;
      f.feeding = true; f.subsiding = true;
      f.reset(R, true); f.advance(R, 450);
      return {rows, mass: [m0, m1]};
    });
    const at = t => lobe.rows.find(r => r.t === t);
    console.log('flow lobe', lobe.rows.map(r => `${r.t}s ${r.volume}m3 front ${r.front}m`).join(' | '));
    assert.ok(at(5).volume > .5 && at(10).volume > at(5).volume && at(20).volume > at(10).volume, 'volume rises while the source feeds');
    assert.ok(at(5).front > at(1).front + .6 && at(10).front > at(1).front + 1.2, `the front advances fast: ${at(1).front} -> ${at(5).front} -> ${at(10).front} m`);
    assert.ok(at(20).front > at(10).front + .3, `the front keeps advancing while fed: ${at(10).front} -> ${at(20).front} m`);
    assert.ok(Math.abs(at(120).front - at(30).front) < .05, `the front stops after the feed: ${at(30).front} -> ${at(120).front} m`);
    // Cold lava subsides (about 2 mm/s on a 1 m lobe), so the hold is checked while the lobe is still mostly hot.
    assert.ok(Math.abs(at(60).volume / at(30).volume - 1) < .01, 'volume holds once fed');
    const drift = Math.abs(lobe.mass[1] / lobe.mass[0] - 1);
    console.log('flow mass', lobe.mass.map(v => v.toFixed(4)).join(' -> '), `drift ${(drift * 100).toExponential(2)} %`);
    assert.ok(drift < 1e-3, 'mass is conserved with sources and subsidence off');

    // Prints (emberLavaPrints.ts): a crab pressed across a lobe at the game's walking speed (5 m/s), compared with the
    // same run with prints off (the sim is deterministic), so the depth is the print's alone.
    const pr = await p.evaluate(async () => {
      const g = window.app.current.game, f = g.world2.fifth.lava.flow, R = g.engine.renderer, C = .25;
      const surf = (st, x, z) => { const k = f.cellAt(x, z); return st[k * 4] + st[k * 4 + 1]; };
      const centroid = (st, ch) => { let sx = 0, sz = 0, sw = 0; for (let j = 0; j < f.nz; j++) for (let i = 0; i < f.nx; i++) { const v = st[(j * f.nx + i) * 4 + ch]; if (v > .2) { sx += i * v; sz += j * v; sw += v; } } return [f.x0 + (sx / sw + .5) * C, f.z0 + (sz / sw + .5) * C]; };
      const s1 = f.sources[1], ax = -s1.dirZ, az = s1.dirX;
      // Fed 0-20 s from the main flow's nose; `until` s of history (30: hot, stopped; 290: frozen through).
      const lobe = (until) => { f.reset(R, false); f.override = (i, t) => (i === 1 && t < 20 ? .9 : 0); f.advance(R, until * 30); };
      const walk = (prints, until, ch, after) => {
        lobe(until); f.prints = prints;
        const st0 = f.readState(R), [cx, cz] = centroid(st0, ch), L = 6, v = 5, n = Math.round(L / v * 30), rows = [];
        for (let s = 0; s < n + after * 30; s++) {
          f.clearPresses();
          if (s < n) { const u = -L / 2 + v * s / 30; f.setPress(cx + ax * u, cz + az * u, .6); }
          f.advance(R, 1, false);
          if (s >= n / 2 && (s - Math.round(n / 2)) % 15 === 0) rows.push({t: +((s - n / 2) / 30).toFixed(1), h: surf(f.readState(R), cx, cz)});
        }
        f.clearPresses(); f.prints = true;
        return {rows, hot: st0[f.cellAt(cx, cz) * 4], cold: st0[f.cellAt(cx, cz) * 4 + 1]};
      };
      const depth = (on, off) => on.rows.map((r, i) => ({t: r.t, d: +(off.rows[i].h - r.h).toFixed(4)}));
      const hotOn = walk(true, 30, 0, 8), hotOff = walk(false, 30, 0, 8);
      const coldOn = walk(true, 290, 1, 14), coldOff = walk(false, 290, 1, 14);
      // Mass: the hot lobe with sources and subsidence off, a crab walking back and forth across it for 20 s.
      const mass = {};
      for (const on of [true, false]) {
        lobe(30); f.feeding = false; f.subsiding = false; f.prints = on;
        const [cx, cz] = centroid(f.readState(R), 0), m0 = f.stats(R).total;
        for (let s = 0; s < 600; s++) { f.clearPresses(); const u = 3 * Math.sin(s / 30 * 1.6); f.setPress(cx + ax * u, cz + az * u, .6); f.advance(R, 1, false); }
        f.clearPresses(); f.advance(R, 300, false);
        mass[on ? 'on' : 'off'] = [m0, f.stats(R).total];
        f.feeding = true; f.subsiding = true; f.prints = true;
      }
      // Cost of a step (one sim pass; the prep pass runs once a frame on top): 600 steps, in wall time (the pipeline
      // drained by read-backs) and on a GPU timer query where the browser has one (ANGLE on Metal reports far more than
      // the wall time, so only the difference means anything), a crab pressing vs prints off (also the path when nobody
      // has pressed for 7 s); best of three.
      lobe(30); const [cx, cz] = centroid(f.readState(R), 0);
      const gl = R.getContext(), tq = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      const time = async (on) => {
        let best = 1e9, wall = 1e9;
        for (let k = 0; k < 3; k++) {
          f.prints = on; f.clearPresses(); f.setPress(cx, cz, .6); f.readState(R);
          const q = tq && gl.createQuery(), t0 = performance.now();
          if (q) gl.beginQuery(tq.TIME_ELAPSED_EXT, q);
          f.advance(R, 600, false);
          if (q) gl.endQuery(tq.TIME_ELAPSED_EXT);
          f.readState(R);
          let ms = performance.now() - t0;
          wall = Math.min(wall, ms);
          if (q) { for (let w = 0; w < 100 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); w++) await new Promise(r => setTimeout(r, 20)); if (!gl.getParameter(tq.GPU_DISJOINT_EXT)) ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; gl.deleteQuery(q); }
          best = Math.min(best, ms);
        }
        f.clearPresses(); f.prints = true; return {gpu: tq ? best / .6 : NaN, wall: wall / .6};
      };
      const cost = {off: await time(false), on: await time(true)};
      f.override = null; f.reset(R, true); f.advance(R, 450);
      return {hot: depth(hotOn, hotOff), cold: depth(coldOn, coldOff), hotCell: [hotOn.hot, hotOn.cold], coldCell: [coldOn.hot, coldOn.cold], mass, cost};
    });
    console.log('prints hot lobe', JSON.stringify(pr.hotCell), pr.hot.map(r => `${r.t}s ${r.d}`).join(' | '));
    console.log('prints cold crust', JSON.stringify(pr.coldCell), pr.cold.filter((r, i) => i % 2 === 0).map(r => `${r.t}s ${r.d}`).join(' | '));
    const hd = t => pr.hot.find(r => r.t === t).d, cd = t => pr.cold.find(r => r.t === t).d;
    const hotMax = Math.max(...pr.hot.map(r => r.d));
    assert.ok(pr.hotCell[0] > .3 && pr.coldCell[0] === 0 && pr.coldCell[1] > .3, 'the walks cross hot lava, then cold rock');
    assert.ok(hotMax > .15, `a crab parts hot lava: trench ${hotMax} m`);
    assert.ok(hd(6) < .5 * hotMax && hd(2) < hotMax && hd(4) < hd(2) && hd(6) < hd(4), `the trench refills within 6 s: ${hotMax} -> ${hd(2)} -> ${hd(4)} -> ${hd(6)} m`);
    assert.ok(cd(1) > .01, `a crab dents cold crust: ${cd(1)} m`);
    assert.ok(cd(11) > .9 * cd(1), `the dent stays for 10 s: ${cd(1)} -> ${cd(11)} m`);
    const pd = v => Math.abs(v[1] / v[0] - 1);
    console.log('prints mass', `on ${pr.mass.on.map(v => v.toFixed(4)).join(' -> ')} drift ${(pd(pr.mass.on) * 100).toExponential(2)} %`, `off ${pr.mass.off.map(v => v.toFixed(4)).join(' -> ')} drift ${(pd(pr.mass.off) * 100).toExponential(2)} %`);
    assert.ok(pd(pr.mass.on) < 1e-3 && pd(pr.mass.off) < 1e-3, 'mass is conserved with prints on and off');
    console.log('prints cost per step, us', JSON.stringify(pr.cost, (k, v) => typeof v === 'number' ? +v.toFixed(1) : v));
  }
  assert.deepEqual(errors, []);
  console.log('qa-ember-lava ok', label, quality);
} finally { await browser.close(); }
