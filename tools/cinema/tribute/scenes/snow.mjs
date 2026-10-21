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

/** The road's lamp posts. */
const ROAD_OUT = { t: -3, kind: 'snow-hide', box: [-8, -56, 8, 86], max: 4 };
/** The arena's ice disc, its glow rings and the diamonds over the crystals: primitives in a close shot. */
const ARENA_OUT = { t: -3, kind: 'snow-hide', box: [-30, -110, 30, -46], max: 47 };
/** Mira's ice prison by the throne (the world shows it again every frame, so hide its bars). */
const PRISON_OUT = { t: -3, kind: 'snow-hide', box: [9, -66, 17, -58], max: 6 };


// The west woods, south of the rock outcrop: pines behind, open snow falling away in front.
const CH = [-30, 8];
const charge = {
  anchor: [-38, 8],
  view: { ...COLD, dof: true, bokeh: 2 },
  fog: { color: '#cdd6e2', density: 0.03 },
  actors: cast2([-58, 11], [-56, 6.5], PI / 2),
  tracks: {
    // Past the lens on its right, 4 units off, not through it.
    beast: { path: [{ t: 0, x: -39.5, z: 3.6 }, { t: 2.92, x: -27.5, z: 3.8 }], faces: [{ t: -2, expr: 'angry' }] },
    dwarf: { path: [{ t: 0, x: -58, z: 10 }, { t: 2.92, x: -42, z: 9.5 }], faces: [{ t: -2, expr: 'angry' }] },
  },
  cam: { keys: [{ t: 0, p: G(CH[0], CH[1], 0.45), l: G(-44, 6.6, 1.3), fov: 48 }, { t: 2.92, p: G(CH[0] + 0.25, CH[1] + 0.15, 0.4), l: G(-44, 6.4, 1.2), fov: 48 }], ease: 'linear' },
  fx: [
    ...blizzard({ wind: [6, -2, 4], heavy: 1.3 }),
    ROAD_OUT,
    // The shot the original opens on (146.6 s): a muzzle flash from the dwarf off frame left.
    { t: 0.02, kind: 'explode', at: G(-35.5, 10.6, 1.0), scale: 0.3, color: '#ffcf6a' },
    { t: 2.2, kind: 'shake', d: 0.8, amp: 0.06 },
  ],
};
const chargeDwarf = {
  anchor: [-40, 9],
  view: { ...COLD, dof: true, bokeh: 2 },
  fog: { color: '#cdd6e2', density: 0.03 },
  actors: cast2([-50, 10.5], [-34, 7], PI / 2),
  tracks: {
    beast: { path: [{ t: 0, x: -34, z: 6.4 }, { t: 2.42, x: -16, z: 5.5 }], faces: [{ t: -2, expr: 'angry' }] },
    dwarf: { path: [{ t: 0, x: -45.5, z: 10.2 }, { t: 2.42, x: -33, z: 8.1 }], faces: [{ t: -2, expr: 'angry' }], acts: [{ t: -0.3, clip: 'claw_right', upper: true }] },
  },
  // Far enough back that the dwarf runs past 4.5 units off instead of filling the lens.
  cam: { keys: [{ t: 0, p: G(-37.5, 4.2, 0.5), l: { a: 'dwarf', o: [0, 0.6, 0] }, fov: 44 }, { t: 2.42, p: G(-37.3, 4.0, 0.5), l: { a: 'dwarf', o: [0, 0.6, 0] }, fov: 44 }], ease: 'linear' },
  fx: [...blizzard({ wind: [6, -2, 4], heavy: 1.3 }), ROAD_OUT],
};

// ----------------------------------------------------------------------- snow-frost 157.71-163.08

// At the arena's north rim, before Boreas's throne and the glacial citadel (src/game/frostThroneLayout.ts):
// the mage stands on the line from a low lens to the keep (0, -128), so the throne's crown of ice, the
// frozen gate, the ice-crowned towers and the keep's great ice spire rise behind him, and the arena's bare
// crystal pillars (x +-12.5, z -99.65) stay out of frame. A frost blast rolls over the snow into the lens,
// he spins out of the mist as ice bursts up around him, gathers cold light in his claws, raises them, and
// holds a crackling ball of frost over his head (src/capture/cinema/fx/snow-frost.ts).
const FC = [0.34, -95.2];
/** From the lens toward the keep (0, -128). */
const FU = ((d) => d.map((v) => v / Math.hypot(...d)))([0 - FC[0], -128 - FC[1]]);
const MP = [+(FC[0] + FU[0] * 3.4).toFixed(2), +(FC[1] + FU[1] * 3.4).toFixed(2)];
/** On the line to the keep, `up` high (world y), at the keep's face. */
const SPIRE = (up) => [+(FC[0] + FU[0] * 30).toFixed(2), up, +(FC[1] + FU[1] * 30).toFixed(2)];
/** The lens `d` units from FC toward the keep, `k` to the mage's right, `up` over the snow. */
const FL = (d, k, up) => G(FC[0] + FU[0] * d - FU[1] * k, FC[1] + FU[1] * d + FU[0] * k, up);
const MYAW = Math.atan2(-FU[0], -FU[1]); // facing the lens
const MF = frame(MP[0], MP[1], MYAW);
const mxz = (left, ahead) => MF(left, 0, ahead).filter((_, i) => i !== 1);
/** He spins one turn out of the mist, fast and slowing into his stance. */
const spin = (t0, t1) => {
  const keys = [];
  const n = Math.round((t1 - t0) * 48);
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    keys.push({ t: +(t0 + (t1 - t0) * u).toFixed(4), x: MP[0], z: MP[1], yaw: +(MYAW + 2 * PI * (1 - u) ** 1.6).toFixed(4) });
  }
  return keys;
};
/** A darker storm for the frost: dusk blue overhead, the snow lighter so his light carries. */
const FROST_SKY = { wind: [-2.5, -1.5, 5], heavy: 0.75, sky: '#7d88b6', zenith: '#262e5c', sun: 0.32, hemi: 0.85, tint: [0.82, 0.9, 1.18] };
const FROST_VIEW = { ...COLD, exposure: 1.12, saturation: -0.04, contrast: 0.1, bloom: { intensity: 1.2, threshold: 0.82 } };
/** The throne's lit snowflake sigil (behind his head from here) reads as an icon: folded away. */
const NO_SIGIL = { t: -3, kind: 'snow-frost-unsigil', box: [-1.7, 24.3, -110.3, 1.7, 27.6, -109] };
/** The ball of frost between his raised claws. */
const orb = (extra) => ({ kind: 'snow-frost-orb', actor: 'mage', sockets: ['clawL', 'clawR'], up: 0.32, size: 0.13, arcs: 11, arcLen: 3, splinters: 12, orbit: 3.6, motes: 18, light: 26, distance: 7, ...extra });
/** Both claws up (attack_slam's wind-up), held. */
const HOLD = { clip: 'attack_slam', loop: true, from: 1.765, to: 1.775 };
/** Mist hanging low round his feet. */
const mist = (t, d, until, extra) => ({ t, kind: 'snow-frost-blast', from: mxz(0, -1.6), to: mxz(0, 1.6), d, width0: 1.6, width1: 2.6, size0: 0.35, size1: 0.55, flat: 2.6, lift: 0.1, count: 36, crystals: 0, opacity: 0.16, depthTest: true, until, fadeOut: 0.5, seed: 8, ...extra });

const frostCast = {
  anchor: MP,
  hide: ['mira-ice-prison'],
  view: { ...FROST_VIEW, dof: true, bokeh: 1.8 },
  fog: { color: '#5d6894', density: 0.013 },
  actors: [{ id: 'mage', spec: MAGE, at: MP, yaw: MYAW }],
  tracks: {
    mage: {
      path: spin(0.46, 0.9),
      show: [[-5, false], [0.4, true]],
      acts: [
        // Claws flung out through the spin, then low in front gathering the cold; one claw up on 160.0 s, both by 160.3 s.
        { t: 0.4, clip: 'cast', from: 1.85, to: 2.6, speed: 1.1 },
        { t: 1.0, clip: 'cast', loop: true, from: 1.5, to: 1.53, fade: 0.3 },
        { t: 2.29, clip: 'attack_slam', from: 1.35, to: 1.775, speed: 1.3 },
        { t: 2.6, ...HOLD },
      ],
      faces: [{ t: -2, expr: 'focused' }, { t: 2.29, expr: 'angry' }],
    },
  },
  // At his chest, a little to his right, pushing in; tilting up with the claws.
  cam: {
    ...move([
      { t: 0, p: FL(0.2, 0.42, 0.42), l: MF(0, 0.4, 0), fov: 42 },
      { t: 0.9, p: FL(0.55, 0.38, 0.44), l: MF(0, 0.5, 0), fov: 42 },
      { t: 2.2, p: FL(0.85, 0.32, 0.42), l: MF(0, 0.6, 0), fov: 42 },
      { t: 2.71, p: FL(0.95, 0.3, 0.34), l: MF(0, 1.0, 0), fov: 44 },
    ]),
    focus: 'mage',
    range: 3,
  },
  fx: [
    ...blizzard(FROST_SKY),
    ARENA_OUT,
    NO_SIGIL,
    // Out of the pink-white the montage arrives in, the blast rolls into the lens (whoosh at 158.04 s).
    { t: 0, kind: 'fade', color: '#ffe6f0', curve: [[0, 0.9], [0.06, 0.35], [0.14, 0]] },
    { t: 0, kind: 'snow-frost-blast', from: mxz(0, -2.6), to: mxz(0, 6.4), d: 0.36, width0: 2.2, width1: 5.2, size0: 0.7, size1: 3.4, flat: 1.6, lift: 0.4, count: 320, crystals: 110, opacity: 0.85, until: 0.5, fadeOut: 0.16 },
    mist(0.3, 2.4, 2.9),
    { t: 0, kind: 'wash', color: '#cdd8f4', color2: '#ffffff', alpha: [[0.2, 0], [0.3, 0.85], [0.4, 0.8], [0.5, 0.35], [0.65, 0.1], [0.85, 0]], cover: [[0.2, 0.5], [0.32, 0.9], [0.42, 0.7], [0.55, 0.4], [0.85, 0.3]], flow: [-0.9, 0.15], scale: 1.8 },
    { t: 0, kind: 'fade', color: '#eef1ff', curve: [[0.22, 0], [0.3, 0.65], [0.38, 0.55], [0.47, 0]] },
    { t: 0.04, kind: 'shake', d: 0.4, amp: 0.025 },
    // Ice bursting up around him as he spins; at 159.22 s it juts further and a crack runs at the lens.
    { t: 0.5, kind: 'snow-frost-ice', at: MP, r0: 0.95, r1: 1.6, count: 11, height: 0.8, thin: 0.8, glow: 0.7, gap: [MYAW, 0.62], stagger: 0.3, rise: 0.12, jut: [[1.5, 1], [1.6, 1.3]], seed: 4 },
    { t: 1.5, kind: 'snow-frost-ice', at: MP, r0: 1.9, r1: 2.9, count: 10, height: 1.3, thin: 0.75, glow: 0.8, gap: [MYAW, 0.55], stagger: 0.1, rise: 0.1, seed: 7 },
    { t: 1.5, kind: 'snow-frost-crack', from: mxz(-0.15, 0.55), yaw: MYAW + 0.12, length: 3.0, width: 0.08, grow: 0.22, gain: 4, branches: 0.45 },
    { t: 1.5, kind: 'shake', d: 0.35, amp: 0.03 },
    // Cold light gathering in both claws.
    { t: 0.95, kind: 'snow-frost-orb', actor: 'mage', socket: 'clawL', size: 0.07, arcs: 4, motes: 12, reach: 10, light: 4, distance: 3, gain: [[0.95, 0], [1.4, 0.55], [2.25, 1]], until: 2.6, fadeOut: 0.2, seed: 1 },
    { t: 0.95, kind: 'snow-frost-orb', actor: 'mage', socket: 'clawR', size: 0.07, arcs: 4, motes: 12, reach: 10, light: 4, distance: 3, gain: [[0.95, 0], [1.4, 0.55], [2.25, 1]], until: 2.6, fadeOut: 0.2, seed: 2 },
    // Raised on 160.0 s; the blue-white burst at 160.35 s.
    orb({ t: 2.29, grow: [[2.29, 0.3], [2.62, 1]], gain: [[2.29, 0.25], [2.6, 1]], flares: [[2.64, 0.3, 4]], seed: 3 }),
    { t: 2.64, kind: 'flash', color: '#e4eeff', rise: 0.04, d: 0.28, a: 0.82 },
  ],
};
// Low under him, the throne's crown of ice and the citadel towering behind: the ball of frost crackling over his head.
const frostPillar = {
  anchor: MP,
  hide: ['mira-ice-prison'],
  view: { ...FROST_VIEW, dof: true, bokeh: 1.2 },
  fog: { color: '#4f5a88', density: 0.01 },
  actors: [{ id: 'mage', spec: MAGE, at: MP, yaw: MYAW }],
  tracks: { mage: { acts: [{ t: -1, ...HOLD }], faces: [{ t: -2, expr: 'angry' }] } },
  cam: {
    ...move([
      { t: 0, p: FL(1.0, 0.05, 0.14), l: SPIRE(33), fov: 60 },
      { t: 0.91, p: FL(1.1, -0.2, 0.14), l: SPIRE(34.5), fov: 60 },
    ]),
    focus: 'mage',
    range: 4,
  },
  fx: [
    ...blizzard({ ...FROST_SKY, drift: 0.06 }),
    ARENA_OUT,
    NO_SIGIL,
    mist(-1, 3, 2, { opacity: 0.12 }),
    // The ice he raised stays round his feet (the side toward the lens left open).
    { t: -1, kind: 'snow-frost-ice', at: MP, r0: 0.95, r1: 1.6, count: 11, height: 0.8, thin: 0.8, glow: 0.8, gap: [MYAW, 1.35], rise: 0.01, jut: [[0, 1.3]], seed: 4 },
    orb({ t: -1, flares: [[0.02, 0.25, 2.2]] }),
  ],
};
// Tilting up the citadel to its ice crowns as the frost swells; he lets it go into white (161.95 s).
const frostRise = {
  ...frostPillar,
  cam: {
    ...move([
      { t: 0, p: FL(1.3, 0.15, 0.1), l: SPIRE(44), fov: 64, roll: -0.04 },
      { t: 0.71, p: FL(1.4, 0.3, 0.1), l: SPIRE(52), fov: 66, roll: -0.06 },
    ]),
    focus: 'mage',
    range: 4,
  },
  fx: [
    ...blizzard({ ...FROST_SKY, drift: 0.06 }),
    ARENA_OUT,
    NO_SIGIL,
    { t: -1, kind: 'snow-frost-ice', at: MP, r0: 0.95, r1: 1.6, count: 11, height: 0.8, thin: 0.8, glow: 0.8, gap: [MYAW, 1.35], rise: 0.01, jut: [[0, 1.3]], seed: 4 },
    orb({ t: -1, flares: [[0.02, 0.2, 2.6], [0.62, 0.2, 7]] }),
    { t: 0, kind: 'flash', color: '#eef0ff', d: 0.18, a: 0.4 },
    { t: 0, kind: 'fade', color: '#f6f8ff', curve: [[0.58, 0], [0.64, 0.75], [0.7, 1]] },
  ],
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
