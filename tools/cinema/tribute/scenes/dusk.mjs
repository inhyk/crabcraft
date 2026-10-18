// Scene 'dusk' of the tribute (see ../timeline.mjs for the song ranges it fills), all in Clawhaven:
// a fireball falls on the southern ridge at sunset and the tauren rises on the hill over the bay;
// the village burns and the orc roars in its street; a fireball strikes the lighthouse and the giant
// smashes it while a warrior leaps from its gallery; later, the orc and the night elf clash at sunset.
// Effects named dusk-* live in src/capture/cinema/fx/dusk-fire.ts.
import { ELF, GIANT, ORC, TAUREN } from '../cast.mjs';

/** The portal on the beach by the wreck: a game object that does not belong in a cinematic. */
const PORTAL = '클로헤이븐 → 별빛 항구';
const deg = (d) => (d * Math.PI) / 180;
/** A point at a bearing (degrees, 0 = +z, 90 = +x) and distance from [x, z], h above the ground. */
const polar = ([x, z], bearing, dist, h) => ({ g: [x + Math.sin(deg(bearing)) * dist, h, z + Math.cos(deg(bearing)) * dist] });
/** The same point as [x, z]. */
const flat = ([x, z], bearing, dist) => [x + Math.sin(deg(bearing)) * dist, z + Math.cos(deg(bearing)) * dist];

// ------------------------------------------------------------------------------------ cut points
const C = {
  meteor: 111.0,
  rise: 113.0,
  reveal: 117.5,
  dive: 121.0,
  smoke: 124.0,
  orc: 128.25,
  tower: 136.5,
  giant: 141.0,
  leap: 142.0,
  black: 143.96,
  clashA: 154.21,
  clashB: 155.75,
  white: 157.71,
};
const span = (from, to) => ({ at: from, length: +(to - from).toFixed(4) });

// ------------------------------------------------------------------------------- 1. dusk-tauren
// The sun sets over the bay at bearing 42 degrees, 13 degrees up. The southern ridge (z 175..200,
// 20 to 27 high) takes the fireball; the tauren sits on the lip of the town's plateau above the
// beach, by the tall tree at (95.5, 2.3).
const IMPACT = { g: [165, 0, 188] };
const IMPACT_PLUME = { t: -30, kind: 'dusk-plume', at: { g: [165, 4, 188] }, rate: 3, life: 26, rise: 4.5, spread: 6, size0: 10, size1: 34, wind: [3, 1], prewarm: 30, opacity: 0.55, color: '#3a2c26', glow: '#d0581a', glowH: 10 };
const T = [92.1, -2.8];
const DUSK_VIEW = { exposure: 1.05, saturation: 0.18, contrast: 0.08, bloom: { intensity: 1.3, threshold: 0.75, radius: 0.8 }, vignette: { offset: 0.25, darkness: 0.6 } };
const MOTES = (n = 260, box = [14, 6, 14]) => ({ t: -5, kind: 'motes', color: '#ffd28a', color2: '#ffb36b', count: n, box, drift: [0.25, 0.12, 0.1], size: 0.035, opacity: 0.7 });

const meteor = {
  id: 'dusk-meteor',
  ...span(C.meteor, C.rise),
  chapter: 1,
  mood: 0,
  hide: [PORTAL],
  anchor: [150, 150],
  view: { ...DUSK_VIEW, saturation: 0.25, bloom: { intensity: 1.6, threshold: 0.7, radius: 0.85 } },
  actors: [],
  cam: {
    keys: [
      { t: 0, p: { g: [137, 1.4, 133] }, l: { g: [163, 16, 188] }, fov: 38 },
      { t: 2, p: { g: [138.5, 1.6, 137] }, l: { g: [164, 21, 188] }, fov: 34 },
    ],
    ease: 'linear',
  },
  fx: [
    { t: 0, kind: 'fade', color: '#fff6ea', curve: [[0, 1], [0.35, 0.93], [0.95, 0.42], [1.35, 0]] },
    { t: 0.12, kind: 'dusk-fireball', from: [300, 150, 250], to: IMPACT, d: 0.9, size: 2.4, trail: 120, light: 2500, distance: 160 },
    { t: 1.02, kind: 'dusk-blast', at: IMPACT, r: 10, column: 8, light: 6000, distance: 180, flashA: 0.75, flashD: 0.35, flashColor: '#ffe2b0', shake: 0.1, puffs: 56, debris: 44 },
    { t: 1.02, kind: 'shake', d: 0.7, amp: 0.12 },
  ],
};

// He sits on the lip of the plateau facing the ridge, rises as the camera creeps in, and turns
// toward the bay and the sun; the tree stands against the sunset beside him.
const rise = {
  id: 'dusk-rise',
  ...span(C.rise, C.reveal),
  chapter: 1,
  mood: 0,
  hide: [PORTAL],
  view: { ...DUSK_VIEW, dof: true, bokeh: 3 },
  actors: [{ id: 't', spec: TAUREN, at: T, yaw: deg(25) }],
  tracks: {
    t: {
      path: [
        { t: 0, x: T[0], z: T[1], yaw: deg(25) },
        { t: 2.0, x: T[0], z: T[1], yaw: deg(25) },
        { t: 4.5, x: T[0], z: T[1], yaw: deg(55) },
      ],
      acts: [{ t: -6, clip: 'sit' }, { t: 1.4, clip: 'idle', fade: 1.7 }],
      faces: [{ t: -2, expr: 'neutral' }, { t: 2.4, expr: 'focused' }],
    },
  },
  cam: {
    keys: [
      { t: 0, p: polar(T, 236, 5.2, 0.5), l: polar(T, 44, 3, 0.7), fov: 30 },
      { t: 4.5, p: polar(T, 241, 3.7, 0.95), l: polar(T, 50, 3, 0.95), fov: 30 },
    ],
    ease: 'sine',
    focus: 't',
    range: 3,
  },
  fx: [IMPACT_PLUME, MOTES()],
};

// The camera comes round him from his front, past his right side, to over his right shoulder as it
// rises until the bay is below; then it swoops past that shoulder and out over the slope, the beach
// and the water toward the sun.
const BAY = 62;
const REVEAL_ARC = [
  [0, 28, 2.4, 0.75],
  [1.2, -30, 2.5, 1.0],
  [2.4, -80, 2.6, 1.5],
  [3.5, -112, 2.3, 2.1],
];
const REVEAL_END = polar(T, -112, 2.3, 2.1);
const REVEAL_END_LOOK = polar(T, 44, 14, -0.6);
const reveal = {
  id: 'dusk-reveal',
  ...span(C.reveal, C.dive),
  chapter: 1,
  mood: 0,
  hide: [PORTAL],
  view: { ...DUSK_VIEW, dof: true, bokeh: 2.5 },
  actors: [{ id: 't', spec: TAUREN, at: T, yaw: deg(55) }],
  tracks: { t: { path: [{ t: 0, x: T[0], z: T[1], yaw: deg(55) }, { t: 3.5, x: T[0], z: T[1], yaw: deg(50) }], faces: [{ t: -2, expr: 'focused' }] } },
  cam: {
    keys: REVEAL_ARC.map(([t, b, d, h], i) => ({
      t,
      p: polar(T, b, d, h),
      l: i < 2 ? polar(T, 0, 0, 0.85) : i === 2 ? polar(T, BAY, 4, 0.6) : REVEAL_END_LOOK,
      fov: 38 - i * 2,
    })),
    ease: 'linear',
    focus: 't',
    range: 4,
  },
  fx: [IMPACT_PLUME, MOTES()],
};

const at = (b, d) => flat(T, b, d);
const D3 = at(BAY, 22);
const D4 = at(BAY - 2, 40);
const dive = {
  id: 'dusk-dive',
  ...span(C.dive, C.smoke),
  chapter: 1,
  mood: 0,
  hide: [PORTAL],
  view: { ...DUSK_VIEW, bloom: { intensity: 1.5, threshold: 0.7, radius: 0.85 } },
  actors: [{ id: 't', spec: TAUREN, at: T, yaw: deg(50) }],
  tracks: { t: { path: [{ t: 0, x: T[0], z: T[1], yaw: deg(50) }], faces: [{ t: -2, expr: 'focused' }] } },
  cam: {
    keys: [
      { t: 0, p: REVEAL_END, l: REVEAL_END_LOOK, fov: 34 },
      { t: 0.8, p: polar(T, -25, 0.75, 1.2), l: polar(T, BAY, 12, 0), fov: 40 },
      { t: 1.6, p: polar(T, BAY, 9, 2.4), l: polar(T, BAY - 1, 35, -0.5), fov: 46 },
      { t: 2.3, p: { g: [D3[0], 2.0, D3[1]] }, l: polar(T, BAY - 3, 60, 0), fov: 50 },
      { t: 3.0, p: [D4[0], 1.6, D4[1]], l: [D4[0] + 40 * Math.sin(deg(50)), 1.4, D4[1] + 40 * Math.cos(deg(50))], fov: 52 },
    ],
    ease: 'linear',
  },
  fx: [
    IMPACT_PLUME,
    { t: 1.6, kind: 'dusk-haze', alpha: [[1.6, 0], [2.5, 0.35], [3.0, 0.75]], cover: [[1.6, 0.35], [3, 0.7]], color: '#7a3a1c', color2: '#e8935a', color3: '#ffcf8a', back: 0.55, flow: [-0.2, 0.05] },
    MOTES(500, [24, 8, 24]),
  ],
};

// --------------------------------------------------------------------------------- 2. dusk-fire
// The village burns at night: the south street from the square to The Molting Kettle (tavern at
// (-2, 40), plaza (-1, 29)), houses h-e (-15, 32), h-f (10.5, 27), h-s3 (18, 38).
const NIGHT_FIRE_VIEW = { exposure: 1.0, saturation: 0.15, contrast: 0.18, bloom: { intensity: 1.4, threshold: 0.7, radius: 0.85 }, vignette: { offset: 0.2, darkness: 0.75 } };
const FIRE_FOG = { color: '#120604', density: 0.02 };
const STREET_FLAMES = [
  [-5.2, 20, 0.9], [4.6, 21, 0.8], [-6.5, 25, 1.2], [5.6, 26, 1.1], [-4.4, 31.5, 1.3], [4.8, 31, 1.4],
  [-8.5, 30, 1.7], [9, 29.5, 1.6], [-12, 33, 2.0], [13, 33, 1.9], [-1.8, 36.2, 1.5], [2.2, 36.5, 1.4],
  [-6, 37, 1.8], [6.5, 37.5, 1.7], [-3.5, 14, 0.8], [3.5, 15, 0.9],
];
const ROOF_FLAMES = [
  [-2, 40, 2.6, 6.5], [-5.5, 39, 1.8, 3.2], [1.8, 39, 1.8, 3.2], [-15, 32, 2.2, 5.5], [10.5, 27, 2.0, 5.5], [18, 38, 2.3, 4.5],
];
const VILLAGE_FX = (t0 = -6) => [
  { t: t0, kind: 'dusk-fire', spots: STREET_FLAMES, height: 2.4, seed: 11, gain: 0.8 },
  { t: t0, kind: 'dusk-fire', spots: ROOF_FLAMES, height: 2.6, seed: 23, smoke: 0.8, gain: 0.85 },
  { t: t0, kind: 'dusk-plume', at: { g: [-2, 10, 40] }, rate: 3, life: 10, rise: 2.6, spread: 2.5, size0: 3, size1: 12, prewarm: 10, opacity: 0.8, wind: [1.2, -0.4], seed: 3 },
  { t: t0, kind: 'dusk-plume', at: { g: [-15, 8, 32] }, rate: 2.5, life: 9, rise: 2.4, spread: 2, size0: 3, size1: 10, prewarm: 9, opacity: 0.75, wind: [1.2, -0.4], seed: 4 },
  { t: t0, kind: 'dusk-plume', at: { g: [11, 8, 27] }, rate: 2.5, life: 9, rise: 2.4, spread: 2, size0: 3, size1: 10, prewarm: 9, opacity: 0.75, wind: [1.2, -0.4], seed: 5 },
  { t: t0, kind: 'embers', at: { g: [-1, 5, 26] }, box: [26, 14, 30], count: 1600, drift: [0.8, 2.6, -0.3], size: 0.07 },
  { t: t0, kind: 'light', at: { g: [-5, 2.5, 25] }, color: '#ff6a1a', intensity: 30, distance: 22, flicker: 0.35 },
  { t: t0, kind: 'light', at: { g: [5, 2.5, 27] }, color: '#ff7a22', intensity: 30, distance: 22, flicker: 0.35 },
  { t: t0, kind: 'light', at: { g: [-1, 4, 37] }, color: '#ff5a14', intensity: 45, distance: 30, flicker: 0.3 },
  { t: t0, kind: 'light', at: { g: [0, 2, 16] }, color: '#ff8a3a', intensity: 14, distance: 14, flicker: 0.4 },
  { t: t0, kind: 'dusk-grade', color: '#ffe0cc' },
];

const smoke = {
  id: 'dusk-smoke',
  ...span(C.smoke, C.orc),
  chapter: 1,
  mood: 1,
  anchor: [0, 26],
  view: NIGHT_FIRE_VIEW,
  fog: FIRE_FOG,
  actors: [],
  cam: {
    keys: [
      { t: 0, p: { g: [1.5, 0.5, 15] }, l: { g: [-1.5, 3.2, 38] }, fov: 44 },
      { t: 4.25, p: { g: [1.0, 0.45, 17.5] }, l: { g: [-1.5, 2.8, 38] }, fov: 42 },
    ],
    ease: 'linear',
  },
  fx: [
    ...VILLAGE_FX(),
    // First flames licking up close to the lens at the bottom of the frame.
    { t: 2.4, kind: 'dusk-fire', spots: [[-1.4, 18.6, 0.5], [2.2, 19.2, 0.45], [0.2, 19.6, 0.4], [3.6, 19.8, 0.5]], height: 2.2, seed: 41, smoke: 0, grow: [[2.4, 0], [3.4, 0.8], [4.25, 1.1]] },
    { t: -2, kind: 'dusk-haze', alpha: [[0, 1], [2.6, 1], [3.6, 0.75], [4.25, 0.55]], cover: [[0, 0.55], [2.6, 0.5], [4.25, 0.4]], back: 1, color: '#4a0d05', color2: '#b8300c', color3: '#ff7a24', flow: [-0.16, 0.04], scale: 1.5 },
    { t: -2, kind: 'embers', box: [16, 10, 16], count: 900, drift: [-1.6, 1.4, 0.2], size: 0.05, shift: [0, 0, 5] },
  ],
};

// The orc strides down the burning street toward the lens, stops and roars, claws spread; the fire
// rises in front of him until it fills the frame.
const O0 = [-1.6, 32];
const O1 = [-1.0, 23.2];
const orc = {
  id: 'dusk-orc',
  ...span(C.orc, C.tower),
  chapter: 1,
  mood: 1,
  anchor: [0, 26],
  view: { ...NIGHT_FIRE_VIEW, dof: true, bokeh: 2.5 },
  fog: FIRE_FOG,
  actors: [{ id: 'o', spec: ORC, at: O0, yaw: Math.PI }],
  tracks: {
    o: {
      // He slows into his last steps (the key at 4.0 keeps the spline from overshooting and walking
      // him back), then stands facing the lens.
      path: [{ t: 0, x: O0[0], z: O0[1] }, { t: 4.0, x: O1[0] - 0.042, z: O1[1] + 0.62 }, { t: 4.4, x: O1[0], z: O1[1], yaw: Math.PI }, { t: 8.25, x: O1[0], z: O1[1], yaw: Math.PI }],
      ease: 'linear',
      // The cast's gather, slowed: claws up and spread, a roar held until the fire takes him.
      acts: [{ t: 4.55, clip: 'cast', from: 1.23, to: 2.6, speed: 0.6, fade: 0.25 }],
      faces: [{ t: -2, expr: 'angry' }],
    },
  },
  cam: {
    keys: [
      { t: 0, p: { g: [0.4, 0.36, 28.9] }, l: { a: 'o', o: [0, 0.7, 0], y0: true }, fov: 36 },
      { t: 4.4, p: { g: [0.6, 0.34, 20.3] }, l: { a: 'o', o: [0, 0.75, 0], y0: true }, fov: 34 },
      { t: 8.25, p: { g: [-1.8, 0.4, 20.7] }, l: { a: 'o', o: [0, 0.85, 0], y0: true }, fov: 32 },
    ],
    ease: 'linear',
    focus: 'o',
    range: 3,
  },
  fx: [
    ...VILLAGE_FX(),
    { t: -2, kind: 'light', at: { a: 'o', o: [1.5, 1.2, 1.5] }, color: '#ff7a2a', intensity: 9, distance: 7, flicker: 0.4 },
    { t: -2, kind: 'light', at: { a: 'o', o: [-1.6, 1.0, -1.0] }, color: '#ff5a18', intensity: 12, distance: 7, flicker: 0.5 },
    // The roar.
    { t: 4.6, kind: 'shake', d: 1.2, amp: 0.05 },
    // The wall of fire between the lens and him.
    { t: 6.9, kind: 'dusk-fire', spots: [[-2.2, 21.9, 1], [-0.9, 22.1, 1.1], [0.3, 22.0, 0.9], [-1.5, 21.7, 0.8], [-0.2, 21.6, 0.85], [-3.3, 22.2, 1], [1.4, 22.3, 1]], height: 3.0, gain: 1.1, glow: 0.6, seed: 77, smoke: 0, grow: [[6.9, 0], [7.5, 0.7], [8.0, 1.5], [8.25, 1.8]] },
    { t: 7.0, kind: 'dusk-haze', additive: true, alpha: [[7.0, 0], [7.7, 0.25], [8.25, 0.55]], cover: [[7, 0.35], [8.25, 0.65]], back: 0.3, color: '#3a0802', color2: '#ff5a10', color3: '#ffb040', flow: [0, 0.6], scale: 1.4 },
    // 135.5 to 136.5: the fire fills the frame and burns to white.
    { t: 7.2, kind: 'fade', color: '#fff0d8', curve: [[7.3, 0], [7.8, 0.3], [8.1, 0.75], [8.25, 0.88]] },
  ],
};

// The lighthouse on its sea stack at (190, -132): gallery floor at 28.5 out to about 4.5 from the
// axis, the bridge from the headland on its west side, open sea to the east. A misty tilt up the
// tower from the water; a fireball strikes it under the gallery on the side facing the lens.
const LH = [190, -132];
/** Quest props around the lighthouse that glow on their own. */
const LH_HIDE = ['Lighthouse keeper’s secret dance', 'Two-seat shore skiff'];
/** A world point at a bearing and distance from the lighthouse axis, y high. */
const LHP = (b, r, y) => { const [x, z] = flat(LH, b, r); return [x, y, z]; };
/** Where the fireball strikes: under the gallery, on the side facing the lens. */
const LH_HIT = LHP(100, 2.7, 23.5);
const TOWER_FOG = { color: '#1c0a08', density: 0.01 };
const TOWER_VIEW = { exposure: 1.3, saturation: 0.12, contrast: 0.15, bloom: { intensity: 1.4, threshold: 0.72, radius: 0.85 }, vignette: { offset: 0.2, darkness: 0.7 } };
const TOWER_SKY = (t0) => [
  { t: t0, kind: 'dusk-hide', names: LH_HIDE },
  { t: t0, kind: 'dusk-haze', alpha: [[t0, 0.38]], cover: [[t0, 0.42]], back: 0.0, color: '#2a0e08', color2: '#7a2a10', color3: '#c8541a', flow: [-0.05, 0.02], scale: 1.2 },
  { t: t0, kind: 'dusk-plume', at: { g: [176, 0, -112] }, rate: 1.5, life: 14, rise: 2.2, spread: 6, size0: 6, size1: 18, prewarm: 14, opacity: 0.5, wind: [2, 1.5], color: '#2a1a16', glow: '#8a2a0a', glowH: 6, seed: 8 },
  { t: t0, kind: 'embers', at: { g: [192, 16, -128] }, box: [30, 30, 30], count: 1200, drift: [1.2, 2.2, -0.4], size: 0.09 },
  { t: t0, kind: 'light', at: [200, 10, -118], color: '#ff6a2a', intensity: 25, distance: 40, flicker: 0.2 },
  { t: t0, kind: 'dusk-grade', color: '#ffc8a8' },
];
const TOWER_FIRE = (t0) => [
  { t: t0, kind: 'dusk-fire', spots: [[100, 2.8, 23, 1.2], [85, 2.8, 24.4, 0.9], [115, 2.8, 22.4, 0.8], [95, 3.9, 28.6, 1.4], [130, 3.9, 28.6, 1.1], [60, 3.9, 28.6, 1.0]].map(([b, r, y, k]) => ({ at: LHP(b, r, y), s: k })), height: 2.6, seed: 31, smoke: 0.85, wind: [1.4, 0.8], fadeIn: 0.4 },
  { t: t0, kind: 'light', at: LHP(105, 6, 25), color: '#ff6a1a', intensity: 80, distance: 32, flicker: 0.35, fadeIn: 0.3 },
];
const tower = {
  id: 'dusk-tower',
  ...span(C.tower, C.giant),
  chapter: 1,
  mood: 1,
  anchor: [192, -126],
  hide: LH_HIDE,
  view: TOWER_VIEW,
  fog: TOWER_FOG,
  actors: [],
  cam: {
    keys: [
      { t: 0, p: LHP(122, 37, 2.6), l: [189, 10.5, -131], fov: 50 },
      { t: 4.5, p: LHP(118, 35, 4.6), l: [189.5, 19, -131.5], fov: 45 },
    ],
    ease: 'sine',
  },
  fx: [
    ...TOWER_SKY(-6),
    // Out of the white burn into a warm mist that clears off the tower.
    { t: 0, kind: 'fade', color: '#e8a890', curve: [[0, 0.5], [0.45, 0.2], [1.3, 0]] },
    // 137.0: the fireball comes in from the left of the frame and strikes the tower.
    { t: 0.06, kind: 'dusk-fireball', from: [LH_HIT[0] + 9, LH_HIT[1] + 13, LH_HIT[2] + 30], to: LH_HIT, d: 0.44, size: 1.6, trail: 80, light: 1400, distance: 22, accel: 1.2 },
    { t: 0.5, kind: 'dusk-blast', at: LH_HIT, r: 3.2, column: 3.5, light: 700, distance: 14, flashA: 0.6, flashD: 0.2, flashColor: '#ffd8a0', shake: 0.08, puffs: 40, debris: 40, gravity: 9.8 },
    ...TOWER_FIRE(0.52),
  ],
};

// The giant has waded out of the sea on the east side of the stack and climbs the tower, smashing
// it; the camera looks up from the water to the south, the tower on the left and the giant on its
// right in profile, lit by its own sickly yellow-green glow and the fire. The stack top is 3 to 4
// high out to 6 from the axis; the sea floor falls away beyond 8.
const G = flat(LH, 22, 6.4);
const GIANT_YAW = deg(22 + 180);
const GIANT_ACTOR = { id: 'g', ...GIANT, at: G, yaw: GIANT_YAW };
/** The giant's glow: a fel light on its chest and a hot one at its claws. */
const GIANT_GLOW = (t0) => [
  { t: t0, kind: 'light', at: { a: 'g', o: [0, 4, 3.5] }, color: '#b8e04a', intensity: 160, distance: 22, flicker: 0.25 },
  { t: t0, kind: 'light', at: { a: 'g', o: [-3, 2, 5] }, color: '#ff8a2a', intensity: 120, distance: 18, flicker: 0.4 },
  { t: t0, kind: 'dusk-fire', spots: [{ at: { a: 'g', o: [2.2, 5.5, 1] }, s: 1.0 }, { at: { a: 'g', o: [-2.4, 4.5, 0.5] }, s: 0.9 }, { at: { a: 'g', o: [0, 7.5, -1] }, s: 1.2 }], height: 2.4, seed: 61, smoke: 0.5, glow: 0.7, wind: [1.4, 0.8] },
];
const giant = {
  id: 'dusk-giant',
  ...span(C.giant, C.leap),
  chapter: 1,
  mood: 1,
  anchor: [194, -128],
  hide: LH_HIDE,
  view: TOWER_VIEW,
  fog: TOWER_FOG,
  actors: [GIANT_ACTOR],
  tracks: { g: { path: [{ t: 0, x: G[0], z: G[1], yaw: GIANT_YAW, lift: 7 }, { t: 1, x: G[0] - 0.3, z: G[1] - 0.1, yaw: GIANT_YAW, lift: 7.6 }], acts: [{ t: -0.35, clip: 'attack_slam', speed: 0.8 }] } },
  cam: {
    keys: [
      { t: 0, p: LHP(105, 40, 5), l: LHP(50, 3, 17), fov: 46 },
      { t: 1, p: LHP(104, 38.5, 5.6), l: LHP(50, 3, 17.6), fov: 45 },
    ],
    ease: 'linear',
    shake: 0.03,
  },
  fx: [
    ...TOWER_SKY(-6),
    ...TOWER_FIRE(-6),
    ...GIANT_GLOW(-6),
    { t: 0.18, kind: 'dusk-blast', at: LHP(35, 2.8, 16), r: 3.4, column: 0, light: 2400, distance: 16, flashA: 0.45, flashD: 0.16, flashColor: '#f4ffb0', shake: 0.14, puffs: 34, debris: 46 },
    { t: 0.55, kind: 'dusk-blast', at: LHP(45, 2.8, 20), r: 2.4, column: 0, light: 1200, distance: 12, flashA: 0.22, flashD: 0.12, shake: 0.06, puffs: 24, debris: 26, seed: 9 },
  ],
};

// A warrior on the gallery leaps round its ring (3.7 from the axis, floor 28.5) through the flames,
// over the lens, the giant behind the tower.
const RING = (b) => flat(LH, b, 3.7);
const W0 = RING(205);
const LEAP = [[0, 205, 0], [0.5, 200, 0], [0.8, 178, 1.0], [1.08, 152, 1.8], [1.36, 130, 1.0], [1.58, 118, 0.15], [1.96, 100, 1.3]];
const leap = {
  id: 'dusk-leap',
  ...span(C.leap, C.black),
  chapter: 1,
  mood: 1,
  anchor: [194, -128],
  hide: LH_HIDE,
  view: { ...TOWER_VIEW, dof: true, bokeh: 2 },
  fog: TOWER_FOG,
  actors: [{ id: 'w', spec: ORC, at: W0, yaw: deg(115) }, GIANT_ACTOR],
  tracks: {
    w: {
      path: LEAP.map(([t, b, lift], i) => ({ t, x: RING(b)[0], z: RING(b)[1], lift, ...(i < 2 ? { yaw: deg(b - 90) } : {}) })),
      acts: [{ t: 0.3, clip: 'jump', from: 0.6, speed: 0.55 }, { t: 1.5, clip: 'jump', from: 0.6, speed: 0.8 }],
      faces: [{ t: -2, expr: 'angry' }],
    },
    g: { path: [{ t: 0, x: G[0] - 0.3, z: G[1] - 0.1, yaw: GIANT_YAW, lift: 7.6 }, { t: 1.96, x: G[0] - 0.5, z: G[1] - 0.2, yaw: GIANT_YAW, lift: 8.2 }], acts: [{ t: -0.4, clip: 'attack_slam', from: 1.0, speed: 0.7 }] },
  },
  cam: {
    keys: [
      // Fixed look points that run ahead of him round the ring (a camera tied to the actor goes
      // black on the frame his jump starts).
      ...[[0, 200, 29.3], [0.8, 176, 29.9], [1.08, 152, 30.4], [1.36, 130, 30.0], [1.96, 104, 30.1]].map(([t, b, y]) => ({
        t,
        p: LHP(160 - (20 * t) / 1.96, 8.2 - (0.6 * t) / 1.96, 28.5 - (0.3 * t) / 1.96),
        l: LHP(b, 3.7, y),
        fov: 40 + (4 * t) / 1.96,
      })),
    ],
    ease: 'linear',
    focus: 'w',
    range: 5,
  },
  fx: [
    ...TOWER_SKY(-6),
    ...TOWER_FIRE(-6),
    ...GIANT_GLOW(-6),
    // Flames on the far side of the ring, behind him, and low on the near rail he leaps over.
    { t: -6, kind: 'dusk-fire', spots: [[240, 1.3], [275, 1.4], [330, 1.2], [20, 1.0], [70, 1.2]].map(([b, k]) => ({ at: LHP(b, 3.7, 28.6), s: k })), height: 2.6, seed: 51, smoke: 0.6, glow: 0.6 },
    { t: -6, kind: 'dusk-fire', spots: [{ at: LHP(170, 4.4, 28.4), s: 0.45 }, { at: LHP(135, 4.4, 28.4), s: 0.4 }], height: 2.0, seed: 52, smoke: 0, glow: 0.4 },
    { t: -6, kind: 'light', at: { a: 'w', o: [-1.2, 1.2, -1.5] }, color: '#ff7a2a', intensity: 10, distance: 6, flicker: 0.4 },
    { t: 0.9, kind: 'dusk-blast', at: LHP(300, 3.6, 29.2), r: 1.6, column: 0, light: 800, distance: 10, flashA: 0.15, flashD: 0.1, puffs: 26, debris: 18, seed: 13 },
  ],
};

// -------------------------------------------------------------------------------- 3. dusk-clash
// On the grass above the beach, the sun low behind them (bearing 42): she comes in from his right
// and leaps at him, he swings; the camera sits low facing the sun so they cross the frame.
const CO = [99.5, 6.5];
const EB = 132;
const CE0 = flat(CO, EB, 4.4);
const CE1 = flat(CO, EB, 1.15);
const CE2 = flat(CO, EB - 12, 0.9);
const CLASH_VIEW = { exposure: 0.92, saturation: 0.28, contrast: 0.14, bloom: { intensity: 1.25, threshold: 0.78, radius: 0.8 }, vignette: { offset: 0.22, darkness: 0.7 }, dof: true, bokeh: 2.2 };
const CLASH_MOTES = { t: -5, kind: 'motes', color: '#ffd28a', color2: '#ffb36b', count: 300, box: [14, 6, 14], drift: [0.25, 0.12, 0.1], size: 0.04, opacity: 0.8 };
const HIT = { a: 'o', o: [0, 0.75, 0.8] };
const clashA = {
  id: 'dusk-clash-a',
  ...span(C.clashA, C.clashB),
  chapter: 1,
  mood: 0,
  hide: [PORTAL],
  view: CLASH_VIEW,
  actors: [{ id: 'o', spec: ORC, at: CO, yaw: deg(EB) }, { id: 'e', spec: ELF, at: CE0, yaw: deg(EB + 180) }],
  tracks: {
    o: { path: [{ t: 0, x: CO[0], z: CO[1], yaw: deg(EB) }], acts: [{ t: 0.5, clip: 'attack_swipe' }], faces: [{ t: -2, expr: 'angry' }] },
    e: {
      path: [
        { t: 0, x: CE0[0], z: CE0[1], yaw: deg(EB + 180) },
        { t: 0.38, x: flat(CO, EB, 3.6)[0], z: flat(CO, EB, 3.6)[1], yaw: deg(EB + 180) },
        { t: 0.66, x: flat(CO, EB, 2.3)[0], z: flat(CO, EB, 2.3)[1], yaw: deg(EB + 180), lift: 1.6 },
        { t: 0.92, x: CE1[0], z: CE1[1], yaw: deg(EB + 180), lift: 0.55 },
        { t: 1.54, x: CE2[0], z: CE2[1], yaw: deg(EB + 180), lift: 0 },
      ],
      acts: [{ t: 0.2, clip: 'jump', from: 0.7, speed: 0.9 }, { t: 0.86, clip: 'attack_swipe' }],
      faces: [{ t: -2, expr: 'focused' }],
    },
  },
  cam: {
    keys: [
      { t: 0, p: polar(CO, 228, 3.6, 0.28), l: polar(CO, 60, 1.2, 0.85), fov: 42 },
      { t: 1.54, p: polar(CO, 214, 3.0, 0.24), l: polar(CO, 70, 1.0, 0.95), fov: 40 },
    ],
    ease: 'linear',
    focus: 'o',
    range: 4,
  },
  fx: [
    { t: 0.9, kind: 'vfx', recipe: 'sparks', args: [{ pt: HIT }, { color: '#ffd27a', k: 6 }, 70, 10, { life: 0.5 }] },
    { t: 0.9, kind: 'flash', d: 0.12, a: 0.35, color: '#fff2d8' },
    { t: 0.9, kind: 'light', at: HIT, color: '#ffd8a0', curve: [[0.88, 0], [0.92, 60], [1.15, 0]], distance: 6 },
    { t: 0.9, kind: 'shake', d: 0.3, amp: 0.04 },
    CLASH_MOTES,
  ],
};

const clashB = {
  id: 'dusk-clash-b',
  ...span(C.clashB, C.white),
  chapter: 1,
  mood: 0,
  hide: [PORTAL],
  view: CLASH_VIEW,
  actors: [{ id: 'o', spec: ORC, at: CO, yaw: deg(EB) }, { id: 'e', spec: ELF, at: CE2, yaw: deg(EB + 168) }],
  tracks: {
    o: { path: [{ t: 0, x: CO[0], z: CO[1], yaw: deg(EB) }, { t: 1.96, x: flat(CO, EB + 180, 0.6)[0], z: flat(CO, EB + 180, 0.6)[1], yaw: deg(EB + 10) }], acts: [{ t: 0.05, clip: 'hit_react' }, { t: 0.7, clip: 'attack_swipe' }], faces: [{ t: -2, expr: 'angry' }] },
    e: { path: [{ t: 0, x: CE2[0], z: CE2[1], yaw: deg(EB + 168) }], acts: [{ t: -0.1, clip: 'claw_left' }, { t: 0.85, clip: 'claw_right' }], faces: [{ t: -2, expr: 'focused' }] },
  },
  cam: {
    keys: [
      { t: 0, p: polar(CO, EB + 95, 2.4, 0.2), l: polar(CO, EB, 0.5, 0.7), fov: 38 },
      { t: 1.96, p: polar(CO, EB + 105, 2.1, 0.26), l: polar(CO, EB, 0.45, 0.78), fov: 36 },
    ],
    ease: 'linear',
    focus: 'e',
    range: 3,
  },
  fx: [
    { t: 0.1, kind: 'vfx', recipe: 'sparks', args: [{ pt: HIT }, { color: '#ffd27a', k: 5 }, 50, 8, { life: 0.45 }] },
    { t: 0.95, kind: 'vfx', recipe: 'sparks', args: [{ pt: { a: 'o', o: [0, 0.7, 0.7] } }, { color: '#ffb0e0', k: 6 }, 70, 10, { life: 0.45 }] },
    { t: 0.95, kind: 'flash', d: 0.1, a: 0.25, color: '#ffe8f4' },
    CLASH_MOTES,
    { t: 1.2, kind: 'leaves', color: '#ffc4e8', color2: '#ffffff', count: 500, box: [10, 6, 10], drift: [1.2, 0.6, 0.5], size: 0.07, fadeIn: 0.3 },
    // 157.29 to 157.71: a pink-white flash fills the frame.
    { t: 0, kind: 'fade', color: '#ffe8f2', curve: [[1.54, 0], [1.68, 0.4], [1.84, 0.85], [1.93, 1], [1.96, 1]] },
  ],
};

export const shots = [meteor, rise, reveal, dive, smoke, orc, tower, giant, leap, clashA, clashB];
