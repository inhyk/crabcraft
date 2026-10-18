#!/usr/bin/env node
// A complete highlight edit, including the lighthouse cycle, night party and original final hit.
// --source <updated-full.mp4> --out <short.mp4> [--work <scratch>]
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { FPS } from './plan.mjs';
const args = process.argv.slice(2);
const opt = (k, d) => args.includes(k) ? args[args.indexOf(k) + 1] : d;
if (!opt('--source') || !opt('--out')) throw new Error('--source and --out are required');
const source = resolve(opt('--source')), output = resolve(opt('--out'));
if (source === output) throw new Error('Output must differ from source');
const work = resolve(opt('--work', `${output}-work`));
mkdirSync(work, { recursive: true }); mkdirSync(dirname(output), { recursive: true });
const grid = JSON.parse(readFileSync(new URL('../grid.json', import.meta.url)));
const bar = n => Math.round(grid.downbeats[n] * FPS);
const ranges = [[0,bar(16)],[bar(20),bar(24)],[bar(29),bar(33)],[bar(37),bar(39)],
  [bar(44),bar(48)],[bar(61),bar(65)],[bar(89),bar(93)],[bar(97),9837]];
const run = (cmd, argv) => {
  const r = spawnSync(cmd, argv, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} exited ${r.status}: ${r.stderr}`);
  return r.stdout + r.stderr;
};
const probe = f => JSON.parse(run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',f]));
const original = probe(source).streams.find(s=>s.codec_type==='video');
if (original.width !== 1080 || original.height !== 1920 || original.r_frame_rate !== '60/1' || Number(original.nb_frames) !== 9837) throw new Error('Source must be the full a4 portrait edit');
let cursor = 0;
const timeline = [], videos = [], audios = [];
for (const [i,[a,b]] of ranges.entries()) {
  const frames = b-a, seconds = frames/FPS;
  const v = resolve(work, `part-${i}.mp4`), audio = resolve(work, `part-${i}.wav`);
  console.log(`Short part ${i+1}/${ranges.length}: source ${a/FPS}-${b/FPS}s`);
  run('ffmpeg',['-hide_banner','-v','error','-y','-ss',String(a/FPS),'-i',source,'-an',
    '-vf','setpts=PTS-STARTPTS,setsar=1','-frames:v',String(frames),'-r',String(FPS),
    '-c:v','libx264','-preset','medium','-crf','17','-profile:v','high','-g','120',
    '-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-color_range','tv',
    '-video_track_timescale','15360',v]);
  // Four-millisecond fades remove waveform clicks at the music edits without moving any beats.
  run('ffmpeg',['-hide_banner','-v','error','-y','-ss',String(a/FPS),'-i',source,'-vn',
    '-af',`aresample=48000,atrim=end_sample=${frames*800},asetpts=PTS-STARTPTS,afade=t=in:d=0.004,afade=t=out:st=${seconds-0.004}:d=0.004`,
    '-ar','48000','-ac','2','-c:a','pcm_f32le',audio]);
  if (Number(probe(v).streams[0].nb_frames) !== frames) throw new Error(`Wrong frame count in part ${i}`);
  timeline.push({ sourceFrom:a/FPS, sourceTo:b/FPS, from:cursor/FPS, to:(cursor+frames)/FPS });
  cursor+=frames; videos.push(v); audios.push(audio);
}
const list = (name, files) => {
  const p=resolve(work,name);writeFileSync(p,files.map(f=>`file '${f.replaceAll("'","'\\''")}'`).join('\n'));return p;
};
const audioList=list('audio.txt',audios), videoList=list('video.txt',videos);
const ln='I=-14:TP=-1.5:LRA=11';
const scan=run('ffmpeg',['-hide_banner','-nostats','-f','concat','-safe','0','-i',audioList,'-af',`loudnorm=${ln}:print_format=json`,'-f','null','-']);
const measured=JSON.parse(scan.slice(scan.lastIndexOf('{'),scan.lastIndexOf('}')+1));
const normalize=`loudnorm=${ln}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true,atrim=duration=${cursor/FPS}`;
run('ffmpeg',['-hide_banner','-v','error','-y','-f','concat','-safe','0','-i',videoList,
  '-f','concat','-safe','0','-i',audioList,'-map','0:v:0','-map','1:a:0','-c:v','copy',
  '-af',normalize,'-c:a','aac','-b:a','256k','-ar','48000','-ac','2',
  '-map_metadata','-1','-movflags','+faststart',output]);
const result=probe(output), v=result.streams.find(s=>s.codec_type==='video');
if(Number(v.nb_frames)!==cursor)throw new Error('Final frame count mismatch');
const check=run('ffmpeg',['-hide_banner','-nostats','-i',output,'-vf','blackdetect=d=0.05:pix_th=0.10:pic_th=0.98,blackframe=amount=98:threshold=32','-af','ebur128=peak=true','-f','null','-']);
const blackRuns=[...check.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)];
const blackFrames=[...check.matchAll(/frame:(\d+) pblack:(\d+)/g)];
const I=Number([...check.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].pop()[1]);
const peak=Number([...check.matchAll(/Peak:\s+(-?[\d.]+) dBFS/g)].pop()[1]);
if(blackRuns.length||blackFrames.length||Math.abs(I+14)>0.6)throw new Error(`Final media checks failed: ${JSON.stringify({blackRuns:blackRuns.length,blackFrames:blackFrames.length,integratedLUFS:I})}`);
const report={file:output,frames:cursor,duration:Number(result.format.duration),width:v.width,height:v.height,fps:v.r_frame_rate,
  blackRuns:0,blackFrames:0,integratedLUFS:I,truePeakDBFS:peak,timeline,ending:'original final chorus, hit and freeze'};
writeFileSync(output.replace(/\.mp4$/,'-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2)); console.log('CHECKS PASSED');
