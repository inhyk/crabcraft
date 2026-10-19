// Tidecrown's minimap picture painted from the terrain data (heights, splat, forest, walls): no render pass, so
// entering the hub never waits on a top-down shot of the whole island.
import { TC_BOUNDS, TC_CITY_WALL, TC_KEEP, TC_LEVEL, tcAxis } from '../../sim/world/tidecrownGround';
import type { MapSnapshot } from '../snapshots';
import { TC_SPANS, TC_PIECES, wardCorners } from './layout';
import type { TidecrownTerrain } from './terrain';

const rgb = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const GRASS = rgb('#6c9944'), SAND = rgb('#dcc38f'), DIRT = rgb('#9b7752'), COBBLE = rgb('#c4b8a0'), ROCK = rgb('#aaa395'), SHALLOW = rgb('#3fb9b0'), DEEP = rgb('#17507e');

export function paintTidecrownMap(terrain: TidecrownTerrain, pines: readonly [number, number][]): MapSnapshot {
  const minX = TC_BOUNDS.minX - 40, minZ = TC_BOUNDS.minZ, size = TC_BOUNDS.maxZ - TC_BOUNDS.minZ, px = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(px, px), d = img.data;
  const { nx, nz, step, h, splat } = terrain;
  const at = (x: number, z: number) => {
    const i = Math.max(0, Math.min(nx - 1, Math.round((x - terrain.minX) / step))), j = Math.max(0, Math.min(nz - 1, Math.round((z - terrain.minZ) / step)));
    return j * nx + i;
  };
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const wx = minX + ((x + 0.5) / px) * size, wz = minZ + ((y + 0.5) / px) * size, k = at(wx, wz), hy = h[k];
      let c: number[];
      if (hy < 0) {
        const t = Math.min(1, -hy / 8);
        c = SHALLOW.map((v, i) => v + (DEEP[i] - v) * t);
      } else {
        const w = [splat[k * 4] / 255, splat[k * 4 + 1] / 255, splat[k * 4 + 2] / 255, splat[k * 4 + 3] / 255];
        // Steep ground reads as rock, as the terrain shader paints it.
        const sx = h[at(wx + 2, wz)] - h[at(wx - 2, wz)], sz = h[at(wx, wz + 2)] - h[at(wx, wz - 2)], steep = Math.min(1, Math.max(0, (Math.hypot(sx, sz) / 4 - 0.45) * 3));
        c = GRASS.slice();
        for (const [layer, weight] of [[DIRT, w[2]], [SAND, w[0]], [COBBLE, w[1]], [ROCK, Math.max(w[3], steep)]] as const) for (let i = 0; i < 3; i++) c[i] += (layer[i] - c[i]) * weight;
        // Light from the south-west, and higher ground a little brighter.
        const shade = 0.88 + Math.max(-0.25, Math.min(0.25, (sx * 0.6 - sz * 0.7) * 0.08)) + hy / TC_LEVEL.plateau * 0.1;
        c = c.map((v) => v * shade);
      }
      const o = (y * px + x) * 4;
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const P = (x: number, z: number): [number, number] => [((x - minX) / size) * px, ((z - minZ) / size) * px];
  // Forest canopy.
  g.fillStyle = 'rgba(38,78,40,0.85)';
  for (const [x, z] of pines) {
    const [u, v] = P(x, z);
    if (u < 0 || v < 0 || u > px || v > px) continue;
    g.beginPath(); g.arc(u, v, 1.6, 0, Math.PI * 2); g.fill();
  }
  // City wall, ward ring, keep and bridge.
  const ring = (pts: readonly (readonly [number, number])[], width: number, color: string) => {
    g.beginPath();
    pts.forEach(([x, z], i) => (i ? g.lineTo(...P(x, z)) : g.moveTo(...P(x, z))));
    g.closePath(); g.lineWidth = width; g.strokeStyle = color; g.stroke();
  };
  ring(TC_CITY_WALL, 3.2, '#efe3c6');
  ring(wardCorners(), 2.4, '#efe3c6');
  const [k0, k1] = [tcAxis(243.6, -30), tcAxis(243.6, 30)], [k2, k3] = [tcAxis(313.6, 30), tcAxis(313.6, -30)];
  g.fillStyle = '#f4ead2';
  g.beginPath(); [k0, k1, k2, k3].forEach(([x, z], i) => (i ? g.lineTo(...P(x, z)) : g.moveTo(...P(x, z)))); g.closePath(); g.fill();
  g.fillStyle = '#53f2e4';
  g.beginPath(); g.arc(...P(TC_KEEP.x, TC_KEEP.z), 3.2, 0, Math.PI * 2); g.fill();
  const half = TC_PIECES.bridgeSpan.len / 2, w = TC_PIECES.bridgeSpan.w / 2;
  const b = [tcAxis(TC_SPANS[0] - half, -w), tcAxis(TC_SPANS[0] - half, w), tcAxis(TC_SPANS[2] + half, w), tcAxis(TC_SPANS[2] + half, -w)];
  g.fillStyle = '#e6dcc6';
  g.beginPath(); b.forEach(([x, z], i) => (i ? g.lineTo(...P(x, z)) : g.moveTo(...P(x, z)))); g.closePath(); g.fill();
  return { canvas, minX, minZ, size };
}
