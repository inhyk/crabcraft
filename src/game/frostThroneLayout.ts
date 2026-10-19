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

export function registerFrostThrone(col: Collision, h = snowHeight): void {
  const y = ARENA.y, t = THRONE;
  // The dais and the throne on it: one solid, the tiers are a monument, not a stair (heights are the terrain's).
  col.addBox(t.x, (t.front + t.back) / 2, t.tiers[0], (t.front - t.back) / 2, 0, y - 1, throneFloor() + 9);
  const c = CITADEL;
  col.addBox(0, c.wall.z - c.wall.thick / 2, c.wall.half + 1, c.wall.thick / 2, 0, y - 2, c.wall.top);
  col.addBox(0, (c.gate.z + c.wall.z - c.wall.thick) / 2, c.gate.half, (c.gate.z - c.wall.z + c.wall.thick) / 2, 0, y - 2, c.gate.top);
  for (const tw of c.towers) col.addCircle(tw.x, tw.z, tw.r + .5, h(tw.x, tw.z) - 2, tw.top);
  col.addBox(c.keep.x, c.keep.z, c.keep.hx + 1, c.keep.hz + 1, 0, y - 2, c.keep.top);
}
