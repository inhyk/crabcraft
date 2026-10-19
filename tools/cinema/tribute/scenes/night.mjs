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
/** The original's moonlit wood: a soft lavender multiply, blacks lifted into a grey-violet haze. */
const LAVENDER = { kind: 'night-grade', t: -3, mul: '#d0aef8', mulTop: '#d0c0ff', gain: 1.45, lift: '#2e2244', liftK: 0.6 };
/** The undead's ground, close: olive earth and gold fissures (Starhaven's lavender sand pulled out). */
const EARTH = { kind: 'night-grade', t: -3, mul: '#8e9c68', mulTop: '#a4b47c', gain: 1.0, lift: '#050801', liftK: 0.3 };
/** Grave green under a sickly sky. */
const GRAVE = { kind: 'night-grade', t: -3, mul: '#a8ba98', mulTop: '#b4d68e', gain: 1.0, gainTop: 1.05, lift: '#030600', liftK: 0.3 };

// ------------------------------------------------------------------------------ the night elf

/** A point `dist` from `c` toward `yaw` (0 = +z), `h` above the ground. */
const around = (c, yaw, dist, h) => ({ g: [c[0] + Math.sin(yaw) * dist, h, c[1] + Math.cos(yaw) * dist] });
/** The run's lavender mist: trunks fade into it a few metres off, the way the original's do. */
const MIST = { color: '#6d5f9c', density: 0.05 };
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
/** Where she is t seconds into the run (straight between the RUN points, steady speed). */
function runAt(t) {
  for (let i = 1; i < RUN.length; i++) {
    if (t <= RUN_T[i]) {
      const k = (t - RUN_T[i - 1]) / (RUN_T[i] - RUN_T[i - 1]);
      return [RUN[i - 1][0] + k * (RUN[i][0] - RUN[i - 1][0]), RUN[i - 1][1] + k * (RUN[i][1] - RUN[i - 1][1])];
    }
  }
  return RUN[RUN.length - 1];
}
/** Run seconds of a song second (the shot's first frame is song frame round(74.6 * 24), 74.583 s). */
const runT = (song) => song - Math.round(ELF_RUN * 24) / 24;
// The sounds under the run, measured in the original: she lands in a puddle (and two more steps
// through it), runs into a pond (a bigger, longer splash), and leaps into the change's whoosh.
const PUDDLE_T = [runT(79.72), runT(79.92), runT(80.06)];
const POND_IN = runT(84.38);
const POND_OUT = runT(85.0);
const CHANGE_T = runT(87.95);
/** The puddle round her three steps, long along her line; the pond east of her line, its surface. */
const PUDDLE = [-91.45, 48.2];
const PUDDLE_DIR = [-0.316, 0.949];
const POND = [-92.0, 76.85];
const POND_Y = 7.7;
/** Lifts over the run: a leap across into the puddle, and the spring into the change. */
const LIFTS = [
  ...[[-0.45, 0], [-0.34, 0.3], [-0.22, 0.48], [-0.1, 0.36], [-0.03, 0.12], [0, 0]].map(([dt, h]) => [PUDDLE_T[0] + dt, h]),
  ...[[-0.5, 0], [-0.3, 0.55], [-0.1, 0.95], [RUN_LEN - CHANGE_T, 1.15]].map(([dt, h]) => [CHANGE_T + dt, h]),
];
/** Her lift at run second t (straight between the LIFTS keys, 0 between the two leaps). */
function liftAt(t) {
  if (t <= LIFTS[0][0]) return 0;
  for (let i = 1; i < LIFTS.length; i++) {
    if (t <= LIFTS[i][0]) return LIFTS[i - 1][1] + ((t - LIFTS[i - 1][0]) / (LIFTS[i][0] - LIFTS[i - 1][0])) * (LIFTS[i][1] - LIFTS[i - 1][1]);
  }
  return LIFTS[LIFTS.length - 1][1];
}
/**
 * She runs side on to the camera the whole way (v3's sideways scuttle turned her face-on mid-run).
 * Keys on an even 0.15 s beat that lands on the puddle's frame: the path's spline is uniform per key,
 * and keys a few hundredths apart beside 0.7 s ones made it loop back and turn her to the lens.
 */
const RUN_DT = 0.15;
const runPath = [
  0,
  ...Array.from({ length: 120 }, (_, i) => PUDDLE_T[0] + (i - 40) * RUN_DT).filter((t) => t > 0.05 && t < RUN_LEN - 0.05),
  RUN_LEN,
].map((t) => {
  const [x, z] = runAt(t);
  return { t, x, z, lift: liftAt(t) };
});
const RUN_END = runAt(RUN_LEN);
/**
 * The camera's lane, 7 units west of her smoothed line, and the pines that stood on it (centres,
 * from the forest scatter): dropped for the shot so trunks pass beside the lens, never across it.
 */
const LANE = [
  [-96.0, 18.0], [-96.05, 22.0], [-96.38, 26.0], [-96.74, 30.0], [-96.69, 34.0], [-96.52, 38.0], [-96.85, 42.0], [-97.78, 46.0],
  [-98.78, 50.0], [-99.32, 54.0], [-99.5, 58.0], [-99.5, 62.0], [-99.5, 66.0], [-99.5, 70.0], [-99.5, 74.0], [-99.32, 78.0],
  [-98.88, 82.0], [-98.55, 86.0], [-98.26, 90.0], [-97.94, 94.5],
];
const LANE_PINES = [
  [-93.7, 21.1], [-98.61, 28.75], [-98.54, 38.27], [-97.34, 46.63], [-99.98, 48.78], [-97.97, 53.29], [-102.33, 55.24],
  [-97.72, 58.64], [-97.58, 63.37], [-101.32, 66.51], [-96.72, 66.42], [-102.22, 73.44], [-97.37, 87.17], [-98.51, 89.24],
  // A leaning twisted giant just past her line, far wider than its collider; a pine at the opening key.
  [-93.0, 44.0], [-92.69, 18.93],
];
/** Pines off the lane, plus ferns, bushes and rocks right on it. */
const LANE_CLEAR = {
  kind: 'night-clear',
  t: -3,
  cut: [...LANE_PINES.map(([x, z]) => [x, z, 0.3]), ...LANE.flatMap(([x, z], i) => (i ? [[(x + LANE[i - 1][0]) / 2, z - 2, 1.1], [x, z, 1.1]] : [[x, z, 1.1]]))],
};
/** The lane abreast of her at run second t (the lane's x at her z). */
function laneAt(t) {
  const z = runAt(t)[1];
  for (let i = 1; i < LANE.length; i++) {
    if (z <= LANE[i][1]) return [LANE[i - 1][0] + ((z - LANE[i - 1][1]) / (LANE[i][1] - LANE[i - 1][1])) * (LANE[i][0] - LANE[i - 1][0]), z];
  }
  return LANE[LANE.length - 1];
}
const smooth = (a, b, x) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
/**
 * For the splashes the lens swings in low beside her (`gap` from her line, `h` up, `lead` ahead) and
 * eases back out to the lane: the water reads at her feet instead of seven metres off behind ferns.
 */
const PUSHES = [
  { in: [3.6, 4.95], out: [5.95, 7.2], gap: 4.3, h: 0.7, lead: 0.6 },
  { in: [8.3, 9.6], out: [10.7, 12.0], gap: 4.6, h: 0.75, lead: 0.6 },
];
function pushAt(t) {
  for (const p of PUSHES) {
    const w = smooth(p.in[0], p.in[1], t) * (1 - smooth(p.out[0], p.out[1], t));
    if (w > 0) return { w, p };
  }
  return { w: 0, p: PUSHES[0] };
}
/** The run's camera at t: on the lane, or swung in for a splash. */
function runCam(t) {
  const [lx, lz] = laneAt(t);
  const [x] = runAt(t);
  const { w, p } = pushAt(t);
  return {
    t,
    p: { g: [lx + (x - p.gap - lx) * w, 1.0 + (p.h - 1.0) * w, lz + p.lead * w] },
    l: { a: 'elf', o: [0, 0.5 - 0.2 * w, 1.4 - 0.7 * w] },
    fov: 42 - 2 * w,
  };
}
/** Keys on an even beat (the camera's spline is uniform per key). */
const RUN_CAM = Array.from({ length: 39 }, (_, i) => runCam(((i + 1) * RUN_LEN) / 39));
/** Pines, ferns and rocks off the swung-in path, and out from between the lens and her feet. */
const PUSH_CLEAR = {
  kind: 'night-clear',
  t: -3,
  cut: RUN_CAM.filter((k) => pushAt(k.t).w > 0.2).flatMap((k) => {
    const [cx, , cz] = k.p.g;
    const [x, z] = runAt(k.t);
    return [[cx, cz, 1.6], ...[0.3, 0.55, 0.78].map((f) => [cx + (x - cx) * f, cz + (z - cz) * f + 0.8, 1.1])];
  }),
};
/** Grass blades right at the lens (they cross the frame as pale bars at this height). */
const PUSH_GRASS = { ...PUSH_CLEAR, skip: '^$', cut: PUSH_CLEAR.cut.filter((_, i) => i % 4 === 0).map(([x, z]) => [x, z, 1.3]) };

// The headland's east cliff over the sea: the beast runs up the edge (D), springs off it at 89.5 s as
// in the original, crosses the moon and dives into the sea on the original's loudest splash (91.64 s).
const LEDGE_FROM = [165.9, -160.4];
/** The edge it springs from (ground height measured), and where it hits the water (2-3 deep). */
const TAKEOFF = [169.2, 23.73, -155.8];
const SPRING = ELF_LEDGE + 0.5;
const DIVE = 91.64;
const SPLASH = [176.0, 0, -157.0];
/** The flight: 26 units/s up, gravity (about 3.5 g) that lands it in the sea on the dive's frame. */
const FLY_UP = 26.0;
const FLY_T = DIVE - SPRING;
const FLY_G = (2 * (TAKEOFF[1] + FLY_UP * FLY_T)) / (FLY_T * FLY_T);
const FLY_V = [(SPLASH[0] - TAKEOFF[0]) / FLY_T, FLY_UP, (SPLASH[2] - TAKEOFF[2]) / FLY_T];
/** Where it is at a song second in the air (y up by `dy`). */
function flyAt(song, dy = 0) {
  const s = song - SPRING;
  return [TAKEOFF[0] + FLY_V[0] * s, TAKEOFF[1] + FLY_V[1] * s - 0.5 * FLY_G * s * s + dy, TAKEOFF[2] + FLY_V[2] * s];
}
const APEX = flyAt(SPRING + FLY_UP / FLY_G);
/** The leap's camera, over the sea south-east of the cliff; the moon sits just above the apex from it. */
const LEAP_CAM = [185.0, 27.0, -166.0];
const MOON_DIR = [APEX[0] - LEAP_CAM[0], APEX[1] + 1.2 - LEAP_CAM[1], APEX[2] - LEAP_CAM[2]];
const fly = (t) => ({ kind: 'night-fly', t, actor: 'beast', from: TAKEOFF, vel: FLY_V, g: FLY_G, pitch: 0.7 });
/** The beast: the game's scavenger rig re-dressed sleek black-violet, long and low, violet eyes. */
const beast = { id: 'beast', enemy: 'scavenger', scale: 1.5 };
const SHADE = { kind: 'night-shade', t: -3, actor: 'beast', body: '#150c24', glow: '#b45cff', eyes: '#d890ff', stretch: [1, 0.8, 1.3] };

const elf = { id: 'elf', spec: ELF };

const elfShots = [
  // Out of white, leaves blowing across; she waits among the ferns, alert, then spins and dashes.
  cut('night-elf-face', ELF_IN, ELF_RUN, 1, {
    mood: 1,
    view: view({ dof: true, bokeh: 5, exposure: 1.25, saturation: -0.1, contrast: 0.04 }),
    fog: MIST,
    anchor: E0,
    actors: [{ ...elf, at: E0, yaw: FACE }],
    tracks: {
      elf: {
        path: [
          // Alert: she looks one way, the other, back, then wheels into the dash.
          { t: 0, x: E0[0], z: E0[1], yaw: FACE },
          { t: 1.3, x: E0[0], z: E0[1], yaw: FACE + 0.6 },
          { t: 2.5, x: E0[0], z: E0[1], yaw: FACE - 0.55 },
          { t: 3.5, x: E0[0], z: E0[1], yaw: FACE + 0.3 },
          { t: 4.3, x: E0[0], z: E0[1], yaw: FACE + 0.15 },
          { t: 4.95, x: E0[0] - 0.1, z: E0[1] - 0.1, yaw: FACE + 2.0 },
          { t: 5.3, x: E0[0] - 1.2, z: E0[1] - 1.0 },
          { t: 5.9, x: E0[0] - 4.6, z: E0[1] - 3.2 },
        ],
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
      { ...LAVENDER, k: [[0, 0], [0.35, 0.2], [1.2, 1]] },
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

  // The long run: the camera keeps pace in a cleared lane west of her, trunks whipping past between,
  // the lavender mist behind; a moon rim from beyond her keeps her silhouette. She leaps into a puddle
  // (79.72 s), runs through a pond (84.38 s) and springs into the change's pink burst (87.95 s).
  cut('night-elf-run', ELF_RUN, ELF_CHANGE, 1, {
    mood: 1,
    view: view({ dof: true, bokeh: 2.5, exposure: 1.55, saturation: -0.12, contrast: 0.02 }),
    fog: MIST,
    anchor: [-92, 56],
    actors: [{ ...elf, at: RUN[0], yaw: 0 }],
    tracks: {
      elf: {
        // No looping clip here: the path's speed drives the game's run gait.
        path: runPath,
        faces: [{ t: -2, expr: 'focused' }],
      },
    },
    cam: {
      ease: 'linear',
      focus: 'elf',
      range: 3.5,
      keys: [
        { t: 0, p: { g: [LANE[0][0] + 1.5, 1.0, LANE[0][1] - 1] }, l: { g: [RUN[0][0] + 1, 1.0, RUN[0][1] + 9] }, fov: 44 },
        ...RUN_CAM,
      ],
    },
    fx: [
      LAVENDER,
      LANE_CLEAR,
      PUSH_CLEAR,
      PUSH_GRASS,
      // Grass and ferns out of the water.
      { kind: 'night-clear', t: -3, skip: '^$', cut: [[PUDDLE[0], PUDDLE[1], 1.9], [POND[0], POND[1], 4.0], [POND[0] - 1.2, POND[1] - 2.8, 1.6]] },
      // Ferns between the lens and her where she splashes.
      { kind: 'night-clear', t: -3, cut: [[-94.6, 45.5, 1.4], [-94.6, 48.5, 1.4], [-96.4, 47, 1.2], [-96.4, 50, 1.2], ...[70, 72.5, 75, 77.5, 80].flatMap((z) => [[-95.2, z, 1.5], [-97.2, z, 1.3]])] },
      { kind: 'leaves', t: -1, count: 700, box: [14, 7, 14], drift: [0.9, -0.9, -0.4], size: 0.1, color: '#4a2a5a', color2: '#7a4a7a', opacity: 0.8, seed: 5 },
      { kind: 'motes', t: -1, count: 420, box: [18, 6, 18], drift: [0.15, 0.1, 0.1], size: 0.05, color: '#e4dcff', color2: '#d9a8ff' },
      // Moonlight: a rim from above and beyond her, a soft key from the lens side.
      { kind: 'light', t: -1, at: { a: 'elf', o: [2.4, 2.8, -0.4] }, color: '#e8e0ff', intensity: 34, distance: 9 },
      { kind: 'light', t: -1, at: { a: 'elf', o: [-2.6, 1.9, 0.8] }, color: '#b8b0ff', intensity: 12, distance: 9 },
      { kind: 'night-streaks', t: -1, alpha: [[0, 0.55], [0.45, 0]], color: '#c8b4ff', color2: '#f0e8ff', center: [-3, 0.5], speed: 9, density: 900, gain: 1.0 },
      // The puddle: she lands in it, two more steps splash through.
      {
        kind: 'night-pool', t: -3, at: PUDDLE, size: [1.5, 2.4], yaw: Math.atan2(PUDDLE_DIR[0], PUDDLE_DIR[1]), rise: 0.03, edge: 0.3,
        deep: '#020106', shallow: '#0b0818', sky: '#342c62', moon: [1, 0.22, 0.1], glint: 1.2, opacity: 0.9,
        sheen: 0.9, sheenP: 18, crestK: 0.6, rim: 0.28,
        hits: PUDDLE_T.map((t, i) => [t, ...runAt(t), [1.2, 0.8, 0.7][i]]),
      },
      // Thrown up and forward and out toward the lens, so her legs never hide it; a moonlit glint
      // where each foot breaks the water.
      ...PUDDLE_T.map((t, i) => ({
        kind: 'night-splash', t: t - 0.02, at: { g: [runAt(t)[0], 0.03, runAt(t)[1]] },
        scale: [1.1, 0.8, 0.75][i], dir: [PUDDLE_DIR[0] - 0.45, PUDDLE_DIR[1] * 0.7], count: [220, 110, 90][i], sheets: [70, 34, 30][i],
        mist: [2, 1, 1][i], mistA: 0.04, up: 0.75, drop: 0.8, flare: [1.2, 0.8, 0.7][i], color: '#f4f8ff', gain: 1.2, seed: 40 + i,
      })),
      // The pond: a big splash as she runs in, a wake of spray behind her for the next 0.6 s.
      {
        kind: 'night-pool', t: -3, at: POND, size: [3.2, 3.0], level: POND_Y, edge: 0.22,
        deep: '#020106', shallow: '#0b0818', sky: '#2c2652', moon: [1, 0.22, 0.1], glint: 1.2, opacity: 0.92,
        sheen: 0.7, sheenP: 22, crestK: 0.6, rim: 0.25,
        hits: [[POND_IN, ...runAt(POND_IN), 1.8], ...[1, 2, 3, 4, 5, 6].map((k) => [POND_IN + k * 0.1, ...runAt(POND_IN + k * 0.1), 1.0])],
      },
      // Twice the puddle's first splash where she lands in it, then a bright wake thrown ahead of her
      // and out toward the lens for the next 0.6 s.
      {
        kind: 'night-splash', t: POND_IN - 0.02, at: [runAt(POND_IN)[0], POND_Y, runAt(POND_IN)[1]], scale: 1.9, dir: [-0.2, 0.8], count: 360, sheets: 120,
        mist: 5, mistA: 0.05, up: 0.8, drop: 0.55, flare: 1.8, color: '#f4f8ff', gain: 1.2, seed: 50,
      },
      {
        kind: 'night-splash', t: POND_IN, from: [runAt(POND_IN)[0], POND_Y, runAt(POND_IN)[1]], to: [runAt(POND_OUT)[0], POND_Y, runAt(POND_OUT)[1]],
        d: POND_OUT - POND_IN, scale: 1.2, dir: [-0.2, 1.0], count: 600, sheets: 110, mist: 6, mistA: 0.04, up: 0.75, drop: 0.5, flare: 1, color: '#f4f8ff', gain: 1.2, seed: 51,
      },
      // The change: a magenta burst swallows her mid-leap.
      { kind: 'night-burst', t: CHANGE_T, at: { a: 'elf', o: [0, 0.5, 0] }, size: 1.2, d: 0.6, color: '#ff3fd0', color2: '#ffa6f2', light: 30, gain: 0.7, count: 320 },
      { kind: 'flash', t: CHANGE_T + 0.008, d: 0.2, rise: 0.02, a: 0.4, color: '#ff7ae0' },
    ],
  }),

  // The change: in the pink burst she is gone; the shadow beast bursts out of it and away.
  cut('night-elf-change', ELF_CHANGE, ELF_LEDGE, 1, {
    mood: 1,
    view: view({ dof: true, bokeh: 2, exposure: 1.45, saturation: -0.06, contrast: 0.04 }),
    fog: MIST,
    anchor: [-90.5, 97],
    actors: [{ ...elf, at: RUN_END }, { ...beast, at: RUN_END }],
    tracks: {
      elf: { path: [{ t: 0, x: RUN_END[0], z: RUN_END[1], lift: 1.15 }], show: [[-2, true], [0.1, false]], faces: [{ t: -2, expr: 'focused' }] },
      beast: {
        path: [
          { t: 0.08, x: RUN_END[0], z: RUN_END[1] + 0.2, lift: 1.0 },
          { t: 0.45, x: RUN_END[0] + 0.5, z: RUN_END[1] + 3.2, lift: 0 },
          { t: 1.0, x: RUN_END[0] + 1.3, z: RUN_END[1] + 8.3, lift: 0 },
        ],
        show: [[-2, false], [0.08, true]],
        faces: [{ t: -2, expr: 'angry' }],
      },
    },
    cam: {
      ease: 'linear',
      focus: 'beast',
      range: 4,
      keys: [
        { t: 0, p: { g: [RUN_END[0] - 6.8, 1.1, RUN_END[1] - 0.6] }, l: { g: [RUN_END[0], 1.5, RUN_END[1] + 0.8] }, fov: 42 },
        { t: 0.35, p: { g: [RUN_END[0] - 6.6, 1.0, RUN_END[1] + 0.6] }, l: { a: 'beast', o: [0, 0.6, 0.8] }, fov: 41 },
        { t: 1.0, p: { g: [RUN_END[0] - 5.6, 0.9, RUN_END[1] + 4.6] }, l: { a: 'beast', o: [0, 0.5, 1.4] }, fov: 40 },
      ],
    },
    fx: [
      LAVENDER,
      SHADE,
      { kind: 'night-burst', t: -0.04, at: { g: [RUN_END[0], 1.7, RUN_END[1]] }, size: 1.05, d: 0.75, color: '#ff3fd0', color2: '#ffa6f2', light: 12, gain: 0.45, count: 420 },
      { kind: 'night-veil', t: -1, alpha: [[0, 0.14], [0.12, 0.15], [0.45, 0.05], [0.85, 0]], color: '#ff6ad6', gain: 1.2 },
      { kind: 'night-glow', t: -1, at: { g: [RUN_END[0], 1.5, RUN_END[1]] }, color: '#ff4fd0', size: 3.2, k: [[0, 0.7], [0.4, 0.25], [1, 0.05]] },
      // Pink smoke trailing off the beast as it breaks out.
      { kind: 'night-glow', t: 0.08, at: { a: 'beast', o: [0, 0.6, -0.8] }, color: '#d86cff', size: 1.6, k: [[0.08, 1.2], [0.6, 0.3], [1, 0.05]] },
      { kind: 'light', t: -1, at: { a: 'beast', o: [1.6, 1.8, -0.6] }, color: '#c27bff', intensity: 14, distance: 7 },
      { kind: 'light', t: -1, at: { a: 'beast', o: [-2.2, 1.4, 0.8] }, color: '#b8b0ff', intensity: 10, distance: 7 },
      { kind: 'motes', t: -1, count: 400, box: [10, 6, 10], drift: [0.3, 0.5, 0.2], size: 0.055, color: '#ff9cf0', color2: '#e0b8ff' },
      { kind: 'leaves', t: -1, count: 500, box: [10, 6, 10], drift: [1.5, -0.6, 0.8], size: 0.11, color: '#4a2a5a', color2: '#7a4a7a', opacity: 0.85, seed: 6 },
    ],
  }),

  // The beast runs up the cliff's edge, side on over the sea, and springs off it into the sky.
  cut('night-elf-ledge', ELF_LEDGE, ELF_LEAP, 1, {
    mood: 1,
    view: view({ exposure: 1.15 }),
    anchor: [TAKEOFF[0], TAKEOFF[2]],
    actors: [{ ...beast, at: LEDGE_FROM }],
    tracks: {
      beast: {
        path: [
          { t: 0, x: LEDGE_FROM[0], z: LEDGE_FROM[1] },
          { t: 0.5, x: TAKEOFF[0], z: TAKEOFF[2] },
        ],
        faces: [{ t: -2, expr: 'angry' }],
      },
    },
    cam: {
      ease: 'linear',
      keys: [
        { t: 0, p: [172.6, 24.6, -163.2], l: [166.4, 24.3, -159.6], fov: 42 },
        { t: 0.5, p: [173.6, 24.9, -161.4], l: [169.2, 24.8, -155.8], fov: 42 },
        { t: 1.0, p: [174.4, 25.4, -160.2], l: flyAt(ELF_LEAP, -3.5), fov: 48 },
      ],
    },
    fx: [
      VIOLET,
      SHADE,
      fly(0.5),
      { kind: 'night-moon', t: -3, dir: [MOON_DIR[0], MOON_DIR[1] - 4, MOON_DIR[2]], size: 11, glow: 4.5, glowA: 0.7 },
      { kind: 'light', t: -1, at: { a: 'beast', o: [-1.5, 1.5, 1] }, color: '#a9b8ff', intensity: 16, distance: 8 },
      { kind: 'light', t: -1, at: { a: 'beast', o: [1.8, 2.2, -1.2] }, color: '#c27bff', intensity: 22, distance: 8 },
      { kind: 'motes', t: -1, count: 200, box: [16, 6, 16], drift: [0.6, 0.1, 0.2], size: 0.05, color: '#d9c8ff', color2: '#bff6ff' },
    ],
  }),

  // Across the moon, then down the cliff into the sea: the dive's splash on its frame (91.64 s).
  cut('night-elf-leap', ELF_LEAP, ELF_WHOOSH, 1, {
    mood: 1,
    view: view({ exposure: 1.1 }),
    anchor: [SPLASH[0], SPLASH[2]],
    actors: [{ ...beast, at: [TAKEOFF[0], TAKEOFF[2]] }],
    tracks: { beast: { faces: [{ t: -2, expr: 'angry' }] } },
    cam: {
      ease: 'linear',
      keys: [
        { t: 0, p: LEAP_CAM, l: flyAt(ELF_LEAP, -0.6), fov: 40 },
        { t: 0.45, p: [184.6, 24.5, -165.6], l: flyAt(ELF_LEAP + 0.45, -0.6), fov: 40 },
        { t: 0.95, p: [184.2, 18.0, -165.2], l: flyAt(ELF_LEAP + 0.95, -1.2), fov: 42 },
        { t: 1.4, p: [183.8, 10.0, -164.8], l: flyAt(ELF_LEAP + 1.4, -2.0), fov: 44 },
        { t: 1.75, p: [183.4, 6.5, -164.4], l: [SPLASH[0], 0.8, SPLASH[2]], fov: 44 },
      ],
    },
    fx: [
      VIOLET,
      SHADE,
      fly(SPRING - ELF_LEAP),
      { kind: 'night-moon', t: -3, dir: MOON_DIR, size: 15, glow: 4.5, glowA: 0.8 },
      // A violet top light that dies within 2.4 units: on the beast, never on the cliff face behind it.
      { kind: 'light', t: -1, at: { a: 'beast', o: [0, 1.3, 0.8] }, color: '#c27bff', intensity: 10, distance: 2.4 },
      { kind: 'motes', t: -1, count: 200, box: [16, 8, 16], drift: [0.6, 0.1, 0.2], size: 0.06, color: '#d9c8ff', color2: '#bff6ff' },
      // The entry: a crown of spray round it and a white column thrown up the way it came in.
      { kind: 'night-splash', t: DIVE - ELF_LEAP, at: [SPLASH[0], 0.05, SPLASH[2]], scale: 3.2, dir: [0, 0], count: 700, sheets: 220, mist: 30, up: 1.5, color: '#e6fcff', gain: 1.6, flare: 1.5, seed: 60 },
      { kind: 'night-splash', t: DIVE - ELF_LEAP - 0.01, at: [SPLASH[0], 0.05, SPLASH[2]], scale: 2.6, dir: [0, 0], spread: 0.3, count: 600, sheets: 120, mist: 8, up: 2.3, drop: 1.4, color: '#f2feff', gain: 1.8, seed: 62 },
    ],
  }),

  // Into the water: the splash fills the lens white, the camera goes under into teal and darkness.
  cut('night-elf-whoosh', ELF_WHOOSH, UNDEAD_IN, 1, {
    mood: 1,
    view: view({ bloom: { intensity: 1.4, threshold: 0.6 } }),
    anchor: [SPLASH[0], SPLASH[2]],
    actors: [{ ...beast, at: [SPLASH[0], SPLASH[2]] }],
    tracks: { beast: { show: [[-2, false]] } },
    cam: {
      ease: 'linear',
      spline: false,
      keys: [
        { t: 0, p: [SPLASH[0] + 1.8, 1.3, SPLASH[2] - 1.8], l: [SPLASH[0], 0.4, SPLASH[2]], fov: 70, roll: 0.15 },
        { t: 0.3, p: [SPLASH[0] + 0.9, 0.15, SPLASH[2] - 0.9], l: [SPLASH[0] + 0.6, -1.6, SPLASH[2] + 0.4], fov: 70, roll: 0.05 },
        { t: 1.25, p: [SPLASH[0] + 1.6, -1.3, SPLASH[2] - 0.4], l: [SPLASH[0] + 6, -1.6, SPLASH[2] + 2], fov: 70, roll: -0.1 },
      ],
    },
    fx: [
      { kind: 'night-splash', t: DIVE - ELF_WHOOSH, at: [SPLASH[0], 0.05, SPLASH[2]], scale: 3.2, dir: [0, 0], count: 700, sheets: 180, mist: 6, up: 1.5, drop: 0.6, color: '#e6fcff', gain: 0.9, seed: 60 },
      { kind: 'night-splash', t: DIVE - ELF_WHOOSH - 0.01, at: [SPLASH[0], 0.05, SPLASH[2]], scale: 2.6, dir: [0, 0], spread: 0.3, count: 600, sheets: 120, mist: 4, up: 2.3, drop: 0.8, color: '#f2feff', gain: 1.0, seed: 62 },
      { kind: 'night-splash', t: -0.06, at: [SPLASH[0] + 0.9, 0.05, SPLASH[2] - 0.9], scale: 1.6, dir: [0.4, -0.4], count: 500, sheets: 90, mist: 4, up: 1.2, drop: 0.6, color: '#d8fbff', gain: 0.8, seed: 61 },
      { kind: 'night-grade', t: -3, mul: '#5ef0ff', gain: 3.0, k: [[0, 0.35], [0.3, 1], [0.8, 0.6]] },
      // White water over the lens with structure: foam and spray streaks rushing out, teal in the gaps,
      // the white thinning to bubbles as it goes under.
      {
        kind: 'night-foam', t: -0.05, alpha: [[0, 0.9], [0.2, 0.86], [0.4, 0.7], [0.75, 0.45], [1.1, 0]], cover: [[0, 0.62], [0.12, 0.55], [0.3, 0.38], [0.6, 0.18], [1.0, 0.05]],
        color: '#e8f8fa', gain: 0.85, color2: '#3a9cac', gain2: 0.6, dark: '#05222a', center: [0.02, 0.06], speed: 2.2, scale: 1,
      },
      { kind: 'leaves', t: -1, count: 2600, box: [9, 6, 12], drift: [0.4, -0.3, 1.2], size: 0.38, color: '#06222a', color2: '#0f3a44', opacity: 1, seed: 8 },
      // Bubbles rising past the lens once under.
      { kind: 'motes', t: 0.25, fadeIn: 0.15, count: 600, box: [6, 5, 6], drift: [0.1, 1.6, 0.2], size: 0.07, color: '#e8ffff', color2: '#9ff6ff' },
      { kind: 'night-streaks', t: -1, alpha: [[0, 0.8], [0.6, 0.5], [1.1, 0]], fill: [[0, 0.3], [0.3, 0.1], [0.6, 0]], color: '#7ff6ff', color2: '#ffffff', speed: 5, gain: 1.6 },
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
/** Where the burning rock lands: behind him, screen left, as the original's blasts go up left of him. */
const IMPACT = P(10, -4.2);
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
const boulders = (dt, burstSpeed = 9) => ({
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
  burstSpeed,
  heat: [[8.45 + dt, 0], [8.55 + dt, 40], [11.5 + dt, 12]],
  heatAt: { g: [IMPACT[0], 3, IMPACT[1]] },
  seed: 52,
});

/** The rock's fall: in at the top of the cast shot's frame, right of centre, down across the sky onto the impact. */
const METEOR_FROM = [IMPACT[0] + RIGHT[0] * 13 + FWD[0] * 14, 26, IMPACT[1] + RIGHT[1] * 13 + FWD[1] * 14];
/** When it falls (cast shot seconds) and lands. */
const FALL = 6.3;
const LAND = 8.5;
/** Scenery the undead shots drop: the observatory's grey rubble and its violet astrolabe (it read as clutter). */
const UNDEAD_HIDE = ['observatory-rubble'];
const NO_ASTROLABE = { kind: 'night-drop', t: -3, at: [80, -40], r: 5.5, above: 3 };

const undeadShots = [
  // Low on the ground in the dark: his claws creep in and the ground splits into molten fissures.
  cut('night-undead-ground', UNDEAD_IN, UNDEAD_CAST, 2, {
    view: view({ exposure: 0.95, saturation: -0.1, contrast: 0.24, dof: true, bokeh: 4, vignette: { offset: 0.2, darkness: 0.85 } }),
    hide: UNDEAD_HIDE,
    anchor: U,
    actors: [{ ...undead, at: U_FROM, yaw: U_YAW }],
    tracks: {
      u: {
        path: [
          { t: 0, x: U_FROM[0], z: U_FROM[1] },
          { t: 6.3, x: U[0], z: U[1] },
          { t: 6.6, x: U[0], z: U[1], yaw: U_YAW },
        ],
        faces: [{ t: -2, expr: 'angry' }],
      },
    },
    // Down at his claws: the lens backs away just ahead of him, low, the fissures opening under each step.
    cam: {
      ease: 'inout',
      focus: 'u',
      range: 1.4,
      keys: [
        { t: 0, p: { a: 'u', o: [1.0, 0.32, 3.6] }, l: { a: 'u', o: [0.1, 0.1, 1.0] }, fov: 40 },
        { t: 6.5, p: { a: 'u', o: [0.7, 0.36, 3.0] }, l: { a: 'u', o: [0, 0.2, 0.8] }, fov: 40 },
      ],
    },
    fx: [
      EARTH,
      ...footfalls(U_FROM, U, 0.3, 6.2, 0.5),
      { kind: 'night-cracks', t: 0.0, at: P(2.0, 0), radius: 6, grow: 6.5, cells: 0.9, warp: 1.1, width: 0.05, keep: 0.5, gain: 1.0 },
      { kind: 'night-mist', t: -5, at: { g: [U[0], 0.35, U[1] - 2] }, box: [14, 1.0, 14], count: 46, size: 2.0, color: '#0b1409', opacity: 0.45 },
      { kind: 'embers', t: -1, at: { g: [U[0], 0.6, U[1] - 2] }, count: 260, box: [7, 3, 7], drift: [0.15, 0.7, 0.05], size: 0.035, color: '#ffc85a', color2: '#ff7a1a' },
      { kind: 'motes', t: -1, at: { g: [U[0], 1.2, U[1] - 2] }, count: 160, box: [10, 4, 10], drift: [0.1, 0.15, 0.05], size: 0.04, color: '#9dff6a', color2: '#d0ff9a' },
      // The fissures' glow on his claws, and a low warm fill from the lens side.
      { kind: 'light', t: -1, at: { a: 'u', o: [0, 0.12, 0.3] }, color: '#ffae3a', intensity: 4, distance: 4.5, flicker: 0.15 },
      { kind: 'light', t: -1, at: { a: 'u', o: [0.3, 0.4, 1.6] }, color: '#ffc46a', intensity: 1.6, distance: 4 },
    ],
  }),

  // He rises into frame and casts: the gather, the staff thrust at the sky to call the rock down, the
  // channel held while boulders climb out of the ground round him; the burning rock falls, the blast.
  cut('night-undead-cast', UNDEAD_CAST, UNDEAD_OUT, 2, {
    view: view({ exposure: 1.2, saturation: -0.18, contrast: 0.26, dof: true, bokeh: 2.5 }),
    hide: UNDEAD_HIDE,
    anchor: U,
    actors: [{ ...undead, at: U, yaw: U_YAW }],
    tracks: {
      u: {
        acts: [
          { t: -2, clip: 'idle', loop: true },
          // The gather and channel, the summons flung skyward, the channel again, a second fling at the fall.
          { t: 0.25, clip: 'cast', part: 'channel', loop: true },
          { t: 3.6, clip: 'cast', part: 'release' },
          { t: 4.7, clip: 'cast', part: 'channel', loop: true },
          { t: 6.0, clip: 'cast', part: 'release' },
          { t: 7.1, clip: 'cast', part: 'channel', loop: true },
        ],
        faces: [{ t: -2, expr: 'angry' }, { t: 3.6, expr: 'focused', hold: 0.8 }, { t: 6.0, expr: 'angry' }],
      },
    },
    cam: {
      ease: 'inout',
      focus: 'u',
      range: 3.5,
      keys: [
        { t: 0, p: G(-3.0, 0.55, 0.3), l: G(0, 0.15, 0.95), fov: 40 },
        { t: 3.0, p: G(-3.9, 0.7, 0.42), l: G(0, 0.1, 1.45), fov: 42 },
        { t: 8.5, p: G(-4.3, 0.95, 0.45), l: G(1.5, 0.9, 1.9), fov: 44 },
        { t: 11.5, p: G(-4.5, 1.0, 0.45), l: G(1.5, 0.8, 2.0), fov: 45 },
      ],
    },
    fx: [
      GRAVE,
      NO_ASTROLABE,
      { kind: 'night-cracks', t: -6, at: P(2.0, 0), radius: 6, grow: 6.5, cells: 0.9, warp: 1.1, width: 0.05, keep: 0.5, gain: 1.0 },
      { kind: 'night-cracks', t: 1.2, at: U, radius: 9, grow: 7, cells: 0.8, warp: 1.2, width: 0.06, keep: 0.45, gain: 1.3 },
      { kind: 'night-mist', t: -5, at: { g: [U[0], 0.4, U[1] - 3] }, box: [18, 1.2, 18], count: 50, size: 2.4, color: '#0b1409', opacity: 0.5 },
      // The sky behind him sickens green and swells; deep, not bright.
      { kind: 'night-glow', t: -1, at: SKY, size: 110, color: '#5cc42a', k: [[0, 0.6], [3, 0.6], [8.4, 0.75], [8.6, 1.0], [11.5, 1.1]] },
      // The molten cracks light him from below from the first frame.
      { kind: 'light', t: -1, at: G(-1.3, -0.5, 0.3), color: '#ffb44a', intensity: 16, distance: 6, flicker: 0.15 },
      // A sickly green rim from the sky behind his left.
      { kind: 'light', t: -1, at: G(1.6, -1.8, 2.6), color: '#9dff5a', intensity: 22, distance: 7 },
      // The staff's gather, flaring at each fling.
      { kind: 'swirl', t: 0.6, until: 8.4, at: { a: 'u', o: STAFF }, radius: 1.6, rate: 60, size: 0.2, color: '#7dff6a' },
      { kind: 'night-glow', t: 0.5, at: { a: 'u', o: STAFF }, size: 1.3, color: '#8dff4a', k: [[0.5, 0], [1.6, 1.0], [3.7, 1.4], [3.9, 3.2], [4.6, 1.3], [6.1, 1.6], [6.3, 3.4], [7.2, 1.8], [8.4, 2.2], [8.8, 0.6]] },
      { kind: 'light', t: 0, at: { a: 'u', o: [STAFF[0], STAFF[1], STAFF[2] + 0.4] }, color: '#7dff4a', curve: [[0, 0], [0.8, 0], [1.8, 5], [3.8, 7], [3.95, 16], [4.6, 7], [6.2, 8], [6.35, 18], [7.2, 9], [8.4, 10]], distance: 9, flicker: 0.1 },
      { kind: 'motes', t: -1, at: { a: 'u', o: [0, 1.6, 0] }, count: 220, box: [8, 5, 8], drift: [0.1, 0.35, 0.05], size: 0.045, color: '#9dff6a', color2: '#d0ff9a' },
      { kind: 'embers', t: -1, at: { g: [U[0], 0.6, U[1] - 2] }, count: 360, box: [12, 5, 12], drift: [0.15, 0.9, 0.05], size: 0.035, color: '#ffc85a', color2: '#9dff4a' },
      // Boulders climb out of the ground round him, the burning rock falls, the blast.
      boulders(0),
      { kind: 'night-meteor', t: FALL, from: METEOR_FROM, to: { g: [IMPACT[0], 0.5, IMPACT[1]] }, d: LAND - FALL, size: 1.3, light: 500, glow: 0.4, tail: 14, color: '#8cf03a', core: '#ffb02a' },
      { kind: 'night-impact', t: LAND, at: { g: [IMPACT[0], 0.8, IMPACT[1]] }, scale: 3.4, toward: G(-3.6, 0.8, 1), light: 700, flash: 0.45, gain: 0.45, dust: 0.12, dome: 0, haze: 0.3, puffs: 60, hot: '#fff4a8', color: '#6fe02e', smoke: '#0a1006' },
      { kind: 'flash', t: LAND + 0.02, d: 0.22, rise: 0.03, a: 0.22, color: '#e6ffb0' },
      { kind: 'shake', t: LAND, d: 1.6, amp: 0.22 },
      // The blast's light swells to white for the cut (a veil in the scene, so it brightens, not greys).
      { kind: 'night-veil', t: 9, alpha: [[10.5, 0], [11.15, 0.75], [11.5, 1]], color: '#f6ffe2', gain: 2.5 },
      { kind: 'fade', t: 9, color: '#ffffff', curve: [[11.3, 0], [11.5, 1]] },
    ],
  }),
];

/** The blast shot's camera: low behind his left, looking past him into the fire. */
const EX_CAM = G(-3.4, -2.6, 0.35);

const explodeShots = [
  // Out of a white flash, the blast close: boulders blown at the lens, the undead black against the
  // fire, the camera thrown forward into it.
  cut('night-explode', EXPLODE_IN, EXPLODE_OUT, 2, {
    view: view({ exposure: 0.95, saturation: -0.16, contrast: 0.26 }),
    hide: UNDEAD_HIDE,
    anchor: U,
    actors: [{ ...undead, at: U, yaw: U_YAW + Math.PI - 0.4 }],
    tracks: {
      u: {
        acts: [{ t: -3, clip: 'cast', part: 'channel', loop: true }, { t: 0.15, clip: 'cast', part: 'release' }, { t: 1.2, clip: 'cast', part: 'channel', loop: true }],
        faces: [{ t: -2, expr: 'angry' }],
      },
    },
    cam: {
      ease: 'out',
      shake: 0.04,
      keys: [
        { t: 0, p: EX_CAM, l: G(4, -0.8, 1.9), fov: 46 },
        { t: 2.29, p: G(-2.3, -2.1, 0.5), l: G(4.2, -1.0, 2.4), fov: 39 },
      ],
    },
    fx: [
      GRAVE,
      NO_ASTROLABE,
      { kind: 'night-glow', t: -1, at: SKY, size: 110, color: '#5cc42a', k: 1.0 },
      { kind: 'night-cracks', t: -6, at: U, radius: 9, grow: 3, cells: 0.8, warp: 1.2, width: 0.06, keep: 0.45, gain: 1.3 },
      boulders(0.42 - 9.9, 4.5),
      // Molten rocks between him and the blast, thrown at the lens through the whole shot.
      { kind: 'night-rocks', t: -9, at: G(4.5, -1.2, 0), n: 12, radius: 3.2, size: [0.25, 0.75], h: [0.4, 2.6], rise: [-9, -9], riseDur: 0.01, glow: [[0, 1.2], [0.3, 2.2], [2.3, 1.4]], burst: 0.4, burstAt: { g: [IMPACT[0], 0.2, IMPACT[1]] }, burstSpeed: 4.2, seed: 61 },
      // Two more waves out of the blast itself, so rocks keep coming at the lens to the cut.
      ...[[0.9, 71, 3.6], [1.45, 81, 3.2]].map(([at, seed, speed]) => ({
        kind: 'night-rocks', t: -9, at: G(8.6, -3.4, 0), n: 9, radius: 1.8, size: [0.3, 0.85], h: [0.6, 2.6], rise: [at, at], riseDur: 0.01,
        glow: 2.0, burst: at + 0.01, burstAt: G(12.5, -4.6, 0.5), burstSpeed: speed, seed,
      })),
      { kind: 'night-impact', t: 0.05, at: { g: [IMPACT[0], 0.8, IMPACT[1]] }, scale: 4.0, toward: EX_CAM, light: 900, flash: 0.5, gain: 0.4, dust: 0.15, dome: 0, haze: 0.25, puffs: 35, chunks: 46, chunkSize: 1.4, hot: '#fff4a8', color: '#6fe02e', smoke: '#0a1006' },
      { kind: 'embers', t: -1, at: { g: [U[0], 1.0, U[1] - 3] }, count: 400, box: [12, 6, 12], drift: [0.2, 1.4, 0.4], size: 0.04, color: '#ffc85a', color2: '#9dff4a' },
      { kind: 'shake', t: 0.42, d: 1.5, amp: 0.2 },
      // The original's white flash: white from the cut to 152.33 s, then straight into the blast.
      { kind: 'fade', t: -1, color: '#ffffff', curve: [[0, 0.85], [0.12, 1], [0.4, 1], [0.43, 0]] },
      { kind: 'fade', t: 1, color: '#efffc0', curve: [[1.85, 0], [2.29, 0.45]] },
    ],
  }),
];

export const shots = [...elfShots, ...undeadShots, ...explodeShots];
