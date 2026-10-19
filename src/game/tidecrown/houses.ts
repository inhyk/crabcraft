// Tidecrown's townhouses: tall limestone and plaster row houses under sea-blue round tiles, assembled from the
// Medieval Village MegaKit and its props and nature kits (CC0, see NOTICE.md). Kit materials are shared with
// World 1, so Tidecrown recolours its own clones; per-house colours ride on vertex colour, so a whole quarter of
// the city is still one draw per material. planDistrict lays the rows out as plain numbers (lots and colliders,
// also usable without the kit); fillDistrict builds them, one batch per quarter so frustum culling works.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { lathe, tube, worldBox } from '../../world/geom';
import { type Kit, loadKit, StaticBatch, trs } from '../../world/kit';
import { addPatch, stylise } from '../../world/materials';
import { GLSL_NOISE } from '../../world/noise';

export type V2 = [number, number];
export type Height = (x: number, z: number) => number;
type Side = 'front' | 'back' | 'left' | 'right';

const H = 3; // storey height
const WALL = 0.09; // wall pieces stand this far out of their module line
const ROOF_LENGTHS: Record<number, number[]> = { 4: [4, 6, 8], 6: [6, 8, 10, 12, 14], 8: [8, 10, 12, 14] };
/** Ridge height above the wall top and eave overhang of the kit's round-tile roofs, by span. */
const RIDGE: Record<number, number> = { 4: 3.73, 6: 4.89, 8: 6.0 };
/** Roofs sit this far above the storey line, so their eaves clear the top-floor windows. */
const ROOF_LIFT = 0.25;

/** Deterministic 0..1 stream. */
export function stream(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}
const pick = <T>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length) % list.length];

// ------------------------------------------------------------------------------------------------
// Materials

export type Over = Record<string, THREE.Material | null>;
export type Tint = Map<THREE.Material, THREE.Color>;

export interface TidecrownMaterials {
  plaster: THREE.MeshStandardMaterial;
  limestone: THREE.MeshStandardMaterial;
  ashlar: THREE.MeshStandardMaterial;
  rock: THREE.MeshStandardMaterial;
  /** The kit's wood trim regraded as pale dressed stone: storey bands, quoins, cornices, door surrounds. */
  stone: THREE.MeshStandardMaterial;
  /** The wood trim as painted wood: shutters, doors, window frames, balcony rails. */
  paint: THREE.MeshStandardMaterial;
  tiles: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  iron: THREE.MeshStandardMaterial;
  gold: THREE.MeshStandardMaterial;
  awning: THREE.MeshStandardMaterial;
  /** Long sea-blue banners with a gold border and roundel, hung from iron arms. */
  banner: THREE.MeshStandardMaterial;
  /** Pennants of the street bunting (colour per flag in the vertex colour). */
  pennant: THREE.MeshStandardMaterial;
  vine: THREE.Material;
}

export interface TidecrownKit {
  village: Kit;
  props: Kit;
  nature: Kit;
  mat: TidecrownMaterials;
  /** Material overrides by kit material name, per family of pieces. */
  over: { wall: Over; paint: Over; plaster: Over; props: Over; nature: Over };
}

const lin = (hex: string) => new THREE.Color(hex);
const glslVec = (c: THREE.Color) => `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;

/** Regrade a kit albedo by its luminance onto a dark..light ramp (kept detail, new colour). */
function grade(mat: THREE.MeshStandardMaterial, key: string, l0: number, l1: number, dark: string, light: string): void {
  addPatch(mat, `tc-grade-${key}`, (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      {
        float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        diffuseColor.rgb = mix(${glslVec(lin(dark))}, ${glslVec(lin(light))}, smoothstep(${l0.toFixed(3)}, ${l1.toFixed(3)}, l));
      }`,
    );
  });
}

function kitClone(m: THREE.Material | undefined, name: string, vertexColors = true): THREE.MeshStandardMaterial {
  const c = (m as THREE.MeshStandardMaterial).clone();
  c.name = name;
  if (!/Metal/.test(m!.name)) {
    c.metalness = 0;
    c.metalnessMap = null;
  }
  // The kit ships double-sided; walls, roofs and props are closed shells.
  c.side = THREE.FrontSide;
  c.vertexColors = vertexColors;
  return c;
}

function clothMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ name: 'tidecrown-awning', color: '#ffffff', roughness: 0.82, side: THREE.DoubleSide, vertexColors: true });
  // Woven stripes along the cloth (aCloth.x in metres across, aCloth.y down the fall): sea blue, cream, gold, cream.
  addPatch(m, 'tc-awning', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aCloth;\nvarying vec2 vCloth;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCloth = aCloth;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec2 vCloth;\n${GLSL_NOISE}`).replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      {
        float u = vCloth.x / 0.26;
        float k = mod(floor(u), 4.0);
        vec3 c = k < 0.5 ? ${glslVec(lin('#2b5b93'))} : k < 1.5 ? ${glslVec(lin('#f1eadb'))} : k < 2.5 ? ${glslVec(lin('#d9a536'))} : ${glslVec(lin('#f1eadb'))};
        float edge = smoothstep(0.0, 0.06, fract(u)) * smoothstep(1.0, 0.94, fract(u));
        float weave = 0.93 + 0.07 * cc_vnoise(vCloth * vec2(60.0, 60.0));
        float sun = 0.92 + 0.08 * cc_vnoise(vCloth * vec2(1.3, 3.0));
        diffuseColor.rgb *= c * mix(0.82, 1.0, edge) * weave * sun;
      }`,
    );
  });
  return m;
}

function bannerMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ name: 'tidecrown-banner', color: '#ffffff', roughness: 0.78, side: THREE.DoubleSide, vertexColors: true });
  // aCloth: x across (0..0.8), y down the fall. Gold hem and border, a gold roundel with a crowned diamond.
  addPatch(m, 'tc-banner', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aCloth;\nvarying vec2 vCloth;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCloth = aCloth;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec2 vCloth;\n${GLSL_NOISE}`).replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      {
        vec3 blue = ${glslVec(lin('#24508f'))};
        vec3 gold = ${glslVec(lin('#e2ae45'))};
        float u = vCloth.x, v = vCloth.y;
        float border = 1.0 - step(0.055, u) * step(u, 0.745) * step(0.07, v);
        vec2 p = vec2(u - 0.4, v - 0.78);
        float ring = 1.0 - smoothstep(0.018, 0.03, abs(length(p) - 0.2));
        float gem = 1.0 - smoothstep(0.0, 0.012, abs(p.x) * 1.3 + abs(p.y) - 0.11);
        float bar = (1.0 - step(0.012, abs(v - 1.16))) * step(abs(u - 0.4), 0.2);
        float g = clamp(border + ring + gem + bar, 0.0, 1.0);
        float weave = 0.94 + 0.06 * cc_vnoise(vCloth * 70.0);
        diffuseColor.rgb *= mix(blue, gold, g) * weave;
      }`,
    );
  });
  return m;
}

function glassMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ name: 'tidecrown-glass', color: '#3a4656', emissive: '#ffb066', emissiveIntensity: 1.6, roughness: 0.12, metalness: 0.55, vertexColors: true });
  // Vertex colour red is the light inside each window (0 dark .. 1 lamp-lit); the pane itself stays dark glass.
  addPatch(m, 'tc-glass', (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', '#ifdef USE_COLOR\n float cLit = vColor.r;\n#endif\n')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance *= cLit * cLit;\n#endif');
  });
  return m;
}

let kitPromise: Promise<TidecrownKit> | null = null;

/** Load the three kits once and make Tidecrown's material set (shared by every district and market). */
export function loadTidecrownKit(): Promise<TidecrownKit> {
  kitPromise ??= (async () => {
    const [village, props, nature] = await Promise.all([loadKit('models/world/village.glb'), loadKit('models/world/props.glb'), loadKit('models/world/nature.glb')]);
    const vm = (n: string) => village.materials.get(n);
    const plaster = kitClone(vm('MI_Plaster'), 'tidecrown-plaster');
    grade(plaster, 'plaster', 0.3, 0.41, '#dad5cc', '#ffffff');
    const limestone = kitClone(vm('MI_UnevenBrick'), 'tidecrown-limestone');
    grade(limestone, 'limestone', 0.1, 0.3, '#8a8170', '#f2ead8');
    const ashlar = kitClone(vm('MI_Brick'), 'tidecrown-ashlar');
    grade(ashlar, 'ashlar', 0.15, 0.36, '#b4aa95', '#f4ede0');
    const rock = kitClone(vm('MI_RockTrim'), 'tidecrown-rock');
    grade(rock, 'rock', 0.13, 0.43, '#a39983', '#f3ecdc');
    const stone = kitClone(vm('MI_WoodTrim'), 'tidecrown-stone-trim');
    grade(stone, 'stone', 0.05, 0.4, '#b9ae98', '#f6efe0');
    const paint = kitClone(vm('MI_WoodTrim'), 'tidecrown-paint');
    grade(paint, 'paint', 0.05, 0.4, '#8f8f8f', '#ffffff');
    const tiles = kitClone(vm('MI_RoundTiles'), 'tidecrown-tiles');
    grade(tiles, 'tiles', 0.11, 0.27, '#5c5c5c', '#ffffff');
    tiles.roughness = 0.62;
    const iron = kitClone(vm('MI_MetalOrnaments'), 'tidecrown-iron', false);
    iron.color.set('#5a5e66');
    const vine = kitClone(vm('MI_Vine'), 'tidecrown-vine', false);
    vine.side = THREE.DoubleSide;
    const gold = new THREE.MeshStandardMaterial({ name: 'tidecrown-gold', color: '#e0ad48', metalness: 0.9, roughness: 0.28 });
    const pennant = new THREE.MeshStandardMaterial({ name: 'tidecrown-pennant', color: '#ffffff', roughness: 0.8, side: THREE.DoubleSide, vertexColors: true });
    const mat: TidecrownMaterials = { plaster, limestone, ashlar, rock, stone, paint, tiles, glass: glassMaterial(), iron, gold, awning: clothMaterial(), banner: bannerMaterial(), pennant, vine };
    const wall: Over = {
      MI_Plaster: plaster,
      MI_UnevenBrick: limestone,
      MI_Brick: ashlar,
      MI_RockTrim: rock,
      MI_WoodTrim: stone,
      MI_RoundTiles: tiles,
      MI_WindowGlass: mat.glass,
      MI_MetalOrnaments: iron,
      MI_Vine: vine,
    };
    const propsOver: Over = {};
    for (const [name, m] of props.materials) {
      // Vertex colour on: the kit paints produce (carrots, apples) through it.
      const c = kitClone(m, `tidecrown-${name}`, true);
      if (/Cloth/.test(name)) c.side = THREE.DoubleSide;
      propsOver[name] = c;
    }
    const natureOver: Over = {};
    // Foliage graded as in Clawhaven: the twisted-tree leaf atlas (red in the kit) turns summer green on shrubs.
    for (const [name, m] of nature.materials) {
      const c = (m as THREE.MeshStandardMaterial).clone();
      c.name = `tidecrown-${name}`;
      if (name === 'Leaves_TwistedTree') stylise(c, 1.1, [0.95, 1.05, 0.85], -1.9);
      else if (name.startsWith('Leaves')) stylise(c, 1.2, [1.0, 1.03, 0.88]);
      else if (name.startsWith('Bark')) stylise(c, 0.7, [0.85, 0.8, 0.78]);
      else stylise(c, 1.1, [1.0, 1.0, 0.95]);
      natureOver[name] = c;
    }
    return { village, props, nature, mat, over: { wall, paint: { ...wall, MI_WoodTrim: paint }, plaster: { ...wall, MI_WoodTrim: null }, props: propsOver, nature: natureOver } };
  })();
  return kitPromise;
}

// ------------------------------------------------------------------------------------------------
// Batching

const WHITE = new THREE.Color(1, 1, 1);
/** A copy of `geo` with its vertex colour multiplied by `c` (cached per batch for shared kit parts). */
function withColor(geo: THREE.BufferGeometry, c: THREE.Color, cache: Map<string, THREE.BufferGeometry> | null): THREE.BufferGeometry {
  const have = geo.getAttribute('color');
  if (have && c.equals(WHITE)) return geo;
  const key = `${geo.uuid}|${c.r.toFixed(3)},${c.g.toFixed(3)},${c.b.toFixed(3)}`;
  let g = cache?.get(key);
  if (g) return g;
  g = geo.clone();
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const s = have ? [have.getX(i), have.getY(i), have.getZ(i)] : [1, 1, 1];
    arr.set([s[0] * c.r, s[1] * c.g, s[2] * c.b, 1], i * 4);
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 4));
  cache?.set(key, g);
  return g;
}

/** A StaticBatch that takes pieces from any of Tidecrown's kits, with overrides and per-placement tints. */
export class TideBatch extends StaticBatch {
  constructor(
    readonly tide: TidecrownKit,
    name: string,
  ) {
    super(tide.village, name);
  }

  private tints = new Map<string, THREE.BufferGeometry>();
  /** Triangles placed per kit piece, for budgeting. */
  readonly pieceTris = new Map<string, number>();

  put(kit: Kit, piece: string, m: THREE.Matrix4, over: Over, tint?: Tint | null, castShadow = true): void {
    for (const part of kit.get(piece).parts) {
      const mat = part.material.name in over ? over[part.material.name] : part.material;
      if (!mat) continue;
      this.pieceTris.set(piece, (this.pieceTris.get(piece) ?? 0) + (part.geometry.getIndex()?.count ?? 0) / 3);
      const geo = (mat as THREE.MeshStandardMaterial).vertexColors ? withColor(part.geometry, tint?.get(mat) ?? WHITE, this.tints) : part.geometry;
      super.addGeometry(geo, mat, m, castShadow);
    }
  }

  override addGeometry(geo: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4 | null, castShadow = true, color?: THREE.Color): void {
    // Vertex-coloured materials need the attribute on every geometry they merge.
    if ((mat as THREE.MeshStandardMaterial).vertexColors && (color || !geo.getAttribute('color'))) geo = withColor(geo, color ?? WHITE, null);
    super.addGeometry(geo, mat, m, castShadow);
  }

  override build(): THREE.Group {
    this.tints.clear();
    return super.build();
  }
}

// ------------------------------------------------------------------------------------------------
// Townhouses

export interface TownhouseSpec {
  /** Footprint centre. */
  x: number;
  z: number;
  /** Rotation.y of the house; its street front is local +Z. */
  yaw: number;
  /** Footprint in 2-unit modules: along the street front, and back from it. */
  width: number;
  depth: number;
  /** Storeys, 2..4. */
  floors: number;
  seed: number;
  /** Floor height (top of the stone plinth). */
  ground: number;
  /** Lowest ground under the footprint: the plinth reaches below it. Defaults to `ground`. */
  base?: number;
  /** Street level in front of the door: steps lead down to it. Defaults to `ground`. */
  doorstep?: number;
  shop?: boolean;
  balcony?: boolean;
  /** A Tidecrown banner on the street front (three storeys or more). */
  banner?: boolean;
  /** 'eaves': ridge along the street; 'gable': the gable end faces the street. */
  roof?: 'eaves' | 'gable';
  /** Side walls that front a second street (a corner house) get windows like the front. */
  corner?: { left?: boolean; right?: boolean; back?: boolean };
  /** Storeys hidden behind an abutting neighbour, per module along each side (party walls are left out). */
  party?: { left?: number[]; right?: number[]; back?: number[] };
  /** Roof ends flush at a party wall shared with a neighbour of the same roofline. */
  trim?: { left?: boolean; right?: boolean };
}

export interface DoorSpot {
  x: number;
  z: number;
  /** Outward normal (unit, world xz). */
  nx: number;
  nz: number;
}
export interface TownhouseLot {
  spec: TownhouseSpec;
  /** World footprint on the module lines (row houses share these party lines; wall faces stand 0.09 proud). */
  corners: V2[];
  hx: number;
  hz: number;
  doors: DoorSpot[];
  /** Ridge height (world). */
  top: number;
}
/** An oriented box for Collision.addBoxCS(x, z, hx, hz, c, s, y0, y1). */
export interface TidecrownCollider {
  x: number;
  z: number;
  hx: number;
  hz: number;
  c: number;
  s: number;
  y0: number;
  y1: number;
}

/** World point of a house-local point. */
export function atLocal(spec: { x: number; z: number; yaw: number }, lx: number, lz: number): V2 {
  const c = Math.cos(spec.yaw);
  const s = Math.sin(spec.yaw);
  return [spec.x + c * lx + s * lz, spec.z - s * lx + c * lz];
}

function sideFrame(side: Side, W: number, D: number): { yaw: number; count: number; at: (i: number) => V2 } {
  switch (side) {
    case 'front':
      return { yaw: 0, count: W / 2, at: (i) => [-W / 2 + 1 + 2 * i, D / 2] };
    case 'back':
      return { yaw: Math.PI, count: W / 2, at: (i) => [W / 2 - 1 - 2 * i, -D / 2] };
    case 'left':
      return { yaw: -Math.PI / 2, count: D / 2, at: (i) => [-W / 2, D / 2 - 1 - 2 * i] };
    case 'right':
      return { yaw: Math.PI / 2, count: D / 2, at: (i) => [W / 2, -D / 2 + 1 + 2 * i] };
  }
}

/** Door module on the front: off-centre on wide houses so the shop arches get the middle. */
function doorIndex(spec: TownhouseSpec): number {
  if (spec.width <= 1) return 0;
  return spec.width === 2 ? spec.seed % 2 : spec.width === 3 ? (spec.shop ? (spec.seed % 2 ? 0 : 2) : 1) : spec.seed % 2 ? 1 : 2;
}

function roofSpan(spec: TownhouseSpec): { span: number; len: number; ridge: 'x' | 'z' } {
  const W = spec.width * 2;
  const D = spec.depth * 2;
  return spec.roof === 'gable' ? { span: W, len: D, ridge: 'z' } : { span: D, len: W, ridge: 'x' };
}

/** Footprint, doors and ridge of a house: plain numbers, the same with or without the kit. */
export function townhouseLot(spec: TownhouseSpec): TownhouseLot {
  const hx = spec.width;
  const hz = spec.depth;
  const corners: V2[] = [atLocal(spec, -hx, hz), atLocal(spec, hx, hz), atLocal(spec, hx, -hz), atLocal(spec, -hx, -hz)];
  const di = doorIndex(spec);
  const [dx, dz] = atLocal(spec, -spec.width + 1 + 2 * di, hz);
  const doors: DoorSpot[] = [{ x: dx, z: dz, nx: Math.sin(spec.yaw), nz: Math.cos(spec.yaw) }];
  const { span } = roofSpan(spec);
  return { spec, corners, hx, hz, doors, top: spec.ground + spec.floors * H + ROOF_LIFT + (RIDGE[span] ?? 4) };
}

export function townhouseCollider(lot: TownhouseLot): TidecrownCollider {
  const s = lot.spec;
  return { x: s.x, z: s.z, hx: lot.hx + 0.2, hz: lot.hz + 0.2, c: Math.cos(s.yaw), s: Math.sin(s.yaw), y0: (s.base ?? s.ground) - 2, y1: lot.top + 1 };
}

const WALL_TONES = ['#e9dcc0', '#efe4cc', '#e4cfa4', '#dcd8cc', '#f0dfbc', '#e6d2b6', '#d6d2c6', '#ead6b0', '#e8d9c8', '#e2c9a2'];
const STONE_TONES = ['#ffffff', '#fbf6ec', '#f6f1e8', '#fff8ea'];
const ROOF_TONES = ['#33639e', '#2c5690', '#3c70aa', '#2a4f80', '#3a679a'];
const COPPER = '#5f9a88';
const SHUTTER_TONES = ['#2f5f8f', '#2b7884', '#3c6fa6', '#24546c', '#3a8889', '#29507e'];
const DOOR_TONES = ['#26446a', '#1f585c', '#6b4a2e', '#2c3c55', '#245a7a', '#5b3b27'];
const FRAME_TONES = ['#f4f0e6', '#ece6d8', '#f6f2ea'];

interface Style {
  wall: Over;
  paint: Over;
  /** Tints for walls and stone, for roofs, and for each painted family. */
  t: Tint;
  roof: Tint;
  shutter: Tint;
  door: Tint;
  frame: Tint;
  groundStone: boolean;
}

function houseStyle(k: TidecrownKit, r: () => number): Style {
  const m = k.mat;
  const wall = lin(pick(r, WALL_TONES));
  const stone = lin(pick(r, STONE_TONES));
  const roof = lin(r() < 0.1 ? COPPER : pick(r, ROOF_TONES)).multiplyScalar(0.92 + r() * 0.16);
  const frame = lin(pick(r, FRAME_TONES));
  const t: Tint = new Map([
    [m.plaster, wall],
    [m.limestone, stone],
    [m.ashlar, stone],
    [m.rock, stone],
    [m.stone, stone],
    [m.tiles, roof],
    [m.paint, frame],
  ]);
  const shutter = new Map(t).set(m.paint, lin(pick(r, SHUTTER_TONES)));
  const door = new Map(t).set(m.paint, lin(pick(r, DOOR_TONES)));
  return { wall: k.over.wall, paint: k.over.paint, t, roof: t, shutter, door, frame: t, groundStone: r() < 0.72 };
}

type WinKind = 'thin' | 'wideFlat' | 'wideRound';
const WIN_WALL: Record<WinKind, string> = { thin: 'Window_Thin_Round', wideFlat: 'Window_Wide_Flat', wideRound: 'Window_Wide_Round' };
const WIN_PIECE: Record<WinKind, string> = { thin: 'Window_Thin_Round1', wideFlat: 'Window_Wide_Flat1', wideRound: 'Window_Wide_Round1' };
const WIN_SHUT: Record<WinKind, string> = { thin: 'WindowShutters_Thin_Round', wideFlat: 'WindowShutters_Wide_Flat', wideRound: 'WindowShutters_Wide_Round' };

/** Optional extras a house reports to its builder (goods and lamps the caller may light or collide with). */
export interface HouseExtras {
  colliders: TidecrownCollider[];
  lamps: { x: number; y: number; z: number; yaw: number }[];
}

/**
 * Raise one townhouse into `batch`: plinth, storeys of wall modules (rusticated stone or plaster ground floor,
 * banded plaster above), corner quoins, windows with shutters and window boxes, a door with steps and a lantern
 * on the street, an optional shop arcade under a striped awning and an optional balcony, then the round-tile roof
 * with gables, dormers, chimneys and gold finials.
 */
export function buildTownhouse(spec: TownhouseSpec, batch: TideBatch, extras?: HouseExtras): TownhouseLot {
  const k = batch.tide;
  const { village, props, nature, mat } = k;
  const r = stream(spec.seed);
  const st = houseStyle(k, r);
  const lot = townhouseLot(spec);
  const W = spec.width * 2;
  const D = spec.depth * 2;
  const F = spec.floors;
  const base = trs(spec.x, spec.ground, spec.z, spec.yaw);
  const m = new THREE.Matrix4();
  // Plaster walls leave out the kit's timber frame: stone bands and quoins carry the lines instead.
  const put = (kit: Kit, piece: string, over: Over, tint: Tint | null, x: number, y: number, z: number, yaw = 0, scale: number | THREE.Vector3 = 1, shadow = true, pitch = 0) => {
    if (over === st.wall && piece.startsWith('Wall_Plaster')) over = k.over.plaster;
    m.multiplyMatrices(base, trs(x, y, z, yaw, scale, pitch));
    batch.put(kit, piece, m, over, tint, shadow);
  };
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const geo = (g: THREE.BufferGeometry, material: THREE.Material, tint: THREE.Color | undefined, shadow = true) => batch.addGeometry(g.applyMatrix4(base), material, null, shadow, tint);
  const stoneTint = st.t.get(mat.stone);
  const hidden = (side: Side, i: number, f: number) => {
    const p = side === 'front' ? undefined : spec.party?.[side];
    return !!p && (p[i] ?? 0) > f;
  };
  const isCorner = (side: Side) => side === 'front' || (side !== 'back' ? !!spec.corner?.[side] : !!spec.corner?.back);
  const di = doorIndex(spec);
  const winByFloor: WinKind[] = [];
  for (let f = 0; f < F; f++) winByFloor.push(f === 1 ? pick(r, ['thin', 'wideRound', 'wideRound'] as const) : f === F - 1 && F > 2 ? pick(r, ['wideFlat', 'wideFlat', 'thin'] as const) : pick(r, ['wideFlat', 'wideRound', 'wideFlat'] as const));
  const balconyFloor = spec.balcony && F >= 3 ? 1 + (F >= 4 && r() < 0.4 ? 1 : 0) : -1;
  // Turned balusters on a few grand fronts, crossed iron on the rest.
  const rail = r() < 0.3 ? 'Balcony_Simple_Straight' : 'Balcony_Cross_Straight';
  const shutterOdds = 0.45 + r() * 0.5;
  const boxOdds = 0.12 + r() * 0.3;
  const glassLit = () => {
    const q = r();
    return new THREE.Color(q < 0.14 ? 0.55 + r() * 0.45 : 0.04 + r() * 0.08, 1, 1);
  };
  const glassTint = (t: Tint) => new Map(t).set(mat.glass, glassLit());

  // Plinth: dressed stone under the floor down past the lowest ground.
  const low = Math.min(spec.base ?? spec.ground, spec.doorstep ?? spec.ground) - 0.7;
  const ph = spec.ground - low + 0.04;
  // Flush with the party line where a neighbour stands, so two plinths never share a face.
  const pl = hidden('left', 0, 0) ? 0 : 0.17;
  const pr = hidden('right', 0, 0) ? 0 : 0.17;
  const pb = hidden('back', 0, 0) ? 0 : 0.17;
  geo(worldBox(W + pl + pr, ph, D + 0.17 + pb, 0.5).translate((pr - pl) / 2, -ph / 2 + 0.04, (0.17 - pb) / 2), mat.limestone, stoneTint);

  const sides: Side[] = ['front', 'right', 'back', 'left'];
  for (let f = 0; f < F; f++) {
    const y = f * H;
    const groundSet = f === 0 && st.groundStone;
    const prefix = groundSet ? 'Wall_UnevenBrick' : 'Wall_Plaster';
    for (const side of sides) {
      const sf = sideFrame(side, W, D);
      const c = Math.cos(sf.yaw);
      const s = Math.sin(sf.yaw);
      for (let i = 0; i < sf.count; i++) {
        if (hidden(side, i, f)) continue;
        const [x, z] = sf.at(i);
        const street = isCorner(side);
        // Storey band under every upper floor of the street fronts.
        if (f > 0 && street) put(village, 'Wall_BottomCover', st.wall, st.t, x, y, z, sf.yaw, v(1, 1.25, 1.2));
        if (side === 'front' && f === 0 && i === di) {
          door(x, y, z, sf.yaw, c, s, groundSet, true);
          continue;
        }
        if (side === 'front' && f === 0 && spec.shop) {
          shopArch(x, y, z, sf.yaw, groundSet);
          continue;
        }
        if (f === balconyFloor && side === 'front') {
          balconyDoor(x, y, z, sf.yaw);
          continue;
        }
        let kind: WinKind | 'plain' = 'plain';
        if (street) kind = f === 0 ? (r() < 0.75 ? pick(r, ['wideRound', 'thin'] as const) : 'plain') : winByFloor[f];
        else if (side === 'back') kind = r() < (f === 0 ? 0.12 : 0.4) ? 'wideFlat' : 'plain';
        else kind = r() < (f === 0 ? 0.05 : 0.3) ? 'wideFlat' : 'plain';
        if (street && f === 0 && kind !== 'plain') kind = 'wideRound';
        if (kind === 'plain') {
          put(village, groundSet ? 'Wall_UnevenBrick_Straight' : f === 0 ? 'Wall_Plaster_Straight_Base' : 'Wall_Plaster_Straight', st.wall, st.t, x, y, z, sf.yaw);
          // Ivy on a few blank walls.
          if (r() < 0.12 && f < F - 1) put(village, pick(r, ['Prop_Vine1', 'Prop_Vine2'] as const), st.wall, null, x + c * (r() - 0.5) * 0.6 + s * 0.12, y + H + 0.1, z - s * (r() - 0.5) * 0.6 + c * 0.12, sf.yaw, 0.9 + r() * 0.3, false);
          continue;
        }
        window(x, y, z, sf.yaw, c, s, kind, prefix, street, f);
      }
    }
    // Quoins: pale stone pilasters at the corners (the front pair always shows).
    const cornerAt: [number, number, number, Side][] = [
      [-W / 2, D / 2, 0, 'left'],
      [W / 2, D / 2, Math.PI / 2, 'right'],
      [W / 2, -D / 2, Math.PI, 'right'],
      [-W / 2, -D / 2, -Math.PI / 2, 'left'],
    ];
    cornerAt.forEach(([cx, cz, cy, side], n) => {
      const front = n < 2;
      const sideIdx = side === 'left' ? (front ? 0 : D / 2 - 1) : front ? D / 2 - 1 : 0;
      // A quoin on a shared party line is laid by the house to its left only.
      if (hidden(side, sideIdx, f) && (!front || side === 'left')) return;
      put(village, 'Corner_ExteriorWide_Wood', st.wall, st.t, cx, y, cz, cy, v(groundSet ? 2.1 : 1.7, 1.02, groundSet ? 2.1 : 1.7));
    });
  }
  const top = F * H;
  roof(top + ROOF_LIFT);
  if (spec.shop) awning();
  if (spec.banner && F >= 3) banner();
  return lot;

  // --- pieces -----------------------------------------------------------------------------------

  function window(x: number, y: number, z: number, yaw: number, c: number, s: number, kind: WinKind, prefix: string, street: boolean, f: number): void {
    put(village, `${prefix}_${WIN_WALL[kind]}`, st.wall, st.t, x, y, z, yaw);
    put(village, WIN_PIECE[kind], st.paint, glassTint(st.frame), x, y, z, yaw, 1, false);
    if (street ? r() < shutterOdds : r() < 0.25) put(village, `${WIN_SHUT[kind]}_${r() < 0.7 ? 'Open' : 'Closed'}`, st.paint, st.shutter, x, y, z, yaw, 1, false);
    // Stone window boxes with flowers under upper street windows.
    if (street && f > 0 && r() < boxOdds) {
      const w = kind === 'thin' ? 0.62 : 0.78;
      const sill = kind === 'wideFlat' ? 0.86 : 0.93;
      put(village, 'Prop_ExteriorBorder_Straight1', st.wall, st.t, x, y + sill, z + 0, yaw, v(w, 2.4, 0.42), true);
      const n = 2;
      for (let j = 0; j < n; j++) {
        const lx = (j - (n - 1) / 2) * (w * 1.6) / n;
        const px = x + c * lx + s * 0.22;
        const pz = z - s * lx + c * 0.22;
        const plant = r() < 0.65 ? 'Flower_3_Single' : 'Plant_7';
        const sc = plant.startsWith('Flower') ? 0.22 + r() * 0.06 : plant === 'Plant_7' ? 0.55 : 0.3;
        put(nature, plant, k.over.nature, null, px, y + sill + 0.3, pz, r() * Math.PI * 2, sc, false);
      }
    }
  }

  function door(x: number, y: number, z: number, yaw: number, c: number, s: number, groundSet: boolean, main: boolean): void {
    put(village, groundSet ? 'Wall_UnevenBrick_Door_Round' : 'Wall_Plaster_Door_Round', st.wall, st.t, x, y, z, yaw);
    const piece = pick(r, ['Door_1_Round', 'Door_4_Round', 'Door_8_Round', 'Door_1_Round'] as const);
    // Doors hinge at their local x = 0; centre them in the opening.
    const ox = -0.55;
    const oz = -0.12;
    put(village, piece, st.paint, glassTint(st.door), x + c * ox + s * oz, y, z - s * ox + c * oz, yaw, 1, false);
    put(village, 'DoorFrame_Round_WoodDark', st.wall, st.t, x, y, z, yaw, v(1.08, 1.04, 1.4), false);
    if (!main) return;
    // A wall lantern beside the door, and steps down to the street.
    const side = (spec.seed >> 3) % 2 ? 1 : -1;
    const lx = x + c * 1.0 * side + s * 0.1;
    const lz = z - s * 1.0 * side + c * 0.1;
    if (r() < (spec.shop ? 0.6 : 0.2)) {
      put(props, 'Lantern_Wall', k.over.props, null, lx, y + 1.7, lz, yaw, 0.48, false);
      const [wx, wz] = atLocal(spec, lx + s * 0.53, lz + c * 0.53);
      extras?.lamps.push({ x: wx, y: spec.ground + 1.96, z: wz, yaw: spec.yaw + yaw });
    }
    const rise = spec.ground - (spec.doorstep ?? spec.ground);
    if (rise > 0.12) {
      // Treads stay on the pavement: at most two, each a little wider and lower than the last.
      const n = rise > 0.34 ? 2 : 1;
      for (let j = 0; j < n; j++) {
        const yTop = -(rise * (j + 1)) / (n + 1);
        const d = 0.34 * (j + 1);
        const h = yTop + rise + 0.4;
        geo(worldBox(1.6 + 0.2 * j, h, d, 0.5).translate(x, yTop - h / 2, z + WALL + d / 2), mat.limestone, stoneTint);
      }
    }
  }

  function shopArch(x: number, y: number, z: number, yaw: number, groundSet: boolean): void {
    // An open arch onto a shallow shop: back wall, floor, ceiling, a shelf of wares and goods out front.
    put(village, groundSet ? 'Wall_UnevenBrick_Door_Round' : 'Wall_Plaster_Door_Round', st.wall, st.t, x, y, z, yaw);
    put(village, 'DoorFrame_Round_WoodDark', st.wall, st.t, x, y, z, yaw, v(1.08, 1.04, 1.4), false);
    const back = z - 1.25;
    put(village, 'Wall_Plaster_Straight', st.wall, st.t, x, y, back, 0, 1, false);
    put(village, 'Floor_WoodDark', st.paint, new Map(st.t).set(mat.paint, lin('#8a6a4a')), x, y + 0.02, z - 0.6, 0, v(1, 1, 0.62), false);
    put(village, 'Floor_WoodDark', st.paint, new Map(st.t).set(mat.paint, lin('#6d5440')), x, y + 2.75, z - 0.6, 0, v(1, 1, 0.62), false, Math.PI);
    for (const sx of [-1, 1]) put(village, 'Wall_Plaster_Straight', st.wall, st.t, x + sx * 0.98, y, z - 0.6, -sx * Math.PI / 2, v(0.62, 1, 1), false);
    put(props, 'Shelf_Simple', k.over.props, null, x, y + 1.5, back + 0.12, 0, 1.1, false);
    put(props, pick(r, ['Vase_4', 'Candle_2'] as const), k.over.props, null, x + (r() - 0.5) * 0.6, y + 1.62, back + 0.3, r() * 6, 0.8, false);
    put(props, pick(r, ['Barrel', 'Bag', 'Vase_2'] as const), k.over.props, null, x + (r() - 0.5) * 0.6, y, back + 0.6, r() * 6, 0.85, false);
    // Goods on the pavement, against the wall between the arches.
    if (r() < 0.75) {
      const piece = pick(r, ['Barrel_Apples', 'Prop_Crate', 'Barrel', 'Bag', 'Vase_2', 'Prop_Crate'] as const);
      const gx = x + (r() < 0.5 ? -0.85 : 0.85);
      const gz = z + WALL + 0.38;
      if (piece === 'Prop_Crate') put(village, piece, st.paint, new Map(st.t).set(mat.paint, lin('#9c7650')), gx, 0, gz, r() * 0.6 - 0.3, 0.6);
      else put(props, piece, k.over.props, null, gx, 0, gz, r() * 0.6 - 0.3, 0.8);
      const [wx, wz] = atLocal(spec, gx, gz);
      extras?.colliders.push({ x: wx, z: wz, hx: 0.32, hz: 0.32, c: Math.cos(spec.yaw), s: Math.sin(spec.yaw), y0: spec.ground - 1, y1: spec.ground + 1.2 });
    }
  }

  function balconyDoor(x: number, y: number, z: number, yaw: number): void {
    put(village, 'Wall_Plaster_Door_Flat', st.wall, st.t, x, y, z, yaw);
    put(village, 'Door_1_Flat', st.paint, glassTint(st.shutter), x - 0.55, y, z - 0.12, yaw, 1, false);
    put(village, 'DoorFrame_Flat_WoodDark', st.wall, st.t, x, y, z, yaw, v(1.05, 1.03, 1.4), false);
    // Stone slab on corbels, iron railing along its edge.
    geo(worldBox(2.04, 0.2, 1.0, 0.5).translate(x, y - 0.06, z + 0.55), mat.limestone, stoneTint);
    put(village, 'Wall_BottomCover', st.wall, st.t, x, y - 0.1, z + 1.08, 0, v(1.02, 1.1, 0.8));
    for (const sx of [-0.8, 0.8]) put(village, 'Prop_Support', st.wall, st.t, x + sx, y - 1.45, z + 0.05, 0, v(1.3, 0.55, 0.52));
    put(village, rail, st.paint, new Map(st.t).set(mat.paint, lin('#2c3440')), x, y + 0.04, z + 0.02, 0, v(1.02, 0.9, 0.95));
    for (const sx of [-1, 1]) put(village, 'Balcony_Cross_Straight', st.paint, new Map(st.t).set(mat.paint, lin('#2c3440')), x, y + 0.04, z + 0.52, sx * Math.PI / 2, v(0.5, 0.9, 1.0));
  }

  function awning(): void {
    const w = W - 0.5;
    const g = awningGeometry(w, 1.05, 0.5, (spec.seed % 3) + 1);
    g.translate(0, 2.92, D / 2 + WALL + 0.02);
    geo(g, mat.awning, WHITE);
    // Iron stays from the wall to the front rail.
    const rods: THREE.BufferGeometry[] = [];
    for (const sx of [-w / 2 + 0.1, w / 2 - 0.1]) {
      const a = new THREE.Vector3(sx, 2.25, D / 2 + WALL);
      const b = new THREE.Vector3(sx, 2.44, D / 2 + WALL + 1.02);
      rods.push(tube([a, a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, -0.04, 0)), b], () => 0.025, 6));
    }
    geo(mergeGeometries(rods, false)!, mat.iron, undefined);
  }

  function banner(): void {
    // On a pier between windows, hung below the top storey band from an iron arm.
    const piers = spec.width - 1;
    const px = piers > 0 ? -W / 2 + 2 * (1 + (spec.seed % piers)) : -W / 2 + 0.35;
    const y0 = (F - 1) * H - 0.15;
    const g = bannerGeometry(0.8, 2.6, spec.seed);
    g.translate(px, y0, D / 2 + WALL + 0.42);
    geo(g, mat.banner, WHITE);
    const a = new THREE.Vector3(px, y0 + 0.05, D / 2 + WALL);
    const b = new THREE.Vector3(px, y0 + 0.05, D / 2 + WALL + 0.5);
    const rod = tube([new THREE.Vector3(px - 0.48, y0 + 0.02, D / 2 + WALL + 0.42), new THREE.Vector3(px + 0.48, y0 + 0.02, D / 2 + WALL + 0.42)], () => 0.022, 6);
    const arm = tube([a, a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, 0.06, 0)), b], () => 0.03, 6);
    const brace = tube([new THREE.Vector3(px, y0 - 0.45, D / 2 + WALL), new THREE.Vector3(px, y0 + 0.02, D / 2 + WALL + 0.42)], () => 0.018, 5);
    geo(mergeGeometries([rod, arm, brace], false)!, mat.iron, undefined);
    geo(lathe([[0, 0], [0.05, 0.01], [0.055, 0.05], [0.03, 0.1], [0, 0.13]], 8).translate(px + 0.5, y0 - 0.04, D / 2 + WALL + 0.42), mat.gold, undefined);
    geo(lathe([[0, 0], [0.05, 0.01], [0.055, 0.05], [0.03, 0.1], [0, 0.13]], 8).translate(px - 0.5, y0 - 0.04, D / 2 + WALL + 0.42), mat.gold, undefined);
  }

  function roof(top: number): void {
    const { span, len, ridge } = roofSpan(spec);
    const lens = ROOF_LENGTHS[span];
    if (!lens) return;
    const L = lens.reduce((a, b) => (Math.abs(b - len) < Math.abs(a - len) ? b : a));
    const over = 0.78 * (len / L);
    // Trim the overhang at party walls shared with an equal roofline (eaves roofs only).
    const tl = ridge === 'x' && spec.trim?.left ? over : 0;
    const tr = ridge === 'x' && spec.trim?.right ? over : 0;
    const full = len + 2 * over;
    const sLen = (full - tl - tr) / full;
    const shift = (tl - tr) / 2;
    const scale = v(1, 1, (len / L) * sLen);
    if (ridge === 'x') put(village, `Roof_RoundTiles_${span}x${L}`, st.paint, st.roof, shift, top, 0, Math.PI / 2, scale);
    else put(village, `Roof_RoundTiles_${span}x${L}`, st.paint, st.roof, 0, top, 0, 0, scale);
    // Plastered gables without the kit's timbers; left out against a neighbour of the same roofline.
    const gable = `Roof_Front_Brick${span}`;
    const gOver = k.over.plaster;
    const gt = st.t;
    if (ridge === 'z') {
      put(village, gable, gOver, gt, 0, top, D / 2, 0);
      if (!hidden('back', 0, F)) put(village, gable, gOver, gt, 0, top, -D / 2, Math.PI);
      finial(0, top + RIDGE[span] + 0.02, D / 2 + 0.55, 1);
    } else {
      if (!spec.trim?.right && !hidden('right', 0, F)) put(village, gable, gOver, gt, W / 2, top, 0, Math.PI / 2);
      if (!spec.trim?.left && !hidden('left', 0, F)) put(village, gable, gOver, gt, -W / 2, top, 0, -Math.PI / 2);
      if (!spec.trim?.left && !spec.trim?.right && r() < 0.5) finial(r() < 0.5 ? -W / 2 - 0.6 : W / 2 + 0.6, top + RIDGE[span] + 0.02, 0, 0.8);
    }
    // Dormers on the street slope of deep eaves roofs.
    if (ridge === 'x' && span >= 6) {
      const n = W >= 6 ? (r() < 0.5 ? 2 : 1) : r() < 0.6 ? 1 : 0;
      for (let j = 0; j < n; j++) {
        const dx = n === 1 ? (r() - 0.5) * (W - 3) : (j === 0 ? -1 : 1) * (W / 4);
        put(village, 'Roof_Dormer_RoundTile', st.paint, glassTint(st.roof), dx, top + 0.95, span / 2 - 1.95, -Math.PI / 2);
      }
    }
    // Chimney stacks on the party walls, through the ridge.
    const rh = RIDGE[span];
    const stacks = r() < 0.55 ? 2 : 1;
    for (let j = 0; j < stacks; j++) {
      const sideSign = j === 0 ? (spec.seed % 2 ? 1 : -1) : spec.seed % 2 ? -1 : 1;
      const [cx, cz] = ridge === 'x' ? [sideSign * (W / 2 - 0.55), (r() - 0.5) * 0.8] : [sideSign * 0.3 + (r() - 0.5) * 0.4, -D / 4 - r() * D * 0.2];
      const h = rh + 0.9 + r() * 0.6 - (ridge === 'z' ? 0 : 0.1);
      put(village, 'Prop_Chimney2', st.wall, st.t, cx, top - 0.4, cz, (spec.seed % 4) * (Math.PI / 2), v(0.85, (h + 0.4) / 3, 0.85));
    }
  }

  /** A gilded finial: turned spike and orb on the gable peak; corner houses fly a weathervane. */
  function finial(x: number, y: number, z: number, s: number): void {
    const g = lathe([[0, 0], [0.09, 0], [0.11, 0.06], [0.05, 0.14], [0.04, 0.42], [0.1, 0.5], [0.13, 0.6], [0.1, 0.7], [0.04, 0.76], [0.025, 1.05], [0, 1.2]], 10).scale(s, s, s).translate(x, y, z);
    geo(g, mat.gold, undefined);
    if (spec.corner?.left || spec.corner?.right) {
      const arrow = new THREE.Shape([new THREE.Vector2(-0.55, -0.02), new THREE.Vector2(0.32, -0.02), new THREE.Vector2(0.3, -0.12), new THREE.Vector2(0.55, 0), new THREE.Vector2(0.3, 0.12), new THREE.Vector2(0.32, 0.02), new THREE.Vector2(-0.4, 0.02), new THREE.Vector2(-0.55, 0.16), new THREE.Vector2(-0.48, 0), new THREE.Vector2(-0.55, -0.16)]);
      const vane = new THREE.ExtrudeGeometry(arrow, { depth: 0.03, bevelEnabled: false }).translate(0, 0, -0.015).rotateY((spec.seed % 7) * 0.9);
      geo(vane.scale(s, s, s).translate(x, y + 1.0 * s, z), mat.gold, undefined);
    }
  }
}

/**
 * A shop awning `w` wide: the cloth falls `proj` out from the wall and `drop` down, sagging between its stays,
 * finished with a scalloped valance. aCloth carries the stripe coordinate (metres across, along the fall).
 */
export function awningGeometry(w: number, proj: number, drop: number, scallopSeed = 1): THREE.BufferGeometry {
  const nx = Math.max(8, Math.round(w * 6));
  const nz = 6;
  const pos: number[] = [];
  const cloth: number[] = [];
  const idx: number[] = [];
  const sag = (u: number, t: number) => 0.06 * Math.sin(Math.PI * t) * (0.6 + 0.4 * Math.sin(Math.PI * u));
  for (let j = 0; j <= nz; j++) {
    const t = j / nz;
    for (let i = 0; i <= nx; i++) {
      const u = i / nx;
      const x = -w / 2 + w * u;
      pos.push(x, -drop * t - sag(u, t), proj * t);
      cloth.push(x + w / 2, t * Math.hypot(proj, drop));
    }
  }
  const row = nx + 1;
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * row + i;
      idx.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  // Valance: a hanging strip with a scalloped hem.
  const scallop = 0.32 + 0.04 * (scallopSeed % 3);
  const n = Math.max(2, Math.round(w / scallop));
  const s0 = pos.length / 3;
  const vx = nx * 2;
  for (let i = 0; i <= vx; i++) {
    const u = i / vx;
    const x = -w / 2 + w * u;
    const phase = (u * n) % 1;
    const hem = 0.14 + 0.1 * Math.sin(Math.PI * phase);
    const yTop = -drop - sag(u, 1);
    pos.push(x, yTop, proj + 0.005, x, yTop - hem, proj + 0.012);
    const fall = Math.hypot(proj, drop);
    cloth.push(x + w / 2, fall, x + w / 2, fall + hem);
  }
  for (let i = 0; i < vx; i++) {
    const a = s0 + i * 2;
    idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aCloth', new THREE.Float32BufferAttribute(cloth, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A hanging banner `w` wide and `h` long with a swallowtail hem and a soft ripple; aCloth as on awnings. */
export function bannerGeometry(w: number, h: number, seed = 0): THREE.BufferGeometry {
  const nx = 6;
  const ny = 14;
  const pos: number[] = [];
  const cloth: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= ny; j++) {
    const t = j / ny;
    for (let i = 0; i <= nx; i++) {
      const u = i / nx;
      // The swallowtail: the hem rises toward the middle.
      const notch = 0.32 * (1 - Math.abs(u - 0.5) * 2);
      const v = t * (h - notch * Math.pow(t, 6));
      const ripple = 0.05 * Math.sin(u * 5.5 + seed) * t + 0.03 * Math.sin(t * 6 + seed * 1.7) * t;
      pos.push(-w / 2 + w * u, -v, ripple);
      cloth.push(w * u, v);
    }
  }
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aCloth', new THREE.Float32BufferAttribute(cloth, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const PENNANTS = ['#2b5b93', '#f1eadb', '#d9a536', '#2b7884', '#f1eadb', '#3c6fa6'].map(lin);

/** A string of pennants between two facade points, sagging `sag` at the middle. Returns cloth and cord. */
export function buntingGeometry(a: THREE.Vector3, b: THREE.Vector3, sag: number, seed: number): { flags: THREE.BufferGeometry; cord: THREE.BufferGeometry } {
  const len = a.distanceTo(b);
  const at = (t: number) => a.clone().lerp(b, t).add(new THREE.Vector3(0, -4 * sag * t * (1 - t), 0));
  const path = Array.from({ length: 17 }, (_, i) => at(i / 16));
  const cord = tube(path, () => 0.014, 5);
  const pos: number[] = [];
  const col: number[] = [];
  const n = Math.max(3, Math.floor(len / 0.55));
  for (let i = 0; i < n; i++) {
    const t0 = (i + 0.2) / n;
    const t1 = (i + 0.8) / n;
    const p0 = at(t0);
    const p1 = at(t1);
    const tip = at((t0 + t1) / 2).add(new THREE.Vector3(0, -0.36, 0.04 * Math.sin(i * 1.7 + seed)));
    pos.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, tip.x, tip.y, tip.z);
    const c = PENNANTS[(i + seed) % PENNANTS.length];
    for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b, 1);
  }
  const flags = new THREE.BufferGeometry();
  flags.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  flags.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  flags.computeVertexNormals();
  return { flags, cord };
}

// ------------------------------------------------------------------------------------------------
// District planning (pure numbers)

export interface DistrictStreet {
  /** Centre line, at least two points. */
  points: V2[];
  /** Full width of the paving kept clear. */
  width: number;
}
export interface DistrictPlanOptions {
  /** District boundary (any simple polygon, either winding). */
  polygon: V2[];
  streets: DistrictStreet[];
  /** Polygons kept clear of houses: landmarks, plazas, gardens. */
  reserved?: V2[][];
  height: Height;
  seed?: number;
  /** Storey range, default [2, 4]. */
  floors?: [number, number];
  /** Pavement between the street edge and the house fronts (steps and shop goods stand here). */
  setback?: number;
  /**
   * Back lanes fill the blocks behind the street rows: offset copies of the first street, `laneSpacing` apart
   * (0 for none, default 26), clipped to the district and reserved ground. They are returned for paving.
   */
  laneSpacing?: number;
  /** Lane width, default 4. */
  laneWidth?: number;
}
export interface YardProp {
  kit: 'props' | 'nature' | 'village';
  piece: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  s: number;
  /** Collider half size, 0 for walk-through dressing. */
  solid: number;
}
export interface DistrictPlan {
  houses: TownhouseSpec[];
  lots: TownhouseLot[];
  yards: YardProp[];
  colliders: TidecrownCollider[];
  /** Generated back lanes (keep them clear and pave them like streets). */
  lanes: DistrictStreet[];
}

/** A polyline offset sideways by `d` (left of travel for d > 0). */
function offsetLine(pts: readonly V2[], d: number): V2[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [p[0] - ((b[1] - a[1]) / l) * d, p[1] + ((b[0] - a[0]) / l) * d] as V2;
  });
}
/** Points every `step` along a polyline, its ends pushed out by `extend`. */
function resample(pts: readonly V2[], step: number, extend = 0): V2[] {
  const line = pts.map((p) => [...p] as V2);
  const push = (i: number, j: number) => {
    const l = Math.hypot(line[i][0] - line[j][0], line[i][1] - line[j][1]) || 1;
    line[i] = [line[i][0] + ((line[i][0] - line[j][0]) / l) * extend, line[i][1] + ((line[i][1] - line[j][1]) / l) * extend];
  };
  if (extend) {
    push(0, 1);
    push(line.length - 1, line.length - 2);
  }
  const out: V2[] = [line[0]];
  let carry = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const l = Math.hypot(bx - ax, bz - az);
    let t = step - carry;
    for (; t <= l; t += step) out.push([ax + ((bx - ax) * t) / l, az + ((bz - az) * t) / l]);
    carry = l - (t - step);
  }
  return out;
}

export function pointInPoly(x: number, z: number, poly: readonly V2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
export function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l));
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}
function segsCross(a: V2, b: V2, c: V2, d: V2): boolean {
  const o = (p: V2, q: V2, r: V2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
/** Distance between two polygons' outlines, 0 when they overlap. */
export function polyDist(a: readonly V2[], b: readonly V2[]): number {
  if (a.some(([x, z]) => pointInPoly(x, z, b)) || b.some(([x, z]) => pointInPoly(x, z, a))) return 0;
  let d = Infinity;
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const s = b[j];
      const t = b[(j + 1) % b.length];
      if (segsCross(p, q, s, t)) return 0;
      d = Math.min(d, segDist(p[0], p[1], s[0], s[1], t[0], t[1]), segDist(s[0], s[1], p[0], p[1], q[0], q[1]));
    }
  }
  return d;
}
/** Distance between two outlines, ignoring containment (a point well inside a polygon is far from it). */
export function outlineDist(a: readonly V2[], b: readonly V2[]): number {
  let d = Infinity;
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const s = b[j];
      const t = b[(j + 1) % b.length];
      if (segsCross(p, q, s, t)) return 0;
      d = Math.min(d, segDist(p[0], p[1], s[0], s[1], t[0], t[1]), segDist(s[0], s[1], p[0], p[1], q[0], q[1]));
    }
  }
  return d;
}
/** Distance from a point to a polyline. */
export function lineDist(x: number, z: number, line: readonly V2[]): number {
  let d = Infinity;
  for (let j = 0; j < line.length - 1; j++) d = Math.min(d, segDist(x, z, line[j][0], line[j][1], line[j + 1][0], line[j + 1][1]));
  return d;
}
/** Distance from a polygon to a polyline (0 when it crosses or lies inside). */
export function polyLineDist(poly: readonly V2[], line: readonly V2[]): number {
  if (line.some(([x, z]) => pointInPoly(x, z, poly))) return 0;
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    for (let j = 0; j < line.length - 1; j++) {
      const s = line[j];
      const t = line[j + 1];
      if (segsCross(p, q, s, t)) return 0;
      d = Math.min(d, segDist(p[0], p[1], s[0], s[1], t[0], t[1]), segDist(s[0], s[1], p[0], p[1], q[0], q[1]));
    }
  }
  return d;
}
function rectCorners(x: number, z: number, hx: number, hz: number, yaw: number): V2[] {
  return [atLocal({ x, z, yaw }, -hx, hz), atLocal({ x, z, yaw }, hx, hz), atLocal({ x, z, yaw }, hx, -hz), atLocal({ x, z, yaw }, -hx, -hz)];
}
/** Separating-axis overlap of two convex quads, with `tol` of allowed interpenetration (touching walls). */
export function quadsOverlap(a: readonly V2[], b: readonly V2[], tol = 0.02): boolean {
  for (const poly of [a, b])
    for (let i = 0; i < 4; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % 4];
      const nx = -(q[1] - p[1]);
      const nz = q[0] - p[0];
      const l = Math.hypot(nx, nz) || 1;
      let a0 = Infinity;
      let a1 = -Infinity;
      let b0 = Infinity;
      let b1 = -Infinity;
      for (const [x, z] of a) {
        const d = (x * nx + z * nz) / l;
        a0 = Math.min(a0, d);
        a1 = Math.max(a1, d);
      }
      for (const [x, z] of b) {
        const d = (x * nx + z * nz) / l;
        b0 = Math.min(b0, d);
        b1 = Math.max(b1, d);
      }
      if (a1 - tol <= b0 || b1 - tol <= a0) return false;
    }
  return true;
}

/**
 * Lay out townhouses along both sides of every street segment inside the district: fronts a pavement back from
 * the street, row houses wall to wall with small setbacks and varied heights, corner houses where a row meets a
 * cross street, nothing on reserved ground. Then work out party walls, equal rooflines and the yards behind.
 */
export function planDistrict(o: DistrictPlanOptions): DistrictPlan {
  const r = stream(o.seed ?? 1);
  const [fMin, fMax] = o.floors ?? [2, 4];
  const setback = o.setback ?? 0.9;
  const reserved = o.reserved ?? [];
  const laneW = o.laneWidth ?? 4;
  const laneBack = 0.6;
  const houses: TownhouseSpec[] = [];
  const quads: V2[][] = [];

  // Back lanes: two rows (8 deep at most) and a yard between each lane and the next street or lane.
  const lanes: DistrictStreet[] = [];
  const spacing = o.laneSpacing ?? 26;
  if (spacing > 0 && o.streets.length) {
    const main = o.streets[0];
    const yard = Math.max(2, spacing - laneW - 2 * laneBack - 16);
    const first = main.width / 2 + setback + 16 + yard + laneBack + laneW / 2;
    for (const side of [1, -1])
      for (let k = 0; k < 8; k++) {
        const d = side * (first + k * spacing);
        const pts = resample(offsetLine(main.points, d), 1, 80);
        const keep = (x: number, z: number) =>
          pointInPoly(x, z, o.polygon) &&
          outlineDist([[x, z]], o.polygon) > 3 &&
          reserved.every((p) => polyDist([[x, z]], p) > 2) &&
          lineDist(x, z, main.points) > Math.abs(d) - 2 &&
          o.streets.every((st) => st === main || lineDist(x, z, st.points) > st.width / 2 + 0.5) &&
          lanes.every((ln) => lineDist(x, z, ln.points) > laneW + 4);
        let run: V2[] = [];
        const flush = () => {
          if (run.length >= 16) lanes.push({ points: run.filter((_, i) => i % 5 === 0 || i === run.length - 1), width: laneW });
          run = [];
        };
        for (const [x, z] of pts) {
          if (keep(x, z)) run.push([x, z]);
          else flush();
        }
        flush();
      }
  }
  const lanesSet = new Set(lanes);
  const corridors = [...o.streets, ...lanes];
  const backOf = (c: DistrictStreet) => (lanesSet.has(c) ? laneBack : setback);

  const near = (x: number, z: number) => Math.min(...reserved.map((p) => polyDist([[x, z]], p)), 99);
  // Clear of every corridor: its own pavement in front, at least half a metre to any other.
  const corridorsClear = (q: V2[], own: DistrictStreet) => corridors.every((c) => polyLineDist(q, c.points) >= c.width / 2 + (c === own ? backOf(c) - 0.2 : Math.min(0.5, backOf(c))));
  // `q` is the footprint on the module lines, `e` the same grown past the wall faces and trims.
  const fits = (q: V2[], e: V2[], own: DistrictStreet) =>
    e.every(([x, z]) => pointInPoly(x, z, o.polygon)) &&
    outlineDist(e, o.polygon) > 0.3 &&
    corridorsClear(e, own) &&
    reserved.every((p) => polyDist(e, p) >= 0.4) &&
    quads.every((b) => !quadsOverlap(q, b));
  let id = 0;
  corridors.forEach((st, si) => {
    const lane = lanesSet.has(st);
    for (let k = 0; k < st.points.length - 1; k++) {
      const [ax, az] = st.points[k];
      const [bx, bz] = st.points[k + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.5) continue;
      const tx = (bx - ax) / len;
      const tz = (bz - az) / len;
      for (const side of [1, -1]) {
        const nx = -tz * side;
        const nz = tx * side;
        // Local +z (sin yaw, cos yaw) faces the street.
        const yaw = Math.atan2(-nx, -nz);
        let u = 0;
        let prevFloors = -1;
        while (u < len) {
          let placed = false;
          const widths = r() < 0.5 ? [2, 3, 4, 2] : r() < 0.6 ? [3, 2, 4] : [4, 3, 2];
          for (const w of widths) {
            for (const d of r() < 0.55 ? [3, 4, 2] : [4, 3, 2]) {
              const hx = w;
              const hz = d;
              if (u + 2 * hx > len + 1.5) continue;
              const jog = r() < 0.3 ? pick(r, [0.25, 0.4, 0.15]) : 0;
              const off = st.width / 2 + backOf(st) + jog;
              const cx = ax + tx * (u + hx) + nx * (off + hz);
              const cz = az + tz * (u + hx) + nz * (off + hz);
              const q = rectCorners(cx, cz, hx, hz, yaw);
              if (!fits(q, rectCorners(cx, cz, hx + 0.2, hz + 0.2, yaw), st)) continue;
              const plaza = near(cx, cz);
              let floors = Math.round((lane ? 2.0 : 2.4) + 1.6 * r() + (plaza < 18 ? 0.8 : 0) + (si === 0 ? 0.3 : 0));
              if (floors === prevFloors && r() < 0.6) floors += r() < 0.5 ? -1 : 1;
              floors = Math.max(fMin, Math.min(fMax, floors));
              prevFloors = floors;
              const seed = Math.floor(r() * 1e6) + id * 7919;
              houses.push({
                x: cx,
                z: cz,
                yaw,
                width: w,
                depth: d,
                floors,
                seed,
                ground: 0,
                shop: floors >= 2 && r() < (lane ? 0.08 : plaza < 25 ? 0.6 : 0.3),
                balcony: floors >= 3 && r() < (lane ? 0.2 : 0.4),
                banner: !lane && floors >= 3 && r() < 0.3,
                roof: w <= 3 && r() < 0.45 ? 'gable' : 'eaves',
              });
              quads.push(q);
              id++;
              u += 2 * hx;
              placed = true;
              break;
            }
            if (placed) break;
          }
          if (!placed) {
            u += 1;
            prevFloors = -1;
          }
        }
      }
    }
  });

  // Ground: the floor sits a step above the street at the door; the plinth hides the slope below.
  for (const h of houses) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let i = 0; i <= 4; i++)
      for (let j = 0; j <= 4; j++) {
        const [x, z] = atLocal(h, (i / 4 - 0.5) * h.width * 2, (j / 4 - 0.5) * h.depth * 2);
        const y = o.height(x, z);
        hi = Math.max(hi, y);
        lo = Math.min(lo, y);
      }
    const [dx, dz] = atLocal(h, -h.width + 1 + 2 * doorIndex(h), h.depth + 0.5);
    const door = o.height(dx, dz);
    h.ground = Math.min(Math.max(hi, door + 0.12), door + 0.65);
    h.base = lo;
    h.doorstep = door;
  }

  // Party walls: a side module is hidden up to the storeys of whatever house covers its whole face.
  const lots = houses.map(townhouseLot);
  const covers = (x: number, z: number, self: number) => {
    let best = 0;
    lots.forEach((l, j) => {
      if (j !== self && pointInPoly(x, z, l.corners)) best = Math.max(best, l.spec.floors + (l.spec.ground - houses[self].ground) / H);
    });
    return best;
  };
  houses.forEach((h, n) => {
    const W = h.width * 2;
    const D = h.depth * 2;
    const party: Required<NonNullable<TownhouseSpec['party']>> = { left: [], right: [], back: [] };
    for (const side of ['left', 'right', 'back'] as const) {
      const sf = sideFrame(side, W, D);
      const c = Math.cos(sf.yaw);
      const s = Math.sin(sf.yaw);
      for (let i = 0; i < sf.count; i++) {
        const [x, z] = sf.at(i);
        // Both ends of the module, pushed out past the wall.
        const ends = [-0.85, 0.85].map((t) => atLocal(h, x + c * t + s * 0.3, z - s * t + c * 0.3));
        const f = Math.min(...ends.map(([px, pz]) => covers(px, pz, n)));
        party[side].push(Math.floor(f + 0.01));
      }
    }
    h.party = party;
    // Corner sides: exposed and facing a street.
    const facing = (lx: number, lz: number) => {
      const [px, pz] = atLocal(h, lx, lz);
      return corridors.some((c) => lineDist(px, pz, c.points) < c.width / 2 + 0.5);
    };
    h.corner = {
      left: party.left.every((p) => p === 0) && facing(-W / 2 - 2.5, 0),
      right: party.right.every((p) => p === 0) && facing(W / 2 + 2.5, 0),
      back: party.back.every((p) => p === 0) && facing(0, -D / 2 - 2.5),
    };
  });
  // Equal rooflines along a row: trim the overhangs where two eaves roofs meet.
  houses.forEach((h, n) => {
    if (h.roof !== 'eaves') return;
    for (const side of ['left', 'right'] as const) {
      const [px, pz] = atLocal(h, (side === 'left' ? -1 : 1) * (h.width + 0.6), 0);
      const j = lots.findIndex((l, jj) => jj !== n && pointInPoly(px, pz, l.corners));
      if (j < 0) continue;
      const b = houses[j];
      const same = b.roof === 'eaves' && b.depth === h.depth && Math.abs(b.ground + b.floors * H - (h.ground + h.floors * H)) < 0.05 && Math.abs(Math.sin(b.yaw - h.yaw)) < 0.05;
      if (same) (h.trim ??= {})[side] = true;
    }
  });

  // Courtyards behind the rows: barrels, crates, benches, potted shrubs and the odd tree, where there is room.
  const yards: YardProp[] = [];
  const all = houses.map(townhouseLot);
  const free = (x: number, z: number, m: number) =>
    pointInPoly(x, z, o.polygon) &&
    outlineDist([[x, z]], o.polygon) > m &&
    all.every((l) => polyDist([[x, z]], l.corners) > m) &&
    reserved.every((p) => polyDist([[x, z]], p) > m) &&
    corridors.every((c) => lineDist(x, z, c.points) > c.width / 2 + backOf(c) + m) &&
    yards.every((y) => Math.hypot(y.x - x, y.z - z) > 1.4);
  for (const h of houses) {
    if (r() < 0.35) continue;
    const n = 1 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const [x, z] = atLocal(h, (r() - 0.5) * h.width * 1.6, -h.depth - WALL - 1.0 - r() * 2.2);
      if (!free(x, z, 0.8)) continue;
      const q = r();
      const [kit, piece, s, solid]: [YardProp['kit'], string, number, number] =
        q < 0.1 ? ['nature', pick(r, ['CommonTree_3', 'CommonTree_5']), 0.5 + r() * 0.15, 0.45] :
        q < 0.4 ? ['nature', pick(r, ['Bush_Common_Flowers', 'Bush_Common', 'Flower_4_Group', 'Flower_3_Group']), 0.55 + r() * 0.3, 0] :
        q < 0.6 ? ['village', 'Prop_Crate', 0.7, 0.4] :
        q < 0.75 ? ['props', 'Bench', 0.85, 0.5] :
        q < 0.88 ? ['props', pick(r, ['Vase_2', 'Vase_4', 'Bucket_Wooden_1', 'Pot_1']), 1, 0] :
        ['props', pick(r, ['Table_Large', 'Workbench', 'Barrel_Holder']), 0.85, 0.7];
      yards.push({ kit, piece, x, y: o.height(x, z), z, yaw: h.yaw + (r() - 0.5) * 0.8, s, solid });
    }
  }

  const colliders: TidecrownCollider[] = all.map(townhouseCollider);
  for (const y of yards) if (y.solid > 0) colliders.push({ x: y.x, z: y.z, hx: y.solid, hz: y.solid, c: Math.cos(y.yaw), s: Math.sin(y.yaw), y0: y.y - 1, y1: y.y + 2 });
  return { houses, lots: all, yards, colliders, lanes };
}

// ------------------------------------------------------------------------------------------------
// Districts

export interface DistrictOptions extends DistrictPlanOptions {
  kit: TidecrownKit;
  /** Pennant strings across the streets between facing houses (default on). */
  bunting?: boolean;
  /** Batches per axis over the district's bounds: 2 x 2 quarters by default. */
  chunks?: [number, number];
  name?: string;
}
export interface District {
  group: THREE.Group;
  lots: TownhouseLot[];
  colliders: TidecrownCollider[];
  /** Lantern anchors beside doors (world). */
  lamps: { x: number; y: number; z: number; yaw: number }[];
  /** Back lanes the district added between its rows (pave and keep clear like streets). */
  lanes: DistrictStreet[];
  stats: { houses: number; meshes: number; triangles: number; pieces: Record<string, number> };
}

/** Distance along a ray to the nearest house front (and that house), within `max`. */
function rayToLot(lots: TownhouseLot[], x: number, z: number, dx: number, dz: number, max: number): { t: number; lot: TownhouseLot } | null {
  let best: { t: number; lot: TownhouseLot } | null = null;
  for (const lot of lots) {
    const c = lot.corners;
    for (let i = 0; i < 4; i++) {
      const [ax, az] = c[i];
      const [bx, bz] = c[(i + 1) % 4];
      const ex = bx - ax;
      const ez = bz - az;
      const den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((ax - x) * ez - (az - z) * ex) / den;
      const u = ((ax - x) * dz - (az - z) * dx) / den;
      if (t > 0 && t < max && u >= 0 && u <= 1 && (!best || t < best.t)) best = { t, lot };
    }
  }
  return best;
}

/** Strings of pennants across each street, from one house front to the facing one, every dozen metres or so. */
function bunting(o: DistrictOptions, plan: DistrictPlan, chunkOf: (x: number, z: number) => TideBatch): void {
  const r = stream((o.seed ?? 1) + 77);
  const setback = o.setback ?? 0.9;
  for (const st of o.streets) {
    const pts = resample(st.points, 1);
    for (let i = 6 + Math.floor(r() * 6); i < pts.length - 2; i += 10 + Math.floor(r() * 6)) {
      const [x, z] = pts[i];
      const [nx2, nz2] = pts[i + 1];
      const l = Math.hypot(nx2 - x, nz2 - z) || 1;
      const nx = -(nz2 - z) / l;
      const nz = (nx2 - x) / l;
      const max = st.width / 2 + setback + 1.2;
      const a = rayToLot(plan.lots, x, z, nx, nz, max);
      const b = rayToLot(plan.lots, x, z, -nx, -nz, max);
      if (!a || !b) continue;
      const y = (lot: TownhouseLot) => lot.spec.ground + Math.min(lot.spec.floors - 1, 2) * H - 0.45;
      const pa = new THREE.Vector3(x + nx * (a.t + WALL - 0.02), y(a.lot), z + nz * (a.t + WALL - 0.02));
      const pb = new THREE.Vector3(x - nx * (b.t + WALL - 0.02), y(b.lot), z - nz * (b.t + WALL - 0.02));
      const g = buntingGeometry(pa, pb, 0.45 + r() * 0.35, Math.floor(r() * 6));
      const batch = chunkOf(x, z);
      batch.addGeometry(g.flags, o.kit.mat.pennant, null, false);
      batch.addGeometry(g.cord, o.kit.mat.iron, null, false);
    }
  }
}

/** Plan and build a district of townhouses, one batch per quarter. Deterministic from `seed`. */
export function fillDistrict(o: DistrictOptions): District {
  const plan = planDistrict(o);
  const name = o.name ?? 'tidecrown-district';
  const group = new THREE.Group();
  group.name = name;
  const [cx, cz] = o.chunks ?? [2, 2];
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const [x, z] of o.polygon) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z);
  }
  const batches: TideBatch[] = [];
  const chunkOf = (x: number, z: number) => {
    const i = Math.min(cx - 1, Math.max(0, Math.floor(((x - x0) / (x1 - x0 || 1)) * cx)));
    const j = Math.min(cz - 1, Math.max(0, Math.floor(((z - z0) / (z1 - z0 || 1)) * cz)));
    const k = j * cx + i;
    return (batches[k] ??= new TideBatch(o.kit, `${name}:quarter-${i}-${j}`));
  };
  const extras: HouseExtras = { colliders: [], lamps: [] };
  for (const h of plan.houses) buildTownhouse(h, chunkOf(h.x, h.z), extras);
  const m = new THREE.Matrix4();
  for (const y of plan.yards) {
    const kit = o.kit[y.kit];
    const over = y.kit === 'props' ? o.kit.over.props : y.kit === 'nature' ? o.kit.over.nature : o.kit.over.wall;
    m.copy(trs(y.x, y.y - 0.02, y.z, y.yaw, y.s));
    chunkOf(y.x, y.z).put(kit, y.piece, m, over, null, true);
  }
  if (o.bunting !== false) bunting(o, plan, chunkOf);
  for (const b of batches) if (b) group.add(b.build());
  let meshes = 0;
  let triangles = 0;
  group.traverse((ob) => {
    const mesh = ob as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshes++;
    triangles += (mesh.geometry.getIndex()?.count ?? mesh.geometry.getAttribute('position').count) / 3;
  });
  const pieces = new Map<string, number>();
  for (const b of batches) if (b) for (const [p, t] of b.pieceTris) pieces.set(p, (pieces.get(p) ?? 0) + t);
  const top = Object.fromEntries([...pieces].sort((a, b) => b[1] - a[1]).slice(0, 14));
  return { group, lots: plan.lots, colliders: [...plan.colliders, ...extras.colliders], lamps: extras.lamps, lanes: plan.lanes, stats: { houses: plan.houses.length, meshes, triangles, pieces: top } };
}
