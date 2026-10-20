// Frostlight's way-cairns, numbers only: stone cairns with a pole, a lantern and dyed cloth streaming downwind,
// where the north road bends and out on the fields at the distance the player sees them. Shared by the meshes
// (frostCamps.ts, frostCairns.ts) and the colliders (world4Colliders.ts, baked for the server). Every spot passes
// fieldClear() (snowFieldsLayout.ts) at its radius: clear of roads, quest points, homes, pines and crags.
import { snowHeight } from '../sim/world/ground';
import type { Collision } from '../world/collision';

export interface WayCairn {
  x: number;
  z: number;
  /** Base radius of the cairn, metres. */
  r: number;
  /** Cloth dyes on its pole, the long streamer first (frostCairns.ts DYES). */
  dyes: readonly number[];
  /** Bearing its lantern hangs toward (radians, 0 is +z): the road, or the way a player comes. */
  face: number;
  seed: number;
}

export const WAY_CAIRNS: readonly WayCairn[] = [
  // The north road: the outside of its eastern bend and of its western bend toward the aurora ring.
  { x: 21.5, z: 1, r: 1.05, dyes: [0, 2, 3], face: -1.57, seed: 1 },
  { x: -11, z: -18.5, r: 1, dyes: [1, 2], face: 1.57, seed: 2 },
  // The fields east and west, at the distance a player crossing them sees them.
  { x: 46, z: -22, r: 1.1, dyes: [0, 3, 2], face: -.5, seed: 3 },
  { x: -48, z: -20, r: 1.1, dyes: [1, 2, 4], face: .6, seed: 4 },
  // On the crests behind them, against the sky.
  { x: 58, z: -34, r: 1, dyes: [1, 4], face: -.64, seed: 5 },
  { x: -54.6, z: -33.2, r: 1, dyes: [0, 2], face: .57, seed: 6 },
];

/** Each cairn as a circle up to its shoulder; the pole above it is thin enough to pass. */
export function registerWayCairns(col: Collision, h = snowHeight): void {
  for (const c of WAY_CAIRNS) { const y = h(c.x, c.z); col.addCircle(c.x, c.z, c.r, y - 1, y + 1.1); }
}
