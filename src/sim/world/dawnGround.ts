// Dawnharbor's landform, numbers only. Shared by the browser (the terrain mesh is sampled from it vertex by vertex,
// dawnTerrain.ts) and the server simulation through dawnHeight(). Gameplay ground keeps the old analytic island
// exactly: the town, the avenue and lanes, quest points, NPC spots, the harbour and the whole climb north of the
// fields to Solarkan's plateau. Only the open fields carry new relief (rolling coastal hills, a rim of dunes along
// the southern beaches), and the coast past the walkable ellipse is reshaped: a noisy shoreline with headlands,
// sand beaches that shelve into the sea where the land is low, and bluffs that drop to a rocky foot where it is high.

/** Height of the still sea around Dawnharbor (the harbour's quay and pier are built for it). */
export const DAWN_SEA = 0.2;
/** The walkable ellipse (queries.ts DAWN_BOUNDS): x / 122, (z - 3) / 149. The coast never starts inside 0.845. */
const RX = 122, RZ = 149, CZ = 3;

const smooth01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const smoothstep = (x: number, a: number, b: number) => smooth01((x - a) / (b - a));

/** Integer lattice hash, 0..1. 32-bit integer ops, deterministic everywhere. */
function hash(ix: number, iz: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 8) / 16777216;
}
/** Quintic value noise, -1..1. */
export function dawnNoise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return (a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz) * 2 - 1;
}
/** Rotated fBm, about -1..1. */
function fbm(x: number, z: number, octaves: number): number {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < octaves; i++) {
    s += a * dawnNoise(x, z); n += a;
    const nx = 1.6 * x + 1.2 * z + 7.3, nz = -1.2 * x + 1.6 * z - 3.1;
    x = nx; z = nz; a *= 0.5;
  }
  return s / n;
}

/** Ground that must keep its old height, as segments (ax, az, bx, bz, half width) and discs (x, z, r). */
const KEEP_SEGS: readonly (readonly [number, number, number, number, number])[] = [
  // The avenue from the harbour to the citadel gate, and the market cross street.
  [0, 124, 0, -50, 13], [-30, 53, 30, 53, 7],
  // The garden lane west to Seabreeze Gardens and the lane east to the lighthouse.
  [-5, 74, -28, 75, 7], [-28, 75, -50, 64, 7], [-50, 64, -62, 48, 7],
  [4, 75, 28, 84, 7], [28, 84, 48, 84, 7], [48, 84, 61, 76, 7],
];
const KEEP_DISCS: readonly (readonly [number, number, number])[] = [
  // Quest points (dawnQuests.ts DAWN_POINTS): crates, herbs, lamps, ore, pearls, seals and the three lookouts.
  [-12, 76, 6], [12, 70, 6], [-12, 62, 6], [-55, 44, 7], [-62, 38, 7], [-56, 30, 7], [-7, 20, 6], [7, 0, 6], [-7, -22, 6],
  [24, 6, 7], [32, -8, 7], [22, -25, 7], [68, 30, 7], [72, 18, 7], [64, 4, 7], [-18, -20, 6], [18, -35, 6], [-16, -44, 6],
  [-54, 40, 7], [69, 20, 7], [62, 68, 7],
  // Points of interest: the grove, the shore, the wreck, the lighthouse headland and its garden.
  [-60, 42, 16], [55, 36, 10], [55, -25, 10], [67, 72, 13], [-65, 45, 12],
];
const segDist = (x: number, z: number, ax: number, az: number, bx: number, bz: number) => {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
};
/** Distance past every piece of kept ground, metres (0 inside one). */
function keepDistance(x: number, z: number): number {
  // The town block, harbour to the southern lanes, and everything north of the fields: the climb, the gate and the
  // citadel plateau keep their exact ground.
  const qx = Math.abs(x) - 50, qz = Math.abs(z - 68) - 54;
  let d = Math.min(Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0), z + 30);
  for (const [ax, az, bx, bz, w] of KEEP_SEGS) d = Math.min(d, segDist(x, z, ax, az, bx, bz) - w);
  for (const [cx, cz, r] of KEEP_DISCS) d = Math.min(d, Math.hypot(x - cx, z - cz) - r);
  return Math.max(0, d);
}
/** 0 on kept ground, 1 in the open field; the relief rises over 12 m so nothing steps. */
export function dawnOpen(x: number, z: number): number {
  return smooth01(keepDistance(x, z) / 12);
}

/** The old island's inland surface (before the coast and the arena): flats, the northern rise, a gentle swell. */
function oldInland(x: number, z: number): number {
  const upland = 13 * smoothstep(-z, 5, 55);
  const hills = Math.sin(x * 0.045) * Math.sin(z * 0.04) * 2 * (1 - Math.exp((-x * x) / 400));
  return 4 + upland + hills;
}

/** Where the shore starts, in units of the ellipse: headlands push it out, never inside the walkable 0.81. */
export function dawnShoreStart(x: number, z: number): number {
  const a = Math.atan2(x / RX, (z - CZ) / RZ), ca = Math.cos(a), sa = Math.sin(a);
  const n = fbm(ca * 1.9 + 4.1, sa * 1.9 - 2.7, 3);
  return 0.845 + 0.075 * smooth01(n * 0.9 + 0.45);
}

/** Wind off the southern sea, (x, z): dune crests run across it, ripples on the sand too. */
export const DAWN_WIND = [0.34, -0.94] as const;

/** Dune crests: rounded ridges across the wind, broken into fields. Metres, about 0..1. */
function dunes(x: number, z: number): number {
  const a = x * DAWN_WIND[0] + z * DAWN_WIND[1], c = -x * DAWN_WIND[1] + z * DAWN_WIND[0];
  const warp = dawnNoise(c * 0.03 + 5.2, a * 0.02 - 1.9) * 2.2;
  const r = 1 - Math.abs(dawnNoise(a / 17 + warp, c / 42 + 3.7));
  const crest = r * r * (3 - 2 * r);
  return crest * smooth01(dawnNoise(x / 36 - 8.1, z / 36 + 2.4) * 1.2 + 0.55);
}

/** The inland surface with the open field's relief. `open` is dawnOpen(x, z). */
function inland(x: number, z: number, open: number, r: number): number {
  const h = oldInland(x, z);
  if (open <= 0) return h;
  // Rolling coastal hills tens of metres across, and a rim that lifts toward the coast so the island has a skyline.
  const rolling = fbm(x / 42 + 1.7, z / 42 - 6.3, 3) * 3.1;
  const south = smoothstep(z, 10, 70);
  const rim = smoothstep(r, 0.56, 0.8) * (3.6 - 1.6 * south);
  // Dunes over the open desert, piled highest behind the southern beaches.
  const dune = dunes(x, z) * (1.6 + 0.8 * south) * smoothstep(r, 0.3, 0.55);
  return h + open * (rolling + rim + dune);
}

/** Dawnharbor's ground height. */
/** The old island's whole surface: inland, then the plain shelving shore it had (dev 997d68a). */
function oldGround(x: number, z: number, r: number): number {
  return r > 0.86 ? 4 - (r - 0.83) * 65 : oldInland(x, z);
}
/** The harbour, quay and pier keep the old ground exactly in x -40..20, z 90..160; the new coast fades in over 12 m. */
const HARBOUR = [-40, 20, 90, 160] as const;
function harbourBlend(x: number, z: number): number {
  const dx = Math.max(HARBOUR[0] - x, 0, x - HARBOUR[1]), dz = Math.max(HARBOUR[2] - z, 0, z - HARBOUR[3]);
  return smooth01(Math.hypot(dx, dz) / 12);
}

export function dawnGround(x: number, z: number, arenaHeight: number): number {
  const r = Math.hypot(x / RX, (z - CZ) / RZ);
  const keepHarbour = harbourBlend(x, z);
  if (keepHarbour <= 0) return oldGround(x, z, r);
  const open = dawnOpen(x, z);
  let h = inland(x, z, open, r);
  const start = dawnShoreStart(x, z);
  if (r > start) {
    // Low land shelves into the sea as a beach; high land breaks off as a bluff with a rocky foot.
    const cliff = smoothstep(h, 6.5, 10.5);
    const t = r - start;
    const beach = t < 0.06 ? h + (DAWN_SEA - 0.55 - h) * smooth01(t / 0.06) : DAWN_SEA - 0.55 - (t - 0.06) * 60;
    const face = 0.024, foot = 0.9 + dawnNoise(x * 0.2, z * 0.2) * 0.5;
    const bluff = t < face ? h + (foot - h) * Math.pow(smooth01(t / face), 0.8) : foot - (t - face) * 75;
    h = Math.max(-16, beach + (bluff - beach) * cliff);
  }
  if (keepHarbour < 1) h = oldGround(x, z, r) + (h - oldGround(x, z, r)) * keepHarbour;
  const arena = 1 - smoothstep(Math.hypot(x, z + 72), 21, 31);
  return h + (arenaHeight - h) * arena;
}

/**
 * Surface hints for the renderer at (x, z), 0..1 each: sand (beaches, dunes, the harbour), volcanic ground (the
 * climb to the citadel) and trodden ground (around the kept lanes and town). Not used by the simulation.
 */
export function dawnSurface(x: number, z: number, h: number, out: number[]): number[] {
  const r = Math.hypot(x / RX, (z - CZ) / RZ), start = dawnShoreStart(x, z), open = dawnOpen(x, z);
  const beach = smoothstep(r, start - 0.05, start - 0.005) * (1 - smoothstep(h, 4.5, 8));
  // The open fields are desert: sand, broken by rare patches of dry scrub, greener only round the grove's spring.
  const scrub = smoothstep(dawnNoise(x / 9 + 3.3, z / 9 - 7.1) + dawnNoise(x / 31 - 1.2, z / 31 + 4.4) * 0.6, 0.55, 1.1);
  const oasis = Math.max(1 - smoothstep(Math.hypot(x + 60, z - 42), 10, 22), 1 - smoothstep(Math.hypot(x - 67, z - 72), 6, 13));
  const dune = open * (0.95 - 0.55 * scrub) * (1 - 0.7 * oasis);
  // The town's sandy streets and the harbour front.
  const town = (1 - smoothstep(Math.abs(x), 20, 30)) * smoothstep(z, 14, 24) * (1 - smoothstep(z, 120, 126));
  const harbour = smoothstep(z, 96, 112) * (1 - smoothstep(Math.abs(x), 30, 44));
  out[0] = Math.min(1, Math.max(beach, dune, town * 0.6, harbour, (1 - open) * (1 - oasis) * 0.5));
  out[1] = Math.max(smoothstep(-z, 30, 46), smoothstep(h, 11, 14));
  // Trodden ground: along the lanes and through the town only, not round every kept quest point.
  let lane = Infinity;
  for (const [ax, az, bx, bz, w] of KEEP_SEGS) lane = Math.min(lane, segDist(x, z, ax, az, bx, bz) - w * 0.55);
  out[2] = Math.max(1 - smoothstep(lane, 0, 6), town * 0.7) * (1 - out[0] * 0.6) * (1 - smoothstep(-z, 34, 44));
  return out;
}
