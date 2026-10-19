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
  keep: { w: 60, d: 70, body: 60, spire: 150, lanternY: 144.5 },
  lantern: { d: 8 },
  wardTower: { r: 7, h: 56 },
  wardWall: { len: 12, h: 16, thick: 4 },
  wardGate: { w: 16, h: 22, passW: 6, passH: 9, d: 8 },
  cityWall: { len: 12, h: 24, thick: 6 },
  cityTower: { r: 6, h: 32 },
  pincerGate: { w: 40, d: 14, passW: 12, passH: 18, h: 46 },
  bridgeSpan: { len: 30, w: 14, pier: 14, bayX: 11, bayZ: 15 },
  plinth: { w: 8, h: 8 },
  statue: { h: 13 },
} as const;

/** Hero statues on the Bridge of Six Shells, in the order buildHeroStatues() returns them. */
export const TC_STATUES = ['human', 'orc', 'dwarf', 'undead', 'nightelf', 'tauren'] as const;
export const TC_SPANS = [-83, -53, -23] as const;
/**
 * Ward ring corners around the keep, polar in the axis frame (radius, degrees from +u toward +p), symmetric about the
 * axis and fitted to the keep rock, which is broader across the axis than along it: every tower stands 3 or more inside
 * the rim and 18 or more from the city wall. The front pair is drawn back, so the ward gate projects from its edge.
 */
export const TC_WARD = { corners: [[68, 150], [68, 210], [80, 270], [66, 330], [66, 30], [80, 90]] } as const;
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
  /** A battered stone foundation under the piece, where the ground falls away below its base: its bottom and how far
   * its foot spreads beyond the piece's outline. */
  foundation?: { y: number; toe: number };
}

/** Base outline of each walled piece at scale 1 (measured from the kit below 0.5): half extents, or a drum radius. */
export const TC_FOOTPRINTS: Record<string, { hx: number; hz: number } | { r: number }> = {
  TC_CityWall_12: { hx: 6, hz: 4.05 },
  TC_WardWall_12: { hx: 6, hz: 2.62 },
  TC_WardGate: { hx: 8.3, hz: 5.3 },
  TC_PincerGate: { hx: 18.9, hz: 6.9 },
  TC_CityTower: { r: 7.6 },
  TC_WardTower: { r: 8 },
};
/** Foundations batter out 1 in 8, at most 2.5 at the foot. */
export const TC_BATTER = { slope: 0.12, max: 2.5 } as const;

/**
 * World points of a piece's base outline, grown by `grow`: centre, corners and edge midpoints (eight round a drum), or
 * with `dense` a grid over the whole outline about 1.5 apart (rings round a drum).
 */
export function footprintPoints(p: TcPlacement, grow = 0, dense = false): [number, number][] {
  const f = TC_FOOTPRINTS[p.piece];
  if (!f) return [[p.x, p.z]];
  const out: [number, number][] = [[p.x, p.z]];
  const steps = (h: number) => (dense ? Math.max(2, Math.ceil((2 * h) / 1.5)) : 2);
  if ('r' in f) {
    const r = f.r * p.sx + grow, n = dense ? 24 : 8;
    for (const rr of dense ? [r, r * 0.66, r * 0.33] : [r]) for (let k = 0; k < n; k++) out.push([p.x + Math.cos((k * 2 * Math.PI) / n) * rr, p.z + Math.sin((k * 2 * Math.PI) / n) * rr]);
    return out;
  }
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw), hx = f.hx * p.sx + grow, hz = f.hz * p.sz + grow, nx = steps(hx), nz = steps(hz);
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= nz; j++) {
      const lx = -hx + (2 * hx * i) / nx, lz = -hz + (2 * hz * j) / nz;
      if (lx || lz) out.push([p.x + c * lx + s * lz, p.z - s * lx + c * lz]);
    }
  }
  return out;
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

/**
 * Where the ground under a piece's outline falls more than 0.6 below its base, a foundation of dark limestone goes down
 * to a metre below it, battered out as far as its foot stays buried all round (beside a cliff it drops straight).
 * Kit pieces are never stretched to reach the ground.
 */
function found(h: Height, p: TcPlacement): TcPlacement {
  const [lo] = groundSpan(h, footprintPoints(p, 0, true));
  if (lo > p.y - 0.6) return p;
  const y = lo - 1, full = Math.min(TC_BATTER.max, TC_BATTER.slope * (p.y - y));
  let toe = 0;
  for (const f of [1, 0.6, 0.35, 0.15]) {
    if (groundSpan(h, footprintPoints(p, full * f, true))[0] >= y + 0.3) { toe = full * f; break; }
  }
  p.foundation = { y, toe };
  return p;
}

/** A run of wall pieces of nominal length `len` from a to b, stretched along the run to fit, standing on the ground. */
function wallRun(h: Height, out: TcPlacement[], piece: string, len: number, a: [number, number], b: [number, number], batch: string): void {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
  if (L < 2) return;
  const n = Math.max(1, Math.round(L / len)), seg = L / n, yaw = alongYaw(dx, dz);
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n, tm = (t0 + t1) / 2;
    const [lo, hi] = groundSpan(h, [t0, (t0 + tm) / 2, tm, (tm + t1) / 2, t1].map((t) => [a[0] + dx * t, a[1] + dz * t] as [number, number]));
    // On a slope the wall steps up; on a cliff edge its foot stays near the top and a foundation takes it down.
    const y = Math.max(lo, hi - 7) - 0.8;
    out.push(found(h, place(piece, a[0] + dx * tm, y, a[1] + dz * tm, yaw, batch, seg / len)));
  }
}

/** A tower on the ground under its drum, sunk at most 3 into a slope; a foundation takes any steeper fall. */
function tower(h: Height, out: TcPlacement[], piece: string, x: number, z: number, batch: string): void {
  const p = place(piece, x, 0, z, 0, batch);
  const [lo, hi] = groundSpan(h, footprintPoints(p));
  p.y = Math.max(lo, hi - 3) - 0.8;
  out.push(found(h, p));
}

/** A tower stop along a wall edge that would straddle a cliff slides up to `reach` (a fraction of the edge) to the
 * levellest ground nearby. */
function firmStop(h: Height, at: (f: number) => [number, number], f: number, reach: number): number {
  const span = (g: number) => {
    const [x, z] = at(g), [lo, hi] = groundSpan(h, footprintPoints(place('TC_CityTower', x, 0, z, 0, '')));
    return hi - lo;
  };
  if (span(f) < 3) return f;
  let best = f, bestCost = Infinity;
  for (let i = -6; i <= 6; i++) {
    const g = f + (reach * i) / 6, cost = span(g) + Math.abs(i) * 0.1;
    if (cost < bestCost) { best = g; bestCost = cost; }
  }
  return best;
}

/** Ward ring corners (TC_WARD), front pair first: the ward gate stands between corners 0 and 1. */
export function wardCorners(): [number, number][] {
  return TC_WARD.corners.map(([r, deg]) => {
    const phi = (deg * Math.PI) / 180, ca = Math.cos(phi) * r, cb = Math.sin(phi) * r;
    return [TC_KEEP.x + TC_AXIS.ux * ca + TC_P.x * cb, TC_KEEP.z + TC_AXIS.uz * ca + TC_P.z * cb] as [number, number];
  });
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
      for (let j = 1; j < k; j++) stops.push(firmStop(h, at, c0 + ((c1 - c0) * j) / k, 12 / L));
      stops.push(c1);
      for (let j = 0; j < stops.length - 1; j++) {
        const pa = at(stops[j]), pb = at(stops[j + 1]);
        // Pull each run back from the towers it meets so the wall ends inside the tower drum.
        const inset = Math.min(P.cityTower.r * 0.7, ((stops[j + 1] - stops[j]) * L) / 4);
        const i0 = j === 0 && i === 3 ? 0 : inset, i1 = j === stops.length - 2 && i === 1 ? 0 : inset;
        wallRun(h, out, 'TC_CityWall_12', P.cityWall.len, [pa[0] + ux * i0, pa[1] + uz * i0], [pb[0] - ux * i1, pb[1] - uz * i1], batch);
        if (j > 0 || stops[j] > 0) tower(h, out, 'TC_CityTower', pa[0], pa[1], batch);
      }
      if (c1 < 1) tower(h, out, 'TC_CityTower', ...at(c1), batch);
    }
    if (gap) {
      // The gate's front faces the harbour.
      const [mx, mz] = at(TC_SEA_GATE.at);
      let nx = -uz, nz = ux;
      if (polyDistance(mx + nx * 3, mz + nz * 3, TC_CITY_WALL) > 0) { nx = -nx; nz = -nz; }
      const sc = TC_SEA_GATE.scale;
      out.push(found(h, place('TC_WardGate', mx, h(mx, mz) - 0.3, mz, Math.atan2(nx, nz), batch, sc, sc, sc)));
    }
    if (i !== 1) tower(h, out, 'TC_CityTower', b[0], b[1], batch);
  }
  // The Pincer Gate on the axis, facing the bridge.
  const [gx, gz] = tcAxis(TC_T.gate);
  out.push(found(h, place('TC_PincerGate', gx, h(gx, gz) - 0.3, gz, TC_YAW, 'tc-gate')));
  // Bridge of Six Shells: three spans with their decks at TC_LEVEL.deck, a plinth in each side bay.
  for (const t of TC_SPANS) {
    const [x, z] = tcAxis(t);
    out.push(place('TC_BridgeSpan', x, TC_LEVEL.deck, z, TC_YAW, 'tc-bridge'));
    for (const side of [-1, 1]) {
      const [bx, bz] = tcAxis(t - P.bridgeSpan.bayZ, side * P.bridgeSpan.bayX);
      out.push(place('TC_Plinth', bx, TC_LEVEL.deck, bz, TC_YAW, 'tc-bridge'));
    }
  }
  // Ward ring: towers on the six corners. The ward gate stands on the axis at the stair head, and the front walls run
  // from its sides back to the two front corners.
  const corners = wardCorners(), inset = P.wardTower.r * 0.7;
  const [wx, wz] = tcAxis(TC_T.wardGate), half = P.wardGate.w / 2;
  const towards = (from: [number, number], to: [number, number], d: number): [number, number] => {
    const l = Math.hypot(to[0] - from[0], to[1] - from[1]);
    return [from[0] + ((to[0] - from[0]) / l) * d, from[1] + ((to[1] - from[1]) / l) * d];
  };
  for (let k = 0; k < 6; k++) {
    const a = corners[k], b = corners[(k + 1) % 6];
    if (k === 0) {
      // Corner 0 lies on the +p side, corner 1 on the -p side.
      const side0 = tcAxis(TC_T.wardGate, half), side1 = tcAxis(TC_T.wardGate, -half);
      wallRun(h, out, 'TC_WardWall_12', P.wardWall.len, towards(a, side0, inset), side0, 'tc-ward');
      wallRun(h, out, 'TC_WardWall_12', P.wardWall.len, side1, towards(b, side1, inset), 'tc-ward');
      out.push(found(h, place('TC_WardGate', wx, h(wx, wz) - 0.3, wz, TC_YAW, 'tc-ward')));
    } else wallRun(h, out, 'TC_WardWall_12', P.wardWall.len, towards(a, b, inset), towards(b, a, inset), 'tc-ward');
    tower(h, out, 'TC_WardTower', a[0], a[1], 'tc-ward');
  }
  // Wing walls where the bridge meets each bank: the ward wall set into the shore.
  // The forest road reaches the south bridgehead from the east, so that wing is short.
  for (const [t, s, len] of [[-12.5, -13.6, 1], [-12.5, 13.6, 1], [-96.5, -13.6, 1], [-96.5, 9.8, 0.36]]) {
    const [x, z] = tcAxis(t, s);
    out.push(found(h, place('TC_WardWall_12', x, TC_LEVEL.deck + 0.9 - P.wardWall.h * 0.9, z, TC_YAW, 'tc-bridge', len, 0.9, 1.2)));
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
