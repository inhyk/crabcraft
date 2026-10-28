import type {Collision} from '../sim/world/collision';

/*
 * World V's forge town plan, shared by the drawing (emberTown.ts) and the server's colliders (layoutEmberTown, called
 * from layoutFrontier for chapter 5 only). Pure numbers: the collision bake runs it in Node.
 * The six houses keep the old footprints (x = +-30, z = 38/56/74; their boxes stay in layoutFrontier); each faces the
 * avenue, so its door sits where its side road ends. House-local axes: lx along the front, lz out of the front.
 */

export type ForgeRole = 'smithy' | 'smelter' | 'inn' | 'armourer' | 'glassblower' | 'merchant';
export interface ForgeHouse { role: ForgeRole; x: number; z: number; side: -1 | 1; wall: number; rise: number; roof: 'copper' | 'iron'; seed: number }

export const FORGE_HOUSES: ForgeHouse[] = [
  {role: 'smithy', x: -30, z: 38, side: -1, wall: 5.2, rise: 3.6, roof: 'copper', seed: 1},
  {role: 'smelter', x: -30, z: 56, side: -1, wall: 5.6, rise: 3.4, roof: 'iron', seed: 2},
  {role: 'inn', x: -30, z: 74, side: -1, wall: 7.4, rise: 3.8, roof: 'copper', seed: 3},
  {role: 'armourer', x: 30, z: 38, side: 1, wall: 5.2, rise: 3.6, roof: 'iron', seed: 4},
  {role: 'glassblower', x: 30, z: 56, side: 1, wall: 5.4, rise: 3.6, roof: 'copper', seed: 5},
  {role: 'merchant', x: 30, z: 74, side: 1, wall: 5.8, rise: 3.4, roof: 'iron', seed: 6},
];
/** Footprint of every house (local x by local z), inside the 10.6 x 11.6 collider box. */
export const FORGE_W = 11, FORGE_D = 10;

/** House-local (lx, lz) to world (x, z). */
export function forgeLocal(h: ForgeHouse, lx: number, lz: number): [number, number] {
  return h.side > 0 ? [h.x - lz, h.z + lx] : [h.x + lz, h.z - lx];
}
/** Yaw that turns house-local +z (out of the front) towards the avenue. */
export const forgeYaw = (h: ForgeHouse) => h.side > 0 ? -Math.PI / 2 : Math.PI / 2;

/** Set pieces with fixed places (world). */
export const FORGE_YARD = {x: -46, z: 55};
export const FORGE_STALLS = [{x: -20, z: 22, side: -1 as const}, {x: 20, z: 22, side: 1 as const}];
/** Arrival quay south of the spawn: paved apron to the island's brow, its wall standing in the lava sea. */
export const FORGE_QUAY = {x0: -26, x1: 18, z0: 100, brow: 129, z1: 142};
export const FORGE_JETTY = {x: -6, half: 2.1, z0: 142, z1: 170};
export const FORGE_BARGE = {x: -.4, z: 156, len: 17, beam: 5.4};
export const FORGE_CRANE = {x: 12, z: 124};
export const FORGE_RAIL = {x: 6, z0: 102, z1: 123};
/** Avenue lanterns (the old lamp rows) and banner posts. */
export const FORGE_LANTERNS: [number, number][] = [];
for (let z = 82; z > -62; z -= 12) for (const side of [-1, 1]) FORGE_LANTERNS.push([side * 6, z]);
export const FORGE_BANNERS: [number, number][] = [];
for (const z of [76, 40, 10, -24]) for (const side of [-1, 1]) FORGE_BANNERS.push([side * 10, z]);

/** Yard pieces of each house (house-local): smelter shaft furnace, glass kiln. */
export const SMELTER_TOWER = {lx: -4.5, lz: 8.4, r: 1.45};
export const GLASS_KILN = {lx: -4.5, lz: 8.2, r: 1.35};

export interface ForgeSolid { x: number; z: number; r?: number; hx?: number; hz?: number; yaw?: number; h: number }
/** Solid set pieces the crab must walk round (not the small props). */
export function forgeSolids(): ForgeSolid[] {
  const out: ForgeSolid[] = [];
  const by = (role: ForgeRole) => FORGE_HOUSES.find(h => h.role === role)!;
  const [tx, tz] = forgeLocal(by('smelter'), SMELTER_TOWER.lx, SMELTER_TOWER.lz);
  out.push({x: tx, z: tz, r: SMELTER_TOWER.r, h: 8});
  const [kx, kz] = forgeLocal(by('glassblower'), GLASS_KILN.lx, GLASS_KILN.lz);
  out.push({x: kx, z: kz, r: GLASS_KILN.r, h: 3});
  out.push({x: FORGE_YARD.x, z: FORGE_YARD.z, hx: 1.8, hz: 1.3, yaw: 0, h: 3});
  for (const s of FORGE_STALLS) out.push({x: s.x, z: s.z, hx: 2.7, hz: 1.2, yaw: 0, h: 3});
  out.push({x: FORGE_CRANE.x, z: FORGE_CRANE.z, r: 1.5, h: 9});
  for (const z of [110, 117]) out.push({x: FORGE_RAIL.x, z, hx: .8, hz: 1.2, yaw: 0, h: 1.8});
  return out;
}

export function layoutEmberTown(col: Collision, heightAt: (x: number, z: number) => number) {
  for (const s of forgeSolids()) {
    const y = heightAt(s.x, s.z);
    if (s.r !== undefined) col.addCircle(s.x, s.z, s.r, y - 1, y + s.h);
    else col.addBox(s.x, s.z, s.hx!, s.hz!, s.yaw ?? 0, y - 1, y + s.h);
  }
}
