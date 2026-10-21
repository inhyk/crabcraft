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
