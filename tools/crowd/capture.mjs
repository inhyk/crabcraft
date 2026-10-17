#!/usr/bin/env node
// Captures a crowd program shot by shot, frame-exact, in the crowd capture scene
// (src/capture/crowd, `?capture=1&screen=crowd` on the dev server). Each shot is rendered on its
// own: the song clock is put a few seconds before the shot (the pre-roll lets fireworks and the
// faces catch up), then every frame is stepped and screenshotted by tools/trailer/lib.mjs's
// recorder. The shots tile the program's length frame for frame (lib.mjs shotRanges), so they
// join into one take.
//
// Usage: node tools/crowd/capture.mjs --url http://localhost:5291 --program <program.json>
//          --out <dir> [--layout land|port] [--dsf 2] [--fps 60] [--shots 0,4,7] [--preroll 3]
//          [--reuse]
// Writes <out>/shot-NNN.mp4, .json (frames, blank-frame repairs, page errors, a probe per frame
// with the song clock) and .key (what the shot depends on; --reuse skips shots whose key matches).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { advance, openApp, record } from '../trailer/lib.mjs';
import { shotKey, shotName, shotRanges } from './lib.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const base = opt('--url', 'http://localhost:5291');
const program = JSON.parse(readFileSync(resolve(opt('--program', 'program.json')), 'utf8'));
const outDir = resolve(opt('--out', 'crowd-shots'));
const layout = opt('--layout', 'land');
const dsf = Number(opt('--dsf', '2'));
const fps = Number(opt('--fps', '60'));
const preroll = Number(opt('--preroll', '3'));
const reuse = args.includes('--reuse');
const only = (opt('--shots', '') || '').split(',').filter(Boolean).map(Number);
mkdirSync(outDir, { recursive: true });

const SIZE = { land: [1920, 1080], port: [1080, 1920] };
const settings = { layout, dsf, fps, preroll };
const fresh = (i) => {
  const f = shotName(outDir, i);
  return existsSync(`${f}.mp4`) && existsSync(`${f}.key`) && readFileSync(`${f}.key`, 'utf8') === shotKey(program, i, settings);
};
const todo = shotRanges(program, fps).filter((r) => (!only.length || only.includes(r.index)) && !(reuse && fresh(r.index)));
if (!todo.length) {
  console.log(`${layout}: every shot is up to date`);
  process.exit(0);
}

const app = await openApp({ base, query: 'screen=crowd', size: SIZE[layout], dsf });
const { page } = app;
await page.waitForFunction(() => window.__crowd?.ready, null, { timeout: 180000 });
const stats = await page.evaluate(([p, l]) => window.__crowd.load(p, { layout: l }), [program, layout]);
console.log(`${layout}: ${stats.crabs} crabs in ${stats.loadSeconds.toFixed(1)} s; clips ${stats.clips.join(', ')}`);
await page.waitForTimeout(500);
await page.evaluate(() => window.__capture.begin());

try {
  for (const r of todo) {
    const n = r.k1 - r.k0;
    if (n <= 0) continue;
    const pre = Math.round(preroll * fps);
    // record() steps two frames before its first one: the first recorded frame is song frame k0.
    await page.evaluate((t) => window.__crowd.seek(t), (r.k0 - pre - 3) / fps);
    await advance(app, pre / fps, fps);
    const file = shotName(outDir, r.index);
    const meta = await record(app, file, { duration: n / fps, fps, probe: () => window.__crowd.probe(), log: false });
    const first = meta.probe[0]?.t;
    if (Math.abs(first - r.k0 / fps) > 0.5 / fps) throw new Error(`shot ${r.index} starts at song ${first} s, expected ${r.k0 / fps}`);
    if (meta.frames !== n) throw new Error(`shot ${r.index}: ${meta.frames} frames, expected ${n}`);
    writeFileSync(`${file}.key`, shotKey(program, r.index, settings));
    console.log(`${layout} shot ${r.index} (${(r.k0 / fps).toFixed(2)} to ${(r.k1 / fps).toFixed(2)} s): ${n} frames in ${meta.wallSeconds.toFixed(0)} s` +
      `${meta.blanks.length ? `, ${meta.blanks.length} blank frames repaired` : ''}${meta.errors.length ? `, ${meta.errors.length} page errors` : ''}`);
  }
} finally {
  await app.browser.close();
}
