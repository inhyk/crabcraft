#!/usr/bin/env node
// Retain the original edit outside the inserts and copy its AAC stream without re-encoding.
// node tools/crowd/sidestep-a4/cinema/edit.mjs --source <a4-port.mp4> --shots <capture-dir> --out <new.mp4>
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { shots, FPS, lighthousePulseSeconds } from './plan.mjs';
const args = process.argv.slice(2);
const need = (k) => {
  if (!args.includes(k) || !args[args.indexOf(k) + 1]) throw new Error(`${k} required`);
  return resolve(args[args.indexOf(k) + 1]);
};
const source = need('--source'), captured = need('--shots'), output = need('--out');
const night = args.includes('--night-lighthouse') ? need('--night-lighthouse') : null;
if (source === output) throw new Error('Output must differ from source');
const work = resolve(captured, 'edit');
mkdirSync(work, { recursive: true });
mkdirSync(dirname(output), { recursive: true });
const run = (command, argv) => {
  const r = spawnSync(command, argv, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${command} exited ${r.status}: ${r.stderr}`);
  return r.stdout + r.stderr;
};
const probe = (f) => JSON.parse(run('ffprobe', ['-v','error','-show_streams','-show_format','-of','json',f]));
const original = probe(source), video = original.streams.find(s => s.codec_type === 'video');
if (video.width !== 1080 || video.height !== 1920 || video.r_frame_rate !== '60/1') throw new Error('Source must be the a4 portrait 1080x1920/60 video');
const total = Number(video.nb_frames), segments = [];
const pulseFrames = Math.round(lighthousePulseSeconds * FPS);
let lighthouseCycle = null;
if (night) {
  const meta = JSON.parse(readFileSync(night.replace(/\.mp4$/, '.json')));
  const s = shots.find(s => s.id === 'lighthouse-bank');
  if (meta.frames !== s.frames || meta.blanks.length || meta.errors.length) throw new Error('Unchecked night lighthouse capture');
  lighthouseCycle = resolve(work, 'lighthouse-cycle.mp4');
  run('ffmpeg', ['-hide_banner','-v','error','-y','-i',resolve(captured,'lighthouse-bank.mp4'),'-i',night,
    '-filter_complex',`[0:v][1:v]blend=all_expr='if(mod(floor((T*${FPS}+0.01)/${pulseFrames}),2),B,A)',format=yuv420p[v]`,
    '-map','[v]','-an','-frames:v',String(s.frames),'-r',String(FPS),'-c:v','libx264','-preset','medium','-crf','14',lighthouseCycle]);
}
let cursor = 0;
for (const s of shots) {
  if (s.start < cursor || s.end > total) throw new Error(`Invalid insert ${s.id}`);
  if (s.start > cursor) segments.push({ file: source, start: cursor, frames: s.start - cursor, source: true });
  const file = s.id === 'lighthouse-bank' && lighthouseCycle ? lighthouseCycle : resolve(captured, `${s.id}.mp4`);
  const meta = JSON.parse(readFileSync(resolve(captured, `${s.id}.json`)));
  if (meta.frames !== s.frames || meta.blanks.length || meta.errors.length) throw new Error(`Unchecked capture ${s.id}`);
  if(s.program.cues.length && meta.probe.some(f=>!f.motion||f.motion.maxScreenOverlap>.001||f.motion.frameMargin<8||f.motion.maxBodyStepNormalized>.18||f.motion.maxTurn>20)) throw new Error(`Motion audit failed for ${s.id}`);
  segments.push({ file, start: 0, frames: s.frames, source: false, id: s.id });
  cursor = s.end;
}
if (cursor < total) segments.push({ file: source, start: cursor, frames: total - cursor, source: true });
const parts = [];
for (const [i, s] of segments.entries()) {
  const file = resolve(work, `part-${String(i).padStart(2,'0')}.mp4`);
  console.log(`Part ${i + 1}/${segments.length}: ${s.id ?? 'original crowd'} (${s.frames} frames)`);
  const filters = ['setpts=PTS-STARTPTS'];
  if (!s.source) filters.push('scale=in_color_matrix=bt601:out_color_matrix=bt709:in_range=tv:out_range=tv');
  filters.push('setsar=1', 'format=yuv420p');
  run('ffmpeg', ['-hide_banner','-v','error','-y','-ss',String(s.start / FPS),'-i',s.file,
    '-an','-vf',filters.join(','),'-frames:v',String(s.frames),'-r',String(FPS),
    '-c:v','libx264','-preset','medium','-crf','17','-profile:v','high','-g','120',
    '-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-color_range','tv',
    '-video_track_timescale','15360', file]);
  const n = Number(probe(file).streams.find(s=>s.codec_type==='video').nb_frames);
  if (n !== s.frames) throw new Error(`${file}: ${n} frames, wanted ${s.frames}`);
  parts.push(file);
}
const list = resolve(work, 'concat.txt');
writeFileSync(list, parts.map(f => `file '${f.replaceAll("'", "'\\''")}'`).join('\n'));
run('ffmpeg', ['-hide_banner','-v','error','-y','-f','concat','-safe','0','-i',list,'-i',source,
  '-map','0:v:0','-map','1:a:0','-c','copy','-map_metadata','-1','-movflags','+faststart',output]);
const result = probe(output);
const v = result.streams.find(s=>s.codec_type==='video');
if (Number(v.nb_frames) !== total) throw new Error(`Expected ${total} frames, got ${v.nb_frames}`);
const audioHash = f => run('ffmpeg',['-v','error','-i',f,'-map','0:a:0','-c:a','copy','-f','hash','-hash','sha256','-']).trim();
const a0 = audioHash(source), a1 = audioHash(output);
if (a0 !== a1) throw new Error('Audio packets changed');
const black = run('ffmpeg',['-hide_banner','-nostats','-i',output,'-vf','blackdetect=d=0.05:pix_th=0.10:pic_th=0.98,blackframe=amount=98:threshold=32','-an','-f','null','-']);
const blackRuns = [...black.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map(m=>[Number(m[1]),Number(m[2])]);
const blackFrames = [...black.matchAll(/frame:(\d+) pblack:(\d+)/g)].map(m=>Number(m[1]));
if (blackRuns.length || blackFrames.length) throw new Error('Black frames in final output');
const report = { file: output, source, sourceSHA256: createHash('sha256').update(readFileSync(source)).digest('hex'),
  frames: total, fps: v.r_frame_rate, width: v.width, height: v.height, duration: Number(result.format.duration),
  sizeBytes: Number(result.format.size), audioIdentical: true, audioSHA256: a1,
  insertSeconds: shots.reduce((n,s)=>n+s.frames,0)/FPS,
  lighthouseCycle: night ? { periodFrames: pulseFrames, states: ['day-off','night-on'], duration: 6.4 } : null,
  shots: shots.map(({program,...s})=>s), blackRuns, blackFrames, captureBlankFrames: 0, pageErrors: 0 };
writeFileSync(output.replace(/\.mp4$/, '-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log('CHECKS PASSED');
