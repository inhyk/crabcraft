// Scene 'snow' of the tribute (see ../timeline.mjs for the song ranges it fills): Frostlight in a
// blizzard. The dwarf's face out of white, his beast beside him, the two climbing toward the Frozen
// Throne; later the montage's charge through the storm, the human mage's frost among the arena's
// crystals and the tauren roaring in the snowy pines.
import { BEAST, DWARF, MAGE, TAUREN } from '../cast.mjs';

const PI = Math.PI;

// ------------------------------------------------------------------------------------- helpers

/** Frostlight's ground (src/sim/world/ground.ts snowHeight), for world-fixed camera keys. */
const sm = (x, a, b) => (x <= a ? 0 : x >= b ? 1 : ((x - a) / (b - a)) ** 2 * (3 - (2 * (x - a)) / (b - a)));
function ground(x, z) {
  const edge = Math.hypot(x / 128, (z - 2) / 155);
  const plateau = 5 + 14 * sm(-z, 5, 55);
  const hills = Math.sin(x * 0.052) * Math.sin(z * 0.037) * 2.5 * (1 - Math.exp((-x * x) / 600));
  const t = sm(Math.hypot(x, z + 78), 22, 32);
  return edge > 0.83 ? 5 - (edge - 0.83) * 70 : (1 - t) * 19 + t * (plateau + hills);
}
/** A point `up` above the ground at x, z. */
const G = (x, z, up = 0) => [x, ground(x, z) + up, z];
/** World points in a frame standing at x, z facing yaw: (left, up from that ground, ahead). */
function frame(x, z, yaw) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const y = ground(x, z);
  return (left, up, ahead) => [x + left * c + ahead * s, y + up, z - left * s + ahead * c];
}
const r3 = (v) => v.map((n) => +n.toFixed(3));

/**
 * A world-fixed camera move through keys {t, p, l, fov, hold}, sampled every frame so each key is
 * hit at its own time: Hermite segments with Catmull-Rom tangents scaled by the real key spacing,
 * zero velocity where a key says `hold`. Returns stage camera keys (linear, no spline).
 */
function move(keys, fps = 24) {
  const n = keys.length;
  const tan = (i, get) => {
    const k = keys[i];
    if (k.hold) return get(k).map(() => 0);
    const a = keys[Math.max(0, i - 1)];
    const b = keys[Math.min(n - 1, i + 1)];
    const dt = b.t - a.t || 1;
    return get(b).map((v, j) => (v - get(a)[j]) / dt);
  };
  const fields = [(k) => k.p, (k) => k.l, (k) => [k.fov ?? 40], (k) => [k.roll ?? 0]];
  const T = fields.map((f) => keys.map((_, i) => tan(i, f)));
  const out = [];
  const t0 = keys[0].t;
  const t1 = keys[n - 1].t;
  const steps = Math.max(1, Math.round((t1 - t0) * fps));
  for (let s = 0; s <= steps; s++) {
    const t = t0 + ((t1 - t0) * s) / steps;
    let i = 0;
    while (i < n - 2 && t > keys[i + 1].t) i++;
    const a = keys[i];
    const b = keys[i + 1];
    const h = b.t - a.t;
    const u = Math.min(1, Math.max(0, (t - a.t) / h));
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
    const h10 = u ** 3 - 2 * u ** 2 + u;
    const h01 = -2 * u ** 3 + 3 * u ** 2;
    const h11 = u ** 3 - u ** 2;
    const [p, l, f, r] = fields.map((get, fi) =>
      get(a).map((va, j) => h00 * va + h10 * h * T[fi][i][j] + h01 * get(b)[j] + h11 * h * T[fi][i + 1][j]),
    );
    out.push({ t: +t.toFixed(4), p: r3(p), l: r3(l), fov: +f[0].toFixed(2), roll: +r[0].toFixed(4) });
  }
  return { keys: out, ease: 'linear', spline: false };
}

/** Shots tiling [from, to] at the given cut points: [[id, cutStart], ...]. */
function tile(from, to, list) {
  return list.map(([id, at, spec], i) => {
    const end = i + 1 < list.length ? list[i + 1][1] : to;
    return { id, at, length: +(end - at).toFixed(4), chapter: 4, ...spec };
  });
}

// --------------------------------------------------------------------------------- the storm

const COLD = { exposure: 1.08, saturation: -0.2, contrast: 0.05, bloom: { intensity: 0.5, threshold: 1.1 }, vignette: { offset: 0.25, darkness: 0.62 } };

/**
 * The blizzard: an overcast sky, flat light, a cold balance, three snow layers (near streaks, mid
 * streaks, far flakes) on the wind and spindrift over the lens. `heavy` scales the snow.
 */
function blizzard({ wind = [-3, -2.5, 9], heavy = 1, sky = '#dde2ec', zenith = '#b3b9d0', sun = 0.45, hemi = 1.45, tint = [0.94, 0.96, 1.08], drift = 0.12, until } = {}) {
  const u = until === undefined ? {} : { until, fadeOut: 0.01 };
  const k = (v, f) => v.map((x) => +(x * f).toFixed(3));
  return [
    { t: -3, kind: 'snow-sky', horizon: sky, zenith, ...u },
    { t: -3, kind: 'snow-light', sun, hemi, ...u },
    { t: -3, kind: 'snow-grade', tint, ...u },
    { t: -3, kind: 'snow-streaks', count: Math.round(1400 * heavy), box: [9, 6, 9], drift: k(wind, 1.2), gust: [2.5, 1, 3], size: 0.022, trail: 0.05, opacity: 0.95, near: 0.25, seed: 1, ...u },
    { t: -3, kind: 'snow-streaks', count: Math.round(6000 * heavy), box: [26, 14, 26], drift: wind, gust: [2, 1, 2.5], size: 0.018, trail: 0.045, opacity: 0.8, seed: 2, ...u },
    { t: -3, kind: 'snow', count: Math.round(9000 * heavy), box: [70, 34, 70], drift: k(wind, 0.9), size: 0.05, opacity: 0.5, seed: 3, ...u },
    // A few big soft flakes right at the lens.
    { t: -3, kind: 'snow', count: Math.round(120 * heavy), box: [5, 3.5, 5], drift: k(wind, 1.1), size: 0.045, opacity: 0.5, wobble: 0.6, seed: 4, ...u },
    { t: -3, kind: 'wash', color: '#e4ebf6', color2: '#ffffff', alpha: [[-3, drift]], cover: [[-3, 0.42]], flow: [-0.8, -0.12], scale: 2.4, ...u },
  ];
}

// ------------------------------------------------------------------------- snow-open 39.5-68.7

// The dwarf on the slope below the Frozen Throne, off the road, his beast ahead at his right. The
// camera keeps to his left: his sword is in the right claw and would cross the close-ups.
const D = [20, -24];
const YAW0 = PI + 1.25; // looking west-north-west into the storm
const YAW1 = PI; // turned to his right: up the slope, toward the throne
const F0 = frame(D[0], D[1], YAW0);
const F1 = frame(D[0], D[1], YAW1);
/** F1's frame with `up` measured from the ground under the point itself (the slope rises ahead). */
const F1g = (left, up, ahead) => {
  const p = F1(left, 0, ahead);
  return G(p[0], p[2], up);
};
// The beast walks up out of the storm behind him while the camera holds on his face, and stops at
// his left, a little ahead, as the camera pulls back and arcs round in front of him to his right
// (his sword side): both in profile facing frame right, the dwarf near, the beast beyond.
const BEAST_FROM = F1(5.5, 0, -4.0);
const BEAST_NEAR = F1(3.3, 0, 1.4);
const BEAST_AT = F1(2.3, 0, 3.0);

/** The road's lamp posts, out of the whiteout (the road itself is hidden by name). */
const ROAD_OUT = { t: -3, kind: 'snow-hide', box: [-8, -56, 8, 86], max: 4 };
/** The arena's ice disc, its glow rings and the diamonds over the crystals: primitives in a close shot. */
const ARENA_OUT = { t: -3, kind: 'snow-hide', box: [-30, -110, 30, -46], max: 47 };
/** Mira's ice prison by the throne (the world shows it again every frame, so hide its bars). */
const PRISON_OUT = { t: -3, kind: 'snow-hide', box: [9, -66, 17, -58], max: 6 };

const OPEN = 39.5;
const C_TRUDGE = 57.0;
const C_WIDE = 61.0;
const OPEN_END = 68.7;

const cast2 = (dwarfAt, beastAt, yaw) => [
  { id: 'dwarf', spec: DWARF, at: dwarfAt, yaw },
  { id: 'beast', enemy: BEAST.enemy, scale: BEAST.scale, at: beastAt, yaw },
];

const face = {
  anchor: D,
  hide: ['mira-ice-prison', 'world4-flagstone-paths'],
  view: { ...COLD, dof: true, bokeh: 3 },
  fog: { color: '#dde2ec', density: 0.04 },
  actors: cast2(D, [BEAST_FROM[0], BEAST_FROM[2]], YAW1),
  tracks: {
    dwarf: {
      path: [
        { t: 0, x: D[0], z: D[1], yaw: YAW0 },
        { t: 4.6, x: D[0], z: D[1], yaw: YAW0 - 0.12 },
        { t: 7.6, x: D[0], z: D[1], yaw: YAW1 },
        { t: 17.5, x: D[0], z: D[1], yaw: YAW1 },
      ],
      faces: [{ t: -2, expr: 'focused' }, { t: 3.1, expr: 'blink', hold: 0.16 }, { t: 3.3, expr: 'focused' }, { t: 9.2, expr: 'blink', hold: 0.16 }, { t: 9.4, expr: 'focused' }],
      acts: [{ t: 13.5, clip: 'claw_right' }],
    },
    beast: {
      path: [
        { t: 9.0, x: BEAST_FROM[0], z: BEAST_FROM[2] },
        { t: 12.0, x: BEAST_NEAR[0], z: BEAST_NEAR[2], yaw: Math.atan2(BEAST_NEAR[0] - BEAST_FROM[0], BEAST_NEAR[2] - BEAST_FROM[2]) },
        { t: 13.2, x: BEAST_AT[0], z: BEAST_AT[2], yaw: YAW1 },
      ],
      show: [[-5, false], [8.8, true]],
      faces: [{ t: -2, expr: 'neutral' }, { t: 13.4, expr: 'angry' }],
      acts: [{ t: 13.5, clip: 'attack_slam' }, { t: 15.9, clip: 'claw_left' }],
    },
  },
  cam: {
    ...move([
      { t: 0, p: F0(-0.05, 0.52, 1.7), l: F0(0, 0.7, 0.2), fov: 31 },
      { t: 4.6, p: F0(-0.02, 0.54, 1.45), l: F0(0, 0.71, 0.25), fov: 30 },
      { t: 7.6, p: F1(1.9, 0.7, 1.2), l: F1(0, 0.74, 0.7), fov: 28 },
      { t: 10.5, p: F1(1.75, 0.68, 1.25), l: F1(0, 0.74, 0.75), fov: 27 },
      { t: 12.1, p: F1(-1.1, 0.95, 3.9), l: F1(0.5, 0.8, 0.9), fov: 36 },
      { t: 13.6, p: F1g(-3.4, 0.8, 0.5), l: F1g(0.7, 0.72, 1.4), fov: 46 },
      { t: 17.5, p: F1g(-3.15, 0.8, 0.25), l: F1g(0.7, 0.76, 1.4), fov: 45 },
    ]),
    focus: 'dwarf',
    range: 1.6,
  },
  fx: [
    ...blizzard({ wind: [-2.5, -2.2, 9] }),
    ROAD_OUT,
    PRISON_OUT,
    ARENA_OUT,
    { t: 0, kind: 'fade', color: '#ffffff', curve: [[0, 1], [0.35, 0.9], [1.0, 0.35], [1.5, 0]] },
    { t: 13.9, kind: 'shake', d: 0.7, amp: 0.04 },
  ],
};

// Behind them, low, as they trudge up the slope toward the throne's crystals in the storm.
const TR = { d0: F1(0, 0, 0.6), b0: F1(-2.6, 0, 1.4) };
const trudge = {
  anchor: [D[0], D[1] - 3],
  hide: ['mira-ice-prison', 'world4-flagstone-paths'],
  view: { ...COLD, dof: true, bokeh: 1.5 },
  fog: { color: '#dde2ec', density: 0.016 },
  actors: cast2([TR.d0[0], TR.d0[2]], [TR.b0[0], TR.b0[2]], YAW1),
  tracks: {
    dwarf: { path: [{ t: 0, x: TR.d0[0], z: TR.d0[2] }, { t: 4, x: TR.d0[0] + 0.3, z: TR.d0[2] - 5.2 }], faces: [{ t: -2, expr: 'focused' }] },
    beast: { path: [{ t: 0, x: TR.b0[0], z: TR.b0[2] }, { t: 4, x: TR.b0[0] + 0.2, z: TR.b0[2] - 5.4 }], faces: [{ t: -2, expr: 'neutral' }] },
  },
  cam: {
    ...move([
      { t: 0, p: F1(-0.6, 1.25, -5.6), l: G(22, -62, 3.5), fov: 40 },
      { t: 4, p: F1(-0.6, 1.4, -3.9), l: G(22, -62, 4), fov: 39 },
    ]),
    focus: 'dwarf',
    range: 8,
  },
  fx: [...blizzard({ wind: [-2, -2.2, 9.5], heavy: 1.1 }), ROAD_OUT, PRISON_OUT, ARENA_OUT],
};

// Far down the slope: two small figures climbing toward the throne's crystals in the whiteout, a
// pine's edge sliding in at the right before the white takes over.
const WD = { d0: [20, -32], d1: [19.6, -42.5], b0: [21.8, -34.8], b1: [21.4, -45.3] };
const wide = {
  anchor: [19, -37],
  hide: ['mira-ice-prison', 'world4-flagstone-paths'],
  // No vignette and little bloom: the shot ends on flat white with leaves drawn over it.
  view: { ...COLD, saturation: -0.3, vignette: null, bloom: { intensity: 0, threshold: 5 } },
  fog: { color: '#d6dbe7', density: 0.0045 },
  actors: cast2(WD.d0, WD.b0, YAW1),
  tracks: {
    dwarf: { path: [{ t: 0, x: WD.d0[0], z: WD.d0[1] }, { t: 7.7, x: WD.d1[0], z: WD.d1[1] }] },
    beast: { path: [{ t: 0, x: WD.b0[0], z: WD.b0[1] }, { t: 7.7, x: WD.b1[0], z: WD.b1[1] }] },
  },
  cam: move([
    { t: 0, p: G(9, 6, 1.8), l: G(4, -72, 7), fov: 30 },
    { t: 7.7, p: G(12.5, 5.2, 2.2), l: G(5, -72, 7.5), fov: 29 },
  ]),
  fx: [
    ...blizzard({ wind: [-3, -2.5, 10], heavy: 1.2, drift: 0.12, sky: '#cdd3e2', zenith: '#9aa3c2' }),
    ROAD_OUT,
    PRISON_OUT,
    ARENA_OUT,
    { t: -3, kind: 'snow-pines', trees: [[17, -5, 0.9], [19.5, -11, 1.15]] },
    { t: 6.3, kind: 'snow-leaves', count: 260, box: [9, 6, 9], drift: [-2.5, -1.2, 3.5], size: 0.15, color: '#b8436f', color2: '#7a3fb8', fadeIn: 0.8 },
    { t: 6.6, kind: 'snow-whiteout', curve: [[6.6, 0], [7.0, 0.25], [7.35, 0.62], [7.6, 1], [7.7, 1]] },
  ],
};

// ---------------------------------------------------------------------- snow-charge 146.58-151.92

// The west woods: pines and ice cliffs behind, open snow in front.
const CH = [-30, -9];
const charge = {
  anchor: [-38, -9],
  view: { ...COLD, dof: true, bokeh: 2 },
  fog: { color: '#cdd6e2', density: 0.03 },
  actors: cast2([-58, -6], [-56, -10.5], PI / 2),
  tracks: {
    beast: { path: [{ t: 0, x: -56, z: -10.5 }, { t: 2.92, x: -27, z: -10.2 }], faces: [{ t: -2, expr: 'angry' }] },
    dwarf: { path: [{ t: 0, x: -64, z: -7 }, { t: 2.92, x: -46, z: -7.5 }], faces: [{ t: -2, expr: 'angry' }] },
  },
  cam: { keys: [{ t: 0, p: G(CH[0], CH[1], 0.5), l: { a: 'beast', o: [0, 1.2, 0] }, fov: 46 }, { t: 2.92, p: G(CH[0] + 0.3, CH[1] + 0.2, 0.45), l: { a: 'beast', o: [0, 1.2, 0] }, fov: 46 }], ease: 'linear' },
  fx: [...blizzard({ wind: [6, -2, 4], heavy: 1.3 }), ROAD_OUT, { t: 2.2, kind: 'shake', d: 0.8, amp: 0.06 }],
};
const chargeDwarf = {
  anchor: [-40, -8],
  view: { ...COLD, dof: true, bokeh: 2 },
  fog: { color: '#cdd6e2', density: 0.03 },
  actors: cast2([-50, -6.5], [-34, -10], PI / 2),
  tracks: {
    beast: { path: [{ t: 0, x: -34, z: -10.6 }, { t: 2.42, x: -16, z: -11.5 }], faces: [{ t: -2, expr: 'angry' }] },
    dwarf: { path: [{ t: 0, x: -50, z: -6.5 }, { t: 2.42, x: -34, z: -8.8 }], faces: [{ t: -2, expr: 'angry' }], acts: [{ t: -0.5, clip: 'claw_right', upper: true }] },
  },
  cam: { keys: [{ t: 0, p: G(-37, -9.6, 0.45), l: { a: 'dwarf', o: [0, 0.6, 0] }, fov: 44 }, { t: 2.42, p: G(-36.8, -9.8, 0.45), l: { a: 'dwarf', o: [0, 0.6, 0] }, fov: 44 }], ease: 'linear' },
  fx: [...blizzard({ wind: [6, -2, 4], heavy: 1.3 }), ROAD_OUT],
};

// ----------------------------------------------------------------------- snow-frost 157.71-163.08

// Among the Frozen Throne's crystals: the mage by the pillar at (21.7, -65.5).
const MG = [27.4, -84.2];
const MYAW = 1.0;
const MF = frame(MG[0], MG[1], MYAW);
const frostCast = {
  anchor: MG,
  view: { ...COLD, saturation: -0.05, bloom: { intensity: 1.1, threshold: 0.85 }, dof: true, bokeh: 2.5 },
  fog: { color: '#7d88b0', density: 0.02 },
  actors: [{ id: 'mage', spec: MAGE, at: MG, yaw: MYAW }],
  tracks: { mage: { acts: [{ t: -0.6, clip: 'cast', loop: true }], faces: [{ t: -2, expr: 'focused' }] } },
  cam: move([
    { t: 0, p: MF(1.3, 0.4, 2.9), l: MF(0, 0.95, 0), fov: 40 },
    { t: 2.71, p: MF(0.9, 0.42, 2.4), l: MF(0, 1.0, 0), fov: 40 },
  ]),
  fx: [
    ...blizzard({ wind: [-2, -1.5, 6], sky: '#8c97bd', zenith: '#3d4772', sun: 0.35, hemi: 1.0, tint: [0.84, 0.92, 1.15] }),
    ARENA_OUT,
    { t: 0, kind: 'fade', color: '#ffe6f0', curve: [[0, 1], [0.59, 0]] },
    { t: 0.6, kind: 'vfx', recipe: 'frostSpray', args: [{ pt: { a: 'mage', o: [0, 0.4, 0.4] } }, MYAW, 4, 0.6] },
    { t: 0.4, kind: 'light', at: { a: 'mage', o: [0, 1.2, 0.8] }, color: '#7fc8ff', curve: [[0.4, 0], [0.8, 40], [2.71, 30]], distance: 12 },
  ],
};
// The arena's east crystal (25, -78), seen from inside the ring: the mage at its foot against the sky.
const PL = [25, -78];
const MP = [23.2, -78.2];
const frostPillar = {
  anchor: [21, -78],
  hide: ['mira-ice-prison'],
  view: { ...COLD, exposure: 1.22, saturation: -0.02, bloom: { intensity: 1.3, threshold: 0.8 }, dof: true, bokeh: 1.5 },
  fog: { color: '#b3bce0', density: 0.012 },
  actors: [{ id: 'mage', spec: MAGE, at: MP, yaw: -PI / 2 }],
  tracks: { mage: { acts: [{ t: -1, clip: 'cast', loop: true }], faces: [{ t: -2, expr: 'focused' }] } },
  cam: {
    ...move([
      { t: 0, p: G(19.4, -79.6, 0.35), l: G(23.6, -78.1, 1.5), fov: 44 },
      { t: 0.91, p: G(19.5, -79.4, 0.45), l: G(23.6, -78.1, 1.7), fov: 43 },
    ]),
    focus: 'mage',
    range: 5,
  },
  fx: [
    ...blizzard({ wind: [-2, -1.5, 6], sky: '#b4bce0', zenith: '#525c90', sun: 0.6, hemi: 1.3, tint: [0.88, 0.94, 1.12], drift: 0.06 }),
    PRISON_OUT,
    ARENA_OUT,
    { t: -1, kind: 'light', at: { a: 'mage', o: [0, 1.0, 0.6] }, color: '#8fd2ff', intensity: 25, distance: 9 },
  ],
};
const frostRise = {
  ...frostPillar,
  cam: move([
    { t: 0, p: G(20.8, -79.0, 1.0), l: G(PL[0], PL[1], 3.0), fov: 46 },
    { t: 0.71, p: G(21.2, -78.9, 3.3), l: G(PL[0], PL[1], 7.2), fov: 46 },
  ]),
  fx: [...frostPillar.fx, { t: 0, kind: 'flash', color: '#f4f0ff', d: 0.3, a: 0.6 }],
};
// The tauren roaring among the east woods' pines.
const TA = [76, -6];
const tauren = {
  anchor: TA,
  hide: ['mira-ice-prison'],
  view: { ...COLD, dof: true, bokeh: 1.5 },
  fog: { color: '#cfd7e2', density: 0.028 },
  actors: [{ id: 'tauren', spec: TAUREN, at: TA, yaw: -PI / 2 - 0.25 }],
  tracks: { tauren: { acts: [{ t: 0.05, clip: 'attack_slam', from: 1.235, to: 1.9, speed: 0.6 }], faces: [{ t: -2, expr: 'angry' }] } },
  cam: {
    ...move([
      { t: 0, p: G(TA[0] - 3.6, TA[1] + 1.0, 0.45), l: G(TA[0], TA[1], 1.25), fov: 40 },
      { t: 1.04, p: G(TA[0] - 3.3, TA[1] + 0.95, 0.5), l: G(TA[0], TA[1], 1.35), fov: 39 },
    ]),
    focus: 'tauren',
    range: 4,
  },
  fx: [
    ...blizzard({ wind: [3, -2.5, 6] }),
    { t: -3, kind: 'snow-pines', trees: [[80.5, -3.0, 1.05], [81.0, -9.5, 0.9], [79.0, 2.5, 1.0], [84.0, -1.0, 1.2]] },
    { t: 0.35, kind: 'shake', d: 0.6, amp: 0.03 },
  ],
};

export const shots = [
  ...tile(OPEN, OPEN_END, [
    ['snow-face', OPEN, face],
    ['snow-trudge', C_TRUDGE, trudge],
    ['snow-wide', C_WIDE, wide],
  ]),
  ...tile(146.58, 151.92, [
    ['snow-charge-beast', 146.58, charge],
    ['snow-charge-dwarf', 149.5, chargeDwarf],
  ]),
  ...tile(157.71, 163.08, [
    ['snow-frost-cast', 157.71, frostCast],
    ['snow-frost-pillar', 160.42, frostPillar],
    ['snow-frost-rise', 161.33, frostRise],
    ['snow-tauren', 162.04, tauren],
  ]),
];
