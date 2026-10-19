// Insert shots on the original a4 song clock. The original crowd edit supplies all other frames.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const grid = JSON.parse(readFileSync(new URL('../grid.json', import.meta.url)));
export const FPS = 60;
const BAR = 4 * grid.beat;
const bar = (n) => Math.round(grid.downbeats[n] * FPS);
const K = (u, p, l, fov = 64, roll = 0) => ({ u, p, l, fov, roll });
const clip = (id) => JSON.parse(readFileSync(resolve(repo, 'public/motions', `${id}.json`)));
const event = (id, key, index = 0) => {
  const h = clip(id);
  if (!h.events[key]?.length) throw new Error(`Missing ${id}/${key}`);
  return h.events[key][index];
};
const move = (id, speed, from = 0, at = 0, extra = {}) => ({
  at, who: 'all', clip: id, from, to: clip(id).duration, loop: false, fade: 0.6, speed, ...extra,
});
// The groove: the crab dance with its steps on the song's beats (at must be a beat).
const groove = (at = -0.8, extra = {}) => move('dance_crab', 1.1549, event('dance_crab', 'beat', 16), at, { fade: 0.7, ...extra });
// A power move whose `key` moment lands on song second `at`, entered from its standing pre-roll.
const power = (id, key, at, speed, extra = {}) => move(id, speed, 0.45, at, { sync: event(id, key), fade: 0.5, ...extra });

// A six-crab crew in a 1-2-3 wedge behind the crowd video's hero, close enough to read as a crew
// in portrait and staggered so no crab stands straight behind another from the front.
const S = 4.8, ROW = 3.8;
const crew = {
  rows: 2, cols: 3, dx: S, dz: ROW, hero: ROW, seed: 23, weapons: 0,
  points: [[-S / 2, 0], [S / 2, 0], [-S, -ROW], [0, -ROW], [S, -ROW]],
};
const lead = (dy = 0.45) => ({ hero: [0, dy, 0] });
const mid = [0, 0.6, -0.6];

/** A shot over song seconds [a, b] of the insert. */
const shot = (a, b, keys, extra = {}) => ({ from: a, to: b, keys, port: keys, ease: 'linear', focusRange: 60, ...extra });
// Close on the lead in the groove: a low arc around it, the crew soft behind.
const leadArc = (a, b, side = 1, r = 6.2, lift = 0) => shot(a, b, [
  K(0, [-3.6 * side, 1.0 + lift, ROW + r * 0.8], lead(0.55), 40, 0.025 * side),
  K(0.5, [-0.6 * side, 1.3 + lift, ROW + r], lead(0.55), 40, 0),
  K(1, [2.9 * side, 1.6 + lift, ROW + r * 0.85], lead(0.5), 40, -0.02 * side),
], { focus: 'hero', focusRange: 10, ease: 'sine' });

function program(length, site, shots, cues, mood = 0, extra = {}) {
  return {
    length, site, formation: crew, cues, shots,
    faces: [{ at: -10, who: 'all', expr: 'happy' }],
    fx: [{ at: -10, kind: 'mood', mood }, { at: -10, kind: 'beacon', on: mood === 2 }],
    terrainClearance: 0.045, terrainLiftRate: 2, exactMotion: true, ...extra,
  };
}
const flight = (length, keys, mood = 0) => ({
  length, site: { x: 0, z: 0, yaw: 0 }, formation: { rows: 3, cols: 2, dx: 4.8, dz: 5.8, hero: null, seed: 23, weapons: 0 },
  cues: [], faces: [{ at: -10, who: 'all', expr: 'happy' }],
  shots: [{ from: 0, to: length, keys, port: keys, ease: 'linear', focusRange: 120 }],
  fx: [{ at: -10, kind: 'mood', mood }, { at: -10, kind: 'beacon', on: mood === 2 }],
});

const plaza = { x: 32, z: 0, yaw: 0 };
const beach = { x: 112.5, z: 76, yaw: 0 };
const fountain = { x: 0, z: 19, yaw: 0 };
const chapel = { x: 0, z: -36, yaw: 0 };
const B2 = 2 * BAR, B4 = 4 * BAR;

// Each crew insert: two bars of groove close on the lead, a cut on the bar line, then the whole
// crew from a moving camera through one power move that lands on a downbeat, and back to the groove.
// The crew faces the boss on an arc 12 units out, centred 1.2 toward the side the boss drifts to in
// its jump spin, beyond the sweep of its big claw on landing.
const bossArc = [15, 35, 55].flatMap((d) => [-1, 1].map((k) => {
  const a = k * d * Math.PI / 180;
  return [+(1.2 + 12 * Math.sin(a)).toFixed(2), +(12 * Math.cos(a)).toFixed(2)];
}));
const atBoss = { who: 'crowd', faceTo: [0, 0] };

const definitions = {
  'island-dive': [0, 4, (L) => flight(L, [
    K(0, [215, 54, 105], [92, 7, -5], 70, -0.13),
    K(0.35, [150, 28, 36], [62, 7, 0], 70, -0.2),
    K(0.7, [90, 11, 1], [25, 5, 0], 70, 0.12),
    K(1, [34, 13, -1], [-10, 5, 0], 70, 0),
  ])],
  // Footwork reads from above: a ground-level slide past the crew, then a crane over the six-step.
  'plaza-breakers': [12, 16, (L) => program(L, plaza, [
    shot(0, B2, [
      K(0, [-5.5, 1.6, ROW + 4.2], [-2.6, 0.8, 0.5], 42, 0.03),
      K(1, [4.5, 1.8, ROW + 4.6], [2.2, 0.8, 0.5], 42, -0.02),
    ], { focus: 'hero', focusRange: 12, ease: 'sine' }),
    shot(B2, B4, [
      K(0, [3, 2.8, 12.5], mid, 54, -0.03),
      K(0.55, [0.5, 9, 12], mid, 56, 0),
      K(1, [-2, 11, 7.5], [0, 0.3, -0.6], 58, 0.05),
    ], { ease: 'sine' }),
  ], [groove(), move('break_sixstep', 1.0, 0.6, 3.0, { fade: 0.6 })])],
  // A dance battle: the crew faces the boss, seen over a dancer's shoulder at crab height so the boss
  // towers over it, then over another dancer's shoulder as the boss crouches, jump-spins and lands
  // on the bar; the deck shakes and the crew hop, centre first. The bow's mast stands at about
  // (1, 17), behind both cameras.
  'boss-reveal': [20, 24, (L) => ({
    ...program(L, { x: 154, z: 117, yaw: 1.27 + Math.PI }, [
      shot(0, B2, [
        K(0, [-1.9, 1.5, 15.2], lead(1.2), 58, 0.03),
        K(1, [-1.2, 1.6, 14.4], lead(1.4), 58, -0.01),
      ], { focus: 'hero', focusRange: 30, ease: 'out' }),
      shot(B2, B4, [
        K(0, [6.6, 1.5, 15.2], lead(1.0), 60, -0.03),
        K(0.5, [5.1, 1.8, 15.6], lead(1.2), 60, 0),
        K(1, [3.6, 2.1, 15.2], lead(1.0), 60, 0.03),
      ], { focus: 'hero', focusRange: 50, ease: 'linear', rise: 0.8 }),
    ], [
      groove(-0.8, { who: 'hero' }), power('break_jumpspin', 'land', 3 * BAR, 0.6, { who: 'hero' }), groove(3 * BAR + 1.2, { who: 'hero', fade: 0.8 }),
      groove(-0.8, atBoss),
      move('jump', 1, 0.95, 3 * BAR + 0.06, { ...atBoss, sync: event('jump', 'takeoff'), fade: 0.15, wave: { by: 'side', step: 0.05 } }),
      groove(3 * BAR + 0.8, atBoss),
    ]),
    actor: 'corrodius', terrainLiftRate: 7,
    formation: { rows: 3, cols: 3, dx: 2.4, dz: 4, hero: -bossArc[0][1], seed: 23, weapons: 0, points: bossArc },
    faces: [{ at: -10, who: 'hero', expr: 'angry' }, { at: -10, who: 'crowd', expr: 'happy' },
      { at: 3 * BAR, who: 'crowd', expr: 'surprised', wave: { by: 'side', step: 0.05 } },
      { at: 3 * BAR + 1.2, who: 'crowd', expr: 'happy' }],
  })],
  // A group 720 on the sand: close arc on the lead, then a low front that cranes with the jump.
  'shore-720': [29, 33, (L) => program(L, beach, [
    leadArc(0, B2, 1),
    shot(B2, B4, [
      K(0, [-1.5, 2.4, 10.5], [0, 0.4, -1], 54, 0.02),
      K(0.45, [0.5, 3.6, 11], [0, 0.4, -1], 54, 0),
      K(1, [2.5, 5.4, 11], [0, 0.3, -1.2], 56, -0.03),
    ], { ease: 'sine', rise: 0.6 }),
  ], [groove(), power('break_jumpspin', 'land', 3 * BAR, 0.8, { wave: { by: 'row', step: 0.06 } }), groove(3 * BAR + 0.8)])],
  // One bar of groove pushing in, then the crew spins under a turning top-down camera.
  'fountain-cypher': [37, 40, (L) => program(L, fountain, [
    shot(0, BAR, [
      K(0, [2.0, 1.4, ROW + 11], lead(0.5), 42, -0.03),
      K(1, [0.8, 1.1, ROW + 6.2], lead(0.5), 40, 0),
    ], { focus: 'hero', focusRange: 10, ease: 'out' }),
    shot(BAR, 3 * BAR, [
      K(0, [0, 18, 0.4], [0, 0, -0.4], 58, 0),
      K(1, [0, 15, 0.4], [0, 0, -0.4], 58, 1.1),
    ], { ease: 'linear', focusRange: 80 }),
  ], [groove(), power('break_spin', 'spin_from', BAR + 0.2, 0.9, { fade: 0.45 })])],
  'lighthouse-bank': [44, 48, (L) => flight(L, [
    K(0, [224, 20, -70], [190, 25, -132], 66, 0.06),
    K(0.33, [232, 35, -125], [190, 26, -132], 66, -0.25),
    K(0.66, [214, 44, -167], [190, 24, -132], 66, -0.23),
    K(1, [175, 50, -171], [185, 12, -125], 70, 0.03),
  ])],
  // Backflips read in profile: a side dolly along the wedge while the flips ripple front to back.
  'plaza-flips': [61, 65, (L) => program(L, chapel, [
    leadArc(0, B2, -1),
    shot(B2, B4, [
      K(0, [-3.2, 0.8, ROW + 4.6], lead(0.7), 54, -0.03),
      K(1, [-5, 1.3, ROW + 2.4], lead(0.7), 54, 0.02),
    ], { ease: 'sine', focus: 'hero', focusRange: 14, rise: 0.4 }),
  ], [groove(), power('break_backflip', 'land', 3 * BAR, 0.8, { wave: { by: 'row', step: 0.08 } }), groove(3 * BAR + 0.8)])],
  'beacon-flight': [74, 78, (L) => flight(L, [
    K(0, [232.35, 10.2, -89.8], [190, 25, -132], 66, -0.1),
    K(0.33, [220.35, 30.2, -117.8], [190, 27, -132], 66, -0.18),
    K(0.66, [209.35, 44.2, -146.8], [190, 24, -132], 66, 0.12),
    K(1, [183.35, 50.2, -160.8], [185, 14, -125], 66, 0),
  ], 2)],
  // Night: close on the lead, then a half orbit around the spinning crew.
  'night-party': [89, 93, (L) => program(L, plaza, [
    leadArc(0, B2, 1, 6.2, 0.7),
    shot(B2, B4, [
      K(0, [-7, 2.2, 5.5], mid, 54, 0.03),
      K(0.5, [0, 3.0, 9.2], mid, 54, 0),
      K(1, [7, 4.0, 5.5], mid, 54, -0.03),
    ], { ease: 'linear' }),
  ], [groove(), power('break_spin', 'spin_from', B2 + 0.2, 0.9, { fade: 0.45 })], 2)],
};

export const shots = Object.entries(definitions).map(([id, [a, b, make]]) => {
  const start = a === 0 ? 0 : bar(a), end = bar(b);
  return { id, start, end, from: start / FPS, to: end / FPS, frames: end - start, program: make((end - start) / FPS) };
});

// The same moving lighthouse camera in alternating full daylight and lit night, every two beats.
// Capture each lighting state separately so the cut changes instantly without an environment fade.
export const lighthousePulseSeconds = 2 * grid.beat;
