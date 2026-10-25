// Frostlight's ring of ice cliffs round the north, numbers only: shared by the meshes (world4.ts), the colliders
// (world4Colliders.ts, baked for the server) and the fields' clearances (snowFieldsLayout.ts). The monsters' start
// points come from the server's own World IV definition, and a cliff that would stand on one moves off it.
import { createWorld4Definition } from '../sim/areas/world4';
import { snowHeight } from '../sim/world/ground';
import type { WorldQuery } from '../sim/types';
import { citadelClears } from './frostThroneLayout';

type XZ = [number, number];

/** A cliff's collider radius. */
export const CLIFF_R = 3.5;
/** How far a monster's start point stays from a cliff's centre: the collider, a crab's half metre and a metre more. */
const START_CLEAR = CLIFF_R + 1.5;

let homesMemo: readonly XZ[] | null = null;
/**
 * Every start point the server's World IV definition gives a monster, for any population it is hosted with: homes
 * go by slot, so a pool larger than any hosted one lists every slot.
 */
export function frostEnemyHomes(): readonly XZ[] {
  if (homesMemo) return homesMemo;
  const query: WorldQuery = { heightAt: snowHeight, resolveCollision: (x, z, _r, out) => out.set(x, z), raycastSolid: () => null };
  const def = createWorld4Definition({ query, fixedLevels: { scrapling: 1, scavenger: 1, jellyfish: 1, echo: 1 }, population: { scrapling: 16, scavenger: 16, jellyfish: 0, shallowPatrols: 16 } });
  return (homesMemo = def.enemies.map((e): XZ => [e.home.x, e.home.z]));
}

export interface IceCliff { i: number; x: number; z: number; h: number }
let cliffsMemo: IceCliff[] | null = null;
/** The cliffs in ring order (the meshes draw their shapes from one stream in this order), clear of the south gate and the citadel. */
export function iceCliffs(): readonly IceCliff[] {
  if (cliffsMemo) return cliffsMemo;
  const out: IceCliff[] = [];
  for (let i = 0; i < 42; i++) {
    const a = (i / 42) * Math.PI * 2;
    let x = Math.sin(a) * 78, z = -42 + Math.cos(a) * 70;
    if ((Math.abs(x) < 16 && z > -70) || citadelClears(x, z)) continue;
    // Off any start point: straight away from it, or out from the ring when the point is at the very centre.
    for (const [hx, hz] of frostEnemyHomes()) {
      const d = Math.hypot(x - hx, z - hz);
      if (d >= START_CLEAR) continue;
      const [ux, uz] = d > 1 ? [(x - hx) / d, (z - hz) / d] : [Math.sin(a), Math.cos(a)];
      // A centimetre over, so rounding never brings it back inside.
      x = +(hx + ux * (START_CLEAR + 0.01)).toFixed(2);
      z = +(hz + uz * (START_CLEAR + 0.01)).toFixed(2);
    }
    out.push({ i, x, z, h: 6 + (i % 5) * 3 });
  }
  return (cliffsMemo = out);
}
