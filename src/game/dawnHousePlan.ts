// Goldsand Harbor's desert quarter (World III): the plan the meshes (dawnHouses.ts) and the server's colliders
// (world3Colliders.ts) share. Both sides of the avenue get a varied street wall of flat-roofed plaster, sandstone and
// mudbrick blocks between the side lanes: the eight old lots keep their places (each the head of its lane, door to
// the avenue), with wings, courtyard walls, a domed shrine closing the cross street's east end, the healer's house
// its west end, a covered passage (sabat) over the east harbour road, and three windcatcher towers on the skyline.
// No THREE here: the server bakes this file.
import type { Collision } from '../world/collision';

export type DawnRole = 'house' | 'tavern' | 'forge' | 'shrine' | 'healer' | 'shop' | 'wall' | 'bridge';
/** Wall finishes: whitewash, honey sandstone, raw mudbrick, ochre wash, rose wash. */
export const DAWN_TINTS = ['#efe4cf', '#d3a978', '#b07a4c', '#d8b484', '#e2c3a6'] as const;
/** Face a door or feature looks out of, in world axes. */
export type DawnFace = 'x+' | 'x-' | 'z+' | 'z-';

export interface DawnBlock {
  id: string;
  /** Centre and size in world metres (axis aligned). */
  x: number; z: number; w: number; d: number;
  /** Roof slab height above the ground and parapet height over it. */
  h: number; para: number;
  tint: number;
  role: DawnRole;
  /** The face of the main door, if any. */
  door?: DawnFace;
  /** A windcatcher tower on the roof (local offset from the centre). */
  wind?: { dx: number; dz: number };
  /** Outside stair up to the roof along this face, climbing toward +along (1) or -along (-1). */
  stair?: { face: DawnFace; dir: 1 | -1 };
  /** Lifted off the ground (a bridge room over a passage): its floor height above the ground. */
  lift?: number;
  /** Lot this block stands on (dawnLots), for the lane-head door. */
  lot?: string;
  seed: number;
}

/** Side lanes run from the avenue to |x| 29 at these z; each ends at a lot's door. */
export const DAWN_LANES = [26, 45, 64, 83] as const;

// Blocks per side in avenue-relative units: u = distance from the avenue's centreline (|x|), z as the world.
// [id, u, z, w(along u), d, h, para, tint, role, door ('in' = toward the avenue), extras]
type Row = [string, number, number, number, number, number, number, number, DawnRole, ('in' | 'out' | 'z+' | 'z-' | null), Partial<{ wind: [number, number]; stair: ['in' | 'out' | 'z+' | 'z-', 1 | -1]; lift: number; lot: string }>?];
const EAST: Row[] = [
  // Lane 26: the lot house, a low mudbrick wing behind with a roof garden, a three-storey tower house with the
  // first windcatcher, and a walled yard toward the avenue.
  ['e-26', 35, 26, 6, 6, 6.4, .7, 0, 'house', 'in', {lot: 'dawn-1-0'}],
  ['e-26b', 41.6, 25, 5.2, 7.4, 3.4, .6, 2, 'house', null],
  ['e-26c', 40.2, 31.6, 6, 4.4, 9.4, .8, 3, 'house', 'z+', {wind: [1, 0]}],
  ['e-26w', 32.3, 32.6, .55, 5.4, 2.3, 0, 1, 'wall', null],
  ['e-26w2', 35, 35.1, 5.9, .55, 2.3, 0, 1, 'wall', null],
  // Lane 45: a spice shop facing the avenue, the lot house, a low back house.
  ['e-39', 33.4, 39.4, 4.8, 5.2, 3.7, .6, 4, 'shop', 'in'],
  ['e-45', 38, 45, 6, 6, 6.6, .7, 1, 'house', 'in', {lot: 'dawn-1-1'}],
  ['e-45b', 43.6, 40.4, 5, 5.6, 3.6, .6, 2, 'house', null, {stair: ['out', -1]}],
  // The cross street's east end: the domed shrine, a low house behind it.
  ['e-shrine', 34.6, 53.4, 7, 7, 4.8, .6, 0, 'shrine', 'in'],
  ['e-53b', 42.2, 54.6, 5, 6.4, 3.4, .6, 3, 'house', null],
  // Lane 64: the forge (open front, chimney), a two-storey house behind, a small house with a stair to its roof.
  ['e-64', 35, 64, 8, 8, 4.4, .6, 1, 'forge', 'in', {lot: 'dawn-1-2'}],
  ['e-64b', 42.6, 60.6, 5, 6, 6.6, .7, 4, 'house', null],
  ['e-72', 33.2, 72.6, 5.6, 5, 3.6, .6, 0, 'house', 'in', {stair: ['z-', -1]}],
  // Lane 83 runs on as the harbour road (z 84): a house either side of it and a room bridging it (sabat).
  ['e-83n', 38, 78.6, 6, 4.6, 6.6, .7, 0, 'house', 'z+', {lot: 'dawn-1-3'}],
  ['e-83s', 38, 88.7, 6, 4.6, 6.6, .7, 3, 'house', 'z-'],
  ['e-83x', 38, 83.6, 6, 5.6, 6.6, .7, 0, 'bridge', null, {lift: 3.3}],
  ['e-90', 44, 91, 5, 6, 3.6, .6, 2, 'house', null],
];
const WEST: Row[] = [
  // Lane 26: a one-storey lot house with a stair to a shaded roof, a two-storey house behind, a corner house south.
  ['w-26', 35, 26, 6, 6, 3.6, .6, 3, 'house', 'in', {lot: 'dawn--1-0', stair: ['z-', 1]}],
  ['w-26b', 41, 27.4, 6, 8, 6.6, .7, 0, 'house', null],
  ['w-19', 34, 19.2, 5, 4.6, 6.4, .7, 2, 'house', 'in'],
  // Lane 45: a two-storey house toward the avenue, the three-storey lot tower house, a back house.
  ['w-37', 32.8, 36.4, 5, 5.8, 6.6, .7, 4, 'house', 'in'],
  ['w-45', 38, 45, 6, 6, 9.2, .8, 1, 'house', 'in', {lot: 'dawn--1-1'}],
  ['w-45b', 43.6, 39.6, 5, 5.4, 3.6, .6, 2, 'house', null],
  // The cross street's west end: the healer's house.
  ['w-healer', 34, 53.6, 6, 6.2, 4.4, .6, 0, 'healer', 'in'],
  // Lane 64: the tavern (lot), its two-storey back house with the second windcatcher.
  ['w-64', 35, 63.8, 8, 7.6, 6.8, .7, 1, 'tavern', 'in', {lot: 'dawn--1-2'}],
  ['w-60b', 42.2, 59.8, 5, 6, 7, .7, 3, 'house', null, {wind: [0, -.6]}],
  // Lane 83 (the arrival side): the lot house with a small wing, a corner house by the gate, a tall back house with
  // the third windcatcher.
  ['w-78', 33, 77.9, 5, 4.2, 3.6, .6, 4, 'house', 'in', {stair: ['out', 1]}],
  ['w-83', 38, 83, 6, 6, 6.6, .7, 0, 'house', 'in', {lot: 'dawn--1-3'}],
  ['w-88', 43.6, 88.4, 5, 6, 9.4, .8, 2, 'house', null, {wind: [0, .6]}],
  ['w-90', 33.2, 90.6, 5, 4.2, 3.6, .6, 3, 'house', 'in'],
];

const faceOf = (side: 1 | -1, f: 'in' | 'out' | 'z+' | 'z-'): DawnFace => f === 'in' ? (side > 0 ? 'x-' : 'x+') : f === 'out' ? (side > 0 ? 'x+' : 'x-') : f;

/** Every block of the quarter, both sides. */
export function dawnBlocks(): DawnBlock[] {
  const out: DawnBlock[] = [];
  for (const [side, rows] of [[1, EAST], [-1, WEST]] as const)
    rows.forEach(([id, u, z, w, d, h, para, tint, role, door, ex = {}], i) => out.push({
      id, x: side * u, z, w, d, h, para, tint, role, door: door ? faceOf(side, door) : undefined,
      wind: ex.wind ? {dx: side * ex.wind[0], dz: ex.wind[1]} : undefined,
      stair: ex.stair ? {face: faceOf(side, ex.stair[0]), dir: ex.stair[1]} : undefined,
      lift: ex.lift, lot: ex.lot, seed: (side > 0 ? 101 : 211) + i * 17,
    }));
  return out;
}

/** The outside stair's run: its footprint (centre, half extents) in world space, or null. */
export function stairFootprint(b: DawnBlock): { x: number; z: number; hx: number; hz: number } | null {
  if (!b.stair) return null;
  const run = Math.min(b.h * 1.05, (b.stair.face[0] === 'x' ? b.d : b.w) - .4), wide = .95;
  const out = b.stair.face[1] === '+' ? 1 : -1;
  if (b.stair.face[0] === 'x') return {x: b.x + out * (b.w / 2 + wide / 2), z: b.z + b.stair.dir * (b.d / 2 - run / 2 - .2), hx: wide / 2, hz: run / 2};
  return {x: b.x + b.stair.dir * (b.w / 2 - run / 2 - .2), z: b.z + out * (b.d / 2 + wide / 2), hx: run / 2, hz: wide / 2};
}

/** Date palms of the quarter's scenes: [x, z, height, lean, solid]. */
export function dawnPalms(): [number, number, number, number][] {
  return [
    // Flanking the shrine's door and in its forecourt.
    [29.6, 49.2, 7.2, .1], [29.4, 57.8, 8.4, .16],
    // Inside the walled yard on lane 26 (over the wall), and behind it.
    [34.8, 32.4, 7.6, .12], [45.4, 30.4, 9, .08],
    // The healer's forecourt and the tavern's terrace.
    [-29.6, 48.8, 6.8, .14], [-29.2, 69.6, 8.2, .1],
    // Lane heads and corners along both rows.
    [30.2, 22.2, 6.4, .18], [-30.4, 30.4, 7.8, .12], [-30.6, 41.6, 6.2, .2], [29.8, 69.2, 7, .14],
    [30.4, 76.6, 8.6, .1], [-30.2, 85.6, 7.4, .16], [31.2, 93.4, 9.2, .08], [-36.6, 93.6, 8, .12],
    // Back gardens rising over the roofs.
    [47.6, 47.2, 9.6, .06], [-47.4, 34.2, 9.2, .1], [-46.4, 58.4, 8.8, .12], [47.8, 66.4, 8.4, .1],
  ];
}

/** The healer's well (round curb), in front of the healer's house. */
export const DAWN_WELL = {x: -28.6, z: 58.4, r: 1.05} as const;

/** Register the quarter's solids (the server bakes the same calls). */
export function registerDawnHouses(height: (x: number, z: number) => number, col: Collision): void {
  for (const b of dawnBlocks()) {
    // A bridge room stands over the road: overhead only, nothing to walk into.
    if (b.role === 'bridge') continue;
    const y = height(b.x, b.z);
    col.addBox(b.x, b.z, b.w / 2 + .1, b.d / 2 + .1, 0, y - 2, y + b.h + b.para + 6);
    const s = stairFootprint(b);
    if (s) col.addBox(s.x, s.z, s.hx + .05, s.hz + .05, 0, y - 1, y + b.h);
  }
  for (const [x, z] of dawnPalms()) { const y = height(x, z); col.addCircle(x, z, .32, y, y + 8); }
  { const y = height(DAWN_WELL.x, DAWN_WELL.z); col.addCircle(DAWN_WELL.x, DAWN_WELL.z, DAWN_WELL.r, y, y + 1.1); }
}
