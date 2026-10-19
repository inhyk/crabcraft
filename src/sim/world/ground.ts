// Ground height of the four worlds, shared by the browser and the server (numbers only).
import { snowGround } from './snowGround.ts';

export interface HeightGrid {
  minX: number;
  minZ: number;
  step: number;
  nx: number;
  nz: number;
  h: ArrayLike<number>;
}

/** World I: exact height of the rendered terrain triangles; -20 off the grid. */
export function gridHeight(g: HeightGrid, x: number, z: number): number {
  const fi = (x - g.minX) / g.step;
  const fj = (z - g.minZ) / g.step;
  if (fi < 0 || fj < 0 || fi >= g.nx - 1 || fj >= g.nz - 1) return -20;
  const i = Math.floor(fi);
  const j = Math.floor(fj);
  const u = fi - i;
  const v = fj - j;
  const k = j * g.nx + i;
  const h = g.h;
  // Triangles split along the (i+1, j) - (i, j+1) diagonal, matching Terrain.buildMesh().
  if (u + v <= 1) return h[k] + (h[k + 1] - h[k]) * u + (h[k + g.nx] - h[k]) * v;
  const h11 = h[k + g.nx + 1];
  return h11 + (h[k + g.nx] - h11) * (1 - u) + (h[k + 1] - h11) * (1 - v);
}

/** World II's height samples: 141 x 161 vertices, 2 m apart, from (-140, -160). */
export const STAR_GRID = { nx: 141, nz: 161, step: 2, minX: -140, minZ: -160 } as const;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const smoothstep = (x: number, min: number, max: number) => {
  if (x <= min) return 0;
  if (x >= max) return 1;
  x = (x - min) / (max - min);
  return x * x * (3 - 2 * x);
};

/** World II: PlaneGeometry uses a-b-d / b-c-d triangles. Follow their planes, including off-grid points. */
export function starSurfaceHeight(heights: ArrayLike<number>, x: number, z: number): number {
  const { nx: NX, nz: NZ, step: STEP, minX: MIN_X, minZ: MIN_Z } = STAR_GRID;
  const gx = clamp((x - MIN_X) / STEP, 0, NX - 1),
    gz = clamp((z - MIN_Z) / STEP, 0, NZ - 1);
  const ix = Math.min(NX - 2, Math.floor(gx)),
    iz = Math.min(NZ - 2, Math.floor(gz)),
    u = gx - ix,
    v = gz - iz;
  const a = heights[iz * NX + ix],
    b = heights[(iz + 1) * NX + ix],
    d = heights[iz * NX + ix + 1],
    c = heights[(iz + 1) * NX + ix + 1];
  return u + v <= 1 ? a + (d - a) * u + (b - a) * v : c + (b - c) * (1 - u) + (d - c) * (1 - v);
}

export const DAWN_ARENA_HEIGHT=19;
/** World III: an analytic island, a warm coast rising to the citadel. */
export function dawnHeight(x: number, z: number): number {
  const radial = Math.hypot(x / 122, (z - 3) / 149);
  const shore = 4 - Math.max(0, radial - 0.83) * 65;
  const upland = 13 * smoothstep(-z, 5, 55);
  const hills = Math.sin(x * 0.045) * Math.sin(z * 0.04) * 2 * (1 - Math.exp((-x * x) / 400));
  const natural=radial > 0.86 ? shore : 4 + upland + hills;
  const arena=1-smoothstep(Math.hypot(x,z+72),21,31);
  return natural+(DAWN_ARENA_HEIGHT-natural)*arena;
}

/** World IV: Frostlight's carved snowfield (snowGround.ts), the old shore, trail and arena kept where gameplay needs them. */
export function snowHeight(x: number, z: number): number {
  return snowGround(x, z);
}

/** Broad, walkable frontier terraces with the same surface in rendering and simulation. */
export function realmHeight(chapter:5|6,x:number,z:number):number {
 const edge=Math.hypot(x/128,(z-2)/155);
 if(edge>.83)return 6-(edge-.83)*85;
 const rise=chapter===5?9:12;
 const hills=Math.sin(x*.047)*Math.sin(z*.035)*(chapter===5?2:1.4)*(1-Math.exp(-x*x/900));
 const y=6+rise*smoothstep(-z,0,65)+hills;
 const plaza=1-smoothstep(Math.hypot(x,z+72),20,28);
 return y+(6+rise-y)*plaza;
}
