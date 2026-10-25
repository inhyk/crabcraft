#!/usr/bin/env node
// Cuts the tribute: the 2D cards and the 3D shots laid on the 24 fps grid of timeline.mjs, black
// wherever nothing is rendered yet, letterboxed to 1920x1080 (2.2:1 picture), with the reference
// soundtrack the user supplies (its audio stream is copied untouched unless --gain is given; it never
// enters the repo).
//
// Usage: node tools/cinema/tribute/edit.mjs --soundtrack <video or audio file> --cards <dir>
//          --shots <dir>[,<dir>...] --out <file.mp4> [--compare <file.mp4>] [--reference <video>]
//          [--program <program.mjs>] [--gain <dB>]
// --compare also writes the original (from --reference, default the soundtrack file) above the
// tribute, frame for frame, for review. --gain raises the soundtrack by that many dB and re-encodes it,
// with a limiter that keeps the peaks under -1 dB (+4 takes the original's -15.4 LUFS to about -12).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FFMPEG } from '../../trailer/lib.mjs';
import { FPS, LENGTH, RANGES } from './timeline.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const soundtrack = resolve(opt('--soundtrack', ''));
const cardsDir = resolve(opt('--cards', 'cards'));
const shotDirs = opt('--shots', '').split(',').filter(Boolean).map((d) => resolve(d));
const out = resolve(opt('--out', 'tribute.mp4'));
const compare = opt('--compare', null);
const reference = resolve(opt('--reference', soundtrack));
const gain = Number(opt('--gain', 0));
// The shots' timing comes from the program (default: this folder's program.mjs).
const { shots } = await import(pathToFileURL(resolve(opt('--program', new URL('./program.mjs', import.meta.url).pathname))).href);
if (!existsSync(soundtrack)) throw new Error(`soundtrack not found: ${soundtrack}`);
mkdirSync(dirname(out), { recursive: true });

const run = (argv) => {
  const r = spawnSync(FFMPEG, ['-v', 'error', '-y', ...argv], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${argv.join(' ')}`);
};
const frames = (file) => {
  const r = spawnSync('ffprobe', ['-v', 'error', '-count_packets', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return parseInt(r.stdout, 10);
};
const K = (t) => Math.round(t * FPS);
const total = K(LENGTH);

// Segments: cards, then every rendered shot, on the frame grid.
const segs = [];
for (const r of RANGES.filter((r) => r.owner === 'cards')) {
  const f = resolve(cardsDir, `${r.id}.mp4`);
  if (existsSync(f)) segs.push({ id: r.id, k0: K(r.from), k1: K(r.to), file: f });
}
for (const s of shots) {
  const f = shotDirs.map((d) => resolve(d, `${s.id}.mp4`)).find((p) => existsSync(p));
  if (f) segs.push({ id: s.id, k0: K(s.at), k1: K(s.at + s.length), file: f });
  else console.log(`missing shot ${s.id} (${s.at}-${(s.at + s.length).toFixed(2)} s): black`);
}
segs.sort((a, b) => a.k0 - b.k0);
// Fill the gaps with black and refuse overlaps.
const timeline = [];
let k = 0;
for (const s of segs) {
  if (s.k0 < k) throw new Error(`${s.id} starts at frame ${s.k0}, before the previous segment ends (${k})`);
  if (s.k0 > k) timeline.push({ id: 'black', k0: k, k1: s.k0, file: null });
  timeline.push(s);
  k = s.k1;
}
if (k < total) timeline.push({ id: 'black', k0: k, k1: total, file: null });

const report = [];
const inputs = [];
const filters = [];
let nIn = 0;
timeline.forEach((s, i) => {
  const n = s.k1 - s.k0;
  if (s.file) {
    const have = frames(s.file);
    if (have < n) throw new Error(`${s.id}: ${have} frames, the timeline needs ${n}`);
    inputs.push('-i', s.file);
    filters.push(`[${nIn++}:v]trim=end_frame=${n},setpts=PTS-STARTPTS,fps=${FPS},scale=1920:872,setsar=1,format=yuv420p[v${i}]`);
  } else {
    inputs.push('-f', 'lavfi', '-i', `color=c=black:s=1920x872:r=${FPS}:d=${(n / FPS).toFixed(4)}`);
    filters.push(`[${nIn++}:v]trim=end_frame=${n},setpts=PTS-STARTPTS,format=yuv420p[v${i}]`);
  }
  report.push({ id: s.id, from: +(s.k0 / FPS).toFixed(3), to: +(s.k1 / FPS).toFixed(3), frames: n, file: s.file });
});
const audioIndex = nIn++;
inputs.push('-i', soundtrack);
filters.push(`${timeline.map((_, i) => `[v${i}]`).join('')}concat=n=${timeline.length}:v=1:a=0,pad=1920:1080:0:104:black[vout]`);
run([...inputs, '-filter_complex', filters.join(';'), '-map', '[vout]', '-map', `${audioIndex}:a:0`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(FPS), ...(gain ? ['-af', `volume=${gain}dB,alimiter=limit=0.79:level=false`, '-c:a', 'aac', '-b:a', '256k'] : ['-c:a', 'copy']), '-movflags', '+faststart', out]);
const got = frames(out);
writeFileSync(out.replace(/\.mp4$/, '-timeline.json'), JSON.stringify({ frames: got, expected: total, segments: report }, null, 1));
// A short picture drifts against the soundtrack: refuse it (a shot file rewritten mid-edit does this).
if (got !== total) throw new Error(`${out}: ${got} frames, expected ${total}; re-run once no shot is being rendered`);
console.log(`${out}: ${got} frames (expected ${total}), ${timeline.filter((s) => s.file).length} segments rendered, ${timeline.filter((s) => !s.file).length} black`);

if (compare) {
  // The original above, the tribute below, each at 960 wide.
  run(['-i', reference, '-i', out, '-filter_complex', '[0:v]scale=960:540,setsar=1[a];[1:v]scale=960:540,setsar=1[b];[a][b]vstack=inputs=2[v]', '-map', '[v]', '-map', '1:a', '-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-c:a', 'copy', '-shortest', resolve(compare)]);
  console.log(`${resolve(compare)}: original above, tribute below`);
}
