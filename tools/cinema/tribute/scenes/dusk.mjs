// Scene 'dusk' of the tribute (see ../timeline.mjs for the song ranges it fills): in Clawhaven a
// fireball falls on the southern ridge at sunset and the tauren rises on the hill over the bay; in
// Tidecrown (chapter 7) the capital burns and the orc roars in its lane, a fireball strikes the
// Cathedral of the Tide and the giant climbs its tower while a warrior leaps from the ledge; later,
// in Clawhaven, the orc and the night elf clash at sunset.
// The tauren lets dust go from his open claw; the wind carries it out over the bay, it heats into
// embers and the embers become the burning city.
// Effects named dusk-* live in src/capture/cinema/fx/ (dusk-fire, dusk-pose, dusk-arm, dusk-dust,
// dusk-tide).
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
// The sun sets over the bay at bearing 42 degrees, 13 degrees up. Across the bay red sandstone mesas
// stand on the horizon (dusk-mesa: the world has none); the fireball comes down at the foot of the
// mesas (SITE) and that is where the fire rises later. The tauren sits on the lip of the town's plateau
// above the beach, by the tall tree at (95.5, 2.3).
const T = [92.1, -2.8];
/** The mesas across the bay, [bearing from T, distance, footprint radius, cap height, stretch, yaw]. */
const MESA_RING = [
  [6, 600, 45, 90, 1.3, 30], [20, 480, 28, 70, 1.0, 0], [31, 700, 60, 115, 1.4, 70], [44, 560, 22, 64, 1.0, 20],
  [53, 760, 70, 125, 1.5, 40], [63, 480, 24, 60, 1.1, 0], [75, 610, 40, 92, 1.3, 100], [86, 520, 20, 74, 1.0, 10],
  [97, 720, 64, 108, 1.5, 60], [110, 500, 30, 62, 1.2, 120], [124, 640, 46, 96, 1.4, 30], [138, 560, 34, 70, 1.2, 50],
];
const MESAS = {
  t: -6,
  kind: 'dusk-mesa',
  mesas: MESA_RING.map(([b, d, r, h, st, yw], i) => [...flat(T, b, d), r, h, i + 3, st, yw]),
  base: -10,
  haze: '#ea8c6a',
  hazeK: 0.0013,
  hazeMax: 0.56,
  lift: 0.2,
};
/** Where the fireball comes down: the shore at the foot of the near butte. */
const SITE = flat(T, 70, 330);
const SITE_AT = [SITE[0], 1, SITE[1]];
/** Song second the fireball strikes, and the one the fire takes and climbs (the original's 120.2). */
const STRIKE_AT = 112.42;
const FIRE_AT = 120.2;
/** The smoke of the strike, from STRIKE_AT, in a shot starting at song second `at`. */
const STRIKE_SMOKE = (at) => ({ t: STRIKE_AT - at, kind: 'dusk-plume', at: [SITE[0], 2, SITE[1]], rate: 3, life: 16, rise: 6, spread: 2.5, size0: 4, size1: 22, wind: [3, 1], opacity: 0.45, color: '#3a2a26', glow: '#d0581a', glowH: 16, seed: 31 });
/** 120.2: the fire takes along the shore under the butte and black smoke climbs in columns. */
const FIRE_UP = (at) => {
  const o = FIRE_AT - at;
  const spot = (b, d, s) => ({ at: [...flat(T, b, d)].flatMap((v, i) => (i === 0 ? [v, 0.5] : [v])), s });
  return [
    { t: o - 0.1, kind: 'dusk-fire', spots: [spot(70, 330, 18), spot(68.4, 338, 14), spot(71.6, 324, 14), spot(66.8, 348, 10), spot(73.2, 318, 10), spot(69.2, 318, 8), spot(65.4, 358, 7)], height: 3.2, gain: 1.6, glow: 0.9, seed: 81, smoke: 0, grow: [[o - 0.05, 0], [o + 0.25, 0.55], [o + 0.7, 0.9], [o + 1.2, 1.1], [o + 4, 1.2]] },
    ...[[70, 330, 0], [67.8, 344, 1], [72.4, 320, 2]].map(([b, d, k]) => ({ t: o + 0.05 * k, kind: 'dusk-plume', at: [...flat(T, b, d)].flatMap((v, i) => (i === 0 ? [v, 10] : [v])), rate: 9, life: 9, rise: 34, spread: 3.5, size0: 8, size1: 42, wind: [7, 2], opacity: 0.9, color: '#201412', glow: '#ff5a18', glowH: 30, glowK: 1.6, seed: 40 + k })),
  ];
};
const DUSK_VIEW = { exposure: 1.05, saturation: 0.18, contrast: 0.08, bloom: { intensity: 1.3, threshold: 0.75, radius: 0.8 }, vignette: { offset: 0.25, darkness: 0.6 } };
const MOTES = (n = 260, box = [14, 6, 14]) => ({ t: -5, kind: 'motes', color: '#ffd28a', color2: '#ffb36b', count: n, box, drift: [0.25, 0.12, 0.1], size: 0.035, opacity: 0.7 });
/** The plateau's grass for close shots: dry, gold at the tips, over a dusty floor (not the flat green). */
const TUFTS = ['grass-0', 'grass-1', 'grass-2'];
/** The meadow's small props: low and dark against the sun, they read as blocks this close. */
const PROPS = [...[1, 2, 3].flatMap((i) => [`Rock_Medium_${i}`, `Pebble_Round_${i}`, `DeadTree_${i}`]), ...[1, 2, 3, 4, 5].map((i) => `Petal_${i}`), 'Mushroom_Common', 'Clover_1', 'Bush_Common', 'Bush_Common_Flowers', 'Fern_1', 'Flower_3_Group', 'Flower_4_Group'];
const DRY_FLOOR = ([x, z], half, seed) => ({ t: -6, kind: 'night-floor', box: [x - half, z - half, x + half, z + half], soil: '#4a3022', moss: '#5e5626', litter: '#6e4426', litter2: '#8a6a3a', grass: '#4e4e1e', tip: '#e2b464', count: 34, height: [0.16, 0.62], width: 0.026, wind: 0.09, drift: 0.4, seed });
/** The sun's direction from T: its glare over the lens is drawn at this far point. */
const SUN = [...flat(T, 42, 900)].flatMap((v, i) => (i === 0 ? [v, 210] : [v]));

// 111.0: white from the blast; the sun's glare burns through it over the plateau's grass and recedes
// (112.3) off the red mesas across the bay while the fireball comes down among them (112.42). The
// camera cranes up out of the grass and pans along the horizon.
const meteor = {
  id: 'dusk-meteor',
  ...span(C.meteor, C.rise),
  chapter: 1,
  mood: 0,
  hide: [PORTAL],
  anchor: T,
  view: { ...DUSK_VIEW, saturation: 0.25, bloom: { intensity: 1.6, threshold: 0.7, radius: 0.85 } },
  actors: [{ id: 't', spec: TAUREN, at: T, yaw: deg(8) }],
  tracks: { t: { path: [{ t: 0, x: T[0], z: T[1], yaw: deg(8) }], acts: [{ t: -6, clip: 'sit' }], faces: [{ t: -2, expr: 'sleepy' }] } },
  cam: {
    keys: [
      { t: 0, p: polar(T, 170, 4.8, 0.18), l: polar(T, 52, 60, 14), fov: 40 },
      { t: 1.0, p: polar(T, 178, 4.2, 0.32), l: polar(T, 62, 60, 9), fov: 37 },
      { t: 2.0, p: polar(T, 188, 3.5, 0.44), l: polar(T, 74, 40, 4.2), fov: 35 },
    ],
    ease: 'linear',
    shake: 0.012,
  },
  fx: [
    MESAS,
    DRY_FLOOR(T, 9, 61),
    { t: -6, kind: 'dusk-hide', names: [...TUFTS, ...PROPS] },
    // The white holds to 111.5, the glare burns through it and recedes by 112.6.
    { t: 0, kind: 'fade', color: '#ffffff', curve: [[0, 1], [0.45, 1], [0.7, 0.85], [0.95, 0.55], [1.15, 0.22], [1.35, 0.05], [1.5, 0]] },
    { t: 0, kind: 'dusk-glare', at: SUN, alpha: [[0, 1.4], [0.6, 1.4], [1.1, 1.0], [1.4, 0.55], [2, 0.42]], radius: [[0, 1.6], [0.6, 1.2], [1.2, 0.45], [1.5, 0.3], [2, 0.26]], color: '#fff6e8', color2: '#ffb468' },
    { t: 0.55, kind: 'dusk-fireball', from: [...flat(T, 76, 470)].flatMap((v, i) => (i === 0 ? [v, 190] : [v])), to: SITE_AT, d: STRIKE_AT - C.meteor - 0.55, size: 9, trail: 140, light: 0, distance: 1, accel: 1.3 },
    { t: STRIKE_AT - C.meteor, kind: 'dusk-blast', at: SITE_AT, r: 8, column: 0, light: 0, distance: 1, flashA: 0.12, flashD: 0.18, flashColor: '#ffe2b0', shake: 0.04, puffs: 48, debris: 0, ring: 0 },
    STRIKE_SMOKE(C.meteor),
    { t: -5, kind: 'embers', at: polar(T, 210, 1, 1.2), box: [10, 4, 10], count: 500, drift: [0.6, 0.5, 0.3], size: 0.04 },
    MOTES(),
  ],
};

// 113.0: his horns and claw sweep in at the right as he turns in his crouch; he heaves up (113.5 to
// 114.9, a thump on 114.88), his back to us and filling the right of the frame, and settles hunched,
// looking out over the bay. The camera pans onto him and arcs round to his right for his profile.
/** A world point at a bearing and distance from T, y up (over the sea, where the ground is the bed). */
const AT = (b, d, y) => [...flat(T, b, d)].flatMap((v, i) => (i === 0 ? [v, y] : [v]));
/** The lone tree on the lip stands right in front of the far fire from his flank: gone for the close shots. */
const LONE_TREE = ['CommonTree_1', 'CommonTree_2', 'CommonTree_3', 'CommonTree_4', 'CommonTree_5'];
const TY = 66;
const EMPTY_CLAW = { t: -6, kind: 'dusk-arm', actor: 't', joints: {}, w: [[0, 0]], hide: ['clawR'] };
/** Each crab off the sunset: a warm rim from the sun's side, a cool fill from the lens's. */
const TAUREN_LIGHTS = [
  { t: -6, kind: 'light', at: { a: 't', o: [0.4, 1.7, 2.2] }, color: '#ffb070', intensity: 26, distance: 6 },
  { t: -6, kind: 'light', at: { a: 't', o: [-0.6, 1.4, -2.4] }, color: '#9a86c8', intensity: 7, distance: 6 },
];
const rise = {
  id: 'dusk-rise',
  ...span(C.rise, C.reveal),
  chapter: 1,
  mood: 0,
  hide: [PORTAL],
  anchor: T,
  view: { ...DUSK_VIEW, dof: true, bokeh: 3 },
  actors: [{ id: 't', spec: TAUREN, at: T, yaw: deg(8) }],
  tracks: {
    t: {
      path: [
        { t: 0, x: T[0], z: T[1], yaw: deg(8) },
        { t: 0.3, x: T[0], z: T[1], yaw: deg(40) },
        { t: 2.4, x: T[0], z: T[1], yaw: deg(44) },
        { t: 4.5, x: T[0], z: T[1], yaw: deg(55) },
      ],
      // In his crouch, then up in one heave.
      acts: [{ t: -6, clip: 'sit' }, { t: 0.4, clip: 'idle', fade: 1.4 }],
      faces: [{ t: -2, expr: 'sleepy' }, { t: 0.4, expr: 'neutral' }, { t: 1.9, expr: 'focused' }],
    },
  },
  cam: {
    keys: [
      { t: 0, p: polar(T, 188, 3.5, 0.44), l: polar(T, 74, 40, 4.2), fov: 35 },
      { t: 0.9, p: polar(T, 198, 3.25, 0.5), l: polar(T, 38, 14, 2.2), fov: 34 },
      { t: 2.0, p: polar(T, 214, 3.3, 0.62), l: polar(T, 30, 4, 1.25), fov: 33 },
      // Round to his right shoulder: the bay and the mesas open up beyond him.
      { t: 3.2, p: polar(T, 245, 3.1, 0.95), l: AT(60, 40, 5.5), fov: 34 },
      { t: 4.5, p: polar(T, TY - 158, 2.75, 1.1), l: AT(TY + 18, 40, 4.5), fov: 34 },
    ],
    ease: 'linear',
    focus: 't',
    range: 3,
    shake: 0.008,
  },
  fx: [
    MESAS,
    DRY_FLOOR(T, 9, 61),
    { t: -6, kind: 'dusk-hide', names: [...TUFTS, ...PROPS, ...LONE_TREE] },
    STRIKE_SMOKE(C.rise),
    MOTES(),
    EMPTY_CLAW,
    ...TAUREN_LIGHTS,
    { t: -6, kind: 'dusk-pose', actor: 't', pitch: [[2.2, 0], [2.9, -7], [4.5, -9]] },
    { t: 0, kind: 'dusk-glare', at: SUN, alpha: [[0, 0.42], [4.5, 0.3]], radius: [[0, 0.26], [4.5, 0.24]], color: '#fff6e8', color2: '#ffb468' },
    // The thump as he comes up (114.88).
    { t: 1.88, kind: 'shake', d: 0.35, amp: 0.05 },
  ],
};

// 119.5: his right claw comes up and out over the bay and opens; dust streams from it and the wind
// takes it toward the sun. The camera behind his right shoulder, looking past him into the sunset.
/** The wind's bearing: out over the bay, clear of the trees on the slope. */
const DUST_WIND = 96;
const ARM_OUT = { RF_J0_joint: -0.6, RF_J1_joint: -1.35, RF_J2_joint: -0.8 };
/** Song second the claw opens and lets the dust go. */
const DUST_AT = 119.5;
/** The one stream of dust, in a shot starting at song second `at`: the same grains in every shot. */
const DUST = (at) => {
  const o = DUST_AT - at;
  return [
    { t: -6, kind: 'dusk-arm', actor: 't', joints: ARM_OUT, w: [[o - 1.0, 0], [o - 0.1, 1]], hide: ['clawR'] },
    { t: -6, kind: 'dusk-arm', actor: 't', joints: { RF_J4_joint: 1.2 }, w: [[o - 0.15, 0], [o + 0.2, 1]] },
    {
      t: o,
      kind: 'dusk-dust',
      socket: { actor: 't', name: 'clawR' },
      until: o + 6,
      rate: 1100,
      life: 4.8,
      wind: [Math.sin(deg(DUST_WIND)), 0.06, Math.cos(deg(DUST_WIND))],
      v0: 1.6,
      acc: 3.0,
      vel: [0, -0.35, 0],
      damp: 0.45,
      rise: 0.2,
      spread0: 0.03,
      spread1: 0.7,
      turb: 0.45,
      size0: 0.026,
      size1: 0.1,
      color: '#f0b878',
      color2: '#ffd9a0',
      hot: '#ff9a3c',
      hot2: '#ff4410',
      glow: 2.2,
      opacity: 0.6,
      // Dust in the sunset light, warm orange streaks over the bay, red sparks as it dives.
      heat: [[o, 0], [o + 1.8, 0.05], [o + 2.6, 0.3], [o + 3.5, 0.65], [o + 4.2, 1]],
      heatAge: 0.15,
      streak: [[o + 1.6, 0], [o + 2.6, 0.1], [o + 4.2, 0.18]],
      order: 1001,
    },
  ];
};
const REVEAL_END = polar(T, TY - 128, 2.35, 1.32);
const REVEAL_END_LOOK = AT(TY + 5, 40, 3.5);
// 117.5: close on his profile; he lifts his snout to the wind (117.6 to 118.5), draws in and leans out
// over the bay (118.5 to 120.2), and the fire takes on the far shore at the right (120.2), his face
// going hard. The camera pushes in along his flank.
const reveal = {
  id: 'dusk-reveal',
  ...span(C.reveal, C.dive),
  chapter: 1,
  mood: 0,
  hide: [PORTAL],
  anchor: T,
  view: { ...DUSK_VIEW, dof: true, bokeh: 2.5 },
  actors: [{ id: 't', spec: TAUREN, at: T, yaw: deg(55) }],
  tracks: {
    t: {
      path: [{ t: 0, x: T[0], z: T[1], yaw: deg(55) }, { t: 1.2, x: T[0], z: T[1], yaw: deg(TY) }],
      faces: [{ t: -2, expr: 'focused' }, { t: 0.1, expr: 'surprised' }, { t: 1.0, expr: 'focused' }, { t: 2.9, expr: 'angry' }],
    },
  },
  cam: {
    keys: [
      { t: 0, p: polar(T, TY - 158, 2.75, 1.1), l: AT(TY + 18, 40, 4.5), fov: 34 },
      { t: 1.2, p: polar(T, TY - 150, 2.55, 1.15), l: AT(TY + 14, 40, 4.5), fov: 34 },
      { t: 2.4, p: polar(T, TY - 138, 2.45, 1.25), l: AT(TY + 9, 40, 4), fov: 34 },
      { t: 3.5, p: REVEAL_END, l: REVEAL_END_LOOK, fov: 34 },
    ],
    ease: 'linear',
    focus: 't',
    range: 4,
    shake: 0.008,
  },
  fx: [
    MESAS,
    DRY_FLOOR(T, 9, 61),
    { t: -6, kind: 'dusk-hide', names: [...TUFTS, ...PROPS, ...LONE_TREE] },
    STRIKE_SMOKE(C.reveal),
    ...FIRE_UP(C.reveal),
    MOTES(),
    ...TAUREN_LIGHTS,
    // The snout up to the wind, back down, then leaning out over the edge.
    { t: -6, kind: 'dusk-pose', actor: 't', pitch: [[0, -9], [0.12, -6], [0.45, 18], [0.85, 16], [1.2, 0], [1.7, -8], [2.7, -11], [3.5, -12]] },
    ...DUST(C.reveal),
  ],
};

// 121.5: he hunches forward over the edge (down by 122.3); the camera slides past his shoulder (122.3)
// and down the slope toward the beach with the dust, the dust burning into orange streaks, and at
// 123.5 into a red haze of sparks.
const S = (d, h) => polar(T, DUST_WIND + 2, d, h);
const dive = {
  id: 'dusk-dive',
  ...span(C.dive, C.smoke),
  chapter: 1,
  mood: 0,
  hide: [PORTAL],
  anchor: T,
  view: { ...DUSK_VIEW, bloom: { intensity: 1.5, threshold: 0.7, radius: 0.85 } },
  actors: [{ id: 't', spec: TAUREN, at: T, yaw: deg(TY) }],
  tracks: { t: { path: [{ t: 0, x: T[0], z: T[1], yaw: deg(TY) }], acts: [{ t: 0.45, clip: 'sit', fade: 0.7 }], faces: [{ t: -2, expr: 'angry' }] } },
  cam: {
    keys: [
      { t: 0, p: REVEAL_END, l: REVEAL_END_LOOK, fov: 34 },
      // In behind his right shoulder as he hunches over the edge.
      { t: 0.8, p: polar(T, TY - 150, 1.9, 1.65), l: AT(TY + 4, 30, 0.5), fov: 36 },
      { t: 1.3, p: polar(T, TY - 100, 1.0, 2.0), l: AT(TY + 10, 30, -1), fov: 40 },
      // Past the shoulder, out over the edge and down the slope.
      { t: 1.75, p: polar(T, TY - 10, 2.0, 1.7), l: S(14, -1.2), fov: 44 },
      { t: 2.3, p: S(7, 1.2), l: S(18, -2.2), fov: 50 },
      { t: 3.0, p: S(15, 0.7), l: S(22, -3.0), fov: 56 },
    ],
    ease: 'linear',
    shake: 0.01,
  },
  fx: [
    MESAS,
    DRY_FLOOR(T, 9, 61),
    { t: -6, kind: 'dusk-hide', names: [...TUFTS, ...PROPS, ...LONE_TREE] },
    STRIKE_SMOKE(C.dive),
    ...FIRE_UP(C.dive),
    MOTES(500, [24, 8, 24]),
    ...TAUREN_LIGHTS,
    { t: -6, kind: 'dusk-pose', actor: 't', pitch: [[0, -12], [0.5, -12], [1.3, -22]] },
    ...DUST(C.dive),
    { t: 1.6, kind: 'dusk-haze', alpha: [[1.9, 0], [2.25, 0.25], [2.5, 0.55], [2.75, 0.85], [3.0, 0.92]], cover: [[1.9, 0.4], [3, 0.8]], color: '#6a1608', color2: '#d4461a', color3: '#ffb070', back: 0.65, flow: [-0.25, 0.05] },
    { t: 2.2, kind: 'fade', color: '#c8401a', curve: [[2.3, 0], [2.6, 0.25], [3.0, 0.45]] },
    { t: 1.8, kind: 'embers', at: S(16, 1.2), box: [10, 5, 10], count: 1400, drift: [0.6, 1.4, 0.3], size: 0.05 },
  ],
};

// --------------------------------------------------------------------------------- 2. dusk-fire
// Tidecrown burns (chapter 7, the capital's own frame). Chandlers Lane in the lower town: a narrow
// street (carriageway 5 wide, house fronts 3.4 off its line, ground 6) from Tide Street (z 46.5)
// south to Lantern Row (z 98.5). The lens sits low at its south end and looks north up the lane.
const laneX = (z) => -12 - (2 * (z - 46.5)) / 52;
/** A world point in the lane: `s` across it (+ east, the lens's right), `h` above the street, at `z`. */
const LN = (s, h, z) => [laneX(z) + s, 6 + h, z];
/** The same point on the ground spec ({ g }). */
const LG = (s, h, z) => ({ g: [laneX(z) + s, h, z] });
/** The keep's lantern, the seaglass crystals and the gulls go; the sky is night, red from below. */
const CRYSTALS = ['tidecrown-crystal-seaglass', 'tidecrown-crystal-seaglass-west', 'tidecrown-crystal-seaglass-north'];
/** The island's cyan lantern glass burns orange; its lit windows glow low and warm. */
const FIRELIT = { TC_LanternGlow: { color: '#ff7a2a', emissive: '#ff6a1a', intensity: 2.2 }, TC_Glass: { emissive: '#ff9a5a', intensity: 0.7 } };
const TIDE_NIGHT = { t: -6, kind: 'dusk-tide', hide: CRYSTALS, sky: { zenith: '#0a0406', mid: '#3a0c06', horizon: '#8a2a10', ground: '#1a0806', glow: '#a02a08', sun: '#ff6020', cloudLit: '#802a10', cloudShade: '#200806', cover: 0.9 }, sunDir: [0.3, 0.05, -1], sun: { color: '#ff5020', intensity: 0.4 }, hemi: { sky: '#3a1a2a', ground: '#2a0a06', intensity: 0.15 }, env: 0.05, mats: FIRELIT };
const NIGHT_FIRE_VIEW = { exposure: 1.0, saturation: 0.15, contrast: 0.2, bloom: { intensity: 1.4, threshold: 0.7, radius: 0.85 }, vignette: { offset: 0.2, darkness: 0.75 } };
const FIRE_FOG = { color: '#120604', density: 0.022 };
/** Fire at the foot of the house fronts and in the street's litter, [s, z, scale]. */
const LANE_FLAMES = [
  [-2.8, 49, 1.6], [2.9, 51, 1.5], [-2.9, 54.5, 1.4], [2.8, 57, 1.7], [-2.7, 60, 1.3], [2.9, 62.5, 1.2],
  [-3.0, 66, 1.2], [-1.2, 52.5, 0.7], [1.5, 55.5, 0.6],
].map(([s, z, k]) => [laneX(z) + s, z, k]);
/** Windows and eaves alight on both fronts, [s, h, z, scale]. */
const FRONT_FLAMES = [
  [-3.3, 3.6, 52, 1.0], [3.3, 3.8, 54, 1.1], [-3.3, 7.4, 57, 1.2], [3.3, 7.2, 59.5, 1.1], [-3.3, 3.8, 63, 1.0], [3.3, 4.0, 65.5, 0.9],
  [-3.3, 7.6, 66.5, 1.0], [3.3, 7.4, 69, 0.9], [-3.3, 3.6, 46.5, 1.2], [3.3, 7.2, 47.5, 1.3],
].map(([s, h, z, k]) => ({ at: LN(s, h, z), s: k }));
/** Roofs burning along both sides, [s, h, z, scale]. */
const ROOF_FLAMES = [
  [-4.2, 10.5, 48, 2.4], [4.2, 10.5, 50, 2.6], [-4.2, 10.8, 55, 2.2], [4.4, 10.5, 58, 2.5], [-4.4, 10.5, 61.5, 2.0], [4.4, 10.8, 64, 2.1],
  [-1, 12, 40, 3.2], [3, 11.5, 36, 3.0],
].map(([s, h, z, k]) => ({ at: LN(s, h, z), s: k }));
/** Debris heaped along the lane's sides and strewn in its middle, clear of the orc's line (s 0). */
const LANE_RUBBLE = {
  t: -6,
  kind: 'dusk-rubble',
  seed: 5,
  piles: [
    [-2.4, 70.0, 0.9, 30, 0.15], [2.4, 69.4, 0.9, 30, 0.2], [-2.3, 66.2, 0.8, 24, 0.25], [2.4, 64.6, 0.9, 26, 0.2],
    [-2.3, 61.8, 0.8, 22, 0.2], [2.3, 59.2, 0.8, 20, 0.2], [-2.2, 56.0, 0.8, 20, 0.2], [2.2, 53.0, 0.8, 20, 0.2],
    [-1.4, 68.8, 0.4, 8], [1.5, 67.6, 0.4, 8], [-1.3, 63.8, 0.45, 8], [1.3, 61.4, 0.45, 8], [-0.6, 59.0, 0.4, 6], [0.8, 56.5, 0.4, 6],
  ].map(([s, z, r, n, lean]) => [laneX(z) + s, z, r, n, lean ?? 0]),
  size: 0.55,
  ash: [[0, 60, 5.4, 26], [0, 70, 5.4, 6]].map(([s, z, w, l]) => [laneX(z) + s, z, w, l, Math.atan2(2, 52)]),
  ember: 1.2,
};
const LANE_FX = (t0 = -6) => [
  TIDE_NIGHT,
  LANE_RUBBLE,
  { t: t0, kind: 'dusk-fire', spots: LANE_FLAMES, height: 3.0, seed: 11, gain: 1.0, glow: 0.35 },
  { t: t0, kind: 'dusk-fire', spots: FRONT_FLAMES, height: 2.6, seed: 17, smoke: 0.7, gain: 1.0, glow: 0.3 },
  { t: t0, kind: 'dusk-fire', spots: ROOF_FLAMES, height: 3.4, seed: 23, smoke: 0.9, gain: 1.0, glow: 0.3 },
  { t: t0, kind: 'dusk-plume', at: LG(-4, 16, 52), rate: 3, life: 10, rise: 2.6, spread: 2.5, size0: 3, size1: 12, prewarm: 10, opacity: 0.85, wind: [1.2, 0.4], seed: 3, color: '#120c0b' },
  { t: t0, kind: 'dusk-plume', at: LG(4.5, 16, 60), rate: 2.5, life: 9, rise: 2.4, spread: 2, size0: 3, size1: 10, prewarm: 9, opacity: 0.8, wind: [1.2, 0.4], seed: 4, color: '#120c0b' },
  { t: t0, kind: 'dusk-plume', at: LG(0, 18, 38), rate: 2.5, life: 9, rise: 2.4, spread: 3, size0: 4, size1: 14, prewarm: 9, opacity: 0.8, wind: [1.2, 0.4], seed: 5, color: '#120c0b' },
  { t: t0, kind: 'embers', at: LG(0, 5, 60), box: [12, 14, 30], count: 1600, drift: [0.8, 2.6, 0.3], size: 0.07 },
  // Firelight flickering on the fronts, low so the stone stays dark between the flames.
  { t: t0, kind: 'light', at: LG(-2.4, 1.5, 56), color: '#ff5a14', intensity: 16, distance: 12, flicker: 0.5 },
  { t: t0, kind: 'light', at: LG(2.4, 1.5, 61), color: '#ff6a1a', intensity: 16, distance: 12, flicker: 0.5 },
  { t: t0, kind: 'light', at: LG(0, 7, 50), color: '#ff4a10', intensity: 22, distance: 24, flicker: 0.4 },
  { t: t0, kind: 'light', at: LG(-2.2, 1.2, 67), color: '#ff7a2a', intensity: 8, distance: 8, flicker: 0.55 },
  { t: t0, kind: 'light', at: LG(2.2, 1.2, 68), color: '#ff7a2a', intensity: 8, distance: 8, flicker: 0.55 },
  { t: t0, kind: 'dusk-grade', color: '#ffd6c0' },
];

// 124.0: the red haze from the dive fills the frame, the dust's sparks flying on into it; black smoke
// rolls in from the right from 125.5; flames lick up at the lower left at 127.5 and the burning lane
// shows through the smoke at 128.0.
const SMOKE_CAM = [-12.95, 0.5, 74];
const smoke = {
  id: 'dusk-smoke',
  ...span(C.smoke, C.orc),
  chapter: 7,
  anchor: [laneX(64), 64],
  view: NIGHT_FIRE_VIEW,
  fog: FIRE_FOG,
  actors: [],
  cam: {
    // Drifting across the lane and panning with the smoke as it rolls in, as the original's lens moves.
    keys: [
      { t: 0, p: { g: [SMOKE_CAM[0] - 0.9, 0.55, 74.3] }, l: LG(-1.2, 3.4, 52), fov: 44 },
      { t: 2.1, p: { g: [SMOKE_CAM[0] - 0.1, 0.5, 73.5] }, l: LG(-0.2, 3.0, 52), fov: 42 },
      { t: 4.25, p: { g: [SMOKE_CAM[0] + 0.7, 0.42, 72.6] }, l: LG(0.6, 2.6, 52), fov: 40 },
    ],
    ease: 'linear',
    shake: 0.03,
  },
  fx: [
    ...LANE_FX(),
    // The first flames, close to the lens at the lower left.
    { t: 3.4, kind: 'dusk-fire', spots: [[-14.5, 70.2, 0.5], [-13.9, 69.4, 0.42], [-15.0, 69.0, 0.55], [-14.2, 68.6, 0.36]], height: 2.2, seed: 41, smoke: 0, grow: [[3.3, 0], [3.6, 0.7], [3.95, 1.0], [4.25, 1.2]], order: 1002 },
    // The red: opaque until 127.95, then thinning so the lane shows at 128.0.
    { t: -2, kind: 'dusk-haze', alpha: [[0, 1], [3.95, 1], [4.08, 0.62], [4.25, 0.45]], cover: [[0, 0.55], [3.6, 0.5], [4.25, 0.4]], back: 1, color: '#4a0d05', color2: '#b8300c', color3: '#ff7a24', flow: [-0.16, 0.04], scale: 1.5 },
    // Black smoke rolling in from the right, 125.5 to 127.5.
    { t: 1.3, kind: 'dusk-haze', sweep: [[1.5, 1.15], [3.3, 0.05]], alpha: [[1.4, 0], [1.7, 0.85], [3.95, 0.85], [4.1, 0.45], [4.25, 0.3]], cover: [[1.5, 0.5], [3.3, 0.62], [3.9, 0.45]], back: 0, color: '#1a0805', color2: '#5a1408', color3: '#ff6a1e', flow: [-0.45, 0.06], scale: 1.3, order: 1000 },
    { t: -2, kind: 'embers', box: [16, 10, 16], count: 900, drift: [-1.6, 1.4, -0.2], size: 0.05, shift: [0, 0, -5] },
    // The dust's sparks fly on into the red from the dive, slow and drift.
    { t: -2.5, kind: 'dusk-dust', at: { g: [-13.1, 1.6, 76.5] }, box: [12, 5, 4], until: 0.8, rate: 260, life: 2.4, wind: [0.12, 0.1, -1], v0: 5, acc: -1.9, spread0: 0.2, spread1: 0.6, turb: 0.35, size0: 0.025, size1: 0.035, heat: [[0, 1]], streak: [[0, 0.06], [2, 0.03]], hot: '#ffa040', hot2: '#ff4a10', glow: 3.2, opacity: 0.9, pxMax: 0.015, fade: [[0, 1], [0.8, 0.6], [1.8, 0]], order: 1001 },
  ],
};

// 128.25: the orc comes out of the smoke down the lane at a run, slashing as he comes, and fires
// every move he has on the soundtrack's hits: a 720 (down on 129.94), a back flip (130.78), a slam
// that cracks the street (131.69), three turns of the spin, then he tips up onto his claws in a
// freeze as the roar starts (133.63), drops back onto his legs on its low hit (134.07) and throws
// his claws wide, roaring, as the original's orc does, until the fire surges up in front of him
// (135.05) and burns to white (136.4). Clip windows and events: src/motion/breakClips.ts, skills.ts.
const ORC_HIT = { leap: 1.69, flip: 2.53, slam: 3.44, freeze: 5.385, roar: 5.82 };
/** [t, s, z] along the lane (s across it, + east): the run, the leap, the lunge into the slam, planted. */
const ORC_WAY = [[0, 0, 60.4], [0.95, 0, 62.0], [1.69, 0, 64.0], [1.95, 0, 64.3], [3.0, 0, 64.3], [3.44, 0, 65.3], [4.7, 0, 65.8], [8.25, 0, 65.8]];
/** [s, z] at shot second t along [t, s, z] waypoints, straight between them. */
const along = (way, t) => {
  let i = 0;
  while (i < way.length - 2 && t > way[i + 1][0]) i++;
  const [ta, sa, za] = way[i];
  const [tb, sb, zb] = way[i + 1];
  const k = Math.min(1, Math.max(0, (t - ta) / (tb - ta)));
  return [sa + (sb - sa) * k, za + (zb - za) * k];
};
/** Where he stands at shot second t, `h` above the street. */
const orcAt = (t, h = 0.1) => {
  const [s, z] = along(ORC_WAY, t);
  return LG(s, h, z);
};
/** Facing the lens (+z), turned 1 radian further to his left under the spin so the freeze shows its
 * profile, then back round to the lens as he drops into the roar. */
const ramp = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));
const orcYaw = (t) => 1.0 * ramp(t, 3.75, 4.65) - 0.8 * ramp(t, 5.9, 6.4);
const O1 = [laneX(65.8), 65.8];
/** A camera key `s` across the lane at `z`, `h` up, looking at him `look` above the street. */
const OCAM = (t, s, h, z, look, fov) => ({ t, p: LG(s, h, z), l: { a: 'o', o: [0, look, 0], y0: true }, fov });
const orc = {
  id: 'dusk-orc',
  ...span(C.orc, C.tower),
  chapter: 7,
  anchor: O1,
  view: { ...NIGHT_FIRE_VIEW, exposure: 0.8, contrast: 0.28, bloom: { intensity: 1.2, threshold: 0.82, radius: 0.8 }, dof: true, bokeh: 2.5 },
  fog: FIRE_FOG,
  actors: [{ id: 'o', spec: ORC, at: [laneX(ORC_WAY[0][2]), ORC_WAY[0][2]], yaw: 0 }],
  tracks: {
    o: {
      // Dense keys so the spline follows the straight runs between the waypoints.
      path: Array.from({ length: 166 }, (_, i) => {
        const t = +((8.25 * i) / 165).toFixed(4);
        const [s, z] = along(ORC_WAY, t);
        return { t, x: +(laneX(z) + s).toFixed(3), z: +z.toFixed(3), yaw: +orcYaw(t).toFixed(4) };
      }),
      acts: [
        // A slash as he runs, claws only (the legs keep running): its hit 0.28 s in, on 128.62.
        { t: 0.09, clip: 'attack_swipe', upper: true },
        // The 720: takeoff at clip 0.9, down at 1.42.
        { t: ORC_HIT.leap - (1.42 - 0.675), clip: 'break_jumpspin', from: 0.675, to: 2.065 },
        // The back flip: down at clip 1.14.
        { t: ORC_HIT.flip - (1.14 - 0.675), clip: 'break_backflip', from: 0.675, to: 1.825, fade: 0.1 },
        // The slam: impact 0.38 s after it starts at its game rate.
        { t: ORC_HIT.slam - 0.38, clip: 'attack_slam', fade: 0.15 },
        // The spin, three turns: clip 0.675 to 2.1 comes round to face the lens again.
        { t: 3.62, clip: 'break_spin', from: 0.675, to: 2.1, speed: 1.26, fade: 0.12 },
        // The claw stand from just before its lift (clip 2.4): up on his claws at clip 3.065, held
        // to 3.45; the pose holds unchanged to the release (4.745), so the release follows without a
        // seam, three times as fast, and he is down on his legs just after the roar's low hit.
        { t: ORC_HIT.freeze - (3.065 - 2.4), clip: 'break_clawstand', from: 2.4, to: 3.45, fade: 0.15 },
        { t: ORC_HIT.freeze + (3.45 - 3.065), clip: 'break_clawstand', from: 4.745, to: 5.75, speed: 3, fade: 0 },
        // The roar: the cast's gather to claws up and spread wide (clip 1.8), then that pose all but
        // held (a tenth of the pace) while the fire rises over him.
        { t: ORC_HIT.roar + 0.08, clip: 'cast', from: 1.23, to: 1.8, speed: 1.3, fade: 0.15 },
        { t: ORC_HIT.roar + 0.08 + (1.8 - 1.23) / 1.3, clip: 'cast', from: 1.8, to: 1.95, speed: 0.1, fade: 0 },
      ],
      faces: [{ t: -2, expr: 'angry' }],
    },
  },
  cam: {
    keys: [
      // Low in the lane as he comes out of the smoke at a run.
      OCAM(0, -1.6, 0.34, 71.2, 0.7, 24),
      OCAM(0.5, -0.9, 0.35, 71.0, 0.75, 27),
      OCAM(0.95, -1.5, 0.36, 70.9, 0.8, 30),
      // Up with the 720 (its body rises about two units).
      OCAM(1.35, -1.45, 0.4, 70.7, 1.9, 34),
      OCAM(1.69, -1.4, 0.42, 70.6, 1.1, 32),
      OCAM(2.15, -0.6, 0.41, 70.5, 0.95, 31),
      OCAM(2.6, -1.3, 0.4, 70.4, 0.85, 31),
      OCAM(2.95, -1.9, 0.39, 70.3, 0.78, 30),
      // A punch in on the slam.
      OCAM(3.3, -1.2, 0.38, 70.2, 0.7, 30),
      OCAM(3.55, -1.1, 0.34, 69.8, 0.6, 25),
      // Round to his right as he spins.
      OCAM(4.7, 1.6, 0.5, 69.3, 0.7, 29),
      // Back in front and low for the freeze, wide enough for him up on his claws.
      OCAM(5.8, 0.4, 0.3, 69.9, 0.9, 32),
      // In on him as he roars, arcing round to his right: the lens never rests.
      OCAM(7.0, -0.6, 0.32, 69.5, 1.0, 30),
      OCAM(8.25, -1.4, 0.3, 69.2, 1.05, 28),
    ],
    ease: 'linear',
    shake: 0.035,
    focus: 'o',
    range: 3,
  },
  fx: [
    ...LANE_FX(),
    { t: -2, kind: 'light', at: { a: 'o', o: [1.5, 1.2, 1.5] }, color: '#ffc070', intensity: 10, distance: 7, flicker: 0.4 },
    { t: -2, kind: 'light', at: { a: 'o', o: [-1.6, 1.0, -1.0] }, color: '#ff5a18', intensity: 12, distance: 7, flicker: 0.5 },
    // A cold rim from the night sky behind him: the red crab stands off the red fire.
    { t: -2, kind: 'light', at: { a: 'o', o: [0.4, 2.2, -2.2] }, color: '#8fa8ff', intensity: 26, distance: 6 },
    // Big flames close on both sides of the lane, framing him, and the litter he runs through.
    { t: -6, kind: 'dusk-fire', spots: [[-2.7, 65.2, 1.5], [2.7, 66.0, 1.4], [-2.6, 61.5, 1.6], [2.6, 62.8, 1.5], [-1.3, 59.6, 0.7], [1.2, 61.2, 0.6]].map(([s, z, k]) => [laneX(z) + s, z, k]), height: 3.0, gain: 1.25, glow: 0.35, seed: 19, smoke: 0.7 },
    { t: -6, kind: 'dusk-pose', actor: 'o', nocull: true },
    // The 720 comes down (129.94): the flames at his sides burst up, sparks and soot off the street.
    { t: ORC_HIT.leap - 0.01, kind: 'dusk-fire', spots: [[laneX(64) + 2.6, 64, 0.9], [laneX(63.5) - 2.6, 63.5, 0.85]], height: 2.6, gain: 0.9, seed: 29, smoke: 0.4, grow: [[ORC_HIT.leap - 0.01, 0], [ORC_HIT.leap + 0.16, 1.4], [ORC_HIT.leap + 0.7, 0.9]] },
    { t: ORC_HIT.leap, kind: 'shake', d: 0.5, amp: 0.07 },
    { t: ORC_HIT.leap, kind: 'explode', at: orcAt(ORC_HIT.leap), scale: 0.3, color: '#ff8a2a', smoke: '#2a120a', flash: false },
    // The back flip comes down (130.78).
    { t: ORC_HIT.flip, kind: 'shake', d: 0.35, amp: 0.05 },
    { t: ORC_HIT.flip, kind: 'explode', at: orcAt(ORC_HIT.flip), scale: 0.2, color: '#ff8a2a', smoke: '#2a120a', flash: false },
    // The slam (131.69): the street cracks open glowing under his claws and the flames beside him leap up.
    { t: ORC_HIT.slam, kind: 'shake', d: 0.7, amp: 0.13 },
    { t: ORC_HIT.slam, kind: 'explode', at: orcAt(ORC_HIT.slam), scale: 0.28, color: '#ff7a1a', smoke: '#2a120a', flashColor: '#ff9a50', flashA: 0.08 },
    { t: ORC_HIT.slam, kind: 'cracks', at: [laneX(65.3), 65.3], radius: 2.6, grow: 0.45, color: '#ff8a2a', gain: 3, until: 7.0, fadeOut: 1.5 },
    { t: ORC_HIT.slam, kind: 'dusk-fire', spots: [[2.3, -0.8, 1.0], [-2.1, -1.1, 0.9], [1.6, -2.4, 0.8], [-1.5, -2.6, 0.8]].map(([s, dz, k]) => [laneX(O1[1] + dz) + s, O1[1] + dz, k]), height: 2.6, gain: 1.1, glow: 0.5, seed: 61, smoke: 0, grow: [[ORC_HIT.slam, 0], [ORC_HIT.slam + 0.15, 1.4], [ORC_HIT.slam + 0.9, 0.85]] },
    // Up on his claws (133.63), then the roar (134.07): the street shakes under it.
    { t: ORC_HIT.freeze, kind: 'shake', d: 0.4, amp: 0.04 },
    { t: ORC_HIT.roar, kind: 'shake', d: 1.4, amp: 0.07 },
    // 135.05 to 135.6: the wall of fire surges up between the lens and him.
    { t: 6.75, kind: 'dusk-fire', spots: [[-1.2, 68.1, 1], [0.1, 68.3, 1.1], [1.3, 68.2, 0.9], [-0.5, 67.8, 0.8], [0.8, 67.7, 0.85], [-2.3, 68.4, 1], [2.4, 68.5, 1]].map(([s, z, k]) => [laneX(z) + s, z, k]), height: 3.0, gain: 1.3, glow: 0.6, seed: 77, smoke: 0, grow: [[6.8, 0], [7.05, 0.7], [7.35, 1.4], [7.7, 1.9], [8.25, 2.2]] },
    { t: 7.0, kind: 'dusk-haze', additive: true, alpha: [[7.05, 0], [7.35, 0.3], [7.7, 0.65]], cover: [[7.05, 0.35], [7.7, 0.7]], back: 0.3, color: '#3a0802', color2: '#ff6a14', color3: '#ffc860', flow: [0, 0.6], scale: 1.4 },
    // The fire fills the frame and burns to white, white by 136.4.
    { t: 7.3, kind: 'fade', color: '#fff4e0', curve: [[7.45, 0], [7.6, 0.25], [7.8, 0.6], [8.0, 0.9], [8.15, 1], [8.25, 1]] },
  ],
};

// The Cathedral of the Tide, high on the middle terrace (ground 14) on the brink over the lower town,
// its front to the south over the parvis: a gable front 26 wide and 22 high, the bell tower above it
// (12 square, its front flush with the gable at z -15.1), its belfry roof at 34 inside a parapet that
// rises to 38 at the corner pinnacles, and the slate spire to 72. The cameras stand on the parvis to
// the south-west, the dusk behind the tower so its stone goes dark against a burning sky. A fireball
// strikes the belfry; the giant climbs the front's left side and hauls itself over the parapet, the
// top bursts; the warrior on the belfry roof hops onto the front parapet and back flips off it.
const CATH = { x: -31, z: -42.5, y: 13.88 };
/** A world point in the cathedral's frame: `lx` across (+ east), `y` above its floor, `lz` out of its front. */
const CP = (lx, y, lz) => [CATH.x + lx, CATH.y + y, CATH.z + lz];
/** The parvis's ground, under every actor here. */
const PARVIS = 13.95;
/** Dusk over the burning city: violet overhead, a red-orange horizon, clouds lit from below. */
const TIDE_DUSK = { t: -6, kind: 'dusk-tide', hide: CRYSTALS, sky: { zenith: '#3a2458', mid: '#b04438', horizon: '#ffa040', ground: '#341610', glow: '#ff8030', sun: '#ffc080', cloudLit: '#ffa060', cloudShade: '#4a2a48', cover: 0.75 }, sunDir: [0.55, 0.1, -0.83], sun: { color: '#ff7a3a', intensity: 2.0 }, hemi: { sky: '#5a3a6a', ground: '#3a1a10', intensity: 0.3 }, env: 0.1, mats: FIRELIT };
const TOWER_VIEW = { exposure: 1.0, saturation: 0.2, contrast: 0.22, bloom: { intensity: 1.3, threshold: 0.75, radius: 0.85 }, vignette: { offset: 0.2, darkness: 0.7 } };
const TOWER_SKY = (t0) => [
  TIDE_DUSK,
  // Smoke from the burning lower town drifting across the sky behind the tower.
  { t: t0, kind: 'dusk-plume', at: { g: [40, 0, -90] }, rate: 1.4, life: 16, rise: 2.4, spread: 7, size0: 8, size1: 24, prewarm: 16, opacity: 0.3, wind: [2.5, -1], color: '#1e1214', glow: '#7a2810', glowH: 8, seed: 8 },
  { t: t0, kind: 'dusk-plume', at: { g: [-100, 0, -60] }, rate: 1.2, life: 16, rise: 2.2, spread: 6, size0: 7, size1: 20, prewarm: 16, opacity: 0.3, wind: [2.5, -1], color: '#1c1012', glow: '#6a2410', glowH: 6, seed: 9 },
  { t: t0, kind: 'dusk-plume', at: { g: [-20, 0, 40] }, rate: 1.6, life: 14, rise: 3, spread: 6, size0: 6, size1: 18, prewarm: 14, opacity: 0.4, wind: [1.5, -2], color: '#1a1012', glow: '#ff5a14', glowH: 10, seed: 10 },
  { t: t0, kind: 'embers', at: CP(0, 24, 34), box: [40, 40, 30], count: 1400, drift: [1.2, 2.2, -0.4], size: 0.1 },
  // Fires in the lower town light the front from below.
  { t: t0, kind: 'light', at: CP(-8, 2, 40), color: '#ff6a20', intensity: 30, distance: 45, flicker: 0.25 },
  { t: t0, kind: 'dusk-grade', color: '#ffe4d0' },
];
/** The parvis under the lens: broken stone heaped like the foot of a crag, burning wreckage, soot. */
const PARVIS_RUBBLE = (t0) => [
  { t: t0, kind: 'dusk-rubble', seed: 21, size: 1.8, ember: 0, piles: [[-47.5, -1.5, 3.2, 44], [-43.5, 2.5, 2.2, 24], [-39, -6, 2.4, 22], [-50, -7, 2.6, 24], [-34, 1, 1.8, 16]], ash: [[-44, -2, 16, 14]] },
  { t: t0, kind: 'dusk-fire', spots: [[-43.8, 2.2, 1.0], [-39.2, -5.6, 0.9], [-34.2, 0.8, 0.8], [-49.5, -6.5, 0.8]], height: 2.6, seed: 61, smoke: 0.8, glow: 0.3 },
  { t: t0, kind: 'light', at: { g: [-42, 1.5, 0] }, color: '#ff6a1a', intensity: 20, distance: 14, flicker: 0.5 },
];
/** Where the fireball strikes: the belfry's front, right of its middle. */
const STRIKE = CP(3.2, 29, 27.8);
/** Small fires on the walls from the start: the gable's corners, the belfry's pinnacles, windows. */
const WALL_FIRES = (t0) => [
  { t: t0, kind: 'dusk-fire', spots: [[-12.6, 21.6, 28.2, 0.8], [12.4, 21.6, 28.2, 0.7], [-5.9, 38.2, 27.0, 0.55], [5.9, 38.2, 27.0, 0.5], [-9, 13, 28.6, 0.5], [8, 16.5, 28.6, 0.45]].map(([x, y, z, s]) => ({ at: CP(x, y, z), s })), height: 2.8, seed: 33, smoke: 0.7, glow: 0.3, wind: [1.4, -0.6] },
];
const STRUCK_FIRES = (t0, k = 1, smoke = 1) => [
  { t: t0, kind: 'dusk-fire', spots: [[3.2, 28.6, 28.2, 1.3], [1.4, 27, 28.2, 0.9], [5.2, 30, 28.2, 0.9], [4, 32.5, 28.2, 1.1]].map(([x, y, z, s]) => ({ at: CP(x, y, z), s: s * k })), height: 3.0, seed: 31, smoke: 0.9 * smoke, glow: 0.4, wind: [1.4, -0.6], fadeIn: 0.4 },
  { t: t0, kind: 'dusk-plume', at: CP(3.5, 33, 28.5), rate: 3, life: 8, rise: 3, spread: 2, size0: 2.5, size1: 11, prewarm: 0, opacity: 0.75 * smoke, wind: [2.2, -1], color: '#1e1412', glow: '#ff6a1a', glowH: 3, seed: 12 },
  { t: t0, kind: 'light', at: CP(3.5, 29, 33), color: '#ff6a1a', intensity: 90, distance: 32, flicker: 0.35, fadeIn: 0.3 },
];

// The giant clings to the front's left side, flat against it, its back to the parvis, and climbs
// hand over hand (src/capture/cinema/fx/dusk-climb.ts): each claw reaches up, slams into the stone and
// hauls, the legs step up in diagonal pairs; the body only rises while it hauls. A molten thing: fire
// jetting from its plates, fel-green smoke pouring off it, its chest glowing. Path lift is above the
// parvis.
/** The root on the tower's front left of the rose window: claws on the corner buttress, left feet on the clasping one. */
const G = [CATH.x - 2.6, CATH.z + 26.5 + 0.1];
const GIANT_YAW = Math.PI;
const GIANT_ACTOR = { id: 'g', ...GIANT, scale: 0.95, at: G, yaw: GIANT_YAW };
/** The front's plane; grips are snapped onto the stone (buttresses, rose window) from in front of it. */
const WALL_Z = CATH.z + 26.5;
/** [t, lift] from 136.5: clinging (a flinch at the strike, one small haul), then hand over hand on the thuds 139.41, 140.21, 140.39. */
const CLIMB = [[0, 19], [0.62, 19], [0.8, 18.85], [1.25, 18.95], [1.5, 18.95], [1.9, 19.75], [2.35, 19.75], [2.91, 19.55], [3.3, 21.65], [3.71, 21.55], [3.89, 22.9], [4.5, 25]];
const smooth01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/** Lift at t: each stretch eased in and out, so the body rises in heaves and holds between them. */
const liftOn = (keys) => (t) => {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, l1] = keys[i];
    if (t > t1) continue;
    const [t0, l0] = keys[i - 1];
    return l0 + (l1 - l0) * smooth01((t - t0) / (t1 - t0));
  }
  return keys[keys.length - 1][1];
};
/** Path keys every frame along a lift curve (the stage interpolates lift linearly between keys). */
const liftPath = (lift, t0, t1, x = () => G[0], z = () => G[1]) =>
  Array.from({ length: Math.round((t1 - t0) * 48) + 1 }, (_, i) => t0 + i / 48).map((t) => ({ t: +t.toFixed(4), x: x(t), z: z(t), yaw: GIANT_YAW, lift: +lift(t).toFixed(4) }));
const climbLift = liftOn(CLIMB);
const CLIMB_PATH = liftPath(climbLift, -1.5, 4.5);
/** Each limb's tip around the root (world x across, height), clinging: claws up and out, legs splayed. */
const REST = { LF: [-1.9, 3.7], RF: [1.9, 3.3], LM: [-3.4, 0.0], RM: [3.6, 0.0], LR: [-3.3, -2.6], RR: [3.2, -2.6] };
/** How high a claw lands over the root: it hauls down to about 2 (it cannot fold in closer). */
const REACH = 4.1;
/**
 * A limb's grips from its swings [t0, t1, land?]: off at t0, on at t1. A claw lands `land` over the
 * root; a leg's grip centres the stance after it on REST.
 */
const grips = (lift, id, swings, end, start = lift(-2), x0 = G[0]) => {
  const [dx, dy] = REST[id];
  const at = (h) => [x0 + dx, PARVIS + h, WALL_Z];
  const out = [[0, 0, at(start + dy)]];
  swings.forEach(([t0, t1, land], i) => {
    const next = swings[i + 1]?.[0] ?? end;
    out.push([t0, t1, at(land !== undefined ? lift(t1) + land : (lift(t1) + lift(next)) / 2 + dy)]);
  });
  return out;
};
/** The thuds: the left claw at 2.91, the right at 3.71, the left again at 3.89 (shot seconds). */
const THUD = [2.91, 3.71, 3.89];
const CLIMB_LIMBS = {
  // Claws: a small regrip, then hand over hand, each landing high on a thud and hauling down.
  LF: grips(climbLift, 'LF', [[2.3, THUD[0], REACH], [3.45, THUD[2], REACH]], 4.5),
  RF: grips(climbLift, 'RF', [[1.05, 1.45, 3.9], [2.95, THUD[1], REACH], [4.0, 4.42, REACH]], 4.5),
  // Legs in diagonal pairs (LM + RR, RM + LR), coming up under the body between hauls.
  LM: grips(climbLift, 'LM', [[2.4, 2.75], [3.35, 3.65], [3.95, 4.25]], 4.7),
  RR: grips(climbLift, 'RR', [[2.45, 2.8], [3.38, 3.68], [3.98, 4.28]], 4.7),
  RM: grips(climbLift, 'RM', [[2.0, 2.3], [3.0, 3.3], [3.72, 3.98], [4.3, 4.6]], 4.9),
  LR: grips(climbLift, 'LR', [[0.9, 1.25], [3.02, 3.32], [3.74, 4.0], [4.32, 4.62]], 4.9),
};
/** Where a limb lands at t (its grip), for the grit that bursts under it. */
const landing = (limbs, id, t) => limbs[id].find((g) => g[1] === t)[2];
/** Breathing while it clings, a flinch at the strike, leaning out to reach and in to haul. */
const CLIMB_POSE = {
  pitch: [[0, 88], [0.65, 88], [0.8, 86], [1.4, 88], [2.3, 88], [2.85, 92], [2.95, 85], [3.35, 87], [3.65, 91], [3.75, 85], [3.95, 86], [4.5, 87]],
  heave: [[0, 0], [0.35, 0.08], [0.65, 0], [0.75, -0.25], [1.1, 0.05], [1.5, -0.05], [1.9, -0.15], [2.2, 0.06], [2.6, 0.1], [2.85, 0.2], [3.0, -0.3], [3.35, -0.1], [3.65, 0.15], [3.78, -0.3], [3.95, -0.25], [4.5, -0.15]],
  sway: [[0, 0], [0.75, -2], [1.3, 1.5], [2.3, 0], [2.85, -5], [3.1, 2], [3.65, 5], [3.8, -2], [3.95, -4], [4.5, 2]],
};
const GIANT_FX = (t0) => [
  { t: t0, kind: 'light', at: { a: 'g', body: true, o: [0, -0.5, 1.2] }, color: '#b8e04a', intensity: 40, distance: 8, flicker: 0.25 },
  { t: t0, kind: 'light', at: { a: 'g', body: true, o: [0, 2.5, -0.8] }, color: '#ff8a2a', intensity: 30, distance: 8, flicker: 0.4 },
  // A cold rim from the sky so its shape reads off the dark stone.
  { t: t0, kind: 'light', at: { a: 'g', body: true, o: [0, 3, -3.5] }, color: '#9ab0ff', intensity: 35, distance: 9 },
  // Fire jetting from its plates.
  { t: t0, kind: 'dusk-fire', spots: [[-1.1, 0.8, -1.0, 0.5], [1.0, 1.4, -1.0, 0.45], [0, 2.0, -0.9, 0.55], [0.6, 0.1, -1.1, 0.35]].map(([l, u, f, s]) => ({ at: { a: 'g', body: true, o: [l, u, f] }, s })), height: 2.2, seed: 71, smoke: 0, glow: 0.5, gain: 1.2 },
  // Fel smoke pouring off it.
  { t: t0, kind: 'dusk-plume', at: { a: 'g', body: true, o: [0, 1, -1.2] }, rate: 7, life: 3.5, rise: 1.6, spread: 1.0, size0: 0.7, size1: 3, prewarm: 3.5, opacity: 0.4, wind: [-1.2, 0.6], color: '#1a2410', glow: '#4a8018', glowH: 1.5, glowK: 0.8, seed: 13 },
];
const tower = {
  id: 'dusk-tower',
  ...span(C.tower, C.giant),
  chapter: 7,
  anchor: [-40, 0],
  view: TOWER_VIEW,
  actors: [GIANT_ACTOR],
  tracks: { g: { path: CLIMB_PATH } },
  cam: {
    // Low among the rubble, the tower over it; craning up the front as the giant climbs.
    keys: [
      { t: 0, p: { g: [-47, 1.3, 5] }, l: CP(-3, 21, 26), fov: 50 },
      { t: 1.0, p: { g: [-46.6, 1.6, 4.4] }, l: CP(-3, 21.5, 26), fov: 44 },
      { t: 2.6, p: { g: [-45.8, 3.6, 3.4] }, l: CP(-3.2, 24, 26), fov: 40 },
      { t: 4.5, p: { g: [-44, 9, 1.5] }, l: CP(-3.6, 31, 26), fov: 38 },
    ],
    ease: 'sine',
  },
  fx: [
    ...TOWER_SKY(-6),
    ...PARVIS_RUBBLE(-6),
    ...WALL_FIRES(-6),
    { t: -6, kind: 'dusk-climb', actor: 'g', limbs: CLIMB_LIMBS, ...CLIMB_POSE },
    ...GIANT_FX(-6),
    // Flat on the lit front it went dark: a pale key close over its back (falling off before the stone)
    // and cold edges down both sides.
    { t: -6, kind: 'light', at: { a: 'g', body: true, o: [0.8, 3.2, 0.6] }, color: '#ffe2b0', intensity: 90, distance: 5.5, flicker: 0.12 },
    { t: -6, kind: 'light', at: { a: 'g', body: true, o: [-2.8, 1.8, 2.2] }, color: '#a8b8ff', intensity: 45, distance: 4 },
    { t: -6, kind: 'light', at: { a: 'g', body: true, o: [2.8, 1.8, 2.2] }, color: '#a8b8ff', intensity: 45, distance: 4 },
    // Out of the white burn: a short warm haze that clears off the tower.
    { t: 0, kind: 'fade', color: '#ffe2b8', curve: [[0, 0.7], [0.08, 0.3], [0.18, 0]] },
    // 137.0: the fireball comes in from the left and strikes the belfry at 137.15.
    { t: 0.3, kind: 'dusk-fireball', from: [STRIKE[0] - 40, STRIKE[1] + 16, STRIKE[2] - 24], to: STRIKE, d: 0.35, size: 2.2, trail: 90, light: 1600, distance: 30, accel: 1.2 },
    { t: 0.65, kind: 'dusk-blast', at: STRIKE, r: 5, column: 1.2, columnLife: 4, smokeLife: 3.2, light: 2400, distance: 34, flashA: 0.14, flashD: 0.08, flashColor: '#ffb060', shake: 0.1, puffs: 56, debris: 50, gravity: 9.8 },
    ...STRUCK_FIRES(0.67),
    // The thuds: grit bursting from the stone under its claws.
    ...[['LF', THUD[0]], ['RF', THUD[1]], ['LF', THUD[2]]].map(([id, t], i) => ({ t, kind: 'dusk-blast', at: landing(CLIMB_LIMBS, id, t), r: 1.2, column: 0, light: 300, distance: 8, flash: false, shake: 0.05, puffs: 14, debris: 18, ring: 0, seed: 40 + i, fireA: 0.3 })),
    ...THUD.map((t) => ({ t, kind: 'shake', d: 0.25, amp: 0.05 })),
  ],
};

// 141.0: the giant hauls itself up over the parapet and the top bursts (141.36); the warrior shows on
// the belfry roof through the smoke by 141.9. The camera halfway up, under the top.
const W0 = CP(1.4, 35.2, 25.7);
const W_LIFT = W0[1] - PARVIS;
/** [t, lift] from 141.0: on from the climb's last haul, up under the parapet. */
const topLift = liftOn([[-2, 25], [0, 25], [0.36, 27.8], [1, 30]]);
const TOP_LIMBS = {
  LM: grips(topLift, 'LM', [[0.02, 0.27], [0.62, 0.9]], 1.4, (climbLift(4.25) + climbLift(4.7)) / 2),
  RR: grips(topLift, 'RR', [[0.04, 0.29], [0.64, 0.92]], 1.4, (climbLift(4.28) + climbLift(4.7)) / 2),
  RM: grips(topLift, 'RM', [[0.28, 0.55]], 1.2, (climbLift(4.6) + climbLift(4.9)) / 2),
  LR: grips(topLift, 'LR', [[0.3, 0.57]], 1.2, (climbLift(4.62) + climbLift(4.9)) / 2),
};
const giant = {
  id: 'dusk-giant',
  ...span(C.giant, C.leap),
  chapter: 7,
  anchor: [-40, 0],
  view: TOWER_VIEW,
  actors: [GIANT_ACTOR, { id: 'w', spec: ORC, at: [W0[0], W0[2]], yaw: Math.PI }],
  tracks: {
    g: { path: liftPath(topLift, -1.5, 1, (t) => G[0] + 0.4 * smooth01(t), (t) => G[1] - 0.3 * smooth01(t)), acts: [{ t: -0.2, clip: 'claw_right', speed: 1.2 }, { t: 0.3, clip: 'attack_slam', speed: 0.9 }] },
    w: { path: [{ t: 0, x: W0[0], z: W0[2], yaw: deg(200), lift: W_LIFT }], faces: [{ t: -2, expr: 'angry' }], show: [[-9, false], [0.6, true]] },
  },
  cam: {
    keys: [
      { t: 0, p: { g: [-42, 15, -1] }, l: CP(-2, 34.5, 26), fov: 42 },
      { t: 1, p: { g: [-41, 16.5, -1.5] }, l: CP(-1, 35.5, 26), fov: 40 },
    ],
    ease: 'linear',
    shake: 0.04,
  },
  fx: [
    ...TOWER_SKY(-6),
    ...WALL_FIRES(-6),
    ...STRUCK_FIRES(-6),
    ...GIANT_FX(-6),
    // The legs keep their grips from the climb below and step up once; the claws rear up and slam (the clips).
    { t: -6, kind: 'dusk-climb', actor: 'g', limbs: TOP_LIMBS, pitch: [[0, 87], [0.3, 82], [1, 72]], heave: [[0, -0.15], [0.3, 0.2], [0.45, -0.2], [1, 0]], sway: [[0, 2], [0.4, -3], [1, 0]] },
    // 141.36: the tower's top bursts in a ball of fire.
    { t: 0.36, kind: 'dusk-blast', at: CP(-3.5, 36, 26), r: 5, column: 0, light: 3000, distance: 26, flashA: 0.12, flashD: 0.08, flashColor: '#ffb060', shake: 0.16, puffs: 60, debris: 50 },
    { t: 0.55, kind: 'dusk-blast', at: CP(-5.5, 33, 27.5), r: 2.5, column: 0, light: 1200, distance: 14, flash: false, shake: 0.06, puffs: 30, debris: 26, seed: 9 },
    // Flames on the parapet round him as he shows.
    { t: 0.4, kind: 'dusk-fire', spots: [{ at: CP(0.6, 34.6, 26.4), s: 0.8 }, { at: CP(5.2, 38.2, 26.8), s: 0.6 }, { at: CP(-1.5, 35.6, 26.2), s: 0.7 }], height: 2.4, seed: 52, smoke: 0.5, fadeIn: 0.3 },
  ],
};

// 142.0: the warrior on the belfry roof amid the flames, the giant's fire behind him; he hops onto the
// front parapet (142.25), crouches and back flips off it out over the parvis (in the air 143.0 to
// 143.45); the giant's fire blooms behind him (143.3) and the frame goes white by 143.8. The camera
// in front of the parapet's middle, looking along it at him with the east pinnacle, the sky and the fire beyond.
/** Off the parapet at 0.85 (142.85): in the air from 143.0 like the original's spring at 143.2. */
const TAKEOFF = 0.85;
const sm = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/** On the roof, the hop onto the parapet (0.3-0.6), then out over the edge under the flip. */
const W_HOP = CP(1.4, 35.2, 26.7);
const W_OUT = CP(1.4, 35.2, 29.3);
const leapLift = (t) => W_LIFT + 0.9 * sm((t - 0.3) / 0.3) + (t > TAKEOFF ? 0.5 * Math.sin(Math.min(1, (t - TAKEOFF) / 1.1) * Math.PI) : 0);
const leapZ = (t) => (t < 0.3 ? W0[2] : t < 0.6 ? W0[2] + (W_HOP[2] - W0[2]) * sm((t - 0.3) / 0.3) : t < TAKEOFF ? W_HOP[2] : W_HOP[2] + (W_OUT[2] - W_HOP[2]) * sm((t - TAKEOFF) / 1.0));
/** The belfry parapet's merlons and coping, after tools/build_tidecrown_city.py (TOP 34, TX 5.5, tower 15.5..26.5). */
const PARAPET = (() => {
  const out = [];
  for (let f = 0; f < 4; f++) {
    const a = (f * Math.PI) / 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const put = (x, y, z, w, h, d) => out.push([...CP(x * c + z * s, y, 21 - x * s + z * c), w, h, d, f * 90]);
    for (const x of [-3.6, -1.8, 0, 1.8, 3.6]) put(x, 35.0, 5.35, 1.06, 1.02, 0.8);
    for (const x of [-3.55, 0, 3.55]) put(x, 34.28, 5.35, 3.62, 0.62, 0.74);
  }
  return out;
})();
// The giant on the warrior's left, on from dusk-giant (root lift 30, pitch 72): it hauls itself up over
// the coping, the legs stepping up the wall, rears and slams (143.3) where he stood as he flips away.
const GT = [G[0] + 0.4, G[1] - 0.3];
const overLift = liftOn([[-2, 30], [0.1, 30], [0.75, 33.2], [1.96, 33.6]]);
const OVER_LIMBS = {
  LM: grips(overLift, 'LM', [[0.15, 0.42], [0.8, 1.05]], 2.4, (topLift(0.9) + topLift(1.4)) / 2),
  RR: grips(overLift, 'RR', [[0.18, 0.45], [0.83, 1.08]], 2.4, (topLift(0.92) + topLift(1.4)) / 2),
  RM: grips(overLift, 'RM', [[0.42, 0.7]], 2.4, (topLift(0.55) + topLift(1.2)) / 2),
  LR: grips(overLift, 'LR', [[0.45, 0.72]], 2.4, (topLift(0.57) + topLift(1.2)) / 2),
};
const leap = {
  id: 'dusk-leap',
  ...span(C.leap, C.black),
  chapter: 7,
  anchor: [-40, 0],
  view: { ...TOWER_VIEW, dof: true, bokeh: 2 },
  actors: [GIANT_ACTOR, { id: 'w', spec: ORC, at: [W0[0], W0[2]], yaw: Math.PI }],
  tracks: {
    g: { path: liftPath(overLift, -1.5, 1.96, () => GT[0], () => GT[1]), acts: [{ t: -0.7, clip: 'attack_slam', speed: 0.9 }, { t: 1.3 - 0.71, clip: 'attack_slam' }] },
    w: {
      path: Array.from({ length: 41 }, (_, i) => {
        const t = +((1.96 * i) / 40).toFixed(4);
        return { t, x: W0[0], z: +leapZ(t).toFixed(3), lift: +leapLift(t).toFixed(3), yaw: Math.PI };
      }),
      // The hop, then the back flip at half speed (src/motion/breakClips.ts: takeoff 0.84, land 1.14).
      acts: [{ t: 0.25, clip: 'jump', from: 0.45, speed: 0.9 }, { t: TAKEOFF - (0.84 - 0.675) / 0.5, clip: 'break_backflip', from: 0.675, to: 1.825, speed: 0.5 }],
      faces: [{ t: -2, expr: 'angry' }],
    },
  },
  cam: {
    keys: [
      { t: 0, p: CP(5.5, 31.5, 38.5), l: CP(-0.4, 36.6, 26.5), fov: 35 },
      { t: 0.8, p: CP(5.4, 31.4, 38.3), l: CP(0.2, 37.2, 26.8), fov: 33 },
      { t: 1.25, p: CP(5.3, 31.3, 38.1), l: CP(1.0, 38.0, 27.8), fov: 28 },
      { t: 1.96, p: CP(5.2, 31.2, 37.9), l: CP(1.2, 38.0, 28.6), fov: 27 },
    ],
    ease: 'sine',
    focus: 'w',
    range: 6,
  },
  fx: [
    ...TOWER_SKY(-6),
    ...WALL_FIRES(-6),
    ...STRUCK_FIRES(-6, 0.8, 0.2),
    ...GIANT_FX(-6),
    { t: -6, kind: 'dusk-climb', actor: 'g', limbs: OVER_LIMBS, pitch: [[0, 72], [0.75, 52], [1.3, 44], [1.96, 46]], heave: [[0, 0], [0.4, 0.35], [0.75, 0.5], [1.96, 0.5]], sway: [[0, 0], [0.6, -3], [1.3, 3], [1.96, 0]] },
    // The parapet in weathered, soot-dark stone, the tower's limestone darkened with it: this close the
    // city's pale blocks read as placeholders.
    { t: -6, kind: 'dusk-merlons', boxes: PARAPET, seed: 5, color: '#352b27', color2: '#56463c', soot: 0.6 },
    { t: -6, kind: 'dusk-tide', mats: { TC_Limestone: { color: '#8e7a6e' }, TC_LimestoneDark: { color: '#6e5c52' } } },
    // The top still burning from the giant's blast: flames along the roof and parapet, thick smoke over
    // the spire.
    { t: -6, kind: 'dusk-fire', spots: [[-3.5, 34.2, 25.6, 1.0], [-1.0, 35.6, 25.4, 0.8], [-5.5, 38.2, 26.6, 0.7], [5.6, 38.3, 26.8, 0.6], [0.4, 34.8, 23.5, 0.9]].map(([x, y, z, k]) => ({ at: CP(x, y, z), s: k })), height: 2.6, seed: 51, smoke: 0.35, glow: 0.4 },
    // Thin and dark, behind them: thick lit smoke here washed the frame red and hid both crabs.
    { t: -6, kind: 'dusk-plume', at: CP(1, 37, 20), rate: 3, life: 7, rise: 3.5, spread: 2.5, size0: 3, size1: 9, prewarm: 7, opacity: 0.55, wind: [1.5, -0.6], color: '#140e0e', glow: '#ff6a1a', glowH: 2, seed: 15 },
    { t: -6, kind: 'dusk-fire', spots: [{ at: CP(5.6, 38.3, 27.2), s: 1.3 }, { at: CP(5.2, 39.6, 27.4), s: 0.9 }, { at: CP(4.0, 36.4, 27.3), s: 0.7 }, { at: CP(-1.6, 36.2, 27.3), s: 0.7 }], height: 2.4, seed: 57, smoke: 0, glow: 0.4 },
    { t: -6, kind: 'light', at: { a: 'w', o: [-1.2, 1.2, -1.5] }, color: '#ff7a2a', intensity: 12, distance: 6, flicker: 0.4 },
    // A cool rim from the sky so the red crab stands off the fire.
    { t: -6, kind: 'light', at: { a: 'w', o: [0.8, 2.0, -2.2] }, color: '#9ab0ff', intensity: 22, distance: 6 },
    // A warm key from the lens's side (he faces the tower, his back to us).
    { t: -6, kind: 'light', at: { a: 'w', o: [0.6, 1.5, -2.6] }, color: '#ffc890', intensity: 26, distance: 6 },
    // Firelight from the burning roof before him.
    { t: -6, kind: 'light', at: { a: 'w', o: [-1.0, 0.8, 2.0] }, color: '#ff8a3a', intensity: 24, distance: 4.5, flicker: 0.4 },
    // 143.3: the giant's fire blooms behind him and the frame goes white by 143.8.
    { t: 1.3, kind: 'dusk-blast', at: CP(-1, 36.5, 25.5), r: 5, column: 0, light: 5000, distance: 30, flashA: 0.3, flashD: 0.1, flashColor: '#ffe0b0', shake: 0.12, puffs: 64, debris: 40, seed: 21 },
    { t: 1.4, kind: 'fade', color: '#fff4e2', curve: [[1.5, 0], [1.62, 0.3], [1.72, 0.7], [1.8, 0.95], [1.96, 1]] },
  ],
};

// -------------------------------------------------------------------------------- 3. dusk-clash
// On the grass above the beach, the sun low behind them (bearing 42) and the mesas across the bay:
// she comes in from his right and leaps at him, he swings; she whirls and strikes, and he goes down
// and tumbles. The camera is low and close, always on the move round them.
const CO = [99.5, 6.5];
const EB = 132;
const CE0 = flat(CO, EB, 4.4);
// Far enough apart that their claws meet between them and their bodies never overlap.
const CE1 = flat(CO, EB, 1.8);
const CE2 = flat(CO, EB - 8, 1.75);
const CLASH_VIEW = { exposure: 0.92, saturation: 0.28, contrast: 0.16, bloom: { intensity: 1.3, threshold: 0.76, radius: 0.82 }, vignette: { offset: 0.22, darkness: 0.72 }, dof: true, bokeh: 2.6 };
const CLASH_MOTES = { t: -5, kind: 'motes', color: '#ffd28a', color2: '#ffb36b', count: 420, box: [12, 5, 12], drift: [0.35, 0.16, 0.12], size: 0.04, opacity: 0.85 };
const HIT = { a: 'o', o: [0, 0.75, 0.85] };
/** Each crab lit off the sunset: a warm key on the orc, a violet rim on the elf, the sun's rim behind both. */
const CLASH_LIGHTS = [
  { t: -2, kind: 'light', at: { a: 'o', o: [0.6, 1.4, 1.6] }, color: '#ffd2a0', intensity: 10, distance: 5 },
  { t: -2, kind: 'light', at: { a: 'e', o: [0, 1.5, -1.3] }, color: '#d0b0ff', intensity: 16, distance: 5 },
  { t: -2, kind: 'light', at: polar(CO, 40, 3.2, 1.9), color: '#ffa860', intensity: 34, distance: 7 },
  { t: -2, kind: 'light', at: polar(CO, 220, 3.5, 1.2), color: '#8a78c0', intensity: 6, distance: 7 },
];
/** The meadow round them: dry gold grass and dust over the flat green, the game's flat tufts gone. */
const CLASH_GROUND = [
  { t: -6, kind: 'dusk-hide', names: [...TUFTS, ...PROPS] },
  { ...DRY_FLOOR(CO, 11, 67), count: 40, height: [0.14, 0.5] },
  // Dust hanging low in the sun behind them.
  { t: -2, kind: 'dusk-plume', at: polar(CO, 45, 9, 0.2), rate: 1.2, life: 9, rise: 0.25, spread: 4, size0: 3, size1 : 8, prewarm: 9, opacity: 0.22, wind: [0.6, 0.3], color: '#c8885a', glow: '#ffb070', glowH: 2, glowK: 0.4, seed: 71 },
];
const clashA = {
  id: 'dusk-clash-a',
  ...span(C.clashA, C.clashB),
  chapter: 1,
  mood: 0,
  hide: [PORTAL],
  anchor: CO,
  view: CLASH_VIEW,
  actors: [{ id: 'o', spec: ORC, at: CO, yaw: deg(EB) }, { id: 'e', spec: ELF, at: CE0, yaw: deg(EB + 180) }],
  tracks: {
    o: { path: [{ t: 0, x: CO[0], z: CO[1], yaw: deg(EB) }], acts: [{ t: 0.5, clip: 'attack_swipe' }], faces: [{ t: -2, expr: 'angry' }] },
    e: {
      path: [
        { t: 0, x: CE0[0], z: CE0[1], yaw: deg(EB + 180) },
        { t: 0.38, x: flat(CO, EB, 3.9)[0], z: flat(CO, EB, 3.9)[1], yaw: deg(EB + 180) },
        { t: 0.66, x: flat(CO, EB, 2.8)[0], z: flat(CO, EB, 2.8)[1], yaw: deg(EB + 180), lift: 1.6 },
        { t: 0.92, x: CE1[0], z: CE1[1], yaw: deg(EB + 180), lift: 0.55 },
        { t: 1.54, x: CE2[0], z: CE2[1], yaw: deg(EB + 180), lift: 0 },
      ],
      acts: [{ t: 0.2, clip: 'jump', from: 0.7, speed: 0.9 }, { t: 0.86, clip: 'attack_swipe' }],
      faces: [{ t: -2, expr: 'focused' }, { t: 0.6, expr: 'angry' }],
    },
  },
  cam: {
    // Low in the grass, tracking round from his back toward the line between them and pushing in.
    keys: [
      { t: 0, p: polar(CO, 250, 3.3, 0.22), l: polar(CO, 70, 1.2, 1.0), fov: 40 },
      { t: 0.6, p: polar(CO, 236, 2.8, 0.24), l: polar(CO, 92, 1.0, 1.1), fov: 38 },
      { t: 1.54, p: polar(CO, 208, 2.3, 0.2), l: polar(CO, 110, 0.9, 0.95), fov: 36 },
    ],
    ease: 'linear',
    focus: 'o',
    range: 3,
    shake: 0.02,
  },
  fx: [
    MESAS,
    ...CLASH_GROUND,
    { t: 0.9, kind: 'vfx', recipe: 'sparks', args: [{ pt: HIT }, { color: '#ffd27a', k: 6 }, 70, 10, { life: 0.5 }] },
    { t: 0.9, kind: 'flash', d: 0.12, a: 0.35, color: '#fff2d8' },
    { t: 0.9, kind: 'light', at: HIT, color: '#ffd8a0', curve: [[0.88, 0], [0.92, 60], [1.15, 0]], distance: 6 },
    { t: 0.9, kind: 'shake', d: 0.3, amp: 0.05 },
    { t: 0.92, kind: 'vfx', recipe: 'smoke', args: [{ pt: { a: 'o', o: [0, 0.1, 0.7] } }, { color: '#b08866', k: 1 }, 10, 0.7, 0.6, 0.32, 0.9] },
    CLASH_MOTES,
    ...CLASH_LIGHTS,
    // 154.33 to 154.58: out of the white-green flash, through pink.
    { t: 0, kind: 'fade', color: '#f2ffe6', curve: [[0, 0.35], [0.12, 0.92], [0.25, 1], [0.32, 0.9], [0.36, 0], [1, 0]] },
    { t: 0, kind: 'fade', color: '#ffe0f0', curve: [[0.3, 0], [0.34, 0.92], [0.42, 0.7], [0.52, 0.25], [0.64, 0]] },
  ],
};

// 155.75: she whirls (155.75 to 156.25) and strikes (156.3); he is knocked back off his feet onto his
// shell (156.3 to 156.8), and tumbles over on the ground (157.0 to 157.2); pink-white at 157.36.
/** [t, d, pitch]: knocked back along his own back line, d units, tipping over backwards. */
const FALL = [[0, 0, 0], [0.55, 0, 0], [0.7, 0.35, 34], [0.86, 0.95, 96], [0.98, 1.2, 108], [1.12, 1.45, 150], [1.3, 1.8, 228], [1.46, 2.05, 300], [1.62, 2.2, 340], [1.96, 2.3, 352]];
const fallAt = (t) => {
  let i = 0;
  while (i < FALL.length - 2 && t > FALL[i + 1][0]) i++;
  const [ta, da, pa] = FALL[i];
  const [tb, db, pb] = FALL[i + 1];
  const k = Math.min(1, Math.max(0, (t - ta) / (tb - ta)));
  const s = k * k * (3 - 2 * k);
  return [da + (db - da) * s, pa + (pb - pa) * s];
};
/** Body centre above the feet: rolling about it, the feet go up as he goes over. */
const BODY_C = 0.42;
const clashB = {
  id: 'dusk-clash-b',
  ...span(C.clashB, C.white),
  chapter: 1,
  mood: 0,
  hide: [PORTAL],
  anchor: CO,
  view: CLASH_VIEW,
  actors: [{ id: 'o', spec: ORC, at: CO, yaw: deg(EB) }, { id: 'e', spec: ELF, at: CE2, yaw: deg(EB + 168) }],
  tracks: {
    o: {
      path: Array.from({ length: 50 }, (_, i) => {
        const t = +((1.96 * i) / 49).toFixed(4);
        const [d, p] = fallAt(t);
        const [x, z] = flat(CO, EB + 180, d);
        return { t, x: +x.toFixed(3), z: +z.toFixed(3), yaw: deg(EB), lift: +(BODY_C * (1 - Math.cos(deg(p)))).toFixed(3) };
      }),
      acts: [{ t: 0.05, clip: 'hit_react' }, { t: 0.52, clip: 'hit_react', speed: 1.4 }, { t: 0.7, clip: 'death', fade: 0.15 }],
      faces: [{ t: -2, expr: 'angry' }, { t: 0.56, expr: 'hurt' }, { t: 1.2, expr: 'dead' }],
    },
    e: {
      path: [{ t: 0, x: CE2[0], z: CE2[1], yaw: deg(EB + 168) }, { t: 0.55, x: flat(CO, EB - 6, 1.55)[0], z: flat(CO, EB - 6, 1.55)[1], yaw: deg(EB + 180) }],
      // The whirl: one turn of the spin, then the strike (its hit 0.28 s in, on 156.3).
      acts: [{ t: -0.05, clip: 'break_spin', from: 0.675, to: 1.3, speed: 1.2, fade: 0.08 }, { t: 0.27, clip: 'attack_swipe', fade: 0.06 }],
      faces: [{ t: -2, expr: 'angry' }],
    },
  },
  cam: {
    // Low under the elf, swinging round as she whirls, then tilting down after him as he goes over.
    keys: [
      // Back far enough that her whirling claws stay clear of the lens (closer, the blur smeared them across it).
      { t: 0, p: polar(CO, EB + 70, 3.7, 0.3), l: polar(CO, EB, 0.9, 0.9), fov: 34 },
      { t: 0.55, p: polar(CO, EB + 84, 3.5, 0.3), l: polar(CO, EB, 0.6, 0.8), fov: 34 },
      // Side on to his fall: the somersault in profile.
      { t: 1.1, p: polar(CO, EB + 96, 3.4, 0.32), l: { a: 'o', o: [0, 0.55, 0], y0: true }, fov: 37 },
      { t: 1.96, p: polar(CO, EB + 104, 3.5, 0.36), l: { a: 'o', o: [0, 0.4, 0], y0: true }, fov: 40 },
    ],
    ease: 'linear',
    focus: 'o',
    range: 3,
    shake: 0.02,
  },
  fx: [
    MESAS,
    ...CLASH_GROUND,
    { t: -6, kind: 'dusk-pose', actor: 'o', nocull: true, pitch: FALL.map(([t, , p]) => [t, p]) },
    { t: 0.1, kind: 'vfx', recipe: 'sparks', args: [{ pt: HIT }, { color: '#ffd27a', k: 5 }, 50, 8, { life: 0.45 }] },
    // 156.3: her strike lands.
    { t: 0.55, kind: 'vfx', recipe: 'sparks', args: [{ pt: { a: 'e', o: [0, 0.7, 0.9] } }, { color: '#ffb0e0', k: 7 }, 90, 12, { life: 0.5 }] },
    { t: 0.55, kind: 'flash', d: 0.1, a: 0.3, color: '#ffe8f4' },
    { t: 0.55, kind: 'light', at: { a: 'e', o: [0, 0.8, 0.9] }, color: '#ffc0e8', curve: [[0.53, 0], [0.57, 50], [0.8, 0]], distance: 6 },
    { t: 0.55, kind: 'shake', d: 0.35, amp: 0.06 },
    // He comes down on his shell (156.6) and again as he goes over (157.05): dust and grit.
    ...[0.86, 1.3].flatMap((t) => {
      const pt = { g: [...flat(CO, EB + 180, fallAt(t)[0] + 0.2)].flatMap((v, i) => (i === 0 ? [v, 0.1] : [v])) };
      return [
        { t, kind: 'vfx', recipe: 'smoke', args: [{ pt }, { color: '#b08866', k: 1 }, 14, 0.9, 0.7, 0.38, 1.0] },
        { t, kind: 'vfx', recipe: 'sparks', args: [{ pt }, { color: '#d8b080', k: 1.5 }, 30, 4, { life: 0.5 }] },
      ];
    }),
    { t: 0.86, kind: 'shake', d: 0.3, amp: 0.06 },
    // Warm bounce off the grass on his side and belly as he goes over.
    { t: -2, kind: 'light', at: polar(CO, EB + 120, 1.6, 0.7), color: '#ffb880', intensity: 14, distance: 4.5 },
    { t: 0.6, kind: 'light', at: { a: 'o', o: [0.9, 0.3, 0.7] }, color: '#ffc090', intensity: 18, distance: 3 },
    CLASH_MOTES,
    ...CLASH_LIGHTS,
    { t: 1.45, kind: 'leaves', color: '#ffc4e8', color2: '#ffffff', count: 500, box: [10, 6, 10], drift: [1.2, 0.6, 0.5], size: 0.07, fadeIn: 0.2 },
    // Pink-white on the burst (157.36), held into the snow scene's pink opening.
    { t: 0, kind: 'fade', color: '#ffe6f0', curve: [[1.5, 0], [1.56, 0.35], [1.61, 0.9], [1.65, 1], [1.96, 1]] },
  ],
};

export const shots = [meteor, rise, reveal, dive, smoke, orc, tower, giant, leap, clashA, clashB];
