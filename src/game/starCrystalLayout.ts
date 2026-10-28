// Where Starhaven's field crystals grow, and why. Numbers only (plus their rotations): world2.ts draws them,
// world2Colliders.ts registers each one's solid for the browser and the server bake, starLight.ts bakes their glow.
// The fallen star seeded the island: crystals crowd the crater's rim where it struck, miners cut a seam of them east
// of the village, the observatory's keepers set a ring of them on the western rise looking at the sanctum, and wild
// clusters stand in the fields with open meadow between them. Every crystal keeps clear of the town, the avenue, the
// arena, the trails, the quest points, the enemies' homes, the trees and the story props.
import * as THREE from 'three';
import {facetedStarCrystal, starCrystalRadius} from './starCrystal';
import {rot, STAR_BOAT, STAR_CAMP, STAR_CRATER, STAR_KEEP_POINTS, STAR_MINE, STAR_MINE_PROPS, STAR_RING, starCoast} from './starFieldLayout';
import {nearStarObjective, starForestSpots, starTrailDistance} from './world2Settlement';

export interface StarCrystalSpot {
  x: number; z: number; y: number; h: number; q: THREE.Quaternion; scale: THREE.Vector3;
  /** Which story it belongs to (QA and the glow's colour). */
  site: 'crater' | 'mine' | 'ring' | 'wild';
  /** Cut down by the miners: a flat-topped stump. */
  cut: boolean;
  /** Index of its cluster (QA). */
  cluster: number;
  solid: {x: number; z: number; r: number; y0: number; y1: number};
}


const rand = (i: number) => { const x = Math.sin(i * 127.1 + 41.7) * 43758.5453; return x - Math.floor(x); };
const rect = (x: number, z: number, ax: number, bx: number, az: number, bz: number) => Math.hypot(Math.max(ax - x, 0, x - bx), Math.max(az - z, 0, z - bz));

/** Every home a World II enemy can be given (world2.ts enter()). Same list as starFieldSpots.starEnemyHomes. */
function enemyHomes(): [number, number][] {
  const out: [number, number][] = [];
  for (let slot = 0; slot < 6; slot++) out.push([66 + (slot % 3) * 8, 20 - Math.floor(slot / 3) * 32 - (slot % 3) * 4]);
  out.push([19, -8], [30, -22], [20, -34]);
  for (let i = 3; i < 26; i++) for (const side of [-1, 1]) out.push([side * (60 + (i % 4) * 7), 28 - Math.floor(i / 4) * 16 - (i % 3) * 3]);
  return out;
}

let cached: StarCrystalSpot[] | null = null;

/** Field crystals; `height` places them (the layout itself never depends on it). */
export function starCrystalSpots(height: (x: number, z: number) => number): StarCrystalSpot[] {
  if (!cached) cached = layout();
  return cached.map(c => ({...c, y: height(c.x, c.z), solid: {...c.solid, y0: height(c.x, c.z) - .5, y1: height(c.x, c.z) + c.h * 1.6}}));
}

function layout(): StarCrystalSpot[] {
  const geometry = facetedStarCrystal(), out: StarCrystalSpot[] = [];
  const homes = enemyHomes(), trees = starForestSpots().filter(p => !p.rock);
  const mineProps = STAR_MINE_PROPS.map(p => { const [rx, rz] = rot(p.dx, p.dz, STAR_MINE.yaw); return {x: STAR_MINE.x + rx, z: STAR_MINE.z + rz, r: p.r}; });
  const free = (x: number, z: number, r: number) => {
    if (Math.min(Math.max(0, Math.hypot(x, z + 75) - 27), rect(x, z, -11, 11, -100, 105), rect(x, z, -57, 57, 0, 104)) < r + 1) return false;
    if (starTrailDistance(x, z) < r + 2 || nearStarObjective(x, z, r)) return false;
    if (starCoast(x, z).r > .74) return false;
    for (const [hx, hz] of homes) if (Math.hypot(x - hx, z - hz) < r + 1.8) return false;
    for (const t of trees) if (Math.hypot(x - t.x, z - t.z) < r + .5 * t.scale + 1.2) return false;
    for (const [px, pz, pr] of STAR_KEEP_POINTS) if (Math.hypot(x - px, z - pz) < r + pr) return false;
    for (const p of mineProps) if (Math.hypot(x - p.x, z - p.z) < r + p.r + .8) return false;
    if (Math.hypot(x - STAR_CAMP.x, z - STAR_CAMP.z) < r + 9) return false;
    if (Math.hypot(x - STAR_BOAT.x, z - STAR_BOAT.z) < r + 5) return false;
    if (Math.hypot(x - STAR_CRATER.x, z - STAR_CRATER.z) < r + STAR_CRATER.r * 1.05) return false;
    // Moonshade's glade and the observatory's floor have their own landmarks.
    if (Math.hypot(x + 75, z + 35) < r + 12 || Math.hypot(x - 80, z + 40) < r + 8) return false;
    return true;
  };
  const add = (x: number, z: number, h: number, width: number, lean: number, leanDir: number, spin: number, site: StarCrystalSpot['site'], cluster: number, cut = false) => {
    const scale = new THREE.Vector3(width, h, width * (.85 + .3 * rand(x * 3.1 + z)));
    // Lean outward from the cluster's heart (a tilt about the axis across the lean), then a turn about its own axis.
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(Math.sin(leanDir), 0, -Math.cos(leanDir)), lean).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spin));
    const r = Math.max(Math.max(width, .8) * .6 + h * .1, starCrystalRadius(geometry, scale, q));
    if (!free(x, z, r)) return false;
    out.push({x, z, y: 0, h, q, scale, site, cut, cluster, solid: {x, z, r, y0: 0, y1: 0}});
    return true;
  };
  /** A cluster: a near-upright hero, two or three leaning mid crystals, small ones further out (rule of odds). */
  const cluster = (cx: number, cz: number, n: number, heroH: number, seed: number, site: StarCrystalSpot['site'], id: number) => {
    let placed = 0;
    if (add(cx, cz, heroH, 1.1 + .4 * rand(seed), .05 + .1 * rand(seed + 1), rand(seed + 2) * 6.28, rand(seed + 3) * 6.28, site, id)) placed++;
    for (let k = 1; k < n; k++) {
      const mid = k <= 3, a = rand(seed + k * 7) * 6.28 + k * 2.4, d = (mid ? 1.3 + 1.1 * rand(seed + k * 7 + 1) : 2.3 + 1.6 * rand(seed + k * 7 + 1)) * (.8 + heroH * .06);
      const h = heroH * (mid ? .42 + .2 * rand(seed + k * 7 + 2) : .16 + .14 * rand(seed + k * 7 + 2) ** 2);
      if (add(cx + Math.cos(a) * d, cz + Math.sin(a) * d, h, mid ? .8 + .3 * rand(seed + k) : .55 + .25 * rand(seed + k), (mid ? .2 : .35) + .3 * rand(seed + k * 7 + 3), a, rand(seed + k * 7 + 4) * 6.28, site, id)) placed++;
    }
    return placed;
  };
  let id = 0;
  // The crater: two groups breaking out of its rim where the star's heat went furthest, the larger to the north-east.
  for (const [a, n, hh] of [[-.75, 7, 6.2], [2.5, 5, 4.2]] as const) {
    const d = STAR_CRATER.r * 1.05 + 3.2;
    cluster(STAR_CRATER.x + Math.cos(a) * d, STAR_CRATER.z + Math.sin(a) * d, n, hh, 300 + id * 31, 'crater', id);id++;
  }
  // The mine: an uncut hero and its seam, and the stumps the miners left (flat, cut tops).
  cluster(STAR_MINE.x + 2, STAR_MINE.z - 1, 5, 5.4, 700, 'mine', id);
  for (let k = 0; k < 5; k++) {
    const a = STAR_MINE.yaw + .9 + k * .55, d = 3 + (k % 2) * 1.1;
    add(STAR_MINE.x + 2 + Math.cos(a) * d, STAR_MINE.z - 1 + Math.sin(a) * d, 1.2 + .6 * rand(710 + k), .9 + .3 * rand(720 + k), .08 * rand(730 + k), a, rand(740 + k) * 6.28, 'mine', id, true);
  }
  id++;
  // The keepers' ring: seven on the circle, all near-upright and leaning a little inward, the gap toward the sanctum.
  const toSanctum = Math.atan2(-75 - STAR_RING.z, 0 - STAR_RING.x);
  for (let k = 0; k < 7; k++) {
    const a = toSanctum + Math.PI * 2 * (k + 1) / 8, x = STAR_RING.x + Math.cos(a) * STAR_RING.r, z = STAR_RING.z + Math.sin(a) * STAR_RING.r;
    add(x, z, 3.6 + 1.6 * (k % 2 ? rand(800 + k) : 1 - .3 * rand(800 + k)), 1.05, .12, a + Math.PI, a + Math.PI / 2, 'ring', id);
  }
  id++;
  // Wild clusters: Poisson-disc centres (dart throwing, a cluster's own footprint apart) over the fields.
  const centres: [number, number][] = [[STAR_CRATER.x, STAR_CRATER.z], [STAR_MINE.x, STAR_MINE.z], [STAR_RING.x, STAR_RING.z], [-75, -35], [80, -40]];
  for (let i = 0, made = 0; i < 400 && made < 9; i++) {
    const a = rand(i * 3 + 1000) * Math.PI * 2, rr = .35 + .38 * Math.sqrt(rand(i * 3 + 1001)), x = Math.cos(a) * 115 * rr, z = 10 + Math.sin(a) * 140 * rr;
    if (centres.some(([px, pz]) => Math.hypot(x - px, z - pz) < 26)) continue;
    if (!free(x, z, 1.4)) continue;
    const n = 3 + Math.floor(rand(i * 3 + 1002) * 5);
    if (cluster(x, z, n, 3.2 + 3 * rand(i + 1050), 1100 + i * 17, 'wild', id) >= 3) { centres.push([x, z]);made++;id++; }
    else out.splice(out.length - out.filter(c => c.cluster === id).length);
  }
  geometry.dispose();
  return out;
}

