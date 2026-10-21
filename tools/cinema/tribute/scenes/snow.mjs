// Scene 'snow' of the tribute (see ../timeline.mjs for the song ranges it fills): Frostlight in a
// blizzard. The dwarf's face out of white, the city he turns to look at, his beast beside him, the two
// climbing the road to its gate; later the montage's charge through the storm, the human mage's frost among the arena's
// crystals and the tauren roaring in the snowy pines.
import { snowGround as ground } from '../../../../src/sim/world/snowGround.ts';
import { BEAST, DWARF, MAGE, TAUREN } from '../cast.mjs';

const PI = Math.PI;

// ------------------------------------------------------------------------------------- helpers

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

// The dwarf on the snow road's last slope below the city: its gate stands 40 units up the road, on the plateau
// where the Frozen Throne was (src/capture/cinema/fx/snow-city.ts raises it and clears the arena). He faces
// west into the storm, turns to his right toward the city, and the camera comes round behind his left
// shoulder (his sword is in the right claw) as the city shows through the snow. His beast walks up on his
// left; then the two climb the road to the gate.
const D = [10.5, -19.5]; // between the road's lamp posts, east of the road
const GATE = [0, -52];
const YAW1 = Math.atan2(GATE[0] - D[0], GATE[1] - D[1]); // toward the gate, up the road
const YAW0 = YAW1 + 1.35; // west, into the wind; he turns to his right
const F0 = frame(D[0], D[1], YAW0);
const F1 = frame(D[0], D[1], YAW1);
/** F1's frame with `up` measured from the ground under the point itself (the road climbs ahead). */
const F1g = (left, up, ahead) => {
  const p = F1(left, 0, ahead);
  return G(p[0], p[2], up);
};
/**
 * A look point `d` units from camera point p toward a far target: the same aim, but near enough that the
 * spline between it and a close look key does not swing wide.
 */
const toward = (p, target, d = 6) => {
  const v = target.map((t, i) => t - p[i]);
  const n = Math.hypot(...v);
  return p.map((q, i) => +(q + (v[i] * d) / n).toFixed(3));
};
/** The city's gate towers and keep, for the camera to look at. */
const GATE_LOOK = G(GATE[0], GATE[1], 13);
/** Low on the gate, so the two in the foreground stay in frame under the city. */
const GATE_LOW = G(GATE[0], GATE[1], 1.5);
const KEEP_LOOK = G(0, -95, 24);
const CITY = { t: -3, kind: 'snow-city', at: GATE, yaw: 0, clear: [-46, -120, 46, -50] };

// The beast comes up from behind on his left and stops 4.6 units off, a little ahead (at 2.1 times his size
// its legs reach about 1.7 out, so the two never touch).
const BEAST_FROM = F1(8.5, 0, -3.5);
const BEAST_NEAR = F1(6.9, 0, 0.4);
const BEAST_AT = F1(5.6, 0, 2.2);

const OPEN = 39.5;
const C_TRUDGE = 57.0;
const C_WIDE = 61.0;
const OPEN_END = 68.7;

// Both squared to the slope, a little sunk into the powder.
const cast2 = (dwarfAt, beastAt, yaw) => [
  { id: 'dwarf', spec: DWARF, at: dwarfAt, yaw, align: 0.8, sink: 0.03 },
  { id: 'beast', enemy: BEAST.enemy, scale: BEAST.scale, at: beastAt, yaw, align: 0.9, sink: 0.1 },
];
const HIDE = ['mira-ice-prison'];

const face = {
  anchor: D,
  hide: HIDE,
  view: { ...COLD, dof: true, bokeh: 2.2 },
  fog: { color: '#dde2ec', density: 0.017 },
  actors: cast2(D, [BEAST_FROM[0], BEAST_FROM[2]], YAW1),
  tracks: {
    dwarf: {
      path: [
        { t: 0, x: D[0], z: D[1], yaw: YAW0 },
        { t: 3.6, x: D[0], z: D[1], yaw: YAW0 + 0.1 },
        { t: 6.0, x: D[0], z: D[1], yaw: YAW1 },
        { t: 17.5, x: D[0], z: D[1], yaw: YAW1 },
      ],
      faces: [{ t: -2, expr: 'focused' }, { t: 2.6, expr: 'blink', hold: 0.16 }, { t: 2.8, expr: 'focused' }, { t: 8.8, expr: 'blink', hold: 0.16 }, { t: 9.0, expr: 'focused' }],
      acts: [{ t: 13.5, clip: 'claw_right' }],
    },
    beast: {
      path: [
        { t: 9.2, x: BEAST_FROM[0], z: BEAST_FROM[2] },
        { t: 12.2, x: BEAST_NEAR[0], z: BEAST_NEAR[2] },
        { t: 13.4, x: BEAST_AT[0], z: BEAST_AT[2], yaw: YAW1 },
      ],
      show: [[-5, false], [9.0, true]],
      faces: [{ t: -2, expr: 'neutral' }, { t: 13.4, expr: 'angry' }],
      // A growl with its claws up at 55.5 s, where the original's bear roars.
      acts: [{ t: 13.6, clip: 'attack_slam' }, { t: 16.0, clip: 'attack_slam', from: 1.235, to: 1.9, speed: 0.6 }],
    },
  },
  cam: {
    ...move([
      { t: 0, p: F0(0.3, 0.8, 2.6), l: F0(0, 0.6, 0), fov: 27 },
      { t: 3.6, p: F0(0.28, 0.78, 2.4), l: F0(0, 0.6, 0), fov: 27 },
      { t: 6.4, p: F1(2.4, 0.7, 1.9), l: F1(0, 0.72, 0.2), fov: 30 },
      { t: 8.8, p: F1(2.6, 0.75, 0.9), l: F1(0, 0.78, 0.4), fov: 31 },
      { t: 10.6, p: F1g(2.3, 0.75, -2.2), l: toward(F1g(2.3, 0.75, -2.2), GATE_LOOK), fov: 40 },
      { t: 12.4, p: F1g(2.5, 0.55, -4.6), l: toward(F1g(2.5, 0.55, -4.6), GATE_LOW), fov: 46 },
      { t: 17.5, p: F1g(2.3, 0.55, -4.0), l: toward(F1g(2.3, 0.55, -4.0), GATE_LOW), fov: 45 },
    ]),
    focus: 'dwarf',
    range: 2.5,
  },
  fx: [
    ...blizzard({ wind: [3.5, -2.2, 6] }),
    CITY,
    // Out of the white as late as the original, which is clear at 41.2 s.
    { t: 0, kind: 'fade', color: '#ffffff', curve: [[0, 1], [0.5, 0.85], [1.0, 0.55], [1.45, 0.2], [1.75, 0]] },
    { t: 13.9, kind: 'shake', d: 0.7, amp: 0.04 },
    { t: 16.05, kind: 'shake', d: 0.6, amp: 0.035 },
  ],
};

// Behind them, low, as they climb the road toward the gate through the storm.
const TR = { d0: F1(0, 0, 0.4), b0: F1(5.0, 0, 1.9) };
const trudge = {
  anchor: [D[0], D[1] - 3],
  hide: HIDE,
  view: { ...COLD, dof: true, bokeh: 1.2 },
  fog: { color: '#dde2ec', density: 0.013 },
  actors: cast2([TR.d0[0], TR.d0[2]], [TR.b0[0], TR.b0[2]], YAW1),
  tracks: {
    dwarf: { path: [{ t: 0, x: TR.d0[0], z: TR.d0[2] }, { t: 4, x: TR.d0[0] - 0.6, z: TR.d0[2] - 5.0 }], faces: [{ t: -2, expr: 'focused' }] },
    beast: { path: [{ t: 0, x: TR.b0[0], z: TR.b0[2] }, { t: 4, x: TR.b0[0] - 0.6, z: TR.b0[2] - 5.2 }], faces: [{ t: -2, expr: 'neutral' }] },
  },
  cam: {
    ...move([
      { t: 0, p: F1g(2.3, 0.6, -4.8), l: GATE_LOW, fov: 47 },
      { t: 4, p: F1g(2.1, 0.75, -2.2), l: GATE_LOW, fov: 46 },
    ]),
    focus: 'dwarf',
    range: 10,
  },
  fx: [...blizzard({ wind: [3, -2.2, 6.5], heavy: 1.1 }), CITY],
};

// Far down the road: two small figures climbing toward the gate in the whiteout, the city above them; a pine's
// edge slides in at the right before the white takes over.
const WD = { d0: F1(0, 0, 6.5), d1: F1(-0.3, 0, 14.0), b0: F1(4.2, 0, 7.3), b1: F1(3.9, 0, 14.8) };
const WC = [17, 17];
const wide = {
  anchor: [8, -10],
  hide: HIDE,
  // No vignette and little bloom: the shot ends on flat white with leaves drawn over it.
  view: { ...COLD, saturation: -0.3, vignette: null, bloom: { intensity: 0, threshold: 5 } },
  fog: { color: '#d6dbe7', density: 0.0075 },
  actors: cast2([WD.d0[0], WD.d0[2]], [WD.b0[0], WD.b0[2]], YAW1),
  tracks: {
    dwarf: { path: [{ t: 0, x: WD.d0[0], z: WD.d0[2] }, { t: 7.7, x: WD.d1[0], z: WD.d1[2] }] },
    beast: { path: [{ t: 0, x: WD.b0[0], z: WD.b0[2] }, { t: 7.7, x: WD.b1[0], z: WD.b1[2] }] },
  },
  cam: move([
    { t: 0, p: G(WC[0], WC[1], 5), l: [GATE[0] + 2, 23, GATE[1]], fov: 36 },
    { t: 7.7, p: G(WC[0] - 2.5, WC[1] - 4, 5.2), l: [GATE[0] + 1, 23.5, GATE[1]], fov: 34 },
  ]),
  fx: [
    ...blizzard({ wind: [3, -2.5, 7], heavy: 1.2, drift: 0.12, sky: '#cdd3e2', zenith: '#9aa3c2' }),
    CITY,
    { t: -3, kind: 'snow-pines', trees: [[WC[0] + 3.2, WC[1] - 6.5, 0.9], [WC[0] + 5.5, WC[1] - 12, 1.1]] },
    { t: 6.3, kind: 'snow-leaves', count: 200, box: [12, 7, 12], drift: [-2.5, -1.2, 3.5], size: 0.09, near: 1.4, color: '#a2482a', color2: '#c98a3c', fadeIn: 0.8 },
    { t: 6.6, kind: 'snow-whiteout', curve: [[6.6, 0], [7.0, 0.25], [7.35, 0.62], [7.6, 1], [7.7, 1]] },
  ],
};

// ---------------------------------------------------------------------- snow-charge 146.58-151.92

/** The arena's ice disc, its glow rings and the diamonds over the crystals: primitives in a close shot. */
const ARENA_OUT = { t: -3, kind: 'snow-hide', box: [-30, -110, 30, -46], max: 47 };
/** Mira's ice prison by the throne (the world shows it again every frame, so hide its bars). */
const PRISON_OUT = { t: -3, kind: 'snow-hide', box: [9, -66, 17, -58], max: 6 };


// The west edge of the world, between the crest over the sea ice and the west woods: open snow on the flat
// (the gun, the charge, the roar) and the long slope the north cliffs send down to it (the bounding run
// and the tauren). The beast runs south (+z) in both; the dwarf rides on its shell with his blunderbuss
// (src/capture/cinema/fx/snow-gun.ts, snow-beast.ts).

/** Path keys every frame from a motion t -> {x, z, lift}: the stage's spline through them is the motion. */
function sampled(fn, t0, t1, fps = 24) {
  const n = Math.round((t1 - t0) * fps);
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = t0 + ((t1 - t0) * i) / n;
    const a = fn(t);
    const b = fn(t + 0.02);
    return { t: +t.toFixed(4), x: +a.x.toFixed(3), z: +a.z.toFixed(3), lift: +(a.lift ?? 0).toFixed(3), yaw: +Math.atan2(b.x - a.x, b.z - a.z).toFixed(4) };
  });
}
/** Linear camera keys every frame from t -> {p, l, fov}. */
function shotCam(fn, t0, t1, fps = 24) {
  const n = Math.round((t1 - t0) * fps);
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = t0 + ((t1 - t0) * i) / n;
    const c = fn(t);
    return { t: +t.toFixed(4), p: r3(c.p), l: r3(c.l), fov: c.fov ?? 40 };
  });
}
const sm = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** The dwarf on the beast's shell, the claw that holds the gun forward, the gun. */
const RIDE = { t: -3, kind: 'snow-ride', actor: 'dwarf', mount: 'beast', seat: [0, -0.12, -0.15] };
const AIM_ARM = { t: -3, kind: 'dusk-arm', actor: 'dwarf', joints: { RF_J0_joint: -0.3, RF_J1_joint: -0.9, RF_J2_joint: -0.4 }, w: [[0, 1]] };
/** Raised over the beast's head as they charge. */
const GUN_UP = { a: 'beast', o: [0.6, 9, 7] };
const gun = (extra) => ({ t: -3, kind: 'snow-gun', actor: 'dwarf', size: 0.9, grip: [0, 0, 0.1], hide: ['clawR', 'clawL'], ...extra });
/** Both claws high and wide, pincers open. */
const ROAR = { LF_J0_joint: 0.6, RF_J0_joint: -0.5, LF_J1_joint: -1.4, RF_J1_joint: -1.4, LF_J2_joint: 0.8, RF_J2_joint: -0.8, LF_J4_joint: -1.0, RF_J4_joint: 1.0 };
/** The left claw slashing across in front of it. */
const SWIPE = { LF_J0_joint: -1.1, LF_J1_joint: -0.5, LF_J2_joint: 0.2, LF_J4_joint: -0.8 };
const riders = (dwarfAt, beastAt) => [
  { id: 'beast', enemy: BEAST.enemy, scale: BEAST.scale, at: beastAt, yaw: 0, align: 0.8, sink: 0.05 },
  { id: 'dwarf', spec: DWARF, at: dwarfAt, yaw: 0 },
];
const DWARF_TRACK = { acts: [{ t: -3, clip: 'idle', loop: true }], faces: [{ t: -2, expr: 'angry' }] };

// snow-charge-beast (146.58-149.5): the gun in the lens, the shot, the charge, the roar, the lunge over the lens.
const AX = -104;
const AZ0 = 2.81;
/** The beast's run on the flat: 7.5 a second, a stop to rear and roar at z 12, then the lunge. */
function runA(t) {
  let z;
  if (t <= 1.0) z = AZ0 + 7.5 * t;
  else if (t <= 1.45) z = AZ0 + 7.5 + 7.5 * (t - 1) - (7.5 / 0.9) * (t - 1) ** 2;
  else if (t <= 2.02) z = 12 + 0.3 * ((t - 1.45) / 0.57);
  else z = 12.3 + 11.5 * ((t - 2.02) / 0.9) ** 2;
  return { x: AX, z };
}
const FA = frame(AX, 12, 0);
const chargeCam = move([
  { t: 0.32, p: FA(1.7, 1.5, 0.4), l: FA(0, 1.9, -6.5), fov: 40 },
  { t: 1.12, p: FA(1.95, 1.2, 4.9), l: FA(0, 2.0, -1.2), fov: 40 },
  { t: 1.45, p: FA(1.75, 1.4, 4.2), l: FA(0, 2.4, 0.3), fov: 42 },
  { t: 2.02, p: FA(1.55, 1.3, 3.7), l: FA(0, 2.3, 0.6), fov: 42 },
  { t: 2.4, p: FA(2.0, 1.0, 4.6), l: FA(0.3, 1.7, 2.6), fov: 44 },
  { t: 2.7, p: FA(2.2, 0.95, 4.6), l: FA(-0.4, 1.4, 6.0), fov: 46 },
  { t: 2.92, p: FA(2.2, 0.95, 4.6), l: FA(-1.5, 1.3, 9.0), fov: 46 },
]);
const charge = {
  anchor: [AX, 10],
  view: { ...COLD, dof: true, bokeh: 2 },
  fog: { color: '#cdd6e2', density: 0.028 },
  actors: riders([AX + 3, 0], [AX, AZ0 - 12]),
  tracks: {
    beast: { path: sampled(runA, -1.6, 2.92), faces: [{ t: -2, expr: 'angry' }] },
    dwarf: DWARF_TRACK,
  },
  cam: {
    keys: [
      // 146.58: the bell of the gun straight into the lens, the dwarf behind it.
      { t: 0, p: { a: 'beast', o: [-0.2, 2.8, 2.45] }, l: { a: 'beast', o: [-0.25, 2.68, 0.5] }, fov: 40 },
      { t: 0.3, p: { a: 'beast', o: [-0.19, 2.79, 2.4] }, l: { a: 'beast', o: [-0.25, 2.68, 0.5] }, fov: 40 },
      // Cut under the white at 146.91 to the two charging at the lens.
      ...chargeCam.keys,
    ],
    ease: 'linear',
    spline: false,
    focus: 'look',
    range: 3,
  },
  fx: [
    ...blizzard({ wind: [6, -2, 4], heavy: 1.3 }),
    { t: -3, kind: 'snow-rear', actor: 'beast', pitch: [[1.0, 0], [1.42, 18], [2.02, 22], [2.14, 6], [2.35, -8], [2.92, -4]], pivot: 1.4 },
    RIDE,
    AIM_ARM,
    // 146.73 the shot: the glare floods the lens by the boom at 146.91 and clears by 147.05.
    gun({ aim: [[-3, 'camera'], [0.31, GUN_UP]], fire: 0.15, kick: 0.2, shake: 0.14, flash: [[0.15, 0], [0.19, 0.35], [0.23, 0.72], [0.27, 0.95], [0.29, 1], [0.335, 1], [0.36, 0.6], [0.39, 0.3], [0.43, 0.1], [0.47, 0]] }),
    { t: 0.32, kind: 'wash', color: '#d8dde6', color2: '#f6f3ee', alpha: [[0.32, 0.4], [0.45, 0.15], [0.62, 0]], cover: [[0.32, 0.6], [0.62, 0.3]], flow: [0.4, 0.1], scale: 1.8 },
    { t: -1.6, kind: 'snow-kick', actor: 'beast', until: 1.4, rate: 16, size: 0.5 },
    // 147.7 it rears: claws up and wide, snow shaken off its shell; 148.0-148.6 the roar.
    { t: -3, kind: 'dusk-arm', actor: 'beast', joints: ROAR, w: [[1.0, 0], [1.38, 1], [2.04, 1], [2.14, 0]] },
    { t: -3, kind: 'dusk-arm', actor: 'beast', joints: SWIPE, w: [[2.04, 0], [2.14, 1], [2.32, 1], [2.5, 0]] },
    { t: 1.18, kind: 'snow-powder', at: { a: 'beast', o: [0, 2.3, -0.3] }, count: 50, flakes: 90, spread: 2.6, rise: 2.2, size: 0.8, life: 1.3 },
    { t: 1.42, kind: 'snow-powder', at: { a: 'beast', o: [0, 2.6, 0.3] }, count: 30, flakes: 60, spread: 2.2, rise: 1.6, size: 0.6, life: 1.1 },
    { t: -3, kind: 'snow-eyes', actor: 'beast', k: [[1.1, 1], [1.42, 3.8], [2.02, 3.8], [2.4, 1.6]] },
    { t: 1.42, kind: 'snow-breath', actor: 'beast', until: 2.02, rate: 110, speed: 5.5, size: 0.7, life: 0.9 },
    { t: 1.42, kind: 'shake', d: 0.6, amp: 0.05 },
    { t: 1.75, kind: 'shake', d: 0.3, amp: 0.03 },
    { t: 2.1, kind: 'shake', d: 0.8, amp: 0.08 },
    { t: 2.3, kind: 'snow-kick', actor: 'beast', until: 2.92, rate: 30, size: 0.7 },
  ],
};

// snow-cock (146.0-146.58, a trial in the black before the gun): in the dark the dwarf, riding, cocks his
// blunderbuss on the two clicks (146.02, 146.17), a glint off the lock each time, his eyes lighting up on the
// second. Not in `shots` (the timeline keeps this span black); tools render it on its own for comparison.
const COCK = 0.58; // its end is the charge shot's start
export const snowCock = {
  id: 'snow-cock',
  at: 146.0,
  length: COCK,
  chapter: 4,
  anchor: [AX, 0],
  view: { ...COLD, exposure: 0.32, bloom: { intensity: 1.4, threshold: 0.55 }, vignette: { offset: 0.15, darkness: 0.9 }, dof: true, bokeh: 2.5 },
  fog: { color: '#3a4152', density: 0.04 },
  actors: riders([AX + 3, 0], [AX, AZ0 - 12]),
  tracks: {
    beast: { path: sampled((t) => runA(t - COCK), -1.6, COCK), faces: [{ t: -2, expr: 'angry' }] },
    dwarf: { acts: DWARF_TRACK.acts, faces: [{ t: -2, expr: 'focused' }, { t: 0.17, expr: 'angry' }] },
  },
  cam: {
    keys: [
      { t: 0, p: { a: 'beast', o: [-1.35, 2.85, 1.95] }, l: { a: 'beast', o: [-0.3, 2.8, 0.7] }, fov: 32 },
      { t: COCK, p: { a: 'beast', o: [-1.15, 2.83, 2.0] }, l: { a: 'beast', o: [-0.28, 2.8, 0.7] }, fov: 30 },
    ],
    ease: 'linear',
    focus: 'look',
    range: 1.5,
  },
  fx: [
    ...blizzard({ wind: [6, -2, 4], heavy: 1.3, sun: 0.25, hemi: 0.7 }),
    RIDE,
    AIM_ARM,
    gun({ aim: [[-3, { a: 'beast', o: [-0.7, 9, 1.6] }]], clicks: [0.02, 0.17] }),
    { t: -3, kind: 'snow-eyes', actor: 'dwarf', k: [[0.17, 0.25], [0.2, 2.6], [COCK, 1.6]] },
    { t: 0.02, kind: 'light', at: { a: 'beast', o: [-0.6, 2.75, 1.0] }, color: '#ffd9a0', curve: [[0.02, 0], [0.03, 6], [0.09, 0], [0.17, 0], [0.18, 7], [0.26, 0]], distance: 3 },
    // Out of the black: the picture only just there.
    { t: 0, kind: 'fade', color: '#000000', curve: [[0, 1], [0.06, 0.6], [0.3, 0.35], [COCK, 0.25]] },
  ],
};

// snow-charge-dwarf (149.5-151.92): down the slope in bounds, the tauren ahead, the crash at 151.55, white.
const BX = -102;
const T = [-105.4, -5.0];
const HIT = 2.05;
/** Bounding down the slope at 9 a second, veering onto the tauren; a last leap lands on him at HIT. */
function runB(t) {
  const x = BX - 2.2 * sm((t - 0.9) / 1.15);
  const z = t <= HIT ? -7.7 - 9 * (HIT - t) : -7.7 + 1.6 * (1 - Math.exp(-(t - HIT) * 6));
  let lift = 0;
  if (t < 1.7) lift = 0.5 * Math.abs(Math.sin((Math.PI * (t - 1.7)) / 0.5));
  else if (t < HIT) lift = 0.9 * Math.sin((Math.PI * (t - 1.7)) / (HIT - 1.7));
  return { x, z, lift };
}
const camB = (t) => {
  // Low behind the beast's right; it holds just before the crash so the slam plays in frame.
  const b = runB(Math.min(t, 2.02));
  const back = 4.4 - 1.1 * sm((t - 1.1) / 0.9);
  return { p: G(b.x - 3.1 - 0.5 * sm((t - 1.1) / 0.9), b.z - back, 1.5), l: G(b.x - 2.0, b.z + 8, 1.5), fov: 44 - 4 * sm((t - 1.1) / 0.9) };
};
const chargeDwarf = {
  anchor: [BX, -14],
  view: { ...COLD, dof: true, bokeh: 1.6 },
  fog: { color: '#cdd6e2', density: 0.022 },
  actors: [...riders([BX + 3, -30], [BX, -40]), { id: 'tauren', spec: TAUREN, scale: 2.1, at: T, yaw: PI, align: 0.5 }],
  tracks: {
    beast: { path: sampled(runB, -1.6, 2.42), faces: [{ t: -2, expr: 'angry' }] },
    dwarf: DWARF_TRACK,
    tauren: {
      path: [
        { t: -2, x: T[0], z: T[1], yaw: PI },
        { t: HIT, x: T[0], z: T[1], yaw: PI },
        { t: HIT + 0.18, x: T[0] - 0.8, z: T[1] + 2.6, yaw: PI + 0.35, lift: 1.1 },
        { t: 2.42, x: T[0] - 1.3, z: T[1] + 4.4, yaw: PI + 0.55, lift: 0.6 },
      ],
      acts: [{ t: 0.9, clip: 'attack_slam', from: 1.235, to: 1.9, speed: 0.6 }, { t: HIT, clip: 'hit_react' }],
      faces: [{ t: -2, expr: 'angry' }, { t: HIT, expr: 'hurt' }],
    },
  },
  cam: { keys: shotCam(camB, 0, 2.42), ease: 'linear', spline: false, focus: 'beast', range: 8 },
  fx: [
    ...blizzard({ wind: [6, -2, 4], heavy: 1.3 }),
    { t: -3, kind: 'snow-rear', actor: 'beast', pitch: [[1.6, 0], [1.75, 12], [1.95, 0], [HIT, -12], [2.25, -4]], pivot: 1.4 },
    RIDE,
    AIM_ARM,
    gun({ aim: [[-3, GUN_UP]] }),
    { t: -1.6, kind: 'snow-kick', actor: 'beast', until: 2.4, rate: 22, size: 0.6 },
    ...[0.2, 0.7, 1.2, 1.7].map((t) => ({ t, kind: 'snow-powder', at: { a: 'beast', o: [0, 0.1, 0.8] }, count: 14, flakes: 24, spread: 2.2, rise: 1.6, size: 0.7, life: 0.9 })),
    { t: -3, kind: 'dusk-arm', actor: 'beast', joints: { LF_J1_joint: -0.9, RF_J1_joint: -0.9, LF_J4_joint: -0.9, RF_J4_joint: 0.9 }, w: [[1.6, 0], [1.85, 1], [2.2, 1], [2.42, 0.4]] },
    { t: -3, kind: 'snow-eyes', actor: 'beast', k: [[1.5, 1.2], [1.9, 3], [2.42, 2]] },
    // 151.55 the crash: powder bursts off the two of them, the tauren thrown back, the lens shaken.
    { t: HIT, kind: 'snow-powder', at: G(T[0] + 0.5, T[1] - 0.9, 1.0), count: 170, flakes: 240, spread: 5, rise: 3.4, size: 1.4, life: 1.4 },
    { t: HIT + 0.05, kind: 'snow-powder', at: G(T[0] - 0.4, T[1] + 1.0, 0.2), count: 60, flakes: 80, spread: 3.5, rise: 2, size: 0.9, life: 1.2 },
    { t: -3, kind: 'dusk-pose', actor: 'tauren', pitch: [[HIT, 0], [HIT + 0.15, 22], [2.42, 38]] },
    { t: HIT, kind: 'shake', d: 0.5, amp: 0.2 },
    // 151.8 white into the green explosion.
    { t: 0, kind: 'fade', color: '#ffffff', curve: [[2.2, 0], [2.29, 0.45], [2.34, 0.85], [2.38, 1], [2.42, 1]] },
  ],
};

// ----------------------------------------------------------------------- snow-frost 157.71-163.08

// Among the Frozen Throne's crystals: the mage sweeps his staff and throws frost along the ground.
const MG = [27.4, -84.2];
const MYAW = 1.0;
const MF = frame(MG[0], MG[1], MYAW);
const frostCast = {
  anchor: MG,
  view: { ...COLD, saturation: -0.05, bloom: { intensity: 1.1, threshold: 0.85 }, dof: true, bokeh: 2.5 },
  fog: { color: '#7d88b0', density: 0.02 },
  actors: [{ id: 'mage', spec: MAGE, at: MG, yaw: MYAW }],
  tracks: { mage: { acts: [{ t: 0.3, clip: 'attack_swipe' }, { t: 1.2, clip: 'cast', loop: true }], faces: [{ t: -2, expr: 'focused' }, { t: 0.3, expr: 'angry' }] } },
  cam: move([
    { t: 0, p: MF(1.9, 0.32, 2.9), l: MF(0, 0.9, 0.3), fov: 40 },
    { t: 2.71, p: MF(1.4, 0.4, 2.3), l: MF(0, 0.95, 0.3), fov: 40 },
  ]),
  fx: [
    ...blizzard({ wind: [-2, -1.5, 6], sky: '#8c97bd', zenith: '#3d4772', sun: 0.35, hemi: 1.0, tint: [0.84, 0.92, 1.15] }),
    ARENA_OUT,
    { t: 0, kind: 'fade', color: '#ffe6f0', curve: [[0, 1], [0.59, 0]] },
    { t: 0.5, kind: 'vfx', recipe: 'frostSpray', args: [{ pt: { a: 'mage', o: [0, 0.4, 0.4] } }, MYAW + 0.35, 5, 0.7] },
    { t: 0.55, kind: 'snow-shards', from: MF(0.3, 0, 0.8).filter((_, i) => i !== 1), yaw: MYAW + 0.35, length: 7.5, count: 18, spread: 1.5, height: 1.7, grow: 0.55 },
    { t: 1.5, kind: 'vfx', recipe: 'frostSpray', args: [{ pt: { a: 'mage', o: [0, 0.4, 0.4] } }, MYAW, 5, 0.6] },
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
      { t: 0, p: G(20.7, -79.3, 0.25), l: G(23.4, -78.15, 1.45), fov: 42 },
      { t: 0.91, p: G(20.85, -79.25, 0.3), l: G(23.4, -78.15, 1.75), fov: 42 },
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
    { t: 0, p: G(20.6, -79.35, 0.22), l: G(23.4, -78.15, 1.9), fov: 50 },
    { t: 0.71, p: G(20.4, -79.4, 0.3), l: G(23.9, -78.1, 3.7), fov: 52 },
  ]),
  fx: [...frostPillar.fx, { t: 0, kind: 'flash', color: '#f4f0ff', d: 0.3, a: 0.5 }, { t: 0.68, kind: 'flash', color: '#f6f8ff', rise: 0.22, d: 0.05, a: 0.95 }],
};
// The tauren roaring among the east woods' pines.
const TA = [76, -6];
const tauren = {
  anchor: TA,
  hide: ['mira-ice-prison'],
  view: { ...COLD, dof: true, bokeh: 1.5 },
  fog: { color: '#cfd7e2', density: 0.028 },
  actors: [{ id: 'tauren', spec: TAUREN, at: TA, yaw: -PI / 2 - 0.25 }],
  // Roars, then lunges at the lens (162.9 s) and fills it before the logo.
  tracks: {
    tauren: {
      path: [{ t: 0.75, x: TA[0], z: TA[1], yaw: -PI / 2 - 0.25 }, { t: 1.04, x: TA[0] - 1.0, z: TA[1] + 0.25, yaw: -PI / 2 - 0.25 }],
      acts: [{ t: 0.05, clip: 'attack_slam', from: 1.235, to: 1.9, speed: 0.6 }],
      faces: [{ t: -2, expr: 'angry' }],
    },
  },
  cam: {
    ...move([
      { t: 0, p: G(TA[0] - 3.6, TA[1] + 1.0, 0.45), l: G(TA[0], TA[1], 1.25), fov: 40 },
      { t: 0.8, p: G(TA[0] - 3.4, TA[1] + 0.97, 0.5), l: G(TA[0], TA[1], 1.33), fov: 40 },
      { t: 1.04, p: G(TA[0] - 2.0, TA[1] + 0.6, 0.7), l: G(TA[0] - 1.0, TA[1] + 0.25, 1.0), fov: 52 },
    ]),
    focus: 'tauren',
    range: 4,
  },
  fx: [
    ...blizzard({ wind: [3, -2.5, 6] }),
    { t: -3, kind: 'snow-pines', trees: [[80.5, -3.0, 1.05], [81.0, -9.5, 0.9], [79.0, 2.5, 1.0], [84.0, -1.0, 1.2]] },
    { t: 0.35, kind: 'shake', d: 0.6, amp: 0.03 },
    // The original holds the white to 162.33 s.
    { t: 0, kind: 'fade', color: '#f6f8ff', curve: [[0, 1], [0.13, 1], [0.3, 0]] },
    { t: 0.85, kind: 'shake', d: 0.2, amp: 0.05 },
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
