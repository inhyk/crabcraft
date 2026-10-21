// Frostlight's open snowfields, numbers only: where the groves, boulders, dead trees, logs, ponds, tracks, scoured
// crests, ice shelves and the small abandoned scenes stand. Shared by the rendered island (snowFields.ts) and the
// collision bake (world4Colliders.ts), so every solid has its collider. Deterministic: every client and the server
// place the same pieces.
import { snowHeight } from '../sim/world/ground';
import { SNOW_POINTS } from '../sim/data/quests';
import { SNOW_ROCKS, SNOW_WIND } from '../sim/world/snowGround';
import { frostRoadEdgeDist } from '../sim/world/snowLayout';
import type { Collision } from '../world/collision';
import { snowTrees } from './world4Colliders';
import { frostEnemyHomes, iceCliffs } from './frostCliffsLayout';

type Height = (x: number, z: number) => number;
type XZ = [number, number];

/** Deterministic 0..1 stream. */
export function fieldStream(seed: number) { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }

/** The Frozen Throne worker's sites (forest shelter, ice overlook, aurora ridge): 10 m kept free around each. */
export const FIELD_SITES: readonly XZ[] = [[-50, 26], [61, 22], [0, -34]];
/** Monster start points, read from the server's World IV definition (frostCliffsLayout.ts), for any population. */
export const FIELD_HOMES: readonly XZ[] = frostEnemyHomes().filter(([, z]) => z > -140);
const QUEST: readonly XZ[] = Object.values(SNOW_POINTS) as XZ[];
let pinesMemo: XZ[] | null = null;
/** The 91 snowTrees() trunks, read lazily (world4Colliders.ts imports this module). */
const pines = () => (pinesMemo ??= snowTrees().map((t): XZ => [t.x, t.z]));
/** The ring of ice cliffs (frostCliffsLayout.ts), as the meshes and colliders place them. */
export const FIELD_CLIFFS: readonly XZ[] = iceCliffs().map((c): XZ => [c.x, c.z]);

// The terrain's veering wind (snowTerrain.ts snowWindField().x), so the drifts lie along the ground's own sastrugi.
const GX = [1, 0.92388, 0.70711, 0.38268, 0, -0.38268, -0.70711, -0.92388, -1, -0.92388, -0.70711, -0.38268, 0, 0.38268, 0.70711, 0.92388];
const GZ = [0, 0.38268, 0.70711, 0.92388, 1, 0.92388, 0.70711, 0.38268, 0, -0.38268, -0.70711, -0.92388, -1, -0.92388, -0.70711, -0.38268];
function gradIndex(ix: number, iz: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 28;
}
function noise(px: number, pz: number): number {
  const ix = Math.floor(px), iz = Math.floor(pz), fx = px - ix, fz = pz - iz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = gradIndex(ix, iz), b = gradIndex(ix + 1, iz), c = gradIndex(ix, iz + 1), d = gradIndex(ix + 1, iz + 1);
  const va = GX[a] * fx + GZ[a] * fz, vb = GX[b] * (fx - 1) + GZ[b] * fz, vc = GX[c] * fx + GZ[c] * (fz - 1), vd = GX[d] * (fx - 1) + GZ[d] * (fz - 1);
  return va + (vb - va) * ux + (vc - va) * uz + (va - vb - vc + vd) * ux * uz;
}
/** Bearing the wind blows toward at (x, z), radians in the x-z plane (0 is +x). */
export function windAt(x: number, z: number): number {
  return Math.atan2(SNOW_WIND[1], SNOW_WIND[0]) + noise(x * 0.0083 + 31.7, z * 0.0083 + 12.3) * 0.42;
}
/** Where the wind scoured the snow into sastrugi (snowWindField().z), 0..1. */
export function scourAt(x: number, z: number): number {
  const t = Math.min(1, Math.max(0, (noise(x * 0.021 + 3.3, z * 0.021 - 8.1) + 0.32) / 0.74));
  return t * t * (3 - 2 * t);
}

/** Island edge in units of the ellipse the walkable area is cut from (0.8 is the walkable limit). */
export const fieldEdge = (x: number, z: number) => Math.hypot(x / 128, (z - 2) / 155);
const near = (list: readonly XZ[], x: number, z: number, r: number) => list.some(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 < r * r);

/**
 * Whether a piece of footprint radius `r` may stand at (x, z). Everything keeps clear of the village, the roads
 * (4 m past the paved edge of the north road and the processional way, snowLayout.ts),
 * the arena, quest points (4 m), the throne sites (10 m) and the north beyond z = -90; solids also keep 6 m from
 * monster homes and clear of the pines, ice cliffs and crags.
 */
export function fieldClear(x: number, z: number, r: number, solid: boolean): boolean {
  return fieldBlock(x, z, r, solid) === null;
}
/** What keeps (x, z) from taking a piece of radius `r`, or null when it is free (fieldClear's reason, for QA). */
export function fieldBlock(x: number, z: number, r: number, solid: boolean): string | null {
  if (fieldEdge(x, z) > 0.78) return 'coast';
  if (z - r < -90) return 'north';
  if (Math.abs(x) - r <= 47 && z + r >= 23 && z - r <= 98) return 'village';
  if (frostRoadEdgeDist(x, z) - r < 4) return 'road';
  if (Math.hypot(x, z + 78) - r < 36) return 'arena';
  if (near(QUEST, x, z, 4 + r)) return 'quest';
  if (near(FIELD_SITES, x, z, 10 + r)) return 'site';
  if (!solid) return null;
  if (near(FIELD_HOMES, x, z, 6 + r)) return 'home';
  if (near(pines(), x, z, 1.4 + r)) return 'pine';
  if (near(FIELD_CLIFFS, x, z, 4.5 + r)) return 'cliff';
  for (const k of SNOW_ROCKS) if (Math.hypot(x - k.x, z - k.z) < k.r + 1 + r) return 'crag';
  return null;
}

/** The nearest free spot to (x, z) within `reach` metres, searched on a spiral; null when there is none. */
export function fieldSettle(x: number, z: number, r: number, solid: boolean, reach = 8): XZ | null {
  if (fieldClear(x, z, r, solid)) return [x, z];
  for (let d = 0.5; d <= reach; d += 0.5) for (let k = 0, n = Math.ceil(d * 4); k < n; k++) {
    const a = (k / n) * Math.PI * 2 + d, px = +(x + Math.cos(a) * d).toFixed(2), pz = +(z + Math.sin(a) * d).toFixed(2);
    if (fieldClear(px, pz, r, solid)) return [px, pz];
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Extra pines: irregular groves, dense in the western Frostpine Woods the quests speak of, a few copses east.

interface Blob { x: number; z: number; rx: number; rz: number; yaw: number; n: number; seed: number; small?: number }
/** Grove outlines: an ellipse broken by a noisy edge. `small` is the share of young pines. */
const GROVES: readonly Blob[] = [
  // Frostpine Woods, round the frost blossoms and the shelter (which keep their clearings).
  { x: -64, z: 40, rx: 11, rz: 15, yaw: 0.3, n: 13, seed: 1 },
  { x: -60, z: 70, rx: 10, rz: 13, yaw: -0.4, n: 9, seed: 2 },
  { x: -54, z: 96, rx: 8, rz: 8, yaw: 0.2, n: 5, seed: 3, small: 0.5 },
  { x: -74, z: 6, rx: 7, rz: 11, yaw: 0.1, n: 8, seed: 4 },
  { x: -66, z: -28, rx: 8, rz: 11, yaw: -0.3, n: 9, seed: 5 },
  { x: -34, z: -66, rx: 8, rz: 6, yaw: 0.6, n: 6, seed: 6, small: 0.4 },
  { x: -30, z: 12, rx: 6, rz: 5, yaw: 0.4, n: 5, seed: 7, small: 0.6 },
  // A few copses on the open east side.
  { x: 84, z: 32, rx: 6, rz: 9, yaw: 0.2, n: 6, seed: 8, small: 0.3 },
  { x: 64, z: 98, rx: 7, rz: 6, yaw: -0.5, n: 6, seed: 9, small: 0.4 },
  { x: 26, z: 112, rx: 7, rz: 5, yaw: 0.1, n: 4, seed: 10, small: 0.5 },
  { x: 40, z: -60, rx: 5, rz: 5, yaw: 0, n: 4, seed: 11, small: 0.5 },
];

function sampleBlob(b: Blob, spacing: number, accept: (x: number, z: number, i: number) => boolean): XZ[] {
  const R = fieldStream(b.seed * 7919 + 17), out: XZ[] = [];
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  for (let tries = 0; tries < b.n * 40 && out.length < b.n; tries++) {
    const a = R() * Math.PI * 2, rr = Math.sqrt(R());
    // Lobed edge so no grove is an ellipse.
    const lobe = 0.75 + 0.25 * Math.sin(a * 3 + b.seed) + 0.12 * Math.sin(a * 5 + b.seed * 2.3);
    const lx = Math.cos(a) * rr * b.rx * lobe, lz = Math.sin(a) * rr * b.rz * lobe;
    const x = b.x + c * lx + s * lz, z = b.z - s * lx + c * lz;
    if (out.some(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 < spacing * spacing)) continue;
    if (!accept(x, z, out.length)) continue;
    out.push([x, z]);
  }
  return out;
}

let grovesMemo: { x: number; z: number; s: number }[] | null = null;
/** The extra pines, in the same {x, z, s} form as snowTrees(); s scales the 10.2 m kit pine. */
export function snowGroves() {
  if (grovesMemo) return grovesMemo;
  const out: { x: number; z: number; s: number }[] = [];
  for (const b of GROVES) {
    const R = fieldStream(b.seed * 31 + 5);
    for (const [x, z] of sampleBlob(b, 3.4, (x, z) => fieldClear(x, z, 1.6, true) && !out.some((t) => Math.hypot(t.x - x, t.z - z) < 3.2))) {
      const d = Math.hypot((x - b.x) / b.rx, (z - b.z) / b.rz);
      // Tall in the heart of a grove, young pines on its margins.
      const young = R() < (b.small ?? 0.25) + 0.35 * d;
      out.push({ x: +x.toFixed(2), z: +z.toFixed(2), s: +(young ? 0.42 + R() * 0.25 : 0.85 + R() * 0.4 - 0.15 * d).toFixed(3) });
    }
  }
  return (grovesMemo = out);
}

// ---------------------------------------------------------------------------------------------------------------
// Boulders in the crags' own stone (snowRocks.ts), small enough to read as rock, not as a kit primitive.

export interface FieldBoulder { x: number; z: number; r: number; h: number; yaw: number; seed: number }
const ROCKFIELDS: readonly (Blob & { min: number; max: number })[] = [
  // The eastern diggings: frostiron "among the rocks of the eastern snowfields".
  { x: 40, z: -12, rx: 10, rz: 16, yaw: 0.2, n: 9, seed: 21, min: 0.5, max: 1.5 },
  { x: 46, z: -40, rx: 6, rz: 6, yaw: 0, n: 4, seed: 22, min: 0.6, max: 1.3 },
  { x: 74, z: -6, rx: 6, rz: 10, yaw: 0, n: 5, seed: 23, min: 0.6, max: 1.6 },
  // West: the woodcutter's slope and the forest floor.
  { x: -28, z: -36, rx: 6, rz: 6, yaw: 0, n: 3, seed: 24, min: 0.5, max: 1.1 },
  { x: -66, z: 52, rx: 8, rz: 8, yaw: 0, n: 4, seed: 25, min: 0.6, max: 1.2 },
  { x: -24, z: -44, rx: 6, rz: 6, yaw: 0, n: 3, seed: 26, min: 0.5, max: 1.0 },
  // Shore boulders where the drifts fall to the frozen sea.
  { x: 96, z: 10, rx: 4, rz: 14, yaw: 0, n: 5, seed: 27, min: 0.7, max: 1.8 },
  { x: -96, z: -16, rx: 4, rz: 14, yaw: 0, n: 5, seed: 28, min: 0.7, max: 1.8 },
  { x: 66, z: 104, rx: 12, rz: 4, yaw: -0.6, n: 4, seed: 29, min: 0.6, max: 1.5 },
  { x: -70, z: 104, rx: 12, rz: 4, yaw: 0.6, n: 4, seed: 30, min: 0.6, max: 1.5 },
  { x: 86, z: 70, rx: 6, rz: 6, yaw: 0, n: 3, seed: 31, min: 0.5, max: 1.1 },
  { x: 12, z: -28, rx: 4, rz: 6, yaw: 0, n: 2, seed: 32, min: 0.5, max: 0.9 },
];
let bouldersMemo: FieldBoulder[] | null = null;
export function snowBoulders(): FieldBoulder[] {
  if (bouldersMemo) return bouldersMemo;
  const out: FieldBoulder[] = [];
  for (const f of ROCKFIELDS) {
    const R = fieldStream(f.seed * 131 + 7);
    const sizes: number[] = [];
    const pts = sampleBlob(f, 2.6, (x, z, i) => {
      // The first of a field is its largest; the rest scatter smaller round it.
      const r = sizes[i] ?? (sizes[i] = i === 0 ? f.max : f.min + (f.max - f.min) * R() * 0.8);
      return fieldClear(x, z, r * 1.1, true) && !out.some((b) => Math.hypot(b.x - x, b.z - z) < b.r + r + 0.6);
    });
    pts.forEach(([x, z], j) => {
      const r = sizes[j];
      out.push({ x: +x.toFixed(2), z: +z.toFixed(2), r: +r.toFixed(2), h: +(r * (0.55 + R() * 0.5)).toFixed(2), yaw: +(R() * 6.283).toFixed(3), seed: f.seed * 100 + j });
    });
  }
  return (bouldersMemo = out);
}

/** Stone spills on the windward side of the crests (centre x, z, half extents x, z, count, seed), in the wide views' open slopes. */
const STONE_SPILLS: readonly [number, number, number, number, number, number][] = [
  [-39.6, -2.6, 2.6, 4.2, 16, 1],
  // Talus below the woodcutter's crag.
  [-34.2, -7.6, 2.6, 3.6, 20, 2],
];

/** Stones too small to stand in the way: a few round each boulder field, the crags' stone again. Never solid. */
let pebblesMemo: FieldBoulder[] | null = null;
export function snowPebbles(): FieldBoulder[] {
  if (pebblesMemo) return pebblesMemo;
  const out: FieldBoulder[] = [];
  const R = fieldStream(4242);
  for (const b of snowBoulders()) {
    const n = Math.floor(R() * 3.2);
    for (let k = 0; k < n; k++) {
      const a = R() * 6.283, d = b.r + 0.35 + R() * 1.4, x = b.x + Math.cos(a) * d, z = b.z + Math.sin(a) * d, r = 0.14 + R() * 0.22;
      if (!fieldClear(x, z, r, false) || out.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r + 0.3)) continue;
      out.push({ x: +x.toFixed(2), z: +z.toFixed(2), r: +r.toFixed(2), h: +(r * (0.35 + R() * 0.3)).toFixed(2), yaw: +(R() * 6.283).toFixed(3), seed: 9000 + out.length });
    }
  }
  // Scree on the windward slopes the wind strips bare to feed the cornices on their lee: a loose spill of stones down
  // the slope, larger at its head.
  for (const [cx, cz, rx, rz, n, seed] of STONE_SPILLS) {
    const S = fieldStream(seed * 613 + 1);
    for (let k = 0, tries = 0; k < n && tries < n * 12; tries++) {
      const a = S() * Math.PI * 2, d = Math.sqrt(S()), x = cx + Math.cos(a) * d * rx, z = cz + Math.sin(a) * d * rz;
      const r = (0.13 + S() * S() * 0.3) * (1.3 - d * 0.5);
      if (!fieldClear(x, z, r, false) || out.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r + 0.35)) continue;
      out.push({ x: +x.toFixed(2), z: +z.toFixed(2), r: +r.toFixed(2), h: +(r * (0.35 + S() * 0.35)).toFixed(2), yaw: +(S() * 6.283).toFixed(3), seed: 9000 + out.length });
      k++;
    }
  }
  // Stones breaking through where the wind scoured the crust thin, in loose scatters, never a sprinkle.
  for (let gz = -84; gz <= 116; gz += 2.6) for (let gx = -96; gx <= 96; gx += 2.6) {
    const x = gx + (R() - 0.5) * 2.2, z = gz + (R() - 0.5) * 2.2, keep = scourAt(x, z) * (0.6 + 0.56 * noise(x * 0.11 + 4.1, z * 0.11 - 2.7)), roll = R();
    if (roll > Math.min(1, Math.max(0, (keep - 0.3) / 0.5)) * 0.5) continue;
    const r = 0.1 + R() * R() * 0.32;
    if (!fieldClear(x, z, r, false) || out.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r + 0.4)) continue;
    out.push({ x: +x.toFixed(2), z: +z.toFixed(2), r: +r.toFixed(2), h: +(r * (0.3 + R() * 0.35)).toFixed(2), yaw: +(R() * 6.283).toFixed(3), seed: 9000 + out.length });
  }
  return (pebblesMemo = out);
}

// ---------------------------------------------------------------------------------------------------------------
// Kit pieces: dead and twisted trees, bushes and ferns through the snow, and the small abandoned scenes.

export type FieldKit = 'nature' | 'props' | 'village';
export type FieldSolid = { r: number; h: number } | { hx: number; hz: number; h: number };
export interface FieldPiece {
  kit: FieldKit;
  piece: string;
  x: number;
  z: number;
  yaw: number;
  s: number;
  /** Metres the origin sits below the snow. */
  sink: number;
  pitch?: number;
  roll?: number;
  solid?: FieldSolid;
  /** Dropped on low quality (small, non-solid dressing). */
  fine?: boolean;
}

/** Old miners' trail from the north road to the eastern diggings: the posts that still show. */
export const MINERS_TRAIL: readonly XZ[] = [[13, -17], [18, -20.5], [23, -24], [28, -28], [33, -31], [38, -33.5]];
/** The abandoned ore wagon at the end of the trail. */
export const ORE_WAGON = { x: 44, z: -36.5, yaw: 2.5 } as const;
/** The woodcutter's clearing at the edge of the Frostpine Woods. */
export const WOODCUT = { x: -35, z: -28 } as const;
/** The woodcutter's lantern: a stake driven into a stump by the block (snowStumps()), the lantern hung out over the clearing. */
export const WOODCUT_LANTERN = { x: WOODCUT.x + 4.8, z: WOODCUT.z - 1.4, stump: 0.5, pole: 1.55, yaw: -1.29, s: 0.62 } as const;
/** Lone hero trees: silhouettes on the crests. */
const HERO_TREES: readonly [string, number, number, number, number][] = [
  ['TwistedTree_1', 58.5, -25, 0.4, 0.42],
  ['TwistedTree_3', -52, -48, 2.2, 0.38],
  ['DeadTree_3', -37.5, -18.5, 3.4, 0.42],
  ['DeadTree_2', 26, -6, 1.3, 0.5],
  ['DeadTree_1', -28, -24, 4.0, 0.52],
  ['DeadTree_3', 78, 46, 0.8, 0.45],
  ['TwistedTree_2', -74, 82, 3.1, 0.36],
  ['DeadTree_1', 60, -46, 2.5, 0.45],
  ['DeadTree_2', -68, -46, 5.1, 0.44],
  ['DeadTree_3', 36, 108, 1.9, 0.4],
  ['TwistedTree_1', -28, 108, 5.6, 0.32],
];

let piecesMemo: FieldPiece[] | null = null;
export function snowFieldPieces(): FieldPiece[] {
  if (piecesMemo) return piecesMemo;
  const out: FieldPiece[] = [];
  const add = (p: FieldPiece) => { out.push(p); };
  for (const [piece, hx, hz, yaw, s] of HERO_TREES) {
    const at = fieldSettle(hx, hz, 1.2, true, 4);
    if (!at) continue;
    const [x, z] = at;
    // Bark only: the twisted trees stand bare through the winter.
    add({ kit: 'nature', piece, x, z, yaw, s, sink: 0.25, solid: { r: 0.55 * s * 2, h: 9 * s } });
  }
  // The miners' trail: fence segments drifted in to the lower rail, some leaning, gaps where they have gone.
  MINERS_TRAIL.forEach(([x, z], i) => {
    const next = MINERS_TRAIL[Math.min(i + 1, MINERS_TRAIL.length - 1)], prev = MINERS_TRAIL[Math.max(i - 1, 0)];
    const yaw = Math.atan2(-(next[1] - prev[1]), next[0] - prev[0]);
    const R = fieldStream(400 + i);
    add({ kit: 'village', piece: i % 2 ? 'Prop_WoodenFence_Extension1' : 'Prop_WoodenFence_Single', x, z, yaw: yaw + (R() - 0.5) * 0.25, s: 1, sink: 0.12 + R() * 0.1, pitch: (R() - 0.5) * 0.12, roll: (R() - 0.5) * 0.3, solid: { hx: 1.05, hz: 0.14, h: 0.8 } });
  });
  // The ore wagon, its near wheels sunk, crates spilled behind it, its tools dropped.
  {
    const { x, z, yaw } = ORE_WAGON, c = Math.cos(yaw), s = Math.sin(yaw);
    const at = (lx: number, lz: number): XZ => [x + c * lx + s * lz, z - s * lx + c * lz];
    add({ kit: 'village', piece: 'Prop_Wagon', x, z, yaw, s: 1, sink: 0.38, pitch: -0.05, roll: 0.11, solid: { hx: 1.05, hz: 2.05, h: 1.4 } });
    const [ax, az] = at(1.9, -1.2); add({ kit: 'props', piece: 'Crate_Wooden', x: ax, z: az, yaw: yaw + 0.5, s: 1, sink: 0.3, roll: 0.35, solid: { hx: 0.45, hz: 0.45, h: 0.8 } });
    const [bx, bz] = at(2.6, 0.2); add({ kit: 'props', piece: 'Crate_Wooden', x: bx, z: bz, yaw: yaw - 0.2, s: 0.9, sink: 0.45, pitch: 0.9, solid: { hx: 0.45, hz: 0.45, h: 0.7 } });
    const [cx, cz] = at(-1.8, 1.6); add({ kit: 'props', piece: 'Barrel', x: cx, z: cz, yaw: yaw + 1.2, s: 1, sink: 0.12, roll: Math.PI / 2, solid: { r: 0.5, h: 0.7 } });
    const [dx, dz] = at(1.4, 2.4); add({ kit: 'props', piece: 'Pickaxe_Bronze', x: dx, z: dz, yaw: yaw + 0.3, s: 1, sink: 0.3, pitch: 0.35, fine: true });
    const [ex, ez] = at(-1.6, -1.4); add({ kit: 'props', piece: 'Chain_Coil', x: ex, z: ez, yaw: 0.7, s: 1, sink: 0.02, fine: true });
  }
  // A lantern dropped on the trail, its glass to the sky.
  add({ kit: 'props', piece: 'Lantern_Wall', x: 29.5, z: -25.2, yaw: 0.9, s: 0.75, sink: 0.08, pitch: -1.35, fine: true });
  // The woodcutter's clearing: an axe left in the block, a bucket and a coil of rope on a stump, a lantern on a stake; logs and stumps are in snowLogs().
  {
    const { x, z } = WOODCUT;
    add({ kit: 'props', piece: 'Axe_Bronze', x: x + 0.05, z: z + 0.05, yaw: 0.6, s: 1.1, sink: -0.62, pitch: 0.42, fine: false });
    add({ kit: 'props', piece: 'Rope_2', x: x + 2.6, z: z + 4.6, yaw: 1.3, s: 0.8, sink: -0.44, fine: true });
    add({ kit: 'props', piece: 'Bucket_Wooden_1', x: x - 1.6, z: z + 1.0, yaw: 0.3, s: 1, sink: 0.08, roll: 1.4, fine: true });
    // The lantern on its stake: the kit's wall lantern, its bracket at the stake's head (1.42 m tall at scale 1).
    const L = WOODCUT_LANTERN;
    add({ kit: 'props', piece: 'Lantern_Wall', x: L.x, z: L.z, yaw: L.yaw, s: L.s, sink: -(L.stump + L.pole - 1.42 * L.s - 0.05) });
  }
  return (piecesMemo = out);
}

// ---------------------------------------------------------------------------------------------------------------
// Half-buried story: what the trappers and carters left on the open fields, going under the drifts. Built from
// worked timber in snowFields.ts.

export interface FieldStory {
  kind: 'sled' | 'wheel' | 'runner' | 'fence';
  x: number;
  z: number;
  yaw: number;
  /** Euler angles as kit.ts trs() takes them: pitch about local x, roll about local z (a wheel's axle), radians. */
  roll: number;
  pitch: number;
  /** Metres the piece sits below the snow. */
  sink: number;
  seed: number;
  /** Half width it shows the wind, and the height of the drift it banks (snowDriftsLayout.ts). */
  w: number;
  drift: number;
  solid?: FieldSolid;
  /** Fence lengths: metres from post to post, the post heights over the snow at either end, and whether its rail is gone. */
  len?: number;
  posts?: [number, number];
  bare?: boolean;
}
let storyMemo: FieldStory[] | null = null;
export function snowStory(): FieldStory[] {
  if (storyMemo) return storyMemo;
  const all: FieldStory[] = [
    // A trapper's hand sled on the flats before the diggings, its tail under the drift, the curled runners up.
    { kind: 'sled', x: 35.2, z: -6.2, yaw: 0.55, roll: 0.12, pitch: 0.16, sink: 0.22, seed: 1, w: 0.55, drift: 0.3, solid: { hx: 1.15, hz: 0.5, h: 0.45 } },
    // A cart wheel frozen in on the woodcutter's lee slope, leaning back against the drift, its foot under the snow.
    { kind: 'wheel', x: -30.2, z: -16.6, yaw: -0.15, roll: 0.4, pitch: -0.38, sink: 0.12, seed: 2, w: 0.5, drift: 0.3, solid: { r: 0.55, h: 0.6 } },
    // A sled runner curling out of the drift below the crest.
    { kind: 'runner', x: -33.6, z: -11.4, yaw: -0.4, roll: 0.34, pitch: 0.5, sink: 0.1, seed: 3, w: 0.2, drift: 0.14 },
    // Another sled on the eastern field, beyond the overlook's path.
    { kind: 'sled', x: 70.5, z: 50.5, yaw: -0.9, roll: -0.2, pitch: 0.12, sink: 0.3, seed: 4, w: 0.55, drift: 0.3, solid: { hx: 1.15, hz: 0.5, h: 0.4 } },
    { kind: 'wheel', x: -62.5, z: -2.5, yaw: -0.5, roll: 1.9, pitch: 1.12, sink: 0.1, seed: 5, w: 0.5, drift: 0.28, solid: { r: 0.55, h: 0.6 } },
    // The drifted fence, length by length: its posts leaning with the snow's creep, a rail sagging between them.
    ...DRIFTED_FENCE.slice(1).map(([bx, bz], i): FieldStory => {
      const [ax, az] = DRIFTED_FENCE[i], R = fieldStream(500 + i), len = Math.hypot(bx - ax, bz - az), yaw = Math.atan2(-(bz - az), bx - ax);
      const across = Math.abs(Math.sin(-yaw - windAt(ax, az)));
      return { kind: 'fence', x: +((ax + bx) / 2).toFixed(2), z: +((az + bz) / 2).toFixed(2), yaw: +yaw.toFixed(3), roll: 0, pitch: 0, sink: 0, seed: 10 + i, w: +((len / 2) * across).toFixed(2), drift: 0.26, len: +len.toFixed(2), posts: [+(0.42 + R() * 0.3).toFixed(2), +(0.42 + R() * 0.3).toFixed(2)], bare: i === 2, ...(i === 2 ? {} : { solid: { hx: len / 2, hz: 0.12, h: 0.6 } }) };
    }),
  ];
  // Each where it is put, or the nearest free spot within a few metres (a fence stays in its line or goes).
  return (storyMemo = all.flatMap((t) => {
    if (t.kind === 'fence') return fieldClear(t.x, t.z, t.len! / 2, true) ? [t] : [];
    const at = fieldSettle(t.x, t.z, t.solid ? ('r' in t.solid ? t.solid.r : t.solid.hx) : 0.4, !!t.solid, 6);
    return at ? [{ ...t, x: at[0], z: at[1] }] : [];
  }));
}

/** Young spruce buried to the shoulders in small groups: (centre x, z, count, spread). */
const SAPLING_GROUPS: readonly [number, number, number, number][] = [
  [31.3, -11.3, 4, 1.6], [-28.6, -19, 3, 1.4], [-32.2, -13.8, 3, 1.2], [-38.2, -8.6, 3, 1.5], [26, 16, 3, 1.5], [-56, 8, 4, 1.8], [66, -30, 3, 1.4], [-60, -12, 3, 1.5],
  [74, 40, 4, 1.8], [-70, 30, 3, 1.5], [52, -46, 3, 1.4], [-44, -48, 3, 1.5], [40, 96, 4, 1.8], [-36, 104, 3, 1.5],
];
/** A young spruce drowned in the drifts: a kit pine (snowPines.ts) of scale `s`, `sink` metres of it under the snow. */
export interface FieldSapling { x: number; z: number; s: number; sink: number; seed: number }
/** Height of the kit pine at s = 1 (snowPines.ts TREE_HEIGHT). */
const PINE_HEIGHT = 10.2;
let saplingsMemo: FieldSapling[] | null = null;
/** Only the tops of young spruce show above the snow, a few to a group: dark green where the open fields are emptiest. */
export function snowSaplings(): FieldSapling[] {
  if (saplingsMemo) return saplingsMemo;
  const out: FieldSapling[] = [];
  SAPLING_GROUPS.forEach(([cx, cz, n, spread], g) => {
    const R = fieldStream(700 + g);
    for (let k = 0, tries = 0; k < n && tries < 40; tries++) {
      const a = R() * Math.PI * 2, d = (k === 0 ? 0 : 0.7 + R()) * spread * 0.7, x = +(cx + Math.cos(a) * d).toFixed(2), z = +(cz + Math.sin(a) * d).toFixed(2);
      if (!fieldClear(x, z, 0.8, true) || out.some((o) => Math.hypot(o.x - x, o.z - z) < 1.3)) continue;
      // The first of a group stands tallest; what shows is the top metre or two, the rest is under the drift.
      const s = +(k === 0 ? 0.36 + R() * 0.08 : 0.2 + R() * 0.14).toFixed(3), show = k === 0 ? 1.5 + R() * 0.5 : 0.7 + R() * 0.7;
      out.push({ x, z, s, sink: +(PINE_HEIGHT * s - show).toFixed(2), seed: g * 10 + k });
      k++;
    }
  });
  return (saplingsMemo = out);
}

/** An old fence line across the woodcutter's lee slope, drifted in to its top rail, one of its lengths gone. */
const DRIFTED_FENCE: readonly XZ[] = [[-33.6, -22.6], [-32.8, -20.5], [-32.05, -18.4], [-31.3, -16.3], [-30.6, -14.2]];

// ---------------------------------------------------------------------------------------------------------------
// Scrub (snowScrub.ts): dry grass and dwarf willow through the snow, sparse and in the lee of something, and the
// cloth the miners tied to their trail's posts. Never solid.

export interface FieldScrub { kind: 'grass' | 'twig' | 'cloth'; x: number; z: number; yaw: number; s: number; seed: number; knot?: number; post?: number; dye?: number; fine?: boolean }
/** Where on a trail fence the cloth is knotted: the post at its local -x end, a hand below the top. */
export const TRAIL_KNOT = { x: -0.95, y: 0.68 } as const;
let scrubMemo: FieldScrub[] | null = null;
export function snowScrubItems(h: Height = snowHeight): FieldScrub[] {
  if (scrubMemo) return scrubMemo;
  const out: FieldScrub[] = [];
  const R = fieldStream(9090);
  const put = (kind: FieldScrub['kind'], x: number, z: number, s: number, fine: boolean) => {
    if (!fieldClear(x, z, 0.5, false)) return;
    if (out.some((o) => o.kind !== 'cloth' && Math.hypot(o.x - x, o.z - z) < 0.9)) return;
    out.push({ kind, x: +x.toFixed(2), z: +z.toFixed(2), yaw: +(R() * 6.283).toFixed(3), s: +s.toFixed(2), seed: out.length + 1, fine });
  };
  // In the lee of boulders (downwind, +x): a tuft or two where the drift is shallow, willow by the big ones.
  for (const b of snowBoulders()) {
    if (R() < 0.35) continue;
    const a = (R() - 0.5) * 1.8, d = b.r + 0.4 + R() * 0.8;
    put(b.r > 1.1 && R() < 0.5 ? 'twig' : 'grass', b.x + Math.cos(a) * d, b.z + Math.sin(a) * d, 0.95 + R() * 0.55, false);
    if (R() < 0.4) put('grass', b.x + Math.cos(a + 0.7) * (d + 0.5), b.z + Math.sin(a + 0.7) * (d + 0.5), 0.6 + R() * 0.4, true);
  }
  // Willow at the margins of the groves and round the lone trees.
  snowGroves().forEach((t, i) => {
    if (i % 5) return;
    const a = R() * 6.283, d = 2 + R() * 1.5;
    put('twig', t.x + Math.cos(a) * d, t.z + Math.sin(a) * d, 0.9 + R() * 0.6, i % 10 !== 0);
  });
  for (const p of snowFieldPieces()) if (/Tree/.test(p.piece)) { const a = R() * 6.283; put(R() < 0.5 ? 'twig' : 'grass', p.x + Math.cos(a) * 1.4, p.z + Math.sin(a) * 1.4, 0.8 + R() * 0.4, false); }
  // Dry grass through the scree.
  for (const [cx, cz, rx, rz, n] of STONE_SPILLS) for (let k = 0; k < Math.ceil(n / 4); k++) { const a = R() * 6.283, d = Math.sqrt(R()); put(R() < 0.7 ? 'grass' : 'twig', cx + Math.cos(a) * d * rx, cz + Math.sin(a) * d * rz, 0.8 + R() * 0.5, k > 1); }
  // Willow and dry grass round the buried spruce and the half-buried things.
  for (const p of snowSaplings()) if (R() < 0.6) { const a = R() * 6.283, d = 0.8 + R() * 0.8; put(R() < 0.6 ? 'twig' : 'grass', p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, 0.7 + R() * 0.5, false); }
  for (const t of snowStory()) for (let k = 0; k < 2; k++) { const a = R() * 6.283, d = t.w + 0.5 + R() * 0.7; put(k ? 'twig' : 'grass', t.x + Math.cos(a) * d, t.z + Math.sin(a) * d, 0.7 + R() * 0.4, k > 0); }
  // Dry grass through the scoured crust, in a few clumps rather than a sprinkle.
  for (const sc of snowScours(h)) {
    const G = fieldStream(sc.seed * 97 + 1), c = Math.cos(sc.yaw), sn = Math.sin(sc.yaw);
    for (let k = 0; k < 5; k++) {
      const lx = (G() * 2 - 1) * 0.6 * sc.rx, lz = (G() * 2 - 1) * 0.6 * sc.rz;
      put('grass', sc.x + c * lx + sn * lz, sc.z - sn * lx + c * lz, 0.7 + G() * 0.6, k > 2);
    }
  }
  // Scrub breaking the drifts in front of the western and eastern fields.
  for (const [x, z] of [[-39, -8], [-36, -12], [-41, -2], [38, -2], [32, -10], [27, 0]] as const) {
    put('grass', x, z, 0.9 + R() * 0.4, false);
    put(R() < 0.5 ? 'twig' : 'grass', x + 0.9 + R(), z + R() - 0.5, 0.7 + R() * 0.4, true);
  }
  // Rags of red and ochre cloth the miners tied to their trail posts, so the way showed in a whiteout.
  for (const p of snowFieldPieces()) {
    if (!/WoodenFence/.test(p.piece) || !MINERS_TRAIL.some(([x, z]) => x === p.x && z === p.z)) continue;
    // The knot through the fence's own placement (kit.ts trs: roll, then pitch, then yaw), without three.js here.
    const pr = p.pitch ?? 0, rl = p.roll ?? 0, kx = TRAIL_KNOT.x * p.s, ky = TRAIL_KNOT.y * p.s;
    const x1 = kx * Math.cos(rl) - ky * Math.sin(rl), y1 = kx * Math.sin(rl) + ky * Math.cos(rl);
    const y2 = y1 * Math.cos(pr), z2 = y1 * Math.sin(pr);
    const x = p.x + x1 * Math.cos(p.yaw) + z2 * Math.sin(p.yaw), z = p.z - x1 * Math.sin(p.yaw) + z2 * Math.cos(p.yaw), y = h(p.x, p.z) - p.sink + y2;
    out.push({ kind: 'cloth', x: +x.toFixed(3), z: +z.toFixed(3), yaw: p.yaw, s: 1, seed: out.length + 1, knot: +(y - h(x, z)).toFixed(3), post: 0.065, dye: out.filter((o) => o.kind === 'cloth').length % 3 === 1 ? 1 : 0 });
  }
  return (scrubMemo = out);
}

// ---------------------------------------------------------------------------------------------------------------
// Logs and stumps (bark and sawn rings, the village woodpiles' material).

export interface FieldLog { x: number; z: number; yaw: number; len: number; r: number; seed: number; sink: number; branches: number }
export interface FieldStump { x: number; z: number; r: number; h: number; seed: number }
export function snowLogs(): FieldLog[] {
  const { x, z } = WOODCUT;
  const logs: FieldLog[] = [
    // The felled trunk, sawn, waiting to be cut up; and a stack of three lengths beside the block.
    { x: x + 1.2, z: z - 4.6, yaw: 0.25, len: 7, r: 0.34, seed: 1, sink: 0.12, branches: 0 },
    { x: x + 3.8, z: z + 1.2, yaw: 1.2, len: 2.6, r: 0.24, seed: 2, sink: 0.06, branches: 0 },
    { x: x + 4.24, z: z + 1.37, yaw: 1.22, len: 2.5, r: 0.23, seed: 3, sink: 0.06, branches: 0 },
    { x: x + 4.02, z: z + 1.29, yaw: 1.16, len: 2.4, r: 0.22, seed: 4, sink: -0.36, branches: 0 },
    // Windfall in the woods and across the open slopes.
    ...([[-68, 26, 2.4, 6.5, 0.32, 4], [-58, 58, 0.6, 5.5, 0.28, 3], [-66, -8, 1.2, 6, 0.3, 3], [58, -44, 2.9, 5, 0.26, 3], [-60, 80, -0.4, 5.5, 0.3, 4], [78, 38, 0.9, 4.5, 0.25, 2]] as const).flatMap(([lx, lz, yaw, len, r, branches], i): FieldLog[] => {
      const at = fieldSettle(lx, lz, len / 2, true, 8);
      return at ? [{ x: at[0], z: at[1], yaw, len, r, seed: 5 + i, sink: 0.12, branches }] : [];
    }),
  ];
  return logs.filter((l) => fieldClear(l.x, l.z, l.len / 2, true));
}
export function snowStumps(): FieldStump[] {
  const { x, z } = WOODCUT;
  const st: FieldStump[] = [
    // The chopping block the axe is in.
    { x, z, r: 0.42, h: 0.62, seed: 1 },
    { x: x + 2.6, z: z + 4.6, r: 0.36, h: 0.45, seed: 2 },
    { x: x - 1.8, z: z - 2.6, r: 0.4, h: 0.4, seed: 3 },
    { x: x + 4.8, z: z - 1.4, r: 0.33, h: 0.5, seed: 4 },
    { x: x - 1.2, z: z + 6.2, r: 0.38, h: 0.42, seed: 5 },
    { x: x + 6.2, z: z + 3.4, r: 0.31, h: 0.36, seed: 6 },
    { x: -62, z: 34, r: 0.36, h: 0.5, seed: 7 },
    { x: -70, z: 62, r: 0.33, h: 0.4, seed: 8 },
    { x: 82, z: 26, r: 0.3, h: 0.44, seed: 9 },
  ];
  return st.filter((s) => fieldClear(s.x, s.z, s.r + 0.4, true));
}

// ---------------------------------------------------------------------------------------------------------------
// Ponds, tracks, scoured crests: flat or painted, never solid.

/** Frozen ponds in the hollows: the ice settles at the hollow's floor, so the shore follows the drift. */
export const SNOW_PONDS: readonly { x: number; z: number; r: number; seed: number }[] = [
  { x: 54, z: -11, r: 5.5, seed: 3 },
  { x: -78, z: -6, r: 5, seed: 7 },
];

export interface FieldTrack { kind: 'fox' | 'hare' | 'deer'; points: readonly XZ[]; seed: number }
/** Animal trails: a fox from the eastern copse to the pond and round the wagon, a hare through the woods. */
export const SNOW_TRACKS: readonly FieldTrack[] = [
  { kind: 'fox', points: [[76, -26], [66, -22], [59, -16], [55, -14], [50, -18], [46, -26], [44, -30], [39, -30], [34, -34], [26, -36], [20, -32]], seed: 11 },
  { kind: 'hare', points: [[-60, -8], [-52, -14], [-49, -22], [-44, -30], [-40, -34], [-34, -30], [-30, -34], [-26, -42]], seed: 12 },
  { kind: 'deer', points: [[-70, 48], [-62, 52], [-56, 60], [-60, 74], [-66, 84]], seed: 13 },
  { kind: 'fox', points: [[70, 40], [76, 50], [80, 60], [74, 72], [70, 82]], seed: 14 },
  { kind: 'deer', points: [[30, -10], [24, -4], [20, 6], [22, 14], [28, 18]], seed: 15 },
  // A fox out of the juniper on the woodcutter's lee slope, past the frozen wheel, through the fence's gap and over
  // the crest towards the clearing.
  { kind: 'fox', points: [[-27.4, -20.6], [-29.4, -18.2], [-30.9, -17.4], [-32.1, -18.5], [-33.6, -19.2], [-35.6, -20.6], [-36.8, -23.2], [-36, -25.6]], seed: 16 },
  // A hare from the juniper before the diggings, across the sastrugi to the sled and on to the rocks.
  { kind: 'hare', points: [[29.4, -13.6], [31, -11.6], [32.9, -9.4], [34.4, -7.4], [36.6, -5.6], [38.6, -7.4], [39.4, -9.8]], seed: 17 },
];

/** Crests the wind has scoured to frozen ground, with dry grass through the crust. */
export interface FieldScour { x: number; z: number; rx: number; rz: number; yaw: number; seed: number }

// ---------------------------------------------------------------------------------------------------------------
// Ice shelves and pressure ridges on the frozen sea (outside the walkable island, never solid).

export interface ShelfSlab { x: number; z: number; w: number; d: number; t: number; yaw: number; pitch: number; roll: number; lift: number; seed: number }
/** Points on the coast, (angle round the island, how far out in edge units, and how many blocks). */
const SHELVES: readonly { a: number; out: number; len: number; seed: number }[] = [
  { a: 1.25, out: 0.955, len: 34, seed: 1 },
  { a: 1.62, out: 0.955, len: 26, seed: 2 },
  { a: 1.95, out: 0.96, len: 26, seed: 3 },
  { a: -1.35, out: 0.955, len: 32, seed: 4 },
  { a: -1.75, out: 0.955, len: 24, seed: 5 },
  { a: -2.1, out: 0.96, len: 24, seed: 6 },
  { a: 0.6, out: 0.96, len: 22, seed: 7 },
  { a: -0.7, out: 0.955, len: 24, seed: 8 },
  { a: 0.05, out: 0.965, len: 20, seed: 9 },
];
let shelvesMemo: ShelfSlab[] | null = null;
/** Broken shelf plates pushed up on the shore and the jumbled pressure ridge beside each, as slabs. */
export function snowShelves(): ShelfSlab[] {
  if (shelvesMemo) return shelvesMemo;
  const out: ShelfSlab[] = [];
  const push = (s: Omit<ShelfSlab, 'seed'>) => out.push({ ...s, seed: out.length + 1 });
  for (const sh of SHELVES) {
    const R = fieldStream(sh.seed * 977 + 3);
    // a runs round the island (x = 128 sin a, z = 2 + 155 cos a); t is metres along the shore.
    const along = (t: number, e: number): XZ => { const a = sh.a + t / 140; return [Math.sin(a) * 128 * e, 2 + Math.cos(a) * 155 * e]; };
    const tangent = (t: number) => { const [x0, z0] = along(t - 0.5, sh.out), [x1, z1] = along(t + 0.5, sh.out); return Math.atan2(-(z1 - z0), x1 - x0); };
    // Shelf plates: big tabular floes driven up against the shore, tilted, a few broken and stacked.
    for (let t = -sh.len / 2; t < sh.len / 2;) {
      const w = 4 + R() * 5, [x, z] = along(t + w / 2, sh.out - 0.014 + R() * 0.008), yaw = tangent(t + w / 2);
      const thick = 0.6 + R() * 0.8;
      push({ x, z, w, d: 3 + R() * 3, t: thick, yaw: yaw + (R() - 0.5) * 0.4, pitch: (R() - 0.25) * 0.4, roll: (R() - 0.5) * 0.25, lift: 0.05 + R() * 0.35 });
      if (R() < 0.45) { const [x2, z2] = along(t + w * 0.6, sh.out - 0.005); push({ x: x2, z: z2, w: w * 0.55, d: 2 + R() * 2, t: thick * 0.8, yaw: yaw + (R() - 0.5) * 0.9, pitch: (R() - 0.5) * 0.7, roll: 0.3 + R() * 0.4, lift: 0.5 + thick * 0.6 }); }
      t += w * (0.75 + R() * 0.45);
    }
    // Pressure ridge: rubble heaped where two floes met, farther out, in a wandering line; blocks up-ended against each other.
    for (let t = -sh.len / 2 - 4; t < sh.len / 2 + 4;) {
      const e = sh.out + 0.02 + Math.sin(t * 0.09 + sh.seed) * 0.005, [x, z] = along(t, e), yaw = tangent(t);
      const stack = 1 + Math.floor(R() * 2.4);
      for (let k = 0; k < stack; k++) {
        const w = 0.7 + R() * 1.5 + (k === 0 ? 0.4 : 0);
        push({ x: x + (R() - 0.5) * 1.4, z: z + (R() - 0.5) * 1.4, w, d: w * (0.5 + R() * 0.5), t: 0.22 + R() * 0.25, yaw: yaw + (R() - 0.5) * 0.8, pitch: (k === 0 ? 0.2 + R() * 0.4 : 0.6 + R() * 0.6) * (R() < 0.5 ? -1 : 1), roll: (R() - 0.5) * 0.6, lift: 0.1 + k * 0.45 + R() * 0.3 });
      }
      t += 0.9 + R() * 1.1;
    }
  }
  return (shelvesMemo = out);
}

/** Scoured crests, found where the relief stands proud of its surroundings and faces the wind. */
let scoursMemo: FieldScour[] | null = null;
export function snowScours(h: Height = snowHeight): FieldScour[] {
  if (scoursMemo) return scoursMemo;
  const cand: { x: number; z: number; p: number }[] = [];
  for (let z = -86; z <= 120; z += 3) for (let x = -100; x <= 100; x += 3) {
    if (!fieldClear(x, z, 4, false) || Math.abs(x) < 16 || near(pines(), x, z, 5) || near([[WOODCUT.x, WOODCUT.z], [ORE_WAGON.x, ORE_WAGON.z]], x, z, 12)) continue;
    const c = h(x, z);
    let m = 0;
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; m += h(x + Math.cos(a) * 7, z + Math.sin(a) * 7); }
    const p = c - m / 8;
    if (p > 0.6) cand.push({ x, z, p });
  }
  cand.sort((a, b) => b.p - a.p);
  const out: FieldScour[] = [];
  const R = fieldStream(5151);
  for (const c of cand) {
    if (out.length >= 8) break;
    if (out.some((s) => Math.hypot(s.x - c.x, s.z - c.z) < 26)) continue;
    // Stretched across the wind (SNOW_WIND runs along +x), as the crests are.
    out.push({ x: c.x, z: c.z, rx: 1.6 + R() * 1.0, rz: 3 + R() * 2.5, yaw: (R() - 0.5) * 0.5, seed: out.length + 1 });
  }
  return (scoursMemo = out);
}

// ---------------------------------------------------------------------------------------------------------------

/** Colliders for every solid in the fields. Circles for trees, stumps and boulders; boxes for logs and kit props. */
export function registerSnowFields(col: Collision, h: Height = snowHeight): void {
  for (const { x, z, s } of snowGroves()) { const y = h(x, z); col.addCircle(x, z, 0.6 * s, y, y + 10 * s); }
  for (const b of snowBoulders()) { const y = h(b.x, b.z); col.addCircle(b.x, b.z, b.r * 0.85, y - 1, y + b.h); }
  for (const p of snowFieldPieces()) {
    if (!p.solid) continue;
    const y = h(p.x, p.z);
    if ('r' in p.solid) col.addCircle(p.x, p.z, p.solid.r, y - 1, y + p.solid.h);
    else col.addBox(p.x, p.z, p.solid.hx, p.solid.hz, p.yaw, y - 1, y + p.solid.h);
  }
  // A log lies along its local x: yaw as in rotation.y.
  for (const l of snowLogs()) { const y = h(l.x, l.z); col.addBox(l.x, l.z, l.len / 2, l.r + 0.05, l.yaw, y - 1, y + l.r * 2 - l.sink + 0.2); }
  for (const s of snowStumps()) { const y = h(s.x, s.z); col.addCircle(s.x, s.z, s.r, y - 1, y + s.h); }
  // The buried spruce: only its top shows, but a crab walks round it.
  for (const t of snowSaplings()) { const y = h(t.x, t.z); col.addCircle(t.x, t.z, 0.35, y - 1, y + PINE_HEIGHT * t.s - t.sink); }
  // The half-buried sleds and wheels.
  for (const t of snowStory()) {
    if (!t.solid) continue;
    const y = h(t.x, t.z);
    if ('r' in t.solid) col.addCircle(t.x, t.z, t.solid.r, y - 1, y + t.solid.h);
    else col.addBox(t.x, t.z, t.solid.hx, t.solid.hz, t.yaw, y - 1, y + t.solid.h);
  }
}
