// H hides the whole interface for looking at the world and brings it back; Esc also brings it back
// without opening the menu. While hidden the crab still walks, the target ring and quest guidance
// are gone, typing in a text box does not toggle it, and a modal window brings the interface back.
// Usage: node tools/qa-hide-ui.mjs [--url http://127.0.0.1:5288] [--out dir]
// Needs a dev or preview server running (pnpm dev --port 5288 --strictPort).
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const base = opt('--url', 'http://127.0.0.1:5288');
const outDir = resolve(opt('--out', 'tmp/qa'));
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const errors = [];
try {
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript(() => {
    localStorage.setItem('cc.language', 'ko');
    localStorage.setItem('cc.quality', 'low');
    localStorage.setItem('cc.hintsSeen', '1');
    localStorage.setItem('cc.spec', JSON.stringify({ race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'Sightseer' }));
  });
  await p.goto(`${base}/?screen=game`);
  await p.locator('.launch-notice-start').click({ timeout: 30000 });
  await p.waitForFunction(() => window.app?.current?.game?.loaded, null, { timeout: 90000 });
  await p.waitForFunction(() => !document.querySelector('.loading'));
  await p.waitForTimeout(1500);
  const read = () => p.evaluate(() => {
    const g = window.app.current.game;
    return {
      hidden: document.documentElement.classList.contains('cc-ui-hidden'),
      uiOpacity: getComputedStyle(document.getElementById('cc-ui')).opacity,
      note: !!document.querySelector('.hide-ui-note.on'),
      menu: g.hud.menu.open,
      objective: g.objective.enabled,
      ring: g.vfx.selection.mesh.visible,
      target: !!g.player.target,
      pos: [g.player.unit.pos.x, g.player.unit.pos.z],
    };
  });
  const before = await read();
  assert.equal(before.hidden, false);
  assert.equal(before.uiOpacity, '1');
  await p.screenshot({ path: `${outDir}/hide-ui-before.png` });

  // H hides everything; the note says how to come back.
  await p.keyboard.press('KeyH');
  await p.waitForTimeout(600);
  const hidden = await read();
  assert.equal(hidden.hidden, true);
  assert.equal(hidden.uiOpacity, '0');
  assert.equal(hidden.note, true);
  assert.equal(hidden.objective, false);
  await p.screenshot({ path: `${outDir}/hide-ui-note.png` });
  await p.waitForTimeout(3200);
  assert.equal((await read()).note, false);
  await p.screenshot({ path: `${outDir}/hide-ui-after.png` });

  // The crab still walks and targets, but no ring is drawn.
  await p.keyboard.down('KeyW');
  await p.waitForTimeout(700);
  await p.keyboard.up('KeyW');
  await p.evaluate(() => { const g = window.app.current.game; const u = g.units.find((x) => x.hostile && x.alive); if (u) g.player.setTarget(u); });
  await p.waitForTimeout(100);
  const walked = await read();
  assert.ok(Math.hypot(walked.pos[0] - hidden.pos[0], walked.pos[1] - hidden.pos[1]) > 0.5, JSON.stringify({ hidden: hidden.pos, walked: walked.pos }));
  assert.equal(walked.target, true);
  assert.equal(walked.ring, false);

  // Esc brings the interface back and does not open the menu.
  await p.keyboard.press('Escape');
  await p.waitForTimeout(100);
  const shown = await read();
  assert.equal(shown.hidden, false);
  assert.equal(shown.menu, false);
  assert.equal(shown.objective, true);
  assert.equal(shown.ring, true);

  // H toggles both ways.
  await p.keyboard.press('KeyH');
  assert.equal((await read()).hidden, true);
  await p.keyboard.press('KeyH');
  assert.equal((await read()).hidden, false);

  // Typing an H into a text box does not hide anything.
  await p.evaluate(() => { const i = document.createElement('input'); i.id = 'qa-typing'; document.body.append(i); i.focus(); });
  await p.keyboard.press('KeyH');
  assert.equal((await read()).hidden, false);
  await p.evaluate(() => { const i = document.getElementById('qa-typing'); i.blur(); i.remove(); });

  // A modal window brings the interface back with it.
  await p.keyboard.press('KeyH');
  assert.equal((await read()).hidden, true);
  await p.evaluate(() => window.app.account.show());
  await p.waitForTimeout(200);
  assert.equal((await read()).hidden, false);

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ before, hidden, walked, shown }));
  console.log('PASS: H hides and shows the interface, Esc shows it without the menu, walking and targeting work while hidden, typing and modals are respected, no page errors');
} finally {
  await browser.close();
}
