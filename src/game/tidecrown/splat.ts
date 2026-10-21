// Tidecrown's ground splat (R sand, G cobble, B dirt, A painted rock) from its heights: numbers only, so the heights
// worker can paint it too.
import { plateauRadius, polyDistance, TC_CITY_WALL, tcCoast, TIDECROWN_GRID } from '../../sim/world/tidecrownGround';
import { Simplex, smoothstep } from '../../world/noise';
import { tcPaving } from './paving';

export function paintTidecrownSplat(h: Float32Array): Uint8Array {
  const { nx, nz, step, minX, minZ } = TIDECROWN_GRID;
  const splat = new Uint8Array(nx * nz * 4);
  const N = new Simplex(23), pave = { cobble: 0, dirt: 0, clear: 0 };
  const put = (k: number, ch: number, w: number) => {
    const v = Math.round(Math.max(0, Math.min(1, w)) * 255);
    if (v > splat[k * 4 + ch]) splat[k * 4 + ch] = v;
  };
  for (let j = 0; j < nz; j++) {
    const z = minZ + j * step;
    for (let i = 0; i < nx; i++) {
      const x = minX + i * step, k = j * nx + i, y = h[k];
      const n = N.fbm(x * 0.05, z * 0.05, 2), c = tcCoast(x, z);
      // Beaches along low shores, sand under the shallows.
      if (y < 3.6 + n) put(k, 0, (1 - smoothstep(9 + 4 * n, 15 + 4 * n, c.d)) * (1 - smoothstep(2.2 + n, 3.6 + n, y)));
      if (y < 0.4) put(k, 0, 1);
      if (x > -150 && x < 260 && z > -250 && z < 345) {
        tcPaving(x, z, pave);
        put(k, 1, pave.cobble);
        put(k, 2, pave.dirt);
      }
      // Worn earth along the foot of the city wall, and patches in the lawns and under the pines.
      const wd = polyDistance(x, z, TC_CITY_WALL);
      if (Math.abs(wd) < 9) put(k, 2, (1 - smoothstep(3, 9, Math.abs(wd))) * (0.55 + 0.4 * n));
      const patches = N.fbm(x * 0.031 + 11, z * 0.031, 3);
      if (c.south > c.north && c.d > 12) put(k, 2, smoothstep(0.05, 0.45, patches) * 0.75);
      else if (wd > 6) put(k, 2, smoothstep(0.25, 0.6, patches) * 0.6);
      // The keep's rock shows bare limestone around its rim; the overlook has its outcrops.
      const rim = plateauRadius(x, z);
      if (rim > 0.9 && rim < 1.08) put(k, 3, (1 - smoothstep(0.03, 0.08, Math.abs(rim - 1.0))) * 0.9);
      if (c.d > 0 && c.d < 7 && y > 7) put(k, 3, 1 - smoothstep(3, 7, c.d));
    }
  }
  return splat;
}

/**
 * The setts run on to the houses along a street: within `margin` of a footprint and `reach` of a paved street (its
 * fronts, and the gaps between houses that open on it) the cobble weight is full, so no strip of grass or earth shows
 * between the paving and a plinth. Back gardens keep their grass. Painted into `splat` on the main thread, which has
 * the plan.
 */
export function paveAprons(splat: Uint8Array, lots: readonly { corners: readonly [number, number][] }[], margin = 1.6, reach = 4): void {
  const { nx, nz, step, minX, minZ } = TIDECROWN_GRID;
  const pave = { cobble: 0, dirt: 0, clear: 0 };
  for (const { corners } of lots) {
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
    for (const [x, z] of corners) { a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, z); d = Math.max(d, z); }
    const i0 = Math.max(0, Math.floor((a - margin - minX) / step)), i1 = Math.min(nx - 1, Math.ceil((b + margin - minX) / step));
    const j0 = Math.max(0, Math.floor((c - margin - minZ) / step)), j1 = Math.min(nz - 1, Math.ceil((d + margin - minZ) / step));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = minX + i * step, z = minZ + j * step, k = (j * nx + i) * 4;
      if (splat[k + 1] === 255 || -polyDistance(x, z, corners as [number, number][]) > margin) continue;
      if (tcPaving(x, z, pave).clear > reach) continue;
      splat[k + 1] = 255;
    }
  }
}
