// Ground height of the four worlds, shared by the browser and the server (numbers only).
import { snowGround } from './snowGround.ts';
import { dawnGround } from './dawnGround.ts';

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
/** World III: the analytic island, its open fields and coast reshaped (dawnGround.ts), the arena raised to 19 m. */
export function dawnHeight(x: number, z: number): number {
  return dawnGround(x, z, DAWN_ARENA_HEIGHT);
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
 const h=y+(6+rise-y)*plaza;
 return chapter===6?h-skybloomShoulder(x,z,edge):h;
}

/**
 * World VI only: the outer meadows fall away toward the cliff lip, so the sea of clouds shows past the ridge from the
 * town and the avenue. Zero (exactly) in every play zone: the town and harbour, the avenue, the sanctuary arena, the
 * world tree's north strip, and every quest, NPC and enemy point (all lie inside edge .58).
 */
function skybloomShoulder(x:number,z:number,edge:number):number {
 if(edge<=.58)return 0;
 const out=(d:number,a:number,b:number)=>smoothstep(d,a,b);
 const town=Math.hypot(Math.max(0,Math.abs(x)-46),Math.max(0,20-z,z-98));
 const avenue=Math.abs(x)-(z>-72&&z<100?10:0)+(z<=-72||z>=100?99:0);
 const arena=Math.hypot(x,z+72)-30,north=z<-90?Math.abs(x)-30:99;
 const keep=out(town,0,14)*out(avenue,0,14)*out(arena,0,12)*out(north,0,14);
 return 14*smoothstep(edge,.58,.83)*keep;
}
