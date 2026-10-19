// Tidecrown's anchors, the placement of every castle-scale piece, and the collision they register (no meshes).
// The landform itself lives in src/sim/world/tidecrownGround.ts so the server can share it.
import { Collision, rectSurface, type Vec2Out } from '../../sim/world/collision';
import {
  buildTidecrownHeights, polyDistance, TC_AXIS, TC_BOUNDS, TC_CITY_WALL, TC_KEEP, TC_LEVEL, TC_P, TC_ROAD, TC_T, tcAxis, tidecrownHeight, TIDECROWN_GRID,
} from '../../sim/world/tidecrownGround';
import { scatterTidecrownNature, type NatureScatter } from './nature';

export * from '../../sim/world/tidecrownGround';

/** World I shares this frame shifted south: W1 (x, z) = Tidecrown (x, z - 520). */
export const TC_FROM_W1_Z = 520;
/** Yaw that turns a piece's +Z front along -u, toward the gate and the ridge. */
export const TC_YAW = Math.atan2(-TC_AXIS.ux, -TC_AXIS.uz);

/**
 * Sizes of the castle kit (public/models/world/tidecrown.glb, Y up, origin at the ground centre, front +Z). These mirror
 * tools/tidecrown-pieces.json; the bridge bay and the lantern anchor are the values to check against it.
 */
export const TC_PIECES = {
  keep: { w: 60, d: 70, body: 60, spire: 150, lanternY: 142 },
  lantern: { d: 8 },
  wardTower: { r: 7, h: 56 },
  wardWall: { len: 12, h: 16, thick: 4 },
  wardGate: { w: 16, h: 22, passW: 6, passH: 9, d: 8 },
  cityWall: { len: 12, h: 24, thick: 6 },
  cityTower: { r: 6, h: 32 },
  pincerGate: { w: 40, d: 14, passW: 12, passH: 18, h: 46 },
  bridgeSpan: { len: 30, w: 14, pier: 14, bayX: 11, bayZ: 0 },
  plinth: { w: 8, h: 8 },
  statue: { h: 18 },
} as const;

/** Hero statues on the Bridge of Six Shells, in the order buildHeroStatues() returns them. */
export const TC_STATUES = ['human', 'orc', 'dwarf', 'undead', 'nightelf', 'tauren'] as const;
export const TC_SPANS = [-83, -53, -23] as const;
export const TC_WARD = { r: 80 } as const;
/** The sea gate: the ward gate piece, a little larger, in the quay wall (city wall edge 8, from (222, 52) to (208, -5)). */
export const TC_SEA_GATE = { edge: 8, at: 0.6, scale: 1.25 } as const;
/** Facing up the forest road from the arrival. */
export const TC_ARRIVAL_YAW = Math.atan2(TC_ROAD[2][0] - TC_ROAD[1][0], TC_ROAD[2][1] - TC_ROAD[1][1]);

export interface TcPlacement {
  piece: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  sx: number;
  sy: number;
  sz: number;
  /** Static batch it is merged into: one per structure or wall side, so frustum culling still works. */
  batch: string;
}

type Height = (x: number, z: number) => number;
const place = (piece: string, x: number, y: number, z: number, yaw: number, batch: string, sx = 1, sy = 1, sz = 1): TcPlacement => ({ piece, x, y, z, yaw, sx, sy, sz, batch });
/** Yaw that lays a piece's local +X along (dx, dz). */
const alongYaw = (dx: number, dz: number) => Math.atan2(-dz, dx);

/** Lowest and highest ground under a footprint (a few samples). */
function groundSpan(h: Height, pts: [number, number][]): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const [x, z] of pts) {
    const y = h(x, z);
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  return [lo, hi];
}

/** Which side batch a city wall edge belongs to (by its middle). */
function wallSide(x: number, z: number): string {
  if (z > 90) return x < 40 ? 'tc-walls-south-west' : 'tc-walls-south-east';
  if (x > 190) return z > -70 ? 'tc-walls-harbour' : 'tc-walls-cliff';
  if (z < -150) return x > 60 ? 'tc-walls-cliff' : 'tc-walls-north';
  return 'tc-walls-west';
}

/** A run of wall pieces of nominal length `len` from a to b, stretched to fit, standing on the ground. */
function wallRun(h: Height, out: TcPlacement[], piece: string, len: number, tall: number, a: [number, number], b: [number, number], batch: string): void {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
  if (L < 2) return;
  const n = Math.max(1, Math.round(L / len)), seg = L / n, yaw = alongYaw(dx, dz);
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n, tm = (t0 + t1) / 2;
    const [lo, hi] = groundSpan(h, [t0, (t0 + tm) / 2, tm, (tm + t1) / 2, t1].map((t) => [a[0] + dx * t, a[1] + dz * t] as [number, number]));
    // On a slope the wall steps up; on a cliff edge its foot stays near the top rather than reaching for the sea.
    const y = Math.max(lo, hi - 7) - 0.8;
    out.push(place(piece, a[0] + dx * tm, y, a[1] + dz * tm, yaw, batch, seg / len, Math.max(1, (hi + 4 - y) / tall), 1));
  }
}

function tower(h: Height, out: TcPlacement[], piece: string, r: number, tall: number, x: number, z: number, batch: string): void {
  const ring: [number, number][] = [[x, z]];
  for (let k = 0; k < 6; k++) ring.push([x + Math.cos(k) * r, z + Math.sin(k) * r]);
  const [lo, hi] = groundSpan(h, ring);
  const y = lo - 0.8;
  out.push(place(piece, x, y, z, 0, batch, 1, Math.max(1, (hi + 6 - y) / tall), 1));
}

/** Ward hexagon corners: one edge faces the gate, its middle on the axis at TC_T.wardGate. */
export function wardCorners(): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k < 6; k++) {
    const phi = ((150 + 60 * k) * Math.PI) / 180;
    const ca = Math.cos(phi) * TC_WARD.r, cb = Math.sin(phi) * TC_WARD.r;
    out.push([TC_KEEP.x + TC_AXIS.ux * ca + TC_P.x * cb, TC_KEEP.z + TC_AXIS.uz * ca + TC_P.z * cb]);
  }
  return out;
}

/** Every castle-scale piece: city wall and towers, the Pincer Gate, the bridge, plinths, the ward ring and the keep. */
export function tidecrownPlacements(h: Height): TcPlacement[] {
  const out: TcPlacement[] = [];
  const P = TC_PIECES;
  // City wall: the Pincer Gate is the edge between vertices 2 and 3.
  const wall = TC_CITY_WALL, n = wall.length;
  for (let i = 0; i < n; i++) {
    const a = wall[i] as [number, number], b = wall[(i + 1) % n] as [number, number];
    if (i === 2) continue;
    const batch = wallSide((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
    const at = (f: number): [number, number] => [a[0] + dx * f, a[1] + dz * f];
    // The sea gate interrupts its edge between two flanking towers.
    const gap = i === TC_SEA_GATE.edge ? (P.wardGate.w * TC_SEA_GATE.scale) / 2 + P.cityTower.r * 0.9 : 0;
    const parts: [number, number][] = gap ? [[0, TC_SEA_GATE.at - gap / L], [TC_SEA_GATE.at + gap / L, 1]] : [[0, 1]];
    for (const [c0, c1] of parts) {
      // Towers at the corners (not at the Pincer Gate's own flanks) and every 50 to 60 units along the long edges.
      const k = Math.max(1, Math.round(((c1 - c0) * L) / 55)), stops = [c0];
      for (let j = 1; j < k; j++) stops.push(c0 + ((c1 - c0) * j) / k);
      stops.push(c1);
      for (let j = 0; j < stops.length - 1; j++) {
        const pa = at(stops[j]), pb = at(stops[j + 1]);
        // Pull each run back from the towers it meets so the wall ends inside the tower drum.
        const inset = Math.min(P.cityTower.r * 0.7, ((stops[j + 1] - stops[j]) * L) / 4);
        const i0 = j === 0 && i === 3 ? 0 : inset, i1 = j === stops.length - 2 && i === 1 ? 0 : inset;
        wallRun(h, out, 'TC_CityWall_12', P.cityWall.len, P.cityWall.h, [pa[0] + ux * i0, pa[1] + uz * i0], [pb[0] - ux * i1, pb[1] - uz * i1], batch);
        if (j > 0 || stops[j] > 0) tower(h, out, 'TC_CityTower', P.cityTower.r, P.cityTower.h, pa[0], pa[1], batch);
      }
      if (c1 < 1) tower(h, out, 'TC_CityTower', P.cityTower.r, P.cityTower.h, ...at(c1), batch);
    }
    if (gap) {
      // The gate's front faces the harbour.
      const [mx, mz] = at(TC_SEA_GATE.at);
      let nx = -uz, nz = ux;
      if (polyDistance(mx + nx * 3, mz + nz * 3, TC_CITY_WALL) > 0) { nx = -nx; nz = -nz; }
      const sc = TC_SEA_GATE.scale;
      out.push(place('TC_WardGate', mx, h(mx, mz) - 0.3, mz, Math.atan2(nx, nz), batch, sc, sc, sc));
    }
    if (i !== 1) tower(h, out, 'TC_CityTower', P.cityTower.r, P.cityTower.h, b[0], b[1], batch);
  }
  // The Pincer Gate on the axis, facing the bridge.
  const [gx, gz] = tcAxis(TC_T.gate);
  out.push(place('TC_PincerGate', gx, h(gx, gz) - 0.3, gz, TC_YAW, 'tc-gate'));
  // Bridge of Six Shells: three spans with their decks at TC_LEVEL.deck, a plinth in each side bay.
  for (const t of TC_SPANS) {
    const [x, z] = tcAxis(t);
    out.push(place('TC_BridgeSpan', x, TC_LEVEL.deck, z, TC_YAW, 'tc-bridge'));
    for (const side of [-1, 1]) {
      const [bx, bz] = tcAxis(t - P.bridgeSpan.bayZ, side * P.bridgeSpan.bayX);
      out.push(place('TC_Plinth', bx, TC_LEVEL.deck, bz, TC_YAW, 'tc-bridge'));
    }
  }
  // Ward ring: towers on the six corners, the ward gate in the middle of the edge facing the gate.
  const corners = wardCorners();
  for (let k = 0; k < 6; k++) {
    const a = corners[k], b = corners[(k + 1) % 6], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
    const inset = P.wardTower.r * 0.7;
    if (k === 0) {
      // The gate edge runs from the 150 degree corner to the 210 degree one, across the axis.
      const half = P.wardGate.w / 2;
      const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      wallRun(h, out, 'TC_WardWall_12', P.wardWall.len, P.wardWall.h, [a[0] + ux * inset, a[1] + uz * inset], [mid[0] - ux * half, mid[1] - uz * half], 'tc-ward');
      wallRun(h, out, 'TC_WardWall_12', P.wardWall.len, P.wardWall.h, [mid[0] + ux * half, mid[1] + uz * half], [b[0] - ux * inset, b[1] - uz * inset], 'tc-ward');
      out.push(place('TC_WardGate', mid[0], h(mid[0], mid[1]) - 0.3, mid[1], TC_YAW, 'tc-ward'));
    } else wallRun(h, out, 'TC_WardWall_12', P.wardWall.len, P.wardWall.h, [a[0] + ux * inset, a[1] + uz * inset], [b[0] - ux * inset, b[1] - uz * inset], 'tc-ward');
    tower(h, out, 'TC_WardTower', P.wardTower.r, P.wardTower.h, a[0], a[1], 'tc-ward');
  }
  // Wing walls where the bridge meets each bank: the ward wall set into the shore.
  // The forest road reaches the south bridgehead from the east, so that wing is short.
  for (const [t, s, len] of [[-12.5, -13.6, 1], [-12.5, 13.6, 1], [-96.5, -13.6, 1], [-96.5, 9.8, 0.36]]) {
    const [x, z] = tcAxis(t, s);
    out.push(place('TC_WardWall_12', x, TC_LEVEL.deck + 0.9 - P.wardWall.h * 0.9, z, TC_YAW, 'tc-bridge', len, 0.9, 1.2));
  }
  // Crownshell Keep, its front toward the ward gate.
  out.push(place('TC_Keep', TC_KEEP.x, h(TC_KEEP.x, TC_KEEP.z), TC_KEEP.z, TC_YAW, 'tc-keep'));
  return out;
}

/** Where each hero statue stands (on its plinth) and the yaw that faces it to the bridge's centre line. */
export function statueSpots(): { x: number; y: number; z: number; yaw: number }[] {
  const P = TC_PIECES;
  return TC_STATUES.map((_, i) => {
    const t = TC_SPANS[Math.floor(i / 2)], side = i % 2 ? 1 : -1;
    const [x, z] = tcAxis(t - P.bridgeSpan.bayZ, side * P.bridgeSpan.bayX);
    // Facing the centre line: +Z along -side * p.
    return { x, y: TC_LEVEL.deck + P.plinth.h, z, yaw: Math.atan2(-side * TC_P.x, -side * TC_P.z) };
  });
}

/** The lantern in the keep's claw crown. */
export function lanternSpot(h: Height): [number, number, number] {
  return [TC_KEEP.x, h(TC_KEEP.x, TC_KEEP.z) + TC_PIECES.keep.lanternY, TC_KEEP.z];
}

/** Collision footprint of each piece: solids register without meshes, exactly as the browser places them. */
function registerPiece(col: Collision, p: TcPlacement): void {
  const P = TC_PIECES, c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  // Local (lx, lz) to world, as rotation.y = yaw.
  const at = (lx: number, lz: number): [number, number] => [p.x + c * lx + s * lz, p.z - s * lx + c * lz];
  const box = (lx: number, lz: number, hx: number, hz: number, y0: number, y1: number, los = false) => {
    const [x, z] = at(lx, lz);
    col.addBox(x, z, hx, hz, p.yaw, p.y + y0, p.y + y1, los);
  };
  switch (p.piece) {
    case 'TC_CityWall_12': box(0, 0, (P.cityWall.len * p.sx) / 2, P.cityWall.thick / 2, -2, P.cityWall.h * p.sy); break;
    case 'TC_WardWall_12': box(0, 0, (P.wardWall.len * p.sx) / 2, P.wardWall.thick / 2, -2, P.wardWall.h * p.sy); break;
    case 'TC_CityTower': col.addCircle(p.x, p.z, P.cityTower.r, p.y - 2, p.y + P.cityTower.h * p.sy + 10); break;
    case 'TC_WardTower': col.addCircle(p.x, p.z, P.wardTower.r, p.y - 2, p.y + P.wardTower.h * p.sy + 14); break;
    case 'TC_PincerGate': {
      // Two claw piers either side of the 12 wide passage, and the claws over it (they only stop the camera).
      const side = (P.pincerGate.w - P.pincerGate.passW) / 4;
      for (const k of [-1, 1]) box(k * (P.pincerGate.passW / 2 + side), 0, side, P.pincerGate.d / 2, -2, P.pincerGate.h);
      box(0, 0, P.pincerGate.passW / 2, P.pincerGate.d / 2, P.pincerGate.passH, P.pincerGate.h, true);
      break;
    }
    case 'TC_WardGate': {
      const side = ((P.wardGate.w - P.wardGate.passW) / 4) * p.sx, pass = (P.wardGate.passW / 2) * p.sx, d = (P.wardGate.d / 2) * p.sz;
      for (const k of [-1, 1]) box(k * (pass + side), 0, side, d, -2, P.wardGate.h * p.sy);
      box(0, 0, pass, d, P.wardGate.passH * p.sy, P.wardGate.h * p.sy, true);
      break;
    }
    case 'TC_Keep':
      box(0, 0, P.keep.w / 2, P.keep.d / 2, -2, P.keep.body);
      col.addCircle(p.x, p.z, 7, p.y + P.keep.body, p.y + P.keep.spire);
      break;
    case 'TC_Plinth': box(0, 0, P.plinth.w / 2, P.plinth.w / 2, 0, P.plinth.h + P.statue.h); break;
    case 'TC_BridgeSpan':
      // Parapets along the deck edges.
      for (const k of [-1, 1]) box(k * (P.bridgeSpan.w / 2 - 0.4), 0, 0.5, P.bridgeSpan.len / 2, -0.6, 1.4);
      break;
  }
}

export interface TidecrownLayout {
  col: Collision;
  heights: Float32Array;
  placements: TcPlacement[];
  nature: NatureScatter;
  /** Ground plus walkable decks (bridge, stair). */
  heightAt(x: number, z: number): number;
}

/** The deck and the stair are walkable surfaces laid over the terrain. */
function registerSurfaces(col: Collision): void {
  const P = TC_PIECES;
  const t0 = TC_SPANS[0] - P.bridgeSpan.len / 2, t1 = TC_SPANS[TC_SPANS.length - 1] + P.bridgeSpan.len / 2;
  const [bx, bz] = tcAxis((t0 + t1) / 2);
  col.addSurface(rectSurface(bx, bz, P.bridgeSpan.w / 2, (t1 - t0) / 2, TC_YAW, TC_LEVEL.deck));
  // King's Stair: local +Z points down the stair toward the gate.
  const tm = (TC_T.stairFoot + TC_T.stairTop) / 2, [sx, sz] = tcAxis(tm), run = TC_T.stairTop - TC_T.stairFoot;
  col.addSurface(rectSurface(sx, sz, 8, run / 2, TC_YAW, (TC_LEVEL.upper + TC_LEVEL.plateau) / 2, 0, -(TC_LEVEL.plateau - TC_LEVEL.upper) / run));
  // Stair balustrades, and the brazier newels at its foot and head (structures.ts builds them).
  for (const k of [-1, 1]) {
    const [x, z] = tcAxis(tm, k * 8.6);
    col.addBox(x, z, 0.6, run / 2, TC_YAW, TC_LEVEL.upper - 2, TC_LEVEL.plateau + 2);
    for (const [t, y] of [[TC_T.stairFoot - 1.5, TC_LEVEL.upper], [TC_T.stairTop + 1, TC_LEVEL.plateau]]) {
      const [nx, nz] = tcAxis(t, k * 9.4);
      col.addBox(nx, nz, 1.5, 1.5, TC_YAW, y - 1, y + 5);
    }
  }
}

/** Collision, heights and every placement for Tidecrown: the same registration the server will bake. */
export function tidecrownLayout(): TidecrownLayout {
  const heights = buildTidecrownHeights();
  const ground = { ...TIDECROWN_GRID, h: heights, heightAt: (x: number, z: number) => tidecrownHeight(heights, x, z) };
  const col = new Collision(ground);
  registerSurfaces(col);
  const terrainHeight = ground.heightAt;
  const placements = tidecrownPlacements(terrainHeight);
  for (const p of placements) registerPiece(col, p);
  const nature = scatterTidecrownNature(terrainHeight, col);
  // Cells are 2 m: a 1.8 m rise across one is a slope of about 0.9 along the grid, 0.7 diagonally (World I allows
  // 1.15 m over 1 m cells). Terrace edges, the keep's rock and the sea cliffs stay blocked, and so does deep water.
  col.buildBlocked({ maxRise: 1.8, deep: -1.1 });
  return { col, heights, placements, nature, heightAt: (x, z) => col.heightAt(x, z) };
}

/** Collision for Tidecrown (walls, towers, gates, parapets, keep, ward, plinths, trees and the deep-water edge). */
export function layoutTidecrown(): Collision {
  return tidecrownLayout().col;
}

/** Movement inside the playable rectangle, then against the collision. */
export function resolveTidecrown<T extends Vec2Out>(col: Collision, x: number, z: number, r: number, out: T): T {
  return col.resolve(Math.min(TC_BOUNDS.maxX, Math.max(TC_BOUNDS.minX, x)), Math.min(TC_BOUNDS.maxZ, Math.max(TC_BOUNDS.minZ, z)), r, out);
}
