// Goldsand Harbor's square and arrival ground (World III): the scenes that furnish them and the solids the server bakes.
// No THREE here (tools/bake-collision.mjs bakes registerDawnPlaza through world3Colliders.ts); the meshes are built
// by dawnGoods.ts round the same spots and to the same sizes.
//
// Dressed with intent: the caravans come in through the arrival gate and tie up at the hitching rail, the market's
// two rows lead to the well at the square's harbour corner and its trough, the harbour's cargo comes up the avenue on
// a hand cart and is stacked at the square's east corner for the stalls, and a striped shade canopy over benches and
// a tea table takes the square's citadel corner. Every scene keeps off the avenue, the cross street and the side
// lanes, the villagers' posts, the quest points and the lamps (qa-dawn-plaza checks).
import type { Collision } from '../world/collision';

export type PlazaKind = 'well' | 'trough' | 'hitch' | 'cargo' | 'cart' | 'canopy';
export interface PlazaSpot { x: number; z: number; yaw: number; kind: PlazaKind }

export const DAWN_PLAZA: readonly PlazaSpot[] = [
  { x: -6.3, z: 58.1, yaw: .3, kind: 'well' },
  { x: -5.35, z: 60.9, yaw: 0, kind: 'trough' },
  { x: -7.1, z: 67.4, yaw: 0, kind: 'hitch' },
  { x: 6.5, z: 58.5, yaw: -.25, kind: 'cargo' },
  { x: 6.5, z: 79.2, yaw: .12, kind: 'cart' },
  { x: -6.6, z: 48.2, yaw: 0, kind: 'canopy' },
];

/** Sizes the meshes are built to (local metres). */
export const PLAZA_SIZE = {
  /** The well's drum: outer radius, height of the coping. */
  well: { r: .95, h: .82, post: .86, beam: 2.3 },
  /** Stone trough: length along local z, width, height. */
  trough: { l: 1.9, w: .62, h: .56 },
  /** Hitching rail: posts along local z at these offsets, height. */
  hitch: { posts: [-1.2, 0, 1.2], h: 1.1 },
  /** Cargo stack footprint (half sizes) and height. */
  cargo: { hx: .95, hz: .6, h: 1.25 },
  /** Hand cart: half width, half length (shafts along local +z), height of the load. */
  cart: { hx: .78, hz: 1.45, h: 1.35 },
  /** Canopy: post offsets (half sizes) and the cloth's height at the posts. */
  canopy: { hx: 1.55, hz: 1.3, h: 2.55 },
} as const;

/** Local (x, z) round a spot to the world (dawnGoods.ts's frame: yaw turns local +z toward world (sin, cos)). */
export function plazaAt(s: PlazaSpot, x: number, z: number): [number, number] {
  const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
  return [s.x + x * c + z * sn, s.z - x * sn + z * c];
}

/** The solids: circles {x, z, r, h} and boxes {x, z, hx, hz, yaw, h}, heights over the ground at their centre. */
export function plazaSolids(): ({ x: number; z: number; r: number; h: number } | { x: number; z: number; hx: number; hz: number; yaw: number; h: number })[] {
  const out: ({ x: number; z: number; r: number; h: number } | { x: number; z: number; hx: number; hz: number; yaw: number; h: number })[] = [];
  for (const s of DAWN_PLAZA) {
    if (s.kind === 'well') out.push({ x: s.x, z: s.z, r: PLAZA_SIZE.well.r + .05, h: PLAZA_SIZE.well.h + .3 });
    else if (s.kind === 'trough') out.push({ x: s.x, z: s.z, hx: PLAZA_SIZE.trough.w / 2, hz: PLAZA_SIZE.trough.l / 2, yaw: s.yaw, h: PLAZA_SIZE.trough.h });
    else if (s.kind === 'hitch') out.push({ x: s.x, z: s.z, hx: .14, hz: 1.32, yaw: s.yaw, h: PLAZA_SIZE.hitch.h });
    else if (s.kind === 'cargo') { const [x, z] = plazaAt(s, -.1, 0); out.push({ x, z, hx: PLAZA_SIZE.cargo.hx, hz: PLAZA_SIZE.cargo.hz, yaw: s.yaw, h: PLAZA_SIZE.cargo.h }); }
    else if (s.kind === 'cart') out.push({ x: s.x, z: s.z, hx: PLAZA_SIZE.cart.hx, hz: PLAZA_SIZE.cart.hz, yaw: s.yaw, h: PLAZA_SIZE.cart.h });
    else for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const [x, z] = plazaAt(s, sx * PLAZA_SIZE.canopy.hx, sz * PLAZA_SIZE.canopy.hz);
      out.push({ x, z, r: .12, h: PLAZA_SIZE.canopy.h });
    }
  }
  return out;
}

/** Register the square's solids (the server bakes the same calls). */
export function registerDawnPlaza(height: (x: number, z: number) => number, col: Collision): void {
  for (const s of plazaSolids()) {
    const y = height(s.x, s.z);
    if ('r' in s) col.addCircle(s.x, s.z, s.r, y - .5, y + s.h);
    else col.addBox(s.x, s.z, s.hx, s.hz, s.yaw, y - .5, y + s.h);
  }
}
