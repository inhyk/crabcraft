#!/usr/bin/env node
// Records the tribute's 2D cards (cards.html on the dev server): the rating card, the parchment map
// and the logo, each on the edit's 24 fps grid (frame k is song time k / 24).
//
// Usage: node tools/cinema/tribute/cards.mjs --url http://localhost:5311 --islands <islands.json> --out <dir>
//          [--only card-map] [--stills 10,20,32]   (stills at song seconds instead of recordings)
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Recorder } from '../../trailer/lib.mjs';
import { FPS, RANGES } from './timeline.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const base = opt('--url', 'http://localhost:5311');
const islands = JSON.parse(readFileSync(resolve(opt('--islands', 'islands.json')), 'utf8'));
const outDir = resolve(opt('--out', 'cards'));
const only = (opt('--only', '') || '').split(',').filter(Boolean);
const stills = (opt('--stills', '') || '').split(',').filter(Boolean).map(Number);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--hide-scrollbars'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 872 }, deviceScaleFactor: 1 });
  // Swallow the dev server's HMR socket: an edit in the worktree must not reload the page mid-render.
  await ctx.routeWebSocket(/./, () => {});
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/tools/cinema/tribute/cards.html`, { waitUntil: 'load' });
  const t0 = Date.now();
  await page.evaluate((d) => window.cardsInit(d), islands);
  console.log(`cards ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const cdp = await ctx.newCDPSession(page);
  const shot = async () => Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 95, clip: { x: 0, y: 0, width: 1920, height: 872, scale: 1 } })).data, 'base64');
  if (stills.length) {
    for (const t of stills) {
      await page.evaluate((t) => window.renderAt(t), t);
      writeFileSync(resolve(outDir, `still-${t.toFixed(2)}.jpg`), await shot());
    }
  } else {
    for (const r of RANGES.filter((r) => r.owner === 'cards' && (!only.length || only.includes(r.id)))) {
      const k0 = Math.round(r.from * FPS), k1 = Math.round(r.to * FPS);
      const rec = new Recorder(resolve(outDir, `${r.id}.mp4`), { fps: FPS });
      const t1 = Date.now();
      for (let k = k0; k < k1; k++) {
        await page.evaluate((t) => window.renderAt(t), k / FPS);
        await rec.write(await shot());
      }
      await rec.close();
      console.log(`${r.id}: ${rec.frames} frames (${r.from}-${r.to} s) in ${((Date.now() - t1) / 1000).toFixed(0)} s`);
    }
  }
  if (errors.length) console.log(`page errors:\n  ${errors.join('\n  ')}`);
} finally {
  await browser.close();
}
