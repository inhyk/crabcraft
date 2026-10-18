#!/usr/bin/env node
// Focused installed-Chrome QA on the real game, input loop, action bar and BrowserSink.
// Account session is a local guest response; cooldown boundaries use fixture game time, not60s wall time.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const url = opt('--url', 'http://127.0.0.1:5238');
const out = resolve(opt('--out', 'output/playwright/ultimate')); mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: !args.includes('--headed'), args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const results = [];
try {
  for (const classId of ['warrior', 'mage', 'priest']) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await context.newPage(); const errors = []; const missingAssets = new Set();
    const asset = /\/(art|audio|models|motions|robot|fonts)\/|\/favicon\.ico$/;
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') { if (/Failed to load resource/.test(m.text()) && asset.test(m.location().url)) missingAssets.add(m.location().url); else errors.push(m.text()); } });
    await page.route('**/api/account/session', route => route.fulfill({ json: { signedIn: false } }));
    await page.addInitScript(classId => {
      localStorage.setItem('cc.spec', JSON.stringify({ race: 'human', sex: 'male', classId, shell: 0, crest: 0, led: 0, name: `Ultimate-${classId}` }));
      localStorage.setItem('cc.language', 'en');
    }, classId);
    try {
      await page.goto(`${url}/?screen=game&debug=1`, { waitUntil: 'load' });
      await page.locator('.launch-notice-start').click();
      await page.waitForFunction(() => window.__ready && window.cc?.game, null, { timeout: 90000 });
      await page.evaluate(() => {
        const g = window.cc.game; const p = g.player; g.god = true; g.cinematic = false; g.hud.menu.close(); g.hud.minimap.toggle(false);
        p.nextSwing = Infinity; p.setTarget(null); p.resource = 0;
        const enemy = g.enemies.find(e => e.unit.alive); if (!enemy) throw new Error('no real enemy');
        enemy.update = () => {}; // Keep the selected real enemy stationary across frame and fixture-clock jumps.
        const target = enemy.unit; target.teleport(g.world, p.unit.pos.x + 4, p.unit.pos.z); target.maxHp = target.hp = 100000; target.stunUntil = 100000; target.hidden = false; target.invulnerable = false;
        // Fixtures isolate ability+input from arbitrary town walls; real LOS/range is tested headlessly.
        g.world.raycastSolid = () => null;
        const qa = window.ultimateQA = { abilities: 0, presses: 0, damage: [], effects: [], inUltimateSink: false, target };
        const sink = g.events.sink;
        g.events.sink = event => {
          if (event.type === 'press' && event.slot === 5) qa.presses++;
          if (event.type === 'damage' && event.src === p.unit && event.dst === target) qa.damage.push({ amount: event.amount, school: event.school });
          const ultimate = event.type === 'ability' && event.ability === 'crown-burst'; if (ultimate) qa.abilities++;
          qa.inUltimateSink = ultimate;
          try { sink(event); } finally { qa.inUltimateSink = false; }
        };
        for (const [object, name] of [[g.vfx, 'tidalNova'], [g.vfx, 'ring'], [g.vfx, 'impact'], [g.audio, 'sfx'], [g.follow, 'shake']]) {
          const original = object[name]; object[name] = function(...args) { if (qa.inUltimateSink) qa.effects.push(name); return original.apply(this, args); };
        }
      });
      assert.equal(await page.locator('.ab-slot').count(), 5); assert.equal(await page.locator('.ab-slot.ultimate .ab-key').textContent(), '5');
      const state = () => page.evaluate(() => { const g = window.cc.game; const q = window.ultimateQA; const ab = g.player.cls.abilities[4]; return { abilities: q.abilities, presses: q.presses, damage: q.damage, effects: q.effects, cooldown: g.player.cooldownLeft(ab), cd: { ...g.player.cooldowns.get(ab.id) }, cdText: document.querySelector('.ab-slot.ultimate .ab-cdtext').textContent, sweep: document.querySelector('.ab-slot.ultimate .ab-cd').style.getPropertyValue('--cd') }; });
      await page.keyboard.press('Digit5'); await page.waitForFunction(() => window.ultimateQA.abilities === 1);
      const first = await state(); assert.equal(first.cd.end, first.cd.start + 60); assert(first.cooldown > 58); assert.equal(first.damage.length, 1); assert.equal(first.damage[0].school, 'water'); assert.equal(first.cdText, '60');
      assert.deepEqual(first.effects, ['tidalNova', 'ring', 'ring', 'ring', 'impact', 'sfx', 'shake']);
      await page.keyboard.press('Numpad5'); await page.waitForTimeout(150); assert.equal((await state()).abilities, 1);
      await page.evaluate(() => { const g = window.cc.game; g.time = g.player.cooldowns.get('crown-burst').end + .01; });
      await page.keyboard.press('Numpad5'); await page.waitForFunction(() => window.ultimateQA.abilities === 2);
      const second = await state(); assert.equal(second.cd.end, second.cd.start + 60); assert.equal(second.damage.length, 2);
      await page.locator('.ab-slot.ultimate').click(); await page.waitForTimeout(150); assert.equal((await state()).abilities, 2);
      await page.evaluate(() => { const g = window.cc.game; g.time = g.player.cooldowns.get('crown-burst').end + .01; });
      await page.locator('.ab-slot.ultimate').click(); await page.waitForFunction(() => window.ultimateQA.abilities === 3);
      await page.waitForFunction(() => document.querySelector('.ab-slot.ultimate .ab-cdtext').textContent === '60');
      const third = await state(); assert.equal(third.cd.end, third.cd.start + 60); assert.equal(third.damage.length, 3); assert.equal(third.effects.length, 21); assert.equal(third.presses, 5);
      const screenshot = resolve(out, `${classId}-ultimate.png`); await page.screenshot({ path: screenshot });
      assert.deepEqual(errors, []); results.push({ classId, ok: true, input: ['Digit5', 'Numpad5', 'actionbar click'], cooldownBoundary: 'fixture game-clock advancement, not60s real time', state: third, consoleErrors: errors, missingAssets: [...missingAssets], screenshot });
    } catch (error) {
      await page.screenshot({ path: resolve(out, `${classId}-failure.png`) }).catch(() => {});
      console.error(classId, await page.evaluate(() => { const g = window.cc?.game; const q = window.ultimateQA; return { abilities: q?.abilities, damage: q?.damage, target: q?.target && { hp: q.target.hp, alive: q.target.alive, hidden: q.target.hidden, invulnerable: q.target.invulnerable, pos: q.target.pos }, player: g?.player.unit.pos, controlsLocked: g?.controlsLocked }; }).catch(() => null));
      throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
const result = { label: 'Real Chrome ultimate input/HUD/BrowserSink QA with mocked guest session and fixture game clock', results };
writeFileSync(resolve(out, 'results.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
