// Insert shots on the original a4 song clock. The original crowd edit supplies all other frames.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const grid = JSON.parse(readFileSync(new URL('../grid.json', import.meta.url)));
export const FPS = 60;
const bar = (n) => Math.round(grid.downbeats[n] * FPS);
const K = (u, p, l, fov = 64, roll = 0) => ({ u, p, l, fov, roll });
function program(length, site, keys, cues = [], mood = 0) {
  return {
    length, site,
    formation: { rows: 2, cols: 3, dx: 2.2, dz: 2.8, hero: null, seed: 23, weapons: 0 },
    cues, faces: [{ at: -10, who: 'all', expr: 'happy' }],
    shots: [{ from: 0, to: length, keys, port: keys, ease: 'linear', focusRange: 120 }],
    fx: [{ at: -10, kind: 'mood', mood }, { at: -10, kind: 'beacon', on: mood === 2 }],
  };
}
const event = (clip, key) => {
  const h = JSON.parse(readFileSync(resolve(repo, 'public/motions', `${clip}.json`)));
  if (!h.events[key]?.length) throw new Error(`Missing ${clip}/${key}`);
  return h.events[key][0];
};
const dance = (clip, at = 0, who = 'all', extra = {}) => ({
  at, who, clip, from: event(clip, 'policy_start') + 0.1,
  to: event(clip, 'policy_end') - 0.12, loop: true, fade: 0.15, ...extra,
});
// A slower replay makes the complete airborne rotation readable in a short portrait shot.
const flip = (clip, landing, who = 'all', extra = {}) => ({
  at: landing, who, clip, from: Math.max(0, event(clip, 'policy_start') - 0.18),
  to: event(clip, 'settled') + 0.2, sync: event(clip, 'land'), speed: 0.45, fade: 0.12, ...extra,
});
const plaza = { x: 32, z: 0, yaw: 0 };
const beach = { x: 114.8, z: 43, yaw: 0 };
const fountain = { x: 0, z: 14, yaw: 0 };
const groupCam = [K(0, [-3, 3.4, 10], [0, 0.8, 0], 55, -0.04), K(0.5, [0, 2.5, 10.5], [0, 0.8, 0], 55), K(1, [3, 3.7, 10], [0, 0.8, 0], 55, 0.04)];
const nightCam = [K(0, [-2.6, 3.6, 10.3], [0.1, 0.8, 0], 56, -0.03), K(0.5, [0.2, 2.8, 10.8], [0.1, 0.8, 0], 56), K(1, [3.3, 3.9, 10.2], [0.1, 0.8, 0], 56, 0.03)];
const definitions = [
  ['island-dive', 0, 4, { x: 0, z: 0, yaw: 0 }, [
    K(0, [215, 54, 105], [92, 7, -5], 70, -0.13),
    K(0.35, [150, 28, 36], [62, 7, 0], 70, -0.2),
    K(0.7, [90, 11, 1], [25, 5, 0], 70, 0.12),
    K(1, [34, 13, -1], [-10, 5, 0], 70, 0),
  ]],
  ['plaza-breakers', 12, 16, plaza, groupCam, [
    dance('break_sixstep', -0.3), dance('break_spin', 3.2, { parity: 0 }),
    dance('break_spin', 3.6, { parity: 1 }),
  ]],
  ['village-run', 20, 24, { x: 0, z: 0, yaw: 0 }, [
    K(0, [99, 6.2, 0], [60, 5, 0], 72, -0.06),
    K(0.35, [60, 6.8, 0], [7, 5, 2], 72, 0.06),
    K(0.68, [17, 10, 11], [-10, 5, -5], 72, 0.2),
    K(1, [-11, 23, 15], [0, 5, -22], 68, 0),
  ]],
  ['shore-720', 29, 33, beach, groupCam, [
    flip('break_jumpspin', 1.2), dance('break_sixstep', 2.7),
    flip('break_jumpspin', 5.1, { parity: 0 }),
  ]],
  ['fountain-cypher', 37, 40, fountain, groupCam, [
    dance('break_sixstep', -0.2), dance('break_spin', 2.3, { parity: 0 }),
  ]],
  ['lighthouse-bank', 44, 48, { x: 0, z: 0, yaw: 0 }, [
    K(0, [224, 20, -70], [190, 25, -132], 66, 0.06),
    K(0.33, [232, 35, -125], [190, 26, -132], 66, -0.25),
    K(0.66, [214, 44, -167], [190, 24, -132], 66, -0.23),
    K(1, [175, 50, -171], [185, 12, -125], 70, 0.03),
  ]],
  ['plaza-flips', 61, 65, plaza, groupCam, [
    flip('break_backflip', 1.0), dance('break_sixstep', 2.5),
    flip('break_backflip', 4.8), dance('break_spin', 6.0),
  ]],
  ['beacon-flight', 74, 78, { x: 0, z: 0, yaw: 0 }, [
    K(0, [232.35, 10.2, -89.8], [190, 25, -132], 66, -0.1),
    K(0.33, [220.35, 30.2, -117.8], [190, 27, -132], 66, -0.18),
    K(0.66, [209.35, 44.2, -146.8], [190, 24, -132], 66, 0.12),
    K(1, [183.35, 50.2, -160.8], [185, 14, -125], 66, 0),
  ], [], 2],
  ['night-party', 89, 93, plaza, nightCam, [
    flip('break_backflip', 1.0), dance('break_spin', 2.5),
    flip('break_jumpspin', 5.1, { parity: 1 }),
  ], 2],
];
export const shots = definitions.map(([id, a, b, site, keys, cues, mood]) => {
  const start = a === 0 ? 0 : bar(a), end = bar(b);
  return { id, start, end, from: start / FPS, to: end / FPS, frames: end - start,
    program: { ...program((end - start) / FPS, site, keys, cues, mood),
      ...(id === 'shore-720' ? { terrainClearance: 0.045, formation: { rows: 2, cols: 3, dx: 1.8, dz: 2.5, hero: null, seed: 23, weapons: 0 } } : {}),
    } };
});

// The same moving lighthouse camera in alternating full daylight and lit night, every two beats.
// Capture each lighting state separately so the cut changes instantly without an environment fade.
export const lighthousePulseSeconds = 2 * grid.beat;
