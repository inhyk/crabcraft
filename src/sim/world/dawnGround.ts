// Dawnharbor's landform, numbers only. Shared by the browser (the terrain mesh is sampled from it vertex by vertex,
// dawnTerrain.ts) and the server simulation through dawnHeight(). Gameplay ground keeps the old analytic island
// exactly: the town, the avenue and lanes, quest points, NPC spots, the harbour and the whole climb north of the
// fields to Solarkan's plateau. Only the open fields carry new relief (rolling coastal hills, a rim of dunes along
// the southern beaches), and the coast past the walkable ellipse is reshaped: a noisy shoreline with headlands,
// sand beaches that shelve into the sea where the land is low, and bluffs that drop to a rocky foot where it is high.

/** Height of the still sea around Dawnharbor (the harbour's quay and pier are built for it). */
export const DAWN_SEA = 0.2;
/** The walkable ellipse (queries.ts DAWN_BOUNDS): x / 122, (z - 3) / 149. The coast never starts inside 0.845. */
export const RX = 122, RZ = 149, CZ = 3;

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
export const KEEP_SEGS: readonly (readonly [number, number, number, number, number])[] = [
  // The avenue from the harbour to the citadel gate, and the market cross street.
  [0, 124, 0, -50, 13], [-30, 53, 30, 53, 7],
  // The garden lane west to Seabreeze Gardens and the lane east to the lighthouse.
  [-5, 74, -28, 75, 7], [-28, 75, -50, 64, 7], [-50, 64, -62, 48, 7],
  [4, 75, 28, 84, 7], [28, 84, 48, 84, 7], [48, 84, 61, 76, 7],
];
export const KEEP_DISCS: readonly (readonly [number, number, number])[] = [
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
/** Distance past the town block, the lanes and every kept point, metres (negative inside). */
function keepCore(x: number, z: number): number {
  const qx = Math.abs(x) - 50, qz = Math.abs(z - 68) - 54;
  let d = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
  for (const [ax, az, bx, bz, w] of KEEP_SEGS) d = Math.min(d, segDist(x, z, ax, az, bx, bz) - w);
  for (const [cx, cz, r] of KEEP_DISCS) d = Math.min(d, Math.hypot(x - cx, z - cz) - r);
  return d;
}
/** Distance past every piece of kept ground, metres (0 inside one). */
function keepDistance(x: number, z: number): number {
  // The town block, harbour to the southern lanes, and everything north of the fields: the climb, the gate and the
  // citadel plateau keep their exact ground.
  return Math.max(0, Math.min(keepCore(x, z), z + 30));
}
/** 0 on kept ground, 1 in the open field; the relief rises over 12 m so nothing steps. */
function dawnOpen(x: number, z: number): number {
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

/** The dawn coast's wind off the southern sea, for its low dune rim (coastGround). */
const COAST_WIND = [0.34, -0.94] as const;

/** Dune crests: rounded ridges across the wind, broken into fields. Metres, about 0..1. */
function dunes(x: number, z: number): number {
  const a = x * COAST_WIND[0] + z * COAST_WIND[1], c = -x * COAST_WIND[1] + z * COAST_WIND[0];
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

/**
 * The coast: `t` is how far past the shore's start (x, z) lies, in units of the ellipse. Low land shelves into the
 * sea as a beach; high land breaks off as a bluff with a rocky foot.
 */
function shore(x: number, z: number, h: number, t: number): number {
  if (t <= 0) return h;
  const cliff = smoothstep(h, 6.5, 10.5);
  // A dune bank down to a berm a metre over the sea, then a long gentle foreshore (about 1 in 5) through the
  // waterline, so the swash has a wet band metres wide to darken; then the shelf drops away.
  const u = t / 0.1, top = Math.min(h, DAWN_SEA + 0.9), low = DAWN_SEA - 0.55;
  const beach = u < 0.35 ? h + (top - h) * smooth01(u / 0.35) : u < 1 ? top + (low - top) * (u - 0.35) / 0.65 : low - (t - 0.1) * 60;
  const face = 0.024, foot = 0.9 + dawnNoise(x * 0.2, z * 0.2) * 0.5;
  const bluff = t < face ? h + (foot - h) * Math.pow(smooth01(t / face), 0.8) : foot - (t - face) * 75;
  return Math.max(-16, beach + (bluff - beach) * cliff);
}

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

/** The dawn coast's ground before the sand (the dawn-sky landform), without the arena. */
function coastGround(x: number, z: number): number {
  const r = Math.hypot(x / RX, (z - CZ) / RZ);
  const keepHarbour = harbourBlend(x, z);
  if (keepHarbour <= 0) return oldGround(x, z, r);
  const open = dawnOpen(x, z);
  // Where the mainland's desert claims the bearing the coast runs away with it (sandGround()): without this the
  // plateau broke off in a sea bluff inside the dune sea, a trench seen from above.
  const s0 = dawnShoreStart(x, z), m = sandMainland(x, z);
  const h = shore(x, z, inland(x, z, open, r), r - (s0 + (12 - s0) * m));
  return keepHarbour < 1 ? oldGround(x, z, r) + (h - oldGround(x, z, r)) * keepHarbour : h;
}


// ---- Goldsand: the desert harbour --------------------------------------------------------------------------------
// The same philosophy as Frostlight's snowfield (snowGround.ts): one prevailing wind shapes every scale. Dunes are
// not an fBm: each is an asymmetric ridge across the wind (a long, convex windward stoss slope, a sharp brink and a
// straight lee slip face at the angle of repose, a concave apron at its foot), broken along the crest into
// barchanoid segments whose horns trail downwind. Three sizes nest: a dune sea of 10-16 m crests on the mainland
// past the walkable ellipse, walkable 2-3 m dunes over the open fields, and half-metre drifts riding their stoss
// slopes. Rocks in the open grow sand tails downwind. Wind ripples (decimetres) are visual only and live in the
// shader. Gameplay ground keeps the dawn coast's height exactly, so the town, the roads, every quest point, the
// harbour and the citadel climb are untouched. The GLSL twin of everything below is src/game/sandGround.ts.

/** Direction the wind blows over Goldsand, (x, z), unit: toward bearing 67 degrees, off the desert in the WNW. */
// Held 45 degrees off the sun's bearing (112), Frostlight's rule: ripples and crests are lit from the side.
export const DAWN_WIND = [0.92050485, 0.39073113] as const;
/** Centre of the mainland the desert comes from, (x, z) unit, as seen from the island's middle. */
const MAINLAND = [-0.8660254, -0.5] as const;

/** A dune class: wavelength along the wind, crest height, slip face slope, where the crest sits in the period. */
interface DuneKind { lambda: number; height: number; slip: number; crest: number; seed: number }
export const DUNE_SEA: DuneKind = { lambda: 105, height: 15, slip: 0.66, crest: 0.72, seed: 3.7 };
export const DUNE_FIELD: DuneKind = { lambda: 34, height: 2.4, slip: 0.5, crest: 0.74, seed: 11.3 };
export const DUNE_DRIFT: DuneKind = { lambda: 8.5, height: 0.45, slip: 0.42, crest: 0.7, seed: 23.9 };

/** Polynomial smooth minimum: the two meet in a fillet `k` high. */
const smin = (a: number, b: number, k: number) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

/**
 * One dune class at wind-frame coordinates (a downwind, c across), `amp` 0..1 scaling its height, riding on
 * `under` (the smaller dunes at this point, metres). Those ride its windward slope and fill the trough after it;
 * its slip face is a clean plane that cuts them off, as a big dune's avalanche face buries what it overtakes.
 * The crest line wanders and breaks into segments; where a segment thins its crest trails downwind (the horns).
 */
export function dune(a: number, c: number, k: DuneKind, amp: number, under: number): number {
  const L = k.lambda;
  // Segments along the crest, a couple of wavelengths long, drifting slowly downwind.
  const seg = smooth01((dawnNoise(c / (1.7 * L) + k.seed, a / (4.3 * L) - k.seed) + 0.25) / 0.7);
  const H = k.height * amp * seg;
  // Phase across the period: the crest line wanders (low frequency, so the phase always advances downwind) and
  // the horns of a thinning segment lag downwind.
  const phase = a / L + 0.55 * dawnNoise(c / (2.6 * L) - k.seed, a / (5.1 * L) + 2.3) + 0.12 * dawnNoise(c / (0.9 * L) + 5.1, a / (6 * L) - k.seed) - 0.2 * (1 - seg);
  const t = phase - Math.floor(phase);
  const d = (t - k.crest) * L, stoss = k.crest * L;
  // A sharp brink, rounded over a few decimetres so no lattice has to carry a crease; a concave apron at the foot.
  const kc = 0.1 + 0.07 * H, kf = 0.25 + 0.2 * H;
  // Windward: u^2 (2 - u) climbs out of the trough with no kink and reaches the brink still rising. It starts kf
  // under the floor, so the apron below leaves the trough exactly where the slip face's foot comes back to it.
  const u = Math.max(0, Math.min(1, 1 - Math.abs(d) / stoss)), s = u * u * (2 - u);
  const ys = under + (H + kf) * s - kf;
  const yl = H - k.slip * d;
  // The apron: e above the floor, eased onto it over kf either side.
  const e = smin(ys, yl, kc) - under;
  return under + (e >= kf ? e : e <= -kf ? 0 : ((e + kf) * (e + kf)) / (4 * kf));
}

/**
 * World III's rock groups (dawnBoulders.ts builds them, world3Colliders.ts registers them): (i, x, z, r). The ring
 * round Solarkan's citadel keeps its sites; the six that stood in the open fields in front of the east and west
 * views make one outcrop each in those views' middle ground (25-60 m from their cameras, off the open dune faces).
 * Moved sites also keep two metres clear of the enemy homes (world2.ts, Dawnharbor's packs) and the quest points.
 */
export const DAWN_ROCKS: readonly { i: number; x: number; z: number; r: number }[] = (() => {
  const moved: Record<number, readonly [number, number]> = { 2: [28, -1], 3: [60, -44], 4: [77, -27], 5: [73, -20], 6: [68, -28], 7: [62, -38], 9: [63, -58], 21: [-53, -71], 23: [-68, -56], 26: [-65, -23], 27: [-72, -17], 28: [-75, -29], 29: [-53, -40] };
  const out: { i: number; x: number; z: number; r: number }[] = [];
  // Sites 0 and 16 stood on the avenue, 13 to 19 inside the citadel (dawnCitadelLayout.ts citadelHolds).
  for (let i = 1; i < 32; i++) {
    if (i >= 13 && i <= 19) continue;
    const a = (i / 32) * Math.PI * 2, [x, z] = moved[i] ?? [Math.sin(a) * 67, -45 + Math.cos(a) * 50];
    out.push({ i, x, z, r: 2 + (i % 3) });
  }
  return out;
})();
/** Hoodoos (a column under a caprock) are the even sites of radius 3 and up; the rest are mesas. */
export const dawnRockTall = (i: number, r: number) => r >= 3 && i % 2 === 0;
/**
 * The drift the fallen obelisk's foot is drowned in: 1.6 m up its shaft from the foot (dawnDuneClusters.ts
 * DUNE_CLUSTERS 'fallen-obelisk' at 79, -4; the shaft leans toward -0.62, 0.57).
 */
export const DAWN_OBELISK_DRIFT = [78, -3.1] as const;
/**
 * Where the wind piles sand round a stone: (x, z, r, s), r the stone's radius, s how high the sand climbs on it
 * relative to r. Every rock group and the obelisk's foot.
 */
export const SAND_ROCKS: readonly (readonly [number, number, number, number])[] = [
  ...DAWN_ROCKS.map(({ i, x, z, r }) => [x, z, r, dawnRockTall(i, r) ? 1.35 : 1] as const),
  [DAWN_OBELISK_DRIFT[0], DAWN_OBELISK_DRIFT[1], 2.6, 1.1] as const,
];
/** How far a stone's sand reaches, in its radii: back to windward and to the sides, and downwind (the tail's end). */
export const ROCK_SAND_SIDE = 3.1, ROCK_SAND_TAIL = 4.2;
/**
 * Sand the wind piles round one stone at wind-frame offsets (a downwind, c across, in its radii): a skirt that
 * buries its foot (flat over the stone, falling away gently past it), a sand shadow in its lee (higher than the skirt
 * at the stone, tapering to a blunt point 4.2 radii downwind, narrowing as it goes) and a scoured hollow where the wind
 * strikes it. Exactly 0 outside the footprint. Metres per metre of radius.
 */
function stoneSand(a: number, c: number, s: number): number {
  const d = Math.hypot(a, c);
  if (d > ROCK_SAND_SIDE && (a < 0 || a > ROCK_SAND_TAIL || Math.abs(c) > ROCK_SAND_SIDE)) return 0;
  const skirt = 0.3 * s * Math.exp(-(Math.max(0, d - 0.85) ** 2) * 0.8) * (1 - smoothstep(d, 2.3, ROCK_SAND_SIDE));
  let tail = 0;
  if (a > 0 && a < ROCK_SAND_TAIL) {
    const t = a / ROCK_SAND_TAIL, w = 0.4 + 0.75 * Math.pow(1 - t, 0.7);
    tail = 0.4 * s * Math.pow(1 - t, 1.1) * Math.exp(-((c / w) ** 2)) * smoothstep(a, 0, 0.6) * (1 - smoothstep(Math.abs(c), ROCK_SAND_SIDE - 0.8, ROCK_SAND_SIDE));
  }
  // A smooth maximum, so the skirt runs into the tail without a crease; its fillet shrinks to nothing where both do.
  const k = Math.min(0.12 * s, skirt + tail), f = Math.max(k - Math.abs(skirt - tail), 0);
  let y = Math.max(skirt, tail) + (k > 0 ? (f * f) / (4 * k) : 0);
  if (a < 0) { const m = d - 1.25; y -= Math.exp(-m * m * 6) * smooth01(-a * 2) * 0.07 * (1 - smoothstep(d, 2.3, ROCK_SAND_SIDE)); }
  return y;
}
/** Distance outside Solarkan's citadel (its walls and keep, as citadelHolds), metres. */
function citadelDistance(x: number, z: number): number {
  const qx = Math.abs(x) - 41, qz = Math.abs(z + 82.55) - 38.95;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
}
/**
 * Sand round every stone, metres, on the citadel plateau as in the open; none on the town block, the lanes, any
 * quest point or point of interest, nor in the citadel, so gameplay ground keeps its height exactly.
 */
export function rockSand(x: number, z: number): number {
  // Neighbours' sand merges (the higher drift wins) rather than piling up; scours likewise.
  let up = 0, down = 0;
  for (const [rx, rz, r, s] of SAND_ROCKS) {
    const dx = x - rx, dz = z - rz;
    if (Math.abs(dx) > r * (ROCK_SAND_TAIL + ROCK_SAND_SIDE) || Math.abs(dz) > r * (ROCK_SAND_TAIL + ROCK_SAND_SIDE)) continue;
    const v = stoneSand((dx * DAWN_WIND[0] + dz * DAWN_WIND[1]) / r, (-dx * DAWN_WIND[1] + dz * DAWN_WIND[0]) / r, s) * r;
    if (v > up) up = v; else if (v < down) down = v;
  }
  const h = up + down;
  if (h === 0) return 0;
  return h * rockSandRoom(x, z);
}
/** 1 where the wind may pile sand round a stone, 0 on gameplay ground and in the citadel. */
export function rockSandRoom(x: number, z: number): number {
  return smooth01((keepCore(x, z) - 1) / 6) * smooth01((citadelDistance(x, z) - 1) / 5);
}

/** 0 on gameplay ground, 1 in the open: the dawn coast's keep, the harbour, the citadel climb only inside the island. */
export function sandOpen(x: number, z: number): number {
  const r = Math.hypot(x / RX, (z - CZ) / RZ);
  let d = keepCore(x, z);
  // The citadel and everything north of the fields, as far as the island's own coast.
  d = Math.min(d, Math.max(z + 30, (r - 0.86) * 130));
  // The harbour, quay to pier head.
  const hx = Math.abs(x + 10) - 30, hz = Math.abs(z - 125) - 35;
  d = Math.min(d, Math.hypot(Math.max(hx, 0), Math.max(hz, 0)) + Math.min(Math.max(hx, hz), 0));
  return smooth01(Math.max(0, d) / 12);
}

/** How much the mainland's desert claims this bearing, 0..1. */
export function sandMainland(x: number, z: number): number {
  const ex = x / RX, ez = (z - CZ) / RZ, l = Math.hypot(ex, ez);
  if (l < 1e-6) return 0;
  // The bearing's claim wanders with bays and headlands, so the mainland's coast never runs straight.
  const wander = fbm(x / 70 + 9.1, z / 70 - 4.4, 2) * 0.32;
  return smoothstep((ex * MAINLAND[0] + ez * MAINLAND[1]) / l + wander, 0.34, 0.72);
}

/** Goldsand's open ground before the arena: desert plain, dunes, the mainland's dune sea, the coast. */
function sandGround(x: number, z: number): number {
  const r = Math.hypot(x / RX, (z - CZ) / RZ), m = sandMainland(x, z);
  const a = x * DAWN_WIND[0] + z * DAWN_WIND[1], c = -x * DAWN_WIND[1] + z * DAWN_WIND[0];
  // The desert plain swells gently and lifts toward the mainland, where the island's northern rise levels out.
  const far = m * smoothstep(r, 0.9, 1.6);
  let h = oldInland(x, z) - 13 * smoothstep(-z, 5, 55) * far + fbm(a / 90 + 4.2, c / 140 - 1.3, 2) * 1.6 + m * smoothstep(r, 0.84, 1.5) * 7;
  // Three sizes nest: drifts (a few degrees off the main wind) ride the walkable dunes, which ride the dune sea's
  // windward slopes past the walkable ellipse (compound dunes); each slip face cuts what it overtakes.
  let sand = dune(a * 0.996 + c * 0.087, c * 0.996 - a * 0.087, DUNE_DRIFT, smoothstep(dawnNoise(x / 23 + 7.7, z / 23 - 3.1), -0.3, 0.3), 0);
  sand = dune(a, c, DUNE_FIELD, 0.45 + 0.55 * smoothstep(r, 0.3, 0.8), sand);
  const big = m * smoothstep(r, 0.84, 1.3);
  if (big > 0) sand = dune(a, c, DUNE_SEA, big, sand);
  h += sand;
  // The mainland's coast runs away from the island; elsewhere the dawn coast's beaches and bluffs.
  const s0 = dawnShoreStart(x, z), start = s0 + (12 - s0) * m;
  return shore(x, z, h, r - start);
}

/** The dawn coast's height with the arena: what every piece of gameplay ground keeps exactly (for QA). */
export function dawnCoastHeight(x: number, z: number, arenaHeight: number): number {
  const h = coastGround(x, z), arena = 1 - smoothstep(Math.hypot(x, z + 72), 21, 31);
  return h + (arenaHeight - h) * arena;
}

/** Goldsand's ground height (World III): the dawn coast on gameplay ground, the desert everywhere else. */
export function dawnGround(x: number, z: number, arenaHeight: number): number {
  const open = sandOpen(x, z);
  let h = open <= 0 ? coastGround(x, z) : open >= 1 ? sandGround(x, z) : coastGround(x, z) + (sandGround(x, z) - coastGround(x, z)) * open;
  // Sand round the stones, on the open sand and the citadel plateau alike.
  h += rockSand(x, z);
  const arena = 1 - smoothstep(Math.hypot(x, z + 72), 21, 31);
  return h + (arenaHeight - h) * arena;
}
