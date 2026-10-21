// Scene 'dusk' of the tribute (see ../timeline.mjs for the song ranges it fills), all in Clawhaven:
// a fireball falls on the southern ridge at sunset and the tauren rises on the hill over the bay;
// the village burns and the orc roars in its street; a fireball strikes the lighthouse and the giant
// smashes it while a warrior leaps from its gallery; later, the orc and the night elf clash at sunset.
// The tauren lets dust go from his open claw; the wind carries it out over the bay, it heats into
// embers and the embers become the burning village.
// Effects named dusk-* live in src/capture/cinema/fx/ (dusk-fire, dusk-pose, dusk-arm, dusk-dust).
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
    // The white holds until 112.1 and clears off the blast.
    { t: 0, kind: 'fade', color: '#fff6ea', curve: [[0, 1], [0.6, 0.97], [0.95, 0.9], [1.1, 0.5], [1.25, 0.12], [1.4, 0]] },
    { t: 0.12, kind: 'dusk-fireball', from: [300, 150, 250], to: IMPACT, d: 0.9, size: 2.4, trail: 120, light: 2500, distance: 160 },
    { t: 1.02, kind: 'dusk-blast', at: IMPACT, r: 10, column: 8, light: 6000, distance: 180, flashA: 0.75, flashD: 0.35, flashColor: '#ffe2b0', shake: 0.1, puffs: 56, debris: 44 },
    { t: 1.02, kind: 'shake', d: 0.7, amp: 0.12 },
  ],
};

// He sits on the lip of the plateau facing the ridge, rises as the camera creeps in, and turns
// toward the bay and the sun. The camera stays back on the far side from the sun, so his whole
// shell rises as a silhouette against the sunset (his lantern is put away: the claw is for dust).
const EMPTY_CLAW = { t: -6, kind: 'dusk-arm', actor: 't', joints: {}, w: [[0, 0]], hide: ['clawR'] };
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
      // Still in his crouch, then up in one heave.
      acts: [{ t: -6, clip: 'sit' }, { t: 1.2, clip: 'idle', fade: 1.0 }],
      faces: [{ t: -2, expr: 'neutral' }, { t: 2.4, expr: 'focused' }],
    },
  },
  cam: {
    keys: [
      // Low in the grass behind him, the sun over his shell; rising with him as he stands.
      { t: 0, p: polar(T, 214, 6.2, 0.62), l: polar(T, 40, 1.5, 0.85), fov: 30 },
      { t: 1.2, p: polar(T, 216, 6.0, 0.66), l: polar(T, 40, 1.5, 0.9), fov: 30 },
      { t: 2.6, p: polar(T, 222, 5.4, 0.9), l: polar(T, 42, 2, 1.2), fov: 30 },
      { t: 4.5, p: polar(T, 232, 4.8, 1.15), l: polar(T, 46, 3, 1.3), fov: 31 },
    ],
    ease: 'sine',
    focus: 't',
    range: 3,
  },
  fx: [IMPACT_PLUME, MOTES(), EMPTY_CLAW],
};

// 119.5: his right claw comes up and out over the bay and opens; dust streams from it and the wind
// takes it toward the sun. The camera behind his right shoulder, looking past him into the sunset.
const TY = 66;
/** The wind's bearing: out over the bay, clear of the trees on the slope. */
const DUST_WIND = 68;
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
      rate: 3200,
      life: 4.8,
      wind: [Math.sin(deg(DUST_WIND)), 0.06, Math.cos(deg(DUST_WIND))],
      v0: 1.6,
      acc: 3.0,
      vel: [0, -0.35, 0],
      damp: 0.45,
      rise: 0.2,
      spread0: 0.03,
      spread1: 0.9,
      turb: 0.45,
      size0: 0.034,
      size1: 0.16,
      color: '#f0b878',
      color2: '#ffd9a0',
      hot: '#ff9a3c',
      hot2: '#ff4410',
      glow: 2.6,
      opacity: 0.85,
      // Dust in the sunset light, warm orange streaks over the bay, red sparks as it dives.
      heat: [[o, 0], [o + 1.8, 0.05], [o + 2.6, 0.3], [o + 3.5, 0.65], [o + 4.2, 1]],
      heatAge: 0.15,
      streak: [[o + 1.6, 0], [o + 2.6, 0.1], [o + 4.2, 0.18]],
      order: 1001,
    },
  ];
};
const BAY = 62;
const REVEAL_END = polar(T, TY - 132, 2.7, 1.35);
const REVEAL_END_LOOK = polar(T, DUST_WIND + 2, 10, 0.5);
const reveal = {
  id: 'dusk-reveal',
  ...span(C.reveal, C.dive),
  chapter: 1,
  mood: 0,
  hide: [PORTAL],
  view: { ...DUSK_VIEW, dof: true, bokeh: 2.5 },
  actors: [{ id: 't', spec: TAUREN, at: T, yaw: deg(55) }],
  tracks: { t: { path: [{ t: 0, x: T[0], z: T[1], yaw: deg(55) }, { t: 1.2, x: T[0], z: T[1], yaw: deg(TY) }], faces: [{ t: -2, expr: 'focused' }] } },
  cam: {
    keys: [
      { t: 0, p: polar(T, TY - 150, 3.4, 1.25), l: polar(T, TY, 6, 0.85), fov: 36 },
      { t: 2.0, p: polar(T, TY - 142, 3.0, 1.3), l: polar(T, DUST_WIND + 6, 8, 0.7), fov: 35 },
      { t: 3.5, p: REVEAL_END, l: REVEAL_END_LOOK, fov: 34 },
    ],
    ease: 'sine',
    focus: 't',
    range: 4,
  },
  fx: [IMPACT_PLUME, MOTES(), ...DUST(C.reveal)],
};

// 121.5: the camera slides past his shoulder and rides the wind with the dust out over the bay; the
// dust burns into orange streaks, and at 123.3 the camera dives into a red haze of sparks.
const S = (d, h) => polar(T, DUST_WIND + 2, d, h);
const dive = {
  id: 'dusk-dive',
  ...span(C.dive, C.smoke),
  chapter: 1,
  mood: 0,
  hide: [PORTAL],
  view: { ...DUSK_VIEW, bloom: { intensity: 1.5, threshold: 0.7, radius: 0.85 } },
  actors: [{ id: 't', spec: TAUREN, at: T, yaw: deg(TY) }],
  tracks: { t: { path: [{ t: 0, x: T[0], z: T[1], yaw: deg(TY) }], faces: [{ t: -2, expr: 'focused' }] } },
  cam: {
    keys: [
      { t: 0, p: REVEAL_END, l: REVEAL_END_LOOK, fov: 34 },
      { t: 0.5, p: polar(T, TY - 105, 2.0, 1.4), l: S(12, 0.9), fov: 36 },
      // Past the shoulder, out along the stream.
      { t: 1.3, p: S(3.5, 1.7), l: S(16, 1.0), fov: 42 },
      { t: 2.3, p: S(12, 2.4), l: S(28, 0.3), fov: 48 },
      // The dive.
      { t: 3.0, p: S(21, 3.2), l: S(25, -3.5), fov: 54 },
    ],
    ease: 'sine',
  },
  fx: [
    IMPACT_PLUME,
    MOTES(500, [24, 8, 24]),
    ...DUST(C.dive),
    { t: 1.0, kind: 'dusk-haze', alpha: [[1.3, 0], [2.0, 0.15], [2.5, 0.38], [3.0, 0.72]], cover: [[1.3, 0.35], [3, 0.78]], color: '#6a1608', color2: '#d4461a', color3: '#ffb070', back: 0.6, flow: [-0.25, 0.05] },
    { t: 2.2, kind: 'fade', color: '#c8401a', curve: [[2.3, 0], [3.0, 0.35]] },
  ],
};

// --------------------------------------------------------------------------------- 2. dusk-fire
/** [x, z] at shot second t along [t, x, z] waypoints, straight between them. */
const along = (way, t) => {
  let i = 0;
  while (i < way.length - 2 && t > way[i + 1][0]) i++;
  const [ta, xa, za] = way[i];
  const [tb, xb, zb] = way[i + 1];
  const k = Math.min(1, Math.max(0, (t - ta) / (tb - ta)));
  return [xa + (xb - xa) * k, za + (zb - za) * k];
};
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

// As the smoke thins the orc is a shape against the burning tavern, toprocking on the beat, and he
// breaks into the run that carries him into the next shot.
const SMOKE_WAY = [[0, -1.5, 30.4], [3.85, -1.5, 30.4], [4.25, -1.45, 28.9]];
const smoke = {
  id: 'dusk-smoke',
  ...span(C.smoke, C.orc),
  chapter: 1,
  mood: 1,
  anchor: [0, 26],
  view: NIGHT_FIRE_VIEW,
  fog: FIRE_FOG,
  actors: [{ id: 'o', spec: ORC, at: SMOKE_WAY[0].slice(1), yaw: Math.PI }],
  tracks: {
    o: {
      path: Array.from({ length: 86 }, (_, i) => {
        const t = +((4.25 * i) / 85).toFixed(4);
        const [x, z] = along(SMOKE_WAY, t);
        return { t, x: +x.toFixed(3), z: +z.toFixed(3), yaw: Math.PI };
      }),
      // The toprock from its first beat (clip 1.39), stopped after the right jab (3.07) so the run
      // takes over at 3.85.
      acts: [{ t: 2.1, clip: 'break_toprock', from: 1.39, to: 3.14 }],
      faces: [{ t: -2, expr: 'angry' }],
    },
  },
  cam: {
    keys: [
      { t: 0, p: { g: [1.5, 0.5, 15] }, l: { g: [-1.5, 3.2, 38] }, fov: 44 },
      { t: 2.3, p: { g: [1.23, 0.47, 16.35] }, l: { g: [-1.5, 3.0, 38] }, fov: 43 },
      // As the smoke thins the lens closes in on the shape toprocking in the street.
      { t: 4.25, p: { g: [1.0, 0.45, 17.5] }, l: { g: [-1.45, 0.8, 30] }, fov: 22 },
    ],
    ease: 'linear',
  },
  fx: [
    ...VILLAGE_FX(),
    { t: -6, kind: 'dusk-pose', actor: 'o', nocull: true },
    // First flames licking up close to the lens at the bottom of the frame.
    { t: 2.4, kind: 'dusk-fire', spots: [[-1.4, 18.6, 0.5], [2.2, 19.2, 0.45], [0.2, 19.6, 0.4], [3.6, 19.8, 0.5]], height: 2.2, seed: 41, smoke: 0, grow: [[2.4, 0], [3.4, 0.8], [4.25, 1.1]] },
    { t: -2, kind: 'dusk-haze', alpha: [[0, 1], [2.6, 1], [3.6, 0.75], [4.25, 0.55]], cover: [[0, 0.55], [2.6, 0.5], [4.25, 0.4]], back: 1, color: '#4a0d05', color2: '#b8300c', color3: '#ff7a24', flow: [-0.16, 0.04], scale: 1.5 },
    { t: -2, kind: 'embers', box: [16, 10, 16], count: 900, drift: [-1.6, 1.4, 0.2], size: 0.05, shift: [0, 0, 5] },
    // The dust's sparks fly on into the red from the dive, slow and drift.
    { t: -2.5, kind: 'dusk-dust', at: { g: [1.4, 1.6, 12.5] }, box: [12, 5, 4], until: 0.8, rate: 260, life: 2.4, wind: [-0.12, 0.1, 1], v0: 5, acc: -1.9, spread0: 0.2, spread1: 0.6, turb: 0.35, size0: 0.025, size1: 0.035, heat: [[0, 1]], streak: [[0, 0.06], [2, 0.03]], hot: '#ffa040', hot2: '#ff4a10', glow: 3.2, opacity: 0.9, pxMax: 0.015, fade: [[0, 1], [0.8, 0.6], [1.8, 0]], order: 1001 },
  ],
};

// The orc comes out of the smoke at a run, slashing as he comes, and fires every move he has on
// the soundtrack's hits: a 720 over the street (lands on 129.94), a back flip (lands on 130.78), a
// slam that cracks the cobbles (131.69), three turns of the spin through the sparks, then he tips
// up onto his claws in a freeze on the roar (134.07) and holds it while the fire rises in front of
// him until it fills the frame. Clip windows and events: src/motion/breakClips.ts, skills.ts.
const ORC_HIT = { leap: 1.69, flip: 2.53, slam: 3.44, freeze: 5.82 };
/** [t, x, z]: the run, the leap, settling, the lunge into the slam, then planted for the roar. */
const ORC_WAY = [[0, -1.45, 28.95], [0.95, -1.3, 27.4], [1.69, -1.1, 25.4], [1.95, -1.05, 25.1], [3.0, -1.05, 25.1], [3.44, -1.0, 24.1], [4.7, -1.0, 23.6], [8.25, -1.0, 23.6]];
/** Where he plants for the roar. */
const O1 = ORC_WAY[ORC_WAY.length - 1].slice(1);
/** Facing: the lens, then turned 1 radian to his left (screen right) during the spin. */
const ORC_TURN = 1.0;
const orcYaw = (t) => Math.PI + ORC_TURN * Math.min(1, Math.max(0, (t - 3.75) / 0.9));
/** A spot on the street where he stands at shot second t, h above the ground. */
const orcAt = (t, h = 0.1) => {
  const [x, z] = along(ORC_WAY, t);
  return { g: [x, h, z] };
};
const orc = {
  id: 'dusk-orc',
  ...span(C.orc, C.tower),
  chapter: 1,
  mood: 1,
  anchor: [0, 26],
  view: { ...NIGHT_FIRE_VIEW, dof: true, bokeh: 2.5 },
  fog: FIRE_FOG,
  actors: [{ id: 'o', spec: ORC, at: ORC_WAY[0].slice(1), yaw: Math.PI }],
  tracks: {
    o: {
      // Dense keys so the spline follows the straight runs between the waypoints. Under the spin he
      // comes round a further turn to his left, so the freeze shows its profile, three quarters on.
      path: Array.from({ length: 166 }, (_, i) => {
        const t = +((8.25 * i) / 165).toFixed(4);
        const [x, z] = along(ORC_WAY, t);
        return { t, x: +x.toFixed(3), z: +z.toFixed(3), yaw: +orcYaw(t).toFixed(4) };
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
        // The claw stand: two bounces, the lift, up on his claws at clip 3.065 on the roar, held.
        { t: ORC_HIT.freeze - (3.065 - 1.95), clip: 'break_clawstand', from: 1.95, to: 6.425, fade: 0.2 },
      ],
      faces: [{ t: -2, expr: 'angry' }],
    },
  },
  cam: {
    keys: [
      // Low in the street as he comes out of the smoke at a run.
      { t: 0, p: { g: [0.6, 0.34, 18.2] }, l: { a: 'o', o: [0, 0.7, 0], y0: true }, fov: 24 },
      { t: 0.95, p: { g: [0.5, 0.36, 18.5] }, l: { a: 'o', o: [0, 0.8, 0], y0: true }, fov: 30 },
      // Up with the 720 (its body rises about two units).
      { t: 1.35, p: { g: [0.45, 0.4, 18.7] }, l: { a: 'o', o: [0, 1.9, 0], y0: true }, fov: 34 },
      { t: 1.69, p: { g: [0.4, 0.42, 18.8] }, l: { a: 'o', o: [0, 1.1, 0], y0: true }, fov: 32 },
      { t: 2.6, p: { g: [0.3, 0.4, 19.0] }, l: { a: 'o', o: [0, 0.85, 0], y0: true }, fov: 31 },
      // A punch in on the slam.
      { t: 3.3, p: { g: [0.2, 0.38, 19.2] }, l: { a: 'o', o: [0, 0.7, 0], y0: true }, fov: 30 },
      { t: 3.55, p: { g: [0.1, 0.34, 19.6] }, l: { a: 'o', o: [0, 0.6, 0], y0: true }, fov: 25 },
      // Round to his right as he spins.
      { t: 4.7, p: { g: [-2.6, 0.5, 20.1] }, l: { a: 'o', o: [0, 0.7, 0], y0: true }, fov: 29 },
      // Back in front and low for the freeze, wide enough for him up on his claws.
      { t: 5.8, p: { g: [-1.4, 0.3, 19.5] }, l: { a: 'o', o: [0, 0.9, 0], y0: true }, fov: 32 },
      { t: 8.25, p: { g: [-1.2, 0.28, 19.9] }, l: { a: 'o', o: [0, 1.0, 0], y0: true }, fov: 30 },
    ],
    ease: 'linear',
    focus: 'o',
    range: 3,
  },
  fx: [
    ...VILLAGE_FX(),
    { t: -2, kind: 'light', at: { a: 'o', o: [1.5, 1.2, 1.5] }, color: '#ffc070', intensity: 10, distance: 7, flicker: 0.4 },
    { t: -2, kind: 'light', at: { a: 'o', o: [-1.6, 1.0, -1.0] }, color: '#ff5a18', intensity: 12, distance: 7, flicker: 0.5 },
    // A cold rim from the night sky behind him: the red crab stands off the red fire.
    { t: -2, kind: 'light', at: { a: 'o', o: [0.4, 2.2, -2.2] }, color: '#8fa8ff', intensity: 26, distance: 6 },
    // Big flames close on both sides of the street, framing him.
    { t: -6, kind: 'dusk-fire', spots: [[-3.8, 22.4, 1.7], [3.6, 23.2, 1.6], [-4.6, 27, 1.9], [4.4, 28.2, 1.8], [-3.2, 31.5, 1.6], [3.4, 32.5, 1.5]], height: 2.6, gain: 1.0, seed: 19, smoke: 0.7 },
    { t: -6, kind: 'dusk-pose', actor: 'o', nocull: true },
    // The 720 comes down: sparks and soot off the cobbles.
    { t: ORC_HIT.leap, kind: 'shake', d: 0.5, amp: 0.07 },
    { t: ORC_HIT.leap, kind: 'explode', at: orcAt(ORC_HIT.leap), scale: 0.3, color: '#ff8a2a', smoke: '#2a120a', flash: false },
    // The back flip comes down.
    { t: ORC_HIT.flip, kind: 'shake', d: 0.35, amp: 0.05 },
    { t: ORC_HIT.flip, kind: 'explode', at: orcAt(ORC_HIT.flip), scale: 0.2, color: '#ff8a2a', smoke: '#2a120a', flash: false },
    // The slam: the street cracks open glowing under his claws and the flames beside him leap up.
    { t: ORC_HIT.slam, kind: 'shake', d: 0.7, amp: 0.13 },
    { t: ORC_HIT.slam, kind: 'explode', at: orcAt(ORC_HIT.slam), scale: 0.28, color: '#ff7a1a', smoke: '#2a120a', flashColor: '#ff9a50', flashA: 0.08 },
    { t: ORC_HIT.slam, kind: 'cracks', at: along(ORC_WAY, ORC_HIT.slam), radius: 2.6, grow: 0.45, color: '#ff8a2a', gain: 3, until: 7.0, fadeOut: 1.5 },
    { t: ORC_HIT.slam, kind: 'dusk-fire', spots: [[O1[0] - 2.3, O1[1] + 0.8, 1.0], [O1[0] + 2.1, O1[1] + 1.1, 0.9], [O1[0] - 1.6, O1[1] + 2.4, 0.8], [O1[0] + 1.5, O1[1] + 2.6, 0.8]], height: 2.6, gain: 1.1, glow: 0.5, seed: 61, smoke: 0, grow: [[ORC_HIT.slam, 0], [ORC_HIT.slam + 0.15, 1.4], [ORC_HIT.slam + 0.9, 0.85]] },
    // The roar, held up on his claws.
    { t: ORC_HIT.freeze, kind: 'shake', d: 1.4, amp: 0.06 },
    // The wall of fire between the lens and him.
    { t: 6.9, kind: 'dusk-fire', spots: [[-2.2, 21.9, 1], [-0.9, 22.1, 1.1], [0.3, 22.0, 0.9], [-1.5, 21.7, 0.8], [-0.2, 21.6, 0.85], [-3.3, 22.2, 1], [1.4, 22.3, 1]], height: 3.0, gain: 1.15, glow: 0.6, seed: 77, smoke: 0, grow: [[6.9, 0], [7.4, 0.8], [7.7, 1.5], [8.25, 1.9]] },
    { t: 7.1, kind: 'dusk-haze', additive: true, alpha: [[7.2, 0], [7.5, 0.3], [7.8, 0.6]], cover: [[7.2, 0.35], [7.8, 0.7]], back: 0.3, color: '#3a0802', color2: '#ff6a14', color3: '#ffc860', flow: [0, 0.6], scale: 1.4 },
    // 135.58: the fire fills the frame and burns to white, white by 136.0.
    { t: 7.2, kind: 'fade', color: '#fff4e0', curve: [[7.3, 0], [7.45, 0.3], [7.6, 0.62], [7.8, 0.9], [8.0, 1], [8.25, 1]] },
  ],
};

// The lighthouse on its sea stack at (190, -132): gallery floor at 28.5 out to about 4.5 from the
// axis, the bridge from the headland on its west side, open sea round the rest. Sunset light (the
// sun at bearing 42) behind smoke, every camera on the sun side so the sky burns orange and violet.
// A fireball strikes it under the gallery; the giant climbs its east flank hand over hand, hauls
// itself over the gallery and smashes it while a warrior leaps from the rail at it.
const LH = [190, -132];
/** Quest props around the lighthouse that glow on their own. */
const LH_HIDE = ['Lighthouse keeper’s secret dance', 'Two-seat shore skiff'];
/** A world point at a bearing and distance from the lighthouse axis, y high. */
const LHP = (b, r, y) => { const [x, z] = flat(LH, b, r); return [x, y, z]; };
/** Where the fireball strikes: under the gallery, on the side facing the lens. */
const LH_HIT = LHP(160, 2.7, 24.5);
const TOWER_FOG = { color: '#5a2a1c', density: 0.006 };
const TOWER_VIEW = { exposure: 1.0, saturation: 0.32, contrast: 0.2, bloom: { intensity: 1.3, threshold: 0.75, radius: 0.85 }, vignette: { offset: 0.2, darkness: 0.7 } };
const TOWER_SKY = (t0) => [
  { t: t0, kind: 'dusk-hide', names: LH_HIDE },
  // Smoke from the burning town drifting across the sky behind the tower.
  { t: t0, kind: 'dusk-plume', at: { g: [214, 0, -96] }, rate: 1.4, life: 16, rise: 2.4, spread: 7, size0: 8, size1: 24, prewarm: 16, opacity: 0.6, wind: [2.5, 1.5], color: '#2a1a16', glow: '#c0441a', glowH: 8, seed: 8 },
  { t: t0, kind: 'dusk-plume', at: { g: [176, 0, -100] }, rate: 1.2, life: 16, rise: 2.2, spread: 6, size0: 7, size1: 20, prewarm: 16, opacity: 0.5, wind: [2.5, 1.5], color: '#241612', glow: '#a03a14', glowH: 6, seed: 9 },
  { t: t0, kind: 'embers', at: { g: [190, 14, -132] }, box: [30, 30, 30], count: 1400, drift: [1.2, 2.2, -0.4], size: 0.1 },
  { t: t0, kind: 'light', at: LHP(200, 12, 8), color: '#ff7a2a', intensity: 60, distance: 40, flicker: 0.2 },
  // Orange sunset light on the near face, violet left in the shadows.
  { t: t0, kind: 'dusk-grade', color: '#ffc49a' },
];
const TOWER_FIRE = (t0, k = 1) => [
  { t: t0, kind: 'dusk-fire', spots: [[160, 2.8, 24, 1.3], [140, 2.8, 25, 1.0], [180, 2.8, 23.6, 0.9], [155, 4.0, 28.6, 1.5], [125, 4.0, 28.6, 1.2], [190, 4.0, 28.6, 1.0]].map(([b, r, y, s]) => ({ at: LHP(b, r, y), s: s * k })), height: 2.8, seed: 31, smoke: 0.9, wind: [1.4, 0.8], fadeIn: 0.4 },
  { t: t0, kind: 'dusk-plume', at: LHP(155, 3, 29), rate: 3, life: 8, rise: 3, spread: 2, size0: 2.5, size1: 11, prewarm: 0, opacity: 0.75, wind: [2.2, 1.2], color: '#1e1412', glow: '#ff6a1a', glowH: 3, seed: 12 },
  { t: t0, kind: 'light', at: LHP(160, 6, 25), color: '#ff6a1a', intensity: 90, distance: 32, flicker: 0.35, fadeIn: 0.3 },
];

// The giant: scale 3.5 against a tower 6 across, clinging to the east flank (bearing GB) nose up,
// its legs on the wall. Path lift is above the stack top (3.5); the ground under r < 4.6 is the
// gallery, so it climbs at r 5.
const GB = 104;
const GR = 5.0;
const G = flat(LH, GB, GR);
const GIANT_YAW = deg(GB + 180);
const GIANT_ACTOR = { id: 'g', ...GIANT, at: G, yaw: GIANT_YAW };
/** Hand over hand: [t, lift] pulls, each a quick haul then a hold, a claw striking at each haul. */
const CLIMB = [[0.9, -17], [1.25, -13], [1.5, -13], [1.85, -9], [2.1, -9], [2.45, -5], [2.7, -5], [3.05, -1], [3.3, -1], [3.65, 3], [3.9, 3], [4.25, 7], [4.5, 7.6]];
const CLIMB_PATH = CLIMB.map(([t, lift]) => ({ t, x: G[0], z: G[1], yaw: GIANT_YAW, lift }));
const CLIMB_ACTS = CLIMB.filter((_, i) => i % 2 === 1 && i < CLIMB.length - 1).map(([t], i) => ({ t: t - 0.36, clip: i % 2 ? 'claw_right' : 'claw_left', speed: 1.4 }));
/** The giant's glow: a fel light on its chest and a hot one at its claws. */
const GIANT_GLOW = (t0) => [
  { t: t0, kind: 'light', at: { a: 'g', o: [0, 3, -2.5] }, color: '#b8e04a', intensity: 90, distance: 14, flicker: 0.25 },
  { t: t0, kind: 'light', at: { a: 'g', o: [0, 6, 2] }, color: '#ff8a2a', intensity: 30, distance: 12, flicker: 0.4 },
  // A cold rim from the sky so its shape reads off the burning sky.
  { t: t0, kind: 'light', at: { a: 'g', o: [0, 9, -6] }, color: '#9ab0ff', intensity: 70, distance: 18 },
];
const tower = {
  id: 'dusk-tower',
  ...span(C.tower, C.giant),
  chapter: 1,
  mood: 0,
  anchor: [192, -126],
  hide: LH_HIDE,
  view: TOWER_VIEW,
  fog: TOWER_FOG,
  actors: [GIANT_ACTOR],
  tracks: { g: { path: CLIMB_PATH, acts: CLIMB_ACTS } },
  cam: {
    keys: [
      { t: 0, p: LHP(190, 25, 2.2), l: LHP(130, 1, 16), fov: 52 },
      { t: 4.5, p: LHP(186, 22.5, 3.4), l: LHP(120, 2, 19.5), fov: 48 },
    ],
    ease: 'sine',
  },
  fx: [
    ...TOWER_SKY(-6),
    { t: -6, kind: 'dusk-pose', actor: 'g', pitch: [[0, 74]] },
    ...GIANT_GLOW(-6),
    // Out of the white burn: a short warm haze that clears off the tower.
    { t: 0, kind: 'fade', color: '#fff0dc', curve: [[0, 0.75], [0.12, 0.4], [0.28, 0]] },
    // 137.0: the fireball comes in from the upper left and strikes under the gallery.
    { t: 0.0, kind: 'dusk-fireball', from: [LH_HIT[0] + 26, LH_HIT[1] + 16, LH_HIT[2] + 4], to: LH_HIT, d: 0.5, size: 1.8, trail: 90, light: 1600, distance: 26, accel: 1.2 },
    { t: 0.5, kind: 'dusk-blast', at: LH_HIT, r: 4.2, column: 4, light: 2400, distance: 30, flashA: 0.12, flashD: 0.08, flashColor: '#ffb060', shake: 0.1, puffs: 56, debris: 50, gravity: 9.8 },
    ...TOWER_FIRE(0.52),
  ],
};

// 141.0: over the top. The giant hauls itself onto the gallery and slams it; the camera close
// under it on the sun side.
const giant = {
  id: 'dusk-giant',
  ...span(C.giant, C.leap),
  chapter: 1,
  mood: 0,
  anchor: [194, -128],
  hide: LH_HIDE,
  view: TOWER_VIEW,
  fog: TOWER_FOG,
  actors: [GIANT_ACTOR],
  tracks: { g: { path: [{ t: 0, x: G[0], z: G[1], yaw: GIANT_YAW, lift: 7.6 }, { t: 1, x: G[0], z: G[1], yaw: GIANT_YAW, lift: 9.2 }], acts: [{ t: -0.2, clip: 'attack_slam', speed: 0.9 }] } },
  cam: {
    keys: [
      { t: 0, p: LHP(174, 31, 14), l: LHP(112, 2, 25), fov: 46 },
      { t: 1, p: LHP(171, 30, 14.8), l: LHP(112, 2, 25.6), fov: 44 },
    ],
    ease: 'linear',
    shake: 0.04,
  },
  fx: [
    ...TOWER_SKY(-6),
    ...TOWER_FIRE(-6),
    ...GIANT_GLOW(-6),
    { t: -6, kind: 'dusk-pose', actor: 'g', pitch: [[0, 74], [1, 58]] },
    // The slam: the gallery bursts in a ball of fire off to the left.
    { t: 0.2, kind: 'dusk-blast', at: LHP(118, 4.2, 28.5), r: 5, column: 0, light: 3000, distance: 22, flashA: 0.1, flashD: 0.08, flashColor: '#ffb060', shake: 0.16, puffs: 60, debris: 50 },
    { t: 0.5, kind: 'dusk-blast', at: LHP(90, 4.0, 27), r: 3, column: 0, light: 1200, distance: 12, flash: false, shake: 0.06, puffs: 30, debris: 26, seed: 9 },
  ],
};

// A warrior on the gallery runs round its ring (3.7 from the axis, floor 28.5) through the flames
// and leaps at the giant over the rail; the camera low outside the rail on the sun side, the sky
// behind him.
const RING = (b) => flat(LH, b, 3.7);
const W0 = RING(205);
const LEAP = [[0, 205, 0], [0.3, 200, 0], [0.62, 188, 1.6], [0.95, 175, 2.5], [1.3, 162, 2.3], [1.62, 152, 1.4], [1.96, 144, 0.6]];
const leap = {
  id: 'dusk-leap',
  ...span(C.leap, C.black),
  chapter: 1,
  mood: 0,
  anchor: [194, -128],
  hide: LH_HIDE,
  view: { ...TOWER_VIEW, dof: true, bokeh: 2 },
  fog: TOWER_FOG,
  actors: [{ id: 'w', spec: ORC, at: W0, yaw: deg(205 - 90) }, GIANT_ACTOR],
  tracks: {
    w: {
      path: LEAP.map(([t, b, lift], i) => ({ t, x: RING(b)[0], z: RING(b)[1], lift, ...(i < 1 ? { yaw: deg(b - 90) } : {}) })),
      acts: [{ t: 0.15, clip: 'jump', from: 0.45, speed: 0.5 }],
      faces: [{ t: -2, expr: 'angry' }],
    },
    // Hauled up on the gallery, claws raised over it (its slam would sweep through the lens here).
    g: { path: [{ t: 0, x: G[0], z: G[1], yaw: GIANT_YAW, lift: 9.2 }, { t: 1.96, x: G[0], z: G[1], yaw: GIANT_YAW, lift: 9.8 }], acts: [{ t: -0.6, clip: 'claw_left', speed: 0.8 }] },
  },
  cam: {
    // From under the gallery's edge, looking up past the rail: he springs above it into the sky.
    // Fixed look points (a camera tied to the actor goes black on the frame his jump starts).
    keys: [
      { t: 0, p: LHP(216, 8.6, 28.6), l: LHP(203, 3.7, 29.6), fov: 36 },
      { t: 0.95, p: LHP(190, 8.3, 29.0), l: LHP(178, 3.7, 31.0), fov: 35 },
      { t: 1.96, p: LHP(180, 8.0, 29.2), l: LHP(152, 3.7, 30.4), fov: 38 },
    ],
    ease: 'linear',
    focus: 'w',
    range: 5,
  },
  fx: [
    ...TOWER_SKY(-6),
    ...TOWER_FIRE(-6, 0.8),
    ...GIANT_GLOW(-6),
    { t: -6, kind: 'dusk-pose', actor: 'g', pitch: [[0, 58], [1.96, 52]] },
    // Flames on the far side of the ring behind him, and low on the near rail he runs past.
    { t: -6, kind: 'dusk-fire', spots: [[250, 1.3], [280, 1.4], [320, 1.2], [20, 1.0], [70, 1.2]].map(([b, k]) => ({ at: LHP(b, 3.7, 28.6), s: k })), height: 2.6, seed: 51, smoke: 0.6, glow: 0.6 },
    { t: -6, kind: 'dusk-fire', spots: [{ at: LHP(222, 4.4, 28.4), s: 0.45 }, { at: LHP(168, 4.4, 28.4), s: 0.4 }], height: 2.0, seed: 52, smoke: 0, glow: 0.4 },
    { t: -6, kind: 'light', at: { a: 'w', o: [-1.2, 1.2, -1.5] }, color: '#ff7a2a', intensity: 12, distance: 6, flicker: 0.4 },
    // A cool rim from the sky so the red crab stands off the fire.
    { t: -6, kind: 'light', at: { a: 'w', o: [0.8, 2.0, -2.2] }, color: '#9ab0ff', intensity: 22, distance: 6 },
    { t: -6, kind: 'light', at: { a: 'w', o: [0, 1.2, 2.5] }, color: '#ffe0b0', intensity: 10, distance: 6 },
    { t: 0.9, kind: 'dusk-blast', at: LHP(300, 3.6, 29.2), r: 1.6, column: 0, light: 800, distance: 10, flash: false, puffs: 26, debris: 18, seed: 13 },
    // 143.6: the giant's blow bursts behind him in the sky and the frame goes white.
    { t: 1.55, kind: 'dusk-blast', at: LHP(128, 5, 33.5), r: 6, column: 0, light: 5000, distance: 30, flashA: 0.35, flashD: 0.1, flashColor: '#ffe0b0', shake: 0.12, puffs: 64, debris: 40, seed: 21 },
    { t: 1.5, kind: 'fade', color: '#fff4e2', curve: [[1.6, 0], [1.72, 0.3], [1.85, 0.72], [1.96, 0.96]] },
  ],
};

// -------------------------------------------------------------------------------- 3. dusk-clash
// On the grass above the beach, the sun low behind them (bearing 42): she comes in from his right
// and leaps at him, he swings; the camera sits low facing the sun so they cross the frame.
const CO = [99.5, 6.5];
const EB = 132;
const CE0 = flat(CO, EB, 4.4);
// Far enough apart that their claws meet between them and their bodies never overlap.
const CE1 = flat(CO, EB, 1.8);
const CE2 = flat(CO, EB - 8, 1.75);
const CLASH_VIEW = { exposure: 0.92, saturation: 0.28, contrast: 0.14, bloom: { intensity: 1.25, threshold: 0.78, radius: 0.8 }, vignette: { offset: 0.22, darkness: 0.7 }, dof: true, bokeh: 2.2 };
const CLASH_MOTES = { t: -5, kind: 'motes', color: '#ffd28a', color2: '#ffb36b', count: 300, box: [14, 6, 14], drift: [0.25, 0.12, 0.1], size: 0.04, opacity: 0.8 };
const HIT = { a: 'o', o: [0, 0.75, 0.85] };
/** Each crab lit off the sunset: a warm key on the orc, a violet rim on the elf. */
const CLASH_LIGHTS = [
  { t: -2, kind: 'light', at: { a: 'o', o: [0.6, 1.4, 1.6] }, color: '#ffd2a0', intensity: 10, distance: 5 },
  { t: -2, kind: 'light', at: { a: 'e', o: [0, 1.5, -1.3] }, color: '#d0b0ff', intensity: 16, distance: 5 },
];
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
        { t: 0.38, x: flat(CO, EB, 3.9)[0], z: flat(CO, EB, 3.9)[1], yaw: deg(EB + 180) },
        { t: 0.66, x: flat(CO, EB, 2.8)[0], z: flat(CO, EB, 2.8)[1], yaw: deg(EB + 180), lift: 1.6 },
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
    ...CLASH_LIGHTS,
    // 154.33 to 154.58: out of the white-green flash.
    { t: 0, kind: 'fade', color: '#f2ffe6', curve: [[0, 0.35], [0.12, 0.92], [0.25, 1], [0.37, 0.9], [0.5, 0.25], [0.62, 0]] },
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
      // Side on to the line between them: the orc on one side, the elf on the other.
      { t: 0, p: polar(CO, EB + 92, 3.4, 0.3), l: polar(CO, EB, 0.85, 0.6), fov: 36 },
      { t: 1.96, p: polar(CO, EB + 100, 3.0, 0.32), l: polar(CO, EB, 0.85, 0.66), fov: 35 },
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
    ...CLASH_LIGHTS,
    { t: 1.2, kind: 'leaves', color: '#ffc4e8', color2: '#ffffff', count: 500, box: [10, 6, 10], drift: [1.2, 0.6, 0.5], size: 0.07, fadeIn: 0.3 },
    // Pink-white by 157.33, held into the snow scene's pink opening.
    { t: 0, kind: 'fade', color: '#ffe6f0', curve: [[1.2, 0], [1.4, 0.45], [1.58, 0.95], [1.65, 1], [1.96, 1]] },
  ],
};

export const shots = [meteor, rise, reveal, dive, smoke, orc, tower, giant, leap, clashA, clashB];
