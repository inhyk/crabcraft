// The night-elf run becomes a short dash and a seven-move showcase, still on the original edit grid.
// Every articulation is a recorded Jumper policy from public/motions. Grounded moves
// plant their stage root; only the approach/recovery translates it. The camera supplies
// the travelling energy while a claw or foot is supporting the body.
import { ELF } from '../cast.mjs';

export const ELF_ACTIONS = [
  { id: 'night-elf-toprock', at: 75.6, end: 76.55, clip: 'break_toprock', from: 1.39, to: 2.3, speed: 1.1, point: [-89, 26], yaw: -0.35, label: 'Toprock feint', camera: 'front' },
  { id: 'night-elf-sixstep', at: 76.55, end: 77.7, clip: 'break_sixstep', from: 1.1, to: 2.55, speed: 1.3, point: [-90, 37], yaw: 0.0, label: 'Six-step pivot', camera: 'high' },
  { id: 'night-elf-spin', at: 77.7, end: 79.15, clip: 'break_spin', from: 1.05, to: 2.8, speed: 1.2, point: [-91, 45], yaw: -0.2, label: 'Ground spin', camera: 'side' },
  { id: 'night-elf-backflip', at: 79.15, end: 80.8, clip: 'break_backflip', from: 0.675, to: 1.825, speed: 0.82, point: [-91.45, 48.2], yaw: 0, label: 'Backflip into the puddle', camera: 'wide', land: 0.567 },
  { id: 'night-elf-clawstand', at: 80.8, end: 82.8, clip: 'break_clawstand', from: 3.65, to: 6.425, speed: 1.55, point: [-92.5, 62], yaw: -0.2, label: 'Two-claw balance', camera: 'low' },
  { id: 'night-elf-oneclaw', at: 82.8, end: 85.2, clip: 'break_oneclaw', from: 2.65, to: 5.65, speed: 1.5, approach: 0.25, point: [-92.5, 74], yaw: 0.1, label: 'One-claw release', camera: 'arc', splash: 1.58 },
  { id: 'night-elf-720', at: 85.2, end: 88.0, clip: 'break_jumpspin', from: 0.675, to: 2.065, speed: 0.58, point: [-90.5, 92.4], yaw: 0, label: '720 jump spin and transformation', camera: 'hero', land: (1.42 - 0.675) / 0.58 },
];

const G = (p, x, y, z) => ({ g: [p[0] + x, y, p[1] + z] });
/** Moss, soil, litter and fine grass (src/capture/cinema/fx/night-floor.ts) in the run's violet night. */
const FLOOR = { kind: 'night-floor', t: -3, soil: '#2a2232', moss: '#2a3d3a', litter: '#4a2a4c', litter2: '#3c2a44', grass: '#1d3530', tip: '#7a9a8e', count: 30, seed: 17 };
const angles = {
  front: [[-3.9, 1.15, 3.4], [-4.4, 0.9, 2.2], 0.65, 41],
  high: [[-3.9, 4.7, 1.6], [-4.2, 3.4, -1.4], 0.3, 47],
  side: [[-5.1, 0.9, -1.3], [-4.7, 1.2, 1.0], 0.65, 43],
  wide: [[-6.2, 1.3, 0.1], [-5.8, 1.05, 0.9], 1.25, 46],
  low: [[-4.4, 0.6, 2.0], [-4.8, 1.0, 0.6], 0.88, 45],
  arc: [[-4.5, 1.25, 1.2], [-4.1, 1.1, -1.8], 0.70, 47],
  hero: [[-5.9, 1.3, -0.9], [-5.6, 1.4, 1.0], 0.28, 46],
};

function actionShot(a, run) {
  const length = a.end - a.at;
  const [start, end, target, fov] = angles[a.camera];
  const p = a.point;
  const waterAt = a.splash ?? a.land;
  const last = a.clip === 'break_jumpspin';
  const approach = a.approach ?? 0;
  const duration = (a.to - a.from) / a.speed;
  const recovery = Math.min(length, approach + duration);
  // Evenly spaced samples prevent Catmull-Rom overshoot beside a planted interval.
  const path = Array.from({ length: Math.round(length * 48) + 1 }, (_, i) => {
    const t = i * length / Math.round(length * 48);
    const before = approach > 0 ? Math.min(1, Math.max(0, 1 - t / approach)) : 0;
    const after = Math.max(0, t - recovery) / Math.max(0.01, length - recovery);
    return { t, x: p[0], z: p[1] - 2.6 * before * before + (last ? 2.1 : 0.9) * after * after, yaw: a.yaw, lift: last ? 1.15 * after * after : 0 };
  });
  const trail = run.fx.filter((f) => ['leaves', 'motes'].includes(f.kind)).map((f) => ({ ...f, count: Math.round(f.count * 0.45), size: f.size * 0.65 }));
  // The run's own look (its lavender grade, mist and lens), so the moves sit in the same moonlit
  // wood as the close-up before them and the change after.
  const grade = run.fx.filter((f) => f.kind === 'night-grade');
  return {
    id: a.id, at: a.at, length, chapter: 1, mood: 1,
    anchor: p,
    view: run.view,
    fog: run.fog,
    actors: [{ id: 'elf', spec: ELF, at: p, yaw: a.yaw }],
    tracks: { elf: {
      path,
      acts: [{ t: approach || -0.15, clip: a.clip, from: approach ? a.from : a.from - 0.15 * a.speed, to: a.to, speed: a.speed, fade: 0.045 }],
      faces: [{ t: -2, expr: 'focused' }],
    } },
    cam: {
      ease: 'linear', spline: false, focus: 'elf', range: 4.5,
      keys: [
        { t: 0, p: G(p, ...start), l: { a: 'elf', o: [0, target, 0], y0: !last, body: last }, fov },
        { t: length, p: G(p, ...end), l: { a: 'elf', o: [0, target, 0.2], y0: !last, body: last }, fov: fov - 1 },
      ],
    },
    fx: [
      ...grade,
      // Clear the feet and every sight line, keeping the surrounding forest as depth layers.
      { kind: 'night-clear', t: -3, cut: [[...p, a.camera === 'high' ? 7 : 3.6], ...[0, 0.25, 0.5, 0.75, 1].flatMap((t) => {
        const x = start[0] + (end[0] - start[0]) * t;
        const z = start[2] + (end[2] - start[2]) * t;
        return [[p[0] + x, p[1] + z, a.camera === 'high' ? 6 : 2.5], [p[0] + x * 0.5, p[1] + z * 0.5, 1.7]];
      })] },
      { kind: 'night-clear', t: -3, skip: '^$', cut: [[...p, 3.4], [p[0], p[1] - 2.5, 2]] },
      // A forest floor over the wood's flat ground; the coarse cone tufts around it give way to its fine grass.
      { ...FLOOR, box: [p[0] - 14, p[1] - 14, p[0] + 14, p[1] + 14], ...(waterAt === undefined ? {} : { clear: [[...p, 1.9]], wet: 0.75 }) },
      { kind: 'night-clear', t: -3, match: 'grass', skip: '^$', cut: Array.from({ length: 64 }, (_, i) => [p[0] - 14 + (i % 8) * 4, p[1] - 14 + Math.floor(i / 8) * 4, 3]) },
      ...trail,
      { kind: 'elf-contact', t: -3, actor: 'elf', jump: a.land === undefined ? null : { takeoff: (a.clip === 'break_backflip' ? 0.84 - a.from : 0.9 - a.from) / a.speed, land: a.land } },
      { kind: 'light', t: -3, at: G(p, -2.8, 3.6, 1.3), color: '#c7dcff', intensity: 15, distance: 9 },
      { kind: 'light', t: -3, at: G(p, 1.5, 2.7, -1.8), color: '#d0a5ff', intensity: 28, distance: 8 },
      ...(waterAt === undefined ? [] : [
        { kind: 'night-pool', t: -3, at: p, size: [2.2, 2.7], rise: 0.025, edge: 0.4, deep: '#030610', shallow: '#0c1023', sky: '#34365f', opacity: 0.85, hits: [[waterAt, ...p, 1.3]] },
        { kind: 'night-splash', t: waterAt, at: G(p, 0, 0.03, 0), scale: 1.2, dir: [-0.5, 0.8], count: 200, sheets: 45, mist: 1, mistA: 0.025, up: 0.65, drop: 0.8, flare: 0.5, color: '#d6e8ff', gain: 0.85, seed: 93 },
        { kind: 'shake', t: waterAt, d: 0.18, amp: 0.025 },
      ]),
      ...(last ? [
        { kind: 'night-burst', t: length - 0.05, at: { a: 'elf', o: [0, 0.5, 0] }, size: 1.2, d: 0.6, color: '#ff3fd0', color2: '#ffa6f2', light: 30, gain: 0.7, count: 320 },
        { kind: 'flash', t: length - 0.042, d: 0.2, rise: 0.02, a: 0.4, color: '#ff7ae0' },
      ] : []),
    ],
  };
}

/** Keep all other shots, including the close-up, transformation and moon dive, byte-for-byte. */
/**
 * The run keeps its first second, the dash out of the close-up (74.6-75.6), and the moves start
 * where the original cuts away under a trunk that whips past the lens (src/capture/cinema/fx/
 * night-wipe.ts): the same sweep ends the dash and opens the toprock, covering the frame at the cut.
 */
const DASH_END = 75.6;
const WIPE = { kind: 'night-wipe', d: 0.5, from: 1.9, to: -1.9 };
export function withElfActions(shots) {
  return shots.flatMap((s) => {
    if (s.id !== 'night-elf-run') return [s];
    const cut = +(DASH_END - s.at).toFixed(4);
    const dash = { ...s, length: cut, fx: [...s.fx, { ...WIPE, t: cut - WIPE.d / 2 }] };
    const moves = ELF_ACTIONS.map((a) => actionShot(a, s));
    moves[0].fx.push({ ...WIPE, t: -WIPE.d / 2 });
    return [dash, ...moves];
  });
}
