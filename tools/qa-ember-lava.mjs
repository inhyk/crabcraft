// World V lava QA: four fixed cameras (sanctuary to volcano, island edge to sea, aerial, a tongue's toe), the lava
// objects exist for chapter 5 only, no page errors, and the stillness of lava at rest.
// Stillness: with the camera fixed, 24 consecutive frames are read back; over the pixels the lava's own mask marks as
// having no time term (cooled crust, levees, stopped toes, the crater lip, clinker) the mean absolute difference
// between neighbouring frames (0-255) must stay near zero. Flowing lava is exempt.
// Simulated lava (emberLavaFlow.ts): it steps in real time; on bare ground the main flow's source fed as one of its
// episodes (0.9 m3/s for 20 s) grows a lobe whose volume rises while it feeds, whose front visibly advances (at least
// 1.2 m between 1 s and 10 s, 0.6 m in the first 4 s of that) and stops within a few seconds of the feed stopping; with
// the sources and subsidence off the volume holds to 0.1 %.
// Heat haze (core/heatHaze.ts, emberHaze.ts): in the chain in chapter 5 at the high tier only; it moves some pixels over
// the sea and none near the player. The stillness check runs with the haze barred: it measures the lava, not the air.
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
  const sixth = await p.evaluate(() => { const r = window.app.current.game.world2.sixth.root; return {lava: !!r.getObjectByName('molten-sea') || !!r.getObjectByName('lava-tongues'), clouds: !!(r.getObjectByName('sea-of-clouds') || r.getObjectByName('skybloom-cloud-sea'))}; });
  assert.deepEqual(sixth, {lava: false, clouds: true});
  const haze = await p.evaluate(() => { const e = window.app.current.game.engine; return {active: e.hazeActive, quality: e.quality}; });
  console.log('heat haze', JSON.stringify(haze));
  assert.equal(haze.active, haze.quality === 'high' && !before, `heat haze in chapter 5 only at the high tier: ${JSON.stringify(haze)}`);

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
        eng.hazeAllowed = false;
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
        eng.hazeAllowed = true;
        eng.renderer.setAnimationLoop(eng.frame);
        if (noBloom) eng.setView(g.scene, g.camera, {bloom: {intensity: .9, threshold: .9}, vignette: {offset: .3, darkness: .5}});
        return {stillPixels: still, flowPixels: flow, stillMAE: still ? sumS / still : NaN, stillMaxPixel: maxS, stillFar8pxPixels: core, stillFar8pxMAE: core ? sumC / core : NaN, flowMAE: flow ? sumF / flow : NaN, sceneryMAE: scen ? sumN / scen : NaN};
      }, process.env.CC_QA_NOBLOOM === '1');
      console.log(`stillness ${key}`, JSON.stringify(r));
      assert.ok(r.stillPixels > 2000, `camera ${key} sees lava at rest`);
      assert.ok(r.stillMAE < .5, `camera ${key} lava at rest is still: MAE ${r.stillMAE}`);
    }
  }
  if (!before && quality === 'high') {
    // The haze over the sea from the island's edge: the same instant drawn with and without it differs over the sea
    // only, by a few pixels' shift (a broken screen would change much of the frame), and not round the player.
    const c = LAVA_CAMERAS.b;
    await p.evaluate(c => { const g = window.app.current.game; g.player.unit.teleport(g.world, c.x, c.z, c.yaw - Math.PI); g.follow.yaw = c.yaw; g.follow.pitch = c.pitch; g.follow.distance = c.distance; g.follow.cut(); }, c);
    await p.waitForTimeout(1500);
    const ab = await p.evaluate(async () => {
      const e = window.app.current.game.engine, gl = e.renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, t = e.timer, upd = t.update, get = t.getDelta;
      let dt = 1 / 30; e.renderer.setAnimationLoop(null); t.update = () => t; t.getDelta = () => dt;
      const step = async () => { await new Promise(requestAnimationFrame); e.frame(); };
      const read = () => { const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
      try {
        for (let i = 0; i < 4; i++) await step();
        dt = 0; await step(); const a = read();
        e.hazeAllowed = false; await step(); await step(); const b = read();
        // readPixels rows run bottom up: y < 0.4 H is the lower part of the frame (the near ground and the player).
        let moved = 0, low = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 6) { moved++; if (y < H * .4) low++; } }
        return {moved: +(moved / (W * H)).toFixed(4), lowerPart: +(low / Math.max(1, moved)).toFixed(4)};
      } finally { e.hazeAllowed = true; t.update = upd; t.getDelta = get; e.renderer.setAnimationLoop(e.frame); }
    });
    console.log('heat haze over the sea', JSON.stringify(ab));
    assert.ok(ab.moved > .005 && ab.moved < .25, `the haze shifts some pixels over the sea, not the frame: ${ab.moved}`);
    assert.ok(ab.lowerPart < .05, `the near ground and the player are untouched: ${ab.lowerPart}`);
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
  }
  assert.deepEqual(errors, []);
  console.log('qa-ember-lava ok', label, quality);
} finally { await browser.close(); }
