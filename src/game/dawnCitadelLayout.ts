// Solarkan's Twilight Citadel on Dawnharbor's north plateau, numbers only: the sun temple-fortress round the boss arena,
// its pylon gateway on the ascent, curtain walls and porticoes, towers, the keep and the sun obelisks. Shared by the meshes
// (dawnCitadel.ts) and the colliders (world3Colliders.ts, baked for the server).
import { DAWN_ARENA_HEIGHT } from '../sim/world/ground';
import type { Collision } from '../world/collision';

type Height = (x: number, z: number) => number;

/** The combat floor (flat at 19 out to r 21 in dawnHeight) and the carved curb ring round it. */
export const CITADEL_ARENA = { x: 0, z: -72, y: DAWN_ARENA_HEIGHT, r: 21, curb: 22.4 } as const;

/**
 * The pylon gateway astride the avenue on the last of the ascent: two battered wings either side of a lower portal.
 * `front` and `back` are the faces at the top (each wing leans out by `batter` to its foot), `half` the wings' outer
 * edge, `open` the passage's half width; `apex` (the lintel's underside) and `portal` (the portal's top) are above the
 * ground at the front, `top` the wings' top. It stands south of z -45.2 so the arena's camera (and a player's,
 * fighting at the south edge) looks over the open court, not into it.
 */
export const CITADEL_GATE = { half: 12.5, front: -40.4, back: -44.8, open: 3.4, apex: 9.4, portal: 13.8, top: 34.5, batter: 1.2 } as const;

/** A square battered tower: `r` the half width at the top; 'sun': a gilt sun on a stem; 'fire': a fire bowl. */
export interface CitadelTower { x: number; z: number; r: number; top: number; crown: 'sun' | 'fire' }
export const CITADEL_TOWERS: readonly CitadelTower[] = [
  { x: -34, z: -50, r: 4.4, top: 33, crown: 'fire' },
  { x: 34, z: -50, r: 4.4, top: 33, crown: 'fire' },
  { x: -35, z: -76, r: 3.4, top: 32, crown: 'sun' },
  { x: 35, z: -76, r: 3.4, top: 32, crown: 'sun' },
  { x: -34, z: -102, r: 4.4, top: 34, crown: 'fire' },
  { x: 34, z: -102, r: 4.4, top: 34, crown: 'fire' },
];

/**
 * Curtain walls (sides and back): outer face line, inner side by `thick`; the walk on top at `top`. The south side is
 * a low terrace wall (`south` its outer face, `low` high), so the court lies open to the town and the cameras.
 */
export const CITADEL_WALL = { south: -45.6, low: 1.7, side: 35, back: -105, thick: 3, top: 29 } as const;

/** The keep (the sanctuary) at the north end of the court, its south face toward the arena, the great sun on its roof. */
export const CITADEL_KEEP = { x: 0, z: -108, hx: 10, hz: 7.5, top: 45 } as const;

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
export const CITADEL_APPROACH = { x: 7.8, z: [-26.5, -33.5] as readonly number[] } as const;

/** Fire bowls on pedestals: before the gate and either side of the keep's door. */
/** |x| span of the low south wall on each side, pylon to corner tower. */
export const SOUTH_RUN = [12.6, 31.2] as const;

/** Porticoes along the inside of the side walls: columns at |x| = x from z0 to z1, `h` from the highest foot to the architrave. */
export const CITADEL_COLONNADE = { x: 29.2, z0: -55, z1: -97, step: 3.5, r: .62, h: 6.6 } as const;
export function colonnadeColumns(): { x: number; z: number }[] {
  const C = CITADEL_COLONNADE, out: { x: number; z: number }[] = [];
  for (const s of [-1, 1]) for (let z = C.z0; z >= C.z1 - .01; z -= C.step) out.push({ x: s * C.x, z });
  return out;
}

export const CITADEL_BRAZIERS: readonly { x: number; z: number }[] = [
  { x: -5.4, z: -37.4 }, { x: 5.4, z: -37.4 },
  { x: -7.6, z: -98.4 }, { x: 7.6, z: -98.4 },
];

/** Inside the citadel's walls (or under them): the volcanic rock ring and the outer trees leave this to the citadel. */
export function citadelHolds(x: number, z: number): boolean {
  return Math.abs(x) < CITADEL_WALL.side + 6 && z < CITADEL_WALL.south + 2 && z > CITADEL_KEEP.z - CITADEL_KEEP.hz - 6;
}

/** Every solid of the citadel; the avenue, the gate passage, the court and the arena stay open. */
export function registerDawnCitadel(h: Height, col: Collision): void {
  const W = CITADEL_WALL, G = CITADEL_GATE, K = CITADEL_KEEP, low = (x: number, z: number) => h(x, z) - 2;
  // The pylon's wings and the portal's jambs either side of the passage, to the foot of the batter.
  for (const s of [-1, 1]) {
    const x0 = G.open, x1 = G.half + G.batter, cx = s * (x0 + x1) / 2;
    col.addBox(cx, (G.front + G.back) / 2, (x1 - x0) / 2, (G.front - G.back) / 2 + G.batter, 0, low(cx, G.front), G.top + 2);
  }
  // Square battered towers, to the foot of the batter.
  for (const t of CITADEL_TOWERS) col.addBox(t.x, t.z, t.r + 1, t.r + 1, 0, low(t.x, t.z), t.top + 3);
  for (const s of [-1, 1]) {
    // The low south terrace wall from the pylon to the corner tower.
    const xa = SOUTH_RUN[0], xb = SOUTH_RUN[1], cx = s * (xa + xb) / 2;
    col.addBox(cx, W.south - .45, (xb - xa) / 2 + .3, .5, 0, low(cx, W.south) - 1, Math.max(h(s * xa, W.south), h(s * xb, W.south)) + W.low + .3);
    // Side curtain.
    const za = -50, zb = W.back + 1, cz = (za + zb) / 2;
    col.addBox(s * (W.side - W.thick / 2 + .5), cz, W.thick / 2 + .5, (za - zb) / 2, 0, low(s * W.side, cz) - 2, W.top + 2);
  }
  col.addBox(0, W.back + W.thick / 2 - .5, W.side, W.thick / 2 + .5, 0, low(0, W.back) - 2, W.top + 2);
  for (const c of colonnadeColumns()) col.addCircle(c.x, c.z, CITADEL_COLONNADE.r, low(c.x, c.z), h(c.x, c.z) + CITADEL_COLONNADE.h + 1);
  col.addBox(K.x, K.z - .4, K.hx + 1.2, K.hz + .8, 0, low(K.x, K.z) - 2, K.top + 4);
  for (const o of citadelObelisks()) col.addCircle(o.x, o.z, 1.35, low(o.x, o.z), h(o.x, o.z) + 9);
  for (const s of [-1, 1]) for (const z of CITADEL_APPROACH.z) col.addCircle(s * CITADEL_APPROACH.x, z, 1.1, low(s * CITADEL_APPROACH.x, z), h(s * CITADEL_APPROACH.x, z) + 8);
  for (const b of CITADEL_BRAZIERS) col.addCircle(b.x, b.z, .75, low(b.x, b.z), h(b.x, b.z) + 2.4);
}
