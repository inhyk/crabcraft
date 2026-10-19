// Frostlight's story landmarks, numbers only: Boreas's throne and the glacial citadel behind the arena, the arena's
// crystal pillars, Mira's prison, and the three places "Charting the Aurora" sends the player to. Shared by the
// meshes (frostThrone.ts, frostCamps.ts) and the colliders (world4Colliders.ts, baked for the server).
import { snowHeight } from '../sim/world/ground';
import type { Collision } from '../world/collision';

export const ARENA = { x: 0, z: -78, y: 19, r: 22 } as const;

/** The throne faces the arena from its north edge; its dais climbs in straight tiers from just outside the rim. */
export const THRONE = {
  x: 0,
  /** Seat centre. */
  z: -108.4,
  /** Front of the lowest tier and the half width of each tier, lowest first. */
  front: -101.6,
  tiers: [7.4, 6.6, 5.8] as readonly number[],
  tread: 1.25,
  rise: .42,
  /** Back of the top platform. */
  back: -112.4,
} as const;

/** Top of the throne platform. */
export const throneFloor = () => ARENA.y + THRONE.rise * THRONE.tiers.length;

/** `crown` is the height of the ice crown; 0 roofs the tower in slate instead. */
export interface Tower { x: number; z: number; r: number; top: number; crown: number }
/** The glacial citadel: a curtain wall with a frozen gate, four towers, the keep and its great ice spire. */
export const CITADEL = {
  wall: { z: -117, half: 21, top: 30.5, thick: 3.2 },
  gate: { half: 6.4, z: -115, top: 37, open: 2.7, spring: 25.2, apex: 29.6 },
  towers: [
    { x: -25, z: -118, r: 4.4, top: 42, crown: 13 },
    { x: 25, z: -118, r: 4.4, top: 42, crown: 12 },
    { x: -17, z: -138.5, r: 3.8, top: 44.5, crown: 0 },
    { x: 17, z: -138.5, r: 3.8, top: 44.5, crown: 0 },
  ] as readonly Tower[],
  keep: { x: 0, z: -128, hx: 8.6, hz: 6.6, top: 48, turret: 2.3, spire: 29 },
} as const;

/** The old ice-cliff ring gives way where the citadel stands. */
export function citadelClears(x: number, z: number): boolean {
  return z < -100 && Math.abs(x) < 17;
}

/** The arena's grown crystal pillars, each with a crown and Boreas's cold fire; the north one became the throne. */
export function arenaPillars(): { i: number; x: number; z: number; a: number }[] {
  const out: { i: number; x: number; z: number; a: number }[] = [];
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    if (Math.cos(a) > .7 || i === 6) continue;
    out.push({ i, x: Math.sin(a) * 25, z: ARENA.z + Math.cos(a) * 25, a });
  }
  return out;
}

/** "Charting the Aurora": the hunter's lean-to in the Frostpine Woods (visit point -50, 26 stays open). */
export const SHELTER = {
  /** Front centre of the lean-to; it opens toward the fire. */
  x: -57, z: 22, yaw: 1.03,
  width: 4.4, depth: 2.6,
  fire: { x: -54.6, z: 23.4 },
  sled: { x: -57.8, z: 27.6, yaw: 1.75 },
} as const;
/** The eastern ice overlook: a carved parapet on the ledge, facing the frozen sea to the south-east. */
export const OVERLOOK = {
  x: 61, z: 22,
  /** Parapet arc radius and its span (angles from +x toward +z). */
  r: 4.4, a0: .4, a1: 1.5,
  standard: { x: 59.4, z: 26.3 },
} as const;
/** The northern aurora ridge: a ring of standing stones the main road runs through, and an observer's camp. */
export const RIDGE = {
  x: 0, z: -34, r: 9.6, clear: 6.2,
  /** The observer's camp east of the ring: an armillary on a pedestal, a telescope on its tripod, a chest. */
  armillary: { x: 13.2, z: -30.4 }, scope: { x: 12.9, z: -36.2 }, chest: { x: 15.1, z: -33.4, yaw: 1.4 },
} as const;
export function ridgeStones(): { x: number; z: number; a: number; h: number }[] {
  const out: { x: number; z: number; a: number; h: number }[] = [];
  for (let i = 0; i < 14; i++) {
    const a = (i + .5) / 14 * Math.PI * 2, x = RIDGE.x + Math.sin(a) * RIDGE.r, z = RIDGE.z + Math.cos(a) * RIDGE.r;
    if (Math.abs(x) < RIDGE.clear) continue;
    out.push({ x, z, a, h: 3.1 + ((i * 7) % 5) * .42 });
  }
  return out;
}
/** The way to the throne past the aurora seals: frozen standards in pairs, then two gate obelisks at the arena. */
export const PROCESSION = {
  standards: [-41, -47.5] as readonly number[],
  side: 5.3,
  obelisk: { x: 6.6, z: -53.6, r: 1.15 },
} as const;

export function registerFrostThrone(col: Collision, h = snowHeight): void {
  const y = ARENA.y, t = THRONE;
  // The dais and the throne on it: one solid, the tiers are a monument, not a stair (heights are the terrain's).
  col.addBox(t.x, (t.front + t.back) / 2, t.tiers[0], (t.front - t.back) / 2, 0, y - 1, throneFloor() + 9);
  const c = CITADEL;
  col.addBox(0, c.wall.z - c.wall.thick / 2, c.wall.half + 1, c.wall.thick / 2, 0, y - 2, c.wall.top);
  col.addBox(0, (c.gate.z + c.wall.z - c.wall.thick) / 2, c.gate.half, (c.gate.z - c.wall.z + c.wall.thick) / 2, 0, y - 2, c.gate.top);
  for (const tw of c.towers) col.addCircle(tw.x, tw.z, tw.r + .5, h(tw.x, tw.z) - 2, tw.top);
  col.addBox(c.keep.x, c.keep.z, c.keep.hx + 1, c.keep.hz + 1, 0, y - 2, c.keep.top);
  // The lean-to (its roof slopes back from the front posts), the fire ring, the woodpile and the sled.
  const S = SHELTER, sy = Math.sin(S.yaw), cy = Math.cos(S.yaw), at = (lx: number, lz: number) => [S.x + cy * lx + sy * lz, S.z - sy * lx + cy * lz] as const;
  const [lx, lz] = at(0, -S.depth / 2);
  col.addBox(lx, lz, S.width / 2 + .2, S.depth / 2 + .2, S.yaw, h(lx, lz) - 1, h(lx, lz) + 2.6);
  const [wx, wz] = at(-S.width / 2 - .55, -1.1);
  col.addBox(wx, wz, .5, 1.2, S.yaw, h(wx, wz) - 1, h(wx, wz) + 1.2);
  col.addCircle(S.fire.x, S.fire.z, .7, h(S.fire.x, S.fire.z) - 1, h(S.fire.x, S.fire.z) + .6);
  col.addBox(S.sled.x, S.sled.z, 1.15, .55, S.sled.yaw, h(S.sled.x, S.sled.z) - 1, h(S.sled.x, S.sled.z) + 1);
  // The overlook's parapet in short straight runs and its standard.
  const O = OVERLOOK, n = 6;
  for (let i = 0; i < n; i++) {
    const a0 = O.a0 + (O.a1 - O.a0) * i / n, a1 = O.a0 + (O.a1 - O.a0) * (i + 1) / n;
    const ax = O.x + Math.cos(a0) * O.r, az = O.z + Math.sin(a0) * O.r, bx = O.x + Math.cos(a1) * O.r, bz = O.z + Math.sin(a1) * O.r;
    const my = h((ax + bx) / 2, (az + bz) / 2);
    col.addBox((ax + bx) / 2, (az + bz) / 2, Math.hypot(bx - ax, bz - az) / 2 + .1, .35, Math.atan2(-(bz - az), bx - ax), my - 1, my + 1.1);
  }
  col.addCircle(O.standard.x, O.standard.z, .3, h(O.standard.x, O.standard.z) - 1, h(O.standard.x, O.standard.z) + 6);
  for (const st of ridgeStones()) col.addCircle(st.x, st.z, .75, h(st.x, st.z) - 1, h(st.x, st.z) + st.h);
  const A = RIDGE.armillary, C = RIDGE.chest;
  col.addCircle(A.x, A.z, .65, h(A.x, A.z) - 1, h(A.x, A.z) + 2.4);
  col.addBox(C.x, C.z, 1.0, .6, C.yaw, h(C.x, C.z) - 1, h(C.x, C.z) + .8);
  const P = PROCESSION;
  for (const z of P.standards) for (const s of [-1, 1]) col.addCircle(s * P.side, z, .3, h(s * P.side, z) - 1, h(s * P.side, z) + 7);
  for (const s of [-1, 1]) col.addCircle(s * P.obelisk.x, P.obelisk.z, P.obelisk.r, y - 1, y + 9);
}
