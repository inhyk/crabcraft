// Frostlight's wind-built snow, numbers only: the tails the wind lays down in the lee of everything that stands in
// it, sastrugi carved on the exposed flats, cornices curling over the lee of the crests, and the scoops it digs on
// the windward side of each obstacle. Never solid, so crabs walk through all of it; kept off the roads, the
// village, the arena and the throne worker's sites. Deterministic: every client builds the same drifts.
import { snowHeight } from '../sim/world/ground';
import { WAY_CAIRNS } from './frostCairnsLayout';
import { fieldBlock, fieldStream, snowBoulders, snowFieldPieces, snowLogs, snowPebbles, snowSaplings, snowScrubItems, snowStumps, snowStory, windAt } from './snowFieldsLayout';

type Height = (x: number, z: number) => number;
type XZ = [number, number];

/** Whether drift snow may lie at (x, z) out to radius r: open field (quest points and homes do not mind snow). */
function open(x: number, z: number, r: number): boolean {
  const b = fieldBlock(x, z, r, false);
  return b === null || b === 'quest';
}

// ---------------------------------------------------------------------------------------------------------------
// Lee tails: a tapering ridge downwind of an obstacle, its crest highest at the obstacle and running out to a point.

export interface DriftTail {
  x: number;
  z: number;
  /** Half width at the root, metres. */
  w: number;
  /** Height at the root, metres. */
  h: number;
  /** Length downwind from the obstacle's centre. */
  len: number;
  /** Bearing downwind. */
  dir: number;
  seed: number;
  /** Dropped on low quality. */
  fine?: boolean;
}

let tailsMemo: DriftTail[] | null = null;
export function snowTails(): DriftTail[] {
  if (tailsMemo) return tailsMemo;
  const out: DriftTail[] = [];
  const R = fieldStream(7311);
  const add = (x: number, z: number, w: number, h: number, len: number, fine = false) => {
    const dir = windAt(x, z) + (R() - 0.5) * 0.16, c = Math.cos(dir), s = Math.sin(dir);
    // The whole tail must lie on open field: root, middle and tip.
    for (const t of [0.15, 0.5, 0.95]) if (!open(x + c * len * t, z + s * len * t, w * (1 - t * 0.7))) return;
    out.push({ x: +x.toFixed(2), z: +z.toFixed(2), w: +w.toFixed(2), h: +h.toFixed(3), len: +len.toFixed(2), dir: +dir.toFixed(3), seed: out.length + 1, fine });
  };
  for (const b of snowBoulders()) add(b.x, b.z, b.r * 1.05, Math.min(0.62, b.h * 0.5), Math.min(9, 2.2 * b.r + 4.2 * b.h));
  for (const p of snowPebbles()) add(p.x, p.z, p.r * 1.1, 0.06 + p.h * 0.3, 0.6 + p.r * 3, true);
  for (const s of snowStumps()) add(s.x, s.z, s.r * 1.2, Math.min(0.4, s.h * 0.6), 1.8 + s.h * 4);
  for (const g of snowScrubItems()) if (g.kind !== 'cloth') add(g.x, g.z, 0.22 * g.s, 0.07 + 0.06 * g.s, 0.9 + 0.9 * g.s, !!g.fine);
  for (const l of snowLogs()) {
    // A log across the wind banks a long drift along its lee side.
    const across = Math.abs(Math.sin(-l.yaw - windAt(l.x, l.z)));
    if (across > 0.35) add(l.x, l.z, (l.len / 2) * across, Math.min(0.45, l.r * 1.3), 2.5 + l.r * 5);
  }
  for (const p of snowFieldPieces()) {
    if (/Tree/.test(p.piece)) add(p.x, p.z, 0.45, 0.32, 3.2);
    else if (/WoodenFence/.test(p.piece)) add(p.x, p.z, 0.95, 0.3, 2.8);
    else if (p.solid) add(p.x, p.z, 'r' in p.solid ? p.solid.r : Math.max(p.solid.hx, p.solid.hz), 0.35, 3.4);
  }
  for (const c of WAY_CAIRNS) add(c.x, c.z, c.r * 0.9, 0.45, 4.2);
  for (const t of snowStory()) add(t.x, t.z, t.w, t.drift, t.drift * 9);
  // A buried spruce banks a long drift: its boughs comb the snow out of the wind.
  for (const t of snowSaplings()) add(t.x, t.z, 0.35 + t.s * 1.4, 0.18 + t.s * 0.6, 2.4 + t.s * 9);
  return (tailsMemo = out);
}

// ---------------------------------------------------------------------------------------------------------------
// Sastrugi: fields of sharp ridges the wind carved from the crust, a steep prow upwind and a long tapering tail.

export interface SastrugiRidge { x: number; z: number; len: number; w: number; h: number; dir: number; seed: number }
interface Field { x: number; z: number; rx: number; rz: number; n: number; seed: number }
/** Placed fields: the windward slope west of the woodcutter's crest and the flats before the eastern diggings, in
 * the two wide views, then the open crests elsewhere. */
const SASTRUGI_FIELDS: readonly Field[] = [
  { x: 33.5, z: -8.5, rx: 6.5, rz: 4.6, n: 60, seed: 1 },
  { x: -40.5, z: -8.5, rx: 4.5, rz: 5.5, n: 44, seed: 2 },
  { x: -33.5, z: -15, rx: 3.2, rz: 3, n: 16, seed: 3 },
  { x: 35, z: -26, rx: 5, rz: 3.5, n: 26, seed: 4 },
  { x: 62, z: 8, rx: 6, rz: 4, n: 34, seed: 5 },
  { x: -62, z: 12, rx: 5.5, rz: 4, n: 30, seed: 6 },
  { x: 70, z: 58, rx: 6, rz: 4.5, n: 34, seed: 7 },
  { x: -70, z: -40, rx: 5, rz: 4, n: 26, seed: 8 },
  { x: 24, z: 104, rx: 5, rz: 3.5, n: 24, seed: 9 },
  { x: -40, z: 100, rx: 5, rz: 3.5, n: 24, seed: 10 },
  { x: 52, z: -52, rx: 5, rz: 3.5, n: 24, seed: 11 },
];

let sastrugiMemo: SastrugiRidge[] | null = null;
export function snowSastrugi(): SastrugiRidge[] {
  if (sastrugiMemo) return sastrugiMemo;
  const out: SastrugiRidge[] = [];
  for (const f of SASTRUGI_FIELDS) {
    const R = fieldStream(f.seed * 4099 + 11), dir0 = windAt(f.x, f.z), c0 = Math.cos(dir0), s0 = Math.sin(dir0);
    // The wind carves them in ragged lines slanting across it, each ridge stepped downwind of the last.
    for (let chain = 0, n = 0; chain < 40 && n < f.n; chain++) {
      const a0 = (R() * 2 - 1) * f.rx * 0.85, b0 = (R() * 2 - 1) * f.rz * 0.85, slant = (R() - 0.5) * 1.1, links = 3 + Math.floor(R() * 6);
      for (let k = 0; k < links && n < f.n; k++) {
        const b = b0 + (k - links / 2) * (0.35 + R() * 0.45), a = a0 + (k - links / 2) * slant * 0.5 + (R() - 0.5) * 0.9;
        const e = Math.hypot(a / f.rx, b / f.rz);
        if (e > 1) continue;
        const x = f.x + c0 * a - s0 * b, z = f.z + s0 * a + c0 * b;
        // Largest in the middle of a line and of the field; most are small.
        const big = (1 - e * 0.55) * (1 - Math.abs(k / Math.max(1, links - 1) - 0.5) * 0.7);
        const len = (0.45 + R() * R() * 3.4) * big + 0.3, w = (0.1 + R() * 0.3) * (0.55 + 0.45 * big), h = (0.03 + R() * R() * 0.14) * big + 0.025;
        if (out.some((o) => Math.hypot(o.x - x, o.z - z) < Math.max(o.w, w) * 1.3) || !open(x, z, len * 0.6)) continue;
        out.push({ x: +x.toFixed(2), z: +z.toFixed(2), len: +len.toFixed(2), w: +w.toFixed(3), h: +h.toFixed(3), dir: +(windAt(x, z) + (R() - 0.5) * 0.3).toFixed(3), seed: out.length + 1 });
        n++;
      }
    }
  }
  return (sastrugiMemo = out);
}

// ---------------------------------------------------------------------------------------------------------------
// Cornices: where a crest drops away steeply downwind, the snow blown over it curls out into a lip.

export interface Cornice { points: readonly XZ[]; h: number; seed: number }

/** Crest points: a high point along the wind with a steep drop over the next 3 m and a rise over the 5 m before. */
function crests(h: Height): XZ[][] {
  const pts: XZ[] = [];
  for (let z = -88; z <= 118; z += 1) for (let x = -100; x <= 100; x += 0.5) {
    const c = h(x, z);
    if (h(x + 0.5, z) > c || h(x - 0.5, z) > c) continue;
    if (c - h(x + 3, z) < 0.5 || c - h(x - 5, z) < 0.25) continue;
    if (fieldBlock(x, z, 1.2, false)) continue;
    pts.push([x, z]);
  }
  const chains: XZ[][] = [];
  for (const p of pts) {
    const ch = chains.find((c) => { const q = c[c.length - 1]; return p[1] - q[1] === 1 && Math.abs(p[0] - q[0]) <= 1.5; });
    if (ch) ch.push(p); else chains.push([p]);
  }
  return chains.filter((c) => c.length >= 6);
}

let cornicesMemo: Cornice[] | null = null;
export function snowCornices(h: Height = snowHeight): Cornice[] {
  if (cornicesMemo) return cornicesMemo;
  const R = fieldStream(6007);
  const out: Cornice[] = [];
  for (const chain of crests(h)) {
    // Smooth the stair of half-metre steps into a line, and keep clear of the woodcutter's clearing.
    const pts = chain.map(([, z], i): XZ => {
      let sx = 0, n = 0;
      for (let k = -2; k <= 2; k++) { const q = chain[i + k]; if (q) { sx += q[0]; n++; } }
      return [+(sx / n).toFixed(2), z];
    }).filter(([x, z]) => Math.hypot(x + 35, z + 28) > 7.5);
    if (pts.length < 6) continue;
    out.push({ points: pts, h: +(0.42 + R() * 0.2).toFixed(2), seed: out.length + 1 });
  }
  return (cornicesMemo = out);
}

// ---------------------------------------------------------------------------------------------------------------
// Scoops: the hollow the wind digs on the windward side of an obstacle, wrapping round it.

export interface Scoop { x: number; z: number; r: number; dir: number; seed: number }
let scoopsMemo: Scoop[] | null = null;
export function snowScoops(): Scoop[] {
  if (scoopsMemo) return scoopsMemo;
  const out: Scoop[] = [];
  const add = (x: number, z: number, r: number) => { if (open(x, z, r * 1.6)) out.push({ x, z, r: +r.toFixed(2), dir: +windAt(x, z).toFixed(3), seed: out.length + 1 }); };
  for (const b of snowBoulders()) add(b.x, b.z, b.r * 1.05);
  for (const s of snowStumps()) add(s.x, s.z, s.r * 1.3);
  for (const p of snowFieldPieces()) if (/Tree/.test(p.piece)) add(p.x, p.z, 0.5);
  for (const c of WAY_CAIRNS) add(c.x, c.z, c.r);
  for (const t of snowStory()) add(t.x, t.z, t.w);
  // The tree well round a buried spruce.
  for (const t of snowSaplings()) add(t.x, t.z, 0.45 + t.s * 1.6);
  return (scoopsMemo = out);
}
