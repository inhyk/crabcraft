// Frostlight's village: every building, lamp and solid prop, shared by the meshes (snowVillage.ts) and the
// colliders (world4Colliders.ts, baked for the server). One walk places both, so they always agree.
import * as THREE from 'three';
import { snowHeight } from '../sim/world/ground';
import { TownBuilder, type WallSet } from '../world/buildings';
import type { Collision } from '../world/collision';
import { trs } from '../world/kit';

export type SnowLotKind = 'house' | 'tavern' | 'chapel' | 'forge';
export interface SnowLot {
  id: string;
  kind: SnowLotKind;
  x: number;
  z: number;
  /** Yaw of the front (+Z local), radians. */
  yaw: number;
  /** Footprint in 2 m modules along local x (the front) and local z. */
  sx: number;
  sz: number;
  floors: number;
  style: number;
}

const E = Math.PI / 2, W = -Math.PI / 2, S = 0, N = Math.PI;
/** Fronts face the street they stand on; small turns keep the rows from reading as a grid. */
export const SNOW_LOTS: readonly SnowLot[] = [
  // Cross-street ends: the tavern closes the south street, the chapel the middle one.
  { id: 'tavern', kind: 'tavern', x: -28.5, z: 74, yaw: E, sx: 4, sz: 5, floors: 2, style: 0 },
  // Steps out front stay 2 m clear of the street ends (x = +-22), so the lanes walk through end to end.
  { id: 'chapel', kind: 'chapel', x: 31, z: 56, yaw: W, sx: 3, sz: 5, floors: 2, style: 0 },
  { id: 'forge', kind: 'forge', x: 27.5, z: 67.5, yaw: W, sx: 4, sz: 3, floors: 1, style: 0 },
  { id: 'w-38', kind: 'house', x: -27.5, z: 38, yaw: E + 0.04, sx: 4, sz: 3, floors: 2, style: 0 },
  { id: 'w-56', kind: 'house', x: -27.5, z: 56, yaw: E - 0.03, sx: 3, sz: 3, floors: 2, style: 1 },
  { id: 'w-65', kind: 'house', x: -28, z: 64.5, yaw: E + 0.05, sx: 3, sz: 3, floors: 1, style: 3 },
  { id: 'e-38', kind: 'house', x: 29, z: 38, yaw: W - 0.03, sx: 4, sz: 3, floors: 2, style: 2 },
  { id: 'e-79', kind: 'house', x: 28, z: 80, yaw: W + 0.06, sx: 3, sz: 4, floors: 2, style: 1 },
  // Main-street frontage.
  { id: 'w-47', kind: 'house', x: -10.5, z: 47, yaw: E, sx: 3, sz: 3, floors: 2, style: 3 },
  { id: 'e-47', kind: 'house', x: 10.5, z: 47, yaw: W, sx: 4, sz: 3, floors: 2, style: 1 },
  { id: 'e-62', kind: 'house', x: 10, z: 62.5, yaw: W, sx: 2, sz: 3, floors: 1, style: 2 },
  { id: 'w-31', kind: 'house', x: -12, z: 30.5, yaw: E + 0.03, sx: 3, sz: 3, floors: 1, style: 2 },
  { id: 'e-29', kind: 'house', x: 11.5, z: 29.5, yaw: W - 0.04, sx: 3, sz: 4, floors: 2, style: 0 },
  // Behind the arrival, west of the spawn ring and east of the ember gate.
  { id: 'w-88', kind: 'house', x: -28, z: 88, yaw: E - 0.12, sx: 3, sz: 3, floors: 2, style: 2 },
  { id: 'e-90', kind: 'house', x: 27, z: 91, yaw: W + 0.15, sx: 3, sz: 3, floors: 1, style: 3 },
  // A second row gives the village depth from the road.
  { id: 'w-47b', kind: 'house', x: -37, z: 47, yaw: E + 0.08, sx: 3, sz: 3, floors: 1, style: 1 },
  { id: 'e-47b', kind: 'house', x: 37, z: 47.5, yaw: W - 0.1, sx: 3, sz: 3, floors: 1, style: 3 },
];

const STYLES: [WallSet, WallSet][] = [
  ['stone', 'timber'],
  ['plasterBase', 'timber'],
  ['stone', 'plaster'],
  ['plasterBase', 'plaster'],
];
const ROOF_LENGTHS: Record<number, number[]> = { 4: [4, 6, 8], 6: [6, 8, 10, 12, 14], 8: [8, 10, 12, 14] };
const STOREY = 3;

/** World point of a lot-local point (front = +z). */
export function atLot(lot: { x: number; z: number; yaw: number }, lx: number, lz: number): [number, number] {
  const c = Math.cos(lot.yaw), s = Math.sin(lot.yaw);
  return [lot.x + c * lx + s * lz, lot.z - s * lx + c * lz];
}

/** Floor height: the highest ground under the footprint, so no wall is buried; a stone plinth fills below. */
export function lotHeight(lot: SnowLot, h = snowHeight): number {
  let top = -Infinity;
  for (let i = 0; i <= 4; i++)
    for (let j = 0; j <= 4; j++) {
      const [x, z] = atLot(lot, (i / 4 - 0.5) * lot.sx * 2, (j / 4 - 0.5) * lot.sz * 2);
      top = Math.max(top, h(x, z));
    }
  return top;
}

export interface RoofFrame {
  /** World matrix of the kit roof piece. */
  m: THREE.Matrix4;
  piece: string;
  span: number;
  len: number;
}
export interface Chimney {
  /** World position of the flue mouth. */
  top: THREE.Vector3;
  big: boolean;
}

/** Everything the meshes need besides the kit pieces themselves. */
export interface VillageFrames {
  roofs: RoofFrame[];
  chimneys: Chimney[];
  /** Ground-floor footprints (world centre, half sizes, yaw, floor height) for plinths and drifts. */
  footprints: { lot: SnowLot; h: number; hx: number; hz: number; doors: [number, number][] }[];
  forgeHearth: THREE.Vector3;
}

type Put = (piece: string, m: THREE.Matrix4) => void;

/**
 * Raise every lot through a TownBuilder. With a kit batch the builder places walls, windows and doors; with
 * a collision it registers footprints. `put` places the extra village pieces (roofs are the builder's).
 */
export function raiseFrostlight(builder: TownBuilder, put: Put | null, chapelBuilder = builder, h = snowHeight): VillageFrames {
  const frames: VillageFrames = { roofs: [], chimneys: [], footprints: [], forgeHearth: new THREE.Vector3() };
  const m = new THREE.Matrix4();
  const at = (base: THREE.Matrix4, piece: string, x: number, y: number, z: number, yaw = 0, s: number | THREE.Vector3 = 1) => {
    put?.(piece, m.multiplyMatrices(base, trs(x, y, z, yaw, s)));
  };
  const roofFrame = (base: THREE.Matrix4, w: number, d: number, top: number, ridge: 'x' | 'z') => {
    const span = ridge === 'z' ? w : d, len = ridge === 'z' ? d : w, lens = ROOF_LENGTHS[span];
    if (!lens) return;
    const L = lens.reduce((a, b) => (Math.abs(b - len) < Math.abs(a - len) ? b : a));
    frames.roofs.push({ m: new THREE.Matrix4().multiplyMatrices(base, trs(0, top, 0, ridge === 'z' ? 0 : Math.PI / 2, new THREE.Vector3(1, 1, len / L))), piece: `Roof_RoundTiles_${span}x${L}`, span, len });
  };
  const chimney = (base: THREE.Matrix4, w: number, d: number, top: number, ridge: 'x' | 'z', along: number, seed: number) => {
    const span = ridge === 'z' ? w : d;
    const cx = ridge === 'z' ? span / 2 - 1.1 : along, cz = ridge === 'z' ? along : span / 2 - 1.1;
    const sy = 1.25 + span * 0.08;
    at(base, seed % 2 ? 'Prop_Chimney2' : 'Prop_Chimney', cx, top + 0.6, cz, 0, new THREE.Vector3(1, sy, 1));
    frames.chimneys.push({ top: new THREE.Vector3(cx, top + 0.6 + 3.1 * sy, cz).applyMatrix4(base), big: false });
  };
  for (const lot of SNOW_LOTS) {
    const y = lotHeight(lot, h);
    const base = trs(lot.x, y, lot.z, lot.yaw);
    const pos = new THREE.Vector3(lot.x, y, lot.z);
    const w = lot.sx * 2, d = lot.sz * 2;
    const seed = Math.abs(Math.round(lot.x * 31 + lot.z * 17)) + 3;
    const [g, u] = STYLES[lot.style % STYLES.length];
    const doors: [number, number][] = [];
    const door = (index: number) => doors.push(atLot({ x: lot.x, z: lot.z, yaw: lot.yaw }, -lot.sx + 1 + 2 * index, lot.sz));
    if (lot.kind === 'house') {
      const ridge = lot.sx === lot.sz ? (seed % 2 ? 'x' : 'z') : lot.sx >= lot.sz ? 'x' : 'z';
      const index = Math.floor((lot.sx - 1) / 2);
      builder.house(base, { sx: lot.sx, sz: lot.sz, floors: lot.floors, ground: g, upper: u, ridge, doors: [{ side: 'front', index }], wide: seed % 3 !== 0, round: seed % 2 === 0, shutters: true, chimney: false, dormer: false, seed }, pos);
      door(index);
      roofFrame(base, w, d, lot.floors * STOREY, ridge);
      chimney(base, w, d, lot.floors * STOREY, ridge, ((seed % 7) / 6 - 0.5) * ((ridge === 'z' ? d : w) - 2.5), seed);
    } else if (lot.kind === 'tavern') {
      builder.house(base, { sx: lot.sx, sz: lot.sz, floors: 2, ground: 'stone', upper: 'timber', ridge: 'z', doors: [{ side: 'front', index: 1, round: true, big: true }], wide: true, round: true, shutters: true, chimney: false, dormer: false, seed: 11 }, pos);
      door(1);
      // Balcony across the upper front on knee braces.
      for (let i = 0; i < lot.sx; i++) {
        const x = -lot.sx + 1 + 2 * i;
        at(base, 'Balcony_Cross_Straight', x, STOREY, lot.sz);
        at(base, 'Floor_WoodDark', x, STOREY - 0.02, lot.sz + 1);
      }
      for (const x of [-lot.sx + 0.15, lot.sx - 0.15]) at(base, 'Prop_Support', x, 0, lot.sz - 0.05);
      roofFrame(base, w, d, 2 * STOREY, 'z');
      chimney(base, w, d, 2 * STOREY, 'z', -1.6, 1);
      chimney(base, w, d, 2 * STOREY, 'z', 2.4, 2);
    } else if (lot.kind === 'chapel') {
      chapelBuilder.house(base, { sx: lot.sx, sz: lot.sz, floors: 2, ground: 'stone', upper: 'stone', ridge: 'z', doors: [{ side: 'front', index: 1, round: true, big: true }], wide: false, round: true, shutters: false, chimney: false, dormer: false, seed: 21 }, pos);
      door(1);
      roofFrame(base, w, d, 2 * STOREY, 'z');
      // Bell tower on the north front corner, flush with the facade.
      const tx = -lot.sx - 2, tz = lot.sz - 2;
      const tb = new THREE.Matrix4().multiplyMatrices(base, trs(tx, 0, tz, 0));
      chapelBuilder.house(tb, { sx: 2, sz: 2, floors: 4, ground: 'stone', upper: 'stone', ridge: 'z', doors: [], wide: false, round: true, shutters: false, chimney: false, dormer: false, noRoof: true, seed: 23 }, new THREE.Vector3(tx, 0, tz).applyMatrix4(base));
      at(tb, 'Roof_Tower_RoundTiles', 0, 4 * STOREY, 0, 0, 0.85);
    } else {
      builder.house(base, { sx: lot.sx, sz: lot.sz, floors: 1, ground: 'stone', upper: 'stone', ridge: 'x', doors: [], wide: true, round: false, shutters: false, chimney: false, dormer: false, openFront: true, seed: 31 }, pos);
      for (let i = 1; i < lot.sx; i++) at(base, 'Corner_Exterior_Wood', -lot.sx + i * 2, 0, lot.sz, 0, new THREE.Vector3(1.6, 1, 1.6));
      // The smithy chimney rises from the back wall over the hearth.
      at(base, 'Prop_Chimney', lot.sx - 2.5, 0, -lot.sz + 0.2, 0, new THREE.Vector3(2.1, 3.0, 1.8));
      frames.chimneys.push({ top: new THREE.Vector3(lot.sx - 2.5, 9.3, -lot.sz + 0.2).applyMatrix4(base), big: true });
      frames.forgeHearth.set(lot.sx - 2.5, 0, -lot.sz + 1.4).applyMatrix4(base);
      roofFrame(base, w, d, STOREY, 'x');
    }
    frames.footprints.push({ lot, h: y, hx: lot.sx, hz: lot.sz, doors });
  }
  return frames;
}

/** Lamp posts: iron pole, bracket lantern facing `yaw`. Off the paving (|x|<=4 road, |z-street|<=2 lanes). */
export function snowLamps(): { x: number; z: number; yaw: number }[] {
  const lamps: { x: number; z: number; yaw: number }[] = [];
  const road = (x: number, z: number) => lamps.push({ x, z, yaw: x < 0 ? Math.PI / 2 : -Math.PI / 2 });
  // Through the village the posts flank each crossing on opposite corners, then alternate up the hill.
  for (const [x, z] of [[-5.6, 88], [5.6, 79], [-5.6, 77.4], [5.6, 70.6], [-5.6, 65], [5.6, 59.4], [-5.6, 52.6], [5.6, 47], [-5.6, 41.4], [5.6, 34.6], [-5.6, 28]] as const) road(x, z);
  for (let z = 14, side = 1; z > -48; z -= 13, side = -side) road(side * 5.6, z);
  // Lane lamps at the street ends and the fountain square.
  lamps.push({ x: -20.5, z: 59.4, yaw: S }, { x: -6.8, z: 69, yaw: W }, { x: 20.5, z: 52.6, yaw: N }, { x: -20.5, z: 41.4, yaw: N }, { x: 20.5, z: 34.6, yaw: S }, { x: 19.5, z: 77.4, yaw: N });
  return lamps;
}

export type SnowPropShape = { r: number } | { hx: number; hz: number } | null;
export interface SnowProp {
  kit: 'props' | 'village';
  piece: string;
  x: number;
  z: number;
  yaw: number;
  s: number;
  dy: number;
  /** Solid footprint (low: blocks crabs, not sight), or null for clutter nobody needs to walk through. */
  solid: SnowPropShape;
}

/** Market, tavern terrace, forge yard, woodpiles, carts, fences and benches. Deterministic. */
export function snowProps(): SnowProp[] {
  const out: SnowProp[] = [];
  const p = (kit: SnowProp['kit'], piece: string, x: number, z: number, yaw = 0, solid: SnowPropShape = null, s = 1, dy = 0) => out.push({ kit, piece, x, z, yaw, s, dy, solid });
  const lot = (id: string) => SNOW_LOTS.find((l) => l.id === id)!;
  const local = (id: string, lx: number, lz: number) => atLot(lot(id), lx, lz);
  // Fountain square: benches facing the basin, a market stall and cart on the square's west side.
  for (const a of [1.57, 2.45, 5.68]) {
    const x = -13 + Math.sin(a) * 5.4, z = 65 + Math.cos(a) * 5.4;
    p('props', 'Bench', x, z, a + Math.PI / 2, { hx: 1.4, hz: 0.35 });
  }
  p('props', 'Stall_Empty', -20.6, 64.8, E, { hx: 1.1, hz: 0.6 });
  p('props', 'FarmCrate_Apple', -20.2, 64.4, E, null, 1, 0.82);
  p('props', 'FarmCrate_Carrot', -20.2, 65.3, E + 0.3, null, 1, 0.82);
  p('props', 'Barrel_Apples', -21.3, 62.9, 1.1, { r: 0.4 });
  p('props', 'Stall_Cart_Empty', -9.4, 69.9, Math.PI + 0.2, { hx: 1.6, hz: 0.6 });
  p('props', 'Crate_Wooden', -18.4, 61.4, 0.3, { r: 0.55 });
  p('props', 'Crate_Wooden', -18.4, 61.4, 0.9, null, 0.8, 0.88);
  // Tavern terrace: a table with stools either side of the street's end, barrels at the corners.
  for (const z of [70.6, 77.4]) {
    p('props', 'Table_Large', -21.7, z, 0, { hx: 1.45, hz: 0.6 });
    for (const [dx, dz] of [[-0.8, -0.95], [0.8, -0.95], [-0.8, 0.95], [0.8, 0.95]]) p('props', 'Stool', -21.7 + dx, z + dz, dx + dz);
  }
  for (const [x, z, piece] of [[-24.2, 69.2, 'Barrel'], [-23.4, 68.7, 'Barrel'], [-24.0, 79.2, 'Barrel_Holder']] as const) p('props', piece, x, z, x * 0.7, { r: piece === 'Barrel' ? 0.4 : 0.75 });
  // Forge yard in front of the open smithy.
  const fy = lot('forge').yaw;
  const f = (lx: number, lz: number) => local('forge', lx, lz);
  let [x, z] = f(1.2, 4.6);
  p('props', 'Anvil_Log', x, z, fy + 0.4, { r: 0.55 });
  // The bench stands out in the yard: anything under the roof would wrongly carry snow.
  [x, z] = f(-2.4, 4.1);
  p('props', 'Workbench', x, z, fy + 0.15, { hx: 1.05, hz: 0.55 });
  [x, z] = f(-4.6, 4.2);
  p('props', 'WeaponStand', x, z, fy - 0.5, { hx: 0.7, hz: 0.5 });
  [x, z] = f(3.8, 5.6);
  p('props', 'Whetstone', x, z, fy + 2.2, { r: 0.6 });
  [x, z] = f(-0.8, 5.8);
  p('props', 'Barrel', x, z, 0, { r: 0.45 });
  p('props', 'Bucket_Metal', x + 0.7, z + 0.2, 1);
  // A wagon waits by the forge, a woodcutter's cart by the west houses.
  [x, z] = f(-6.4, -1.0);
  p('village', 'Prop_Wagon', x, z, fy + Math.PI / 2 - 0.2, { hx: 1.0, hz: 2.0 });
  p('village', 'Prop_Wagon', -33.2, 59.6, 0.25, { hx: 1.0, hz: 2.0 });
  // Crates and sacks by the doors.
  for (const [id, lx, lz, piece] of [['w-47', 2.2, 3.7, 'Crate_Wooden'], ['e-47', -3.0, 3.7, 'Barrel'], ['e-38', 3.2, 3.8, 'Crate_Wooden'], ['w-38', -3.4, 3.8, 'Barrel'], ['w-56', 2.2, 3.8, 'Bag'], ['e-29', -2.2, 3.7, 'Barrel'], ['w-31', 2.2, 3.7, 'Crate_Wooden']] as const) {
    const [px, pz] = local(id, lx, lz);
    p('props', piece, px, pz, lot(id).yaw + lx, { r: 0.45 });
  }
  // Wall banners: either side of the chapel door, and over the tavern's.
  const ch = lot('chapel'), tv = lot('tavern');
  // The kit banner hangs from its left end (1.61 m wide).
  for (const lx of [-3.1, 1.1]) {
    const [bx, bz] = local('chapel', lx, ch.sz + 0.1);
    p('props', 'Banner_1', bx, bz, ch.yaw, null, 1.25, lotHeight(ch) - snowHeight(bx, bz) + 3.3);
  }
  for (const lx of [-3.95, 0.3]) {
    const [bx, bz] = local('tavern', lx, tv.sz + 0.1);
    p('props', 'Banner_2', bx, bz, tv.yaw, null, 1.1, lotHeight(tv) - snowHeight(bx, bz) + 1.9);
  }
  // Garden fences half sunk in the snow behind the main-street houses.
  for (const id of ['w-47', 'e-47', 'w-31', 'e-29']) {
    const l = lot(id), back = -l.sz - 2.2;
    for (let i = -l.sx + 1; i < l.sx; i += 2) {
      const [px, pz] = local(id, i, back);
      p('village', i === -l.sx + 1 ? 'Prop_WoodenFence_Single' : 'Prop_WoodenFence_Extension1', px, pz, l.yaw, { hx: 1.05, hz: 0.12 }, 1, -0.25);
    }
  }
  return out;
}

/** Woodpiles stacked against a side wall: [lot id, side (-1 left, 1 right), local z]. */
export const SNOW_WOODPILES: readonly [string, number, number][] = [
  ['w-47', 1, -1.0],
  ['e-47', -1, 0.2],
  ['w-56', -1, -1.2],
  ['e-38', 1, -0.8],
  ['tavern', 1, -2.4],
  ['w-88', 1, 0.0],
];
/** Woodpile centre in lot-local space: 0.55 m out from the side wall. */
export function woodpileAt(lot: SnowLot, side: number, lz: number): [number, number] {
  return [side * (lot.sx * 2 / 2 + 0.55), lz];
}

/** Stone steps up to doors that stand more than a hand above the snow in front of them. */
export function snowSteps(h = snowHeight): { x: number; z: number; yaw: number; y: number; rise: number; lot: SnowLot; dx: number }[] {
  const out: ReturnType<typeof snowSteps> = [];
  for (const lot of SNOW_LOTS) {
    if (lot.kind === 'forge') continue;
    const floor = lotHeight(lot, h), dx = lot.kind === 'house' ? -lot.sx + 1 + 2 * Math.floor((lot.sx - 1) / 2) : -lot.sx + 3;
    const [x, z] = atLot(lot, dx, lot.sz + 1.0), ground = h(x, z), rise = floor - ground;
    if (rise > 0.22) out.push({ x, z, yaw: lot.yaw, y: ground, rise, lot, dx });
  }
  return out;
}

/** Snowmen: position, the way the face looks (yaw of local +z), size. */
export const SNOW_SNOWMEN: readonly { x: number; z: number; yaw: number; s: number }[] = [
  // Greets the arrival from beside the road; one minds the market corner, one the chapel lane.
  { x: 7.6, z: 78.0, yaw: -1.09, s: 0.92 },
  { x: -17.8, z: 58.9, yaw: 1.73, s: 0.8 },
  { x: 19.6, z: 61.0, yaw: -2.15, s: 1.0 },
];
/** The market's soup cauldron over a log fire, by the stall. */
export const SNOW_CAULDRON = { x: -23.0, z: 63.2 } as const;

type GarlandEnd = { lot: string; lx: number; dy: number } | { x: number; z: number; dy: number };
/** Strings of lights between facing fronts and lamp-post tops, high over the streets. */
const GARLANDS: [GarlandEnd, GarlandEnd, number][] = [
  [{ lot: 'w-47', lx: 0.4, dy: 4.7 }, { lot: 'e-47', lx: -0.6, dy: 4.7 }, 1.3],
  [{ lot: 'w-31', lx: 0, dy: 2.7 }, { lot: 'e-29', lx: 0.8, dy: 4.5 }, 1.0],
  [{ lot: 'tavern', lx: -3.7, dy: 5.5 }, { x: -5.6, z: 77.4, dy: 3.42 }, 1.1],
  [{ lot: 'w-65', lx: 1.6, dy: 2.75 }, { x: -6.8, z: 69, dy: 3.42 }, 0.9],
];
export function snowGarlands(h = snowHeight): { a: THREE.Vector3; b: THREE.Vector3; sag: number }[] {
  const end = (e: GarlandEnd) => {
    if ('x' in e) return new THREE.Vector3(e.x, h(e.x, e.z) + e.dy, e.z);
    const lot = SNOW_LOTS.find((l) => l.id === e.lot)!;
    const [x, z] = atLot(lot, e.lx, lot.sz + (lot.kind === 'tavern' ? 0.25 : 0.12));
    return new THREE.Vector3(x, lotHeight(lot, h) + e.dy, z);
  };
  return GARLANDS.map(([a, b, sag]) => ({ a: end(a), b: end(b), sag }));
}

/** Same low props as World I: they stop a crab but not a spell aimed above it. */
export function registerSnowVillage(col: Collision, h = snowHeight): void {
  raiseFrostlight(new TownBuilder(null, null, col, {}), null, undefined, h);
  for (const { x, z } of snowLamps()) col.addCircle(x, z, 0.3, h(x, z) - 1, h(x, z) + 3.6);
  for (const pr of snowProps()) {
    if (!pr.solid) continue;
    const y = h(pr.x, pr.z);
    if ('r' in pr.solid) col.addCircle(pr.x, pr.z, pr.solid.r, y - 1, y + 1.1);
    else col.addBox(pr.x, pr.z, pr.solid.hx, pr.solid.hz, pr.yaw, y - 1, y + 1.1);
  }
  for (const [id, side, lz] of SNOW_WOODPILES) {
    const lot = SNOW_LOTS.find((l) => l.id === id)!;
    const [x, z] = atLot(lot, ...woodpileAt(lot, side, lz));
    col.addBox(x, z, 0.55, 1.15, lot.yaw, h(x, z) - 1, h(x, z) + 1.1);
  }
  for (const st of snowSteps(h)) col.addBox(st.x, st.z, 1.0, 1.0, st.yaw, st.y - 1, st.y + st.rise + 0.2);
  for (const sm of SNOW_SNOWMEN) col.addCircle(sm.x, sm.z, 0.55 * sm.s, h(sm.x, sm.z) - 1, h(sm.x, sm.z) + 1.1);
  const { x: cx, z: cz } = SNOW_CAULDRON;
  col.addCircle(cx, cz, 0.75, h(cx, cz) - 1, h(cx, cz) + 1.1);
}
