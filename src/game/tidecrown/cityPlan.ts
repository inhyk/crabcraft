// Tidecrown's districts as numbers: streets, house zones, squares, gardens, landmarks, the terrace walls and grand
// stairs, the harbour's quays, piers and ships, the canal walls and bridges, lamps and banners. No meshes and no kits:
// cityLayout.ts plans the houses and registers the collision from these, city.ts builds what they describe.
import { polyDistance, TC_AXIS, TC_CITY_WALL, TC_P, TC_T, TC_TERRACES, tcAxis, tcAxisCoords } from '../../sim/world/tidecrownGround';
import { canalDistance, TC_CANAL, TC_CANALS, type TcCanal } from '../../sim/world/tidecrownCity';

export type V2 = [number, number];
export type DistrictId = 'market' | 'works' | 'cathedral' | 'seaglass' | 'canal' | 'harbour' | 'upper';
export const TC_DISTRICTS: Record<DistrictId, { ko: string; en: string }> = {
  market: { ko: '탈피 시장', en: 'Moult Market' },
  works: { ko: '따개비 공방', en: 'Barnacle Works' },
  cathedral: { ko: '조수 대성당', en: 'Cathedral of the Tide' },
  seaglass: { ko: '바다유리 구역', en: 'Seaglass Quarter' },
  canal: { ko: '운하 구역', en: 'Canal Quarter' },
  harbour: { ko: '왕관 항구', en: 'Crown Harbour' },
  upper: { ko: '윗마을', en: 'Upper Town' },
};

const A = (t: number, s = 0): V2 => tcAxis(t, s);
/** Yaw that turns a piece's local +Z toward (dx, dz). */
export const facing = (dx: number, dz: number) => Math.atan2(dx, dz);
/** Yaw that lays a piece's local +X along (dx, dz). */
export const along = (dx: number, dz: number) => Math.atan2(-dz, dx);
/** Toward the keep along the axis, and its opposite (the gate and the ridge). */
export const TC_UP_YAW = facing(TC_AXIS.ux, TC_AXIS.uz);
export const TC_DOWN_YAW = facing(-TC_AXIS.ux, -TC_AXIS.uz);

/** The market square on the King's Way: centre and paved radius (the ground is flat to 30). */
export const TC_MARKET = { centre: A(TC_T.market), r: 30 } as const;
const circle = (c: V2, r: number, n = 24, a0 = 0): V2[] => Array.from({ length: n }, (_, i) => [c[0] + Math.cos(a0 + (i / n) * Math.PI * 2) * r, c[1] + Math.sin(a0 + (i / n) * Math.PI * 2) * r] as V2);
/** A box in a frame: centre, half extents along its local x and z, yaw (rotation.y). */
export const quad = (x: number, z: number, hx: number, hz: number, yaw: number): V2[] => {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [[-hx, hz], [hx, hz], [hx, -hz], [-hx, -hz]].map(([lx, lz]) => [x + c * lx + s * lz, z - s * lx + c * lz] as V2);
};
/** A box in axis coordinates: t0..t1 along the axis, s0..s1 across. */
const axisQuad = (t0: number, t1: number, s0: number, s1: number): V2[] => [A(t0, s0), A(t1, s0), A(t1, s1), A(t0, s1)];

// ------------------------------------------------------------------------------------------------
// Landmarks (tidecrown-city.glb, Y up, origin at the ground centre, front +Z)

export interface Landmark {
  id: string;
  piece: string;
  x: number;
  z: number;
  yaw: number;
  scale: number;
  district: DistrictId;
  /** Collision boxes in the piece's frame (scaled): [lx, lz, hx, hz, y0, y1]. */
  solids: [number, number, number, number, number, number][];
  /** Ground kept clear of houses around it (grown footprint, world). */
  keep: V2[];
}

const lm = (id: string, piece: string, district: DistrictId, x: number, z: number, yaw: number, scale: number, solids: Landmark['solids'], keep: [number, number, number, number]): Landmark => ({
  id, piece, district, x, z, yaw, scale, solids,
  keep: quad(x + Math.cos(yaw) * keep[0] * scale + Math.sin(yaw) * keep[1] * scale, z - Math.sin(yaw) * keep[0] * scale + Math.cos(yaw) * keep[1] * scale, keep[2] * scale, keep[3] * scale, yaw),
});

const FOUNTAIN_AT = A(TC_T.market, -15.5);
const ARCADE_AT = A(TC_T.market, 18.5);
/** The cathedral faces south across its parvis, high on the middle terrace above the lower town. */
const CATHEDRAL = { x: -31, z: -42.5, yaw: 0 } as const;
const SEAGLASS = { x: -66, z: -122 } as const;
const FORGE = { x: -90, z: 21.5, yaw: 0 } as const;

export const TC_LANDMARKS: Landmark[] = [
  lm('fountain', 'TC_Fountain', 'market', ...FOUNTAIN_AT, TC_UP_YAW, 1, [[0, 0, 7.4, 7.4, -1, 3.2], [0, 0, 1.6, 1.6, 0, 9.9]], [0, 0, 9.4, 9.4]),
  lm('arcade', 'TC_MarketArcade', 'market', ...ARCADE_AT, along(TC_AXIS.ux, TC_AXIS.uz), 1,
    // Open on every side: its piers and the stair to the gallery block, the floor is walked on.
    [[-10.1, -5.3, 0.6, 0.6, -1, 8], [-10.1, 5.3, 0.6, 0.6, -1, 8], [10.1, -5.3, 0.6, 0.6, -1, 8], [10.1, 5.3, 0.6, 0.6, -1, 8], [0, -5.3, 0.6, 0.6, -1, 8], [0, 5.3, 0.6, 0.6, -1, 8], [-5.05, -5.3, 0.5, 0.5, -1, 8], [5.05, -5.3, 0.5, 0.5, -1, 8], [-5.05, 5.3, 0.5, 0.5, -1, 8], [5.05, 5.3, 0.5, 0.5, -1, 8]],
    [0, 0, 12.2, 7.4]),
  lm('cathedral', 'TC_Cathedral', 'cathedral', CATHEDRAL.x, CATHEDRAL.z, CATHEDRAL.yaw, 1, [[0, -0.5, 14.3, 26.6, -2, 72], [0, 27.4, 6.2, 1.8, -2, 1.2]], [0, 1, 16.5, 30]),
  lm('seaglass', 'TC_SeaglassTower', 'seaglass', SEAGLASS.x, SEAGLASS.z, facing(1, 0.55), 1, [[0, 0, 7.2, 7.2, -2, 70]], [0, 0, 9, 9]),
  lm('seaglass-west', 'TC_SeaglassTower', 'seaglass', -102, -90, facing(1, -0.2), 0.62, [[0, 0, 7.2, 7.2, -2, 70]], [0, 0, 9, 9]),
  lm('seaglass-north', 'TC_SeaglassTower', 'seaglass', -34, -142, facing(-0.3, 1), 0.5, [[0, 0, 7.2, 7.2, -2, 70]], [0, 0, 9, 9]),
  lm('forge', 'TC_Forge', 'works', FORGE.x, FORGE.z, FORGE.yaw, 1, [[-1.5, -0.6, 15.5, 9.4, -2, 31], [14.85, -1, 1.6, 6.4, -2, 10.8]], [1, -3, 19.5, 13]),
  lm('upper-fountain', 'TC_Fountain', 'upper', 136, -4, TC_UP_YAW, 0.62, [[0, 0, 7.4, 7.4, -1, 3.2], [0, 0, 1.6, 1.6, 0, 9.9]], [0, 0, 9, 9]),
];
/** The forge's waterwheel on its race (TC_Forge anchors, piece frame). */
export const TC_WATERWHEEL = { x: FORGE.x + 14.85, y: 5.4, z: FORGE.z - 1, yaw: FORGE.yaw, race: { x: [13.65, 16.05], z: [-7.25, 5.25], water: 0.6 } } as const;
export const TC_FORGE = FORGE;
export const TC_CATHEDRAL = CATHEDRAL;

// ------------------------------------------------------------------------------------------------
// Streets: carriageways (cobbled, kept clear) that the townhouses line, plus the canals they face

export interface CityStreet {
  id: string;
  points: V2[];
  /** Carriageway width; the houses stand a pavement (0.9) back from its edge. */
  width: number;
  district: DistrictId;
  /** Not paved (a canal, or the King's Way, which paving.ts already lays). */
  unpaved?: boolean;
  /** The district's main street: the QA walks it. */
  main?: boolean;
}

const ring = (c: V2, r: number, n: number): V2[] => [...circle(c, r, n), circle(c, r, n)[0]];

export const TC_CITY_STREETS: CityStreet[] = [
  // King's Way between the market and the middle ramp, and between the ramps on the middle terrace (the cypresses
  // stand in its margins).
  { id: 'kings-way-low', points: [A(91), A(101)], width: 24, district: 'market', unpaved: true },
  { id: 'kings-way-mid', points: [A(117), A(140)], width: 25, district: 'cathedral', unpaved: true },
  // The gate court, lined with houses on both sides.
  { id: 'gate-court', points: [A(3), A(29)], width: 40, district: 'market', unpaved: true },
  // Round the market square.
  { id: 'market-ring', points: ring(TC_MARKET.centre, 33.5, 28), width: 6, district: 'market' },
  // Tide Street west from the market to the forge and the west wall; Lantern Row along the south wall.
  { id: 'tide-street', points: [A(TC_T.market, -31), [10, 50], [-40, 43], [-96, 36.5], [-130, 31]], width: 7, district: 'works', main: true },
  { id: 'lantern-row', points: [[16, 100], [-40, 99], [-98, 91], [-126, 80]], width: 6, district: 'works' },
  { id: 'chandlers-lane', points: [[-12, 46.5], [-14, 98.5]], width: 5, district: 'market' },
  { id: 'smiths-lane', points: [[-62, 40], [-64, 95.5]], width: 5, district: 'works' },
  { id: 'cooper-lane', points: [[-112, 34], [-113, 85.5]], width: 5, district: 'works' },
  { id: 'cathedral-steps', points: [[-31, 21.6], [-31, 44.2]], width: 6, district: 'cathedral' },
  // Pearl Street east from the market over the canal to the sea gate; Quay Street inside the harbour wall.
  { id: 'pearl-street', points: [A(TC_T.market, 31), [128, 75.5], [168, 58], [192, 40], [203, 25], [207.5, 20.5]], width: 7, district: 'canal', main: true },
  // It bends in past the sea gate's north tower and the corner tower.
  { id: 'quay-street', points: [[200.5, 51], [206, 23], [201, 4], [198.5, -6], [200, -18], [203, -28]], width: 6, district: 'harbour', main: true },
  { id: 'salt-street', points: [[163.5, 73], [190, 69], [217, 65.5]], width: 5, district: 'canal' },
  // The canals, lined by their quays (fondamenta) and houses.
  { id: 'grand-canal', points: TC_CANALS[0].points.map(([x, z]) => [x, z] as V2), width: TC_CANALS[0].width + 2 * (TC_CANAL.wall + 3), district: 'canal', unpaved: true },
  { id: 'north-canal', points: TC_CANALS[1].points.map(([x, z]) => [x, z] as V2), width: TC_CANALS[1].width + 2 * (TC_CANAL.wall + 2.5), district: 'canal', unpaved: true },
  // Middle terrace: Cathedral Street from the square to the King's Way, Terrace Street on to the harbour's corner.
  { id: 'cathedral-street', points: [[-118, -15], [-54, -10.5]], width: 6, district: 'cathedral' },
  { id: 'shell-street', points: [[-93, -13.2], [-96, -48], [-104, -80]], width: 6, district: 'cathedral' },
  { id: 'mercers-row', points: [[-58, -46], [-93.4, -46]], width: 5, district: 'cathedral' },
  { id: 'chapter-street', points: [[-8, -12], [30, -9], [80, 1.5], A(128, -13)], width: 6, district: 'cathedral', main: true },
  { id: 'terrace-street', points: [A(128, 13), [140, 27], [176, 18], [192, -4]], width: 6, district: 'canal' },
  // Seaglass Quarter: Glass Street from the cathedral square north round the towers.
  { id: 'glass-street', points: [[-58, -14], [-58, -70], [-60, -100], [-86, -112], [-100, -107.5]], width: 6, district: 'seaglass', main: true },
  { id: 'prism-lane', points: [[-48, -122], [-24, -132], [-6, -146]], width: 5, district: 'seaglass' },
  { id: 'kiln-lane', points: [[-58, -86], [-16, -91]], width: 5, district: 'seaglass' },
  { id: 'crystal-walk', points: [[-62, -138], [-48, -152], [-20, -161], [14, -168]], width: 5, district: 'seaglass' },
  // Upper Town: Noble Street along the keep rock, through the stair-foot plaza.
  { id: 'noble-street-west', points: [[20, -150], [18, -120], [30, -90], [54, -62], [78, -44], A(158, -15)], width: 7, district: 'upper', main: true },
  { id: 'stair-lane', points: [[45, -40.5], [62, -56]], width: 5, district: 'upper' },
  { id: 'rim-walk', points: [[46, -150], [50, -120], [56, -100], [70, -82], [92, -66]], width: 5, district: 'upper' },
  { id: 'noble-street-east', points: [A(158, 15), [140, -24], [168, -22], [190, -30]], width: 7, district: 'upper' },
];
export const streetById = (id: string) => TC_CITY_STREETS.find((s) => s.id === id)!;

// ------------------------------------------------------------------------------------------------
// Squares and gardens (paved or planted, kept free of houses)

export const TC_SQUARES: { id: string; poly: V2[]; district: DistrictId }[] = [
  { id: 'market', poly: circle(TC_MARKET.centre, TC_MARKET.r + 0.5, 32), district: 'market' },
  // The cathedral's parvis on the terrace's brink, the grand stair down from its middle.
  { id: 'parvis', poly: [[-54, -13], [-8, -13], [-8, 6.5], [-54, 6.5]], district: 'cathedral' },
  { id: 'forge-yard', poly: [[-110, 6], [-66, 6], [-66, 33.5], [-110, 33.5]], district: 'works' },
  { id: 'glass-plaza', poly: circle([SEAGLASS.x, SEAGLASS.z], 15, 20), district: 'seaglass' },
  { id: 'stair-foot', poly: axisQuad(155, 167, -17, 17), district: 'upper' },
];
export const TC_GARDENS: { id: string; poly: V2[]; district: DistrictId }[] = [
  { id: 'keep-garden-east', poly: quad(136, -4, 15, 10, along(TC_P.x, TC_P.z)), district: 'upper' },
  { id: 'keep-garden-west', poly: quad(72, -24, 12, 9, along(TC_P.x, TC_P.z)), district: 'upper' },
  { id: 'glass-garden', poly: quad(-30, -104, 10, 8, 0.4), district: 'seaglass' },
];

// ------------------------------------------------------------------------------------------------
// House zones: one terrace level each (houses never straddle a terrace edge), grouped by district

export interface Zone {
  district: DistrictId;
  polygon: V2[];
  seed: number;
  floors?: [number, number];
}
/** Each district's house colours (houses.ts HOUSE_PALETTES). */
export const TC_PALETTES: Record<DistrictId, string | undefined> = { market: 'market', works: 'works', cathedral: undefined, seaglass: 'seaglass', canal: 'water', harbour: 'water', upper: 'upper' };
export const TC_ZONES: Zone[] = [
  { district: 'market', seed: 101, polygon: [[-40, 9], [17, 6], [76, 31], [112, 46], [112, 75], [96, 92], [96, 126], [58, 132], [22, 117], [-40, 128]] },
  { district: 'works', seed: 102, polygon: [[-136, 116], [-40, 128], [-40, 9], [-62, 10], [-118, -4], [-136, 0]] },
  { district: 'cathedral', seed: 103, floors: [2, 4], polygon: [[-124, -76], [-118, -6], [-62, 8], [16.8, 4.8], A(104, -14), A(152, -14), [47.5, -28.8], [-6, -60], [-14, -76]] },
  { district: 'seaglass', seed: 104, floors: [3, 4], polygon: [[-124, -76], [-14, -76], [-18, -100], [6, -150], [60, -188], [60, -199], [-28, -177], [-92, -137]] },
  { district: 'canal', seed: 105, polygon: [[112, 46], [145.4, 60.1], [186, 34], [200, 44], [226, 58], [250, 80], [236, 106], [176, 122], [120, 124], [96, 130], [96, 92], [112, 75]] },
  { district: 'canal', seed: 106, floors: [2, 4], polygon: [A(104, 14), [145.4, 60.1], [186, 34], [192, -20], [196, -36], [148.6, 14.6], A(152, 14)] },
  { district: 'harbour', seed: 107, floors: [2, 3], polygon: [[186, 34], [200, 44], [222, 52], [208, -5], [222, -60], [206, -62], [192, -20]] },
  { district: 'upper', seed: 108, floors: [3, 4], polygon: [[-6, -60], [-18, -100], [6, -150], [60, -188], [72, -184], [64.6, -167.2], [58.6, -149.6], [56.3, -131], [59.2, -112.5], [67.4, -95.8], [79.1, -82], [92.7, -71.1], [106.7, -62.7], [120.6, -55.8], [134.4, -49.8], [148.7, -44.1], [164, -39.3], [180.7, -36], [198.7, -35.6], [196, -36], [148.6, 14.6], [47.5, -28.8]] },
];

// ------------------------------------------------------------------------------------------------
// Terrace retaining walls and grand stairs

/** TC_RetainingWall_12 (tools/tidecrown-city-pieces.json): 12 long, top 8, front face 0.8 before its origin. */
export const TC_RETAINING = { len: 12, top: 8, face: 0.8, back: 1.1 } as const;
/** TC_Stair_8: 8 up over 16 back (-Z), 6.6 walkable. */
export const TC_STAIR = { rise: 8, run: 16, walk: 6.6, width: 8.05 } as const;

export interface GrandStair {
  id: string;
  /** Foot (centre of the bottom step's front) and the yaw that faces the climber's back (local -Z climbs). */
  x: number;
  z: number;
  yaw: number;
  /** Base level, and scale (x widens the flight, y the rise, z the run). */
  y: number;
  sx: number;
  sy: number;
  sz: number;
  district: DistrictId;
}
/**
 * A grand stair up a terrace edge: which outline (middle or upper), which of its edges and how far along it (0..1),
 * and how wide. Its head lands 1.6 inside the edge, where the upper level is reached; it climbs straight in.
 */
function stairOn(id: string, level: 'middle' | 'upper', edge: number, f: number, sx: number, district: DistrictId): GrandStair {
  const poly = TC_TERRACES[level], n = poly.length;
  const a = poly[edge], b = poly[(edge + 1) % n];
  let area = 0;
  for (let i = 0; i < n; i++) area += poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1];
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), inward = area > 0 ? 1 : -1;
  // Inward normal (toward the higher level).
  const nx = (-dz / L) * inward, nz = (dx / L) * inward;
  const sy = level === 'middle' ? 1 : 1.25, run = TC_STAIR.run * sy;
  const hx = a[0] + dx * f + nx * 1.6, hz = a[1] + dz * f + nz * 1.6;
  return { id, x: hx - nx * run, z: hz - nz * run, yaw: facing(-nx, -nz), y: level === 'middle' ? 6 : 14, sx, sy, sz: sy, district };
}
export const TC_GRAND_STAIRS: GrandStair[] = [
  // From Tide Street up to the cathedral's parvis.
  stairOn('cathedral-stair', 'middle', 1, (-31 - -62) / (16.8 - -62), 1.5, 'cathedral'),
  // From Chapter Street up to Upper Town's south-west corner.
  stairOn('chapter-stair', 'upper', 0, 0.86, 1.1, 'upper'),
  // From Pearl Street up to Terrace Street.
  stairOn('pearl-stair', 'middle', 2, 0.865, 1.1, 'canal'),
];
/** Points where a grand stair meets a terrace edge (the walls leave a gap there). */
function stairGaps(): { x: number; z: number; r: number }[] {
  return TC_GRAND_STAIRS.map((s) => {
    const run = TC_STAIR.run * s.sz, c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    // Local (0, -run) is the stair's head; the edge lies 1.6 before it.
    const hx = s.x - sn * (run - 1.6), hz = s.z - c * (run - 1.6);
    return { x: hx, z: hz, r: (TC_STAIR.width * s.sx) / 2 + 0.6 };
  });
}

export interface RetainingWall {
  x: number;
  z: number;
  yaw: number;
  /** Stretch along the run and up. */
  sx: number;
  sy: number;
  /** Base level (the lower terrace) and the top. */
  y: number;
  top: number;
  /** End pier: drawn at the run's ends and corners. */
  pier?: boolean;
}

/**
 * Walls along each terrace edge inside the city: the front face a little below the edge's foot, stretched runs between
 * the outline's corners, piers at the corners. Gaps for the King's Way ramps, the grand stairs, the canal cascade, and
 * wherever the keep rock, the city wall or the sea comes too close.
 */
export function retainingWalls(height: (x: number, z: number) => number): { runs: RetainingWall[]; piers: { x: number; z: number; y: number; top: number }[] } {
  const runs: RetainingWall[] = [], piers: { x: number; z: number; y: number; top: number }[] = [];
  const gaps = stairGaps();
  const levels: [readonly (readonly [number, number])[], number, number][] = [[TC_TERRACES.middle, 6, 14], [TC_TERRACES.upper, 14, 24]];
  for (const [poly, lo, hi] of levels) {
    const n = poly.length;
    // Signed area: the outline's winding decides which side is inside.
    let area = 0;
    for (let i = 0; i < n; i++) area += poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1];
    const inward = area > 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
      // Outward normal (toward the lower ground), and the front face 1.8 out from the outline.
      const ox = uz * inward, oz = -ux * inward;
      const ok = (x: number, z: number) => {
        const [t, s] = tcAxisCoords(x, z);
        if (Math.abs(s) < 16 && (Math.abs(t - TC_T.middleRamp) < 18 || Math.abs(t - TC_T.upperRamp) < 18)) return false;
        if (gaps.some((g) => Math.hypot(x - g.x, z - g.z) < g.r)) return false;
        if (canalDistance(x, z) < 3) return false;
        if (polyDistance(x, z, TC_CITY_WALL) < 9) return false;
        // The keep rock: stop where the terrace's upper side is already the plateau or its cliff.
        const up = height(x - ox * 4, z - oz * 4), down = height(x + ox * 4, z + oz * 4);
        if (up > hi + 2 || up < hi - 1.5 || down > lo + 1.5 || down < lo - 1.5) return false;
        return true;
      };
      // Sample the edge every metre; keep runs of good samples.
      const good: number[] = [];
      for (let k = 0; k <= Math.floor(L); k++) good.push(ok(a[0] + ux * k + ox * 1.8, a[1] + uz * k + oz * 1.8) ? 1 : 0);
      let k = 0;
      while (k < good.length) {
        if (!good[k]) { k++; continue; }
        let e = k;
        while (e + 1 < good.length && good[e + 1]) e++;
        const l0 = k, l1 = e, len = l1 - l0;
        if (len >= 5) {
          const m = Math.max(1, Math.round(len / TC_RETAINING.len)), seg = len / m;
          for (let j = 0; j < m; j++) {
            const lm0 = l0 + seg * (j + 0.5);
            const fx = a[0] + ux * lm0 + ox * 1.8, fz = a[1] + uz * lm0 + oz * 1.8;
            // Origin sits behind the front face.
            const x = fx - ox * TC_RETAINING.face, z = fz - oz * TC_RETAINING.face;
            const yaw = facing(ox, oz);
            const base = Math.min(height(fx + ox * 0.6, fz + oz * 0.6), lo + 0.2) - 0.25;
            runs.push({ x, z, yaw, sx: seg / TC_RETAINING.len, sy: (hi + 0.35 - base) / TC_RETAINING.top, y: base, top: hi + 0.35 });
          }
          for (const lp of [l0, l1]) {
            const fx = a[0] + ux * lp + ox * 1.8, fz = a[1] + uz * lp + oz * 1.8;
            piers.push({ x: fx - ox * 0.6, z: fz - oz * 0.6, y: lo - 0.3, top: hi + 1.2 });
          }
        }
        k = e + 1;
      }
    }
  }
  return { runs, piers };
}

// ------------------------------------------------------------------------------------------------
// Harbour: the upper quay outside the wall, its stepped landings, the piers, two ships, the crane and cargo

/** The quay wall's outer edge (harbour polygon's west side), south to north. */
const QUAY_LINE: V2[] = [[224, 54], [210, -5], [224, -62]];
export const TC_HARBOUR_LEVEL = { quay: 6, pier: 3 } as const;
export interface HarbourPiece {
  piece: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** A walkable top: half extents in the piece frame and height (with slopes along local x and z for stairs and ramps). */
  walk?: { lx: number; lz: number; hx: number; hz: number; h: number; gx?: number; gz?: number };
  /** A plank ramp down from the quay (no kit piece): its length along local z, its width and drop. */
  ramp?: { len: number; w: number; drop: number };
  solids?: [number, number, number, number, number, number][];
}
export interface Ship {
  piece: string;
  x: number;
  z: number;
  yaw: number;
  /** Hull half extents (beam, length) for collision. */
  hx: number;
  hz: number;
  /** Gangplank: from the deck anchor (piece frame) down to the pier. */
  plank: [number, number, number];
  bob: number;
}

/**
 * Harbour placements: a quay of two rows of stone tiles 12.6 out from the shore (the inner row turned to the land, its
 * bollards against the wall), stepped landings at each pier, piers 3 above the sea, the crane and cargo on the outer
 * row; the walk along the quay keeps the inner row clear.
 */
export function harbourPlan(): { pieces: HarbourPiece[]; ships: Ship[]; crane: { x: number; z: number; yaw: number }; cargo: { x: number; y: number; z: number; yaw: number }[]; quayWalk: V2[] } {
  const pieces: HarbourPiece[] = [];
  const Q = TC_HARBOUR_LEVEL;
  // Along the south and middle reach of the quay line (north of z -45 the keep's cliff meets the sea).
  const [a, b, c] = QUAY_LINE;
  const tiles: { x: number; z: number; yaw: number; ux: number; uz: number; nx: number; nz: number }[] = [];
  const quayWalk: V2[] = [];
  const lay = (p: V2, q: V2, from: number, to: number) => {
    const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
    // East (seaward) normal.
    let nx = -uz, nz = ux;
    if (nx < 0) { nx = -nx; nz = -nz; }
    for (let s = from; s + 12 <= to + 0.01; s += 12) {
      const m = s + 6, x = p[0] + ux * m, z = p[1] + uz * m;
      tiles.push({ x: x + nx * 9.4, z: z + nz * 9.4, yaw: facing(nx, nz), ux, uz, nx, nz });
      // Its walk reaches back over the ledge to the wall's foot (and the sea gate's passage).
      pieces.push({ piece: 'TC_Quay_12_Plain', x: x + nx * 3.45, y: Q.quay, z: z + nz * 3.45, yaw: facing(-nx, -nz), walk: { lx: 0, lz: 1.45, hx: 6, hz: 4.5, h: Q.quay } });
      // Past the wall's towers (their drums stand out 5.6 from the shore).
      quayWalk.push([x + nx * 7.2, z + nz * 7.2]);
    }
  };
  // Whole tiles up to the corner at the sea gate's north (the south end is short of the basin's corner), then on.
  const L0 = Math.hypot(b[0] - a[0], b[1] - a[1]);
  lay(a, b, L0 - 48, L0);
  lay(b, c, 0, 36);
  // The corner: one more tile each row on the bisector closes the wedge between the two reaches.
  {
    const t0 = tiles[3], t1 = tiles[4], bx = t0.nx + t1.nx, bz = t0.nz + t1.nz, l = Math.hypot(bx, bz), nx = bx / l, nz = bz / l;
    pieces.push({ piece: 'TC_Quay_12_Plain', x: b[0] + nx * 9.4, y: Q.quay, z: b[1] + nz * 9.4, yaw: facing(nx, nz), walk: { lx: 0, lz: -0.2, hx: 6, hz: 3.2, h: Q.quay } });
    pieces.push({ piece: 'TC_Quay_12_Plain', x: b[0] + nx * 3.45, y: Q.quay, z: b[1] + nz * 3.45, yaw: facing(-nx, -nz), walk: { lx: 0, lz: 1.45, hx: 6, hz: 4.5, h: Q.quay } });
    quayWalk.splice(4, 0, [b[0] + nx * 7.2, b[1] + nz * 7.2]);
  }
  // Piers leave from tiles 2 (the long one) and 0 (south of it) down plank ramps; tiles 4 and 6 carry boat steps.
  const pierTiles = [2, 0];
  tiles.forEach((t, i) => {
    const stepped = i === 4 || i === 6;
    pieces.push({ piece: stepped ? 'TC_Quay_12' : 'TC_Quay_12_Plain', x: t.x, y: Q.quay, z: t.z, yaw: t.yaw, walk: { lx: 0, lz: -0.2, hx: 6, hz: 3.2, h: Q.quay } });
  });
  const ships: Ship[] = [];
  const piers: { x: number; z: number; len: number }[] = [];
  for (const [k, i] of pierTiles.entries()) {
    const t = tiles[i];
    // Piers run due east from the quay's face: a ramp of planks 9 long down to the deck, then the pier's tiles.
    const fx = t.x + t.nx * 3.1, fz = t.z + t.nz * 3.1, yaw = Math.PI / 2, ramp = 9, drop = Q.quay - Q.pier;
    pieces.push({ piece: '', x: fx + ramp / 2, y: Q.quay - drop / 2, z: fz, yaw, walk: { lx: 0, lz: 0, hx: 2.6, hz: ramp / 2 + 0.1, h: Q.quay - drop / 2, gz: -drop / ramp }, ramp: { len: ramp, w: 5.4, drop } });
    const len = k === 0 ? 40 : 30;
    for (let j = 0; j < len / 10; j++) pieces.push({ piece: 'TC_Pier_10', x: fx + ramp + 5 + j * 10, y: Q.pier, z: fz, yaw, walk: { lx: 0, lz: 0, hx: 2.6, hz: 5.0, h: Q.pier } });
    piers.push({ x: fx + ramp, z: fz, len });
  }
  // The galleon lies along the north side of the long pier, the cog along the south side of the short one (the crane
  // works the quay between them).
  const [p1, p2] = piers;
  ships.push({ piece: 'TC_Galleon', x: p1.x + 24, z: p1.z - 3.35 - 1.1 - 7.56, yaw: Math.PI / 2, hx: 7.2, hz: 17.6, plank: [-5.347, 2.7, 4.05], bob: 0.18 });
  ships.push({ piece: 'TC_Cog', x: p2.x + 21, z: p2.z + 3.35 + 1.1 + 5.86, yaw: Math.PI / 2, hx: 5.6, hz: 9.8, plank: [3.1593, 2, -2.8], bob: 0.25 });
  // The crane at the long pier's end swings its jib over the galleon; cargo along the quay's outer edge.
  const crane = { x: p1.x + p1.len - 3, z: p1.z, yaw: Math.PI };
  const cargo: { x: number; y: number; z: number; yaw: number }[] = [];
  for (const [i, off] of [[1, 1.5], [3, -2], [4, 1.5], [5, -2.5], [6, 2]] as const) {
    const t = tiles[i];
    if (!t) continue;
    cargo.push({ x: t.x + t.nx * 1.0 + t.ux * off, y: Q.quay, z: t.z + t.nz * 1.0 + t.uz * off, yaw: t.yaw + Math.PI / 2 });
  }
  cargo.push({ x: p2.x + p2.len - 4, y: Q.pier, z: p2.z, yaw: 0.3 });
  return { pieces, ships, crane, cargo, quayWalk: quayWalk.slice(1) };
}

// ------------------------------------------------------------------------------------------------
// Canals: walls, bridges, landings, gondolas

export interface CanalWall {
  /** Run along one side (the inner face's line), a to b, and which side the water lies on (unit normal toward it). */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  nx: number;
  nz: number;
}
/** The inner face of every canal wall, split where another canal's water opens into it. */
export function canalWalls(): CanalWall[] {
  const out: CanalWall[] = [];
  const w = TC_CANALS;
  const otherWater = (self: TcCanal, x: number, z: number) => w.some((c) => c !== self && canalDistanceOf(c, x, z) < -0.05);
  for (const c of w) {
    const pts = c.points, half = c.width / 2;
    // Both sides of every segment, then the two square ends.
    const lines: [number, number, number, number, number, number][] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
      // Extend inner joints by the mitre so the sides meet.
      const e0 = i === 0 ? 0 : half * 0.5, e1 = i === pts.length - 2 ? 0 : half * 0.5;
      for (const sd of [1, -1]) {
        const nx = -uz * sd, nz = ux * sd;
        lines.push([ax - ux * e0 + nx * half, az - uz * e0 + nz * half, bx + ux * e1 + nx * half, bz + uz * e1 + nz * half, -nx, -nz]);
      }
    }
    for (const [i, j] of [[0, 1], [pts.length - 1, pts.length - 2]]) {
      const [ex, ez] = pts[i], [qx, qz] = pts[j], L = Math.hypot(ex - qx, ez - qz), ux = (ex - qx) / L, uz = (ez - qz) / L;
      const px = -uz, pz = ux;
      lines.push([ex + px * half, ez + pz * half, ex - px * half, ez - pz * half, -ux, -uz]);
    }
    for (const [ax, az, bx, bz, nx, nz] of lines) {
      const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / 0.5));
      let run: number | null = null;
      for (let k = 0; k <= n; k++) {
        const f = k / n, x = ax + (bx - ax) * f, z = az + (bz - az) * f;
        const open = otherWater(c, x - nx * 0.6, z - nz * 0.6);
        if (!open && run === null) run = f;
        if ((open || k === n) && run !== null) {
          const f1 = open ? (k - 1) / n : f;
          if ((f1 - run) * L > 0.4) out.push({ ax: ax + (bx - ax) * run, az: az + (bz - az) * run, bx: ax + (bx - ax) * f1, bz: az + (bz - az) * f1, nx, nz });
          run = null;
        }
      }
    }
  }
  return out;
}
function canalDistanceOf(c: TcCanal, x: number, z: number): number {
  let d = Infinity;
  const pts = c.points;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
    d = Math.min(d, Math.hypot(x - ax - ex * t, z - az - ez * t));
  }
  return d - c.width / 2;
}

export interface CanalBridge {
  x: number;
  z: number;
  /** Yaw of the crossing (local +Z runs across the canal). */
  yaw: number;
  /** Deck half width and half length (across the canal, ramps included); crown above the street; each ramp's length
   * (from the coping's outer edge plus a step onto the quay up to the crown over the water). */
  hw: number;
  hl: number;
  crown: number;
  ramp: number;
  /** Clear span between the wall faces. */
  span: number;
}
/** Footbridges: where Pearl Street crosses the branch canal, and three along the Grand Canal. */
export function canalBridges(): CanalBridge[] {
  const out: CanalBridge[] = [];
  const across = (c: TcCanal, seg: number, f: number, hw: number) => {
    const [ax, az] = c.points[seg], [bx, bz] = c.points[seg + 1];
    const x = ax + (bx - ax) * f, z = az + (bz - az) * f;
    const dx = bx - ax, dz = bz - az;
    // Local +Z perpendicular to the canal. The crown clears a gondola (its prow 2.9 above the water).
    const hl = c.width / 2 + TC_CANAL.wall + 1.2;
    out.push({ x, z, yaw: facing(-dz, dx), hw, hl, crown: 1.5, ramp: hl - c.width / 2 - 0.3, span: c.width });
  };
  across(TC_CANALS[0], 1, 0.45, 2.4);
  across(TC_CANALS[0], 2, 0.5, 2.4);
  across(TC_CANALS[0], 3, 0.55, 2.4);
  // The Grand Canal's north quay over the branch canal's mouth (where the quay's walk, 7 off the canal's line, meets it).
  {
    const [[ax, az], [bx, bz]] = TC_CANALS[1].points, L = Math.hypot(bx - ax, bz - az), along = 5.3;
    const hl = TC_CANALS[1].width / 2 + TC_CANAL.wall + 1.2;
    out.push({ x: ax + ((bx - ax) / L) * along, z: az + ((bz - az) / L) * along, yaw: facing((bz - az) / L, -(bx - ax) / L), hw: 2.2, hl, crown: 1.2, ramp: hl - TC_CANALS[1].width / 2 - 0.3, span: TC_CANALS[1].width });
  }
  // Pearl Street over the branch canal (square to the canal, wide enough for the street's skew).
  const [[ax, az], [bx, bz]] = TC_CANALS[1].points, cz = 62.6, f = (cz - az) / (bz - az), L = Math.hypot(bx - ax, bz - az);
  const hl = TC_CANALS[1].width / 2 + TC_CANAL.wall + 1.2;
  out.push({ x: ax + (bx - ax) * f, z: cz, yaw: facing((bz - az) / L, -(bx - ax) / L), hw: 4.6, hl, crown: 0.9, ramp: hl - TC_CANALS[1].width / 2 - 0.3, span: TC_CANALS[1].width });
  return out;
}

/** Gondolas: moored at the market basin and along the Grand Canal, one gliding to and fro. */
export function gondolaPlan(): { moored: { x: number; z: number; yaw: number }[]; route: V2[] } {
  const c = TC_CANALS[0];
  const moored: { x: number; z: number; yaw: number }[] = [];
  const at = (seg: number, f: number, side: number) => {
    const [ax, az] = c.points[seg], [bx, bz] = c.points[seg + 1], L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
    const off = c.width / 2 - 1.15;
    moored.push({ x: ax + (bx - ax) * f - uz * off * side, z: az + (bz - az) * f + ux * off * side, yaw: facing(ux, uz) + (side > 0 ? 0.04 : Math.PI - 0.04) });
  };
  at(0, 0.45, 1);
  at(0, 0.8, -1);
  at(1, 0.15, 1);
  at(2, 0.75, -1);
  at(3, 0.3, 1);
  return { moored, route: c.points.slice(1, 4).map(([x, z]) => [x, z] as V2) };
}

// ------------------------------------------------------------------------------------------------
// Dressing: what the squares, the forge yard and the quays are furnished with

export interface Prop {
  kit: 'props' | 'nature';
  piece: string;
  x: number;
  z: number;
  yaw: number;
  s: number;
  /** Collider half size (0: walk through it). */
  solid: number;
}
export interface Planter {
  x: number;
  z: number;
  yaw: number;
  /** Half extents of the stone box. */
  hx: number;
  hz: number;
  /** What grows in it (a nature kit piece) and its scale. */
  plant: string;
  s: number;
}

/**
 * The squares and yards: benches round the parvis and the glass plaza, planters with trees in the gate court and at
 * the foot of the King's Way's ramp, the forge yard's anvils, benches and stock, the quays' barrels, crates, rope and
 * chain.
 */
export function dressingPlan(): { props: Prop[]; planters: Planter[] } {
  const props: Prop[] = [], planters: Planter[] = [];
  const prop = (kit: Prop['kit'], piece: string, x: number, z: number, yaw: number, s = 1, solid = 0) => props.push({ kit, piece, x, z, yaw, s, solid });
  const frame = (x: number, z: number, yaw: number) => (lx: number, lz: number): [number, number] => [x + Math.cos(yaw) * lx + Math.sin(yaw) * lz, z - Math.sin(yaw) * lx + Math.cos(yaw) * lz];
  // Parvis: benches along its east and west sides facing in, planters at the corners of the stair head.
  for (const z of [-8, -2.5, 3]) {
    prop('props', 'Bench', -51.5, z, Math.PI / 2, 1, 0.55);
    prop('props', 'Bench', -10.5, z, -Math.PI / 2, 1, 0.55);
  }
  for (const x of [-42, -20]) planters.push({ x, z: 3.4, yaw: 0, hx: 1.6, hz: 1.6, plant: 'Bush_Common_Flowers', s: 1.1 });
  // Glass plaza: four benches round the tower, facing it.
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.95, x = SEAGLASS.x + Math.cos(a) * 11.6, z = SEAGLASS.z + Math.sin(a) * 11.6;
    prop('props', 'Bench', x, z, facing(SEAGLASS.x - x, SEAGLASS.z - z), 1, 0.55);
  }
  // Gate court: two pairs of tree planters either side of the way in.
  for (const t of [7, 19]) for (const sd of [-1, 1]) {
    const [x, z] = A(t, sd * 15);
    planters.push({ x, z, yaw: TC_UP_YAW, hx: 2.2, hz: 2.2, plant: 'CommonTree_4', s: 0.8 });
  }
  // The foot of the King's Way's ramp up from the market.
  for (const sd of [-1, 1]) { const [x, z] = A(101, sd * 9.4); planters.push({ x, z, yaw: TC_UP_YAW, hx: 1.4, hz: 1.4, plant: 'Bush_Common_Flowers', s: 1.0 }); }
  // Forge yard: anvils before the arch, a bench and racks along the front, stock in the corners.
  const f = frame(FORGE.x, FORGE.z, FORGE.yaw);
  for (const [lx, lz, piece, s, yaw, solid] of [
    [-3.2, 11.4, 'Anvil_Log', 1.3, 0.3, 0.7], [3.4, 11.6, 'Anvil_Log', 1.3, -0.4, 0.7], [-1.2, 10.4, 'Cauldron', 1.2, 0, 0.6],
    [-9.5, 11.5, 'Workbench', 1.2, 0, 0.9], [9.6, 11.4, 'WeaponStand', 1.2, Math.PI, 0.6], [-13.5, 10.8, 'Barrel', 1.1, 0.4, 0.5],
    [-14.6, 11.6, 'Barrel', 1.1, 1.1, 0.5], [12.5, 11.8, 'Crate_Metal', 1.1, 0.2, 0.6], [6.8, 11.2, 'Whetstone', 1.2, 0.5, 0.5],
    [-6, 11.8, 'Chain_Coil', 1.1, 0.3, 0], [0.6, 12.4, 'Bucket_Metal', 1.1, 0, 0], [-16, 7.5, 'Crate_Wooden', 1.2, 0.2, 0.6],
  ] as const) {
    const [x, z] = f(lx, lz);
    prop('props', piece, x, z, FORGE.yaw + yaw, s, solid);
  }
  // The harbour's quay: barrels, crates, rope and chain by the cargo and at the ramps' heads.
  const hb = harbourPlan();
  hb.cargo.forEach((c, i) => {
    // Quay cargo only (its local z runs along the quay, x toward the land); the piers keep their decks clear.
    if (c.y !== TC_HARBOUR_LEVEL.quay) return;
    const g = frame(c.x, c.z, c.yaw);
    for (const [lx, lz, piece, yaw, solid] of [[0.6, 3.5, 'Barrel', 0.3, 0.5], [-0.9, 3.7, 'Barrel', 1.4, 0.5], [0.4, -3.6, i % 2 ? 'Rope_2' : 'Chain_Coil', 0, 0], [-1.0, -3.3, 'Crate_Wooden', 0.2, 0.6]] as const) {
      const [x, z] = g(lx, lz);
      prop('props', piece, x, z, c.yaw + yaw, 1.1, solid);
    }
  });
  return { props, planters };
}

// ------------------------------------------------------------------------------------------------
// Lamps and banners

/** Street lamps: both sides of the King's Way, round the squares, along the quays and canals. */
export function lampSpots(): { x: number; z: number; yaw: number }[] {
  const out: { x: number; z: number; yaw: number }[] = [];
  const kw = (t: number, side: number) => { const [x, z] = A(t, side * 8.6); out.push({ x, z, yaw: facing(-side * TC_P.x, -side * TC_P.z) }); };
  // Clear of the market ring where it crosses the King's Way (t 23.5..29.5 and 90.5..96.5).
  for (const t of [-4, 8, 19, 101, 110, 122, 132, 146]) for (const side of [-1, 1]) kw(t, side);
  // Market rim, skipping the four openings.
  const [mx, mz] = TC_MARKET.centre;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2 + 0.2, x = mx + Math.cos(a) * 28.6, z = mz + Math.sin(a) * 28.6;
    const [, s] = tcAxisCoords(x, z);
    if (Math.abs(s) < 9) continue;
    if (Math.abs(polylineDist(x, z, streetById('tide-street').points)) < 5 || Math.abs(polylineDist(x, z, streetById('pearl-street').points)) < 5) continue;
    out.push({ x, z, yaw: facing(mx - x, mz - z) });
  }
  // Parvis front, stair foot plaza, glass plaza.
  for (const x of [-50, -12]) out.push({ x, z: 4.2, yaw: Math.PI });
  for (const s of [-15, 15]) { const [x, z] = A(157, s); out.push({ x, z, yaw: TC_DOWN_YAW }); }
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + 0.5; out.push({ x: SEAGLASS.x + Math.cos(a) * 13.5, z: SEAGLASS.z + Math.sin(a) * 13.5, yaw: facing(-Math.cos(a), -Math.sin(a)) }); }
  // Canal quays.
  const c = TC_CANALS[0];
  for (let i = 0; i < c.points.length - 1; i++) {
    const [ax, az] = c.points[i], [bx, bz] = c.points[i + 1], L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
    for (let f = 9; f < L - 4; f += 17) {
      // Back by the house fronts, leaving the quay's walk clear.
      const side = (Math.round(f / 17) + i) % 2 ? 1 : -1, off = c.width / 2 + TC_CANAL.wall + 3;
      out.push({ x: ax + ux * f - uz * off * side, z: az + uz * f + ux * off * side, yaw: facing(uz * side, -ux * side) });
    }
  }
  return out;
}

/** Banner poles: pairs where the King's Way enters and leaves the market, tops its ramps, and at the stair foot. */
export function bannerPoleSpots(): { x: number; z: number; yaw: number }[] {
  const out: { x: number; z: number; yaw: number }[] = [];
  for (const t of [20.5, 99.5, 121, 140, 162]) for (const side of [-1, 1]) { const [x, z] = A(t, side * 10.2); out.push({ x, z, yaw: TC_DOWN_YAW }); }
  return out;
}

function polylineDist(x: number, z: number, pts: readonly (readonly number[])[]): number {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], az = pts[i][1], ex = pts[i + 1][0] - ax, ez = pts[i + 1][1] - az, l2 = ex * ex + ez * ez;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
    d = Math.min(d, Math.hypot(x - ax - ex * t, z - az - ez * t));
  }
  return d;
}
export { polylineDist };
