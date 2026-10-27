// Solarkan's Twilight Citadel on Dawnharbor's north plateau, numbers only: the sun temple-fortress round the boss arena,
// its gatehouse on the ascent, curtain walls, towers, the keep and the sun obelisks. Shared by the meshes
// (dawnCitadel.ts) and the colliders (world3Colliders.ts, baked for the server).
import { DAWN_ARENA_HEIGHT } from '../sim/world/ground';
import type { Collision } from '../world/collision';

type Height = (x: number, z: number) => number;

/** The combat floor (flat at 19 out to r 21 in dawnHeight) and the carved curb ring round it. */
export const CITADEL_ARENA = { x: 0, z: -72, y: DAWN_ARENA_HEIGHT, r: 21, curb: 22.4 } as const;

/** The gatehouse astride the end of the avenue: `front` its south face, `back` where the passage opens on the court. */
export const CITADEL_GATE = { half: 8.6, front: -46.5, back: -51.3, open: 3.4, spring: 6.4, apex: 9.4, top: 37.5 } as const;

export interface CitadelTower { x: number; z: number; r: number; top: number; /** 'spire': a gilded spire; 'fire': an open fire platform. */ crown: 'spire' | 'fire' }
export const CITADEL_TOWERS: readonly CitadelTower[] = [
  { x: -10.6, z: -49, r: 4.2, top: 41.5, crown: 'spire' },
  { x: 10.6, z: -49, r: 4.2, top: 41.5, crown: 'spire' },
  { x: -34, z: -50, r: 4.4, top: 33, crown: 'fire' },
  { x: 34, z: -50, r: 4.4, top: 33, crown: 'fire' },
  { x: -35, z: -76, r: 3.4, top: 32, crown: 'spire' },
  { x: 35, z: -76, r: 3.4, top: 32, crown: 'spire' },
  { x: -34, z: -102, r: 4.4, top: 34, crown: 'fire' },
  { x: 34, z: -102, r: 4.4, top: 34, crown: 'fire' },
];

/** Curtain walls: outer face line, inner side by `thick`; the walk on top at `top`. */
export const CITADEL_WALL = { south: -48.4, side: 35, back: -105, thick: 3, top: 29 } as const;

/** The keep at the north end of the court, its south face toward the arena, the great spire and the eclipsed sun. */
export const CITADEL_KEEP = { x: 0, z: -108, hx: 10, hz: 7.5, top: 45, turret: 2.4, spire: 26 } as const;

/** Sun obelisks round the arena (fire on top), clear of the gate and the keep, outside the 21 m floor. */
export function citadelObelisks(): { i: number; x: number; z: number; a: number }[] {
  const out: { i: number; x: number; z: number; a: number }[] = [];
  // Angle from +z (the gate) round to -z (the keep).
  [44, 76, 106, 137].forEach((deg, k) => {
    for (const s of [-1, 1]) {
      const a = s * deg * Math.PI / 180;
      out.push({ i: k * 2 + (s > 0 ? 1 : 0), x: Math.sin(a) * 26.2, z: CITADEL_ARENA.z + Math.cos(a) * 26.2, a });
    }
  });
  return out;
}

/** Ceremonial pairs on the ascent: obelisks either side of the avenue below the gate. */
export const CITADEL_APPROACH = { x: 7.8, z: [-35, -41.5] as readonly number[] } as const;

/** Fire bowls on pedestals: before the gate and either side of the keep's door. */
export const CITADEL_BRAZIERS: readonly { x: number; z: number }[] = [
  { x: -5.6, z: -44.6 }, { x: 5.6, z: -44.6 },
  { x: -7.6, z: -98.4 }, { x: 7.6, z: -98.4 },
];

/** Inside the citadel's walls (or under them): the volcanic rock ring and the outer trees leave this to the citadel. */
export function citadelHolds(x: number, z: number): boolean {
  return Math.abs(x) < CITADEL_WALL.side + 6 && z < CITADEL_WALL.south + 4 && z > CITADEL_KEEP.z - CITADEL_KEEP.hz - 6;
}

/** Every solid of the citadel; the avenue, the gate passage, the court and the arena stay open. */
export function registerDawnCitadel(h: Height, col: Collision): void {
  const W = CITADEL_WALL, G = CITADEL_GATE, K = CITADEL_KEEP, low = (x: number, z: number) => h(x, z) - 2;
  // Gatehouse piers either side of the passage.
  for (const s of [-1, 1]) {
    const x0 = G.open, x1 = G.half, cx = s * (x0 + x1) / 2;
    col.addBox(cx, (G.front + G.back) / 2, (x1 - x0) / 2, (G.front - G.back) / 2, 0, low(cx, G.front), G.top);
  }
  for (const t of CITADEL_TOWERS) col.addCircle(t.x, t.z, t.r + .5, low(t.x, t.z), t.top + 2);
  for (const s of [-1, 1]) {
    // South curtain from the gate tower to the corner tower.
    const xa = 10.6 + 3, xb = 34 - 3, cx = s * (xa + xb) / 2;
    col.addBox(cx, W.south - W.thick / 2, (xb - xa) / 2 + .4, W.thick / 2, 0, low(cx, W.south) - 2, W.top + 2);
    // Side curtain.
    const za = W.south - 2, zb = W.back + 1, cz = (za + zb) / 2;
    col.addBox(s * (W.side - W.thick / 2), cz, W.thick / 2, (za - zb) / 2, 0, low(s * W.side, cz) - 2, W.top + 2);
  }
  col.addBox(0, W.back + W.thick / 2, W.side, W.thick / 2, 0, low(0, W.back) - 2, W.top + 2);
  col.addBox(K.x, K.z, K.hx + .4, K.hz + .4, 0, low(K.x, K.z) - 2, K.top + 4);
  for (const o of citadelObelisks()) col.addCircle(o.x, o.z, 1.35, low(o.x, o.z), h(o.x, o.z) + 9);
  for (const s of [-1, 1]) for (const z of CITADEL_APPROACH.z) col.addCircle(s * CITADEL_APPROACH.x, z, 1.1, low(s * CITADEL_APPROACH.x, z), h(s * CITADEL_APPROACH.x, z) + 8);
  for (const b of CITADEL_BRAZIERS) col.addCircle(b.x, b.z, .75, low(b.x, b.z), h(b.x, b.z) + 2.4);
}
