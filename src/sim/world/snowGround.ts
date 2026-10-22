// Frostlight's landform, numbers only. Shared by the browser and the server simulation through snowHeight(), and
// mirrored line for line in GLSL by src/game/snowTerrain.ts (SNOW_GROUND_GLSL), which bakes it once on the GPU.
// Layering after SNOWFLOW's terrain.wgsl (MIT, Copyright (c) 2026 Maksymilian Dendura; see NOTICE.md): broad
// hills compressed along a prevailing wind so their crests run across it, metre-scale drifts sheared by the
// hills so lee faces steepen, rounded wind lips, snow drifted around the rock outcrops (tails downwind, a scoured
// moat upwind), and a coast that falls to a frozen sea. The decimetre sastrugi and ripples are visual only and
// live in the shader.

import { frostRoadKeepDist } from './snowLayout.ts';

/** Direction the wind blows on Frostlight, (x, z), unit. The sky's cirrus and the sastrugi follow it too. */
// Held about 45 degrees off the sun's bearing (SNOWFLOW's rule): a sun that rakes straight along the sastrugi lights
// both flanks alike and the fine structure goes flat; one straight across them flattens the broad hills instead.
export const SNOW_WIND = [0.9962, 0.0872] as const;
/** Height of the frozen sea around the island. */
export const SNOW_SEA_ICE = 0.42;

export interface SnowRock {
  x: number;
  z: number;
  /** Half the long axis, metres. */
  r: number;
  /** Height above the drift around it, metres. */
  h: number;
  /** Long-axis heading, radians. */
  yaw: number;
  seed: number;
}
/** Rock outcrops, sparse, for the horizon: clear of paths, the village, trees, quest points, camps and the ice cliffs. */
export const SNOW_ROCKS: readonly SnowRock[] = [
  { x: -90, z: 14, r: 7, h: 6.5, yaw: 0.7, seed: 11 },
  { x: 90, z: 55, r: 9, h: 9.5, yaw: -0.4, seed: 23 },
  { x: -94, z: 48, r: 8, h: 8, yaw: 1.9, seed: 37 },
  { x: 93, z: -42, r: 8, h: 8.5, yaw: 0.2, seed: 41 },
  { x: -84, z: 70, r: 5, h: 4.5, yaw: 2.6, seed: 53 },
  { x: 80, z: 80, r: 5, h: 5, yaw: -1.2, seed: 67 },
  { x: -30, z: -8, r: 3.6, h: 3.6, yaw: 1.1, seed: 79 },
];

// Sixteen unit gradients; the GLSL twin carries the same table.
const GX = Float64Array.of(1, 0.92388, 0.70711, 0.38268, 0, -0.38268, -0.70711, -0.92388, -1, -0.92388, -0.70711, -0.38268, 0, 0.38268, 0.70711, 0.92388);
const GZ = Float64Array.of(0, 0.38268, 0.70711, 0.92388, 1, 0.92388, 0.70711, 0.38268, 0, -0.38268, -0.70711, -0.92388, -1, -0.92388, -0.70711, -0.38268);

/** Integer lattice hash to a gradient index. 32-bit integer ops, so GLSL uint arithmetic gives the same bits. */
function gradIndex(ix: number, iz: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 28;
}

// Out-parameter of noised(): value, d/dx, d/dz.
const N = [0, 0, 0];
/** Quintic gradient noise with analytic derivative (Inigo Quilez's form), roughly [-0.7, 0.7]. */
function noised(px: number, pz: number): void {
  const ix = Math.floor(px), iz = Math.floor(pz), fx = px - ix, fz = pz - iz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const dux = 30 * fx * fx * (fx * (fx - 2) + 1), duz = 30 * fz * fz * (fz * (fz - 2) + 1);
  const a = gradIndex(ix, iz), b = gradIndex(ix + 1, iz), c = gradIndex(ix, iz + 1), d = gradIndex(ix + 1, iz + 1);
  const va = GX[a] * fx + GZ[a] * fz, vb = GX[b] * (fx - 1) + GZ[b] * fz;
  const vc = GX[c] * fx + GZ[c] * (fz - 1), vd = GX[d] * (fx - 1) + GZ[d] * (fz - 1);
  const k1 = vb - va, k2 = vc - va, k3 = va - vb - vc + vd;
  N[0] = va + k1 * ux + k2 * uz + k3 * ux * uz;
  N[1] = GX[a] + ux * (GX[b] - GX[a]) + uz * (GX[c] - GX[a]) + ux * uz * (GX[a] - GX[b] - GX[c] + GX[d]) + dux * (uz * k3 + k1);
  N[2] = GZ[a] + ux * (GZ[b] - GZ[a]) + uz * (GZ[c] - GZ[a]) + ux * uz * (GZ[a] - GZ[b] - GZ[c] + GZ[d]) + duz * (ux * k3 + k2);
}

const ROT_C = Math.cos(0.517), ROT_S = Math.sin(0.517);
/**
 * Derivative-damped fBm over a domain already in noise units. Each octave is attenuated by the slope gathered so
 * far, so crests stay smooth and detail pools in the troughs. Per-octave rotation hides the lattice.
 */
function fbmDamped(qx: number, qz: number, octaves: number, gain: number, damp: number): number {
  let sum = 0, dx = 0, dz = 0, amp = 0.5, freq = 1, x = qx, z = qz;
  // Accumulated rotation, to carry each octave's derivative back to the input frame.
  let r00 = 1, r01 = 0, r10 = 0, r11 = 1;
  for (let i = 0; i < octaves; i++) {
    noised(x * freq, z * freq);
    const w = 1 / (1 + damp * (dx * dx + dz * dz));
    sum += amp * w * N[0];
    const gx = N[1] * r00 + N[2] * r10, gz = N[1] * r01 + N[2] * r11;
    dx += amp * w * freq * gx;
    dz += amp * w * freq * gz;
    amp *= gain;
    freq *= 2.03;
    const nx = ROT_C * x - ROT_S * z, nz = ROT_S * x + ROT_C * z;
    x = nx; z = nz;
    const a00 = ROT_C * r00 - ROT_S * r10, a01 = ROT_C * r01 - ROT_S * r11, a10 = ROT_S * r00 + ROT_C * r10, a11 = ROT_S * r01 + ROT_C * r11;
    r00 = a00; r01 = a01; r10 = a10; r11 = a11;
  }
  return sum;
}

const smooth01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const smoothstep = (x: number, a: number, b: number) => smooth01((x - a) / (b - a));

/**
 * 0 where gameplay needs the old ground (the village, the road out of it and the processional way, the boss arena),
 * 1 in the open field. Fades over 12 m so the relief rises out of the flats instead of stepping. The road keeps
 * its ground to FROST_ROAD_SHOULDER past the paved edge (snowLayout.ts).
 */
export function snowKeep(x: number, z: number): number {
  const road = frostRoadKeepDist(x, z);
  const qx = Math.abs(x) - 45, qz = Math.abs(z - 60.5) - 35.5;
  const ox = Math.max(qx, 0), oz = Math.max(qz, 0), village = Math.sqrt(ox * ox + oz * oz) + Math.min(Math.max(qx, qz), 0);
  const arena = Math.sqrt(x * x + (z + 78) * (z + 78)) - 34;
  return smooth01(road / 12) * smooth01(village / 12) * smooth01(arena / 12);
}

/** Wind-carved relief of the open field, metres. Broad hills tens of metres long, drifts and lips of a few. */
export function snowRelief(x: number, z: number): number {
  const wx = SNOW_WIND[0], wz = SNOW_WIND[1];
  // Wind frame: a runs downwind, c across it.
  const a = x * wx + z * wz, c = -x * wz + z * wx;
  // Broad hills: compressed along the wind, so their crests run across it.
  const broad = fbmDamped(a * (1 / 46) + 3.1, c * (1 / 105) - 7.7, 3, 0.5, 0.9);
  let h = broad * 13;
  // Drifts: sheared downwind by the hills, so the lee faces steepen; they pile in troughs and scour off crests.
  const shelter = Math.min(1, Math.max(0.2, 0.55 - broad * 1.1));
  const drift = fbmDamped(a * (1 / 9) + broad * 2.4 + 11.3, c * (1 / 24) + 4.1, 2, 0.45, 1.6);
  h += drift * 2.6 * shelter;
  // Wind lips: crests across the wind that lean downwind, so each breaks into a steeper lee face. The crest is
  // rounded (smoothstep of the ridge), so no vertex ring has to carry a crease.
  const la = a * (1 / 7) + 2.7, lc = c * (1 / 19) - 5.2;
  noised(la, lc);
  const r0 = 1 - Math.abs(N[0]);
  noised(la + 0.3 * r0 * r0, lc);
  const r1 = 1 - Math.abs(N[0]), lip = r1 * r1 * (3 - 2 * r1);
  noised(a * (1 / 55) + 1.3, c * (1 / 80) - 2.1);
  const patch = smoothstep(N[0], -0.15, 0.35);
  h += (lip - 0.45) * 1.6 * patch;
  return h;
}

/** Snow the wind piles around each outcrop: a mound the rock stands in, a tail downwind, a scoured moat upwind. */
export function snowRockDrift(x: number, z: number): number {
  const wx = SNOW_WIND[0], wz = SNOW_WIND[1];
  let h = 0;
  for (const k of SNOW_ROCKS) {
    const dx = x - k.x, dz = z - k.z;
    if (Math.abs(dx) > k.r * 6 || Math.abs(dz) > k.r * 6) continue;
    const a = (dx * wx + dz * wz) / k.r, c = (-dx * wz + dz * wx) / k.r, d2 = a * a + c * c;
    const mound = Math.exp(-d2 * 1.1) * 0.22 * k.h;
    const rise = a > 0 ? 1 - Math.exp(-a * 2.2) : 0;
    // Squared, so the tail leaves the rock's lee without a crease.
    const tail = rise * rise * Math.exp(-a / 2.6) * Math.exp(-c * c * 1.6) * 0.36 * k.h;
    const moat = a < 0 ? -Math.exp(-((Math.sqrt(d2) - 1.15) ** 2) * 9) * smooth01(-a * 2) * 0.05 * k.h : 0;
    h += mound + tail + moat;
  }
  return h;
}

/** Frostlight ground height: the old island where gameplay needs it, the carved field everywhere else. */
export function snowGround(x: number, z: number): number {
  const edge = Math.sqrt((x / 128) * (x / 128) + ((z - 2) / 155) * ((z - 2) / 155));
  const plateau = 5 + 14 * smoothstep(-z, 5, 55);
  const hills = Math.sin(x * 0.052) * Math.sin(z * 0.037) * 2.5 * (1 - Math.exp(-x * x / 600));
  const t = smoothstep(Math.sqrt(x * x + (z + 78) * (z + 78)), 22, 32);
  const keep = snowKeep(x, z);
  let h = (1 - t) * 19 + t * (plateau + hills * (1 - keep));
  if (keep > 0) h += keep * (snowRelief(x, z) + snowRockDrift(x, z));
  // Coast: headlands push it out by up to 0.035 of the island radius, never inside the walkable 0.8.
  noised(x * 0.021 + 17.1, z * 0.021 - 3.3);
  const start = 0.83 + 0.035 * (N[0] * 0.7 + 0.5);
  if (edge <= start) return h;
  const k = Math.min(1, (edge - start) / 0.075);
  return h + (SNOW_SEA_ICE - h) * smooth01(k);
}
