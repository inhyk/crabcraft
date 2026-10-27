// Where Starhaven's field boulders, crater shards and story props stand. Positions only: starFields.ts and
// starStories.ts dress them, world2Colliders.ts registers the solid ones for the browser and the server bake.
import {STAR_BOAT,STAR_CAMP,STAR_CRATER,STAR_KEEP_POINTS,starBluff,starCoast,starNoise} from './starFieldLayout';
import {nearStarObjective,starForestSpots,starTrailDistance} from './world2Settlement';
import {starCrystalGarden} from './world2Colliders';

export interface StarBoulder { x: number; z: number; r: number; h: number; yaw: number; shape: number; solid: boolean }

const rand = (i: number) => { const a = Math.sin(i * 91.7 + 13.1) * 43758.5453; return a - Math.floor(a); };
const rect = (x: number, z: number, ax: number, bx: number, az: number, bz: number) => Math.hypot(Math.max(ax - x, 0, x - bx), Math.max(az - z, 0, z - bz));
/** Distance outside the town, the avenue and the boss floor. */
export const starPlayDistance = (x: number, z: number) => Math.min(Math.max(0, Math.hypot(x, z + 75) - 24), rect(x, z, -9, 9, -100, 105), rect(x, z, -54, 54, 3, 100));

/** Every home a World II enemy can be given (world2.ts enter()), so no solid lands on one. */
export function starEnemyHomes(): [number, number][] {
  const out: [number, number][] = [];
  for (let slot = 0; slot < 6; slot++) out.push([66 + (slot % 3) * 8, 20 - Math.floor(slot / 3) * 32 - (slot % 3) * 4]);
  out.push([19, -8], [30, -22], [20, -34]);
  for (let i = 3; i < 26; i++) for (const side of [-1, 1]) out.push([side * (60 + (i % 4) * 7), 28 - Math.floor(i / 4) * 16 - (i % 3) * 3]);
  return out;
}

/** Story props' footprints: the camp's tent and telescope, the beached boat. */
export const STAR_STORY_SOLIDS: readonly {x: number; z: number; r: number; h: number}[] = [
  {x: STAR_CAMP.x - 2.2, z: STAR_CAMP.z + 1.2, r: 1.55, h: 2.2},
  {x: STAR_CAMP.x + 2.4, z: STAR_CAMP.z - 1.6, r: .45, h: 2},
  {x: STAR_BOAT.x + Math.sin(STAR_BOAT.yaw) * 1.6, z: STAR_BOAT.z + Math.cos(STAR_BOAT.yaw) * 1.6, r: 1.05, h: 1.2},
  {x: STAR_BOAT.x - Math.sin(STAR_BOAT.yaw) * 1.6, z: STAR_BOAT.z - Math.cos(STAR_BOAT.yaw) * 1.6, r: 1.05, h: 1.2},
];

let cached: StarBoulder[] | null = null;
/**
 * Field boulders: the old forest rock spots, a line along the bluff tops, a few round the crater's rim and the
 * camp's knoll, and loose stones in the meadows. Each keeps clear of the trails, objectives, enemy homes, the
 * crystal gardens, the story props and every play area. Stones under 0.6 m are not solid.
 */
export function starBoulders(): StarBoulder[] {
  if (cached) return cached;
  const homes = starEnemyHomes();
  const crystals = starCrystalGarden(() => 0).filter((c) => !c.clear).map((c) => c.solid);
  const out: StarBoulder[] = [];
  const free = (x: number, z: number, r: number) => {
    if (starPlayDistance(x, z) < r + 3 || starTrailDistance(x, z) < r + 2.2 || nearStarObjective(x, z, r + 1)) return false;
    if (starCoast(x, z).r > .9) return false;
    for (const [hx, hz] of homes) if (Math.hypot(x - hx, z - hz) < r * .82 + 1.8) return false;
    for (const c of crystals) if (Math.hypot(x - c.x, z - c.z) < r + c.r + .6) return false;
    for (const [px, pz, pr] of STAR_KEEP_POINTS) if (Math.hypot(x - px, z - pz) < r + pr) return false;
    for (const s of STAR_STORY_SOLIDS) if (Math.hypot(x - s.x, z - s.z) < r + s.r + 1.5) return false;
    if (Math.hypot(x - STAR_CAMP.x, z - STAR_CAMP.z) < r + 6.5) return false;
    if (Math.hypot(x - STAR_CRATER.x, z - STAR_CRATER.z) < r + STAR_CRATER.r * .95) return false;
    for (const b of out) if (Math.hypot(x - b.x, z - b.z) < r + b.r + .5) return false;
    return true;
  };
  const add = (i: number, x: number, z: number, r: number) => {
    if (!free(x, z, r)) return;
    out.push({x, z, r, h: r * (.55 + .3 * rand(i + 5)), yaw: rand(i + 9) * Math.PI * 2, shape: Math.floor(rand(i + 11) * 10), solid: r >= .6});
  };
  for (const p of starForestSpots()) if (p.rock) add(p.i, p.x, p.z, .45 * p.scale + .35);
  // Bluff tops: where the coast stands up, a broken line of big stones just inland of the edge.
  for (let i = 0; i < 160; i++) {
    const a = i / 160 * Math.PI * 2, rr = .79 + .04 * rand(i + 300), x = Math.cos(a) * 115 * rr, z = 10 + Math.sin(a) * 140 * rr;
    if (starBluff(x, z) < .6 || rand(i + 301) < .55) continue;
    add(1000 + i, x, z, .7 + 1.1 * rand(i + 302));
  }
  // The crater's rim: stones it threw out, small ones further.
  for (let i = 0; i < 9; i++) {
    const a = i * 2.39996 + .4, d = STAR_CRATER.r * (1.25 + .5 * rand(i + 400));
    add(2000 + i, STAR_CRATER.x + Math.cos(a) * d, STAR_CRATER.z + Math.sin(a) * d, .35 + .55 * rand(i + 401));
  }
  // The knoll's crown: two big stones to sit on beside the camp.
  for (const [i, dx, dz, r] of [[0, -6.2, -3.5, 1.1], [1, 6.8, 2.5, .9], [2, -1, 8.5, 1.3]] as const) add(2100 + i, STAR_CAMP.x + dx, STAR_CAMP.z + dz, r);
  // Loose stones in the meadows, gathered where the ground swells.
  for (let i = 0; i < 400; i++) {
    const x = (rand(i + 500) - .5) * 210, z = (rand(i + 900) - .5) * 250 + 10;
    if (starNoise(x / 23, z / 23, 61) < .12) continue;
    add(3000 + i, x, z, .2 + .4 * rand(i + 501) ** 2);
  }
  cached = out;
  return out;
}

/** The fallen star's shards: tilted, half buried, the biggest in the middle. */
export function starCraterShards() {
  const out: {x: number; z: number; h: number; w: number; tilt: number; yaw: number}[] = [{x: STAR_CRATER.x + .3, z: STAR_CRATER.z - .2, h: 2.1, w: .62, tilt: .38, yaw: .7}];
  for (let i = 0; i < 9; i++) {
    const a = i * 2.39996 + 1.1, d = 1.4 + 3.2 * rand(i + 700);
    out.push({x: STAR_CRATER.x + Math.cos(a) * d, z: STAR_CRATER.z + Math.sin(a) * d, h: .5 + .8 * rand(i + 701), w: .14 + .16 * rand(i + 702), tilt: .35 + .55 * rand(i + 703), yaw: a + Math.PI});
  }
  return out;
}

