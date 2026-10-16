#!/usr/bin/env node
// A crowd dance video, end to end, in one command: build the program from a choreography and a
// beat grid against this checkout's clips (lib.mjs), serve the app, capture every shot in each
// layout (capture.mjs, several pages at once), join the shots, lay the song under them normalised
// to -14 LUFS, encode H.264 high + AAC at 60 fps, draw contact sheets and check the results
// (ffprobe specs, loudness, black frames, silence, blank-frame repairs, page errors). Re-run it after
// the clips are re-recorded: the choreography reads their events and tempo from public/motions.
//
//   node tools/crowd/make.mjs --choreo <choreo.mjs> --beats <grid.json> --audio <song>
//     --out-dir <dir> [--name crowd] [--work <scratch dir>]
//     [--layouts land,port]        which videos (land 1920x1080, port 1080x1920)
//     [--workers 2]                capture pages per layout running at once
//     [--url http://localhost:5291 | --port 5291]   a running dev server, or the port for one
//     [--dsf 2] [--fps 60] [--preroll 3] [--reuse] [--skip-capture] [--shots 0,3]
//     [--options '{"json":1}']     passed to the choreography's build()
//
// The choreography is a module whose default export build({ grid, clips, options }) returns the
// program (src/capture/crowd/program.ts); the grid is { beat, downbeats, beats? } in seconds of the
// audio file. Writes <out-dir>/<name>-1920x1080.mp4 and <name>-1080x1920.mp4, their contact sheets
// (<name>-1920x1080-sheet.jpg ...) and <work>/report.json. Needs ffmpeg, uv and installed Chrome.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProgram, shotName, shotRanges } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const flag = (name) => args.includes(name);
const need = (name) => {
  const v = opt(name);
  if (!v) throw new Error(`${name} is required (see the usage at the top of tools/crowd/make.mjs)`);
  return resolve(v);
};
const choreo = need('--choreo');
const beats = need('--beats');
const audio = need('--audio');
const outDir = need('--out-dir');
const name = opt('--name', 'crowd');
const work = resolve(opt('--work', resolve(outDir, `${name}-work`)));
const layouts = opt('--layouts', 'land,port').split(',');
const workers = Math.max(1, Number(opt('--workers', '2')));
const dsf = opt('--dsf', '2');
const fps = Number(opt('--fps', '60'));
const preroll = opt('--preroll', '3');
const options = JSON.parse(opt('--options', '{}'));
const port = Number(opt('--port', '5291'));
let url = opt('--url', '');
const SIZE = { land: [1920, 1080], port: [1080, 1920] };
const OUT = Object.fromEntries(layouts.map((l) => [l, resolve(outDir, `${name}-${SIZE[l][0]}x${SIZE[l][1]}.mp4`)]));
for (const d of [outDir, work]) mkdirSync(d, { recursive: true });

function run(cmd, argv, opts = {}) {
  console.log(`\n$ ${cmd} ${argv.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
  const r = spawnSync(cmd, argv, { cwd: repo, stdio: 'inherit', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} exited ${r.status}`);
}

function out(cmd, argv) {
  const r = spawnSync(cmd, argv, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`${cmd} ${argv.slice(0, 6).join(' ')} failed: ${r.stderr}`);
  return `${r.stdout}${r.stderr}`;
}

const runAsync = (cmd, argv, tag) =>
  new Promise((res, rej) => {
    const p = spawn(cmd, argv, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
    const pipe = (s) => s.on('data', (d) => process.stdout.write(String(d).replace(/^(?=.)/gm, `[${tag}] `)));
    pipe(p.stdout);
    pipe(p.stderr);
    p.on('close', (c) => (c === 0 ? res() : rej(new Error(`${tag} exited ${c}`))));
  });

async function up(u) {
  try {
    return (await fetch(u)).ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------- program

const program = await buildProgram({ choreo, grid: beats, repo, options });
const programFile = resolve(work, 'program.json');
writeFileSync(programFile, JSON.stringify(program));
const ranges = shotRanges(program, fps);
const frames = ranges[ranges.length - 1].k1;
console.log(`program: ${program.length.toFixed(2)} s, ${program.shots.length} shots, ${program.cues.length} cues, ${frames} frames per layout`);

// ---------------------------------------------------------------------------------- serve

let server = null;
if (!url && !flag('--skip-capture')) {
  url = `http://localhost:${port}`;
  if (await up(url)) throw new Error(`port ${port} is taken; pass --url to use that server or --port for another`);
  server = spawn('pnpm', ['dev', '--port', String(port), '--strictPort'], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  server.stdout.on('data', () => {});
  server.stderr.on('data', () => {});
  for (let i = 0; i < 60 && !(await up(url)); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await up(url))) throw new Error(`the dev server did not come up on ${url}`);
  console.log(`dev server on ${url}`);
}
const stop = () => {
  if (server) {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {}
    server = null;
  }
};
process.on('exit', stop);
process.on('SIGINT', () => process.exit(130));

try {
  // -------------------------------------------------------------------------------- capture

  if (!flag('--skip-capture')) {
    const t0 = Date.now();
    const asked = (opt('--shots', '') || '').split(',').filter(Boolean).map(Number);
    const jobs = [];
    for (const l of layouts) {
      const all = asked.length ? asked : ranges.map((r) => r.index);
      // Longest shots first, dealt round to the workers so they finish together.
      const order = [...all].sort((a, b) => ranges[b].k1 - ranges[b].k0 - (ranges[a].k1 - ranges[a].k0));
      const groups = Array.from({ length: workers }, () => []);
      order.forEach((s, i) => groups[i % workers].push(s));
      groups.forEach((g, w) => {
        if (!g.length) return;
        const argv = [resolve(here, 'capture.mjs'), '--url', url, '--program', programFile, '--out', resolve(work, l), '--layout', l,
          '--dsf', dsf, '--fps', String(fps), '--preroll', preroll, '--shots', g.join(',')];
        if (flag('--reuse')) argv.push('--reuse');
        jobs.push(runAsync('node', argv, `${l}${workers > 1 ? `-${w}` : ''}`));
      });
    }
    await Promise.all(jobs);
    console.log(`captured in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  }
  stop();

  // -------------------------------------------------------------------------------- the song

  const length = frames / fps;
  const LN = 'I=-14:TP=-1.5:LRA=11';
  const cut = resolve(work, 'song-cut.wav');
  // The program's length of the song from its start (silence after the file's end).
  out('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-i', audio, '-af', `apad,atrim=0:${length.toFixed(6)},asetpts=PTS-STARTPTS`, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_f32le', cut]);
  const m1 = out('ffmpeg', ['-hide_banner', '-nostats', '-i', cut, '-af', `loudnorm=${LN}:print_format=json`, '-f', 'null', '-']);
  const j1 = JSON.parse(m1.slice(m1.lastIndexOf('{'), m1.lastIndexOf('}') + 1));
  const song = resolve(work, 'song.wav');
  const m2 = out('ffmpeg', ['-hide_banner', '-nostats', '-y', '-i', cut, '-af',
    `loudnorm=${LN}:measured_I=${j1.input_i}:measured_TP=${j1.input_tp}:measured_LRA=${j1.input_lra}:measured_thresh=${j1.input_thresh}:offset=${j1.target_offset}:linear=true:print_format=json`,
    '-ar', '48000', '-c:a', 'pcm_f32le', song]);
  const j2 = JSON.parse(m2.slice(m2.lastIndexOf('{'), m2.lastIndexOf('}') + 1));
  console.log(`song: measured ${j1.input_i} LUFS, ${j1.input_tp} dBTP; normalised ${j2.output_i} LUFS, ${j2.output_tp} dBTP (${j2.normalization_type})`);

  // -------------------------------------------------------------------------------- join, encode

  for (const l of layouts) {
    const dir = resolve(work, l);
    const list = resolve(dir, 'concat.txt');
    const files = ranges.map((r) => `${shotName(dir, r.index)}.mp4`);
    for (const f of files) if (!existsSync(f)) throw new Error(`missing ${f}: capture it first`);
    writeFileSync(list, files.map((f) => `file '${f}'`).join('\n'));
    const [W, H] = SIZE[l];
    run('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-r', String(fps), '-i', list, '-i', song,
      // The captured frames are full-range BT.601 JPEGs: out to limited-range BT.709.
      '-filter_complex', `[0:v]setpts=N/(${fps}*TB),scale=${W}:${H}:flags=lanczos:in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p[v]`,
      '-map', '[v]', '-map', '1:a', '-r', String(fps), '-frames:v', String(frames),
      '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '17', '-g', String(fps * 2),
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-shortest', '-movflags', '+faststart', OUT[l]]);
    const sheet = OUT[l].replace(/\.mp4$/, '-sheet.jpg');
    run('uv', ['run', '-q', '--with', 'pillow', 'python', resolve(repo, 'tools', 'trailer', 'contact_sheet.py'), OUT[l], sheet,
      '--every', '4', '--cols', l === 'port' ? '11' : '7', '--width', l === 'port' ? '200' : '320']);
  }

  // -------------------------------------------------------------------------------- checks

  const report = { program: { length: program.length, shots: program.shots.length, cues: program.cues.length, frames }, song: { measured: j1, normalised: j2 } };
  for (const l of layouts) {
    const f = OUT[l];
    const probe = JSON.parse(out('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size,bit_rate:stream=codec_type,codec_name,profile,width,height,r_frame_rate,avg_frame_rate,nb_frames,pix_fmt,sample_rate,channels', '-of', 'json', f]));
    const v = probe.streams.find((s) => s.codec_type === 'video');
    const a = probe.streams.find((s) => s.codec_type === 'audio');
    const loud = out('ffmpeg', ['-hide_banner', '-nostats', '-i', f, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
    const I = Number(loud.match(/I:\s+(-?[\d.]+) LUFS/g).pop().match(/-?[\d.]+/)[0]);
    const TP = Number(loud.match(/Peak:\s+(-?[\d.]+) dBFS/g).pop().match(/-?[\d.]+/)[0]);
    const sil = out('ffmpeg', ['-hide_banner', '-nostats', '-i', f, '-af', 'silencedetect=n=-40dB:d=0.3', '-f', 'null', '-']);
    const silences = [...sil.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) => Number(m[1]));
    const blk = out('ffmpeg', ['-hide_banner', '-nostats', '-i', f, '-vf', 'blackdetect=d=0.05:pix_th=0.10:pic_th=0.98,blackframe=amount=98:threshold=32', '-an', '-f', 'null', '-']);
    const blackRuns = [...blk.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    const blackFrames = [...blk.matchAll(/frame:(\d+) pblack:(\d+)/g)].map((m) => Number(m[1]));
    const blanks = {};
    const errors = {};
    for (const j of readdirSync(resolve(work, l)).filter((x) => /^shot-\d+\.json$/.test(x))) {
      const m = JSON.parse(readFileSync(resolve(work, l, j), 'utf8'));
      if (m.blanks?.length) blanks[j] = m.blanks;
      if (m.errors?.length) errors[j] = m.errors;
    }
    report[l] = {
      file: f,
      duration: Number(probe.format.duration),
      sizeBytes: Number(probe.format.size),
      video: { codec: v.codec_name, profile: v.profile, width: v.width, height: v.height, fps: v.r_frame_rate, frames: Number(v.nb_frames), pix_fmt: v.pix_fmt },
      audio: { codec: a.codec_name, sample_rate: a.sample_rate, channels: a.channels },
      loudness: { integratedLUFS: I, truePeakDBFS: TP },
      silences,
      blackRuns,
      blackFrames,
      captureBlanks: blanks,
      pageErrors: errors,
    };
  }
  writeFileSync(resolve(work, 'report.json'), JSON.stringify(report, null, 1));
  console.log(`\n${JSON.stringify(report, null, 1)}`);
  // Silence is allowed only where the song itself has ended (its last second and after).
  const songEnd = Number(out('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', audio]).trim());
  const bad = layouts.flatMap((l) => {
    const r = report[l];
    const why = [];
    const early = r.silences.filter((s) => s > 0.5 && s < Math.min(songEnd, length) - 6);
    if (early.length) why.push(`${l}: silence at ${early.join(', ')}`);
    if (r.blackRuns.length || r.blackFrames.length) why.push(`${l}: black frames`);
    if (Math.abs(r.loudness.integratedLUFS + 14) > 0.6) why.push(`${l}: ${r.loudness.integratedLUFS} LUFS`);
    if (r.video.frames !== frames) why.push(`${l}: ${r.video.frames} frames, expected ${frames}`);
    if (Object.keys(r.pageErrors).length) why.push(`${l}: page errors`);
    return why;
  });
  console.log(bad.length ? `CHECKS FAILED\n  ${bad.join('\n  ')}` : 'CHECKS PASSED');
  process.exitCode = bad.length ? 1 : 0;
} finally {
  stop();
}
