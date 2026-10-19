// Scene 'night' of the tribute (see ../timeline.mjs for the song ranges it fills).
//
// night-elf (68.7 to 93.0): out of white with leaves into the Moonpool Grove at night, graded violet;
// the night elf alert among the ferns, a spin and a dash, a long tracking run through the pines,
// her change in a violet burst, a run along the headland cliff and a leap across the moon, then a
// cyan whoosh into darkness.
// night-undead (93.0 to 111.0): Starhaven's Fallen Star Ruins, graded grave green; the undead's claws
// creep over the sand and it splits into molten fissures, he rises and channels under the observatory's
// astrolabe, boulders climb out of the ground round him, a burning rock falls out of the sky behind him
// and the blast whites out the frame.
// night-explode (151.92 to 154.21): the same blast, close, the undead black against it.
//
// The run through the pines and the camera beside it were planned off-line from the forest's tree
// collision circles (clear of every trunk); the leap's lifts come from the headland's height field.
import { ELF, UNDEAD } from '../cast.mjs';

// Cut points (song seconds).
const ELF_IN = 68.7;
const ELF_RUN = 74.6;
const ELF_CHANGE = 88.0;
const ELF_LEDGE = 89.0;
const ELF_LEAP = 90.0;
const ELF_WHOOSH = 91.75;
const UNDEAD_IN = 93.0;
const UNDEAD_CAST = 99.5;
const UNDEAD_OUT = 111.0;
const EXPLODE_IN = 151.92;
const EXPLODE_OUT = 154.21;

const cut = (id, from, to, chapter, spec) => ({ id, at: from, length: to - from, chapter, ...spec });

// ----------------------------------------------------------------------------------------- looks

const view = (o = {}) => ({
  exposure: 1.0,
  saturation: 0.08,
  contrast: 0.1,
  bloom: { intensity: 1.15, threshold: 0.7, radius: 0.75 },
  vignette: { offset: 0.22, darkness: 0.75 },
  ...o,
});
/** The violet night forest: greens pulled to violet, blacks lifted a touch toward indigo. */
const VIOLET = { kind: 'night-grade', t: -3, mul: '#b48cff', mulTop: '#9d8cff', gain: 1.7, lift: '#0b0420', liftK: 0.35 };
/** Grave green under a sickly sky. */
const GRAVE = { kind: 'night-grade', t: -3, mul: '#a8ba98', mulTop: '#b4d68e', gain: 1.0, gainTop: 1.05, lift: '#030600', liftK: 0.3 };

// ------------------------------------------------------------------------------ the night elf

/** A point `dist` from `c` toward `yaw` (0 = +z), `h` above the ground. */
const around = (c, yaw, dist, h) => ({ g: [c[0] + Math.sin(yaw) * dist, h, c[1] + Math.cos(yaw) * dist] });
/** The violet night haze that sets dark trunks off against the depth of the wood. */
const HAZE = { color: '#3a2470', density: 0.03 };
/** Where she waits, west of the Moonpool, the moonbeam behind her. */
const E0 = [-72, 44];
/** Toward the camera from her (north-east of her is the pool; the camera stands south-east). */
const FACE = 2.36;

// The run through the pines (x, z), and the camera's lane west of it.
const RUN = [
  [-89.0, 18.0], [-89.0, 24.0], [-90.0, 30.0], [-89.5, 36.0], [-89.5, 42.0], [-91.5, 48.0], [-92.5, 54.0],
  [-92.5, 60.0], [-92.5, 66.0], [-92.5, 72.0], [-92.5, 78.0], [-91.5, 84.0], [-91.5, 90.0], [-90.5, 94.5],
];
const CAM_LANE = [
  [-96.0, 18.0], [-96.0, 24.0], [-96.75, 30.0], [-96.25, 36.0], [-96.25, 42.0], [-95.3, 46.4], [-96.0, 48.5], [-100.0, 54.0],
  [-100.0, 60.0], [-99.5, 66.0], [-99.5, 72.0], [-99.5, 78.0], [-98.5, 84.0], [-100.0, 90.0], [-99.0, 94.5],
];
const RUN_LEN = ELF_CHANGE - ELF_RUN;
/** Seconds into the run shot at which she reaches each RUN point (steady speed). */
const RUN_T = (() => {
  const d = [0];
  for (let i = 1; i < RUN.length; i++) d.push(d[i - 1] + Math.hypot(RUN[i][0] - RUN[i - 1][0], RUN[i][1] - RUN[i - 1][1]));
  return d.map((x) => (x / d[d.length - 1]) * RUN_LEN);
})();
/** Seconds into the run at which she passes z (she runs steadily south, +z). */
function runTimeAtZ(z) {
  for (let i = 1; i < RUN.length; i++) {
    if (z <= RUN[i][1]) return RUN_T[i - 1] + ((z - RUN[i - 1][1]) / (RUN[i][1] - RUN[i - 1][1])) * (RUN_T[i] - RUN_T[i - 1]);
  }
  return RUN_LEN;
}
/** The sideways scuttle, facing the camera (west), between these run seconds. */
const SCUTTLE = [5.2, 8.8];
const runPath = RUN.map(([x, z], i) => {
  const t = RUN_T[i];
  if (t >= SCUTTLE[0] && t <= SCUTTLE[1]) return { t, x, z, yaw: -Math.PI / 2 };
  return { t, x, z };
});
// Ease into and out of the scuttle: face the way she runs (south, yaw 0) on the keys either side.
for (const edge of SCUTTLE) {
  const i = runPath.findIndex((k) => k.t > edge) - (edge === SCUTTLE[0] ? 1 : 0);
  if (i >= 0 && i < runPath.length) runPath[i] = { ...runPath[i], yaw: 0 };
}

// The headland's north-east cliff: she runs along the edge (D) and leaps off it (E).
const LEDGE_FROM = [169.2, -155.8];
const LEDGE_TO = [165.7, -160.6];
const TAKEOFF = [163.9, -161.8];
/** Leap keys [t, x, z, lift]: 6 units/s along the edge and out, 3.5 up; lifts measured over the cliff. */
const LEAP = [
  [0.35, 163.9, -161.8, 0.0], [0.4, 163.83, -162.09, 0.79], [0.45, 163.76, -162.38, 2.01], [0.5, 163.68, -162.67, 2.91],
  [0.55, 163.61, -162.96, 3.41], [0.6, 163.54, -163.26, 5.27], [0.65, 163.47, -163.55, 6.89], [0.7, 163.4, -163.84, 7.01],
  [0.75, 163.32, -164.13, 7.19], [0.8, 163.25, -164.42, 7.39], [0.85, 163.18, -164.71, 7.44], [0.9, 163.11, -165.0, 7.4],
  [0.95, 163.04, -165.29, 6.81], [1.0, 162.96, -165.59, 6.44], [1.05, 162.89, -165.88, 6.18], [1.1, 162.82, -166.17, 6.81],
  [1.15, 162.75, -166.46, 8.07], [1.2, 162.68, -166.75, 8.49], [1.25, 162.6, -167.04, 8.76], [1.3, 162.53, -167.33, 11.2],
  [1.35, 162.46, -167.62, 12.89], [1.4, 162.39, -167.92, 13.67], [1.45, 162.31, -168.21, 13.97], [1.5, 162.24, -168.5, 14.7],
  [1.55, 162.17, -168.79, 17.03], [1.6, 162.1, -169.08, 18.53], [1.65, 162.03, -169.37, 18.08], [1.7, 161.95, -169.66, 17.25],
  [1.75, 161.88, -169.95, 16.24],
];
/** The top of the leap (world), and the camera below it on the sea side; the moon sits behind her. */
const APEX = [163.03, 27.3, -165.31];
const LEAP_CAM = [170.6, 22.6, -171.8];
const MOON_DIR = [APEX[0] - LEAP_CAM[0], APEX[1] - LEAP_CAM[1], APEX[2] - LEAP_CAM[2]];

const elf = { id: 'elf', spec: ELF };

const elfShots = [
  // Out of white, leaves blowing across; she waits among the ferns, alert, then spins and dashes.
  cut('night-elf-face', ELF_IN, ELF_RUN, 1, {
    mood: 1,
    view: view({ dof: true, bokeh: 5, exposure: 1.15 }),
    fog: HAZE,
    anchor: E0,
    actors: [{ ...elf, at: E0, yaw: FACE }],
    tracks: {
      elf: {
        path: [
          { t: 0, x: E0[0], z: E0[1], yaw: FACE },
          { t: 1.7, x: E0[0], z: E0[1], yaw: FACE + 0.45 },
          { t: 3.1, x: E0[0], z: E0[1], yaw: FACE - 0.4 },
          { t: 4.55, x: E0[0], z: E0[1], yaw: FACE + 0.1 },
          { t: 4.95, x: E0[0] - 0.1, z: E0[1] - 0.1, yaw: FACE + 2.0 },
          { t: 5.3, x: E0[0] - 1.2, z: E0[1] - 1.0 },
          { t: 5.9, x: E0[0] - 4.6, z: E0[1] - 3.2 },
        ],
        acts: [{ t: -2, clip: 'idle', loop: true }],
        faces: [{ t: -2, expr: 'focused' }],
      },
    },
    cam: {
      ease: 'linear',
      focus: 'elf',
      range: 1.4,
      keys: [
        { t: 0, p: around(E0, FACE + 0.16, 5.0, 0.95), l: { g: [E0[0], 0.85, E0[1]] }, fov: 28 },
        { t: 4.8, p: around(E0, FACE - 0.1, 4.3, 0.88), l: { g: [E0[0], 0.82, E0[1]] }, fov: 28 },
        { t: 5.25, p: around(E0, FACE - 0.14, 4.2, 0.88), l: { a: 'elf', o: [0, 0.8, 0] }, fov: 30 },
        { t: 5.9, p: around(E0, FACE - 0.2, 4.1, 0.95), l: { g: [E0[0] - 7, 0.8, E0[1] - 5] }, fov: 32 },
      ],
    },
    fx: [
      { ...VIOLET, k: [[0, 0], [0.35, 0.2], [1.2, 1]] },
      { kind: 'night-veil', t: -1, alpha: [[0, 1], [0.3, 0.9], [1.1, 0]], color: '#ffffff', gain: 5 },
      // A gust through the white, then leaves drifting down.
      { kind: 'leaves', t: -1, until: 1.8, fadeOut: 0.5, count: 2200, box: [7, 4, 7], drift: [5.5, -1.2, -2.5], size: 0.075, color: '#3a1030', color2: '#6a2040', opacity: 1, seed: 3 },
      { kind: 'leaves', t: -1, count: 700, box: [8, 5, 8], drift: [0.7, -0.8, -0.3], size: 0.06, opacity: 0.9, seed: 4 },
      { kind: 'motes', t: -1, count: 260, box: [9, 4, 9], drift: [0.1, 0.12, 0.05], size: 0.045, color: '#bff6ff', color2: '#d9a8ff' },
      // A cool key from the front left, a violet rim from the pool behind.
      { kind: 'light', t: -1, at: { g: [E0[0] + 1.2, 1.4, E0[1] - 0.2] }, color: '#9fb4ff', intensity: 3.5, distance: 6 },
      { kind: 'light', t: -1, at: { g: [E0[0] - 1.2, 1.2, E0[1] + 1.4] }, color: '#c27bff', intensity: 6, distance: 6 },
      // The whip after her.
      { kind: 'night-streaks', t: 5.1, alpha: [[5.1, 0], [5.5, 0.3], [5.9, 0.55]], color: '#b48cff', color2: '#e8d8ff', center: [-3, 0.5], speed: 9, density: 900, gain: 1.0 },
    ],
  }),

  // The long run: the camera keeps pace in the next lane west, trunks whipping past between.
  cut('night-elf-run', ELF_RUN, ELF_CHANGE, 1, {
    mood: 1,
    view: view({ dof: true, bokeh: 3, exposure: 1.35 }),
    fog: HAZE,
    anchor: [-92, 56],
    actors: [{ ...elf, at: RUN[0], yaw: 0 }],
    tracks: {
      elf: {
        path: runPath,
        acts: [{ t: -2, clip: 'idle', loop: true }],
        faces: [{ t: -2, expr: 'focused' }],
      },
    },
    cam: {
      ease: 'linear',
      focus: 'elf',
      range: 3.5,
      keys: [
        { t: 0, p: { g: [CAM_LANE[0][0] + 1.5, 0.9, CAM_LANE[0][1] - 1] }, l: { g: [RUN[0][0] + 1, 1.0, RUN[0][1] + 9] }, fov: 42 },
        ...CAM_LANE.slice(1).map(([x, z]) => ({ t: runTimeAtZ(z), p: { g: [x, 0.95, z] }, l: { a: 'elf', o: [0, 0.45, 0] }, fov: 38 })),
      ],
    },
    fx: [
      VIOLET,
      { kind: 'leaves', t: -1, count: 700, box: [14, 7, 14], drift: [0.9, -0.9, -0.4], size: 0.12, opacity: 0.85, seed: 5 },
      { kind: 'motes', t: -1, count: 420, box: [18, 6, 18], drift: [0.15, 0.1, 0.1], size: 0.05, color: '#bff6ff', color2: '#d9a8ff' },
      { kind: 'light', t: -1, at: { a: 'elf', o: [-1.8, 1.6, 0.4] }, color: '#a9b8ff', intensity: 6, distance: 8 },
      { kind: 'light', t: -1, at: { a: 'elf', o: [1.6, 1.3, -0.6] }, color: '#c27bff', intensity: 10, distance: 7 },
      { kind: 'night-streaks', t: -1, alpha: [[0, 0.55], [0.45, 0]], color: '#b48cff', color2: '#e8d8ff', center: [-3, 0.5], speed: 9, density: 900, gain: 1.0 },
    ],
  }),

  // The change: a violet burst as she springs into the spinning leap.
  cut('night-elf-change', ELF_CHANGE, ELF_LEDGE, 1, {
    mood: 1,
    view: view({ exposure: 1.2 }),
    fog: HAZE,
    anchor: [-90.5, 95],
    actors: [{ ...elf, at: [-90.9, 91.6], yaw: 0 }],
    tracks: {
      elf: {
        path: [
          { t: 0, x: -90.9, z: 91.6 },
          { t: 0.35, x: -90.6, z: 93.6 },
          { t: 1.0, x: -90.4, z: 95.6 },
        ],
        acts: [{ t: -2, clip: 'idle', loop: true }, { t: 0.3, clip: 'break_jumpspin' }],
        faces: [{ t: -2, expr: 'focused' }, { t: 0.3, expr: 'happy' }],
      },
    },
    cam: {
      ease: 'out',
      keys: [
        { t: 0, p: { g: [-95.6, 0.5, 92.4] }, l: { a: 'elf', o: [0, 0.6, 0] }, fov: 40 },
        { t: 1.0, p: { g: [-95.4, 0.6, 94.0] }, l: { a: 'elf', o: [0, 0.9, 0], y0: true }, fov: 38 },
      ],
    },
    fx: [
      VIOLET,
      { kind: 'night-burst', t: 0.32, at: { a: 'elf', o: [0, 0.6, 0], y0: true }, size: 1.1, d: 0.35, color: '#b066ff', color2: '#ff7ad9', light: 30, gain: 0.55 },
      { kind: 'flash', t: 0.34, d: 0.22, rise: 0.04, a: 0.35, color: '#c890ff' },
      { kind: 'light', t: -1, at: { a: 'elf', o: [1.6, 1.3, -0.6] }, color: '#c27bff', intensity: 10, distance: 7 },
      { kind: 'leaves', t: -1, count: 700, box: [10, 6, 10], drift: [1.5, -0.6, 0.8], size: 0.12, opacity: 0.9, seed: 6 },
      { kind: 'motes', t: -1, count: 300, box: [12, 6, 12], drift: [0.2, 0.2, 0.1], size: 0.05, color: '#e0b8ff', color2: '#bff6ff' },
    ],
  }),

  // Along the headland's edge, side on, the night sky and the moon beyond.
  cut('night-elf-ledge', ELF_LEDGE, ELF_LEAP, 1, {
    mood: 1,
    view: view({ exposure: 1.1 }),
    anchor: LEDGE_TO,
    actors: [{ ...elf, at: LEDGE_FROM, yaw: -2.3 }],
    tracks: {
      elf: {
        path: [
          { t: 0, x: LEDGE_FROM[0], z: LEDGE_FROM[1] },
          { t: 1.0, x: LEDGE_TO[0], z: LEDGE_TO[1] },
        ],
        acts: [{ t: -2, clip: 'idle', loop: true }],
        faces: [{ t: -2, expr: 'focused' }],
      },
    },
    cam: {
      ease: 'linear',
      keys: [
        { t: 0, p: [173.4, 24.0, -161.9], l: { a: 'elf', o: [0, 1.7, 0.8], y0: true }, fov: 46 },
        { t: 1.0, p: [171.6, 24.1, -164.4], l: { a: 'elf', o: [0, 1.7, 0.8], y0: true }, fov: 46 },
      ],
    },
    fx: [
      VIOLET,
      { kind: 'night-moon', t: -3, dir: MOON_DIR, size: 11, glow: 4.5, glowA: 0.7 },
      { kind: 'light', t: -1, at: { a: 'elf', o: [-1.5, 1.5, 1] }, color: '#a9b8ff', intensity: 6, distance: 7 },
      { kind: 'motes', t: -1, count: 200, box: [16, 6, 16], drift: [0.6, 0.1, 0.2], size: 0.05, color: '#d9c8ff', color2: '#bff6ff' },
    ],
  }),

  // The leap off the cliff, across the moon.
  cut('night-elf-leap', ELF_LEAP, ELF_WHOOSH, 1, {
    mood: 1,
    view: view({ exposure: 1.1 }),
    anchor: TAKEOFF,
    actors: [{ ...elf, at: LEDGE_TO, yaw: -2.3 }],
    tracks: {
      elf: {
        path: [{ t: 0, x: LEDGE_TO[0], z: LEDGE_TO[1] }, ...LEAP.map(([t, x, z, lift]) => ({ t, x, z, lift }))],
        acts: [{ t: -2, clip: 'idle', loop: true }, { t: 0.3, clip: 'break_backflip', speed: 1.1 }],
        faces: [{ t: -2, expr: 'focused' }],
      },
    },
    cam: {
      ease: 'inout',
      keys: [
        { t: 0, p: LEAP_CAM, l: [APEX[0] + 0.6, APEX[1] - 1.2, APEX[2] + 0.5], fov: 38 },
        { t: 1.75, p: [LEAP_CAM[0] - 0.8, LEAP_CAM[1] - 0.4, LEAP_CAM[2] + 0.6], l: [APEX[0] - 0.4, APEX[1] - 0.8, APEX[2] - 1.2], fov: 36 },
      ],
    },
    fx: [
      VIOLET,
      { kind: 'night-moon', t: -3, dir: MOON_DIR, size: 15, glow: 4.5, glowA: 0.8 },
      { kind: 'light', t: -1, at: { a: 'elf', o: [0, -1.5, 2] }, color: '#a9b8ff', intensity: 8, distance: 8 },
      { kind: 'motes', t: -1, count: 200, box: [16, 8, 16], drift: [0.6, 0.1, 0.2], size: 0.06, color: '#d9c8ff', color2: '#bff6ff' },
    ],
  }),

  // A cyan whoosh through the leaves, dissolving into darkness.
  cut('night-elf-whoosh', ELF_WHOOSH, UNDEAD_IN, 1, {
    mood: 1,
    view: view({ bloom: { intensity: 1.4, threshold: 0.6 } }),
    anchor: [-96, 60],
    actors: [{ ...elf, at: [-120, 40] }],
    tracks: { elf: { show: [[-2, false]] } },
    cam: {
      ease: 'linear',
      spline: false,
      keys: [
        { t: 0, p: { g: [-99.6, 2.2, 88] }, l: { g: [-99.8, 2.0, 70] }, fov: 70, roll: 0.15 },
        { t: 1.25, p: { g: [-99.8, 2.0, 50] }, l: { g: [-99.9, 1.9, 30] }, fov: 70, roll: -0.1 },
      ],
    },
    fx: [
      { kind: 'night-grade', t: -3, mul: '#5ef0ff', gain: 3.0, k: [[0, 1], [0.8, 0.6]] },
      { kind: 'night-veil', t: -1, alpha: [[0, 0.9], [0.2, 0.6], [0.75, 0.3], [1.1, 0.0]], color: '#bffaff', gain: 3 },
      { kind: 'leaves', t: -1, count: 2600, box: [9, 6, 12], drift: [0.4, -0.3, 1.2], size: 0.38, color: '#06222a', color2: '#0f3a44', opacity: 1, seed: 8 },
      { kind: 'night-streaks', t: -1, alpha: [[0, 1], [0.6, 0.7], [1.1, 0]], fill: [[0, 1.2], [0.4, 0.4], [0.9, 0]], color: '#7ff6ff', color2: '#ffffff', speed: 5, gain: 2 },
      { kind: 'fade', t: -1, color: '#000000', curve: [[0, 0], [0.7, 0], [1.2, 1]] },
    ],
  }),
];

// ------------------------------------------------------------------------------- the undead

// He stands on the open sand south-west of the Fallen Star Observatory (its astrolabe at (80, -40)
// in a ring of pillars), clear of the paved path; the camera looks up at him from the south-south-east,
// so the astrolabe hangs behind his right shoulder like the original's great wheel.
const U = [76.0, -26.0];
/** From him toward the camera (unit, x/z), the camera's view direction and its screen right. */
const TO_CAM = [0.316, 0.949];
const FWD = [-TO_CAM[0], -TO_CAM[1]];
const RIGHT = [-FWD[1], FWD[0]];
/** He faces the camera. */
const U_YAW = Math.atan2(TO_CAM[0], TO_CAM[1]);
/** A ground point `ahead` units beyond him (away from the camera) and `right` units to screen right. */
const P = (ahead, right) => [U[0] + FWD[0] * ahead + RIGHT[0] * right, U[1] + FWD[1] * ahead + RIGHT[1] * right];
/** The same, `h` above the ground. */
const G = (ahead, right, h) => {
  const [x, z] = P(ahead, right);
  return { g: [x, h, z] };
};
/** Where the burning rock lands: behind him and right of him, in front of the observatory's pillars. */
const IMPACT = P(6, 1.6);
/** Where he starts his creep (ahead of his mark, away from the camera). */
const U_FROM = P(4.2, -0.3);
const UNDEAD_SCALE = 1.3;
const undead = { id: 'u', spec: UNDEAD, scale: UNDEAD_SCALE };
/** The staff head, in his frame (left, up, ahead), scaled with him. */
const STAFF = [0.45 * UNDEAD_SCALE, 1.35 * UNDEAD_SCALE, 0.25 * UNDEAD_SCALE];
/** The sky behind him, far along the view. */
const SKY = [U[0] + FWD[0] * 70, 26, U[1] + FWD[1] * 70];

/** Molten fissures opening under his claws as he creeps (every step, alternating sides). */
function footfalls(from, to, t0, t1, every) {
  const out = [];
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const side = [-(to[1] - from[1]) / len, (to[0] - from[0]) / len];
  const n = Math.floor((t1 - t0) / every);
  for (let i = 0; i <= n; i++) {
    const t = t0 + i * every;
    const k = (t - t0) / (t1 - t0);
    const s = i % 2 ? 0.5 : -0.5;
    const x = from[0] + (to[0] - from[0]) * k + side[0] * s;
    const z = from[1] + (to[1] - from[1]) * k + side[1] * s;
    out.push({ kind: 'night-cracks', t, at: [x, z], radius: 1.6, grow: 1.1, cells: 1.4, warp: 1.0, width: 0.045, keep: 0.4, gain: 1.7 });
  }
  return out;
}

/** The camera's bearing from him (radians, x = cos, z = sin), for the boulders' arc. */
const CAM_ANGLE = Math.atan2(TO_CAM[1], TO_CAM[0]);
/** Molten boulders climbing out of the ground all round him (not between him and the lens), then blown apart; `dt` shifts the clock. */
const boulders = (dt) => ({
  kind: 'night-rocks',
  t: -9,
  at: G(0.6, 0, 0),
  n: 16,
  radius: 4.2,
  arc: [CAM_ANGLE + 1.0, CAM_ANGLE + Math.PI * 2 - 1.0],
  size: [0.3, 1.0],
  h: [0.2, 2.9],
  rise: [1.8 + dt, 7.2 + dt],
  riseDur: 1.6,
  glow: [[2 + dt, 0.3], [7.5 + dt, 1.0], [8.5 + dt, 2.0]],
  burst: 9.9 + dt,
  burstAt: { g: [IMPACT[0], 1, IMPACT[1]] },
  burstSpeed: 9,
  heat: [[8.45 + dt, 0], [8.55 + dt, 40], [11.5 + dt, 12]],
  heatAt: { g: [IMPACT[0], 3, IMPACT[1]] },
  seed: 52,
});

/** The rock's fall: out of the sky at the top left of the cast shot's frame, across it onto the impact. */
const METEOR_FROM = [IMPACT[0] - RIGHT[0] * 20 + FWD[0] * 40, 32, IMPACT[1] - RIGHT[1] * 20 + FWD[1] * 40];

const undeadShots = [
  // Low on the ground in the dark: his claws creep in and the ground splits into molten fissures.
  cut('night-undead-ground', UNDEAD_IN, UNDEAD_CAST, 2, {
    view: view({ exposure: 0.88, saturation: -0.1, contrast: 0.2, dof: true, bokeh: 4, vignette: { offset: 0.2, darkness: 0.9 } }),
    anchor: U,
    actors: [{ ...undead, at: U_FROM, yaw: U_YAW }],
    tracks: {
      u: {
        path: [
          { t: 0, x: U_FROM[0], z: U_FROM[1] },
          { t: 6.3, x: U[0], z: U[1] },
          { t: 6.6, x: U[0], z: U[1], yaw: U_YAW },
        ],
        acts: [{ t: -2, clip: 'idle', loop: true }],
        faces: [{ t: -2, expr: 'angry' }],
      },
    },
    cam: {
      ease: 'inout',
      focus: 'u',
      range: 1.6,
      keys: [
        { t: 0, p: G(-2.7, 0.85, 0.13), l: G(1.6, -0.1, 0.14), fov: 38 },
        { t: 6.5, p: G(-2.45, 0.7, 0.2), l: G(0.2, 0.0, 0.36), fov: 38 },
      ],
    },
    fx: [
      GRAVE,
      ...footfalls(U_FROM, U, 0.3, 6.2, 0.5),
      { kind: 'night-cracks', t: 0.0, at: P(2.0, 0), radius: 6, grow: 6.5, cells: 0.9, warp: 1.1, width: 0.05, keep: 0.5, gain: 1.0 },
      { kind: 'night-rocks', t: -9, at: { g: [U[0], 0, U[1]] }, n: 30, radius: 2.0, size: [0.05, 0.2], h: [-0.1, 0.02], rise: [-9, -9], riseDur: 0.01, glow: 0.25, seed: 77 },
      { kind: 'night-mist', t: -5, at: { g: [U[0], 0.35, U[1] - 2] }, box: [14, 1.0, 14], count: 46, size: 2.0, color: '#0b1409', opacity: 0.55 },
      { kind: 'embers', t: -1, at: { g: [U[0], 0.6, U[1] - 2] }, count: 260, box: [7, 3, 7], drift: [0.15, 0.7, 0.05], size: 0.035, color: '#ffc85a', color2: '#ff7a1a' },
      { kind: 'motes', t: -1, at: { g: [U[0], 1.2, U[1] - 2] }, count: 160, box: [10, 4, 10], drift: [0.1, 0.15, 0.05], size: 0.04, color: '#9dff6a', color2: '#d0ff9a' },
      { kind: 'light', t: -1, at: { a: 'u', o: [0, 0.12, 0.3] }, color: '#ffae3a', intensity: 3.2, distance: 4.5, flicker: 0.15 },
    ],
  }),

  // He rises into frame and channels; boulders climb out of the ground, a burning rock falls, blast.
  cut('night-undead-cast', UNDEAD_CAST, UNDEAD_OUT, 2, {
    view: view({ exposure: 1.0, saturation: -0.1, contrast: 0.22, dof: true, bokeh: 2.5 }),
    anchor: U,
    actors: [{ ...undead, at: U, yaw: U_YAW }],
    tracks: {
      u: {
        acts: [{ t: -2, clip: 'idle', loop: true }, { t: 0.4, clip: 'cast', loop: true }],
        faces: [{ t: -2, expr: 'angry' }],
      },
    },
    cam: {
      ease: 'inout',
      focus: 'u',
      range: 3,
      keys: [
        { t: 0, p: G(-2.6, 0.5, 0.22), l: G(0.3, 0.0, 0.4), fov: 40 },
        { t: 2.4, p: G(-3.2, 0.6, 0.5), l: G(0, 0.35, 1.3), fov: 40 },
        { t: 8.5, p: G(-3.6, 0.75, 0.6), l: G(0, 0.55, 1.5), fov: 42 },
        { t: 11.5, p: G(-3.8, 0.8, 0.6), l: G(0, 0.6, 1.6), fov: 43 },
      ],
    },
    fx: [
      GRAVE,
      { kind: 'night-cracks', t: -6, at: P(2.0, 0), radius: 6, grow: 6.5, cells: 0.9, warp: 1.1, width: 0.05, keep: 0.5, gain: 1.0 },
      { kind: 'night-cracks', t: 1.2, at: U, radius: 9, grow: 7, cells: 0.8, warp: 1.2, width: 0.06, keep: 0.45, gain: 1.3 },
      { kind: 'night-mist', t: -5, at: { g: [U[0], 0.4, U[1] - 3] }, box: [18, 1.2, 18], count: 50, size: 2.4, color: '#0b1409', opacity: 0.5 },
      // The sky behind him sickens green and swells.
      { kind: 'night-glow', t: -1, at: SKY, size: 110, color: '#7dff3a', k: [[0, 0.15], [3, 0.35], [8.4, 0.8], [8.6, 1.6], [11.5, 2.0]] },
      // The staff's gather.
      { kind: 'swirl', t: 1.2, until: 8.4, at: { a: 'u', o: STAFF }, radius: 1.8, rate: 60, size: 0.22, color: '#7dff6a' },
      { kind: 'night-glow', t: 1.0, at: { a: 'u', o: STAFF }, size: 1.4, color: '#8dff4a', k: [[1, 0], [2.2, 1.2], [8.4, 2.6]], pulse: 0.3 },
      { kind: 'light', t: 0, at: { a: 'u', o: [STAFF[0], STAFF[1], STAFF[2] + 0.4] }, color: '#7dff4a', curve: [[0, 0], [1.5, 0], [2.5, 6], [8.4, 12]], distance: 9, flicker: 0.1 },
      { kind: 'motes', t: -1, at: { a: 'u', o: [0, 1.6, 0] }, count: 220, box: [8, 5, 8], drift: [0.1, 0.35, 0.05], size: 0.045, color: '#9dff6a', color2: '#d0ff9a' },
      { kind: 'embers', t: -1, at: { g: [U[0], 0.6, U[1] - 2] }, count: 360, box: [12, 5, 12], drift: [0.15, 0.9, 0.05], size: 0.035, color: '#ffc85a', color2: '#9dff4a' },
      // Boulders climb out of the ground round him, the burning rock falls, the blast.
      boulders(0),
      { kind: 'night-meteor', t: 4.6, from: METEOR_FROM, to: { g: [IMPACT[0], 0.5, IMPACT[1]] }, d: 3.9, size: 1.6, light: 500 },
      { kind: 'night-impact', t: 8.5, at: { g: [IMPACT[0], 0.8, IMPACT[1]] }, scale: 5.5, toward: G(-3.6, 0.8, 1), light: 900 },
      { kind: 'flash', t: 8.52, d: 0.35, rise: 0.03, a: 0.6, color: '#f4ffd0' },
      { kind: 'shake', t: 8.5, d: 1.6, amp: 0.22 },
      { kind: 'fade', t: 9, color: '#ffffff', curve: [[9.6, 0], [10.6, 0.55], [11.2, 1], [11.5, 1]] },
    ],
  }),
];

/** The blast shot's camera: low behind his left, looking past him into the fire. */
const EX_CAM = G(-3.4, -2.6, 0.35);

const explodeShots = [
  // The blast, close: boulders blown at the lens, the undead black against the fire.
  cut('night-explode', EXPLODE_IN, EXPLODE_OUT, 2, {
    view: view({ exposure: 0.95, saturation: -0.1, contrast: 0.22 }),
    anchor: U,
    actors: [{ ...undead, at: U, yaw: U_YAW + Math.PI - 0.4 }],
    tracks: { u: { acts: [{ t: -3, clip: 'cast', loop: true }], faces: [{ t: -2, expr: 'angry' }] } },
    cam: {
      ease: 'out',
      keys: [
        { t: 0, p: EX_CAM, l: G(3.4, 0.4, 1.9), fov: 44 },
        { t: 2.29, p: G(-3.1, -2.4, 0.32), l: G(3.4, 0.4, 2.5), fov: 41 },
      ],
    },
    fx: [
      GRAVE,
      { kind: 'night-glow', t: -1, at: SKY, size: 110, color: '#7dff3a', k: 1.6 },
      { kind: 'night-cracks', t: -6, at: U, radius: 9, grow: 3, cells: 0.8, warp: 1.2, width: 0.06, keep: 0.45, gain: 1.3 },
      boulders(0.25 - 9.9),
      { kind: 'night-impact', t: 0.05, at: { g: [IMPACT[0], 0.8, IMPACT[1]] }, scale: 5.5, toward: EX_CAM, light: 900, flash: 0.6 },
      { kind: 'embers', t: -1, at: { g: [U[0], 1.0, U[1] - 3] }, count: 400, box: [12, 6, 12], drift: [0.2, 1.4, 0.4], size: 0.04, color: '#ffc85a', color2: '#9dff4a' },
      { kind: 'shake', t: 0.05, d: 1.5, amp: 0.2 },
      { kind: 'fade', t: 1, color: '#ffffff', curve: [[1.3, 0], [2.0, 0.7], [2.29, 1]] },
    ],
  }),
];

export const shots = [...elfShots, ...undeadShots, ...explodeShots];
