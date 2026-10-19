// Where Tidecrown is paved: the King's Way, the gate court, the market square, the keep's court and a few streets
// in cobble; the forest road in dirt until it nears the bridge. Shared by the terrain splat and the scatter.
import { polylineNearest, TC_KEEP, TC_ROAD, TC_ROAD_COBBLE_FROM, TC_T, tcAxis, tcAxisCoords } from '../../sim/world/tidecrownGround';

type V2 = [number, number];
const smoothstep = (x: number, a: number, b: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Cobbled streets off the King's Way: west from the market, east to the harbour quay, the quay itself. */
export const TC_STREETS: { points: V2[]; width: number }[] = [
  { points: [tcAxis(TC_T.market, -28), [10, 52], [-40, 44], [-96, 36], [-132, 30]], width: 7 },
  { points: [tcAxis(TC_T.market, 28), [128, 76], [168, 58], [196, 34], [214, 22]], width: 7 },
  { points: [[200, 50], [212, 20], [206, -6], [216, -48]], width: 9 },
];
const ROAD_DIRT = TC_ROAD.slice(0, TC_ROAD_COBBLE_FROM + 1);
const ROAD_COBBLE = TC_ROAD.slice(TC_ROAD_COBBLE_FROM);
const q = { d: 0, seg: 0, t: 0 };

export interface Paving {
  /** 0..1 stone setts. */
  cobble: number;
  /** 0..1 packed earth. */
  dirt: number;
  /** Distance to the nearest paved edge or road (negative on it). */
  clear: number;
}

/** Paving weights and clearance at a world point. */
export function tcPaving(x: number, z: number, out: Paving = { cobble: 0, dirt: 0, clear: 0 }): Paving {
  const [t, s] = tcAxisCoords(x, z);
  let cobble = 0, dirt = 0, clear = Infinity;
  const take = (d: number, half: number, kind: 'c' | 'd') => {
    const w = 1 - smoothstep(d, half - 0.8, half + 0.6);
    if (kind === 'c') cobble = Math.max(cobble, w); else dirt = Math.max(dirt, w);
    clear = Math.min(clear, d - half);
  };
  // King's Way from the gate to the stair, and the bridgeheads.
  if (t > -124 && t < 172) take(Math.abs(s), t < -96 ? 10 : t < 0 ? 7 : 6.5, 'c');
  // Gate court.
  if (t > -16 && t < 30) take(Math.max(Math.abs(s) - 20, t - 24, -10 - t), 0, 'c');
  // Market square.
  const [mx, mz] = tcAxis(TC_T.market);
  take(Math.hypot(x - mx, z - mz), 30, 'c');
  // Landing at the stair head and the keep's court.
  if (t > TC_T.stairTop - 8 && t < 256) take(Math.max(Math.abs(s) - (t > TC_T.wardGate ? 13 : 10), TC_T.stairTop - 4 - t, t - 252), 0, 'c');
  const kd = Math.hypot(x - TC_KEEP.x, z - TC_KEEP.z);
  if (kd < 60) take(kd - 46, 0, 'c');
  for (const st of TC_STREETS) {
    polylineNearest(x, z, st.points, q);
    take(q.d, st.width / 2, 'c');
  }
  // The forest road: earth through the woods, setts for its last stretch down to the bridge.
  if (x > -90 && x < 70 && z > 205 && z < 345) {
    polylineNearest(x, z, ROAD_DIRT, q);
    take(q.d, 3.2 + 0.4 * Math.sin(q.seg * 1.7 + q.t * 3), 'd');
    polylineNearest(x, z, ROAD_COBBLE, q);
    take(q.d, 3.4, 'c');
    // The overlook shelf.
    const [cx, cz] = tcAxis(TC_T.crest);
    take(Math.hypot(x - cx, z - cz), 5.5, 'd');
  }
  out.cobble = cobble;
  out.dirt = dirt * (1 - cobble);
  out.clear = clear;
  return out;
}
