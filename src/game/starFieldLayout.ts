// Starhaven's countryside: where the island rises, where it falls to sand or breaks off in bluffs, and the few places
// that tell a story out in the fields. Numbers only, shared by the height grid (world2Height.ts, which the server
// bakes), the ground shader (starGround.ts), the field dressing (starFields.ts) and the colliders (world2Colliders.ts).

/** High (1) or low (0) quality detail, shared uniform of Starhaven's ground, paving and field shaders. */
export const STAR_DETAIL = {value: 1};

/** Fallen-star crater: a bowl with a thrown-up rim, shards of the star still glowing in it. */
export const STAR_CRATER = {x: -36, z: -16, r: 6.5} as const;
/** The stargazer's camp, on a grassy rise looking south over the sea to the aurora. */
export const STAR_CAMP = {x: 44, z: -60, r: 15} as const;
/** A fishermen's skiff hauled up the western beach, bow to the dunes. */
export const STAR_BOAT = {x: -95, z: 33, yaw: 1.25} as const;

/** The miners' camp: a cart, crates and tools by a seam of crystal they have been cutting. */
export const STAR_MINE = {x: 66, z: 56, yaw: -0.5} as const;
/** The mine's props and their footprints (starStories.ts dresses them; solid ones are colliders). */
export const STAR_MINE_PROPS: readonly {name: string; dx: number; dz: number; yaw: number; scale?: number; r: number; h: number}[] = [
  {name: 'Anvil_Log', dx: -4.2, dz: 1.2, yaw: 1.9, r: .6, h: .9},
  {name: 'Crate_Wooden', dx: -3.4, dz: 3.3, yaw: 1.2, r: .55, h: .9},
  {name: 'Crate_Wooden', dx: -2.6, dz: 3.4, yaw: .3, r: .55, h: .9},
  {name: 'Crate_Metal', dx: -1.6, dz: 4.3, yaw: -.4, scale: .85, r: .5, h: .8},
  {name: 'Barrel', dx: -5.6, dz: 3.4, yaw: 0, r: .45, h: 1},
];

/** The keepers' ring: seven tall crystals on a circle, open toward the sanctum. */
export const STAR_RING = {x: -30, z: -60, r: 6.2} as const;
/** A point (x, z) turned by yaw about the origin, as the story props are laid out. */
export function rot(x: number, z: number, yaw: number): [number, number] { return [x * Math.cos(yaw) + z * Math.sin(yaw), -x * Math.sin(yaw) + z * Math.cos(yaw)]; }

/** Gameplay points outside the flattened town, avenue and arena that keep their exact ground. */
export const STAR_KEEP_POINTS: readonly (readonly [number, number, number])[] = [
  // [x, z, radius of untouched ground]; objectives get their own radii from STAR_OBJECTIVES.
  [-70, 5, 5], [70, -15, 5],
];

// Deterministic integer-hash gradient noise (no Math.sin), identical in every JS engine.
function hash(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
/** Gradient noise in about [-0.7, 0.7]. */
export function starNoise(x: number, z: number, seed = 0): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const q = (t: number) => t * t * t * (t * (t * 6 - 15) + 10), u = q(fx), v = q(fz);
  const g = (i: number, j: number, dx: number, dz: number) => { const a = hash(ix + i, iz + j, seed) * Math.PI * 2; return Math.cos(a) * dx + Math.sin(a) * dz; };
  const a = g(0, 0, fx, fz), b = g(1, 0, fx - 1, fz), c = g(0, 1, fx, fz - 1), d = g(1, 1, fx - 1, fz - 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function starFbm(x: number, z: number, seed: number, octaves = 3): number {
  let s = 0, a = .5, f = 1;
  for (let i = 0; i < octaves; i++) { s += a * starNoise(x * f + i * 17.3, z * f - i * 9.1, seed + i); a *= .5; f *= 2.07; }
  return s;
}
const smooth = (x: number, a: number, b: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Normalised coast radius (1 is the old shore ellipse) and the angle round the island. */
export function starCoast(x: number, z: number) {
  return {r: Math.hypot(x / 115, (z - 10) / 140), a: Math.atan2((z - 10) / 140, x / 115)};
}
/**
 * How much of the coast here is bluff (1) rather than beach (0). Bluffs face the open sea south of the town on both
 * flanks and round the arena's headland; the western and eastern shores either side of the fields are beaches, as
 * is the harbour's shore.
 */
export function starBluff(x: number, z: number): number {
  const {a} = starCoast(x, z);
  // Sectors by angle (0 east, -pi/2 the arena's south, pi/2 the harbour's north); a wandering edge breaks them up.
  const wobble = starNoise(Math.cos(a) * 3.1 + 7, Math.sin(a) * 3.1 - 3, 41) * .5;
  const sector = (c: number, w: number) => 1 - smooth(Math.abs(Math.atan2(Math.sin(a - c), Math.cos(a - c))) + wobble * .35, w * .55, w);
  return Math.min(1, sector(-.55, .62) + sector(-2.55, .58) + sector(-1.57, .32) + sector(.62, .3) * .8);
}
/** 0..1: how sandy the ground is here (the beach strip and its dunes). */
export function starSand(x: number, z: number): number {
  const {r} = starCoast(x, z);
  const edge = .78 - .025 * starFbm(x * .045, z * .045, 7, 2);
  return smooth(r, edge, edge + .045) * (1 - starBluff(x, z) * .85);
}

const sm = (x: number, a: number, b: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/**
 * The meadow's large-scale value (5 to 15 m): [lush, wear], each 0..1. Lush: deep tussock beds, taller and darker.
 * Wear: bare trodden patches and the sinuous tracks animals and shepherds wore across the fields, short silvered turf
 * over pale earth. The rest is plain meadow, so a field reads in three values, not one even texture. Presentation only.
 */
export function starFieldWear(x: number, z: number): [number, number] {
  const n = starNoise(x / 13, z / 13, 141) * .85 + starNoise(x / 5.5, z / 5.5, 142) * .3;
  const lush = sm(n, .1, .28);
  const bare = 1 - sm(n, -.42, -.26);
  // Tracks: where a slow noise crosses zero, wobbled, about 2 m wide, fading in and out along their length.
  const t = Math.abs(starNoise(x / 38, z / 38, 143) + .18 * starNoise(x / 8, z / 8, 144));
  const track = (1 - sm(t, .022, .06)) * sm(starNoise(x / 30, z / 30, 145), -.25, .05);
  return [lush * (1 - track), Math.max(bare, track)];
}

/*
 * What the eclipse did (star r5): shards of the fallen star struck the island as the sun went out. One toppled the
 * observatory's eighth column (its drums lie where they fell, outward from the ring) and scorched the ground at its
 * foot; one burst beside the starroad, where a pilgrim dropped his pack and lantern and ran. The astronomer's table
 * still stands by the armillary with the night's charts on it.
 */
const COL8 = 8 / 10 * Math.PI * 2;
/** The fallen column: unit direction it fell (outward from the ring) and the stump's foot. */
export const STAR_FALLEN = {x: 80 + Math.cos(COL8) * 9, z: -40 + Math.sin(COL8) * 9, dx: Math.cos(COL8), dz: Math.sin(COL8)} as const;
/** Its pieces lying in the grass: distance out along the fall, sideways drift, length, yaw wobble; the last is the capital. */
export const STAR_FALLEN_DRUMS: readonly {d: number; side: number; len: number; turn: number}[] = [
  {d: 1.55, side: .1, len: 1.25, turn: .06}, {d: 2.95, side: .32, len: 1.05, turn: -.22}, {d: 4.2, side: .1, len: .8, turn: .4},
];
export const STAR_FALLEN_CAPITAL = {d: 5.35, side: -.65} as const;
/** The astronomer's observing table by the armillary, and the scorch marks where the shards struck. */
export const STAR_TABLE = {x: 74.6, z: -44.3, yaw: .75} as const;
export const STAR_PILGRIM = {x: -9.3, z: -29.4, yaw: .4} as const;
export const STAR_SCORCHES: readonly {x: number; z: number; r: number}[] = [
  {x: -11.8, z: -33.1, r: 2.5}, {x: STAR_FALLEN.x + STAR_FALLEN.dx * 2.2 + 1.6, z: STAR_FALLEN.z + STAR_FALLEN.dz * 2.2 + .4, r: 2.1},
];
/** The story's solids (registered with the other story props, starFieldSpots.ts): the drums and the table. */
export function starEclipseSolids(): {x: number; z: number; r: number; h: number}[] {
  const out = STAR_FALLEN_DRUMS.map((p) => ({x: STAR_FALLEN.x + STAR_FALLEN.dx * p.d - STAR_FALLEN.dz * p.side, z: STAR_FALLEN.z + STAR_FALLEN.dz * p.d + STAR_FALLEN.dx * p.side, r: .62, h: 1.2}));
  out.push({x: STAR_TABLE.x, z: STAR_TABLE.z, r: .8, h: 1});
  return out;
}
