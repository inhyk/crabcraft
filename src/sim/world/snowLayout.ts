// Frostlight's street plan, numbers only: the winding high street, the lanes, the squares, the road that winds out
// of the village gate past the guide lanterns, and the straight processional way from the aurora ridge to the
// Frozen Throne. Shared by the server's ground (snowGround.ts), its GLSL twin (src/game/snowTerrain.ts), the
// paving (src/game/frostPaving.ts), the village, the field dressing and the residents, so the ground, the stones,
// the solids and the people always agree.

export type XZ = readonly [number, number];
/** A paved way: a polyline (sampled from a spline) and its width. `main` ways carry cart ruts. */
export interface FrostWay { readonly id: string; readonly points: readonly XZ[]; readonly width: number }
/** A paved square, as one disc of its outline. */
export interface FrostPad { readonly id: string; readonly x: number; readonly z: number; readonly r: number }

const mm = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Centripetal Catmull-Rom through `ctrl`, sampled about every `step` metres and rounded to the millimetre, so the
 * GLSL constants (printed to three decimals) are the very numbers the server uses.
 */
function spline(ctrl: readonly XZ[], step: number): XZ[] {
  const n = ctrl.length, out: XZ[] = [[mm(ctrl[0][0]), mm(ctrl[0][1])]];
  const P = (i: number): XZ => i < 0 ? [2 * ctrl[0][0] - ctrl[1][0], 2 * ctrl[0][1] - ctrl[1][1]]
    : i >= n ? [2 * ctrl[n - 1][0] - ctrl[n - 2][0], 2 * ctrl[n - 1][1] - ctrl[n - 2][1]] : ctrl[i];
  for (let i = 0; i < n - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const knot = (a: XZ, b: XZ) => Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
    const t1 = knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
    const k = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let j = 1; j <= k; j++) {
      const t = t1 + (t2 - t1) * j / k, at = (c: 0 | 1) => {
        const a1 = ((t1 - t) * p0[c] + t * p1[c]) / t1, a2 = ((t2 - t) * p1[c] + (t - t1) * p2[c]) / (t2 - t1), a3 = ((t3 - t) * p2[c] + (t - t2) * p3[c]) / (t3 - t2);
        const b1 = ((t2 - t) * a1 + t * a2) / t2, b2 = ((t3 - t) * a2 + (t - t1) * a3) / (t3 - t1);
        return ((t2 - t) * b1 + (t - t1) * b2) / (t2 - t1);
      };
      out.push(j === k ? [mm(p2[0]), mm(p2[1])] : [mm(at(0)), mm(at(1))]);
    }
  }
  return out;
}
const way = (id: string, width: number, ctrl: readonly XZ[], step = 2.6): FrostWay => ({ id, width, points: spline(ctrl, step) });

/** The aurora ridge's ring of standing stones, which the road runs through on x = 0 (frostThroneLayout.ts RIDGE). */
export const FROST_RING = { x: 0, z: -34, r: 9.6 } as const;
/** Where the high street leaves the village and the north road begins. */
export const FROST_GATE: XZ = [-0.6, 29.6];

/**
 * The high street: out of the arrival square, west round the market and the fountain, east again under the chapel's
 * rise, and out through the gate. The north road: out of the gate past the first guide lantern, round the eastern
 * shoulder past the second, back west past the third, and into the ring of standing stones. From the ring the
 * processional way runs straight to the arena gate, as an approach to a throne should.
 */
export const FROST_HIGH_STREET = way('high-street', 7, [[0.6, 80.5], [-1.6, 74.5], [-4.6, 67.5], [-5.2, 60], [-3.1, 53.4], [0.9, 47.2], [3.5, 40.6], [2.6, 34.4], FROST_GATE]);
export const FROST_NORTH_ROAD = way('north-road', 6.5, [FROST_GATE, [-2.6, 25.2], [-1.6, 19], [3, 12.6], [10.4, 7], [12.6, 0.8], [9.4, -7.8], [2.4, -14.8], [-2.4, -20.4], [-1.2, -24], [0, -26.5]], 2.4);
export const FROST_PROCESSION: FrostWay = { id: 'procession', width: 8, points: [[0, -26.5], [0, -53]] };
/** Lanes: to the chapel on its rise, west out to the Frostpine Woods, east along the portal row. */
export const FROST_LANES: readonly FrostWay[] = [
  way('chapel-lane', 4, [[0.7, 48.6], [5.6, 48.7], [11, 47.7], [15.6, 46.7]]),
  way('woods-lane', 3.6, [[-19.6, 58.8], [-24.6, 53.4], [-29.6, 48.6], [-35, 44.2], [-39.4, 38.6]]),
  way('east-lane', 3.6, [[5.4, 79.6], [12.2, 76.4], [19.4, 73.8], [25.6, 70.4], [30.4, 65.4]]),
];
/** Paved squares: the arrival square between the two portals, and the market round the frozen fountain. */
export const FROST_PADS: readonly FrostPad[] = [
  { id: 'arrival', x: 0.4, z: 85.2, r: 8 },
  { id: 'arrival-west', x: -9.6, z: 88.6, r: 4.8 },
  { id: 'arrival-east', x: 12.4, z: 84.6, r: 4.6 },
  { id: 'market', x: -13.6, z: 64.6, r: 9 },
  { id: 'market-west', x: -19.6, z: 61, r: 5 },
];

/** Every paved way, village first. */
export const FROST_WAYS: readonly FrostWay[] = [FROST_HIGH_STREET, ...FROST_LANES, FROST_NORTH_ROAD, FROST_PROCESSION];
/** The ways outside the village, which keep the old ground under them (snowKeep). */
export const FROST_ROAD_WAYS: readonly FrostWay[] = [FROST_NORTH_ROAD, FROST_PROCESSION];
/** How far past a road's paved edge the old ground holds before the snowfield's relief fades in. */
export const FROST_ROAD_SHOULDER = 2;

/** Distance from (x, z) to the segment a-b. The GLSL twin computes it the same way. */
export function segDist(ax: number, az: number, bx: number, bz: number, x: number, z: number): number {
  const dx = bx - ax, dz = bz - az, px = x - ax, pz = z - az, l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.min(1, Math.max(0, (px * dx + pz * dz) / l2)) : 0;
  const ex = px - dx * t, ez = pz - dz * t;
  return Math.sqrt(ex * ex + ez * ez);
}
/** Distance from (x, z) to a way's centreline. */
export function wayDist(w: FrostWay, x: number, z: number): number {
  let d = Infinity;
  for (let k = 1; k < w.points.length; k++) { const a = w.points[k - 1], b = w.points[k]; d = Math.min(d, segDist(a[0], a[1], b[0], b[1], x, z)); }
  return d;
}
/** Signed distance to the paved ground (ways and squares), metres; negative on the stones. */
export function frostPavedDist(x: number, z: number): number {
  let d = Infinity;
  for (const w of FROST_WAYS) d = Math.min(d, wayDist(w, x, z) - w.width / 2);
  for (const p of FROST_PADS) d = Math.min(d, Math.hypot(x - p.x, z - p.z) - p.r);
  return d;
}
/** Past this box (x0, z0, x1, z1) the roads are at least 12 m beyond their shoulder, so snowKeep() is 1 anyway. */
export const FROST_ROAD_BOX: readonly [number, number, number, number] = (() => {
  const pts = FROST_ROAD_WAYS.flatMap((w) => w.points), m = Math.max(...FROST_ROAD_WAYS.map((w) => w.width / 2)) + FROST_ROAD_SHOULDER + 12;
  return [mm(Math.min(...pts.map((p) => p[0])) - m), mm(Math.min(...pts.map((p) => p[1])) - m), mm(Math.max(...pts.map((p) => p[0])) + m), mm(Math.max(...pts.map((p) => p[1])) + m)];
})();
/**
 * Signed distance to the band of old ground the roads outside the village keep (paved edge plus the shoulder);
 * 1000 well past it. The GLSL twin (snowTerrain.ts) loops over the same segments.
 */
export function frostRoadKeepDist(x: number, z: number): number {
  const b = FROST_ROAD_BOX;
  if (x < b[0] || z < b[1] || x > b[2] || z > b[3]) return 1e3;
  let d = 1e3;
  for (const w of FROST_ROAD_WAYS) {
    const k = w.width / 2 + FROST_ROAD_SHOULDER, p = w.points;
    for (let i = 1; i < p.length; i++) d = Math.min(d, segDist(p[i - 1][0], p[i - 1][1], p[i][0], p[i][1], x, z) - k);
  }
  return d;
}
/** Distance to the centreline of the roads outside the village, minus their half width (for the field dressing). */
export function frostRoadEdgeDist(x: number, z: number): number {
  let d = Infinity;
  for (const w of FROST_ROAD_WAYS) d = Math.min(d, wayDist(w, x, z) - w.width / 2);
  return d;
}

/**
 * The residents, in NPC_ORDER (brinebeard, silvermoon, coralline, grukk, hoofclaw, rattlebolt, pip), each where
 * their trade lives, and the way each faces (yaw of +z, radians).
 */
const npc = (x: number, z: number, tx: number, tz: number) => ({ x, z, yaw: Math.atan2(tx - x, tz - z) });
export const FROST_NPCS: readonly { readonly x: number; readonly z: number; readonly yaw: number }[] = [
  // Brinebeard keeps the relief stores by the fountain, watching the high street for arrivals.
  npc(-8.9, 63.2, -2, 76),
  // Silvermoon reads the aurora from the chapel steps.
  npc(15.2, 44.6, 1, 48),
  // Coralline keeps the healer's house on the market's north side.
  npc(-16.4, 76.2, -13, 65),
  // Grukk keeps the gate, eyes on the north road.
  npc(-3.8, 31.4, -1.6, 19),
  // Hoofclaw ladles soup from the market cauldron.
  npc(-25.8, 60.2, -13, 62),
  // Rattlebolt trims the lanterns at the foot of the gate's watchtower, where the road leaves the village.
  npc(3.2, 30, -2.6, 22),
  // Pip works the anvil in the forge yard.
  npc(10.2, 34.6, 2.6, 34.4),
];
/** Where the townsfolk mill about: the squares, the high street and the lanes. */
export const FROST_TOWN_POINTS: readonly XZ[] = [[-6.4, 86.4], [-8, 68.2], [4.4, 82.4], [-1.6, 56.6], [8.6, 48.2], [-18.4, 62.6], [1.8, 41.6]];
/** The village's points of interest (server and client POIs). */
export const FROST_POIS = { forge: [13.6, 34.6], chapel: [17.4, 46.2], tavern: [-23.4, 67.6] } as const;
