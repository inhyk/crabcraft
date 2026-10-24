// Scene 'night' of the tribute (see ../timeline.mjs for the song ranges it fills).
//
// night-elf (68.7 to 93.0): out of white with leaves into the Moonpool Grove at night, graded violet;
// the night elf alert among the ferns, a spin and a dash, a long tracking run through the pines
// (elf-actions.mjs turns most of it into her breakdance moves), then one take from her change in a pink
// burst, carried on at a run, along the headland to its cliff and a leap across the moon into the sea,
// then a cyan whoosh into darkness.
// night-undead (93.0 to 111.0): Starhaven's Fallen Star Ruins, graded grave green, in one take like the
// original's: the undead's claw stamps down and a molten blight spreads out of the step, the lens sweeps
// low round it, climbs his leg to his face and drops to look up at him channelling while boulders climb
// out of the ground round him and gather into the golem; a burning rock falls behind him and the blast
// whites out the frame.
// night-explode (151.92 to 154.21): the same blast, close, the undead black against it.
//
// The run through the pines and the camera beside it were planned off-line from the forest's tree
// collision circles (clear of every trunk); the leap's lifts come from the headland's height field.
import { ELF, UNDEAD } from '../cast.mjs';
import { DIVE_SEAM } from './elf-actions.mjs';

// Cut points (song seconds).
const ELF_IN = 68.7;
const ELF_RUN = 74.6;
const ELF_CHANGE = 88.0;
const ELF_WHOOSH = 91.75;
const UNDEAD_IN = 93.0;
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

// The headland's east cliff over the sea: the change, the beast's run up to the edge, its spring off it
// at 89.5 s as in the original, across the moon and down into the sea on the original's loudest
// splash (91.64 s), all one take (night-elf-dive).
/** The edge it springs from (ground height measured), and where it hits the water (2-3 deep). */
const TAKEOFF = [169.2, 23.73, -155.8];
const SPRING = 89.5;
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
const fly = (t) => ({ kind: 'night-fly', t, actor: 'beast', from: TAKEOFF, vel: FLY_V, g: FLY_G, pitch: 0.7 });
/** The beast: the game's scavenger rig re-dressed sleek black-violet, long and low, violet eyes. */
const beast = { id: 'beast', enemy: 'scavenger', scale: 1.5 };
const SHADE = { kind: 'night-shade', t: -3, actor: 'beast', body: '#150c24', glow: '#b45cff', eyes: '#d890ff', stretch: [1, 0.8, 1.3] };

// The dive take (shot seconds from ELF_CHANGE). The 720 shot ends with her running on and springing,
// the pink burst already lit (DIVE_SEAM): the take picks her up at the top of that spring on the
// headland, carried on at the same speed, and the beast comes out of the burst still travelling,
// lands, runs up the edge along its flight line and springs off it at SPRING.
/** The run's line: straight into the flight's heading. */
const DIVE_DIR = (() => {
  const h = Math.hypot(FLY_V[0], FLY_V[2]);
  return [FLY_V[0] / h, FLY_V[2] / h];
})();
/** To the run's right: south, toward the drop, the lens's side. */
const DIVE_SIDE = [DIVE_DIR[1], -DIVE_DIR[0]];
/** Her speed and lift at the top of the spring (the seam with the 720 shot). */
const SEAM_V = DIVE_SEAM.v;
const SEAM_LIFT = DIVE_SEAM.lift;
/** The hop out of the burst lands at HOP; the beast then picks up to RUN_V by HOP + 0.5. */
const HOP = 0.3;
const RUN_V = 11.5;
const RUN_ACC = (RUN_V - SEAM_V) / 0.5;
const TAKE_SPRING = SPRING - ELF_CHANGE;
/** Distance along the line at take second t. */
function diveS(t) {
  if (t <= HOP) return SEAM_V * t;
  const u = Math.min(t - HOP, 0.5);
  return SEAM_V * HOP + SEAM_V * u + 0.5 * RUN_ACC * u * u + RUN_V * Math.max(0, t - HOP - 0.5);
}
const DIVE_FROM = [TAKEOFF[0] - DIVE_DIR[0] * diveS(TAKE_SPRING), TAKEOFF[2] - DIVE_DIR[1] * diveS(TAKE_SPRING)];
/** Ground point of the run at take second t (to the takeoff), and its lift. */
const diveAt = (t) => {
  const s = diveS(Math.min(t, TAKE_SPRING));
  return [DIVE_FROM[0] + DIVE_DIR[0] * s, DIVE_FROM[1] + DIVE_DIR[1] * s];
};
const diveLift = (t) => (t < HOP ? SEAM_LIFT * (1 - (t / HOP) ** 2) : 0);
/** One path for both of them (she is hidden as the beast takes over), keyed every 1/48 s. */
const divePath = Array.from({ length: Math.round(TAKE_SPRING * 48) + 1 }, (_, i) => {
  const t = i / 48;
  const [x, z] = diveAt(t);
  return { t, x, z, lift: diveLift(t) };
});
/** The plateau's height along the run (flat: 23.7 to 24.1). */
const PLATEAU = 23.9;
/**
 * The camera: low beside the run on its sea side, trucking with it; at the edge it sails on out over
 * the drop and rises so the beast crosses the moon at the apex, then drops faster than it does, so the
 * beast falls past the moon down toward the lens and hits the sea just in front of it.
 * Anchors [t, x, y, z]; keys are taken from them on an even 0.25 s beat (the spline is uniform per key).
 */
const DIVE_CAM = [
  ...[0, 0.5, 1.0, TAKE_SPRING].map((t) => {
    const [x, z] = diveAt(t);
    const k = t / TAKE_SPRING;
    const side = 7.6 - 1.2 * k;
    const lead = 1.6 - 0.8 * k;
    return [t, x + DIVE_SIDE[0] * side + DIVE_DIR[0] * lead, PLATEAU + 1.0 + 1.0 * k * k, z + DIVE_SIDE[1] * side + DIVE_DIR[1] * lead];
  }),
  [2.25, 171.6, 27.6, -165.2],
  [2.75, 174.5, 17.0, -167.5],
  [3.25, 177.0, 8.0, -167.0],
  [DIVE - ELF_CHANGE, 178.4, 5.6, -165.8],
  [ELF_WHOOSH - ELF_CHANGE, 178.7, 5.2, -165.6],
];
function diveCamAt(t) {
  let i = 1;
  while (i < DIVE_CAM.length - 1 && t > DIVE_CAM[i][0]) i++;
  const [a, b] = [DIVE_CAM[i - 1], DIVE_CAM[i]];
  const k = Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0])));
  return [1, 2, 3].map((j) => a[j] + (b[j] - a[j]) * k);
}
/** Where the lens looks: her, then the beast on the ground, its flight, then the water it hits. */
function diveLook(t) {
  if (t <= TAKE_SPRING) {
    const [x, z] = diveAt(t);
    return [x, PLATEAU + 0.7 + diveLift(t), z];
  }
  if (t < DIVE - ELF_CHANGE - 0.1) return flyAt(ELF_CHANGE + t, -0.6);
  return [SPLASH[0], 0.8, SPLASH[2]];
}
const DIVE_KEYS = Array.from({ length: Math.round((ELF_WHOOSH - ELF_CHANGE) / 0.25) + 1 }, (_, i) => {
  const t = Math.min(i * 0.25, ELF_WHOOSH - ELF_CHANGE);
  const air = t > TAKE_SPRING ? Math.min(1, (t - TAKE_SPRING) / 0.75) : 0;
  return { t, p: diveCamAt(t), l: diveLook(t), fov: 42 - 2 * air + 4 * Math.max(0, (t - 2.6) / 1.15) };
});
/** The moon sits just behind the apex from where the lens is then. */
const APEX_T = SPRING + FLY_UP / FLY_G - ELF_CHANGE;
const MOON_DIR = (() => {
  const c = diveCamAt(APEX_T);
  return [APEX[0] - c[0], APEX[1] + 1.4 - c[1], APEX[2] - c[2]];
})();

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

  // One take from the change to the dive: out of the pink burst she has sprung into, carried on by the
  // run, the beast lands running, races up the headland to the cliff's edge, springs off it on 89.5 s,
  // crosses the moon as the lens sails out over the drop after it, and the lens sinks with it to the
  // sea and its splash on the dive's frame (91.64 s).
  cut('night-elf-dive', ELF_CHANGE, ELF_WHOOSH, 1, {
    mood: 1,
    view: view({ exposure: 1.25 }),
    // A moonlit sea haze: the cliff face the beast falls past reads as violet depth behind it, not black.
    fog: { color: '#3c3680', density: 0.022 },
    anchor: [TAKEOFF[0], TAKEOFF[2]],
    actors: [{ ...elf, at: DIVE_FROM }, { ...beast, at: DIVE_FROM }],
    tracks: {
      elf: { path: divePath, show: [[-2, true], [0.08, false]], faces: [{ t: -2, expr: 'focused' }] },
      beast: { path: divePath, show: [[-2, false], [0.06, true]], faces: [{ t: -2, expr: 'angry' }] },
    },
    cam: { ease: 'linear', keys: DIVE_KEYS },
    fx: [
      VIOLET,
      SHADE,
      fly(TAKE_SPRING),
      { kind: 'night-moon', t: -3, dir: MOON_DIR, size: 13, glow: 4.5, glowA: 0.8 },
      // The light she changes in, left where she sprang: shafts, sparks round the shape, glowing smoke
      // that streams on after the beast as it runs out of it.
      {
        kind: 'elf-aura', t: -0.042, pre: 0, at: { g: [DIVE_FROM[0] + DIVE_DIR[0] * 0.4, 1.5, DIVE_FROM[1] + DIVE_DIR[1] * 0.4] }, size: 1.05, d: 0.75,
        color: '#ff3fd0', color2: '#ffa6f2', light: 22, gain: 0.6, stream: 0.2, streamDir: [DIVE_DIR[0] * 3.5, 0.5, DIVE_DIR[1] * 3.5],
      },
      { kind: 'flash', t: -0.034, d: 0.2, rise: 0.02, a: 0.4, color: '#ff7ae0' },
      { kind: 'night-veil', t: -1, alpha: [[0, 0.22], [0.12, 0.18], [0.45, 0.05], [0.85, 0]], color: '#ff6ad6', gain: 1.2 },
      { kind: 'night-glow', t: -1, at: { g: [DIVE_FROM[0], 1.4, DIVE_FROM[1]] }, color: '#ff4fd0', size: 3.2, k: [[0, 0.7], [0.4, 0.25], [1, 0.05]] },
      // Pink smoke trailing off the beast as it breaks out.
      { kind: 'night-glow', t: 0.06, at: { a: 'beast', o: [0, 0.6, -0.8] }, color: '#d86cff', size: 1.6, k: [[0.06, 1.2], [0.6, 0.3], [1, 0.05]] },
      // Moon key and violet rim on the run; over the drop a top light that dies within 2.4 units, on the
      // beast and never on the cliff face behind it.
      { kind: 'light', t: -1, until: TAKE_SPRING + 0.3, fadeOut: 0.3, at: { a: 'beast', o: [-1.5, 1.5, 1] }, color: '#a9b8ff', intensity: 16, distance: 8 },
      { kind: 'light', t: -1, until: TAKE_SPRING + 0.3, fadeOut: 0.3, at: { a: 'beast', o: [1.8, 2.2, -1.2] }, color: '#c27bff', intensity: 22, distance: 8 },
      { kind: 'light', t: TAKE_SPRING, fadeIn: 0.3, at: { a: 'beast', o: [0, 1.3, 0.8] }, color: '#c27bff', intensity: 10, distance: 2.4 },
      // Moonlight off the sea on the cliff face as the beast falls past it, so it falls against rock, not black.
      { kind: 'light', t: 2.6, fadeIn: 0.4, at: [178.5, 10, -161.5], color: '#8f96ff', intensity: 60, distance: 18 },
      { kind: 'motes', t: -1, count: 260, box: [16, 8, 16], drift: [0.6, 0.1, 0.2], size: 0.055, color: '#d9c8ff', color2: '#bff6ff' },
      { kind: 'motes', t: -1, until: 1.2, fadeOut: 0.4, count: 300, box: [10, 6, 10], drift: [0.3, 0.5, 0.2], size: 0.05, color: '#ff9cf0', color2: '#e0b8ff' },
      // The entry: a crown of spray round it and a white column thrown up the way it came in.
      { kind: 'night-splash', t: DIVE - ELF_CHANGE, at: [SPLASH[0], 0.05, SPLASH[2]], scale: 3.2, dir: [0, 0], count: 700, sheets: 220, mist: 30, up: 1.5, color: '#e6fcff', gain: 1.6, flare: 1.5, seed: 60 },
      { kind: 'night-splash', t: DIVE - ELF_CHANGE - 0.01, at: [SPLASH[0], 0.05, SPLASH[2]], scale: 2.6, dir: [0, 0], spread: 0.3, count: 600, sheets: 120, mist: 8, up: 2.3, drop: 1.4, color: '#f2feff', gain: 1.8, seed: 62 },
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
      { kind: 'leaves', t: -1, count: 900, box: [9, 6, 12], drift: [0.4, -0.3, 1.2], size: 0.2, color: '#06222a', color2: '#0f3a44', opacity: 1, seed: 8 },
      // Under: moonlight shafts down through the broken surface, bubbles boiling up past the lens,
      // churned white water below the surface.
      { kind: 'elf-under', t: 0.2, fadeIn: 0.12, d: 1.05, at: [SPLASH[0] + 3.2, -2.4, SPLASH[2] + 1.0], box: [9, 4.6, 9], color: '#5fe8f4', color2: '#e8ffff', gain: 1.0, rise: 1.8 },
      // Bubbles rising past the lens once under.
      { kind: 'motes', t: 0.25, fadeIn: 0.15, count: 600, box: [6, 5, 6], drift: [0.1, 1.6, 0.2], size: 0.07, color: '#e8ffff', color2: '#9ff6ff' },
      // Spray streaks only while it plunges through the splash (the white), gone once under.
      { kind: 'night-streaks', t: -1, alpha: [[0, 0.6], [0.25, 0]], fill: [[0, 0.3], [0.25, 0]], color: '#7ff6ff', color2: '#ffffff', speed: 5, gain: 1.6 },
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
const UNDEAD_SCALE = 1.3;
const undead = { id: 'u', spec: UNDEAD, scale: UNDEAD_SCALE };
/** The staff head, in his frame (left, up, ahead), scaled with him. */
const STAFF = [0.45 * UNDEAD_SCALE, 1.35 * UNDEAD_SCALE, 0.25 * UNDEAD_SCALE];
/** The sky behind him, far along the view. */
const SKY = [U[0] + FWD[0] * 70, 26, U[1] + FWD[1] * 70];

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

/** The broken windmill on a knoll beyond the ground's edge, dark against the sky at the right of the frame
 *  (src/capture/cinema/fx/night-windmill.ts). */
const WINDMILL = { kind: 'night-windmill', t: -3, face: U, yaw: -0.3, scale: 1.4, knoll: 13, cloud: { k: 1.6 } };
/** The golem's feet: behind him, a touch right, so the blast goes up past its left shoulder. */
const GOLEM = P(4.2, 0.2);
/** The summoned golem: the boulders heave up round him (102.7-105.1 s), fly together behind him into
 *  its body (105.5-107.4 s), it straightens as its chest blazes (107.5-108.2 s), leans over him with its
 *  pincer fists forward, and its eyes light at 109.5 s. */
const golem = {
  kind: 'night-golem',
  t: -9,
  at: { g: [GOLEM[0], 0, GOLEM[1]] },
  right: RIGHT,
  src: G(1.2, 0, 0),
  radius: 4.6,
  // Only beside and behind him: the rocks fly away from the lens into its body.
  arc: [CAM_ANGLE + 1.7, CAM_ANGLE + Math.PI * 2 - 1.7],
  scale: 1.45,
  detail: 1,
  lump: 0.75,
  cells: 1.05,
  rise: [9.7, 12.1],
  fly: [12.5, 14.4],
  stand: [14.2, 15.0],
  blaze: [14.5, 15.2],
  loom: [15.2, 18.0],
  eyes: 16.5,
  glow: [[9.5, 0.3], [12.5, 0.42], [14.5, 0.45]],
  rock: '#191510',
  key: '#7f9a78',
  keyK: 0.55,
  amb: '#1c2a18',
  ambK: 0.5,
  rim: '#8cff4a',
  rimK: 0.9,
  seed: 77,
};
/** A far meteor streaking across the storm at 100.4 s, upper right, as the original's does. */
const STREAK = {
  kind: 'night-meteor',
  t: 7.4,
  from: [U[0] + FWD[0] * 46 + RIGHT[0] * 24, 27, U[1] + FWD[1] * 46 + RIGHT[1] * 24],
  to: [U[0] + FWD[0] * 42 - RIGHT[0] * 6, 11, U[1] + FWD[1] * 42 - RIGHT[1] * 6],
  d: 0.95,
  size: 0.55,
  light: 0,
  glow: 0.6,
  tail: 22,
  color: '#a8ff5a',
  core: '#ffe08a',
};

/** The rock's fall: in at the top of the frame, right of centre, down across the sky onto the impact. */
const METEOR_FROM = [IMPACT[0] + RIGHT[0] * 13 + FWD[0] * 14, 26, IMPACT[1] + RIGHT[1] * 13 + FWD[1] * 14];
/** When it falls (shot seconds) and lands. */
const FALL = 12.8;
const LAND = 15.0;
/** Scenery the undead shots drop: the observatory's grey rubble and its violet astrolabe (it read as clutter). */
const UNDEAD_HIDE = ['observatory-rubble'];
/** The observatory's columns: bare cylinders standing by him in the cast and the blast. */
const COLUMNS = ['observatory-column-shafts', 'observatory-column-bases', 'observatory-column-capitals', 'observatory-column-bands', 'observatory-column-runes'];
const NO_ASTROLABE = { kind: 'night-drop', t: -3, at: [80, -40], r: 5.5, above: 3 };

/** A point in his frame (left, up, ahead) on his standing spot, fixed to the ground (he does not travel). */
const H = (left, up, ahead) => G(-ahead, left, up);
/** His frame to the ground: `left` and `ahead` of him. */
const L = (left, ahead) => P(-ahead, left);
/** Where his free (left) claw stamps down, and when: song frame 2251 (93.79 s), the sound at 93.81 s. */
const STEP = L(0.47, 1.25);
const STAMP = 19 / 24;
/** His left claw raised out of frame, lifted higher, stamped down into the ground, pressed in. */
const RAISED = { LF_J0_joint: 0.25, LF_J1_joint: -1.05, LF_J2_joint: 0.2, LF_J3_joint: -0.35 };
const HIGH = { LF_J0_joint: 0.3, LF_J1_joint: -1.3, LF_J2_joint: 0.3, LF_J3_joint: -0.5 };
const PLANT = { LF_J0_joint: 0.15, LF_J1_joint: 0.13, LF_J2_joint: 0, LF_J3_joint: 0 };
const STEP_POSE = {
  kind: 'night-step',
  t: -3,
  actor: 'u',
  keys: [[-1, RAISED], [0.2, RAISED], [0.55, HIGH], [STAMP, PLANT, 'in'], [STAMP + 0.07, { ...PLANT, LF_J1_joint: 0.18 }, 'out'], [STAMP + 0.4, PLANT]],
  pitch: [[0, 0], [0.5, 1.5], [STAMP, -2.5], [STAMP + 0.3, -1.2], [1.6, -1.5], [6.4, -1.5], [7.4, 0]],
  // The claw stays planted until the lens is on his face, then the cast takes his legs back.
  w: [[6.4, 1], [7.4, 0]],
};

/** Where the lens skims the ground in the first seconds (no grass there). */
const LOW_PATH = [L(1.5, 2.3), L(1.8, 2.9), L(1.1, 3.5), L(0.95, 2.7)];
/** Dark grass and dirt round him (src/capture/cinema/fx/night-floor.ts) over Starhaven's flat sand. */
const UNDEAD_FLOOR = {
  kind: 'night-floor',
  t: -3,
  box: [U[0] - 9, U[1] - 9, U[0] + 9, U[1] + 9],
  soil: '#4a3e2a',
  moss: '#3e4a2a',
  litter: '#463a26',
  litter2: '#40382a',
  grass: '#34461f',
  tip: '#a8b870',
  count: 30,
  // Clods, stones, bumpy cracked soil, sparse broken leaves, and the grass in tufts.
  relief: { clods: 3, pebbles: 6, litter: 110 },
  cell: 0.2,
  blade: 'tuft',
  clear: LOW_PATH.map((q) => [...q, 0.6]),
  seed: 23,
};

const undeadShots = [
  // One take, like the original. Low on the dark ground his free claw stamps down into frame on 93.81 s
  // and the blight spreads out of the step, wider and wider, a burning front ahead of the rot; the lens
  // skims back over it and swings round in front of the step, then climbs his claw and body to his face
  // as a sickly glow flares up behind him (98.5 s). It drops to look up at him as he channels; boulders
  // climb out of the ground round him and fly together behind him into the golem, the burning rock
  // falls past its shoulder, the blast, and the light swells to white.
  cut('night-undead', UNDEAD_IN, UNDEAD_OUT, 2, {
    view: view({ exposure: 1.05, saturation: -0.14, contrast: 0.25, dof: true, bokeh: 3.5, vignette: { offset: 0.3, darkness: 0.6 } }),
    hide: [...UNDEAD_HIDE, ...COLUMNS, 'star-quest-waystone', 'star-quest-ore', 'star-quest-ore-cluster', 'star-memory-seal', 'star-memory-seal-frame', 'star-faceted-crystal', 'star-island-crystal-gardens'],
    anchor: U,
    actors: [{ ...undead, at: U, yaw: U_YAW }],
    tracks: {
      u: {
        acts: [
          { t: -3, clip: 'idle', loop: true },
          // The gather and channel, the summons flung skyward, the channel again, a second fling at the fall.
          { t: 6.75, clip: 'cast', part: 'channel', loop: true },
          { t: 8.6, clip: 'cast', part: 'release' },
          { t: 9.7, clip: 'cast', part: 'channel', loop: true },
          { t: 12.5, clip: 'cast', part: 'release' },
          { t: 13.6, clip: 'cast', part: 'channel', loop: true },
        ],
        faces: [{ t: -2, expr: 'angry' }],
      },
    },
    cam: {
      ease: 'linear',
      focus: 'look',
      range: 1.6,
      keys: [
        // The step, close and low: only his claw and the ground, his body above the frame.
        { t: 0, p: H(1.5, 0.45, 2.3), l: H(0.45, 0.0, 1.25), fov: 36 },
        { t: 0.85, p: H(1.49, 0.45, 2.28), l: H(0.45, 0.0, 1.24), fov: 36 },
        // Back and up over the spreading veins, looking down on them...
        { t: 2.2, p: H(1.8, 0.55, 2.9), l: H(0.5, 0.0, 1.4), fov: 40 },
        // ...round in front of the step and higher, the network widening below the lens...
        { t: 3.4, p: H(1.1, 0.7, 3.5), l: H(0.45, 0.0, 1.5), fov: 42 },
        { t: 4.4, p: H(0.95, 0.28, 2.7), l: H(0.45, 0.15, 1.2), fov: 34 },
        // ...in to the planted claw and slowly up it past the beads (his face kept above the frame)...
        { t: 5.4, p: H(1.0, 0.6, 2.5), l: H(0.3, 0.35, 0.7), fov: 30 },
        // ...tilting up to his face on 99.0-99.5 s (his staff out of frame left).
        { t: 6.5, p: H(0.95, 0.95, 2.3), l: H(0.18, 0.92, 0.3), fov: 36 },
        { t: 7.0, p: H(0.95, 1.12, 2.2), l: H(0.2, 0.98, 0.3), fov: 40 },
        // Down to the ground close in front of him, looking up as he raises his claws and channels...
        { t: 8.0, p: H(0.75, 0.5, 2.3), l: H(0.15, 1.0, 0), fov: 42 },
        { t: 9.0, p: H(0.55, 0.3, 2.35), l: H(0.1, 1.4, -0.3), fov: 46 },
        // ...widening and drifting round to his right as the boulders climb out round him and fly
        // together behind him, so he stays big in the frame with the golem rising over him...
        { t: 10.5, p: H(0.25, 0.28, 2.7), l: H(0.0, 1.8, -1.0), fov: 54 },
        { t: 12.5, p: H(-0.25, 0.28, 2.9), l: H(-0.1, 2.4, -2.0), fov: 57 },
        // ...then tilting up the golem as it straightens, blazes and looms, the lens closing in so its
        // head breaks the top of the frame...
        { t: 14.5, p: H(-0.45, 0.22, 2.95), l: H(0.0, 2.75, -2.8), fov: 50 },
        { t: 16.2, p: H(-0.5, 0.2, 3.1), l: H(0.05, 2.95, -2.9), fov: 50 },
        // ...and as it lurches at the lens the lens holds back and tilts up to its eyes (109.95 s).
        { t: 16.95, p: H(-0.55, 0.22, 3.4), l: H(0.05, 4.0, -2.8), fov: 54 },
        { t: 17.6, p: H(-0.5, 0.28, 3.25), l: H(0.05, 4.4, -2.6), fov: 53 },
        { t: 18, p: H(-0.5, 0.3, 3.2), l: H(0.05, 4.5, -2.5), fov: 53 },
      ],
    },
    fx: [
      // Olive earth for the ground, grave green once he is up and casting.
      { ...EARTH, k: [[0, 1], [5.6, 1], [7.4, 0]] },
      { ...GRAVE, k: [[0, 0], [5.6, 0], [7.4, 1]] },
      // The green brightens as the boulders climb (103-107 s): he must not go to a silhouette.
      { kind: 'night-grade', t: -3, mul: '#ffffff', gain: 1.45, k: [[9.4, 0], [10.2, 1], [13.8, 1], [14.6, 0]] },
      NO_ASTROLABE,
      { kind: 'focus', t: -1, until: 6.6, range: [[0, 1.6], [4.4, 1.8], [6.6, 2.4]] },
      // Once he is up, focus stays on him while the lens looks up past him at the golem.
      { kind: 'focus', t: 6.6, at: { a: 'u', o: [0, 0.9, 0] }, range: [[6.6, 2.4], [9.8, 4.5], [14, 6]] },
      { kind: 'lens', t: -1, near: 0.03, until: 6 },
      UNDEAD_FLOOR,
      STEP_POSE,
      // His staff as gnarled dark wood with red prayer beads (src/capture/cinema/fx/night-staff.ts), kicked
      // by the stamp and each fling of the cast.
      // The string hangs off the shaft above the low frame and swings into it as the lens rises at 96.7 s.
      { kind: 'night-staff', t: -3, actor: 'u', beads: { at: 0.72, length: 0.36, swing: [[STAMP, 0.3, 90], [3.7, 0.6, 75], [6.75, 0.35], [8.6, 0.45, 90], [12.5, 0.45, 90]] } },
      // A weathered corpse of a crab (src/capture/cinema/fx/night-rags.ts): rust and grime, rags off his
      // shell and a bandaged leg swinging at the stamp and each fling, a cracked visor, a faded hood.
      { kind: 'night-rags', t: -3, actor: 'u', kicks: [[STAMP, 0.35], [8.6, 0.5], [12.5, 0.5]] },
      { kind: 'shake', t: STAMP, d: 0.45, amp: 0.03 },
      { kind: 'night-blight', t: STAMP + 0.06, step: STAMP, at: STEP, aim: L(0.9, 2.6), lead: 5, branches: 10, width: 0.034, speed: 1.15, radius: 9, dur: 8, rate: 0.8, light: 1.6, gain: 0.85, embers: 260, smoke: 160, smokeA: 0.22, clear: LOW_PATH.map((q) => [...q, 0.9]) },
      { kind: 'night-mist', t: -5, at: { g: [U[0], 0.4, U[1] - 3] }, box: [18, 1.2, 18], count: 50, size: 2.4, color: '#0b1409', opacity: 0.5 },
      { kind: 'motes', t: -1, at: { g: [U[0], 1.2, U[1] - 2] }, count: 160, box: [10, 4, 10], drift: [0.1, 0.15, 0.05], size: 0.04, color: '#9dff6a', color2: '#d0ff9a' },
      // Cold moonlight from above the lens, so the ground and the claw read before the fire opens.
      { kind: 'light', t: -1, at: H(1.2, 3.2, 3.6), color: '#8296bc', curve: [[0, 520], [6.0, 340], [8.0, 30]], distance: 14 },
      // A low cool fill skimming the ground from behind the lens, so the soil, clods and grass read in the dark.
      { kind: 'light', t: -1, at: H(2.4, 0.9, 3.6), color: '#7d8fae', curve: [[0, 170], [5.5, 140], [7.5, 0]], distance: 7 },
      // A pale fill from the lens side once he channels, so his face reads against the green sky.
      { kind: 'light', t: 6, at: H(0.1, 0.6, 2.0), color: '#d6e6a0', curve: [[6.4, 0], [7.4, 14], [9, 70], [18, 70]], distance: 5 },
      // The rocks heaving out round him throw molten light on him, and the gathering summons rims him green.
      { kind: 'light', t: 9, at: H(2.4, 0.5, 0.6), color: '#ff9a40', curve: [[9.6, 0], [12.6, 35], [18, 25]], distance: 5, flicker: 0.2 },
      { kind: 'light', t: 9, at: H(-2.4, 0.5, 0.6), color: '#ff9a40', curve: [[9.6, 0], [12.6, 35], [18, 25]], distance: 5, flicker: 0.2 },
      { kind: 'light', t: 9, at: H(0, 1.8, -1.5), color: '#9dff5a', curve: [[10, 0], [11, 18], [18, 18]], distance: 4 },
      // The blight's fire under his claws, low in front of him: the original's undead is lit from below.
      { kind: 'light', t: 6, at: H(0.2, 0.15, 1.3), color: '#ffb050', curve: [[6.4, 0], [7.6, 12], [9, 45], [18, 45]], distance: 3.5, flicker: 0.2 },
      // 98.5 s: a sickly glow flares up behind him, rims him green, and the sky behind him sickens and swells.
      { kind: 'night-glow', t: 5, at: H(-11, 6, -4), size: 14, color: '#e4ff6a', k: [[5.35, 0], [5.55, 2.8], [6.0, 1.8], [6.5, 1.4], [8.5, 0.6], [9.8, 0]] },
      { kind: 'light', t: 5, at: H(-2.6, 1.6, -2.6), color: '#d8ff6a', curve: [[5.4, 0], [5.55, 40], [6.2, 18], [7.5, 8]], distance: 7 },
      { kind: 'light', t: 5, at: H(-1.2, 1.8, -1.6), color: '#a8ff5a', curve: [[5.4, 0], [5.65, 14], [6.5, 10]], distance: 6 },
      // (Wide and low before the blast: looking up past him it would read as a green sun.)
      { kind: 'night-glow', t: -1, at: SKY, size: 170, color: '#5cc42a', k: [[5.3, 0], [5.7, 0.3], [6.5, 0.35], [9.8, 0.3], [10.4, 0.6], [14.9, 0.65], [15.1, 0.9], [18, 1.0]] },
      // The molten blight lights him from below as it spreads.
      { kind: 'light', t: -1, at: G(-1.3, -0.5, 0.3), color: '#ffb44a', curve: [[1, 0], [4, 8], [7, 16]], distance: 6, flicker: 0.15 },
      // A sickly green rim from the sky behind his left.
      { kind: 'light', t: -1, at: G(1.6, -1.8, 2.6), color: '#9dff5a', curve: [[5.4, 0], [5.8, 22]], distance: 7 },
      // The staff's gather, flaring at each fling.
      { kind: 'swirl', t: 7.1, until: 14.9, at: { a: 'u', o: STAFF }, radius: 1.6, rate: 60, size: 0.08, color: '#7dff6a' },
      // The fling's two hits (101.67, 102.25 s) glint molten in the ground at lower left.
      ...[8.67, 9.25].map((t) => ({ kind: 'night-burst', t, at: H(-1.1, 0.4, 0.3), d: 0.3, size: 0.22, color: '#ffc070', color2: '#ff6a10', light: 40, gain: 0.4 })),
      { kind: 'light', t: 8, at: H(-0.9, 0.08, 1.5), color: '#ff9a3a', curve: [[8.6, 0], [8.67, 22], [8.95, 3], [9.2, 3], [9.25, 22], [9.6, 3], [11, 2]], distance: 3, flicker: 0.2 },
      { kind: 'light', t: 6.5, at: { a: 'u', o: [STAFF[0], STAFF[1], STAFF[2] + 0.4] }, color: '#7dff4a', curve: [[6.5, 0], [7.3, 0], [8.3, 5], [8.8, 7], [8.95, 16], [9.6, 7], [12.7, 8], [12.85, 18], [13.7, 9], [14.9, 10]], distance: 9, flicker: 0.1 },
      { kind: 'motes', t: 6, fadeIn: 1, at: { a: 'u', o: [0, 1.6, 0] }, count: 120, box: [8, 5, 8], drift: [0.1, 0.35, 0.05], size: 0.045, color: '#9dff6a', color2: '#d0ff9a' },
      { kind: 'embers', t: 6, fadeIn: 1.5, at: { g: [U[0], 0.6, U[1] - 2] }, count: 360, box: [12, 5, 12], drift: [0.15, 0.9, 0.05], size: 0.035, color: '#ffc85a', color2: '#9dff4a' },
      // Boulders climb out of the ground round him and fly together behind him into the golem; the
      // burning rock falls past its shoulder, the blast.
      // Fire erupts out of its shoulders and fists at 107.4 s and keeps burning; whole and blazing, it
      // lurches over him at 109.2 s, fists thrust at the lens (the original's swing), every crack flaring.
      { ...golem, loom: [16.2, 17.2], leanTo: 0.45, reach: 1.05, fire: { at: 14.4 }, flare: [[16.9, 1], [17.1, 3], [17.6, 3]] },
      // The ruined windmill held at the right of the frame behind him while the lens moves, as the original's.
      { ...WINDMILL, path: [[6.5, 69.7, -71.2, -9.1], [7, 71.0, -69.4, -9.3], [7.8, 73.5, -65.5, -2.4], [8.6, 77.6, -63.6, 3.4], [9.6, 83.4, -60.9, 6.9], [10.6, 87.8, -57.5, 8.1], [12, 90.8, -53.8, 8.9], [13, 92.3, -52.9, 9.5], [14, 92.6, -52.6, 9.2], [14.6, 92.5, -52.6, 8.6]] },
      // More molten rocks heave out of the ground round him, beside the lens, and the blast throws them.
      { ...boulders(LAND - 9.9), n: 9, size: [0.22, 0.6], h: [0.1, 1.0], rise: [9.6, 12.6], seed: 53 },
      STREAK,
      // Two more far meteors across the storm while it gathers (the original's sky is full of them).
      { ...STREAK, t: 11.4, from: [U[0] + FWD[0] * 50 - RIGHT[0] * 22, 30, U[1] + FWD[1] * 50 - RIGHT[1] * 22], to: [U[0] + FWD[0] * 44 + RIGHT[0] * 2, 14, U[1] + FWD[1] * 44 + RIGHT[1] * 2] },
      { ...STREAK, t: 14.2, from: [U[0] + FWD[0] * 48 + RIGHT[0] * 30, 31, U[1] + FWD[1] * 48 + RIGHT[1] * 30], to: [U[0] + FWD[0] * 42 + RIGHT[0] * 8, 15, U[1] + FWD[1] * 42 + RIGHT[1] * 8] },
      { kind: 'night-meteor', t: FALL, from: METEOR_FROM, to: { g: [IMPACT[0], 0.5, IMPACT[1]] }, d: LAND - FALL, size: 1.3, light: 500, glow: 0.4, tail: 14, color: '#8cf03a', core: '#ffb02a' },
      { kind: 'night-impact', t: LAND, at: { g: [IMPACT[0], 0.8, IMPACT[1]] }, scale: 3.4, toward: G(-3.6, 0.8, 1), light: 700, flash: 0.3, gain: 0.45, dust: 0.12, dome: 0, haze: 0.3, puffs: 60, hot: '#fff4a8', color: '#6fe02e', smoke: '#0a1006' },
      { kind: 'flash', t: LAND + 0.02, d: 0.45, rise: 0.12, a: 0.18, color: '#e6ffb0' },
      { kind: 'shake', t: LAND, d: 1.6, amp: 0.22 },
      { kind: 'shake', t: 16.4, d: 0.9, amp: 0.12 },
      // 110.6 s: its chest bursts and the white swallows the frame by 110.9 s (over everything: a veil in
      // the scene left the claws and beads as white cut-outs in a green hole).
      { kind: 'night-burst', t: 17.6, at: G(3.4, 0.2, 4.6), d: 0.6, size: 3.2, color: '#fff2c0', color2: '#ffb040', light: 600, gain: 1.4 },
      { kind: 'fade', t: 15.5, color: '#fffbea', curve: [[17.6, 0], [17.78, 0.55], [17.92, 1]] },
    ],
  }),
];

/** The blast shot's camera: low behind his left, looking past him into the fire. */
const EX_CAM = G(-3.4, -2.6, 0.35);
/** The golem's feet in the blast shot: far enough back that it stands whole over him. */
const GOLEM_EX = P(7.6, 0.4);

const explodeShots = [
  // Out of a white flash, the blast close: boulders blown at the lens, the undead black against the
  // fire, the camera thrown forward into it.
  cut('night-explode', EXPLODE_IN, EXPLODE_OUT, 2, {
    view: view({ exposure: 0.95, saturation: -0.16, contrast: 0.26 }),
    hide: [...UNDEAD_HIDE, ...COLUMNS],
    anchor: U,
    actors: [{ ...undead, at: U, yaw: U_YAW + Math.PI - 0.4 }],
    tracks: {
      u: {
        acts: [{ t: -3, clip: 'cast', part: 'channel', loop: true }, { t: 0.15, clip: 'cast', part: 'release' }, { t: 1.2, clip: 'cast', part: 'channel', loop: true }],
        faces: [{ t: -2, expr: 'angry' }],
      },
    },
    cam: {
      ease: 'linear',
      // Hand-held and thrown about by the blast, as the original's never stops moving.
      shake: 0.11,
      keys: [
        // Up past him at the golem towering in the blast.
        { t: 0, p: EX_CAM, l: G(6.5, -0.4, 3.5), fov: 50 },
        { t: 0.7, p: G(-3.0, -2.5, 0.45), l: G(6.4, -0.2, 3.6), fov: 49 },
        { t: 1.5, p: G(-2.4, -2.15, 0.55), l: G(6.7, -0.5, 4.3), fov: 47 },
        // Flinching back from the boulder coming at it.
        { t: 2.29, p: G(-2.7, -2.0, 0.75), l: G(6.6, -0.8, 4.4), fov: 52 },
      ],
    },
    fx: [
      GRAVE,
      NO_ASTROLABE,
      { kind: 'night-staff', t: -3, actor: 'u', beads: { swing: [[0.15, 0.5, 90]] } },
      { kind: 'night-rags', t: -3, actor: 'u', kicks: [[0.15, 0.5]] },
      { kind: 'night-glow', t: -1, at: SKY, size: 110, color: '#5cc42a', k: 1.0 },
      { kind: 'night-cracks', t: -6, at: U, radius: 9, grow: 3, cells: 0.8, warp: 1.2, width: 0.06, keep: 0.45, gain: 1.3 },
      boulders(0.42 - 9.9, 4.5),
      { ...WINDMILL, at: { g: [96.5, 19, -53.1] } },
      // The golem he summoned, whole and looming over him, black against the blast; its chest bursts
      // open white-gold at 153.39 s (the original's core in the boulder mass).
      { ...golem, at: { g: [GOLEM_EX[0], 0, GOLEM_EX[1]] }, t: -30, rise: [-30, -29], fly: [-28, -26], stand: [-25, -24], loom: [-23, -21], eyes: -20, lit: -30, blaze: [1.47, 1.9], glow: [[0, 0.5], [1.4, 0.55], [1.6, 0.9], [2.29, 0.7]] },
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
      // 153.39 s: the core bursts in the boulder mass; 153.6-154.1 s a giant molten boulder hurtles out of it
      // at the lens and fills the frame on the 154.01 s hit, into the green-white flash.
      { kind: 'night-burst', t: 1.47, at: G(6.8, 0.4, 5.0), d: 0.5, size: 3, color: '#fff2c0', color2: '#9dff4a', light: 700, gain: 1.5 },
      { kind: 'flash', t: 1.47, d: 0.25, rise: 0.04, a: 0.22, color: '#f6ffd8' },
      { kind: 'night-meteor', t: 1.62, from: G(6.6, 0.2, 4.6), to: G(-1.75, -1.85, 0.8), d: 0.5, size: 2.2, light: 300, glow: 0.5, tail: 3, color: '#8cf03a', core: '#ffb02a' },
      { kind: 'shake', t: 2.09, d: 0.4, amp: 0.3 },
      // Him with his staff up at 152.2-152.6 s, lit from the lens side against the blast.
      { kind: 'light', t: -1, at: G(-2.6, -2.1, 1.4), color: '#d0f0a0', curve: [[0, 40], [1.0, 40], [1.5, 10]], distance: 4 },
      { kind: 'fade', t: 1, color: '#efffc0', curve: [[2.12, 0], [2.29, 0.9]] },
    ],
  }),
];

export const shots = [...elfShots, ...undeadShots, ...explodeShots];
