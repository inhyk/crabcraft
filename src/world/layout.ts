// Clawhaven and the Brine Shore: every coordinate in the zone lives here.
// Frame: x = east, z = south, y = up, sea level y = 0. One unit = one crab shell height (CRAB_HEIGHT).
// The town sits on a low plateau west of a bay; the Brine Shore runs north-south along the bay,
// the Saltmere headland closes it to the north and the Iron Wreck lies at its southern end.
import type { PoiId } from './types';

export type V2 = readonly [number, number];

/** Terrain grid. Vertices every STEP units over [minX, maxX] x [minZ, maxZ]. */
export const GRID = { minX: -230, maxX: 270, minZ: -250, maxZ: 250, step: 1 } as const;

export const SEA_LEVEL = 0;
export const TOWN_H = 4;
export const HEADLAND_H = 24;

/** Land is inside this loop (counter-clockwise in x/z). The bay is to the east. */
export const COAST: V2[] = [
  [-400, -400],
  [60, -400],
  [128, -260],
  [148, -188],
  [166, -168],
  [180, -150],
  [181, -132],
  [177, -116],
  [166, -102],
  [148, -94],
  [130, -84],
  [122, -64],
  [119, -36],
  [118, -6],
  [118, 24],
  [119, 52],
  [122, 80],
  [127, 104],
  [134, 126],
  [150, 146],
  [178, 156],
  [214, 162],
  [260, 174],
  [400, 190],
  [400, 400],
  [-400, 400],
];

/** The Saltmere headland: a high plateau with sea cliffs. Height falls off outside this loop. */
export const HEADLAND: V2[] = [
  [112, -150],
  [150, -176],
  [182, -150],
  [182, -116],
  [168, -98],
  [140, -90],
  [124, -96],
  [112, -118],
];

export const LIGHTHOUSE = {
  /** Tower centre on its sea stack. */
  x: 190,
  z: -132,
  stackTop: 4,
  stackRadius: 9,
  galleryY: 28.5,
  galleryOuter: 4.8,
  lanternRadius: 2.1,
  shaftBottomRadius: 3.4,
  shaftTopRadius: 2.6,
  /** Where the bridge leaves the headland. */
  bridgeFrom: [174.5, -126] as V2,
} as const;

const WRECK_BOW: V2 = [128, 109];
const WRECK_STERN: V2 = [180, 125];
export const WRECK = {
  bow: WRECK_BOW,
  stern: WRECK_STERN,
  /** Deck centre. */
  x: (WRECK_BOW[0] + WRECK_STERN[0]) / 2,
  z: (WRECK_BOW[1] + WRECK_STERN[1]) / 2,
  /** rotation.y that turns local +X (bow) toward the bow point. */
  rotY: Math.atan2(-(WRECK_BOW[1] - WRECK_STERN[1]), WRECK_BOW[0] - WRECK_STERN[0]),
  length: Math.hypot(WRECK_BOW[0] - WRECK_STERN[0], WRECK_BOW[1] - WRECK_STERN[1]),
  beam: 27,
  deckY: 3.4,
  /** Bow-up pitch, radians. Keeps the deck a single plane. */
  pitch: 0.035,
} as const;

export type RoadKind = 'cobble' | 'dirt' | 'sand';
export interface Road {
  kind: RoadKind;
  width: number;
  points: V2[];
  /** Optional explicit centre-line heights (one per point); otherwise the road follows the land. */
  heights?: number[];
}

export const ROADS: Road[] = [
  // East street from the square to the gate, then the dirt road down to the beach.
  { kind: 'cobble', width: 6, points: [[12, 1], [26, 3], [40, 3], [54, 1], [66, 0]] },
  { kind: 'dirt', width: 5, points: [[66, 0], [78, 3], [92, 9], [104, 14], [114, 17]] },
  // North street to the Chapel of the Tide.
  { kind: 'cobble', width: 5, points: [[0, -12], [0, -24], [0, -33]] },
  // West street past the Barnacle Forge, then the forest path to Moonpool Grove.
  { kind: 'cobble', width: 5, points: [[-12, -1], [-24, -4], [-38, -6]] },
  { kind: 'dirt', width: 4, points: [[-38, -6], [-50, 2], [-58, 16], [-64, 30], [-70, 40]] },
  // South street to The Molting Kettle.
  { kind: 'cobble', width: 5, points: [[0, 12], [-1, 22], [-2, 27]] },
  // Lighthouse path: leaves the beach road, climbs the headland flank as a ledge.
  {
    kind: 'dirt',
    width: 4.5,
    points: [[86, 6], [94, -16], [104, -40], [111, -62], [116, -82], [124, -100], [136, -110], [150, -114], [164, -118], [174, -125]],
    heights: [3.2, 3.0, 2.8, 6.0, 10.5, 15.0, 19.5, HEADLAND_H, HEADLAND_H, HEADLAND_H],
  },
  // Shore track along the dunes toward the wreck.
  { kind: 'sand', width: 4, points: [[114, 17], [114, 50], [118, 80], [124, 98]] },
];

/**
 * The King's Road: from the chapel plaza round the chapel, north through the pine woods, up the
 * gully and along the ridge to the King's Gate on World I's north edge, where the zone line to
 * Tidecrown crosses it. Control points carry explicit heights (grade at most 0.18, about 10 degrees);
 * the road is a Catmull-Rom curve through them. Cobbled through town, a kerbed dirt road after.
 * It is carved after every other feature (Terrain), so the rest of the world's scatter is unchanged.
 */
const KINGS_ROAD_CONTROL: readonly (readonly [number, number, number])[] = [
  [-3, -36, 4.42],
  [-9.5, -44.5, 4.5],
  [-11.2, -54, 4.5],
  [-13.5, -64, 4.45],
  [-19, -77, 4.6],
  [-25, -92, 5.8],
  [-29, -108, 7.8],
  [-32, -124, 10.5],
  [-36, -139, 13.2],
  [-35, -152, 15.2],
  [-29, -164, 17.5],
  [-24, -177, 20.0],
  [-22, -192, 22.6],
  [-26, -205, 25.0],
  [-36, -213, 27.4],
  [-48, -217, 29.6],
  [-57, -226, 30.9],
  [-60, -238, 31.6],
  [-60, -249, 31.8],
];

function catmullRom(ctrl: readonly (readonly [number, number, number])[], spacing: number) {
  const points: V2[] = [];
  const heights: number[] = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)];
    const p1 = ctrl[i];
    const p2 = ctrl[i + 1];
    const p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / spacing));
    for (let k = 0; k < n; k++) {
      const u = k / n;
      const f = (j: number) => 0.5 * (2 * p1[j] + (p2[j] - p0[j]) * u + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * u * u + (3 * p1[j] - p0[j] - 3 * p2[j] + p3[j]) * u * u * u);
      points.push([f(0), f(1)]);
      heights.push(f(2));
    }
  }
  const last = ctrl[ctrl.length - 1];
  points.push([last[0], last[1]]);
  heights.push(last[2]);
  return { points, heights };
}

const kingsCurve = catmullRom(KINGS_ROAD_CONTROL, 3);
export const KINGS_ROAD = {
  width: 5,
  /** Shoulder over which the terrain blends back to the land (cut banks and embankments). */
  shoulder: 4.5,
  points: kingsCurve.points,
  heights: kingsCurve.heights,
  /** Arc length where the town cobbles give way to the kerbed dirt road. */
  cobbleEnd: 40,
} as const;

/** Point, height and unit direction (x, z) at arc length s along the King's Road. */
export function kingsRoadAt(s: number): { x: number; z: number; h: number; dx: number; dz: number } {
  const { points: p, heights: hs } = KINGS_ROAD;
  let acc = 0;
  for (let i = 0; i < p.length - 1; i++) {
    const ex = p[i + 1][0] - p[i][0];
    const ez = p[i + 1][1] - p[i][1];
    const len = Math.hypot(ex, ez);
    if (acc + len >= s || i === p.length - 2) {
      const t = Math.max(0, Math.min(1, (s - acc) / len));
      return { x: p[i][0] + ex * t, z: p[i][1] + ez * t, h: hs[i] + (hs[i + 1] - hs[i]) * t, dx: ex / len, dz: ez / len };
    }
    acc += len;
  }
  return { x: p[0][0], z: p[0][1], h: hs[0], dx: 0, dz: -1 };
}

/** Arc length of the road where it meets z (the road runs north, so z falls along it). */
export function kingsRoadArcAtZ(z: number): number {
  const { points: p } = KINGS_ROAD;
  let acc = 0;
  for (let i = 0; i < p.length - 1; i++) {
    const len = Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]);
    if (p[i + 1][1] <= z) return acc + (len * (p[i][1] - z)) / (p[i][1] - p[i + 1][1]);
    acc += len;
  }
  return acc;
}

/** The zone line to Tidecrown: crossing it northward (toward -z) leaves World I. */
export const KINGS_ROAD_LINE = { a: [-84, -238] as V2, b: [-36, -238] as V2, dir: [0, -1] as V2 } as const;

const kingsGateAt = kingsRoadAt(kingsRoadArcAtZ(KINGS_ROAD_LINE.a[1]) - 5);
/** The King's Gate: a stone arch over the road a few steps before the zone line. */
export const KINGS_GATE = { x: kingsGateAt.x, z: kingsGateAt.z, h: kingsGateAt.h, yaw: Math.atan2(-kingsGateAt.dx, -kingsGateAt.dz), span: 9 } as const;

const kingsReturnAt = kingsRoadAt(kingsRoadArcAtZ(KINGS_ROAD_LINE.a[1]) - 9);
/** Where players coming back from Tidecrown arrive in World I: on the road south of the gate, facing south. */
export const KINGS_ROAD_RETURN = { x: kingsReturnAt.x, z: kingsReturnAt.z, yaw: Math.atan2(-kingsReturnAt.dx, -kingsReturnAt.dz) } as const;

/** Tidecrown seen from World I (its real place in World I coordinates; Tidecrown z = World I z + 520). */
export const TIDECROWN_VIEW = {
  keep: [150, -648] as V2,
  /** Top of the spire's crown of claws, and the lantern they hold. */
  crownTop: 190,
  lanternY: 182,
} as const;

/** Round plazas (cobbled, flattened). */
export const PLAZAS: { x: number; z: number; r: number; h: number }[] = [
  { x: 0, z: 0, r: 15, h: TOWN_H },
  { x: 0, z: -34, r: 7.5, h: TOWN_H + 0.4 },
  { x: -1, z: 29, r: 6, h: TOWN_H },
  { x: -28, z: -8, r: 6, h: TOWN_H },
];

export type BuildingKind = 'house' | 'forge' | 'chapel' | 'tavern' | 'gatetower' | 'cottage' | 'hut';
export interface Lot {
  id: string;
  kind: BuildingKind;
  x: number;
  z: number;
  /** Yaw of the building front (+Z local), radians. */
  yaw: number;
  /** Footprint in modules of 2 units (sx along local x, sz along local z). */
  sx: number;
  sz: number;
  floors: number;
  style: number;
  /** Ground height of the lot (flattened). Filled from terrain if NaN. */
  h: number;
}

const faceTo = (x: number, z: number, tx: number, tz: number): number => Math.atan2(tx - x, tz - z);

export const LOTS: Lot[] = [
  { id: 'forge', kind: 'forge', x: -29, z: -19, yaw: 0, sx: 4, sz: 3, floors: 1, style: 0, h: TOWN_H },
  { id: 'chapel', kind: 'chapel', x: 0, z: -48, yaw: 0, sx: 4, sz: 6, floors: 2, style: 0, h: TOWN_H + 0.6 },
  { id: 'tavern', kind: 'tavern', x: -2, z: 40, yaw: Math.PI, sx: 4, sz: 5, floors: 2, style: 0, h: TOWN_H },
  { id: 'h-ne', kind: 'house', x: 21, z: -19, yaw: faceTo(21, -19, 0, 0), sx: 3, sz: 3, floors: 2, style: 1, h: TOWN_H },
  { id: 'h-se', kind: 'house', x: 21, z: 19, yaw: faceTo(21, 19, 0, 0), sx: 3, sz: 4, floors: 2, style: 2, h: TOWN_H },
  { id: 'h-sw', kind: 'house', x: -21, z: 19, yaw: faceTo(-21, 19, 0, 0), sx: 3, sz: 3, floors: 2, style: 0, h: TOWN_H },
  { id: 'h-nw2', kind: 'house', x: -16, z: -34, yaw: faceTo(-16, -34, 0, -30), sx: 3, sz: 3, floors: 1, style: 3, h: TOWN_H },
  { id: 'h-n1', kind: 'house', x: 36, z: -13, yaw: 0, sx: 4, sz: 3, floors: 2, style: 2, h: TOWN_H },
  { id: 'h-n2', kind: 'house', x: 51, z: -12, yaw: 0, sx: 3, sz: 3, floors: 2, style: 0, h: TOWN_H },
  { id: 'h-s1', kind: 'house', x: 37, z: 16, yaw: Math.PI, sx: 3, sz: 3, floors: 2, style: 3, h: TOWN_H },
  { id: 'h-s2', kind: 'house', x: 51, z: 15, yaw: Math.PI, sx: 4, sz: 3, floors: 1, style: 1, h: TOWN_H },
  { id: 'h-ne2', kind: 'house', x: 18, z: -40, yaw: faceTo(18, -40, 4, -34), sx: 3, sz: 4, floors: 2, style: 1, h: TOWN_H },
  { id: 'h-w1', kind: 'house', x: -40, z: 9, yaw: faceTo(-40, 9, -34, -4), sx: 3, sz: 3, floors: 1, style: 2, h: TOWN_H },
  { id: 'h-s3', kind: 'house', x: 18, z: 38, yaw: faceTo(18, 38, 2, 26), sx: 3, sz: 3, floors: 1, style: 0, h: TOWN_H },
  { id: 'h-a', kind: 'house', x: 12, z: -29, yaw: faceTo(12, -29, 0, -24), sx: 3, sz: 3, floors: 2, style: 3, h: TOWN_H },
  { id: 'h-b', kind: 'house', x: -12, z: -26, yaw: faceTo(-12, -26, 0, -22), sx: 3, sz: 3, floors: 2, style: 1, h: TOWN_H },
  { id: 'h-c', kind: 'house', x: -45, z: -19, yaw: faceTo(-45, -19, -38, -6), sx: 3, sz: 4, floors: 2, style: 0, h: TOWN_H },
  { id: 'h-d', kind: 'house', x: 33, z: -31, yaw: faceTo(33, -31, 24, -22), sx: 3, sz: 3, floors: 1, style: 2, h: TOWN_H },
  { id: 'h-e', kind: 'house', x: -15, z: 32, yaw: faceTo(-15, 32, -3, 26), sx: 3, sz: 3, floors: 2, style: 2, h: TOWN_H },
  { id: 'h-f', kind: 'house', x: 10.5, z: 27, yaw: faceTo(10.5, 27, 0, 20), sx: 2, sz: 3, floors: 2, style: 0, h: TOWN_H },
  { id: 'gate-n', kind: 'gatetower', x: 66, z: -6.5, yaw: -Math.PI / 2, sx: 2, sz: 2, floors: 2, style: 0, h: NaN },
  { id: 'gate-s', kind: 'gatetower', x: 66, z: 6.5, yaw: -Math.PI / 2, sx: 2, sz: 2, floors: 2, style: 0, h: NaN },
  { id: 'keeper', kind: 'cottage', x: 152, z: -128, yaw: faceTo(152, -128, 160, -116), sx: 2, sz: 3, floors: 1, style: 1, h: HEADLAND_H },
  // The fisher's hut sits back on the dune grass, clear of the beach where the Scraplings are fought.
  { id: 'hut', kind: 'hut', x: 95, z: 31, yaw: faceTo(95, 31, 114, 23), sx: 2, sz: 2, floors: 1, style: 0, h: NaN },
];

export const GROVE = { x: -80, z: 50, r: 15, poolR: 5.5, h: 6.2 } as const;

/** Wooden pier into the bay from the Brine Shore. */
export const DOCK = { x0: 112, x1: 146, z: 23, width: 4, y: 0.85, headZ0: 15, headZ1: 31, headX0: 140 } as const;

interface PoiDef {
  x: number;
  z: number;
  yaw: number;
  radius: number;
  /** Fixed height (structures); otherwise heightAt. */
  y?: number;
}

const lhDir = (() => {
  const dx = LIGHTHOUSE.bridgeFrom[0] - LIGHTHOUSE.x;
  const dz = LIGHTHOUSE.bridgeFrom[1] - LIGHTHOUSE.z;
  const l = Math.hypot(dx, dz);
  return [dx / l, dz / l] as const;
})();

export const POI_DEFS: Record<PoiId, PoiDef> = {
  spawn: { x: -0.5, z: 12.5, yaw: faceTo(-0.5, 12.5, 4.2, 10.2), radius: 6 },
  forge: { x: -28, z: -10, yaw: Math.PI, radius: 5 },
  chapel: { x: 0, z: -35, yaw: Math.PI, radius: 5 },
  tavern: { x: -1, z: 30, yaw: 0, radius: 5 },
  grove: { x: GROVE.x + 7, z: GROVE.z - 4, yaw: faceTo(GROVE.x + 7, GROVE.z - 4, GROVE.x, GROVE.z), radius: 9 },
  // Open sand south of the pier: the middle of the Scrapling hunt.
  shore: { x: 115, z: 36, yaw: Math.PI / 2, radius: 24 },
  lighthouse: { x: 166, z: -119, yaw: faceTo(166, -119, LIGHTHOUSE.x, LIGHTHOUSE.z), radius: 6 },
  beacon: {
    x: LIGHTHOUSE.x + lhDir[0] * 3.5,
    z: LIGHTHOUSE.z + lhDir[1] * 3.5,
    yaw: Math.atan2(-lhDir[0], -lhDir[1]),
    radius: 2,
    y: LIGHTHOUSE.galleryY,
  },
  wreck: { x: 128, z: 99, yaw: faceTo(128, 99, WRECK.x, WRECK.z), radius: 8 },
  bossArena: { x: WRECK.x, z: WRECK.z, yaw: faceTo(WRECK.x, WRECK.z, WRECK.bow[0], WRECK.bow[1]), radius: 12, y: WRECK.deckY },
  'npc:brinebeard': { x: 4.2, z: 10.2, yaw: faceTo(4.2, 10.2, 0, 13), radius: 1 },
  'npc:silvermoon': { x: GROVE.x + 4.5, z: GROVE.z - 6.5, yaw: faceTo(GROVE.x + 4.5, GROVE.z - 6.5, GROVE.x + 12, GROVE.z - 4), radius: 1 },
  'npc:coralline': { x: 2.5, z: -37.5, yaw: 0, radius: 1 },
  'npc:grukk': { x: 62, z: 4.2, yaw: -Math.PI / 2, radius: 1 },
  'npc:hoofclaw': { x: 3.2, z: 31.5, yaw: faceTo(3.2, 31.5, 0, 20), radius: 1 },
  'npc:rattlebolt': { x: 160, z: -118, yaw: faceTo(160, -118, 140, -112), radius: 1 },
  'npc:pip': { x: -25, z: -12.5, yaw: faceTo(-25, -12.5, -20, -4), radius: 1 },
};

export const SPAWN_POINTS = {
  scraplings: [
    [113, -8],
    [114, 8],
    [109, 44],
    [114, 62],
    [119, 80],
    [111, -24],
  ] as V2[],
  scavengers: [
    [108, -54],
    [114, -74],
    [121, -93],
    [142, -112],
  ] as V2[],
  townsfolk: [
    [8, -6],
    [-7, 7],
    [26, 2],
    [44, 2],
    [-22, -3],
    [0, -24],
    [-1, 20],
    [56, 1],
  ] as V2[],
};

/** Sun direction for each mood (toward the light). Low south-east sun over the bay at dusk. */
export const SUN_DIR_DUSK = [0.56, 0.29, 0.78] as const;
export const MOON_DIR = [-0.35, 0.55, 0.76] as const;
