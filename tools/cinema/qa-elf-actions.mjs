#!/usr/bin/env node
// Verify the edit contract, then every rendered pose in Chrome for Testing.
// Usage: node tools/cinema/qa-elf-actions.mjs --url http://127.0.0.1:5357 --out /absolute/qa.json
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { openApp, advance } from '../trailer/lib.mjs';
import { shots as original } from './tribute/scenes/night.mjs';
import { ELF_ACTIONS, withElfActions } from './tribute/scenes/elf-actions.mjs';
const opt = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const shots = withElfActions(original);
const selected = shots.filter((s) => ELF_ACTIONS.some((a) => a.id === s.id));
const fps = 24;
let edge = Math.round(74.6 * fps);
for (const shot of selected) {
  assert.equal(Math.round(shot.at * fps), edge, `edit gap at ${shot.id}`);
  edge = Math.round((shot.at + shot.length) * fps);
  const act = shot.tracks.elf.acts[0];
  const clip = JSON.parse(readFileSync(new URL(`../../public/motions/${act.clip}.json`, import.meta.url)));
  assert.ok(act.from >= 0 && act.to <= (clip.frameCount - 1) / clip.fps, `invalid window ${act.clip}`);
  assert.ok(act.t + (act.to - act.from) / act.speed <= shot.length + 0.03, `cut clips action ${act.clip}`);
}
assert.equal(edge, Math.round(88 * fps));
for (const shot of original.filter((s) => s.id !== 'night-elf-run')) assert.deepEqual(shots.find((s) => s.id === shot.id), shot, `unrelated shot changed: ${shot.id}`);
const last = selected.at(-1).tracks.elf.path.at(-1);
assert.ok(Math.abs(last.x + 90.5) < 1e-6 && Math.abs(last.z - 94.5) < 1e-6 && Math.abs(last.lift - 1.15) < 1e-6, 'transform seam moved');
const app = await openApp({ base: opt('--url', 'http://127.0.0.1:5357'), query: 'screen=game', size: [1280, 582], dsf: 1 });
const report = { editFrames: edge - Math.round(74.6 * fps), shots: [], errors: app.errors, failures: [] };
try {
  const start = app.page.locator('.launch-notice-start');
  if (await start.count()) await start.first().click({ timeout: 30000 });
  await app.page.waitForFunction(() => window.app?.current?.game?.loaded && !document.querySelector('.loading'), null, { timeout: 180000 });
  await app.page.evaluate(async () => {
    (await import('/src/capture/cinema/index.ts')).default.init();
    window.__qaThree = await import('/node_modules/three/build/three.module.js');
    window.__capture.begin();
  });
  for (const shot of selected) {
    await app.page.evaluate((s) => window.__cinema.stage(s), shot);
    await app.page.evaluate(() => window.__cinema.seek(-1.5));
    await advance(app, 1.5, fps);
    const frames = Math.round((shot.at + shot.length) * fps) - Math.round(shot.at * fps);
    const poses = [];
    for (let f = 0; f < frames; f++) {
      if (f) await app.page.evaluate(() => window.__capture.step(1, 1000 / 24));
      poses.push(await app.page.evaluate(() => {
        const T = window.__qaThree;
        const a = window.__cinema.actors.get('elf');
        const g = window.app.current.game;
        const box = new T.Box3();
        // Skinned and rigid geometry, visible attachments included, hidden shadow proxy excluded.
        a.unit.rig.root.updateWorldMatrix(true, true);
        a.unit.rig.root.traverseVisible((o) => { if (o.isMesh && o.name !== 'shadow-proxy') box.expandByObject(o, true); });
        const projected = [];
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) projected.push(new T.Vector3(x, y, z).project(g.camera));
        const body = a.unit.rig.body;
        const act = a.unit.motion.actions?.at(-1);
        return { t: window.__cinema.time, min: [Math.min(...projected.map((v) => v.x)), Math.min(...projected.map((v) => v.y))], max: [Math.max(...projected.map((v) => v.x)), Math.max(...projected.map((v) => v.y))], action: act?.id ?? null, clipTime: act?.t ?? null, body: body.position.toArray(), rotation: body.quaternion.toArray() };
      }));
    }
    const clipped = poses.filter((p) => p.min.some((n) => n < -1) || p.max.some((n) => n > 1));
    const active = poses.filter((p) => p.action === shot.tracks.elf.acts[0].clip);
    const result = { id: shot.id, frames, activeFrames: active.length, clippedFrames: clipped.length, extrema: { x: [Math.min(...poses.map((p) => p.min[0])), Math.max(...poses.map((p) => p.max[0]))], y: [Math.min(...poses.map((p) => p.min[1])), Math.max(...poses.map((p) => p.max[1]))] }, poses };
    if (['night-elf-backflip', 'night-elf-720'].includes(shot.id)) {
      const angles = [];
      for (const pose of active) {
        const [x, y, z, w] = pose.rotation;
        let angle = shot.id.endsWith('backflip')
          ? Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y))
          : Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + x * x));
        if (angles.length) {
          while (angle - angles.at(-1) > Math.PI) angle -= 2 * Math.PI;
          while (angle - angles.at(-1) < -Math.PI) angle += 2 * Math.PI;
        }
        angles.push(angle);
      }
      result.rotationDegrees = (angles.at(-1) - angles[0]) * 180 / Math.PI;
      const expected = shot.id.endsWith('backflip') ? 360 : 720;
      if (Math.abs(Math.abs(result.rotationDegrees) - expected) > 20) report.failures.push(`${shot.id}: rotation ${result.rotationDegrees.toFixed(1)}, expected ${expected}`);
    }
    report.shots.push(result);
    if (clipped.length) report.failures.push(`${shot.id}: ${clipped.length} frames outside camera`);
    if (!active.length) report.failures.push(`${shot.id}: action never played`);
    console.log(JSON.stringify({ ...result, poses: undefined }));
  }
} finally {
  await app.browser.close();
  if (app.errors.length) report.failures.push(...app.errors);
  writeFileSync(opt('--out', '/tmp/elf-actions-qa.json'), JSON.stringify(report, null, 2));
}
assert.equal(report.failures.length, 0, report.failures.join('\n'));
console.log(`PASS: ${report.editFrames} frames, ${selected.length} motion clips, original surrounding shots unchanged, camera clipping 0, browser errors 0`);
