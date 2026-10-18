// Run against a Vite dev server: CC_QA_BASE=http://127.0.0.1:5268 node tools/qa-right-click-camera.mjs
// Native Chrome input plus explicit event ordering for Windows' menu after button release.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.CC_QA_BASE ?? 'http://127.0.0.1:5268';
const out = 'tmp/qa/right-click-camera';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  channel: 'chrome', headless: !process.argv.includes('--headed'),
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'],
});
let passed = 0;
const pass = (name) => { passed++; console.log(`PASS ${name}`); };
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/__input-qa__', (route) => route.fulfill({ contentType: 'text/html', body: `
    <style>body{margin:0}canvas{position:absolute;left:40px;top:80px;width:640px;height:420px;background:#123}
    #hud{position:absolute;left:480px;top:120px;width:160px;height:100px}input{position:absolute;left:760px;top:120px}</style>
    <canvas></canvas><button id="hud">HUD</button><input aria-label="Chat">` }));
  await page.goto(`${base}/__input-qa__`);
  await page.evaluate(async () => {
    const { Input } = await import('/src/core/input.ts');
    const canvas = document.querySelector('canvas');
    window.input = new Input(canvas);
    window.menus = [];
    window.addEventListener('contextmenu', (e) => menus.push(e.defaultPrevented));
    window.resetInput = () => { window.input.dispose(); window.input = new Input(canvas); };
    window.pointer = (type, target = canvas, extra = {}) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 99, pointerType: 'mouse',
      clientX: 160, clientY: 260, button: 2, buttons: 2, ...extra,
    }));
  });

  assert.equal(await page.evaluate(() => {
    // Explicitly model the reported Windows sequence, independent of host OS menu timing.
    pointer('pointerdown');
    pointer('pointerup', document.querySelector('#hud'), { buttons: 0 });
    return document.querySelector('#hud').dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, button: 2,
    }));
  }), false, 'A canvas right drag must block the menu even after release over a HUD element');
  pass('Windows release-before-contextmenu over HUD');

  await page.evaluate(() => resetInput());
  await page.mouse.move(160, 260);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(550, 170, { steps: 8 });
  assert.deepEqual(await page.evaluate(() => ({
    held: input.isButtonDown(2), moved: input.dx > 0, captured: document.querySelector('canvas').hasPointerCapture(1),
  })), { held: true, moved: true, captured: true });
  await page.mouse.up({ button: 'right' });
  assert.equal(await page.evaluate(() => input.isButtonDown(2)), false);
  assert.ok(await page.evaluate(() => menus.length > 0 && menus.every(Boolean)));
  pass('native drag captures pointer across HUD and releases');

  assert.equal(await page.evaluate(() => {
    const hud = document.querySelector('#hud');
    pointer('pointerdown', hud);
    return hud.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
  }), true, 'A fresh right click on UI must retain its own menu');
  pass('standalone HUD context menu remains available');

  for (const reason of ['blur', 'hidden', 'pointercancel', 'lostpointercapture']) {
    assert.equal(await page.evaluate((reason) => {
      resetInput();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
      pointer('pointerdown');
      pointer('pointermove', window, { clientX: 220 });
      document.querySelector('canvas').dispatchEvent(new WheelEvent('wheel', { deltaY: 120 }));
      if (reason === 'hidden') {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
        delete document.visibilityState;
      } else if (reason === 'blur') window.dispatchEvent(new Event('blur'));
      else pointer(reason);
      return !input.isDown('KeyW') && !input.wasPressed('Space') && !input.isButtonDown(2) &&
        !input.wasButtonPressed(2) && !input.wasClicked(2) && input.dx === 0 && input.dy === 0 && input.wheel === 0;
    }, reason), true, `${reason} must clear held inputs and pending actions without clicking`);
    pass(`${reason} clears held inputs and pending actions`);
  }

  assert.equal(await page.evaluate(() => {
    resetInput();
    pointer('pointerdown');
    pointer('pointermove', window, { buttons: 0, button: -1, clientX: 200 });
    return !input.isButtonDown(2) && !input.wasClicked(2);
  }), true);
  pass('mouse movement repairs a missed button release without a click');

  await page.evaluate(() => resetInput());
  await page.mouse.click(160, 260);
  assert.equal(await page.evaluate(() => input.wasClicked(0)), true);
  await page.evaluate(() => input.endFrame());
  await page.mouse.wheel(0, 120);
  await page.waitForFunction(() => input.wheel > 0);
  pass('left click and wheel keep working');

  await page.locator('input').focus();
  await page.keyboard.type('wasd');
  assert.equal(await page.locator('input').inputValue(), 'wasd');
  assert.equal(await page.evaluate(() => input.wasPressed('KeyW')), false);
  pass('typing stays out of game input');

  assert.equal(await page.evaluate(() => {
    input.dispose();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    const menuAllowed = document.querySelector('canvas').dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
    }));
    return !input.isDown('KeyW') && menuAllowed;
  }), true);
  pass('dispose removes keyboard and contextmenu listeners');

  if (!process.argv.includes('--input-only')) {
    await page.addInitScript(() => {
      localStorage.setItem('cc.spec', JSON.stringify({ race: 'human', sex: 'male', classId: 'mage', shell: 0, crest: 0, led: 0, name: 'Input QA' }));
      localStorage.setItem('cc.quality', 'low');
      localStorage.setItem('cc.hintsSeen', '1');
    });
    await page.goto(`${base}/?screen=game`);
    await page.locator('.launch-notice-start').click();
    await page.waitForFunction(() => window.app?.current?.game?.loaded && !document.querySelector('.loading'), null, { timeout: 90000 });
    await page.waitForFunction(() => !document.querySelector('.cc-blackout.on'));
    await page.evaluate(() => {
      const g = window.app.current.game;
      g.god = true;
      g.hud.messages.closeDiscovery();
      document.activeElement?.blur();
    });
    const sample = () => page.evaluate(() => {
      const g = window.app.current.game;
      return { yaw: g.follow.yaw, x: g.player.unit.pos.x, z: g.player.unit.pos.z,
        held: g.input.isButtonDown(2), walking: g.input.isDown('KeyW') };
    });
    const start = await sample();
    await page.mouse.move(400, 390);
    await page.keyboard.down('KeyW');
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(610, 400, { steps: 12 });
    await page.waitForTimeout(400);
    const moving = await sample();
    assert.ok(Math.abs(moving.yaw - start.yaw) > 0.2);
    assert.ok(Math.hypot(moving.x - start.x, moving.z - start.z) > 0.1);
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(100);
    assert.equal((await sample()).walking, true, 'Normal mouse release must preserve a held movement key');
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(800);
    const stopped = await sample();
    await page.mouse.move(800, 450, { steps: 5 });
    await page.waitForTimeout(400);
    const after = await sample();
    assert.equal(after.held, false);
    assert.equal(after.walking, false);
    assert.ok(Math.hypot(after.x - stopped.x, after.z - stopped.z) < 0.05);
    assert.ok(Math.abs(after.yaw - stopped.yaw) < 0.001);
    pass('game moves and rotates together, then stops on release');

    const hud = await page.locator('.mp-panel > summary').boundingBox();
    assert.ok(hud);
    for (let i = 0; i < 10; i++) {
      await page.mouse.move(400, 380);
      await page.mouse.down({ button: 'right' });
      await page.mouse.move(hud.x + 20, hud.y + 15, { steps: 3 });
      await page.mouse.up({ button: 'right' });
    }
    assert.equal((await sample()).held, false);
    pass('ten native game camera drags ending over HUD release cleanly');
    await page.screenshot({ path: `${out}/game-after-drag.png` });
    console.log('GAME_STATE', JSON.stringify(await sample()));
  }
  assert.deepEqual(errors, []);
  console.log(`PASS ${passed} scenarios, 0 page errors; Windows desktop reproduction remains manual`);
} finally {
  await browser.close();
}
