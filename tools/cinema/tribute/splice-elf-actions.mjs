#!/usr/bin/env node
// Replace only the run in an existing tribute, preserving its audio and other frame ranges.
// No media is bundled. Example:
// node tools/cinema/tribute/splice-elf-actions.mjs --source /absolute/tribute.mp4 \
//   --shots /absolute/rendered-shots --out /absolute/output-folder
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ELF_ACTIONS } from './scenes/elf-actions.mjs';
const opt = (name) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
for (const key of ['--source', '--shots', '--out']) if (!opt(key)) throw new Error(`Required ${key}`);
const source = resolve(opt('--source')), shotsDir = resolve(opt('--shots')), out = resolve(opt('--out'));
mkdirSync(out, { recursive: true });
const ff = (args) => {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
  if (r.status) throw new Error(`ffmpeg exit ${r.status}`);
};
const probe = (file) => JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-count_packets', '-show_streams', '-of', 'json', file], { encoding: 'utf8' }).stdout);
const video = (file) => probe(file).streams.find((s) => s.codec_type === 'video');
const sourceVideo = video(source);
if (sourceVideo.r_frame_rate !== '24/1' || sourceVideo.width !== 1920 || sourceVideo.height !== 1080) throw new Error('Source must be the 1920x1080, 24 fps tribute');
const k0 = Math.round(ELF_ACTIONS[0].at * 24), k1 = Math.round(ELF_ACTIONS.at(-1).end * 24);
const inputs = [], filters = [];
for (const [i, a] of ELF_ACTIONS.entries()) {
  const file = resolve(shotsDir, `${a.id}.mp4`);
  const frames = Math.round(a.end * 24) - Math.round(a.at * 24);
  if (Number(video(file).nb_read_packets) !== frames) throw new Error(`Wrong frame count: ${a.id}`);
  inputs.push('-i', file);
  filters.push(`[${i}:v]trim=end_frame=${frames},setpts=PTS-STARTPTS,scale=1920:872:flags=lanczos,setsar=1[v${i}]`);
}
filters.push(`${ELF_ACTIONS.map((_, i) => `[v${i}]`).join('')}concat=n=${ELF_ACTIONS.length}:v=1:a=0,pad=1920:1080:0:104:black[v]`);
const master = resolve(out, 'elf-actions-master.mp4');
ff([...inputs, '-filter_complex', filters.join(';'), '-map', '[v]', '-an', '-c:v', 'libx264', '-crf', '15', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', master]);
const full = resolve(out, 'tribute-v14-elf-actions.mp4');
ff(['-i', source, '-i', master, '-filter_complex', `[0:v]split=2[b][a];[b]trim=end_frame=${k0},setpts=PTS-STARTPTS[before];[a]trim=start_frame=${k1},setpts=PTS-STARTPTS[after];[before][1:v][after]concat=n=3:v=1:a=0[v]`, '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-crf', '16', '-preset', 'slow', '-c:a', 'copy', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', full]);
const got = Number(video(full).nb_read_packets), expected = Number(sourceVideo.nb_read_packets);
if (got !== expected) throw new Error(`Full edit: ${got} frames, expected ${expected}`);
// Review clip includes the close-up cue and original transformation, so both cuts can be judged.
const preview = resolve(out, 'elf-actions-review.mp4');
ff(['-ss', '72', '-i', full, '-t', '21', '-map', '0:v', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', preview]);
const compare = resolve(out, 'elf-actions-before-after.mp4');
ff(['-ss', String(k0 / 24), '-i', source, '-i', master, '-filter_complex', '[0:v]scale=960:540[a];[1:v]scale=960:540[b];[a][b]vstack=inputs=2[v]', '-map', '[v]', '-map', '0:a?', '-t', String((k1 - k0) / 24), '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', compare]);
writeFileSync(resolve(out, 'edit-report.json'), JSON.stringify({ source, sourceFrames: expected, resultFrames: got, replaced: { fromFrame: k0, toFrame: k1, frames: k1 - k0 }, master, full, preview, compare, moves: ELF_ACTIONS }, null, 2));
console.log(JSON.stringify({ frames: got, replacedFrames: k1 - k0, full, preview, compare }));
