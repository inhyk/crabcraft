#!/usr/bin/env node
// Actual Clawhaven scenery and the game's crab rigs/recorded motions, in the dev-only crowd scene.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openApp, advance, record, grab } from '../../../trailer/lib.mjs';
import { shots, FPS } from './plan.mjs';
const args = process.argv.slice(2);
const opt = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const dir = resolve(opt('--out', 'scratch/sidestep-cinema'));
const only = opt('--shots', '').split(',').filter(Boolean);
const preview = args.includes('--preview');
const nightLighthouse = args.includes('--night-lighthouse');
mkdirSync(dir, { recursive: true });
const app = await openApp({ base: opt('--url', 'http://localhost:5297'), query: 'screen=crowd', size: [1080, 1920], dsf: Number(opt('--dsf', '1')) });
try {
  await app.page.waitForFunction(() => window.__crowd?.ready, null, { timeout: 180000 });
  await app.page.evaluate(() => window.__capture.begin());
  for (const s of shots.filter((s) => !only.length || only.includes(s.id))) {
    const file = resolve(dir, s.id);
    const p = nightLighthouse && s.id === 'lighthouse-bank' ? {
      ...s.program, fx: [{ at: -10, kind: 'mood', mood: 2 }, { at: -10, kind: 'beacon', on: true }],
    } : s.program;
    const stats = await app.page.evaluate((p) => window.__crowd.load(p, { layout: 'port' }), p);
    if (p.cues.length) await app.page.evaluate(async () => {
      const { installAudit } = await import('/tools/crowd/sidestep-a4/cinema/audit-page.mjs');
      installAudit(window.__crowd);
    });
    // Flyover crabs live offscreen; the six performers are visible in the group shots.
    console.log(`${s.id}: ${stats.crabs} crabs, ${s.frames} frames`);
    if (preview) {
      for (const u of [0.05, 0.5, 0.95]) {
        await app.page.evaluate(([t, mood]) => {
          window.__crowd.seek(t - 3 / 60);
          window.__crowd.world.setMood(mood, true);
        }, [p.length * u, p.fx[0].mood]);
        await app.page.evaluate(() => window.__capture.step(3, 1000 / 60));
        writeFileSync(`${file}-${u}.jpg`, await grab(app));
      }
    } else {
      await app.page.evaluate((mood) => {
        window.__crowd.seek(-2 - 3 / 60);
        window.__crowd.world.setMood(mood, true);
      }, p.fx[0].mood);
      await advance(app, 2, FPS);
      const meta = await record(app, file, { duration: s.frames / FPS, fps: FPS, stills: [0, Math.floor(s.frames / 2)], probe: () => ({ ...window.__crowd.probe(), terrain: window.__crowd.crowd.terrainAudit,
        motion: window.__crowd.crowd.program.cues.length ? window.__crowd.auditFrame() : null,
      }) });
      if (meta.frames !== s.frames || meta.errors.length || meta.blanks.length) throw new Error(`${s.id}: capture failed: ${JSON.stringify({frames: meta.frames, errors: meta.errors, blanks: meta.blanks})}`);
      if (Math.abs(meta.probe[0].t) > 0.5 / FPS) throw new Error(`${s.id}: incorrect first frame time`);
      if (p.terrainClearance !== undefined && meta.probe.some(f => !f.terrain || !Number.isFinite(f.terrain.minClearance) || f.terrain.minClearance < p.terrainClearance - 1e-5)) throw new Error(`${s.id}: terrain clearance failed`);
      if(p.cues.length){
        const bad=meta.probe.filter(f=>!f.motion||f.motion.maxScreenOverlap>0.001||f.motion.frameMargin<8||f.motion.maxBodyStepNormalized>.18||f.motion.maxTurn>20);
        if(bad.length)throw new Error(`${s.id}: ${bad.length} frames failed overlap/continuity/framing audit: ${JSON.stringify(bad[0].motion)}`);
      }
    }
  }
  writeFileSync(resolve(dir, 'shots.json'), JSON.stringify(shots.map(({program, ...s}) => s), null, 2));
  if (app.errors.length) throw new Error(app.errors.join('\n'));
} finally { await app.browser.close(); }
