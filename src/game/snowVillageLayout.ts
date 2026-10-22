// Frostlight's village: every building, lamp and solid prop, shared by the meshes (snowVillage.ts) and the
// colliders (world4Colliders.ts, baked for the server). One walk places both, so they always agree.
import * as THREE from 'three';
import { snowHeight } from '../sim/world/ground';
import { TownBuilder, type WallSet } from '../world/buildings';
import type { Collision } from '../world/collision';
import { trs } from '../world/kit';
import { FROST_PADS, FROST_WAYS, type FrostWay } from '../sim/world/snowLayout';

/** The frozen fountain at the heart of the market (world4Colliders.ts SNOW_FOUNTAIN). */
const SNOW_FOUNTAIN_AT = { x: -13, z: 65 } as const;

export type SnowLotKind = 'house' | 'tavern' | 'chapel' | 'forge' | 'tower';
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

/** A lot whose front looks at (fx, fz), turned a little by `twist` so no two rows line up. */
const lot = (id: string, kind: SnowLotKind, x: number, z: number, fx: number, fz: number, sx: number, sz: number, floors: number, style: number, twist = 0): SnowLot =>
  ({ id, kind, x, z, yaw: Math.atan2(fx - x, fz - z) + twist, sx, sz, floors, style });
/**
 * Frostlight's own plan (src/sim/world/snowLayout.ts): fronts face the street, square or lane they stand on, set
 * back so their door steps stay off the stones, and the high street's bends end on a house front.
 */
export const SNOW_LOTS: readonly SnowLot[] = [
  // The arrival square between the two portals.
  lot('square-north', 'house', 2.8, 97.6, 1, 86, 3, 3, 2, 1, 0.05),
  lot('square-west', 'house', -22.6, 89, -12, 88.5, 3, 3, 2, 2, -0.06),
  lot('square-east', 'house', 25.4, 90.6, 13, 85, 3, 3, 1, 3),
  // The portal row, east along its lane.
  lot('row-a', 'house', 21.6, 82.8, 19.6, 74.2, 3, 4, 2, 1),
  lot('row-b', 'house', 23.5, 61, 27, 68.5, 4, 3, 2, 2),
  // The market round the fountain: the tavern faces it across the stones.
  lot('tavern', 'tavern', -30.4, 67.2, -13.6, 65, 4, 5, 2, 0),
  // North-west of the market, clear of the way a player walks out of the spawn portal.
  lot('market-north', 'house', -19.6, 80.8, -13.6, 64.6, 3, 3, 1, 3, 0.04),
  lot('market-south', 'house', -16.4, 49.2, -14, 64, 3, 3, 2, 1),
  // High street frontage.
  lot('street-west', 'house', -8.2, 45.4, 0.6, 46, 3, 3, 2, 3, 0.08),
  lot('street-east-a', 'house', 6.6, 64.4, -4, 64, 2, 3, 1, 2),
  lot('street-east-c', 'house', 7.4, 71.2, -1.6, 70.6, 3, 3, 2, 1, 0.06),
  lot('street-east-b', 'house', 9.4, 55.6, -2.6, 53.6, 4, 3, 2, 1),
  // The chapel on the eastern rise, at the head of its lane.
  lot('chapel', 'chapel', 24.6, 46.4, 15, 46.6, 3, 5, 2, 0),
  lot('lane-north', 'house', 11, 40.4, 11, 47.8, 3, 3, 1, 3, -0.05),
  // The forge by the gate, its yard open to the street.
  lot('forge', 'forge', 17, 33.2, 2.6, 34.4, 4, 3, 1, 0),
  lot('gate-west', 'house', -9.8, 33.6, -1, 33, 3, 3, 1, 2),
  // The watchtower east of the gate, the first thing the north road sees of the village.
  lot('gate-tower', 'tower', 6.2, 26.8, -1.8, 27, 2, 2, 3, 0),
  // Out along the woods lane.
  lot('woods-b', 'house', -26, 41.8, -31, 46.8, 4, 3, 2, 0),
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
  /**
   * Each building's solid, as TownBuilder sizes it (footprint plus 15 cm, from 2 m under the floor to 6 m over the
   * roof line), at the lot's own yaw: TownBuilder reads its yaw back from the matrix, which folds fronts that face
   * north onto mirrored boxes.
   */
  solids: { x: number; z: number; hx: number; hz: number; yaw: number; y0: number; y1: number }[];
}

type Put = (piece: string, m: THREE.Matrix4) => void;

/**
 * Raise every lot through a TownBuilder. With a kit batch the builder places walls, windows and doors; with
 * a collision it registers footprints. `put` places the extra village pieces (roofs are the builder's).
 */
export function raiseFrostlight(builder: TownBuilder, put: Put | null, chapelBuilder = builder, h = snowHeight): VillageFrames {
  const frames: VillageFrames = { roofs: [], chimneys: [], footprints: [], forgeHearth: new THREE.Vector3(), solids: [] };
  const solid = (x: number, z: number, half: number, halfD: number, yaw: number, y: number, top: number) => frames.solids.push({ x, z, hx: half + 0.15, hz: halfD + 0.15, yaw, y0: y - 2, y1: y + top + 6 });
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
      const tp = new THREE.Vector3(tx, 0, tz).applyMatrix4(base);
      chapelBuilder.house(tb, { sx: 2, sz: 2, floors: 4, ground: 'stone', upper: 'stone', ridge: 'z', doors: [], wide: false, round: true, shutters: false, chimney: false, dormer: false, noRoof: true, seed: 23 }, tp);
      solid(tp.x, tp.z, 2, 2, lot.yaw, tp.y, 4 * STOREY);
      at(tb, 'Roof_Tower_RoundTiles', 0, 4 * STOREY, 0, 0, 0.85);
    } else if (lot.kind === 'tower') {
      // The gate's watchtower: stone storeys, plain glass, a door onto the road.
      builder.house(base, { sx: lot.sx, sz: lot.sz, floors: lot.floors, ground: 'stone', upper: 'stone', ridge: 'z', doors: [{ side: 'front', index: 1, round: true }], wide: false, round: true, shutters: false, chimney: false, dormer: false, noRoof: true, seed: 41 }, pos);
      door(1);
      at(base, 'Roof_Tower_RoundTiles', 0, lot.floors * STOREY, 0, 0, 0.85);
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
    frames.solids.splice(lot.kind === 'chapel' ? frames.solids.length - 1 : frames.solids.length, 0, { x: lot.x, z: lot.z, hx: lot.sx + 0.15, hz: lot.sz + 0.15, yaw: lot.yaw, y0: y - 2, y1: y + (lot.kind === 'forge' ? 1 : lot.kind === 'house' || lot.kind === 'tower' ? lot.floors : 2) * STOREY + 6 });
  }
  return frames;
}

/** The point `s` metres along a way, offset `off` metres past its paved edge to the right (side 1) or left (-1). */
export function alongWay(w: FrostWay, s: number, side: number, off: number): { x: number; z: number; yaw: number } {
  const p = w.points;
  for (let k = 1; k < p.length; k++) {
    const [ax, az] = p[k - 1], [bx, bz] = p[k], len = Math.hypot(bx - ax, bz - az);
    if (s > len && k < p.length - 1) { s -= len; continue; }
    const t = Math.min(1, s / len), ux = (bx - ax) / len, uz = (bz - az) / len, d = side * (w.width / 2 + off);
    // Right of the way is (uz, -ux); the lantern looks back across it.
    return { x: ax + ux * len * t + uz * d, z: az + uz * len * t - ux * d, yaw: Math.atan2(-uz * side, ux * side) };
  }
  throw new Error(`alongWay: ${w.id}`);
}
/** The point `r` metres from a square's centre at bearing `a` (radians from +z toward +x), its lantern facing in. */
const roundPad = (id: string, a: number, off: number) => {
  const p = FROST_PADS.find((q) => q.id === id)!, r = p.r + off;
  return { x: p.x + Math.sin(a) * r, z: p.z + Math.cos(a) * r, yaw: a + Math.PI };
};
const wayOf = (id: string) => FROST_WAYS.find((w) => w.id === id)!;

/** Lamp posts: iron pole, bracket lantern facing `yaw`, standing just off the stones. */
export function snowLamps(): { x: number; z: number; yaw: number }[] {
  const lamps: { x: number; z: number; yaw: number }[] = [];
  const along = (id: string, list: [number, number][], off = 1.5) => { for (const [s, side] of list) lamps.push(alongWay(wayOf(id), s, side, off)); };
  // Down the high street they alternate, a pair at the gate.
  along('high-street', [[5.5, 1], [16, -1], [37, 1], [44, -1], [52.5, 1]]);
  // Round the arrival square and the market.
  for (const a of [0.9, 4.0]) lamps.push(roundPad('arrival', a, 1.4));
  lamps.push(roundPad('arrival-west', 4.6, 1.3), roundPad('arrival-east', 0.4, 1.3), roundPad('market', 0.1, 1.4), roundPad('market', 3.0, 1.4), roundPad('market-west', 4.0, 1.3));
  // The lanes.
  along('chapel-lane', [[6, -1], [12.5, 1]], 1.3);
  along('woods-lane', [[7, 1], [18, -1]], 1.3);
  along('east-lane', [[8, -1], [20, 1]], 1.3);
  // Out along the north road, alternating, clear of the guide lanterns and the ring of stones.
  along('north-road', [[12, 1], [26, -1], [40, 1], [54, -1]], 1.7);
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
  const { x: fx, z: fz } = SNOW_FOUNTAIN_AT;
  // Market: benches round the fountain facing the basin, a stall and its crates on the square's west side.
  for (const a of [0.2, 3.4, 4.9]) {
    const x = fx + Math.sin(a) * 5.4, z = fz + Math.cos(a) * 5.4;
    p('props', 'Bench', x, z, a + Math.PI, { hx: 1.4, hz: 0.35 });
  }
  const stall = { x: -19.5, z: 72.6, yaw: 2.43 };
  const st = (lx: number, lz: number) => atLot(stall, lx, lz);
  p('props', 'Stall_Empty', stall.x, stall.z, stall.yaw, { hx: 1.1, hz: 0.6 });
  let [x, z] = st(0.4, 0.3);
  p('props', 'FarmCrate_Apple', x, z, stall.yaw, null, 1, 0.82);
  [x, z] = st(-0.5, 0.3);
  p('props', 'FarmCrate_Carrot', x, z, stall.yaw + 0.3, null, 1, 0.82);
  [x, z] = st(1.9, -0.6);
  p('props', 'Barrel_Apples', x, z, 1.1, { r: 0.4 });
  [x, z] = st(-1.9, -0.2);
  p('props', 'Crate_Wooden', x, z, 0.3, { r: 0.55 });
  p('props', 'Crate_Wooden', x, z, 0.9, null, 0.8, 0.88);
  p('props', 'Stall_Cart_Empty', -7.6, 75.2, Math.PI - 0.35, { hx: 1.6, hz: 0.6 });
  // Tavern terrace: two tables with stools out front, barrels at its corners.
  const tv = lot('tavern');
  for (const lx of [-2.2, 2.4]) {
    const [tx, tz] = local('tavern', lx, tv.sz + 1.7);
    p('props', 'Table_Large', tx, tz, tv.yaw + Math.PI / 2, { hx: 1.45, hz: 0.6 });
    for (const [dx, dz] of [[-0.8, -0.95], [0.8, -0.95], [-0.8, 0.95], [0.8, 0.95]]) { const [sx, sz] = local('tavern', lx + dz, tv.sz + 1.7 + dx); p('props', 'Stool', sx, sz, dx + dz); }
  }
  for (const [lx, lz, piece] of [[-4.7, 5.6, 'Barrel'], [4.7, 6.1, 'Barrel_Holder']] as const) { const [bx, bz] = local('tavern', lx, lz); p('props', piece, bx, bz, bx * 0.7, { r: piece === 'Barrel' ? 0.4 : 0.75 }); }
  // Forge yard in front of the open smithy.
  const fy = lot('forge').yaw;
  const f = (lx: number, lz: number) => local('forge', lx, lz);
  [x, z] = f(1.2, 4.6);
  p('props', 'Anvil_Log', x, z, fy + 0.4, { r: 0.55 });
  // The bench stands out in the yard: anything under the roof would wrongly carry snow.
  [x, z] = f(-2.4, 4.1);
  p('props', 'Workbench', x, z, fy + 0.15, { hx: 1.05, hz: 0.55 });
  [x, z] = f(-4.6, 4.2);
  p('props', 'WeaponStand', x, z, fy - 0.5, { hx: 0.7, hz: 0.5 });
  [x, z] = f(3.8, 5.6);
  p('props', 'Whetstone', x, z, fy + 2.2, { r: 0.6 });
  [x, z] = f(-1.2, 7.0);
  p('props', 'Barrel', x, z, 0, { r: 0.45 });
  p('props', 'Bucket_Metal', x + 0.7, z + 0.2, 1);
  // A wagon waits by the forge, a woodcutter's cart where the woods lane leaves the village.
  [x, z] = f(5.8, 1.2);
  p('village', 'Prop_Wagon', x, z, fy + Math.PI / 2 + 0.25, { hx: 1.0, hz: 2.0 });
  p('village', 'Prop_Wagon', -38.4, 49.2, 0.85, { hx: 1.0, hz: 2.0 });
  // Crates and sacks by the doors.
  for (const [id, lx, lz, piece] of [['street-west', 2.2, 3.7, 'Crate_Wooden'], ['street-east-b', -3.0, 3.7, 'Barrel'], ['row-a', 2.2, 4.8, 'Crate_Wooden'], ['woods-b', -3.4, 3.8, 'Barrel'], ['market-south', 2.2, 3.8, 'Bag'], ['gate-west', -2.2, 3.7, 'Barrel'], ['lane-north', 2.2, 3.7, 'Crate_Wooden']] as const) {
    const [px, pz] = local(id, lx, lz);
    p('props', piece, px, pz, lot(id).yaw + lx, { r: 0.45 });
  }
  // Wall banners: either side of the chapel door, and over the tavern's.
  const ch = lot('chapel');
  // The kit banner hangs from its left end (1.61 m wide).
  for (const lx of [-3.1, 1.1]) {
    const [bx, bz] = local('chapel', lx, ch.sz + 0.1);
    p('props', 'Banner_1', bx, bz, ch.yaw, null, 1.25, lotHeight(ch) - snowHeight(bx, bz) + 3.3);
  }
  for (const lx of [-3.95, 0.3]) {
    const [bx, bz] = local('tavern', lx, tv.sz + 0.1);
    p('props', 'Banner_2', bx, bz, tv.yaw, null, 1.1, lotHeight(tv) - snowHeight(bx, bz) + 1.9);
  }
  // Garden fences half sunk in the snow behind the houses.
  for (const id of ['street-west', 'street-east-b', 'gate-west', 'row-b']) {
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
  ['street-west', 1, -1.0],
  ['street-east-b', -1, 0.2],
  ['market-south', -1, -1.2],
  ['woods-b', 1, -0.8],
  ['tavern', 1, -2.4],
  ['square-west', 1, 0.0],
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
  // Greets the arrival beside the square; one minds the market corner, one the chapel lane.
  { x: -6.6, z: 79.6, yaw: 1.2, s: 0.92 },
  { x: -23.4, z: 74.6, yaw: 2.2, s: 0.8 },
  { x: 15.6, z: 51.4, yaw: -2.6, s: 1.0 },
];
/** The market's soup cauldron over a log fire, by the stall. */
export const SNOW_CAULDRON = { x: -24.2, z: 59.6 } as const;

type GarlandEnd = { lot: string; lx: number; dy: number } | { x: number; z: number; dy: number };
/** Strings of lights between facing fronts and lamp-post tops, high over the streets. */
const GARLANDS: [GarlandEnd, GarlandEnd, number][] = [
  [{ lot: 'street-west', lx: 0.4, dy: 4.7 }, { lot: 'street-east-b', lx: 2.6, dy: 4.7 }, 1.3],
  [{ lot: 'market-north', lx: 0, dy: 2.7 }, { x: -12.56, z: 74.95, dy: 3.42 }, 0.7],
  [{ lot: 'tavern', lx: -3.7, dy: 5.5 }, { lot: 'market-south', lx: 0.6, dy: 4.6 }, 1.4],
  [{ lot: 'gate-west', lx: 1.6, dy: 2.75 }, { lot: 'gate-tower', lx: -0.4, dy: 5.4 }, 1.2],
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
  for (const b of raiseFrostlight(new TownBuilder(null, null, null, {}), null, undefined, h).solids) col.addBox(b.x, b.z, b.hx, b.hz, b.yaw, b.y0, b.y1);
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
