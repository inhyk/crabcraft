// Shared by the crowd capture scripts: building a program from a choreography and a beat grid,
// and cutting it into shots.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readClips } from './clips.mjs';

/**
 * A beat grid: { beat: seconds per beat, downbeats: [seconds], beats?: [seconds], bpm?: number }.
 * Missing beats are filled in from the downbeats (four to a bar).
 */
export function readGrid(file) {
  const g = JSON.parse(readFileSync(file, 'utf8'));
  if (!g.beat || !Array.isArray(g.downbeats) || !g.downbeats.length) throw new Error(`${file}: a beat grid needs "beat" and "downbeats"`);
  if (!g.beats) g.beats = g.downbeats.flatMap((d) => [0, 1, 2, 3].map((k) => d + k * g.beat));
  return g;
}

/**
 * Run a choreography module (its default export, or `build`) with the grid, the clip facts of the
 * checkout at `repo` and the checkout's path; it returns the program the crowd scene plays.
 */
export async function buildProgram({ choreo, grid, repo, options = {} }) {
  const mod = await import(pathToFileURL(resolve(choreo)).href);
  const build = mod.default ?? mod.build;
  if (typeof build !== 'function') throw new Error(`${choreo} exports no build function`);
  const program = await build({ grid: readGrid(grid), clips: readClips(repo), repo: resolve(repo), options });
  if (!program?.shots?.length || !program.length) throw new Error(`${choreo} returned a program without shots or length`);
  return program;
}

/** Shot i covers song frames [round(from_i * fps), round(from_(i+1) * fps)); the last up to the length. */
export function shotRanges(program, fps) {
  return program.shots.map((s, i) => {
    const to = i + 1 < program.shots.length ? program.shots[i + 1].from : program.length;
    return { index: i, k0: Math.round(s.from * fps), k1: Math.round(to * fps) };
  });
}

/** What a shot's frames depend on: everything in the program but the other shots, and the render settings. */
export function shotKey(program, i, settings) {
  const { shots, ...rest } = program;
  return createHash('sha1').update(JSON.stringify(rest)).update(JSON.stringify(shots[i])).update(JSON.stringify(settings)).digest('hex').slice(0, 16);
}

export const shotName = (dir, i) => resolve(dir, `shot-${String(i).padStart(3, '0')}`);
