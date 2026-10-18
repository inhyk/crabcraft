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
    formation: { rows: 3, cols: 2, dx: 4.8, dz: 5.8, hero: null, seed: 23, weapons: 0 },
    cues, faces: [{ at: -10, who: 'all', expr: 'happy' }],
    shots: [{ from: 0, to: length, keys, port: keys, ease: 'linear', focusRange: 120 }],
    fx: [{ at: -10, kind: 'mood', mood }, { at: -10, kind: 'beacon', on: mood === 2 }],
  };
}
const event = (clip, key, index = 0) => {
  const h = JSON.parse(readFileSync(resolve(repo, 'public/motions', `${clip}.json`)));
  if (!h.events[key]?.length) throw new Error(`Missing ${clip}/${key}`);
  return h.events[key][index];
};
// Power moves play continuously through preparation and recovery. They are not seamless loops;
// the only transitions are long blends into a groove after the power move has recovered.
const move = (clip, speed, from = 0, at = 0, extra = {}) => ({
  at, who: 'all', clip, from,
  to: JSON.parse(readFileSync(resolve(repo,'public/motions',`${clip}.json`))).duration,
  loop: false, fade: 0.6, speed, ...extra,
});
const plaza = { x: 32, z: 0, yaw: 0 };
const beach = { x: 112.5, z: 76, yaw: 0 };
const fountain = { x: 0, z: 19, yaw: 0 };
const groupCam = [K(0, [0, 20, 18], [0, 0.7, 0], 48), K(1, [0, 19, 17], [0, 0.7, 0], 48)];
const definitions = [
  ['island-dive', 0, 4, { x: 0, z: 0, yaw: 0 }, [
    K(0, [215, 54, 105], [92, 7, -5], 70, -0.13),
    K(0.35, [150, 28, 36], [62, 7, 0], 70, -0.2),
    K(0.7, [90, 11, 1], [25, 5, 0], 70, 0.12),
    K(1, [34, 13, -1], [-10, 5, 0], 70, 0),
  ]],
  ['plaza-breakers', 12, 16, plaza, groupCam, [
    move('break_sixstep', 0.78, 0.15),
  ]],
  ['boss-reveal', 20, 24, { x: 154, z: 117, yaw: -1.87 }, [
    K(0, [16, 25, 43], [0, 1, 0], 66, -0.07),
    K(0.4, [8, 13, 27], [0, 2, 0], 62, 0),
    K(0.7, [1, 10, 23], [0, 3, 0], 62, 0.05),
    K(1, [-11, 9, 23], [0, 2, 0], 62, 0),
  ], [move('break_jumpspin',0.65,0,4.2,{sync:event('break_jumpspin','land')})]],
  ['shore-720', 29, 33, beach, groupCam, [
    move('break_jumpspin', 0.59),
    move('dance_crab', 1.1549, event('dance_crab','beat',16), 4.0, {fade:0.9}),
  ]],
  ['fountain-cypher', 37, 40, fountain, groupCam, [
    move('break_spin', 0.72, 0.15),
  ]],
  ['lighthouse-bank', 44, 48, { x: 0, z: 0, yaw: 0 }, [
    K(0, [224, 20, -70], [190, 25, -132], 66, 0.06),
    K(0.33, [232, 35, -125], [190, 26, -132], 66, -0.25),
    K(0.66, [214, 44, -167], [190, 24, -132], 66, -0.23),
    K(1, [175, 50, -171], [185, 12, -125], 70, 0.03),
  ]],
  ['plaza-flips', 61, 65, plaza, groupCam, [
    move('break_backflip', 0.57),
    move('dance_crab', 1.1549, event('dance_crab','beat',16), 3.8, {fade:0.9}),
  ]],
  ['beacon-flight', 74, 78, { x: 0, z: 0, yaw: 0 }, [
    K(0, [232.35, 10.2, -89.8], [190, 25, -132], 66, -0.1),
    K(0.33, [220.35, 30.2, -117.8], [190, 27, -132], 66, -0.18),
    K(0.66, [209.35, 44.2, -146.8], [190, 24, -132], 66, 0.12),
    K(1, [183.35, 50.2, -160.8], [185, 14, -125], 66, 0),
  ], [], 2],
  ['night-party', 89, 93, plaza, groupCam, [
    move('break_spin', 0.92),
    move('dance_crab', 1.1549, event('dance_crab','beat',16), 5.0, {fade:0.9}),
  ], 2],
];
export const shots = definitions.map(([id, a, b, site, keys, cues, mood]) => {
  const start = a === 0 ? 0 : bar(a), end = bar(b);
  return { id, start, end, from: start / FPS, to: end / FPS, frames: end - start,
    program: { ...program((end - start) / FPS, site, keys, cues, mood),
      ...(cues?.length ? {terrainClearance:0.045,terrainLiftRate:2,exactMotion:true} : {}),
      ...(id === 'boss-reveal' ? { actor:'corrodius',terrainLiftRate:7,formation: {rows:0,cols:0,dx:1,dz:1,hero:0,weapons:1},faces:[{at:-10,who:'all',expr:'angry'}],
        shots:[{from:0,to:(end-start)/FPS,keys:keys.map(k=>({...k,fov:74,l:{hero:[0,.1,0]}})),port:keys.map(k=>({...k,fov:74,l:{hero:[0,.1,0]}})),ease:'linear',focus:'hero',focusRange:120,rise:1}],
      } : {}),
    } };
});

// The same moving lighthouse camera in alternating full daylight and lit night, every two beats.
// Capture each lighting state separately so the cut changes instantly without an environment fade.
export const lighthousePulseSeconds = 2 * grid.beat;
