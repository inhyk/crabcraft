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

// The dwarf on the snow road's last slope below the city: its gate stands 34 units up the road, on the plateau
// where the Frozen Throne was (src/capture/cinema/fx/snow-city.ts raises it and clears the arena). He faces
// into the storm, turns to his left toward the city, and the camera comes round his right side to behind his
// right shoulder while the storm hides the city. His beast walks up on his right (in from the frame's right),
// he swings his blunderbuss onto his shoulder, they walk a few steps, the beast rears and roars, and the two
// climb the road away from the lens as the city comes through the snow.
const D = [10.5, -19.5]; // between the road's lamp posts, east of the road
const GATE = [0, -52];
const YAW1 = Math.atan2(GATE[0] - D[0], GATE[1] - D[1]); // toward the gate, up the road
const YAW0 = YAW1 - 1.35; // into the wind; he turns to his left
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
const CITY = { t: -3, kind: 'snow-city', at: GATE, yaw: 0, clear: [-46, -120, 46, -50] };

const OPEN = 39.5;
const C_WIDE = 61.0;
const OPEN_END = 68.7;
/** Song seconds to snow-face seconds. */
const S = (song) => +(song - OPEN).toFixed(4);

/**
 * Walking speed up the road (units a second) at snow-face time t, piecewise linear: a few slow steps side by
 * side (53.5-55.6 s), a halt while the beast roars, then the climb from 56.5 s, on into the wide shot.
 */
const PACE = [[S(53.5), 0], [S(54.0), 0.85], [S(55.0), 0.85], [S(55.6), 0], [S(56.5), 0], [S(57.1), 1.5]];
const pace = (t) => {
  if (t <= PACE[0][0]) return 0;
  for (let i = 1; i < PACE.length; i++) if (t <= PACE[i][0]) return PACE[i - 1][1] + ((PACE[i][1] - PACE[i - 1][1]) * (t - PACE[i - 1][0])) / (PACE[i][0] - PACE[i - 1][0]);
  return PACE[PACE.length - 1][1];
};
/** Distance walked by time t (exact for the piecewise-linear pace). */
const walkDistance = (t) => {
  let d = 0;
  let prev = PACE[0][0];
  for (let i = 1; i <= PACE.length && prev < t; i++) {
    const end = Math.min(t, i < PACE.length ? PACE[i][0] : t);
    if (end > prev) d += ((pace(prev) + pace(end)) / 2) * (end - prev);
    prev = end;
  }
  return d;
};
// The beast's place beside him: 4 units to his right and 2.4 ahead (at 2.1 times his size its legs reach about
// 2.5 out, so the two never touch).
const B_LEFT = -4.0;
const B_AHEAD = 2.4;
// Sample one continuing walk for both cameras, every frame from `start`.
const walkPath = (left, ahead, start, end, offset = 0) => {
  const count = Math.round((end - start) * 24);
  return Array.from({ length: count + 1 }, (_, i) => {
    const t = start + (end - start) * i / count;
    const p = F1(left, 0, ahead + walkDistance(t));
    return { t: +(t - offset).toFixed(6), x: p[0], z: p[2], yaw: YAW1 };
  });
};
/** A point in F1's frame carried up the road by the walk at time t (`up` from the ground under it). */
const W = (left, up, ahead, t) => F1g(left, up, ahead + walkDistance(t));

/**
 * A slow hand-held drift added to sampled camera keys: smooth sums of sines on the position and the look
 * point, `amp(t)` units (0 = locked off).
 */
function handheld(cam, amp) {
  const n = (t, a, b, c) => Math.sin(t * a + b) * 0.55 + Math.sin(t * c + b * 2.3) * 0.3 + Math.sin(t * (a + c) * 0.61 + b * 0.7) * 0.15;
  return {
    ...cam,
    keys: cam.keys.map((k) => {
      const A = amp(k.t);
      if (!A) return k;
      const dp = [n(k.t, 2.1, 0.3, 4.7), n(k.t, 1.7, 1.9, 5.3) * 0.6, n(k.t, 2.6, 4.1, 3.9)];
      const dl = [n(k.t, 2.4, 2.2, 5.9), n(k.t, 1.9, 3.3, 4.3) * 0.8, n(k.t, 2.9, 5.1, 3.1)];
      return { ...k, p: r3(k.p.map((v, i) => v + A * dp[i])), l: r3(k.l.map((v, i) => v + A * 2.2 * dl[i])) };
    }),
  };
}

// Both squared to the slope, a little sunk into the powder.
const cast2 = (dwarfAt, beastAt, yaw) => [
  { id: 'dwarf', spec: DWARF, at: dwarfAt, yaw, align: 0.8, sink: 0.03 },
  { id: 'beast', enemy: BEAST.enemy, scale: BEAST.scale, at: beastAt, yaw, align: 0.9, sink: 0.1 },
];
const HIDE = ['mira-ice-prison'];
// The last north-road lamp stood where the opening's lens passes. Move the complete lamp west,
// for both opening views, while leaving the game world's placement untouched.
const LAMP_CLEARANCE = { t: -3, kind: 'snow-lamp-offset', at: [6.078627274048131, -18.125775308568286], offset: [-10, 0] };

// The blunderbuss (src/capture/cinema/fx/snow-gun.ts) in his right claw in place of the sword: slung low at
// his side, then on 52.7 s a dip and a swing up onto his shoulder, overshooting and settling by 53.4 s.
const SWING = S(52.7);
const GUN_OPEN = {
  t: -3,
  kind: 'snow-gun',
  actor: 'dwarf',
  size: 0.85,
  grip: [0, 0, 0.12],
  // The sword and the shield put away for the opening.
  hide: ['clawR', 'clawL'],
  aim: [[-3, { a: 'dwarf', o: [0.2, 0.55, 40] }]],
  lift: [[-3, -72], [SWING - 0.12, -72], [SWING + 0.05, -82], [SWING + 0.42, 70], [SWING + 0.55, 104], [SWING + 0.72, 92], [SWING + 0.9, 97]],
};
/** The right claw lowered to his side with the gun... */
const ARM_LOW = { t: -3, kind: 'dusk-arm', actor: 'dwarf', joints: { RF_J0_joint: -0.4, RF_J1_joint: 0.7, RF_J2_joint: 0.5 }, w: [[-3, 1], [SWING + 0.05, 1], [SWING + 0.4, 0]] };
/** ...and raised to the shoulder, the gun upright on it. */
const ARM_SHOULDER = { t: -3, kind: 'dusk-arm', actor: 'dwarf', joints: { RF_J0_joint: -0.15, RF_J1_joint: -1.0, RF_J2_joint: -0.85 }, w: [[SWING + 0.05, 0], [SWING + 0.5, 1]] };

/** The beast rears and roars, 55.75-56.5 s: head down, up, claws high and wide, eyes flaring, breath steaming. */
const ROAR_AT = S(55.75);
/** How far it turns to its right (toward the valley and the lens) to roar. */
const ROAR_TURN = 1.6;
/** 0 before a, up to 1 at b, held to c, down to 0 at d (smooth). */
const smooth01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const bump = (t, a, b, c, d) => (t <= a || t >= d ? 0 : t < b ? smooth01((t - a) / (b - a)) : t <= c ? 1 : 1 - smooth01((t - c) / (d - c)));
const ROAR_ARM = { LF_J0_joint: 0.6, RF_J0_joint: -0.5, LF_J1_joint: -1.4, RF_J1_joint: -1.4, LF_J2_joint: 0.8, RF_J2_joint: -0.8, LF_J4_joint: -1.0, RF_J4_joint: 1.0 };

const face = {
  anchor: D,
  hide: HIDE,
  // A tighter bloom, so the LEDs glow without veiling the moustache.
  view: { ...COLD, dof: true, bokeh: 2.2, bloom: { intensity: 0.45, threshold: 1.2, radius: 0.4 } },
  actors: cast2(D, F1(-12, 0, 4.4).filter((_, i) => i !== 1), YAW1 + PI / 2),
  tracks: {
    dwarf: {
      path: [
        { t: 0, x: D[0], z: D[1], yaw: YAW0 },
        { t: 3.6, x: D[0], z: D[1], yaw: YAW0 - 0.1 },
        { t: 6.0, x: D[0], z: D[1], yaw: YAW1 },
        ...walkPath(0, 0, S(53.5), C_WIDE - OPEN),
      ],
      faces: [{ t: -2, expr: 'focused' }, { t: 2.6, expr: 'blink', hold: 0.16 }, { t: 2.8, expr: 'focused' }, { t: 8.8, expr: 'blink', hold: 0.16 }, { t: 9.0, expr: 'focused' }, { t: S(52.55), expr: 'angry' }, { t: S(53.6), expr: 'focused' }, { t: S(56.3), expr: 'blink', hold: 0.16 }, { t: S(56.5), expr: 'focused' }],
    },
    beast: {
      // In from the right across the slope (its head into the frame's right edge at 50.75 s), padding up beside him
      // by 52.6 s; it wheels round to its right to roar.
      path: [
        { t: 9.4, x: F1(-12, 0, 4.4)[0], z: F1(-12, 0, 4.4)[2] },
        { t: S(50.75), x: F1(-6.6, 0, 3.0)[0], z: F1(-6.6, 0, 3.0)[2] },
        { t: S(51.5), x: F1(-5.0, 0, 2.6)[0], z: F1(-5.0, 0, 2.6)[2] },
        { t: S(52.6), x: F1(B_LEFT, 0, B_AHEAD)[0], z: F1(B_LEFT, 0, B_AHEAD)[2], yaw: YAW1 },
        ...walkPath(B_LEFT, B_AHEAD, S(53.5), C_WIDE - OPEN).map((k) => ({ ...k, yaw: +(YAW1 - ROAR_TURN * bump(k.t, S(55.15), S(55.7), S(56.45), S(57.0))).toFixed(4) })),
      ],
      show: [[-5, false], [9.0, true]],
      faces: [{ t: -2, expr: 'neutral' }, { t: S(55.5), expr: 'angry' }],
    },
  },
  cam: {
    ...handheld(
      move([
        // Out of the white onto the fur itself: the snow-caked moustache under his right eye, a hand's breadth
        // from the lens, then up and back to the original's close-up of his face.
        { t: 0, p: F0(-0.46, 0.33, 1.06), l: F0(-0.32, 0.41, 0.62), fov: 32 },
        { t: 1.2, p: F0(-0.465, 0.355, 1.13), l: F0(-0.3, 0.42, 0.61), fov: 32 },
        { t: 3.6, p: F0(-0.28, 0.78, 2.4), l: F0(0, 0.6, 0), fov: 27 },
        // Round his right side to his profile as he turns, and on behind him...
        { t: 6.4, p: F1(-2.4, 0.7, 1.9), l: F1(0, 0.72, 0.2), fov: 30 },
        { t: 8.2, p: F1(-2.35, 0.82, -0.25), l: F1(0, 0.8, 0.5), fov: 32 },
        // ...to low over his right shoulder at 49.3 s, staring out into the storm; drifting right as the beast comes in.
        { t: S(49.3), p: F1(-0.7, 0.72, -1.25), l: F1(0.15, 0.6, 4.5), fov: 36 },
        // Drawing back and up off his shoulder to take in the beast on the bank above him.
        { t: S(50.2), p: F1(-0.85, 0.85, -1.7), l: F1(-0.3, 0.95, 4.5), fov: 40 },
        { t: S(51.2), p: F1(-1.1, 1.2, -2.7), l: F1(-1.2, 1.65, 4.5), fov: 44 },
        { t: S(52.6), p: F1(-1.3, 1.5, -3.6), l: F1(-2.0, 2.3, 4.5), fov: 46 },
        { t: S(53.45), p: F1(-1.45, 1.65, -3.9), l: F1(-2.2, 2.3, 4.5), fov: 46 },
        // Walking: up behind the two of them and round behind the beast to its right...
        { t: S(54.4), p: W(-3.0, 2.6, -3.7, S(54.4)), l: W(-2.0, 0.6, 3.0, S(54.4)), fov: 42 },
        { t: S(55.4), p: W(-7.8, 1.6, -1.8, S(55.4)), l: W(-3.6, 1.0, 2.8, S(55.4)), fov: 40 },
        // ...low for the roar as it wheels round toward the lens...
        { t: S(55.9), p: W(-8.6, 1.25, -1.2, S(55.5)), l: W(-5.0, 1.6, 2.4, S(55.5)), fov: 38 },
        { t: S(56.5), p: W(-8.6, 1.05, -1.3, S(55.5)), l: W(-5.3, 2.2, 2.4, S(55.5)), fov: 36 },
        // ...then turning after them as they set off, rising and drawing back while they climb away and the city
        // comes through the snow at the right.
        { t: S(57.2), p: W(-8.2, 1.2, -1.6, S(55.5)), l: W(-3.2, 1.0, 3.0, S(57.2)), fov: 38 },
        { t: S(58.5), p: W(-7.6, 1.5, -2.2, S(55.5)), l: W(-2.6, 1.0, 3.0, S(58.5)), fov: 40 },
        { t: S(61.0), p: W(-6.8, 2.1, -3.2, S(55.5)), l: W(-2.2, 1.2, 3.0, S(61.0)), fov: 40 },
      ]),
      (t) => (t < 9 ? 0 : t < 10 ? (t - 9) * 0.012 : 0.012),
    ),
    focus: 'dwarf',
    range: 2.5,
  },
  fx: [
    // 59.2 s: a gust whips snow across the slope, right to left.
    { t: S(59.05), kind: 'snow-streaks', count: 3800, box: [14, 6, 14], drift: [-7.6, -1.2, 10.5], gust: [3, 1, 3], size: 0.026, trail: 0.07, opacity: 0.95, near: 0.4, seed: 9, fadeIn: 0.12, until: S(60.1), fadeOut: 0.5 },
    { t: S(59.1), kind: 'snow-powder', at: W(-4.5, 0.2, 3.4, S(59.1)), count: 40, flakes: 70, spread: 4.5, rise: 1.4, size: 1.1, life: 1.2 },
    // The spindrift over the lens thinned while it is a hand's breadth from the fur, back as he turns; the gust.
    ...blizzard({ wind: [0.65, -2.2, 6.9] }).map((c) => (c.kind === 'wash' ? { ...c, alpha: [[-3, 0.035], [2.6, 0.035], [4.6, 0.12], [S(59.1), 0.12], [S(59.3), 0.38], [S(59.7), 0.2], [S(60.3), 0.12]] } : c)),
    // The storm swallows the valley and the city while he stares into it, and lifts off the city at 58.5 s.
    { t: -3, kind: 'snow-fog', color: '#dde2ec', density: [[0, 0.014], [3.6, 0.02], [5.2, 0.04], [8.6, 0.05], [S(58.1), 0.05], [S(58.5), 0.036], [S(59.1), 0.022], [S(60.0), 0.015], [S(61.0), 0.012]] },
    CITY,
    LAMP_CLEARANCE,
    // Out of the white as late as the original, which is clear at 41.2 s.
    { t: 0, kind: 'fade', color: '#ffffff', curve: [[0, 1], [0.5, 0.85], [1.0, 0.55], [1.45, 0.2], [1.75, 0]] },
    // The LEDs dimmed while the lens is on the moustache, so the fur reads before the glare.
    // The fill held two stops under a stronger key while the lens is on the moustache, so the beard
    // has a lit side and a dark side (the key from his left, the side away from the lens).
    {
      t: -3,
      kind: 'fur',
      actor: 'dwarf',
      led: [[0, 0.45], [1.6, 0.5], [3.6, 1]],
      fill: [[0, 0.5], [3.6, 0.75], [6, 1]],
      key: { dir: [0.75, 0.62, 0.12], color: '#fff1e0', k: [[0, 10], [3.6, 8], [6, 7]] },
    },
    // Focus held on the moustache's frosted tips while the depth of field opens up to the face.
    { t: -3, kind: 'focus', at: { a: 'dwarf', o: [-0.36, 0.42, 0.68] }, range: [[0, 0.07], [1.6, 0.12], [3.6, 2.5]], until: 4 },
    // Over his shoulder the focus is on him, the beast soft beyond; on the beast for its roar; on both as they go.
    { t: S(54.4), kind: 'focus', at: { a: 'beast', o: [0, 1.3, 1.0] }, range: [[S(54.4), 2.2], [S(57.5), 3.0], [S(61), 6]] },
    // Back lights keeping both off the white once they are seen against the storm.
    { t: -3, kind: 'snow-rim', actor: 'dwarf', color: '#ffe7cc', k: [[7.5, 0], [9.2, 8], [S(61), 8]], back: 1.4, up: 1.1 },
    { t: -3, kind: 'snow-rim', actor: 'beast', color: '#e6eeff', k: [[10.5, 0], [11.5, 26], [S(61), 26]], back: 2.6, up: 1.2 },
    // The gun, the sword put away.
    GUN_OPEN,
    ARM_LOW,
    ARM_SHOULDER,
    { t: SWING + 0.5, kind: 'shake', d: 0.25, amp: 0.012 },
    // The roar: a dip of the head, rearing on its hind legs, claws flung high, then down onto its front feet.
    { t: -3, kind: 'snow-rear', actor: 'beast', pitch: [[ROAR_AT - 0.3, 0], [ROAR_AT - 0.05, -5], [ROAR_AT + 0.3, 20], [ROAR_AT + 0.7, 23], [ROAR_AT + 0.95, 6], [ROAR_AT + 1.1, -3], [ROAR_AT + 1.3, 0]], pivot: 1.4 },
    { t: -3, kind: 'dusk-arm', actor: 'beast', joints: ROAR_ARM, w: [[ROAR_AT, 0], [ROAR_AT + 0.28, 1], [ROAR_AT + 0.75, 1], [ROAR_AT + 1.05, 0]] },
    { t: -3, kind: 'snow-eyes', actor: 'beast', k: [[ROAR_AT - 0.2, 1], [ROAR_AT + 0.25, 3.8], [ROAR_AT + 0.75, 3.8], [ROAR_AT + 1.2, 1.4]] },
    { t: ROAR_AT + 0.2, kind: 'snow-breath', actor: 'beast', until: ROAR_AT + 0.78, rate: 100, speed: 4.5, size: 0.6, life: 0.9 },
    { t: ROAR_AT + 0.15, kind: 'snow-powder', at: { a: 'beast', o: [0, 2.2, -0.3] }, count: 30, flakes: 60, spread: 2.2, rise: 1.8, size: 0.7, life: 1.2 },
    { t: ROAR_AT + 1.05, kind: 'snow-powder', at: { a: 'beast', o: [0, 0.1, 1.2] }, count: 18, flakes: 30, spread: 2, rise: 1.0, size: 0.6, life: 1.0 },
    { t: ROAR_AT + 0.25, kind: 'shake', d: 0.7, amp: 0.035 },
    { t: ROAR_AT + 1.05, kind: 'shake', d: 0.3, amp: 0.025 },
  ],
};

// Far down the road: two figures climbing toward the gate, the camera drawing back down the slope past a fir at the
// right; the storm thickens into a veil over the gate (66.5 s) before leaves and white take over.
const WIDE_AT = C_WIDE - OPEN;
const WD = { d0: F1(0, 0, walkDistance(WIDE_AT)), b0: F1(B_LEFT, 0, B_AHEAD + walkDistance(WIDE_AT)) };
/** The wide's frame: from the pair at the cut, back down the road and off to their right. */
const WB = (back, right, up) => F1g(-right, up, walkDistance(WIDE_AT) - back);
const wide = {
  // Omit the fixed anchor: the stage follows the dwarf, keeping both crabs in the snow field.
  hide: HIDE,
  // No vignette and little bloom: the shot ends on flat white with leaves drawn over it.
  view: { ...COLD, saturation: -0.3, vignette: null, bloom: { intensity: 0, threshold: 5 } },
  actors: cast2([WD.d0[0], WD.d0[2]], [WD.b0[0], WD.b0[2]], YAW1),
  tracks: {
    dwarf: { path: walkPath(0, 0, WIDE_AT, OPEN_END - OPEN, WIDE_AT) },
    beast: { path: walkPath(B_LEFT, B_AHEAD, WIDE_AT, OPEN_END - OPEN, WIDE_AT) },
  },
  cam: handheld(
    move([
      { t: 0, p: WB(15, 4.5, 4.2), l: toward(WB(15, 4.5, 4.2), [GATE[0] + 2, 21, GATE[1]], 10), fov: 38 },
      { t: 3.0, p: WB(19.5, 5.6, 4.6), l: toward(WB(19.5, 5.6, 4.6), [GATE[0] + 1.5, 21.5, GATE[1]], 10), fov: 37 },
      { t: 5.5, p: WB(24, 6.8, 5.0), l: toward(WB(24, 6.8, 5.0), [GATE[0] + 1, 22, GATE[1]], 10), fov: 36 },
      { t: 7.7, p: WB(27.5, 7.6, 5.3), l: toward(WB(27.5, 7.6, 5.3), [GATE[0] + 1, 22.5, GATE[1]], 10), fov: 35 },
    ]),
    (t) => 0.02,
  ),
  fx: [
    // 66.5 s: the storm thickens into a veil over the gate.
    { t: 5.4, kind: 'snow-streaks', count: 5000, box: [20, 10, 20], drift: [0.8, -2.5, 9], gust: [2, 1, 3], size: 0.024, trail: 0.06, opacity: 0.9, seed: 12, fadeIn: 1.0 },
    ...blizzard({ wind: [0.65, -2.5, 7.5], heavy: 1.2, drift: 0.12, sky: '#cdd3e2', zenith: '#9aa3c2' }).map((c) => (c.kind === 'wash' ? { ...c, alpha: [[-3, 0.12], [5.4, 0.12], [6.6, 0.42], [7.2, 0.5]] } : c)),
    { t: -3, kind: 'snow-fog', color: '#d6dbe7', density: [[0, 0.016], [5.4, 0.017], [6.6, 0.034], [7.7, 0.038]] },
    CITY,
    LAMP_CLEARANCE,
    // The fir the camera draws back past, at the right from 64 s.
    { t: -3, kind: 'snow-pines', trees: [WB(20.5, 12.5, 0), WB(28, 15.5, 0)].map((p, i) => [+p[0].toFixed(2), +p[2].toFixed(2), [1.0, 1.15][i]]) },
    { t: 6.1, kind: 'snow-leaves', count: 200, box: [12, 7, 12], drift: [-2.5, -1.2, 3.5], size: 0.09, near: 1.4, color: '#a2482a', color2: '#c98a3c', fadeIn: 0.6 },
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
    { t: 0, kind: 'snow-frost-blast', from: mxz(0, -3.6), to: mxz(0, 5.6), d: 0.4, width0: 2.6, width1: 6, size0: 0.6, size1: 2.5, flat: 2.2, lift: 0.3, count: 380, crystals: 120, opacity: 0.9, color: '#f6f9ff', color2: '#8ea4d8', until: 0.5, fadeOut: 0.16 },
    // He spins out of what it leaves; then it hangs low round his feet.
    mist(0.28, 1.2, 1.0, { opacity: 0.4, size0: 0.7, size1: 1.2, lift: 0.25, count: 60, fadeOut: 0.45, seed: 9 }),
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
