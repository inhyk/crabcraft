// Tidecrown's districts laid out as numbers: the townhouses of every zone (planDistrict), the market's stalls, and
// the collision of everything the city adds (houses and yards, landmarks, terrace walls and stairs, quays, piers,
// ships, canal edges and bridges, lamps). layout.ts registers it with the stage 1 castle; city.ts builds the meshes.
import { type Collision, rectSurface } from '../../sim/world/collision';
import { plateauRadius, polyDistance, TC_AXIS, TC_CITY_WALL, TC_KEEP, TC_P, TC_TERRACES, tcAxis } from '../../sim/world/tidecrownGround';
import { canalDistance, TC_CANAL } from '../../sim/world/tidecrownCity';
import {
  bannerPoleSpots, canalBridges, canalWalls, type DistrictId, dressingPlan, gondolaPlan, harbourPlan, lampSpots, quad, retainingWalls,
  TC_CITY_STREETS, TC_DISTRICTS, TC_GARDENS, TC_GRAND_STAIRS, TC_LANDMARKS, TC_MARKET, TC_PALETTES, TC_RETAINING, TC_SQUARES, TC_STAIR, TC_ZONES, type V2, type Zone,
} from './cityPlan';
import { type DistrictPlan, type DistrictPlanOptions, type DistrictStreet, planDistrict, type TidecrownCollider } from './houses';
import type { TcPlacement } from './layout';
import { type MarketPlan, type MarketPlanOptions, planMarket } from './marketStalls';

type Height = (x: number, z: number) => number;

export interface CityLayout {
  zones: { zone: Zone; options: DistrictPlanOptions; plan: DistrictPlan }[];
  market: { options: MarketPlanOptions; plan: MarketPlan };
  walls: ReturnType<typeof retainingWalls>;
  harbour: ReturnType<typeof harbourPlan>;
  bridges: ReturnType<typeof canalBridges>;
  /** The canal walls' runs, each with the height its flagged top is laid (and walked) at. */
  canalWalls: (ReturnType<typeof canalWalls>[number] & { top: number })[];
  gondolas: ReturnType<typeof gondolaPlan>;
  lamps: ReturnType<typeof lampSpots>;
  poles: ReturnType<typeof bannerPoleSpots>;
  /** Garden trees and hedges, and what grows in the planters (nature kit pieces). */
  plants: { piece: string; x: number; y: number; z: number; yaw: number; s: number }[];
  /** Benches, anvils, stock (props kit) and the stone planters. */
  dressing: ReturnType<typeof dressingPlan>;
  /** Every solid the city adds, as boxes. */
  colliders: TidecrownCollider[];
  /** Walkable tops: arcade floor, terrace copings, stairs, quays, piers, bridges. */
  surfaces: ReturnType<typeof rectSurface>[];
  /** Ground the houses kept off (for the QA and the scatter). */
  reserved: V2[][];
  streets: DistrictStreet[];
  houses: Record<DistrictId, number>;
  ms: number;
}

const box = (x: number, z: number, hx: number, hz: number, yaw: number, y0: number, y1: number): TidecrownCollider => ({ x, z, hx, hz, c: Math.cos(yaw), s: Math.sin(yaw), y0, y1 });
/** A point in a piece's frame (rotation.y = yaw). */
const local = (x: number, z: number, yaw: number, lx: number, lz: number): V2 => {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [x + c * lx + s * lz, z - s * lx + c * lz];
};

/** The keep rock's rim (plateauRadius 1) pushed out by `grow`, as a polygon. */
function plateauOutline(grow: number): V2[] {
  const cx = TC_KEEP.x + 14, cz = TC_KEEP.z - 3, out: V2[] = [];
  for (let a = 0; a < 360; a += 7.5) {
    const dx = Math.cos((a * Math.PI) / 180), dz = Math.sin((a * Math.PI) / 180);
    let lo = 0, hi = 220;
    for (let k = 0; k < 30; k++) {
      const m = (lo + hi) / 2;
      if (plateauRadius(cx + dx * m, cz + dz * m) < 1) lo = m;
      else hi = m;
    }
    out.push([cx + dx * (lo + grow), cz + dz * (lo + grow)]);
  }
  return out;
}

/** Ground kept clear of houses: the city wall and its towers, terrace edges, the keep rock, ramps, squares, stairs. */
function reservedGround(placements: TcPlacement[]): V2[][] {
  const out: V2[][] = [];
  const wall = TC_CITY_WALL, n = wall.length;
  for (let i = 0; i < n; i++) {
    const a = wall[i], b = wall[(i + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    // The quay wall's inner face is its whole band: Quay Street runs along it.
    out.push(quad((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, L / 2 + 2, i === 8 || i === 9 ? 4.6 : 7.5, Math.atan2(-dz, dx)));
  }
  for (const p of placements) {
    if (p.piece === 'TC_CityTower') out.push(quad(p.x, p.z, 10, 10, 0));
    if (p.piece === 'TC_WardGate' || p.piece === 'TC_PincerGate') out.push(quad(p.x, p.z, 14 * p.sx + 4, 10 * p.sz, p.yaw));
  }
  // Terrace edges: from the wall's foot (4.4 out) to the end of its coping (3.4 in).
  for (const poly of [TC_TERRACES.middle, TC_TERRACES.upper]) {
    let area = 0;
    for (let i = 0; i < poly.length; i++) area += poly[i][0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * poly[i][1];
    const inward = area > 0 ? 1 : -1;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
      const ox = (dz / L) * inward, oz = (-dx / L) * inward;
      out.push(quad((a[0] + b[0]) / 2 + ox * 0.5, (a[1] + b[1]) / 2 + oz * 0.5, L / 2 + 3.9, 3.9, Math.atan2(-dz, dx)));
    }
  }
  out.push(plateauOutline(5));
  // The King's Way ramps and the stair-foot approach.
  const aq = (t0: number, t1: number, s0: number, s1: number): V2[] => [tcAxis(t0, s0), tcAxis(t1, s0), tcAxis(t1, s1), tcAxis(t0, s1)];
  out.push(aq(86, 121, -15.5, 15.5), aq(136, 206, -17, 17));
  for (const s of TC_SQUARES) out.push(s.poly);
  for (const g of TC_GARDENS) out.push(g.poly);
  for (const l of TC_LANDMARKS) out.push(l.keep);
  for (const s of TC_GRAND_STAIRS) {
    const run = TC_STAIR.run * s.sz, [cx, cz] = local(s.x, s.z, s.yaw, 0, -run / 2);
    out.push(quad(cx, cz, (TC_STAIR.width * s.sx) / 2 + 1.6, run / 2 + 2.2, s.yaw));
  }
  // The sea gate's inner approach.
  out.push(quad(206, 19.5, 7, 7, 0.24));
  return out;
}

/** Plan the whole city on the terrain heights (deterministic, no kits). */
export function planCity(height: Height, placements: TcPlacement[]): CityLayout {
  const t0 = performance.now();
  const reserved = reservedGround(placements);
  const streets: DistrictStreet[] = TC_CITY_STREETS.map((s) => ({ points: s.points, width: s.width }));
  const houses = Object.fromEntries(Object.keys(TC_DISTRICTS).map((k) => [k, 0])) as Record<DistrictId, number>;
  const zones: CityLayout['zones'] = [];
  const colliders: TidecrownCollider[] = [];
  const bounds = (pts: readonly (readonly number[])[], grow: number) => {
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
    for (const p of pts) { a = Math.min(a, p[0]); b = Math.max(b, p[0]); c = Math.min(c, p[1]); d = Math.max(d, p[1]); }
    return [a - grow, b + grow, c - grow, d + grow];
  };
  const meets = (p: number[], q: number[]) => p[0] <= q[1] && q[0] <= p[1] && p[2] <= q[3] && q[2] <= p[3];
  for (const zone of TC_ZONES) {
    // Only what can touch the zone: its reserved ground and streets (the zone's own first, the generator gives its
    // first street a storey more).
    const zb = bounds(zone.polygon, 14);
    const near = (pts: readonly (readonly number[])[]) => meets(bounds(pts, 0), zb);
    const own = TC_CITY_STREETS.filter((s) => s.district === zone.district && near(s.points)).map((s) => streets[TC_CITY_STREETS.indexOf(s)]);
    const others = streets.filter((s) => !own.includes(s) && near(s.points));
    const options: DistrictPlanOptions = { polygon: zone.polygon, streets: [...own, ...others], reserved: reserved.filter(near), height, seed: zone.seed, floors: zone.floors, laneSpacing: 0, palette: TC_PALETTES[zone.district] };
    const plan = planDistrict(options);
    zones.push({ zone, options, plan });
    houses[zone.district] += plan.houses.length;
    colliders.push(...plan.colliders);
  }

  // The market: two rings of stalls round the square, clear of the King's Way, the four streets, the fountain and the
  // arcade.
  const [mx, mz] = TC_MARKET.centre;
  const ang = (dx: number, dz: number) => Math.atan2(dz, dx);
  const marketOptions: MarketPlanOptions = {
    x: mx, z: mz, radius: TC_MARKET.r - 1, height, seed: 41, inner: 0, laneWidth: 6,
    rings: [{ f: 0.88, facing: 1 }, { f: 0.73, facing: -1 }, { f: 0.57, facing: 1 }, { f: 0.42, facing: -1 }, { f: 0.27, facing: 1 }],
    lanes: [ang(TC_AXIS.ux, TC_AXIS.uz), ang(-TC_AXIS.ux, -TC_AXIS.uz), ang(TC_P.x, TC_P.z), ang(-TC_P.x, -TC_P.z), ang(94.2 - mx, 98.2 - mz)],
    streets: [{ points: [tcAxis(20), tcAxis(100)], width: 10 }],
    reserved: TC_LANDMARKS.filter((l) => l.district === 'market').map((l) => l.keep),
  };
  const market = { options: marketOptions, plan: planMarket(marketOptions) };
  colliders.push(...market.plan.colliders);

  const surfaces: CityLayout['surfaces'] = [];
  // Landmarks.
  for (const l of TC_LANDMARKS) {
    const y = height(l.x, l.z);
    for (const [lx, lz, hx, hz, y0, y1] of l.solids) {
      const [x, z] = local(l.x, l.z, l.yaw, lx * l.scale, lz * l.scale);
      colliders.push(box(x, z, hx * l.scale, hz * l.scale, l.yaw, y + y0 * l.scale, y + y1 * l.scale));
    }
    if (l.piece === 'TC_MarketArcade') surfaces.push(rectSurface(l.x, l.z, 10.6, 5.8, l.yaw, y + 0.24));
    if (l.piece === 'TC_Cathedral') {
      // The front steps up to the doors.
      const [x, z] = local(l.x, l.z, l.yaw, 0, 28.1);
      surfaces.push(rectSurface(x, z, 6, 1.3, l.yaw, y + 0.3, 0, -0.6 / 2.6));
    }
  }

  // Terrace walls: a parapet along the front, a walkable coping over the cut behind it.
  const walls = retainingWalls(height);
  const copings: ReturnType<typeof rectSurface>[] = [];
  for (const w of walls.runs) {
    const len = TC_RETAINING.len * w.sx;
    const [px, pz] = local(w.x, w.z, w.yaw, 0, TC_RETAINING.face - 0.35);
    colliders.push(box(px, pz, len / 2 + 0.3, 0.55, w.yaw, w.y - 2, w.top + 1.2));
    const [cx, cz] = local(w.x, w.z, w.yaw, 0, -1.4);
    copings.push(rectSurface(cx, cz, len / 2 + 0.2, 1.75, w.yaw, w.top));
  }
  surfaces.push(...copings);
  for (const p of walls.piers) colliders.push(box(p.x, p.z, 1.3, 1.3, 0, p.y, p.top + 1));

  // Grand stairs: the flight (local -Z climbs) between its balustrades.
  const flights: ReturnType<typeof rectSurface>[] = [];
  for (const s of TC_GRAND_STAIRS) {
    const run = TC_STAIR.run * s.sz, rise = TC_STAIR.rise * s.sy, half = (TC_STAIR.walk * s.sx) / 2;
    const [cx, cz] = local(s.x, s.z, s.yaw, 0, -run / 2);
    flights.push(rectSurface(cx, cz, half, run / 2, s.yaw, s.y + rise / 2, 0, -rise / run));
    surfaces.push(flights[flights.length - 1]);
    for (const k of [-1, 1]) {
      const [bx, bz] = local(s.x, s.z, s.yaw, k * (half + 0.45), -run / 2);
      colliders.push(box(bx, bz, 0.45, run / 2 + 0.3, s.yaw, s.y - 1, s.y + rise + 2));
    }
  }

  // Harbour: quays and piers are walked on; ships, the crane and the cargo block. Level walks overlap their neighbours
  // a little (no seams where the sea bed shows through), and where a walk's edge drops to the water a kerb of collision
  // stands just outside it.
  const harbour = harbourPlan();
  const walks: ReturnType<typeof rectSurface>[] = [];
  for (const p of harbour.pieces) {
    if (!p.walk) continue;
    const [x, z] = local(p.x, p.z, p.yaw, p.walk.lx, p.walk.lz);
    const level = !p.walk.gx && !p.walk.gz;
    walks.push(rectSurface(x, z, p.walk.hx + 0.35, p.walk.hz + (level ? 0.35 : 0), p.yaw, p.walk.h, p.walk.gx ?? 0, p.walk.gz ?? 0));
  }
  surfaces.push(...walks);
  colliders.push(...edgeKerbs(walks, walks, height, 1.5));
  for (const s of harbour.ships) colliders.push(box(s.x, s.z, s.hx, s.hz, s.yaw, -6, 40));
  colliders.push(box(...local(harbour.crane.x, harbour.crane.z, harbour.crane.yaw, 0, -1.2), 2.5, 2.6, harbour.crane.yaw, 2, 18));
  for (const c of harbour.cargo) colliders.push(box(c.x, c.z, 2.5, 1.8, c.yaw, c.y - 1, c.y + 2.2));

  // Canals: bridges are walked on, their parapets block.
  const bridges = canalBridges();
  for (const b of bridges) {
    // Two ramps up from the quays and the crown over the water.
    const ramp = b.ramp, top = TC_CANAL.street + b.crown;
    for (const k of [-1, 1]) {
      const [x, z] = local(b.x, b.z, b.yaw, 0, k * (b.hl - ramp / 2));
      surfaces.push(rectSurface(x, z, b.hw, ramp / 2, b.yaw, TC_CANAL.street + b.crown / 2, 0, (-k * b.crown) / ramp));
    }
    surfaces.push(rectSurface(b.x, b.z, b.hw, b.hl - ramp + 0.05, b.yaw, top));
    for (const k of [-1, 1]) {
      const [x, z] = local(b.x, b.z, b.yaw, k * (b.hw + 0.3), 0);
      colliders.push(box(x, z, 0.3, b.hl - 0.6, b.yaw, TC_CANAL.street - 2, top + 1.2));
    }
  }
  // Canal edges: a kerb of collision along each wall's inner metre (a bridge's deck crosses it), so the quays can be
  // walked right up to the coping (blockCityWater opens the cells the cut's slope would close).
  const canalWallRuns = canalWalls();
  for (const w of canalWallRuns) {
    const dx = w.bx - w.ax, dz = w.bz - w.az, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
    // Where a bridge crosses this run: its deck's width along the run, at its centre's projection.
    const cuts = bridges
      .map((b) => ({ b, u: (b.x - w.ax) * ux + (b.z - w.az) * uz, off: Math.abs((b.x - w.ax) * -uz + (b.z - w.az) * ux) }))
      .filter(({ b, u, off }) => u > -b.hw - 1 && u < L + b.hw + 1 && off < b.hl + 1)
      .map(({ b, u }) => [u - b.hw - 0.2, u + b.hw + 0.2])
      .sort((a, b) => a[0] - b[0]);
    let u0 = 0;
    const kerb = (a: number, b: number) => {
      if (b - a < 0.3) return;
      const m = (a + b) / 2, x = w.ax + ux * m - w.nx * 0.4, z = w.az + uz * m - w.nz * 0.4;
      colliders.push(box(x, z, (b - a) / 2, 0.6, Math.atan2(-dz, dx), TC_CANAL.bed, TC_CANAL.street + 1));
    };
    for (const [a, b] of cuts) { kerb(u0, Math.min(L, a)); u0 = Math.max(u0, b); }
    kerb(u0, L);
  }
  const gondolas = gondolaPlan();

  // Lamps and banner poles.
  const lamps = lampSpots(), poles = bannerPoleSpots();
  for (const l of lamps) { const y = height(l.x, l.z); colliders.push(box(l.x, l.z, 0.4, 0.4, l.yaw, y - 1, y + 5.8)); }
  for (const p of poles) { const y = height(p.x, p.z); colliders.push(box(p.x, p.z, 1.0, 0.45, p.yaw, y - 1, y + 9.3)); }

  // Gardens: a ring of clipped hedges, flowering shrubs and broad trees.
  const plants: CityLayout['plants'] = [];
  let k = 0;
  for (const g of TC_GARDENS) {
    const cx = g.poly.reduce((s, p) => s + p[0], 0) / g.poly.length, cz = g.poly.reduce((s, p) => s + p[1], 0) / g.poly.length;
    const n = g.poly.length;
    for (let i = 0; i < n; i++) {
      const a = g.poly[i], b = g.poly[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]), m = Math.max(1, Math.round(L / 2.4));
      for (let j = 0; j < m; j++) {
        const f = (j + 0.5) / m, x = a[0] + (b[0] - a[0]) * f + (cx - a[0] - (b[0] - a[0]) * f) * 0.08, z = a[1] + (b[1] - a[1]) * f + (cz - a[1] - (b[1] - a[1]) * f) * 0.08;
        plants.push({ piece: (k++ % 5 === 0) ? 'Bush_Common_Flowers' : 'Bush_Common', x, y: height(x, z), z, yaw: k * 1.3, s: 0.9 + ((k * 0.37) % 0.3) });
      }
    }
    // Trees inside, kept off the centre (a fountain or a lawn).
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + 0.6;
      const [qx, qz] = g.poly[i % n];
      const x = cx + (qx - cx) * 0.55 + Math.cos(a) * 0.5, z = cz + (qz - cz) * 0.55 + Math.sin(a) * 0.5;
      const y = height(x, z);
      plants.push({ piece: i % 2 ? 'CommonTree_3' : 'CommonTree_5', x, y, z, yaw: i * 2.1, s: 0.72 + 0.08 * i });
      colliders.push(box(x, z, 0.5, 0.5, 0, y - 1, y + 7));
    }
  }

  // Dressing: props block where they stand solid, planters always, their plants grow with the foliage.
  const dressing = dressingPlan();
  for (const p of dressing.props) if (p.solid) { const y = height(p.x, p.z); colliders.push(box(p.x, p.z, p.solid * p.s, p.solid * p.s, p.yaw, y - 1, y + 2)); }
  for (const p of dressing.planters) {
    const y = height(p.x, p.z);
    colliders.push(box(p.x, p.z, p.hx + 0.1, p.hz + 0.1, p.yaw, y - 1, y + 3));
    plants.push({ piece: p.plant, x: p.x, y: y + 0.75, z: p.z, yaw: p.x * 1.7, s: p.s });
  }

  // Canal wall tops: flagged flush with the quay just behind them (bridges included) and walked on at that height, over
  // the 2 m grid's slope into the cut.
  const above = (x: number, z: number) => {
    let h = -Infinity;
    for (const s of surfaces) if (s.contains(x, z)) h = Math.max(h, s.height(x, z));
    return h > -Infinity ? h : height(x, z);
  };
  const canalTops = canalWallRuns.map((w) => {
    const dx = w.bx - w.ax, dz = w.bz - w.az, len = Math.hypot(dx, dz), yaw = Math.atan2(-dz, dx);
    const mx = (w.ax + w.bx) / 2, mz = (w.az + w.bz) / 2;
    // Local +Z toward the water.
    const lz = Math.sign(Math.sin(yaw) * w.nx + Math.cos(yaw) * w.nz) || 1;
    let top = TC_CANAL.street - 0.02;
    for (let u = -len / 2; u <= len / 2 + 0.01; u += 1.5) top = Math.max(top, above(...local(mx, mz, yaw, Math.min(u, len / 2), -lz * 2.3)) + 0.03);
    top = Math.min(top, TC_CANAL.street + 0.4);
    return { ...w, top, mx, mz, len, yaw, lz };
  });
  const tops = canalTops.map((w) => rectSurface(...local(w.mx, w.mz, w.yaw, 0, -w.lz * 1.45), w.len / 2 + 0.5, 0.85, w.yaw, w.top));
  surfaces.push(...tops);
  // A coping that ends over lower ground (where its terrace edge turns away or a ramp falls) is closed there, so
  // walking off it is not a jump; so is any low gap left between two copings at a corner.
  // (At a coping's ends a step of more than 0.6 at the very edge counts; its back steps up 0.35 from its terrace, so
  // there only a dip of 0.75 under it within 0.8 behind it does.)
  const kerbs = [...edgeKerbs(copings, surfaces, height, 0.6, [0.1], 'ends'), ...edgeKerbs(copings, surfaces, height, 0.75, [0.1, 0.3, 0.5, 0.8], 'back')];
  colliders.push(...kerbs, ...gapKerbs(copings, surfaces, kerbs, height, 1));
  // A stair's flight beside a dip past its balustrades' ends, and the corners where two canal wall tops meet over the
  // cut, likewise.
  const stairKerbs = edgeKerbs(flights, surfaces, height, 1, [0.1, 0.3, 0.5, 0.8]);
  colliders.push(...stairKerbs, ...gapKerbs(tops, surfaces, colliders.filter((c) => c.hz === 0.6 && c.y0 === TC_CANAL.bed), height, 1));

  return {
    zones, market, walls, harbour, bridges, canalWalls: canalTops.map(({ ax, az, bx, bz, nx, nz, top }) => ({ ax, az, bx, bz, nx, nz, top })), gondolas, lamps, poles, plants, dressing, colliders, surfaces, reserved, streets, houses,
    ms: Math.round(performance.now() - t0),
  };
}

/**
 * Kerbs along walks' open edges (`side`: all four, the two across local x, or the one toward local -z): wherever the
 * ground at any of `probes` outside an edge (on none of `others`) lies more than `dropBy` below the walk, runs of thin
 * boxes 0.05 to 0.55 outside it keep a crab from stepping off (into the harbour, off a coping's end, into a dip behind
 * it).
 */
function edgeKerbs(walks: ReturnType<typeof rectSurface>[], others: ReturnType<typeof rectSurface>[], height: Height, dropBy: number, probes = [0.3], side: 'all' | 'ends' | 'back' = 'all'): TidecrownCollider[] {
  const out: TidecrownCollider[] = [];
  const onWalk = (x: number, z: number) => others.some((w) => w.contains(x, z));
  for (const w of walks) {
    const { x, z, hx, hz, yaw } = w.spec as { x: number; z: number; hx: number; hz: number; yaw: number };
    // Each edge: its half length, and the local axes along it and out of it.
    for (const [ax, az, nx, nz, half] of [[1, 0, 0, 1, hx], [1, 0, 0, -1, hx], [0, 1, 1, 0, hz], [0, 1, -1, 0, hz]] as const) {
      if ((side === 'ends' && !nx) || (side === 'back' && nz !== -1)) continue;
      const depth = nx ? hx : hz, n = Math.max(1, Math.ceil((2 * half) / 0.5));
      let run: number | null = null;
      for (let k = 0; k <= n; k++) {
        const u = -half + (2 * half * k) / n;
        const [ex, ez] = local(x, z, yaw, ax * u + nx * (depth - 0.05), az * u + nz * (depth - 0.05));
        const drop = probes.some((d) => {
          const [px, pz] = local(x, z, yaw, ax * u + nx * (depth + d), az * u + nz * (depth + d));
          return !onWalk(px, pz) && height(px, pz) < w.height(ex, ez) - dropBy;
        });
        if (drop && run === null) run = u;
        if ((!drop || k === n) && run !== null) {
          const u1 = drop ? u : u - (2 * half) / n;
          const m = (run + u1) / 2, len = (u1 - run) / 2 + 0.25;
          const [cx, cz] = local(x, z, yaw, ax * m + nx * (depth + 0.3), az * m + nz * (depth + 0.3));
          const top = Math.max(w.height(...local(x, z, yaw, ax * run, az * run)), w.height(...local(x, z, yaw, ax * u1, az * u1)));
          out.push(box(cx, cz, ax ? len : 0.25, ax ? 0.25 : len, yaw, -8, top + 1.2));
          run = null;
        }
      }
    }
  }
  return out;
}

/** Small boxes on low ground left between two walks (within a metre of both) that no walk or kerb covers: corner gaps. */
function gapKerbs(walks: ReturnType<typeof rectSurface>[], others: ReturnType<typeof rectSurface>[], kerbs: TidecrownCollider[], height: Height, dropBy: number): TidecrownCollider[] {
  const out: TidecrownCollider[] = [];
  const seen = new Set<string>();
  const inBox = (x: number, z: number, b: TidecrownCollider) => {
    const dx = x - b.x, dz = z - b.z;
    return Math.abs(b.c * dx - b.s * dz) < b.hx && Math.abs(b.s * dx + b.c * dz) < b.hz;
  };
  const near = (o: ReturnType<typeof rectSurface>, px: number, pz: number) => {
    const { x, z, hx, hz, yaw } = o.spec as { x: number; z: number; hx: number; hz: number; yaw: number };
    const c = Math.cos(yaw), sn = Math.sin(yaw), dx = px - x, dz = pz - z;
    return Math.abs(c * dx - sn * dz) <= hx + 1 && Math.abs(sn * dx + c * dz) <= hz + 1;
  };
  for (const w of walks) {
    const { x, z, hx, hz, yaw } = w.spec as { x: number; z: number; hx: number; hz: number; yaw: number };
    for (let lx = -hx - 1; lx <= hx + 1; lx += 0.25)
      for (let lz = -hz - 1; lz <= hz + 1; lz += 0.25) {
        if (Math.abs(lx) <= hx && Math.abs(lz) <= hz) continue;
        const [px, pz] = local(x, z, yaw, lx, lz);
        const key = `${Math.round(px * 4)},${Math.round(pz * 4)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const [ex, ez] = local(x, z, yaw, Math.max(-hx, Math.min(hx, lx)), Math.max(-hz, Math.min(hz, lz)));
        if (!walks.some((o) => o !== w && near(o, px, pz))) continue;
        if (others.some((o) => o.contains(px, pz)) || height(px, pz) >= w.height(ex, ez) - dropBy) continue;
        if (kerbs.some((b) => inBox(px, pz, b)) || out.some((b) => inBox(px, pz, b))) continue;
        out.push(box(px, pz, 0.3, 0.3, yaw, height(px, pz) - 2, w.height(ex, ez) + 1.2));
      }
  }
  return out;
}

/** After buildBlocked: off the walks, harbour ground under +1 (the sea's shallows) is not walkable. */
export function blockHarbourShallows(col: Collision): void {
  const t = col.terrain;
  for (let j = 0; j < t.nz - 1; j++) {
    const z = t.minZ + (j + 0.5) * t.step;
    if (z < -110 || z > 100) continue;
    for (let i = 0; i < t.nx - 1; i++) {
      const x = t.minX + (i + 0.5) * t.step;
      if (x < 190 || polyDistance(x, z, TC_CITY_WALL) > 0 || col.surfaceAt(x, z)) continue;
      const k = j * t.nx + i, lo = Math.min(t.h[k], t.h[k + 1], t.h[k + t.nx], t.h[k + t.nx + 1]);
      if (lo < 1) col.blocked[j * (t.nx - 1) + i] = 1;
    }
  }
}

/** Surfaces first (cells under them stay open in buildBlocked), then every solid. */
export function registerCity(col: Collision, city: CityLayout): void {
  for (const s of city.surfaces) col.addSurface(s);
  for (const c of city.colliders) col.addBoxCS(c.x, c.z, c.hx, c.hz, c.c, c.s, c.y0, c.y1);
}

/** For buildBlocked: the quays beside a canal stay open where only the cut's slope would close them (the kerb blocks). */
export function canalQuayOpen(col: Collision): (x: number, z: number) => boolean {
  return (x, z) => {
    if (x < 80 || x > 225 || z < 40 || z > 115) return false;
    const d = canalDistance(x, z);
    if (d <= 1.0 || d >= 3.5) return false;
    // Only the cut: no corner of the cell stands higher than the street (a terrace edge stays closed).
    const h = col.terrain.heightAt;
    return Math.max(h(x - 1, z - 1), h(x + 1, z - 1), h(x - 1, z + 1), h(x + 1, z + 1)) < TC_CANAL.street + 0.6;
  };
}

/** After buildBlocked: canal water is not walkable (its bed is level), except under a bridge. */
export function blockCityWater(col: Collision): void {
  const t = col.terrain;
  for (let j = 0; j < t.nz - 1; j++) {
    const z = t.minZ + (j + 0.5) * t.step;
    if (z < 40 || z > 115) continue;
    for (let i = 0; i < t.nx - 1; i++) {
      const x = t.minX + (i + 0.5) * t.step;
      if (x < 80 || x > 225) continue;
      if (canalDistance(x, z) < 0.6 && !col.surfaceAt(x, z)) col.blocked[j * (t.nx - 1) + i] = 1;
    }
  }
}

/**
 * Where the city stands, on a 1 m grid over the walls' box: houses, landmarks, stalls, squares, stairs, canals.
 * The nature scatter keeps its tufts, flowers and trees off these cells.
 */
export function cityOccupancy(city: CityLayout): (x: number, z: number) => boolean {
  const x0 = -160, z0 = -240, nx = 430, nz = 390;
  const grid = new Uint8Array(nx * nz);
  const fill = (poly: V2[], grow = 0) => {
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
    for (const [x, z] of poly) { a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, z); d = Math.max(d, z); }
    for (let j = Math.max(0, Math.floor(c - grow - z0)); j <= Math.min(nz - 1, Math.ceil(d + grow - z0)); j++)
      for (let i = Math.max(0, Math.floor(a - grow - x0)); i <= Math.min(nx - 1, Math.ceil(b + grow - x0)); i++) {
        const x = x0 + i + 0.5, z = z0 + j + 0.5;
        if (polyDistance(x, z, poly) > -grow) grid[j * nx + i] = 1;
      }
  };
  for (const zz of city.zones) for (const l of zz.plan.lots) fill(l.corners, 1.2);
  for (const c of city.colliders) fill(quad(c.x, c.z, c.hx, c.hz, Math.atan2(c.s, c.c)), 0.6);
  for (const s of TC_SQUARES) fill(s.poly);
  for (const l of TC_LANDMARKS) fill(l.keep);
  for (const w of city.walls.runs) fill(quad(...local(w.x, w.z, w.yaw, 0, -0.4), (TC_RETAINING.len * w.sx) / 2, 2.6, w.yaw));
  for (const s of TC_GRAND_STAIRS) {
    const run = TC_STAIR.run * s.sz;
    fill(quad(...local(s.x, s.z, s.yaw, 0, -run / 2), (TC_STAIR.width * s.sx) / 2 + 0.6, run / 2 + 0.6, s.yaw));
  }
  return (x, z) => {
    if (canalDistance(x, z) < TC_CANAL.wall + 0.6) return true;
    const i = Math.floor(x - x0), j = Math.floor(z - z0);
    return i >= 0 && j >= 0 && i < nx && j < nz && grid[j * nx + i] === 1;
  };
}

