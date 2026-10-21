#!/usr/bin/env node
// Captures cinema shots frame by frame in the running game (src/capture/cinema, loaded by this script
// with a dynamic import on the dev server; src/capture/clock.ts steps time). One page renders every
// shot: it travels between worlds as the shots need, stages each shot, puts the shot clock a pre-roll
// before 0 and records the shot's frames.
//
// Usage: node tools/cinema/capture.mjs --url http://localhost:5311 --program <program.mjs> --out <dir>
//          [--shots id,id] [--fps 24] [--dsf 1] [--size 1920x872] [--preroll 1.5]
//          [--stills 0,1.5,3]   (stills at these shot seconds instead of a recording: <out>/<id>-<t>.jpg)
//          [--blur 6] [--shutter 0.5]   (motion blur: each frame averages that many renders spread over
//          the shutter's share of the frame interval, ending on the frame's instant; each render is
//          also shifted by a sub-pixel Halton offset, so the average is supersampled too)
// A program module exports `shots`: ShotSpec objects (src/capture/cinema/types.ts) with `at`, the
// song second the shot starts on in the edit. Writes <out>/<id>.mp4 and <id>.json (frames, blank
// repairs, page errors, the shot clock of every frame).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FFMPEG, Recorder, advance, grab, openApp, record } from '../trailer/lib.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const base = opt('--url', 'http://localhost:5311');
const programPath = resolve(opt('--program', 'program.mjs'));
const outDir = resolve(opt('--out', 'cinema-shots'));
const fps = Number(opt('--fps', '24'));
const dsf = Number(opt('--dsf', '1'));
const [w, h] = opt('--size', '1920x872').split('x').map(Number);
const preroll = Number(opt('--preroll', '1.5'));
const only = (opt('--shots', '') || '').split(',').filter(Boolean);
const stills = (opt('--stills', '') || '').split(',').filter(Boolean).map(Number);
const blur = Math.max(1, Math.round(Number(opt('--blur', '1'))));
const shutter = Math.min(1, Math.max(0.05, Number(opt('--shutter', '0.5'))));

/**
 * record() with motion blur: per frame, the clock moves through the closed part of the shutter in one
 * step, then through the open part in `blur` sub-steps, each one rendered and grabbed; the sub-frames
 * go to an intermediate file that ffmpeg averages back down `blur` to one. The last sub-step lands
 * on the frame's own instant, as record()'s single step does.
 */
/** The radical inverse of i in `base`: a low-discrepancy sequence in [0, 1). */
function halton(i, base) {
  let f = 1;
  let r = 0;
  for (let n = i; n > 0; n = Math.floor(n / base)) {
    f /= base;
    r += f * (n % base);
  }
  return r;
}

async function recordBlur(app, file, { frames, fps, probe }) {
  const sub = `${file}.sub.mp4`;
  const rec = new Recorder(sub, { fps: fps * blur, crf: 10 });
  const dt = 1000 / fps;
  const probes = [];
  const t0 = Date.now();
  await app.page.evaluate((d) => window.__capture.step(2, d), dt);
  await app.page.evaluate(() => window.__T?.rebase());
  for (let f = 0; f < frames; f++) {
    if (shutter < 1) await app.page.evaluate((d) => window.__capture.step(1, d), dt * (1 - shutter));
    for (let k = 0; k < blur; k++) {
      await app.page.evaluate((j) => (window.__cinema.jitter = j), [halton(k + 1, 2) - 0.5, halton(k + 1, 3) - 0.5]);
      await app.page.evaluate((d) => window.__capture.step(1, d), (dt * shutter) / blur);
      await rec.write(await grab(app));
    }
    if (probe) probes.push(await app.page.evaluate(probe));
  }
  await app.page.evaluate(() => (window.__cinema.jitter = [0, 0]));
  await rec.close();
  const r = spawnSync(FFMPEG, ['-v', 'error', '-y', '-i', sub, '-vf', `tmix=frames=${blur},select='not(mod(n+1\,${blur}))',setpts=N/(${fps}*TB)`, '-r', String(fps),
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '14', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', `${file}.mp4`], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg failed averaging ${sub}`);
  rmSync(sub, { force: true });
  const meta = { frames, fps, blur, shutter, wallSeconds: (Date.now() - t0) / 1000, blanks: [], errors: app.errors.slice(), probe: probes };
  writeFileSync(`${file}.json`, JSON.stringify(meta));
  return meta;
}
mkdirSync(outDir, { recursive: true });

const { shots } = await import(pathToFileURL(programPath).href);
const todo = shots.filter((s) => !only.length || only.includes(s.id));
if (!todo.length) throw new Error(`no shots match ${only.join(',')}`);
// Fewest trips between worlds: shots grouped by world, in program order within one.
todo.sort((a, b) => a.chapter - b.chapter);

const app = await openApp({
  base,
  query: 'screen=game',
  spec: { race: 'human', sex: 'male', classId: 'warrior', shell: 0, crest: 0, led: 0, name: 'Camera' },
  size: [w, h],
  dsf,
  storage: { 'cc.language': 'ko', 'cc.musicVol': '0', 'cc.sfxVol': '0' },
});
const { page } = app;
const t0 = Date.now();
try {
  const start = page.locator('.launch-notice-start');
  if (await start.count().catch(() => 0)) await start.first().click({ timeout: 30000 }).catch(() => {});
  await page.waitForFunction(() => window.app?.current?.game?.loaded && !document.querySelector('.loading'), null, { timeout: 180000 });
  await page.waitForTimeout(1500);
  await page.evaluate(async () => {
    const m = await import('/src/capture/cinema/index.ts');
    m.default.init();
  });
  await page.evaluate(() => window.__capture.begin());
  console.log(`game ready in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

  for (const shot of todo) {
    // Travel, then step until the loading painting has gone and the world has settled.
    const moved = await page.evaluate((c) => window.__cinema.travel(c), shot.chapter);
    if (moved) {
      for (let i = 0; i < 40; i++) {
        await advance(app, 0.5, 30);
        const done = await page.evaluate((c) => window.__cinema.chapter === c && !document.querySelector('.loading'), shot.chapter);
        if (done) break;
      }
      await advance(app, 2, 30);
    }
    const st = await page.evaluate((s) => window.__cinema.stage(s), shot);
    // Frames on the edit's grid: the shot owns song frames round(at * fps) up to round((at + length) * fps).
    const frames = Math.round((shot.at + shot.length) * fps) - Math.round(shot.at * fps);
    const name = resolve(outDir, shot.id);
    if (stills.length) {
      for (const ts of stills) {
        await page.evaluate((t) => window.__cinema.seek(t), ts - preroll);
        await advance(app, preroll, fps);
        writeFileSync(`${name}-${ts.toFixed(2)}.jpg`, await grab(app, 88));
      }
      console.log(`${shot.id}: ${stills.length} stills (${st.actors} actors)`);
      continue;
    }
    const pre = Math.round(preroll * fps);
    // record() steps two frames before its first one, and each frame before grabbing it: the first
    // recorded frame is shot time 0.
    await page.evaluate((t) => window.__cinema.seek(t), -(pre + 3) / fps);
    await advance(app, pre / fps, fps);
    const meta = blur > 1
      ? await recordBlur(app, name, { frames, fps, probe: () => window.__cinema.probe() })
      : await record(app, name, { duration: frames / fps, fps, probe: () => window.__cinema.probe(), log: false });
    const first = meta.probe[0]?.t ?? NaN;
    if (Math.abs(first) > 0.5 / fps) console.warn(`  ${shot.id}: first frame at shot time ${first}, expected 0`);
    if (meta.frames !== frames) throw new Error(`${shot.id}: ${meta.frames} frames, expected ${frames}`);
    console.log(`${shot.id} (song ${shot.at.toFixed(2)} s, ${frames} frames, world ${shot.chapter}): ${meta.wallSeconds.toFixed(0)} s` +
      `${meta.blanks.length ? `, ${meta.blanks.length} blank frames repaired` : ''}${meta.errors.length ? `, ${meta.errors.length} page errors` : ''}`);
  }
} finally {
  if (app.errors.length) console.log(`page errors:\n  ${app.errors.slice(0, 12).join('\n  ')}`);
  await app.browser.close();
}
