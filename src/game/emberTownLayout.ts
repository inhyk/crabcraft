import type {Collision} from '../sim/world/collision';

/*
 * World V's forge town plan, shared by the drawing (emberTown.ts) and the server's colliders (layoutEmberTown, called
 * from layoutFrontier for chapter 5 only). Pure numbers: the collision bake runs it in Node.
 * One round furnace yard (centre FORGE_C) with the town's blast furnace in the middle; six houses ring it, each facing
 * the furnace, set by bearing `a` (degrees; 0 = north, 90 = east) and radius `R` from the centre. The ring stays open
 * where the harbour avenue comes in (south), where the avenue leaves for the sanctuary (north), round the spawn portal
 * (south-west) and round every quest point and NPC spot. House-local axes: lx along the front, lz out of the front.
 */

export type ForgeRole = 'smithy' | 'smelter' | 'inn' | 'armourer' | 'glassblower' | 'merchant';
export interface ForgeHouse { role: ForgeRole; x: number; z: number; yaw: number; w: number; d: number; wall: number; rise: number; roof: 'copper' | 'iron'; seed: number }

/** The furnace yard: centre, paved radius. */
export const FORGE_C = {x: 0, z: 60, r: 27};
/** Point at bearing a (degrees) and radius r from the yard centre. */
export const yardAt = (a: number, r: number): [number, number] => { const t = a * Math.PI / 180; return [FORGE_C.x + Math.sin(t) * r, FORGE_C.z - Math.cos(t) * r]; };

const house = (role: ForgeRole, a: number, R: number, w: number, wall: number, rise: number, roof: 'copper' | 'iron', seed: number): ForgeHouse => {
  const [x, z] = yardAt(a, R);
  return {role, x, z, yaw: -a * Math.PI / 180, w, d: 10, wall, rise, roof, seed};
};
/** Iron roofs on the two forges (smithy, armourer) only; verdigris copper elsewhere. */
export const FORGE_HOUSES: ForgeHouse[] = [
  house('armourer', 58, 36, 11, 5.2, 3.6, 'iron', 4),
  house('glassblower', 100, 37, 11, 5.4, 3.6, 'copper', 5),
  house('merchant', 150, 38, 12, 5.8, 3.4, 'copper', 6),
  house('inn', 240, 37, 13, 7.4, 3.8, 'copper', 3),
  house('smelter', 274, 35, 11, 5.6, 3.4, 'copper', 2),
  house('smithy', 305, 37, 11, 5.2, 3.6, 'iron', 1),
];

/** House-local (lx, lz) to world (x, z) (three.js rotation.y = yaw). */
export function forgeLocal(h: ForgeHouse, lx: number, lz: number): [number, number] {
  const c = Math.cos(h.yaw), s = Math.sin(h.yaw);
  return [h.x + lx * c + lz * s, h.z - lx * s + lz * c];
}
/** Yaw that turns house-local +z (out of the front) towards the furnace. */
export const forgeYaw = (h: ForgeHouse) => h.yaw;

/** The blast furnace in the middle of the yard: plinth radius, shaft foot radius, height; tap mouths by bearing. */
export const FORGE_FURNACE = {x: FORGE_C.x, z: FORGE_C.z, plinth: 5.4, r: 4.3, h: 13.5, taps: [170, 50, 320]};
/** Casting beds at the end of each tap channel (bearing, radius). */
export const FORGE_BEDS = FORGE_FURNACE.taps.map(a => ({a, r: 10.5}));
/** Market stalls on the yard's north rim, flanking the avenue out; the open-air forge on the west rim. */
export const FORGE_STALLS = [{a: 338, r: 22}, {a: 22, r: 22}];
export const FORGE_OPEN_FORGE = {a: 322, r: 21};
/** Arrival quay south of the spawn: paved apron to the island's brow, its wall standing in the lava sea. */
export const FORGE_QUAY = {x0: -26, x1: 18, z0: 97, brow: 129, z1: 142};
export const FORGE_JETTY = {x: 0, half: 2.1, z0: 142, z1: 170};
export const FORGE_BARGE = {x: 5.9, z: 156, len: 17, beam: 5.4};
/** Harbour gate on the avenue's axis where the quay begins: two pylons either side of the road. */
export const FORGE_GATE = {z: 99.5, x: 5.4};
/** Cargo crane at the quay's sea corner (beyond the crab's reach), its jib over the barge. */
export const FORGE_CRANE = {x: 12, z: 138};
export const FORGE_RAIL = {x: 9, z0: 103, z1: 124};
/** Lantern posts gathered where people gather: the yard's mouths, the quay, the sanctuary gate. None along the roads. */
export const FORGE_LANTERNS: [number, number][] = [
  // Yard: either side of each way in.
  ...[[-6.5, 35], [6.5, 35], [-6.5, 85.5], [6.5, 85.5]] as [number, number][],
  yardAt(70, 27), yardAt(88, 27), yardAt(282, 27), yardAt(298, 27),
  // Quay apron corners by the jetty.
  [-5.5, 136], [5.5, 136],
  // Sanctuary gate.
  [-6, -40], [6, -40],
];
/** Banner poles: at the yard's north and south mouths and the sanctuary gate (the harbour gate carries its own). */
export const FORGE_BANNERS: [number, number][] = [[-9.5, 37], [9.5, 37], [-9.5, 83], [9.5, 83], [-7, -50], [7, -50]];
/** Braziers round the furnace (bearing, radius). */
export const FORGE_BRAZIERS = [145, 235, 335, 85].map(a => ({a, r: 9}));
/** Foot of the furnace's inclined skip hoist (bearing, radius). */
export const FORGE_HOIST = {a: 255, r: 10.6};

/** Yard pieces of each house (house-local): glass kiln. */
export const GLASS_KILN = {lx: -4.5, lz: 8.2, r: 1.35};

export interface ForgeSolid { x: number; z: number; r?: number; hx?: number; hz?: number; yaw?: number; h: number }
/** Solid set pieces the crab must walk round (not the small props), houses included. */
export function forgeSolids(): ForgeSolid[] {
  const out: ForgeSolid[] = [];
  for (const h of FORGE_HOUSES) out.push({x: h.x, z: h.z, hx: h.w / 2 + .3, hz: h.d / 2 + .3, yaw: h.yaw, h: h.wall + h.rise + 3});
  out.push({x: FORGE_FURNACE.x, z: FORGE_FURNACE.z, r: FORGE_FURNACE.plinth - .3, h: FORGE_FURNACE.h});
  { const [x, z] = yardAt(FORGE_HOIST.a, FORGE_HOIST.r); out.push({x, z, r: 1.3, h: 2}); }
  const glass = FORGE_HOUSES.find(h => h.role === 'glassblower')!;
  const [kx, kz] = forgeLocal(glass, GLASS_KILN.lx, GLASS_KILN.lz);
  out.push({x: kx, z: kz, r: GLASS_KILN.r, h: 3});
  { const [x, z] = yardAt(FORGE_OPEN_FORGE.a, FORGE_OPEN_FORGE.r); out.push({x, z, hx: 1.8, hz: 1.3, yaw: -FORGE_OPEN_FORGE.a * Math.PI / 180, h: 3}); }
  for (const s of FORGE_STALLS) { const [x, z] = yardAt(s.a, s.r); out.push({x, z, hx: 2.7, hz: 1.2, yaw: -s.a * Math.PI / 180, h: 3}); }
  for (const s of [-1, 1]) out.push({x: s * FORGE_GATE.x, z: FORGE_GATE.z, hx: 1.25, hz: 1.25, yaw: 0, h: 8});
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
