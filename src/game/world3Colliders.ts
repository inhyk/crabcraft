// World III's colliders, registered without meshes, and the placements they share with the meshes.
// DawnIsland builds its collision this way; tools/bake-collision.mjs bakes the same registration.
import { dawnHeight } from '../sim/world/ground';
import { Collision } from '../world/collision';
import type { Lot } from '../world/layout';
import { registerDawnScenery } from './dawnScenery';
import { registerDawnHouses } from './dawnHousePlan';
import type { IslandPath } from './islandPaths';

export const DAWN_PATHS: IslandPath[] = [
  { points: [[0, 94], [0, 26], [0, -49]], width: 8.4, trim: true },
  { points: [[-26, 53], [26, 53]], width: 6, trim: true },
  { points: [[-5, 74], [-28, 75], [-50, 64], [-62, 48]], width: 2.6, trim: true },
  { points: [[4, 75], [28, 84], [48, 84], [61, 76]], width: 2.6, trim: true },
  ...[26, 45, 64, 83].flatMap((z) => [-1, 1].map((side) => ({ points: [[side * 4.2, z], [side * 29, z]] as [number, number][], width: 2.4, trim: false }))),
];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const roadClearance = (x: number, z: number) => {
  let best = Infinity;
  for (const path of DAWN_PATHS)
    for (let i = 1; i < path.points.length; i++) {
      const [ax, az] = path.points[i - 1],
        [bx, bz] = path.points[i],
        dx = bx - ax,
        dz = bz - az,
        t = clamp01(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz));
      best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t) - path.width / 2);
    }
  return best;
};

/** Dawnharbor's two sun gates (dawnPortal.ts): the arrival gate at the spawn and the road to Frostlight. */
export const DAWN_GATES = [{ x: -12, z: 84 }, { x: 14, z: 84 }] as const;
/** Half the distance between a gate's jambs, centre to centre. */
export const DAWN_GATE_JAMB = 3.1;

/** Quest lamps (dawnQuests.ts DAWN_POINTS dawn-lamp-*) the town's own lamps keep clear of. */
const QUEST_LAMPS: [number, number][] = [[-7, 20], [7, 0], [-7, -22]];
/**
 * Dawnharbor's road lamps: an iron post on a sandstone foot, its arm and lantern reaching over the road (yaw points
 * from the post to the lantern). Staggered down the avenue, paired at the squares and at the cross street.
 */
export function dawnLampPosts() {
  const posts: { x: number; z: number; yaw: number }[] = [];
  const edge = 4.2 + 0.75;
  const clear = (x: number, z: number) => QUEST_LAMPS.every(([qx, qz]) => Math.hypot(qx - x, qz - z) >= 5) && DAWN_PATHS.slice(1).every((p) => onPath(p, x, z) > 0.6);
  for (let i = 0; i < 10; i++) {
    const z = 88 - i * 13;
    if (Math.abs(z - 53) < 11) continue;
    // Alternate sides; a lamp that would stand in a side street or by a quest lamp crosses the road.
    for (const side of i % 2 ? [1, -1] : [-1, 1]) {
      if (!clear(side * edge, z)) continue;
      posts.push({ x: side * edge, z, yaw: side < 0 ? Math.PI / 2 : -Math.PI / 2 });
      break;
    }
  }
  // The town square's four corners, just off its ring, lanterns leaning in over the stones.
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) posts.push({ x: sx * 7.6, z: 53 + sz * 7.6, yaw: Math.atan2(-sx, -sz) });
  // The avenue's gate into the square from the harbour, and the arrival square's western edge.
  posts.push({ x: 4.95, z: 69.5, yaw: -Math.PI / 2 }, { x: -16.9, z: 79.2, yaw: Math.atan2(1, 0.45) });
  return posts;
}
const onPath = (path: IslandPath, x: number, z: number) => {
  let best = Infinity;
  for (let i = 1; i < path.points.length; i++) {
    const [ax, az] = path.points[i - 1], [bx, bz] = path.points[i], dx = bx - ax, dz = bz - az, t = clamp01(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t) - path.width / 2);
  }
  return best;
};

/** Volcanic rocks ringing the citadel, leaving the avenue open. */
export function dawnRocks() {
  const rocks: { i: number; x: number; z: number; r: number }[] = [];
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2,
      x = Math.sin(a) * 67,
      z = -45 + Math.cos(a) * 50;
    if (Math.abs(x) < 12) continue;
    rocks.push({ i, x, z, r: 2 + (i % 3) });
  }
  return rocks;
}

/** Dawnharbor's eight lots (homes, forge and tavern) on both sides of the avenue; dawnHousePlan.ts builds on them. */
export function dawnLots(): Lot[] {
  const lots: Lot[] = [];
  for (const side of [-1, 1])
    for (let i = 0; i < 4; i++) {
      const x = side * (i % 2 ? 38 : 35),
        z = 26 + i * 19;
      lots.push({ id: `dawn-${side}-${i}`, kind: i === 2 ? (side === 1 ? 'forge' : 'tavern') : 'house', x, z, yaw: side < 0 ? Math.PI / 2 : -Math.PI / 2, sx: i === 2 ? 4 : 3, sz: i === 2 ? 4 : 3, floors: i % 2 ? 2 : 1, // Plaster walls only (styles 2 and 3): limewashed upper storeys, no half-timbering as in World I.
        style: 2 + ((i + (side > 0 ? 1 : 0)) % 2), h: dawnHeight(x, z) });
    }
  return lots;
}

/** Leafy trees around the town, clear of roads, plazas, the lighthouse and the citadel. */
export function dawnForest() {
  const trees: { i: number; x: number; z: number; a: number; scale: number }[] = [];
  for (let i = 0; i < 75; i++) {
    // Thin alternate outer trees while keeping the existing clear paths and landmarks.
    if (i % 2 === 1) continue;
    const a = i * 2.39996,
      x = Math.sin(a) * (56 + (i % 5) * 5),
      z = 30 + Math.cos(a) * 66;
    if (roadClearance(x, z) < 4 || Math.abs(x) < 14 || Math.hypot(x - 67, z - 72) < 12 || Math.hypot(x, z + 72) < 32 || (Math.abs(x) > 28 && Math.abs(x) < 48 && z > 17 && z < 96)) continue;
    if ((Math.abs(z - (75 + (x + 5) * 0.15)) < 4 && x < 0 && x > -53) || (Math.abs(z - 84) < 5 && x > 14 && x < 61)) continue;
    trees.push({ i, x, z, a, scale: 0.75 + (i % 4) * 0.12 });
  }
  return trees;
}

/** A small grove in Seabreeze Gardens. */
export function dawnGrove() {
  const trees: { i: number; x: number; z: number; a: number }[] = [];
  for (let i = 0; i < 12; i++) {
    if (i % 2 === 1) continue;
    const a = i * 2.39996,
      x = -65 + Math.cos(a) * (7 + (i % 3) * 2),
      z = 45 + Math.sin(a) * (8 + (i % 4) * 2);
    if (Math.hypot(x + 62, z - 48) < 4 || roadClearance(x, z) < 3) continue;
    trees.push({ i, x, z, a });
  }
  return trees;
}

export function layoutDawnreach(): Collision {
  const h = dawnHeight;
  const col = new Collision({ minX: -150, minZ: -175, step: 2, nx: 151, nz: 176, h: new Float32Array(151 * 176), heightAt: h });
  // The citadel's flanking towers and the rock ring.
  for (const side of [-1, 1]) col.addCircle(side * 27, -56, 4.5, 4, 35);
  for (const { x, z, r } of dawnRocks()) {
    const y = h(x, z);
    col.addCircle(x, z, r + 1, y, y + 7);
  }
  for (const g of DAWN_GATES) for (const side of [-1, 1]) { const x = g.x + side * DAWN_GATE_JAMB; col.addCircle(x, g.z, 0.55, h(x, g.z), h(x, g.z) + 5.2); }
  for (const { x, z } of dawnLampPosts()) col.addCircle(x, z, 0.3, h(x, z), h(x, z) + 3.4);
  registerDawnScenery(h, col);
  // The desert quarter's blocks, stairs, palms and well (dawnHousePlan.ts); the lots stand inside it.
  registerDawnHouses(h, col);
  for (const { x, z, scale } of dawnForest()) col.addCircle(x, z, 0.5 * scale, h(x, z), h(x, z) + 10);
  for (const { x, z } of dawnGrove()) col.addCircle(x, z, 0.4, h(x, z), h(x, z) + 8);
  return col;
}
