// World V lava QA: four fixed cameras (sanctuary to volcano, island edge to sea, aerial, a tongue's toe), the lava
// objects exist for chapter 5 only, no page errors, and the stillness of lava at rest.
// Stillness: with the camera fixed, 24 consecutive frames are read back; over the pixels the lava's own mask marks as
// having no time term (cooled crust, levees, stopped toes, the crater lip, clinker) the mean absolute difference
// between neighbouring frames (0-255) must stay near zero. Flowing lava is exempt.
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

/** Player position the follow camera orbits, and the follow camera's yaw, pitch and distance. */
export const LAVA_CAMERAS = {
  a: {name: 'sanctuary-volcano', x: 0, z: -60, yaw: 0, pitch: -.02, distance: 14},
  b: {name: 'edge-sea', x: 104, z: -50, yaw: -1.5, pitch: .3, distance: 10},
  c: {name: 'aerial', x: 0, z: -78, yaw: .35, pitch: 1.0, distance: 165},
  d: {name: 'toe-closeup', x: 6.5, z: -95, yaw: .55, pitch: .38, distance: 9},
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
  const sixth = await p.evaluate(() => { const r = window.app.current.game.world2.sixth.root; return {lava: !!r.getObjectByName('molten-sea') || !!r.getObjectByName('lava-tongues'), clouds: !!r.getObjectByName('sea-of-clouds')}; });
  assert.deepEqual(sixth, {lava: false, clouds: true});

  // Pictures of the place, not of the HUD or the player: hide both (the camera still orbits the player).
  await p.evaluate(() => { window.app.ui.style.visibility = 'hidden'; const u = window.app.current.game.player.unit; u.hidden = true; u.rig.root.visible = false; });
  const shoot = async (key) => {
    const c = LAVA_CAMERAS[key];
    await p.evaluate(c => { const g = window.app.current.game; g.player.unit.teleport(g.world, c.x, c.z); g.player.unit.rig.root.visible = false; g.follow.yaw = c.yaw; g.follow.pitch = c.pitch; g.follow.distance = c.distance; g.follow.cut(); }, c);
    await p.waitForTimeout(1800);
    const file = `${out}/ember-lava-${label}-${key}-${c.name}.png`;
    await p.screenshot({path: file});
    console.log('shot', file);
  };
  for (const key of Object.keys(LAVA_CAMERAS)) await shoot(key);

  if (!before) {
    for (const key of ['d', 'a']) {
      const c = LAVA_CAMERAS[key];
      await p.evaluate(c => { const g = window.app.current.game; g.player.unit.teleport(g.world, c.x, c.z); g.follow.yaw = c.yaw; g.follow.pitch = c.pitch; g.follow.distance = c.distance; g.follow.cut(); }, c);
      await p.waitForTimeout(1500);
      const r = await p.evaluate(async () => {
        const g = window.app.current.game, eng = g.engine, gl = eng.renderer.getContext(), lava = g.world2.fifth.lava;
        // Particles, spinning gems and banners are not lava; hide them so they cannot cross the lava pixels.
        const hidden = [];
        g.world2.fifth.root.traverse(o => { if (o.isPoints || o.geometry?.type === 'OctahedronGeometry' || o.userData?.banner) { if (o.visible) { hidden.push(o); o.visible = false; } } });
        const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, n = W * H * 4;
        const read = () => { const px = new Uint8Array(n); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
        // Frames at display rate: wait for the next animation frame, render it, read it back.
        const step = async () => { await new Promise(requestAnimationFrame); eng.frame(); };
        eng.renderer.setAnimationLoop(null);
        await step(); await step();
        lava.setMask(1); await step(); const mask = read(); lava.setMask(2); await step(); const swap = read(); lava.setMask(0);
        await step(); await step();
        const frames = []; for (let i = 0; i < 24; i++) { await step(); frames.push(read()); }
        let still = 0, flow = 0, sumS = 0, sumF = 0, maxS = 0;
        for (let i = 0; i < n; i += 4) {
          const r = mask[i];
          // Lava pixels are the ones whose colour flips between the two mask renders; anything else is scenery.
          const bb = mask[i + 2], r2 = swap[i], b2 = swap[i + 2];
          const isStill = r - bb > 60 && b2 - r2 > 60, isFlow = bb - r > 60 && r2 - b2 > 60;
          if (!isStill && !isFlow) continue;
          let d = 0;
          for (let f = 1; f < 24; f++) { const a = frames[f], b = frames[f - 1]; d += (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3; }
          d /= 23;
          if (isStill) { still++; sumS += d; maxS = Math.max(maxS, d); } else { flow++; sumF += d; }
        }
        for (const o of hidden) o.visible = true;
        eng.renderer.setAnimationLoop(eng.frame);
        return {stillPixels: still, flowPixels: flow, stillMAE: still ? sumS / still : NaN, stillMaxPixel: maxS, flowMAE: flow ? sumF / flow : NaN};
      });
      console.log(`stillness ${key}`, JSON.stringify(r));
      assert.ok(r.stillPixels > 2000, `camera ${key} sees lava at rest`);
      assert.ok(r.stillMAE < .5, `camera ${key} lava at rest is still: MAE ${r.stillMAE}`);
    }
  }
  assert.deepEqual(errors, []);
  console.log('qa-ember-lava ok', label, quality);
} finally { await browser.close(); }
