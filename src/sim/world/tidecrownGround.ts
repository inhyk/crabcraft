// Tidecrown's landform, numbers only: a limestone capital on a sea promontory north of a tidal estuary, terraces
// rising to the keep's rock, and a forested ridge on the south shore. The browser samples tidecrownGround() onto
// TIDECROWN_GRID and walks the triangles (tidecrownHeight); the server can build the same grid. Imports nothing
// outside src/sim/world.
import { gridHeight, type HeightGrid } from './ground.ts';

type V2 = readonly [number, number];

/** The ceremonial axis: gate G, unit direction u (north-north-east); p = (-u.z, u.x) points east-south-east. */
export const TC_AXIS = { gx: 40, gz: 128, ux: 0.3948, uz: -0.9189 } as const;
export const TC_P = { x: 0.9189, z: 0.3948 } as const;
/** World point at axis distance t and side offset s (along p). */
export function tcAxis(t: number, s = 0): [number, number] {
  return [TC_AXIS.gx + TC_AXIS.ux * t + TC_P.x * s, TC_AXIS.gz + TC_AXIS.uz * t + TC_P.z * s];
}
/** (t, s) of a world point on the axis frame. */
export function tcAxisCoords(x: number, z: number): [number, number] {
  const dx = x - TC_AXIS.gx, dz = z - TC_AXIS.gz;
  return [dx * TC_AXIS.ux + dz * TC_AXIS.uz, dx * TC_P.x + dz * TC_P.z];
}

/** Ground levels: the terraces climb toward the keep so it always stands above the roofs. */
export const TC_LEVEL = { lower: 6, middle: 14, upper: 24, plateau: 40, deck: 8, crest: 28 } as const;
/** Axis distances of the composition, from the ridge crest to the keep. */
export const TC_T = { crest: -135, overlook: -127, bridgeSouth: -104, bridgeNorth: -8, gate: 0, market: 60, middleRamp: 104, upperRamp: 153, stairFoot: 165, stairTop: 201, wardGate: 209.3, keep: 278.6 } as const;
export const TC_KEEP = { x: 150, z: -128 } as const;
/** Keep rock: a superellipse in the axis frame (centre offset and semi-axes along u and p, exponent). Its north and
 * east rims are the sea cliffs. */
export const TC_PLATEAU = { oa: 8, ob: 12, a: 86, b: 106, n: 2.6 } as const;

/** The city wall (Tidecrown frame), south-west corner first; vertices 2 and 3 are the Pincer Gate's sides. */
export const TC_CITY_WALL: readonly V2[] = [
  [-120, 128], [-40, 132], [21.6, 120.1], [58.4, 135.9], [120, 124], [176, 122], [236, 106], [250, 80], [222, 52], [208, -5],
  [222, -60], [256, -86], [250, -128], [206, -196], [142, -222], [60, -208], [-30, -186], [-100, -140], [-140, -70], [-150, 20], [-140, 90],
];
/** Coast of the promontory (land inside); the estuary bank cuts it from the south. */
const NORTH_COAST: readonly V2[] = [
  [-298, 150], [-306, 60], [-290, -60], [-262, -168], [-214, -222], [-160, -202], [-118, -160], [-60, -206], [10, -214], [62, -228], [140, -230],
  [206, -202], [250, -140], [270, -100], [300, -90], [300, 78], [284, 96], [268, 116], [248, 130], [222, 140], [190, 146], [120, 420], [-320, 420],
];
/** The harbour basin east of the quay wall, open to the sea. */
export const TC_HARBOUR: readonly V2[] = [[224, 54], [312, 78], [312, -84], [254, -80], [224, -62], [210, -5]];
/** Estuary banks: x, north bank z, south bank z (it widens to the sea in the east). */
const ESTUARY: readonly (readonly [number, number, number])[] = [
  [-420, 176, 184], [-300, 170, 190], [-160, 164, 196], [-60, 158, 203], [40, 146.5, 213], [100, 140, 225], [160, 136, 238], [220, 133, 262], [300, 132, 300], [380, 132, 430],
];
/** Middle (14) and upper (24) terraces; the rest of the city is the lower town (6). */
const MIDDLE: readonly V2[] = [
  [-118, -6], [-62, 8], [16.8, 4.8], [145.4, 60.1], [186, 34], [192, -20], [206, -62], [232, -110], [196, -170], [140, -200], [60, -198], [-28, -176], [-92, -136], [-124, -72],
];
const UPPER: readonly V2[] = [
  [-6, -60], [47.5, -28.8], [148.6, 14.6], [196, -36], [214, -76], [226, -112], [194, -166], [140, -194], [60, -188], [6, -150], [-18, -100],
];
/** The forest road from the south edge (the future link to Clawhaven) over the crest and down to the bridge. */
export const TC_ROAD: readonly (readonly [number, number, number])[] = [
  [-64, 334, 12.6], [-60, 300, 14], [-52, 284, 17], [-40, 271.5, 21], [-27, 261.5, 25.3], [-13.3, 252.05, 28], [-10.1, 244.7, 27.7],
  [2, 240, 26.4], [18, 237, 24.2], [33, 233, 21], [42.5, 226.5, 19.2], [37, 219.5, 17.6], [22, 219.4, 13.2], [10.4, 227.4, 9], [-1.9, 225.4, 8],
];
/** Index of the first cobbled road vertex: dirt through the woods, stone setts down to the bridge. */
export const TC_ROAD_COBBLE_FROM = 10;
const TC_ROAD_HAIRPIN = 10;
export const TC_ARRIVAL: V2 = [-60, 300];
export const TC_BOUNDS = { minX: -200, maxX: 300, minZ: -260, maxZ: 320 } as const;
/** Terrain samples: 2 m apart, wider than the playable bounds so the coast and sea frame every view. */
export const TIDECROWN_GRID = { minX: -330, minZ: -330, step: 2, nx: 381, nz: 381 } as const;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (x: number, a: number, b: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Signed distance to a closed polygon, positive inside. */
export function polyDistance(x: number, z: number, poly: readonly V2[]): number {
  let d2 = Infinity, inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j], [bx, bz] = poly[i];
    if (az > z !== bz > z && x < ((ax - bx) * (z - bz)) / (az - bz) + bx) inside = !inside;
    const ex = bx - ax, ez = bz - az;
    const t = clamp(((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez), 0, 1);
    const dx = x - (ax + ex * t), dz = z - (az + ez * t);
    d2 = Math.min(d2, dx * dx + dz * dz);
  }
  return inside ? Math.sqrt(d2) : -Math.sqrt(d2);
}

/** Closest point on a polyline: distance, segment and parameter. */
export function polylineNearest(x: number, z: number, pts: readonly (readonly number[])[], out: { d: number; seg: number; t: number }): void {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], az = pts[i][1], ex = pts[i + 1][0] - ax, ez = pts[i + 1][1] - az;
    const t = clamp(((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez), 0, 1);
    const dx = x - (ax + ex * t), dz = z - (az + ez * t), d = dx * dx + dz * dz;
    if (d < best) { best = d; out.seg = i; out.t = t; }
  }
  out.d = Math.sqrt(best);
}

// Lattice value noise with a quintic fade; integer hashing keeps it identical everywhere.
function hash(ix: number, iz: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
function vnoise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uz) * 2 - 1;
}
/** Fractal noise, roughly [-1, 1]. */
export function tcNoise(x: number, z: number, octaves = 3): number {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let o = 0; o < octaves; o++) {
    s += a * vnoise(x * f + o * 17.3, z * f - o * 9.1);
    n += a; a *= 0.5; f *= 2.03;
  }
  return s / n;
}

/** Catmull-Rom through the estuary rows: [north bank, south bank] at x. */
export function estuaryBanks(x: number): [number, number] {
  const rows = ESTUARY;
  let i = 0;
  while (i < rows.length - 2 && x > rows[i + 1][0]) i++;
  const p0 = rows[Math.max(0, i - 1)], p1 = rows[i], p2 = rows[i + 1], p3 = rows[Math.min(rows.length - 1, i + 2)];
  const t = clamp((x - p1[0]) / (p2[0] - p1[0]), 0, 1), t2 = t * t, t3 = t2 * t;
  const cr = (k: 1 | 2) => {
    const m1 = ((p2[k] - p0[k]) / (p2[0] - p0[0] || 1)) * (p2[0] - p1[0]);
    const m2 = ((p3[k] - p1[k]) / (p3[0] - p1[0] || 1)) * (p2[0] - p1[0]);
    return (2 * t3 - 3 * t2 + 1) * p1[k] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[k] + (t3 - t2) * m2;
  };
  return [cr(1), cr(2)];
}

/** Keep rock: 0 at the keep, 1 on the rim. */
export function plateauRadius(x: number, z: number): number {
  const dx = x - TC_KEEP.x, dz = z - TC_KEEP.z;
  const a = dx * TC_AXIS.ux + dz * TC_AXIS.uz - TC_PLATEAU.oa, b = dx * TC_P.x + dz * TC_P.z - TC_PLATEAU.ob, n = TC_PLATEAU.n;
  return Math.pow(Math.pow(Math.abs(a / TC_PLATEAU.a), n) + Math.pow(Math.abs(b / TC_PLATEAU.b), n), 1 / n);
}

/**
 * Signed distance to the shore, positive on land, and which shore it is: 0 promontory, 1 south shore.
 * The harbour basin is cut out of the promontory.
 */
export function tcCoast(x: number, z: number): { d: number; north: number; south: number; harbour: number } {
  const [zn, zs] = estuaryBanks(x);
  const wobble = 2.2 * tcNoise(x * 0.045, z * 0.045, 2) + 6 * tcNoise(x * 0.012 + 7, z * 0.012, 2);
  const harbour = -polyDistance(x, z, TC_HARBOUR);
  const north = Math.min(polyDistance(x, z, NORTH_COAST), zn - z, harbour) + wobble;
  // The south shore also ends at a western sea, past the playable edge.
  const south = Math.min(z - zs, x + 312, 520 - x) + wobble;
  return { d: Math.max(north, south), north, south, harbour };
}

const q = { d: 0, seg: 0, t: 0 };

/** Promontory surface before the sea cut: city terraces inside the wall, meadows and hills outside. */
function northLand(x: number, z: number): number {
  const [t, s] = tcAxisCoords(x, z);
  const n = tcNoise(x * 0.02, z * 0.02, 3);
  // Outside the wall: low meadows near the city rising into western hills toward the far coast.
  let h = 5 + 2.2 * n + 14 * smoothstep(x, -160, -270) * (0.7 + 0.3 * tcNoise(x * 0.01 + 4, z * 0.01, 3)) + 0.5 * tcNoise(x * 0.09, z * 0.09, 2);
  // Inside: terraces. The King's Way crosses each terrace edge on a long ramp; elsewhere the edges are steep.
  const way = 1 - smoothstep(Math.abs(s), 9, 14);
  const edge = (d: number) => smoothstep(d, -1.6 - 13 * way, 1.6 + 13 * way);
  let city = TC_LEVEL.lower + 0.25 * tcNoise(x * 0.07, z * 0.07, 2);
  city += (TC_LEVEL.middle - TC_LEVEL.lower) * edge(polyDistance(x, z, MIDDLE));
  city += (TC_LEVEL.upper - TC_LEVEL.middle) * edge(polyDistance(x, z, UPPER));
  // Keep rock: a sheer rim, except the King's Stair cut on the axis (a ramp under the steps).
  const rim = (1 - plateauRadius(x, z)) * 80;
  const rock = smoothstep(rim, -2.5, 1.5);
  const stair = (1 - smoothstep(Math.abs(s), 8.5, 10.5)) * (t > TC_T.stairFoot - 3 && t < TC_T.stairTop + 6 ? 1 : 0);
  // A straight ramp just under the steps (which rise linearly).
  const climb = TC_LEVEL.upper - 0.4 + (TC_LEVEL.plateau - TC_LEVEL.upper) * clamp((t - TC_T.stairFoot) / (TC_T.stairTop - TC_T.stairFoot), 0, 1);
  city = lerp(city + (TC_LEVEL.plateau + 0.3 * tcNoise(x * 0.05, z * 0.05, 2) - city) * rock, Math.max(city, climb), stair);
  // Market square: flat at the lower town level.
  const [mx, mz] = tcAxis(TC_T.market);
  city = lerp(city, TC_LEVEL.lower, 1 - smoothstep(Math.hypot(x - mx, z - mz), 30, 36));
  // North and east the city's rock runs on past the wall to the sea cliffs; south and west lie meadows and beaches.
  const wall = polyDistance(x, z, TC_CITY_WALL);
  const rocky = Math.max(smoothstep(z, -100, -140), smoothstep(x, 186, 204));
  return lerp(h, city, Math.max(smoothstep(wall, -6, 3), rocky * smoothstep(wall, -40, -12)));
}

/** South shore: the forested ridge with its crest on the axis, falling to the estuary and rolling away south. */
function southLand(x: number, z: number): number {
  const n = tcNoise(x * 0.018 + 31, z * 0.018, 4);
  const ridgeZ = 252 + 0.0016 * (x + 13) * (x + 13) + 6 * tcNoise(x * 0.01, 3, 2);
  const along = 0.45 + 0.55 * Math.exp(-Math.pow((x + 25) / 110, 2));
  const across = Math.exp(-Math.pow((z - ridgeZ) / (z < ridgeZ ? 20 : 34), 2));
  let h = 7 + 3.5 * n + (TC_LEVEL.crest - 7) * along * across + 6 * smoothstep(z, 300, 400) * (0.6 + 0.4 * n);
  return h + 0.6 * tcNoise(x * 0.11, z * 0.11, 2);
}

/** Ground height (sea level 0) at a world point: analytic, before the grid. */
export function tidecrownGround(x: number, z: number): number {
  const c = tcCoast(x, z);
  const land = c.north >= c.south ? northLand(x, z) : southLand(x, z);
  let h: number;
  if (c.d < 0) {
    const u = -c.d;
    // The estuary is a shallow channel; the open sea shelves off deeper.
    const floor = c.south > -40 && c.north > -40 ? -7.5 : -16;
    h = Math.max(floor, -0.3 * u - 0.006 * u * u);
  } else {
    // Beaches rise gently; where the land is high, the shore becomes a cliff.
    const beach = Math.min(land, 0.12 * c.d + 0.6 * smoothstep(c.d, 4, 14) * (1 + tcNoise(x * 0.07, z * 0.07, 2)));
    const quay = c.harbour < 6 ? 1 : 0;
    // Where the land is high (the city's rock) the shore is a broken cliff: buttresses and gullies from noise, two
    // ledges, a talus at the foot. Lower land ends in a steep bank; the quay drops straight in.
    const high = smoothstep(land, 16, 26) * (1 - quay);
    const dd = c.d + (1 - quay) * (1.2 * tcNoise(x * 0.2, z * 0.2, 2) + 2.6 * high * tcNoise(x * 0.06 + 3, z * 0.06, 3));
    let rise = smoothstep(dd, 0.4, quay ? 1.6 : 5 + 3 * high);
    rise = lerp(rise, rise + 0.06 * Math.sin(rise * Math.PI * 4) * (1 - rise), high);
    const cliff = -3 + (land + 3) * rise;
    h = lerp(lerp(beach, land, smoothstep(c.d, 6, 26)), cliff, Math.max(quay, smoothstep(land, 7, 11)));
  }
  return pads(x, z, h);
}

/** The forest road cut into the ridge, then the level pads the structures stand on (over land and shore alike). */
function pads(x: number, z: number, h: number): number {
  if (x > -90 && x < 70 && z > 205 && z < 345) {
    polylineNearest(x, z, TC_ROAD, q);
    const half = 3.4, shoulder = 6;
    if (q.d < half + shoulder) {
      const a = TC_ROAD[q.seg], b = TC_ROAD[q.seg + 1];
      h = lerp(h, lerp(a[2], b[2], q.t), 1 - smoothstep(q.d, half, half + shoulder));
    }
    // The hairpin turns on a level landing.
    const [hx, hz, hy] = TC_ROAD[TC_ROAD_HAIRPIN];
    h = lerp(h, hy, 1 - smoothstep(Math.hypot(x - hx, z - hz), 4, 6.5));
  }
  const [t, s] = tcAxisCoords(x, z);
  if (t > -160 && t < 40 && Math.abs(s) < 40) {
    // Overlook on the crest where the axis begins.
    const [cx, cz] = tcAxis(TC_T.crest);
    h = lerp(h, TC_LEVEL.crest, 1 - smoothstep(Math.hypot(x - cx, z - cz), 6, 14));
    // South bridgehead and its abutment, level with the deck.
    h = lerp(h, TC_LEVEL.deck, (1 - smoothstep(Math.abs(s), 10.5, 14)) * smoothstep(t, -114, -110) * (1 - smoothstep(t, -97.5, -95)));
    // North landing and the gate court: the deck's level at the gate, easing down into the lower town.
    const court = (1 - smoothstep(Math.abs(s), 13 + 9 * smoothstep(t, -8, 2), 18 + 10 * smoothstep(t, -8, 2))) * smoothstep(t, -14, -11) * (1 - smoothstep(t, 18, 34));
    h = lerp(h, TC_LEVEL.deck - 1.6 * smoothstep(t, 2, 28), court);
  }
  return h;
}

/** Heights at every TIDECROWN_GRID vertex, row-major (z rows, x columns). */
export function buildTidecrownHeights(): Float32Array {
  const { nx, nz, step, minX, minZ } = TIDECROWN_GRID;
  const h = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) h[j * nx + i] = tidecrownGround(minX + i * step, minZ + j * step);
  return h;
}

/** The grid as a HeightGrid over given samples. */
export function tidecrownGrid(h: Float32Array): HeightGrid & { h: Float32Array } {
  return { ...TIDECROWN_GRID, h };
}

/** Exact height of the rendered terrain triangles. */
export function tidecrownHeight(h: Float32Array, x: number, z: number): number {
  return gridHeight(tidecrownGrid(h), x, z);
}
