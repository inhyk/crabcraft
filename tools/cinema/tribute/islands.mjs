#!/usr/bin/env node
// Samples the ground height of all six worlds on a grid, for the tribute's parchment map (the islands
// are the worlds' real coastlines). Opens the game like capture.mjs, travels to each world and reads
// world.heightAt.
//
// Usage: node tools/cinema/tribute/islands.mjs --url http://localhost:5311 --out <islands.json> [--n 256]
// Writes { "<chapter>": { x0, z0, step, n, h: [heights, row-major by z then x, 2 decimals] } }.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { advance, openApp } from '../../trailer/lib.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const base = opt('--url', 'http://localhost:5311');
const out = resolve(opt('--out', 'islands.json'));
const n = Number(opt('--n', '256'));
// Half extents of each world's square, units: Clawhaven and its voyage islands are the largest.
const HALF = { 1: 340, 2: 190, 3: 190, 4: 190, 5: 190, 6: 190 };

const app = await openApp({ base, query: 'screen=game', size: [960, 540], dsf: 1, storage: { 'cc.musicVol': '0', 'cc.sfxVol': '0' } });
const { page } = app;
try {
  const start = page.locator('.launch-notice-start');
  if (await start.count().catch(() => 0)) await start.first().click({ timeout: 30000 }).catch(() => {});
  await page.waitForFunction(() => window.app?.current?.game?.loaded && !document.querySelector('.loading'), null, { timeout: 180000 });
  await page.evaluate(async () => (await import('/src/capture/cinema/index.ts')).default.init());
  await page.evaluate(() => window.__capture.begin());
  const result = {};
  for (const chapter of [1, 2, 3, 4, 5, 6]) {
    if (await page.evaluate((c) => window.__cinema.travel(c), chapter)) {
      for (let i = 0; i < 40; i++) {
        await advance(app, 0.5, 30);
        if (await page.evaluate((c) => window.__cinema.chapter === c && !document.querySelector('.loading'), chapter)) break;
      }
      await advance(app, 1, 30);
    }
    const half = HALF[chapter];
    result[chapter] = await page.evaluate(
      ([half, n]) => {
        const g = window.app.current.game;
        const step = (2 * half) / (n - 1);
        const h = [];
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h.push(Math.round(g.world.heightAt(-half + i * step, -half + j * step) * 100) / 100);
        return { x0: -half, z0: -half, step, n, h };
      },
      [half, n],
    );
    const land = result[chapter].h.filter((v) => v > 0).length;
    console.log(`world ${chapter}: ${land} of ${n * n} samples above sea level`);
  }
  writeFileSync(out, JSON.stringify(result));
  console.log(`wrote ${out}`);
} finally {
  await app.browser.close();
}
