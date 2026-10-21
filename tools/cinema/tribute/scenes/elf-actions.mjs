// The night-elf run becomes a seven-move showcase, still on the original edit grid.
// Every articulation is a recorded Jumper policy from public/motions. Grounded moves
// plant their stage root; only the approach/recovery translates it. The camera supplies
// the travelling energy while a claw or foot is supporting the body.
import { ELF } from '../cast.mjs';

export const ELF_ACTIONS = [
  { id: 'night-elf-toprock', at: 74.6, end: 76.0, clip: 'break_toprock', from: 1.39, to: 2.3, speed: 1.1, approach: 0.55, point: [-89, 26], yaw: -0.35, label: 'Toprock feint', camera: 'front' },
  { id: 'night-elf-sixstep', at: 76.0, end: 77.7, clip: 'break_sixstep', from: 1.1, to: 2.55, speed: 1.2, approach: 0.45, point: [-90, 37], yaw: 0.0, label: 'Six-step pivot', camera: 'high' },
  { id: 'night-elf-spin', at: 77.7, end: 79.15, clip: 'break_spin', from: 1.05, to: 2.8, speed: 1.2, point: [-91, 45], yaw: -0.2, label: 'Ground spin', camera: 'side' },
  { id: 'night-elf-backflip', at: 79.15, end: 80.8, clip: 'break_backflip', from: 0.828, to: 1.14, speed: 0.55, point: [-91.5, 49.7], yaw: 0, label: 'Backflip over the creek onto the far bank', camera: 'wide', leap: true, land: 0.567,
    faces: [{ t: -2, expr: 'angry' }, { t: 0.85, expr: 'focused' }],
    then: [{ t: 0.567, clip: 'break_backflip', from: 1.14, to: 1.825, speed: 0.8, fade: 0.01 }] },
  { id: 'night-elf-clawstand', at: 80.8, end: 82.8, clip: 'break_clawstand', from: 3.65, to: 6.425, speed: 1.55, point: [-92.5, 62], yaw: -0.2, label: 'Two-claw balance', camera: 'low' },
  { id: 'night-elf-oneclaw', at: 82.8, end: 85.2, clip: 'break_oneclaw', from: 2.65, to: 5.65, speed: 1.5, approach: 0.25, point: [-92.5, 74], yaw: 0.1, label: 'One-claw release', camera: 'arc', splash: 1.58 },
  // Runs in low through the ferns, springs, travels the 720 through the air (lands on the 86.29 s thud),
  // runs on and springs into the change.
  { id: 'night-elf-720', at: 85.2, end: 88.0, clip: 'break_jumpspin', from: 0.78, to: 2.065, speed: 0.865, approach: 0.35, point: [-90.5, 92.4], yaw: 0, label: '720 jump spin and transformation', camera: 'hero', land: 1.09,
    faces: [{ t: -2, expr: 'focused' }, { t: 0.3, expr: 'angry' }],
    keys: [[0, 0, -4.6, 0], [0.35, 0, -2.4, 0], [0.489, 0, -2.4, 0], [1.09, 0, 0, 0], [1.84, 0, 0, 0]] },
];

/**
 * The spin's restaging for the leap over the creek, kept apart from its line above so that line
 * stays as it was: a shorter, faster spin, a crouch into the jump that leaves the ground on the hit
 * (78.40 s), and the jump's air pose held long across the water; the face sets as she springs.
 */
const RESTAGE = {
  'night-elf-spin': {
    to: 1.8, speed: 1.5, yaw: -0.1, label: 'Ground spin, then the leap over the creek', leap: true,
    faces: [{ t: -2, expr: 'focused' }, { t: 0.45, expr: 'angry' }],
    then: [{ t: 0.525, clip: 'jump', from: 0.9, to: 1.075, speed: 1, fade: 0.08 }, { t: 0.7, clip: 'jump', from: 1.075, to: 1.3, speed: 0.3, fade: 0.01 }],
  },
};

const G = (p, x, y, z) => ({ g: [p[0] + x, y, p[1] + z] });
/** Moss, soil, litter and fine grass (src/capture/cinema/fx/night-floor.ts) in the run's violet night. */
const FLOOR = { kind: 'night-floor', t: -3, soil: '#2a2232', moss: '#2a3d3a', litter: '#4a2a4c', litter2: '#3c2a44', grass: '#1d3530', tip: '#7a9a8e', count: 30, seed: 17 };
/**
 * Camera offsets from the move's point (start, end), look height, fov, and what to clear: `near` round
 * her feet, `lens` round the lens path, `mid` half way along each sight line. Every angle travels.
 */
const angles = {
  front: [[-3.9, 1.15, 3.4], [-4.4, 0.9, 2.2], 0.65, 41],
  // The original's wide: small in the moonlit wood from well off, trunks sliding across the lens.
  high: [[-11.2, 1.7, -4.6], [-11.0, 1.45, 3.8], 0.45, 30, { near: 1.6, lens: 1.3, mid: 0 }],
  // Side on to the leap and the creek, trucking with her across it.
  side: [[-6.6, 0.8, -2.4], [-7.0, 1.25, 4.9], 0.7, 44],
  // Low under the far half of the flip, then along the bank she lands on.
  wide: [[-6.2, 0.5, -4.2], [-5.2, 0.95, 2.1], 0.85, 50],
  low: [[-4.3, 0.6, 2.5], [-4.9, 1.0, -0.2], 0.88, 45],
  arc: [[-4.5, 1.25, 1.2], [-4.1, 1.1, -1.8], 0.70, 47],
  // The low chase: knee high, keeping pace from beyond a row of trunks that flash across the lens.
  hero: [[-9.5, 0.6, -6.4], [-9.6, 0.8, 2.3], 0.4, 31, { near: 2.6, lens: 1.3, mid: 0, keep: [[-98.51, 89.24, 0.5], [-97.37, 87.17, 0.5]] }],
};
/** The leap over the creek: off the near bank on the hit (78.40 s), onto the far one on the thud (79.72 s). */
const LEAP = { up: 78.4, down: 79.72, from: [-91, 45], to: [-91.5, 49.7], h: 1.3 };
/** Where she is at a song second of the leap: x, z, lift (a parabola; planted on either bank). */
function leapAt(song) {
  const u = Math.min(1, Math.max(0, (song - LEAP.up) / (LEAP.down - LEAP.up)));
  return [LEAP.from[0] + (LEAP.to[0] - LEAP.from[0]) * u, LEAP.from[1] + (LEAP.to[1] - LEAP.from[1]) * u, 4 * LEAP.h * u * (1 - u)];
}
/** The creek across her line, running east-west between the banks; ripples keep it moving. */
const CREEK = [-91.25, 47.4];
const CREEK_R = [7, 1.15];
const CREEK_ALONG = Array.from({ length: 11 }, (_, i) => [CREEK[0] - 6 + i * 1.2, CREEK[1] + 0.25 * Math.sin(i * 1.7)]);
const creekFx = () => [
  {
    kind: 'night-pool', t: -3, at: CREEK, size: CREEK_R, rise: 0.04, edge: 0.35,
    deep: '#010104', shallow: '#070512', sky: '#1c1838', moon: [1, 0.22, 0.1], glint: 2.2, opacity: 0.96,
    sheen: 1.0, sheenP: 18, crestK: 0.25, rim: 0.08,
    hits: Array.from({ length: 12 }, (_, i) => [-1.2 + i * 0.27, CREEK[0] - 5 + ((i * 3.7) % 10), CREEK[1] + 0.5 * Math.sin(i * 2.3), 0.12]),
  },
];

function actionShot(base, run) {
  const a = { ...base, ...RESTAGE[base.id] };
  const length = a.end - a.at;
  const [start, end, target, fov, clear = {}] = angles[a.camera];
  const near = clear.near ?? 3.6;
  const lens = clear.lens ?? 2.5;
  const mid = clear.mid ?? 1.7;
  const p = a.point;
  const waterAt = a.splash ?? (a.leap ? undefined : a.land);
  const last = a.clip === 'break_jumpspin';
  const approach = a.approach ?? 0;
  const duration = (a.to - a.from) / a.speed;
  const recovery = Math.min(length, approach + duration);
  /** The shot's first frame (the edit cuts on whole frames). */
  const t0 = Math.round(a.at * 24) / 24;
  /** Optional keyed run-in and flight [t, dx, dz, lift] off the point, straight between keys. */
  const keyed = (t) => {
    const k = a.keys;
    let i = 1;
    while (i < k.length - 1 && t > k[i][0]) i++;
    const u = Math.min(1, Math.max(0, (t - k[i - 1][0]) / (k[i][0] - k[i - 1][0])));
    return [0, 1, 2].map((j) => k[i - 1][j + 1] + (k[i][j + 1] - k[i - 1][j + 1]) * u);
  };
  // Evenly spaced samples prevent Catmull-Rom overshoot beside a planted interval.
  const path = Array.from({ length: Math.round(length * 48) + 1 }, (_, i) => {
    const t = i * length / Math.round(length * 48);
    if (a.leap) {
      const [x, z, lift] = leapAt(t0 + t);
      return { t, x, z, yaw: a.yaw, lift };
    }
    const before = approach > 0 ? Math.min(1, Math.max(0, 1 - t / approach)) : 0;
    const after = Math.max(0, t - recovery) / Math.max(0.01, length - recovery);
    const [dx, dz, lift] = a.keys ? keyed(t) : [0, -2.6 * before * before, 0];
    return { t, x: p[0] + dx, z: p[1] + dz + (last ? 2.1 : 0.9) * after * after, yaw: a.yaw, lift: lift + (last ? 1.15 * after * after : 0) };
  });
  const trail = run.fx.filter((f) => ['leaves', 'motes'].includes(f.kind)).map((f) => ({ ...f, count: Math.round(f.count * 0.45), size: f.size * 0.65 }));
  // The run's own look (its lavender grade, mist and lens), so the moves sit in the same moonlit
  // wood as the close-up before them and the change after.
  const grade = run.fx.filter((f) => f.kind === 'night-grade');
  const air = a.leap ? [LEAP.up - t0, LEAP.down - t0] : a.land === undefined ? null : [approach + ((a.clip === 'break_backflip' ? 0.84 : 0.9) - a.from) / a.speed, a.land];
  const look = { y0: !last, body: last };
  return {
    id: a.id, at: a.at, length, chapter: 1, mood: 1,
    anchor: p,
    view: run.view,
    fog: run.fog,
    actors: [{ id: 'elf', spec: ELF, at: a.leap ? [path[0].x, path[0].z] : p, yaw: a.yaw }],
    tracks: { elf: {
      path,
      acts: [
        { t: approach || -0.15, clip: a.clip, from: approach ? a.from : a.from - 0.15 * a.speed, to: a.to, speed: a.speed, fade: 0.045 },
        ...(a.then ?? []),
      ],
      faces: a.faces ?? [{ t: -2, expr: 'focused' }],
    } },
    cam: {
      ease: 'linear', spline: false, focus: 'elf', range: 4.5,
      keys: a.leap
        // Over the leap the lens tilts up with most of her lift: she rises in frame, never out of it.
        ? Array.from({ length: 9 }, (_, i) => {
          const t = (i * length) / 8;
          const [x, z, lift] = leapAt(t0 + t);
          return { t, p: G(p, ...start.map((v, j) => v + ((end[j] - v) * i) / 8)), l: { g: [x, target + 0.95 * lift, z + 0.2 * i / 8] }, fov: fov - i / 8 };
        })
        : [
          { t: 0, p: G(p, ...start), l: { a: 'elf', o: [0, target, 0], ...look }, fov },
          { t: length, p: G(p, ...end), l: { a: 'elf', o: [0, target, 0.2], ...look }, fov: fov - 1 },
        ],
    },
    fx: [
      ...grade,
      // Moonpool Grove's faceted standing stones and runes stand behind several moves: out of frame.
      { kind: 'elf-hide', t: -3, at: [-80, 50], r: 12 },
      // Clear the feet and every sight line, keeping the surrounding forest as depth layers.
      { kind: 'night-clear', t: -3, cut: [[...p, near], ...[0, 0.25, 0.5, 0.75, 1].flatMap((t) => {
        const x = start[0] + (end[0] - start[0]) * t;
        const z = start[2] + (end[2] - start[2]) * t;
        return [[p[0] + x, p[1] + z, lens], ...(mid ? [[p[0] + x * 0.5, p[1] + z * 0.5, mid]] : [])];
      }), ...(a.leap ? [[...LEAP.from, 2.2], [...LEAP.to, 2.2]] : []), ...(clear.keep ?? [])] },
      { kind: 'night-clear', t: -3, skip: '^$', cut: [[...p, 3.4], [p[0], p[1] - 2.5, 2]] },
      // A forest floor over the wood's flat ground; the coarse cone tufts around it give way to its fine grass.
      {
        ...FLOOR, box: [p[0] - 14, p[1] - 14, p[0] + 14, p[1] + 14],
        ...(a.leap ? { clear: CREEK_ALONG.map(([x, z]) => [x, z, 1.25]), wet: 0.75 } : waterAt === undefined ? {} : { clear: [[...p, 1.9]], wet: 0.75 }),
      },
      { kind: 'night-clear', t: -3, match: 'grass', skip: '^$', cut: Array.from({ length: 64 }, (_, i) => [p[0] - 14 + (i % 8) * 4, p[1] - 14 + Math.floor(i / 8) * 4, 3]) },
      ...trail,
      { kind: 'elf-contact', t: -3, actor: 'elf', jump: air ? { takeoff: air[0], land: air[1] } : null },
      { kind: 'light', t: -3, at: G(p, -2.8, 3.6, 1.3), color: '#c7dcff', intensity: 15, distance: 9 },
      { kind: 'light', t: -3, at: G(p, 1.5, 2.7, -1.8), color: '#d0a5ff', intensity: 28, distance: 8 },
      // A moonlit rim from beyond her, away from the lens, that travels with her.
      { kind: 'light', t: -3, at: { a: 'elf', o: [2.4, 2.2, -0.8] }, color: '#efe6ff', intensity: 26, distance: 6 },
      ...(a.leap ? creekFx() : []),
      ...(a.leap && a.land !== undefined ? [
        // Spray off the wet stones of the far bank as she lands.
        { kind: 'night-splash', t: a.land - 0.02, at: { g: [p[0], 0.05, p[1] - 0.3] }, scale: 0.9, dir: [-0.6, 0.5], count: 140, sheets: 30, mist: 1, mistA: 0.03, up: 0.55, drop: 0.7, flare: 0.6, color: '#d6e8ff', gain: 0.8, seed: 94 },
        { kind: 'shake', t: a.land, d: 0.2, amp: 0.03 },
      ] : []),
      ...(waterAt === undefined ? [] : [
        { kind: 'night-pool', t: -3, at: p, size: [2.2, 2.7], rise: 0.025, edge: 0.4, deep: '#030610', shallow: '#0c1023', sky: '#34365f', opacity: 0.85, hits: [[waterAt, ...p, 1.3]] },
        { kind: 'night-splash', t: waterAt, at: G(p, 0, 0.03, 0), scale: 1.2, dir: [-0.5, 0.8], count: 200, sheets: 45, mist: 1, mistA: 0.025, up: 0.65, drop: 0.8, flare: 0.5, color: '#d6e8ff', gain: 0.85, seed: 93 },
        { kind: 'shake', t: waterAt, d: 0.18, amp: 0.025 },
      ]),
      ...(last ? [
        // The change's light in the mist, building from the magic's onset (87.81 s) to the burst.
        { kind: 'elf-aura', t: length - 0.05, pre: 0.15, at: { a: 'elf', o: [0, 0.5, 0] }, size: 1.2, d: 0.6, color: '#ff3fd0', color2: '#ffa6f2', light: 40, gain: 0.8 },
        { kind: 'flash', t: length - 0.042, d: 0.2, rise: 0.02, a: 0.4, color: '#ff7ae0' },
      ] : []),
    ],
  };
}

/** Keep all other shots, including the close-up, transformation and moon dive, byte-for-byte. */
export function withElfActions(shots) {
  return shots.flatMap((s) => s.id === 'night-elf-run' ? ELF_ACTIONS.map((a) => actionShot(a, s)) : [s]);
}
