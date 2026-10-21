// Tidecrown's townhouses: tall limestone and plaster row houses under sea-blue round tiles, assembled from the
// Medieval Village MegaKit and its props and nature kits (CC0, see NOTICE.md). Kit materials are shared with
// World 1, so Tidecrown recolours its own clones; per-house colours ride on vertex colour, so a whole quarter of
// the city is still one draw per material. planDistrict lays the rows out as plain numbers (lots and colliders,
// also usable without the kit); fillDistrict builds them into distance-LOD chunks (lod.ts): the kit up close, a
// few hundred triangles a house beyond the switch distance, every chunk of a material in one multi-draw.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { lathe, tube, worldBox } from '../../world/geom';
import { harmonise, type Kit, loadKit, type Piece, StaticBatch, trs } from '../../world/kit';
import { addPatch, stylise } from '../../world/materials';
import { GLSL_NOISE } from '../../world/noise';
import { FarBatch, type LodOptions, TidecrownLod } from './lod';

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
  /** The same glass for far-build window decals, offset in depth so it stays in front of its wall. */
  farGlass: THREE.MeshStandardMaterial;
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

/** A varying `name` with the world position, batched and instanced meshes included. */
function worldVarying(shader: THREE.WebGLProgramParametersWithUniforms, name: string): void {
  shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\nvarying vec3 ${name};`).replace(
    '#include <worldpos_vertex>',
    `#include <worldpos_vertex>
    {
      vec4 w = vec4(transformed, 1.0);
      #ifdef USE_BATCHING
        w = batchingMatrix * w;
      #endif
      #ifdef USE_INSTANCING
        w = instanceMatrix * w;
      #endif
      ${name} = (modelMatrix * w).xyz;
    }`,
  );
}

/**
 * The wood trim as dressed stone: its grain (stretched down a tall quoin) gives way to the ashlar's blocks, laid in the
 * world along each face (triplanar) and graded onto the same ramp; the vertex colour still tints and shades it.
 */
function dressedStone(mat: THREE.MeshStandardMaterial, ashlar: THREE.Texture | null, dark: string, light: string): void {
  if (!ashlar) return;
  const tex = ashlar.clone();
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.userData.tidecrown = true;
  mat.normalMap = null;
  addPatch(mat, 'tc-dressed-stone', (shader) => {
    shader.uniforms.uTsAshlar = { value: tex };
    worldVarying(shader, 'vTsW');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vTsW;\nuniform sampler2D uTsAshlar;').replace(
      '#include <color_fragment>',
      `{
        vec3 n = normalize(cross(dFdx(vTsW), dFdy(vTsW)));
        vec3 w = pow(abs(n), vec3(4.0));
        w /= w.x + w.y + w.z;
        vec3 a = texture2D(uTsAshlar, vTsW.zy * 0.5).rgb * w.x + texture2D(uTsAshlar, vTsW.xz * 0.5).rgb * w.y + texture2D(uTsAshlar, vTsW.xy * 0.5).rgb * w.z;
        diffuseColor.rgb = mix(${glslVec(lin(dark))}, ${glslVec(lin(light))}, smoothstep(0.15, 0.36, dot(a, vec3(0.299, 0.587, 0.114))));
      }
      #include <color_fragment>`,
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

function glassMaterial(decal = false): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ name: decal ? 'tidecrown-far-glass' : 'tidecrown-glass', color: '#3a4656', emissive: '#ffb066', emissiveIntensity: 2.3, roughness: 0.12, metalness: 0.55, vertexColors: true });
  // Vertex colour red is the light inside each window (0 dark .. 1 lamp-lit); the pane itself stays dark glass.
  // Far windows (vertex alpha 0) are decals on an uncut wall: uv counts panes from the glass corner, colour green
  // and blue carry columns / 8 and rows / 8, and the shader paints the glazing bars and the frame around them.
  // The decal material is offset to stay in front of its wall at any distance.
  m.polygonOffset = decal;
  m.polygonOffsetFactor = -1;
  m.polygonOffsetUnits = -4;
  addPatch(m, 'tc-glass', (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vPane;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvPane = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPane;')
      .replace(
        '#include <color_fragment>',
        `float cLit = 0.0;
        float cBar = 0.0;
        #ifdef USE_COLOR
          cLit = vColor.r;
          #ifdef USE_COLOR_ALPHA
          if (vColor.a < 0.5) {
            vec2 n = vColor.gb * 8.0;
            vec2 f = fract(vPane);
            vec2 d = min(f, 1.0 - f);
            vec2 aa = max(fwidth(vPane), vec2(1e-4));
            vec2 cov = clamp((0.07 - d) / aa + 0.5, 0.0, 1.0);
            // Bars thinner than a pixel fade to their share of the pane.
            cov = mix(cov, vec2(0.14), clamp(aa * 3.0 - 0.6, 0.0, 1.0));
            cBar = max(cov.x, cov.y);
            // The frame: anywhere outside the panes.
            vec2 out2 = step(vPane, vec2(0.0)) + step(n, vPane);
            cBar = max(cBar, min(out2.x + out2.y, 1.0));
          }
          #endif
        #endif
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.6, 0.58, 0.54), cBar);`,
      )
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= 1.0 - cBar;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.75, cBar);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= cLit * cLit * (1.0 - cBar);');
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
    // The rubble at twice the kit's density, so its stones sit at about one and a half of the ashlar blocks beside it.
    for (const slot of ['map', 'normalMap', 'roughnessMap'] as const) {
      const t = limestone[slot]?.clone();
      if (!t) continue;
      t.repeat.multiplyScalar(2);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.userData.tidecrown = true;
      limestone[slot] = t;
    }
    const ashlar = kitClone(vm('MI_Brick'), 'tidecrown-ashlar');
    grade(ashlar, 'ashlar', 0.15, 0.36, '#b4aa95', '#f4ede0');
    const rock = kitClone(vm('MI_RockTrim'), 'tidecrown-rock');
    grade(rock, 'rock', 0.13, 0.43, '#a39983', '#f3ecdc');
    const stone = kitClone(vm('MI_WoodTrim'), 'tidecrown-stone-trim');
    grade(stone, 'stone', 0.05, 0.4, '#b9ae98', '#f6efe0');
    dressedStone(stone, (vm('MI_Brick') as THREE.MeshStandardMaterial).map, '#b9ae98', '#f6efe0');
    const paint = kitClone(vm('MI_WoodTrim'), 'tidecrown-paint');
    grade(paint, 'paint', 0.05, 0.4, '#8f8f8f', '#ffffff');
    const tiles = kitClone(vm('MI_RoundTiles'), 'tidecrown-tiles');
    grade(tiles, 'tiles', 0.11, 0.27, '#454545', '#ececec');
    tiles.roughness = 0.62;
    // Weathering across each roof: patches a shade lighter or darker, a little moss toward the eaves.
    addPatch(tiles, 'tc-tile-weather', (shader) => {
      worldVarying(shader, 'vTwW');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vTwW;\n${GLSL_NOISE}`).replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float n = cc_vnoise(vTwW.xz * 0.21 + vTwW.y * 0.13) * 0.65 + cc_vnoise(vTwW.xz * 0.9 - vTwW.y * 0.4) * 0.35;
          diffuseColor.rgb *= 0.8 + 0.4 * n;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.78, 1.0, 0.72), smoothstep(0.62, 0.85, cc_vnoise(vTwW.xz * 0.37 + 5.1)) * 0.6);
          // Ridge caps (the tiles that lie flat) are paler, mortar-bedded, and catch the low sun.
          float ridge = smoothstep(0.86, 0.97, abs(normalize(cross(dFdx(vTwW), dFdy(vTwW))).y));
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.5 + vec3(0.05, 0.045, 0.04), ridge * 0.8);
        }`,
      );
    });
    const iron = kitClone(vm('MI_MetalOrnaments'), 'tidecrown-iron', false);
    iron.color.set('#5a5e66');
    const vine = kitClone(vm('MI_Vine'), 'tidecrown-vine', false);
    vine.side = THREE.DoubleSide;
    const gold = new THREE.MeshStandardMaterial({ name: 'tidecrown-gold', color: '#e0ad48', metalness: 0.9, roughness: 0.28 });
    const pennant = new THREE.MeshStandardMaterial({ name: 'tidecrown-pennant', color: '#ffffff', roughness: 0.8, side: THREE.DoubleSide, vertexColors: true });
    const mat: TidecrownMaterials = { plaster, limestone, ashlar, rock, stone, paint, tiles, glass: glassMaterial(), farGlass: glassMaterial(true), iron, gold, awning: clothMaterial(), banner: bannerMaterial(), pennant, vine };
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

const indoorCut = new Map<string, THREE.BufferGeometry>();
/**
 * A wall-mounted kit part without the triangles that face into the house from behind the wall plane (piece-local
 * +z is out, z = 0 the outer face): the kit's interior plaster, inner frames and the backs of doors. Houses are
 * closed (glass, doors and the shop boxes fill every opening), so nothing outside ever sees them.
 */
function cutIndoor(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  let out = indoorCut.get(geo.uuid);
  if (!out) indoorCut.set(geo.uuid, (out = filterTriangles(geo, (a, b, c, n) => !(n.z < -0.3 * n.length() && (a.z + b.z + c.z) / 3 < -0.02))));
  return out;
}

/** `geo` keeping the triangles `keep` accepts (corners and unnormalised normal), compacted. */
function filterTriangles(geo: THREE.BufferGeometry, keep: (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, n: THREE.Vector3) => boolean): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const index = geo.getIndex();
  if (!index) return geo;
  const kept: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let t = 0; t < index.count; t += 3) {
    const i0 = index.getX(t);
    const i1 = index.getX(t + 1);
    const i2 = index.getX(t + 2);
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
    if (keep(a, b, c, n)) kept.push(i0, i1, i2);
  }
  if (kept.length === index.count) return geo;
  const remap = new Map<number, number>();
  const idx = kept.map((i) => {
    let j = remap.get(i);
    if (j === undefined) remap.set(i, (j = remap.size));
    return j;
  });
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) {
    const src = attr as THREE.BufferAttribute;
    const arr = new Float32Array(remap.size * src.itemSize);
    for (const [from, to] of remap) for (let k = 0; k < src.itemSize; k++) arr[to * src.itemSize + k] = src.array[from * src.itemSize + k] as number;
    out.setAttribute(name, new THREE.BufferAttribute(arr, src.itemSize));
  }
  out.setIndex(idx);
  return out;
}

type MergedPart = ReturnType<StaticBatch['merge']>[number];

/**
 * A StaticBatch that takes pieces from any of Tidecrown's kits, with overrides and per-placement tints. It keeps its
 * own lists so the merge can go a material at a time (mergeSteps) for a chunk built over several frames.
 */
export class TideBatch extends StaticBatch {
  constructor(
    readonly tide: TidecrownKit,
    name: string,
  ) {
    super(tide.village, name);
  }

  private tints = new Map<string, THREE.BufferGeometry>();
  private parts = new Map<THREE.Material, [THREE.BufferGeometry[], THREE.BufferGeometry[]]>();
  /** Triangles placed per kit piece, for budgeting. */
  readonly pieceTris = new Map<string, number>();

  /** Place a kit piece; `indoor` false drops what faces into a closed house behind the wall (see cutIndoor). */
  put(kit: Kit, piece: string, m: THREE.Matrix4, over: Over, tint?: Tint | null, castShadow = true, indoor = true): void {
    for (const part of kit.get(piece).parts) {
      const mat = part.material.name in over ? over[part.material.name] : part.material;
      if (!mat) continue;
      const src = indoor ? part.geometry : cutIndoor(part.geometry);
      this.pieceTris.set(piece, (this.pieceTris.get(piece) ?? 0) + (src.getIndex()?.count ?? 0) / 3);
      const geo = (mat as THREE.MeshStandardMaterial).vertexColors ? withColor(src, tint?.get(mat) ?? WHITE, this.tints) : src;
      this.keep(geo, mat, m, castShadow);
    }
  }

  private keep(geo: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4 | null, castShadow: boolean): void {
    let e = this.parts.get(mat);
    if (!e) this.parts.set(mat, (e = [[], []]));
    const g = geo.clone();
    if (m) g.applyMatrix4(m);
    e[castShadow ? 0 : 1].push(g);
  }

  override addGeometry(geo: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4 | null, castShadow = true, color?: THREE.Color): void {
    // Vertex-coloured materials need the attribute on every geometry they merge.
    if ((mat as THREE.MeshStandardMaterial).vertexColors && (color || !geo.getAttribute('color'))) geo = withColor(geo, color ?? WHITE, null);
    this.keep(geo, mat, m, castShadow);
  }

  override merge(): MergedPart[] {
    const steps = this.mergeSteps();
    for (let s = steps.next(); ; s = steps.next()) if (s.done) return s.value;
  }

  /** merge() a material and shadow flag at a time, yielding before each. */
  *mergeSteps(): Generator<void, MergedPart[]> {
    this.tints.clear();
    const out: MergedPart[] = [];
    for (const [material, lists] of this.parts) {
      for (const [k, geos] of lists.entries()) {
        if (!geos.length) continue;
        yield;
        const geometry = mergeGeometries(harmonise(geos), false);
        for (const g of geos) g.dispose();
        geos.length = 0;
        if (geometry) out.push({ material, castShadow: k === 0, geometry });
      }
    }
    this.parts.clear();
    return out;
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
  /** A quarter's colours (HOUSE_PALETTES), else the city's. */
  palette?: string;
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

/** A shop's goods set out on the pavement (house-local). */
export interface PavementGoods {
  piece: string;
  lx: number;
  lz: number;
  yaw: number;
  scale: number;
}
/**
 * The goods a shop sets out against its wall beside the arches: plain numbers from a stream of their own, so the plan
 * registers their colliders without building the house and the near build places the same ones.
 */
export function townhouseGoods(spec: TownhouseSpec): PavementGoods[] {
  if (!spec.shop) return [];
  const r = stream(spec.seed * 31 + 17);
  const di = doorIndex(spec);
  const out: PavementGoods[] = [];
  for (let i = 0; i < spec.width; i++) {
    if (i === di || r() >= 0.75) continue;
    const piece = pick(r, ['Barrel_Apples', 'Prop_Crate', 'Barrel', 'Bag', 'Vase_2', 'Prop_Crate'] as const);
    const x = -spec.width + 1 + 2 * i;
    out.push({ piece, lx: x + (r() < 0.5 ? -0.85 : 0.85), lz: spec.depth + WALL + 0.38, yaw: r() * 0.6 - 0.3, scale: piece === 'Prop_Crate' ? 0.6 : 0.8 });
  }
  return out;
}
/** The colliders of a shop's pavement goods. */
export function goodsColliders(spec: TownhouseSpec): TidecrownCollider[] {
  return townhouseGoods(spec).map((g) => {
    const [x, z] = atLocal(spec, g.lx, g.lz);
    return { x, z, hx: 0.32, hz: 0.32, c: Math.cos(spec.yaw), s: Math.sin(spec.yaw), y0: spec.ground - 1, y1: spec.ground + 1.2 };
  });
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

/** A quarter's colours over the city's: any list left out keeps the city's tones. */
export interface HousePalette {
  walls?: string[];
  roofs?: string[];
  /** Share of verdigris copper roofs (default 0.1). */
  copper?: number;
  shutters?: string[];
  doors?: string[];
  /** Share of houses with a rusticated stone ground floor (default 0.72). */
  stoneFloor?: number;
}
export const HOUSE_PALETTES: Record<string, HousePalette> = {
  // Violet and teal shutters, cool whites and more copper among the glass towers.
  seaglass: { walls: ['#e8e4ea', '#ece6e0', '#e2dde4', '#efe9e4', '#e6e0d8'], shutters: ['#5b46b8', '#3f3492', '#2b8f94', '#6e52c8', '#2f7f8f'], doors: ['#3a2f7a', '#2b6f74', '#4a3a8f', '#26446a'], copper: 0.4 },
  // Noble houses: pale dressed stone below, cream above, deep blue roofs.
  upper: { walls: ['#f2ead8', '#efe6d2', '#f4ecdc', '#ebe2cc'], roofs: ['#2c5690', '#2a4f80', '#244a7a', '#2f5a94'], doors: ['#26446a', '#1f3a5c', '#5b3b27', '#2c3c55'], copper: 0.06, stoneFloor: 1 },
  // Smiths' ochre and stone, dark slate roofs, green and brown shutters, copper here and there.
  works: { walls: ['#d9c9a6', '#d2c09c', '#cbb894', '#dccaa4', '#d6c4a0'], roofs: ['#2f4f74', '#2b4766', '#36587e', '#2a4560'], shutters: ['#3d5a3a', '#2f4f5c', '#5a4630', '#2f5f8f', '#44603e'], copper: 0.2, stoneFloor: 0.9 },
  // Sea-green and teal by the water.
  water: { shutters: ['#2b7884', '#3a8889', '#24546c', '#2f6f9a', '#1f6f7a'], doors: ['#1f585c', '#245a7a', '#7a3a2a', '#26446a'] },
  // Market fronts: the city's blues with ochre and russet doors.
  market: { doors: ['#26446a', '#1f585c', '#8a5a20', '#245a7a', '#7a3a2a', '#2c3c55'] },
};

/** Weathering over a roof's tone, house by house: dark slate, grey slate, sun-faded blue, greener copper. */
const ROOF_WEATHER: [number, string, number][] = [[0.18, '#1a1e24', 0.7], [0.36, '#6a6e74', 0.8], [0.5, '#a9c0d8', 0.55], [0.6, '#4f9a7a', 0.7]];

function houseStyle(k: TidecrownKit, r: () => number, palette?: HousePalette, seed = 0): Style {
  const m = k.mat;
  const p = palette ?? {};
  const wall = lin(pick(r, p.walls ?? WALL_TONES));
  const stone = lin(pick(r, STONE_TONES));
  const roof = lin(r() < (p.copper ?? 0.1) ? COPPER : pick(r, p.roofs ?? ROOF_TONES)).multiplyScalar(0.92 + r() * 0.16);
  // Its own stream, so the house's other draws stay as they were.
  const rw = stream(seed * 7919 + 211), q = rw();
  const weather = ROOF_WEATHER.find(([at]) => q < at);
  if (weather) roof.lerp(lin(weather[1]), weather[2]);
  // A wide spread house to house, so a district's roofs read one by one from above, not as one blue mass.
  roof.multiplyScalar(0.72 + rw() * 0.68);
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
  const shutter = new Map(t).set(m.paint, lin(pick(r, p.shutters ?? SHUTTER_TONES)));
  const door = new Map(t).set(m.paint, lin(pick(r, p.doors ?? DOOR_TONES)));
  return { wall: k.over.wall, paint: k.over.paint, t, roof: t, shutter, door, frame: t, groundStone: r() < (p.stoneFloor ?? 0.72) };
}

type WinKind = 'thin' | 'wideFlat' | 'wideRound';
const WIN_WALL: Record<WinKind, string> = { thin: 'Window_Thin_Round', wideFlat: 'Window_Wide_Flat', wideRound: 'Window_Wide_Round' };
const WIN_PIECE: Record<WinKind, string> = { thin: 'Window_Thin_Round1', wideFlat: 'Window_Wide_Flat1', wideRound: 'Window_Wide_Round1' };
const WIN_SHUT: Record<WinKind, string> = { thin: 'WindowShutters_Thin_Round', wideFlat: 'WindowShutters_Wide_Flat', wideRound: 'WindowShutters_Wide_Round' };

/** Optional extras a house reports to its builder (the lamps beside its door, for the caller to light). */
export interface HouseExtras {
  lamps: { x: number; y: number; z: number; yaw: number }[];
}

// --- far build: the same house as quads and prisms (lod.ts) ----------------------------------------

/** UV scale and origin for far rects, by surface: [u per unit, v per unit, u origin, v origin]. */
type UvSpec = [number, number, number, number];
const UV_PLASTER: UvSpec = [0.5, 1.25 / 3, -1, 0];
const UV_LIME: UvSpec = [0.5, 1.423 / 3, -1, 0];
const UV_APRON: UvSpec = [0.5, 0.475, -1, -1.219];
const UV_ROCK: UvSpec = [0.5, 0.459, -1, -1.26];
const UV_POST: UvSpec = [0.5, 0.26, 0, 0];
const UV_PAINT: UvSpec = [0.6, 0.3, 0, 0];
/** Glazing bars per window: columns and rows of panes. */
const PANES: Record<WinKind, [number, number]> = { wideFlat: [3, 3], wideRound: [3, 3], thin: [1, 4] };

/** An opening: half width, bottom, springing and apex of the outer edge (the hole) and of what fills it. */
interface Hole {
  ox: number;
  o0: number;
  os: number;
  ot: number;
  ix: number;
  i0: number;
  is: number;
  it: number;
}
const WIN_HOLE: Record<WinKind, Hole> = {
  wideFlat: { ox: 0.804, o0: 0.944, os: 2.524, ot: 2.524, ix: 0.505, i0: 1.097, is: 2.355, it: 2.355 },
  wideRound: { ox: 0.682, o0: 1.016, os: 2.07, ot: 2.742, ix: 0.545, i0: 1.065, is: 2.07, it: 2.619 },
  thin: { ox: 0.444, o0: 1.016, os: 2.2, ot: 2.621, ix: 0.279, i0: 1.088, is: 2.2, it: 2.479 },
};
/** Closed shutters: half width and top; open ones: each leaf from (inner x, z) to (outer x, z). */
const SHUT: Record<WinKind, { cx: number; top: number; leaf: [number, number, number, number] }> = {
  wideFlat: { cx: 0.674, top: 2.517, leaf: [0.674, 0.137, 1.239, 0.593] },
  wideRound: { cx: 0.64, top: 2.74, leaf: [0.64, 0.09, 1.15, 0.563] },
  thin: { cx: 0.434, top: 2.612, leaf: [0.434, 0.059, 0.8, 0.436] },
};
const DOOR_HOLE: Hole = { ox: 0.76, o0: 0, os: 1.85, ot: 2.657, ix: 0.56, i0: 0, is: 1.85, it: 2.35 };
const FLAT_DOOR_HOLE: Hole = { ox: 0.826, o0: 0, os: 2.37, ot: 2.37, ix: 0.56, i0: 0, is: 2.135, it: 2.135 };
/** Round-tile roof sections by span: tile line y = a - k|x| from the ridge cap (half width 0.375) to the eave x. */
const ROOF_FAR: Record<number, { a: number; k: number; ridge: number; eave: number }> = {
  4: { a: 3.73, k: 1.484, ridge: 3.72, eave: 2.757 },
  6: { a: 4.62, k: 1.244, ridge: 4.89, eave: 4.125 },
  8: { a: 5.77, k: 1.242, ridge: 6.0, eave: 4.976 },
};
/** Gable plaster: half width past the wall line and apex, by span. */
const GABLE_FAR: Record<number, number> = { 4: 2.937, 6: 4.377, 8: 5.314 };
const FINIAL_FAR = [[0, 0], [0.13, 0.55], [0.03, 0.8], [0, 1.2]] as [number, number][];

/** A wall surface in layers from the storey floor up: [y0, y1, material, tint, uv]. */
type Layer = [number, number, THREE.Material, THREE.Color, UvSpec];

// Far facades are drawn in a wall-module frame: x across -1..1, y up the storey, z out of the wall.

/** A run of wall from x0 to x1, its layers stacked. */
function farWall(fb: FarBatch, layers: Layer[], x0: number, x1: number): void {
  for (const [y0, y1, m, c, uv] of layers) fb.rect(m, c, x0, y0, x1, y1, 0, uv);
}
/** One module's layers with an opening (a door or an arch) cut out. */
function farHoleWall(fb: FarBatch, layers: Layer[], h: Hole): void {
  for (const [y0, y1, m, c, uv] of layers) {
    // A layer wholly below the hole is one rect; otherwise piers either side, then what lies below and above.
    if (y1 <= h.o0 + 1e-3) {
      fb.rect(m, c, -1, y0, 1, y1, 0, uv);
      continue;
    }
    fb.rect(m, c, -1, y0, -h.ox, y1, 0, uv);
    fb.rect(m, c, h.ox, y0, 1, y1, 0, uv);
    fb.rect(m, c, -h.ox, y0, h.ox, Math.min(y1, h.o0), 0, uv);
    if (y1 <= h.os) continue;
    const b = Math.max(y0, h.os);
    if (h.ot <= h.os + 1e-3) fb.rect(m, c, -h.ox, Math.max(b, h.ot), h.ox, y1, 0, uv);
    else if (b < h.ot) {
      const [su, sv, ou, ov] = uv;
      const q = (x: number, y: number): [number, number] => [(x - ou) * su, (y - ov) * sv];
      fb.poly(m, c, [[-h.ox, b, 0], [0, h.ot, 0], [0, y1, 0], [-h.ox, y1, 0]], [q(-h.ox, b), q(0, h.ot), q(0, y1), q(-h.ox, y1)]);
      fb.poly(m, c, [[0, h.ot, 0], [h.ox, b, 0], [h.ox, y1, 0], [0, y1, 0]], [q(0, h.ot), q(h.ox, b), q(h.ox, y1), q(0, y1)]);
    }
  }
}
/** The ring between a hole's outer edge and its inner panel, and the panel itself. */
function farFill(fb: FarBatch, h: Hole, ringMat: THREE.Material, ringTint: THREE.Color, ringUv: UvSpec, inner: THREE.Material, innerTint: THREE.Color, innerZ: number, grow = 0): void {
  const [su, sv, ou, ov] = ringUv;
  const q = (x: number, y: number): [number, number] => [(x - ou) * su, (y - ov) * sv];
  fb.rect(ringMat, ringTint, -h.ox, h.o0, h.ox, h.i0, 0, ringUv);
  fb.rect(ringMat, ringTint, -h.ox, h.i0, -h.ix, h.is, 0, ringUv);
  fb.rect(ringMat, ringTint, h.ix, h.i0, h.ox, h.is, 0, ringUv);
  if (h.ot <= h.os + 1e-3 && h.it <= h.is + 1e-3) fb.rect(ringMat, ringTint, -h.ox, h.is, h.ox, h.ot, 0, ringUv);
  else {
    fb.poly(ringMat, ringTint, [[-h.ox, h.is, 0], [-h.ix, h.is, 0], [0, h.it, 0], [0, h.ot, 0]], [q(-h.ox, h.is), q(-h.ix, h.is), q(0, h.it), q(0, h.ot)]);
    fb.poly(ringMat, ringTint, [[h.ix, h.is, 0], [h.ox, h.is, 0], [0, h.ot, 0], [0, h.it, 0]], [q(h.ix, h.is), q(h.ox, h.is), q(0, h.ot), q(0, h.it)]);
  }
  // The panel is a little larger than its opening when recessed, so no crack shows at an angle.
  const x = h.ix + grow;
  const t = h.it + grow;
  const s = h.is + grow * 0.5;
  const pq = (px: number, py: number): [number, number] => [(px + x) * 0.6, py * 0.3];
  if (t <= s + 1e-3) fb.poly(inner, innerTint, [[-x, h.i0, innerZ], [x, h.i0, innerZ], [x, t, innerZ], [-x, t, innerZ]], [pq(-x, h.i0), pq(x, h.i0), pq(x, t), pq(-x, t)]);
  else fb.poly(inner, innerTint, [[-x, h.i0, innerZ], [x, h.i0, innerZ], [x, s, innerZ], [0, t, innerZ], [-x, s, innerZ]], [pq(-x, h.i0), pq(x, h.i0), pq(x, s), pq(0, t), pq(-x, s)]);
}

/** A far window: one decal over the frame's outline; the glass shader draws panes, bars and frame (see glassMaterial). */
function farWindow(fb: FarBatch, glass: THREE.Material, h: Hole, [cols, rows]: [number, number], lit: number): void {
  const pw = (2 * h.ix) / cols;
  const ph = (h.it - h.i0) / rows;
  const q = (x: number, y: number): [number, number] => [(x + h.ix) / pw, (y - h.i0) / ph];
  const c = new THREE.Color(lit, cols / 8, rows / 8);
  const z = 0.004;
  if (h.ot <= h.os + 1e-3) fb.poly(glass, c, [[-h.ox, h.o0, z], [h.ox, h.o0, z], [h.ox, h.ot, z], [-h.ox, h.ot, z]], [q(-h.ox, h.o0), q(h.ox, h.o0), q(h.ox, h.ot), q(-h.ox, h.ot)], 0);
  else fb.poly(glass, c, [[-h.ox, h.o0, z], [h.ox, h.o0, z], [h.ox, h.os, z], [0, h.ot, z], [-h.ox, h.os, z]], [q(-h.ox, h.o0), q(h.ox, h.o0), q(h.ox, h.os), q(0, h.ot), q(-h.ox, h.os)], 0);
}

/**
 * Raise one townhouse into `batch`: plinth, storeys of wall modules (rusticated stone or plaster ground floor,
 * banded plaster above), corner quoins, windows with shutters and window boxes, a door with steps and a lantern
 * on the street, an optional shop arcade under a striped awning and an optional balcony, then the round-tile roof
 * with gables, dormers, chimneys and gold finials. With `far`, the same house also goes there as its far build:
 * walls as plain runs with window decals (the glass shader draws frames and bars), doors and arcades cut in,
 * shutters, sills, bands and quoins as quads, the roof as a tiled prism with its dormers and chimneys.
 */
export function buildTownhouse(spec: TownhouseSpec, batch: TideBatch, extras?: HouseExtras, far?: FarBatch): TownhouseLot {
  const k = batch.tide;
  const { village, props, nature, mat } = k;
  const r = stream(spec.seed);
  const st = houseStyle(k, r, spec.palette ? HOUSE_PALETTES[spec.palette] : undefined, spec.seed);
  const lot = townhouseLot(spec);
  const goods = townhouseGoods(spec);
  const W = spec.width * 2;
  const D = spec.depth * 2;
  const F = spec.floors;
  const base = trs(spec.x, spec.ground, spec.z, spec.yaw);
  const m = new THREE.Matrix4();
  const fb = far?.house(base);
  // Wall-mounted pieces lose their indoor faces (see cutIndoor).
  const indoor = (piece: string) => !/^(Wall_|Window_|Door_|DoorFrame_)/.test(piece);
  // Plaster walls leave out the kit's timber frame: stone bands and quoins carry the lines instead.
  const put = (kit: Kit, piece: string, over: Over, tint: Tint | null, x: number, y: number, z: number, yaw = 0, scale: number | THREE.Vector3 = 1, shadow = true, pitch = 0) => {
    if (over === st.wall && piece.startsWith('Wall_Plaster')) over = k.over.plaster;
    m.multiplyMatrices(base, trs(x, y, z, yaw, scale, pitch));
    batch.put(kit, piece, m, over, tint, shadow, indoor(piece));
  };
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const geo = (g: THREE.BufferGeometry, material: THREE.Material, tint: THREE.Color | undefined, shadow = true) => batch.addGeometry(g.applyMatrix4(base), material, null, shadow, tint);
  const stoneTint = st.t.get(mat.stone)!;
  const wallTint = st.t.get(mat.plaster)!;
  const frameTint = st.t.get(mat.paint)!;
  const shutterTint = st.shutter.get(mat.paint)!;
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
    return new THREE.Color(q < 0.24 ? 0.55 + r() * 0.45 : 0.04 + r() * 0.08, 1, 1);
  };
  const glassTint = (t: Tint) => new Map(t).set(mat.glass, glassLit());

  // Plinth: dressed stone under the floor down past the lowest ground.
  const low = Math.min(spec.base ?? spec.ground, spec.doorstep ?? spec.ground) - 0.7;
  const ph = spec.ground - low + 0.04;
  // Flush with the party line where a neighbour stands, so two plinths never share a face; elsewhere a lip of 5 cm (a
  // deeper one read as a ledge along the street).
  const lip = 0.05;
  const pl = hidden('left', 0, 0) ? 0 : lip;
  const pr = hidden('right', 0, 0) ? 0 : lip;
  const pb = hidden('back', 0, 0) ? 0 : lip;
  geo(worldBox(W + pl + pr, ph, D + lip + pb, 0.5).translate((pr - pl) / 2, -ph / 2 + 0.04, (lip - pb) / 2), mat.limestone, stoneTint);
  fb?.frame().box(mat.limestone, stoneTint, -W / 2 - pl, 0.04 - ph, -D / 2 - pb, W / 2 + pr, 0.04, D / 2 + lip, 'ny');

  const sides: Side[] = ['front', 'right', 'back', 'left'];
  /** Quoin width per corner and storey (0: none), for the far build. */
  const quoins = [0, 1, 2, 3].map(() => new Array<number>(F).fill(0));
  for (let f = 0; f < F; f++) {
    const y = f * H;
    const groundSet = f === 0 && st.groundStone;
    const prefix = groundSet ? 'Wall_UnevenBrick' : 'Wall_Plaster';
    // Far wall layers: rusticated stone, plaster on an ashlar base, or plaster; window walls stand on an apron.
    const plain: Layer[] = groundSet ? [[0, H, mat.limestone, stoneTint, UV_LIME]] : f === 0 ? [[0, 0.88, mat.ashlar, stoneTint, UV_APRON], [0.88, H, mat.plaster, wallTint, UV_PLASTER]] : [[0, H, mat.plaster, wallTint, UV_PLASTER]];
    const apron: Layer[] = f === 0 ? plain : [[0, 0.88, mat.ashlar, stoneTint, UV_APRON], [0.88, H, mat.plaster, wallTint, UV_PLASTER]];
    const rockBase: Layer[] = groundSet ? plain : [[0, 0.91, mat.rock, stoneTint, UV_ROCK], [0.91, H, mat.plaster, wallTint, UV_PLASTER]];
    for (const side of sides) {
      const sf = sideFrame(side, W, D);
      const c = Math.cos(sf.yaw);
      const s = Math.sin(sf.yaw);
      // Modules run along +x in their frame on the front and back, along -x on the sides.
      const dir = side === 'front' || side === 'back' ? 1 : -1;
      // Far walls run unbroken across plain and window modules alike (windows are decals), split where the layers change.
      let run: { i: number; n: number; layers: Layer[] } | null = null;
      let band: { i: number; n: number } | null = null;
      const flush = () => {
        if (fb && run) {
          const [x, z] = sf.at(run.i);
          fb.frame(x, y, z, sf.yaw);
          farWall(fb, run.layers, dir > 0 ? -1 : 1 - 2 * run.n, dir > 0 ? -1 + 2 * run.n : 1);
        }
        run = null;
      };
      const extend = (i: number, layers: Layer[]) => {
        if (run && run.layers !== layers) flush();
        if (run) run.n++;
        else run = { i, n: 1, layers };
      };
      const flushBand = () => {
        if (fb && band) {
          const [x, z] = sf.at(band.i);
          const x0 = dir > 0 ? -1 : 1 - 2 * band.n;
          const x1 = dir > 0 ? -1 + 2 * band.n : 1;
          fb.frame(x, y, z, sf.yaw);
          fb.trimBox(mat.stone, stoneTint, x0, -0.146, -0.02, x1, 0.151, 0.142, 'nzpxnx', 0.5, 0.02, 0.29);
        }
        band = null;
      };
      for (let i = 0; i < sf.count; i++) {
        if (hidden(side, i, f)) {
          flush();
          flushBand();
          continue;
        }
        const [x, z] = sf.at(i);
        const street = isCorner(side);
        // Storey band under every upper floor of the street fronts.
        if (f > 0 && street) {
          put(village, 'Wall_BottomCover', st.wall, st.t, x, y, z, sf.yaw, v(1, 1.25, 1.2));
          if (band) band.n++;
          else band = { i, n: 1 };
        } else flushBand();
        if (side === 'front' && f === 0 && i === di) {
          flush();
          door(x, y, z, sf.yaw, c, s, groundSet, true, rockBase);
          continue;
        }
        if (side === 'front' && f === 0 && spec.shop) {
          flush();
          shopArch(x, y, z, sf.yaw, groundSet, rockBase);
          continue;
        }
        if (f === balconyFloor && side === 'front') {
          flush();
          balconyDoor(x, y, z, sf.yaw, rockBase);
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
          if (r() < 0.12 && f < F - 1) {
            const vine = pick(r, ['Prop_Vine1', 'Prop_Vine2'] as const);
            const ox = (r() - 0.5) * 0.6;
            const oz = (r() - 0.5) * 0.6;
            const vs = 0.9 + r() * 0.3;
            const vx = x + c * ox + s * 0.12;
            const vz = z - s * oz + c * 0.12;
            put(village, vine, st.wall, null, vx, y + H + 0.1, vz, sf.yaw, vs, false);
            if (fb) {
              // Far ivy: one strand-wide card down the piece's outline, the leaf cluster repeated along it.
              const b = village.get(vine).box;
              const mx = (b.min.x + b.max.x) / 2;
              const hw = (b.max.x - b.min.x) * 0.32;
              fb.frame(vx, y + H + 0.1, vz, sf.yaw, vs, vs, vs).poly(mat.vine, WHITE, [[mx - hw, b.min.y, 0.05], [mx + hw, b.min.y, 0.05], [mx + hw, b.max.y, 0.05], [mx - hw, b.max.y, 0.05]], [[0, 2.4], [1, 2.4], [1, 0], [0, 0]]);
            }
          }
          extend(i, plain);
          continue;
        }
        extend(i, apron);
        window(x, y, z, sf.yaw, c, s, kind, prefix, street, f);
      }
      flush();
      flushBand();
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
      const qs = groundSet ? 2.1 : 1.7;
      put(village, 'Corner_ExteriorWide_Wood', st.wall, st.t, cx, y, cz, cy, v(qs, 1.02, qs));
      quoins[n][f] = qs;
    });
  }
  if (fb) {
    // Far quoins: the two outer faces of each pilaster, one box per run of storeys of the same width.
    fb.frame();
    [[-W / 2, D / 2], [W / 2, D / 2], [W / 2, -D / 2], [-W / 2, -D / 2]].forEach(([cx, cz], n) => {
      const sx = Math.sign(cx);
      const sz = Math.sign(cz);
      const turned = n % 2 === 1;
      for (let f = 0; f < F; ) {
        const qs = quoins[n][f];
        let g = f + 1;
        while (g < F && quoins[n][g] === qs) g++;
        if (qs) {
          const ax = (turned ? 0.166 : 0.145) * qs;
          const az = (turned ? 0.145 : 0.166) * qs;
          fb.trimBox(mat.stone, stoneTint, cx - ax, f * H, cz - az, cx + ax, g * H + 0.06, cz + az, `py ny ${sz > 0 ? 'nz' : 'pz'} ${sx > 0 ? 'nx' : 'px'}`, 0.33, 0.02, 0.29);
        }
        f = g;
      }
    });
  }
  const top = F * H;
  roof(top + ROOF_LIFT);
  if (spec.shop) awning();
  if (spec.banner && F >= 3) banner();
  frontDressing();
  return lot;

  // --- pieces -----------------------------------------------------------------------------------

  function window(x: number, y: number, z: number, yaw: number, c: number, s: number, kind: WinKind, prefix: string, street: boolean, f: number): void {
    put(village, `${prefix}_${WIN_WALL[kind]}`, st.wall, st.t, x, y, z, yaw);
    const lit = glassTint(st.frame);
    put(village, WIN_PIECE[kind], st.paint, lit, x, y, z, yaw, 1, false);
    let shut: 'Open' | 'Closed' | null = null;
    if (street ? r() < shutterOdds : r() < 0.25) {
      shut = r() < 0.7 ? 'Open' : 'Closed';
      put(village, `${WIN_SHUT[kind]}_${shut}`, st.paint, st.shutter, x, y, z, yaw, 1, false);
    }
    const h = WIN_HOLE[kind];
    if (fb) {
      fb.frame(x, y, z, yaw);
      farWindow(fb, mat.farGlass, h, PANES[kind], lit.get(mat.glass)!.r);
      if (shut === 'Closed') {
        const sh = SHUT[kind];
        fb.rect(mat.paint, shutterTint, -sh.cx, 1.093, sh.cx, sh.top, 0.2, UV_PAINT);
      }
      // Sill.
      fb.box(mat.paint, frameTint, -h.ox - 0.04, h.o0 - 0.09, 0, h.ox + 0.04, h.o0, 0.3, 'nz ny px nx', 0.1);
      if (shut === 'Open') {
        const sh = SHUT[kind];
        const [ax, az, bx, bz] = sh.leaf;
        for (const sx of [-1, 1]) {
          // Both faces of each leaf, angled out from the frame.
          const p: Vec3[] = [[sx * ax, 1.093, az], [sx * bx, 1.093, bz], [sx * bx, sh.top, bz], [sx * ax, sh.top, az]];
          const uv: [number, number][] = [[0, 0.33], [0.6, 0.33], [0.6, 0.78], [0, 0.78]];
          fb.poly(mat.paint, shutterTint, sx > 0 ? p : [p[1], p[0], p[3], p[2]], uv);
          fb.poly(mat.paint, shutterTint, sx > 0 ? [p[1], p[0], p[3], p[2]] : p, uv);
        }
      }
    }
    // Stone window boxes with flowers under upper street windows.
    if (street && f > 0 && r() < boxOdds) {
      const w = kind === 'thin' ? 0.62 : 0.78;
      const sill = kind === 'wideFlat' ? 0.86 : 0.93;
      put(village, 'Prop_ExteriorBorder_Straight1', st.wall, st.t, x, y + sill, z + 0, yaw, v(w, 2.4, 0.42), true);
      if (fb) {
        fb.box(mat.rock, stoneTint, -w, sill, 0, w, sill + 0.32, 0.294, 'nz', 0.5);
        fb.rect(mat.paint, LEAF_TONE, -w * 0.85, sill + 0.3, w * 0.85, sill + 0.62, 0.16, UV_PAINT);
      }
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

  function door(x: number, y: number, z: number, yaw: number, c: number, s: number, groundSet: boolean, main: boolean, layers: Layer[]): void {
    put(village, groundSet ? 'Wall_UnevenBrick_Door_Round' : 'Wall_Plaster_Door_Round', st.wall, st.t, x, y, z, yaw);
    const piece = pick(r, ['Door_1_Round', 'Door_4_Round', 'Door_8_Round', 'Door_1_Round'] as const);
    // Doors hinge at their local x = 0; centre them in the opening.
    const ox = -0.55;
    const oz = -0.12;
    const tint = glassTint(st.door);
    put(village, piece, st.paint, tint, x + c * ox + s * oz, y, z - s * ox + c * oz, yaw, 1, false);
    put(village, 'DoorFrame_Round_WoodDark', st.wall, st.t, x, y, z, yaw, v(1.08, 1.04, 1.4), false);
    if (fb) {
      fb.frame(x, y, z, yaw);
      farHoleWall(fb, layers, DOOR_HOLE);
      farFill(fb, DOOR_HOLE, mat.stone, stoneTint, UV_POST, mat.paint, tint.get(mat.paint)!, oz, 0.1);
    }
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
        fb?.frame().box(mat.limestone, stoneTint, x - 0.8 - 0.1 * j, yTop - h, z + WALL, x + 0.8 + 0.1 * j, yTop, z + WALL + d, 'ny nz');
      }
    }
  }

  function shopArch(x: number, y: number, z: number, yaw: number, groundSet: boolean, layers: Layer[]): void {
    // An open arch onto a shallow shop: back wall, floor, ceiling, a shelf of wares and goods out front.
    put(village, groundSet ? 'Wall_UnevenBrick_Door_Round' : 'Wall_Plaster_Door_Round', st.wall, st.t, x, y, z, yaw);
    put(village, 'DoorFrame_Round_WoodDark', st.wall, st.t, x, y, z, yaw, v(1.08, 1.04, 1.4), false);
    const back = z - 1.25;
    put(village, 'Wall_Plaster_Straight', st.wall, st.t, x, y, back, 0, 1, false);
    put(village, 'Floor_WoodDark', st.paint, new Map(st.t).set(mat.paint, lin('#8a6a4a')), x, y + 0.02, z - 0.6, 0, v(1, 1, 0.62), false);
    put(village, 'Floor_WoodDark', st.paint, new Map(st.t).set(mat.paint, lin('#6d5440')), x, y + 2.75, z - 0.6, 0, v(1, 1, 0.62), false, Math.PI);
    for (const sx of [-1, 1]) put(village, 'Wall_Plaster_Straight', st.wall, st.t, x + sx * 0.98, y, z - 0.6, -sx * Math.PI / 2, v(0.62, 1, 1), false);
    if (fb) {
      fb.frame(x, y, z, yaw);
      farHoleWall(fb, layers, DOOR_HOLE);
      farFill(fb, DOOR_HOLE, mat.stone, stoneTint, UV_POST, mat.plaster, wallTint, -1.25, 0.42);
      // The shop's sides, ceiling and floor, seen through the arch.
      const shade = wallTint.clone().multiplyScalar(0.8);
      fb.poly(mat.plaster, shade, [[-0.98, 0, 0], [-0.98, 0, -1.25], [-0.98, 2.75, -1.25], [-0.98, 2.75, 0]], [[0, 0], [0.6, 0], [0.6, 1.15], [0, 1.15]]);
      fb.poly(mat.plaster, shade, [[0.98, 0, -1.25], [0.98, 0, 0], [0.98, 2.75, 0], [0.98, 2.75, -1.25]], [[0, 0], [0.6, 0], [0.6, 1.15], [0, 1.15]]);
      fb.poly(mat.paint, SHOP_CEILING, [[-0.98, 2.75, 0], [-0.98, 2.75, -1.25], [0.98, 2.75, -1.25], [0.98, 2.75, 0]], [[0, 0.32], [0.6, 0.32], [0.6, 0.55], [0, 0.55]]);
      fb.poly(mat.paint, SHOP_FLOOR, [[-0.98, 0.02, -1.25], [-0.98, 0.02, 0], [0.98, 0.02, 0], [0.98, 0.02, -1.25]], [[0, 0.32], [0.6, 0.32], [0.6, 0.55], [0, 0.55]]);
    }
    put(props, 'Shelf_Simple', k.over.props, null, x, y + 1.5, back + 0.12, 0, 1.1, false);
    put(props, pick(r, ['Vase_4', 'Candle_2'] as const), k.over.props, null, x + (r() - 0.5) * 0.6, y + 1.62, back + 0.3, r() * 6, 0.8, false);
    put(props, pick(r, ['Barrel', 'Bag', 'Vase_2'] as const), k.over.props, null, x + (r() - 0.5) * 0.6, y, back + 0.6, r() * 6, 0.85, false);
    // Goods on the pavement, against the wall between the arches (townhouseGoods; the plan has their colliders).
    for (const g of goods) {
      if (Math.abs(g.lx - x) > 1) continue;
      if (g.piece === 'Prop_Crate') put(village, g.piece, st.paint, new Map(st.t).set(mat.paint, lin('#9c7650')), g.lx, 0, g.lz, g.yaw, g.scale);
      else put(props, g.piece, k.over.props, null, g.lx, 0, g.lz, g.yaw, g.scale);
    }
  }

  function balconyDoor(x: number, y: number, z: number, yaw: number, layers: Layer[]): void {
    put(village, 'Wall_Plaster_Door_Flat', st.wall, st.t, x, y, z, yaw);
    const leaf = glassTint(st.shutter);
    put(village, 'Door_1_Flat', st.paint, leaf, x - 0.55, y, z - 0.12, yaw, 1, false);
    put(village, 'DoorFrame_Flat_WoodDark', st.wall, st.t, x, y, z, yaw, v(1.05, 1.03, 1.4), false);
    // Stone slab on corbels, iron railing along its edge.
    geo(worldBox(2.04, 0.2, 1.0, 0.5).translate(x, y - 0.06, z + 0.55), mat.limestone, stoneTint);
    put(village, 'Wall_BottomCover', st.wall, st.t, x, y - 0.1, z + 1.08, 0, v(1.02, 1.1, 0.8));
    for (const sx of [-0.8, 0.8]) put(village, 'Prop_Support', st.wall, st.t, x + sx, y - 1.45, z + 0.05, 0, v(1.3, 0.55, 0.52));
    // Painted iron in a weathered slate blue: darker reads as a black block against the wall.
    const railTint = new Map(st.t).set(mat.paint, lin('#8ea6b8'));
    put(village, rail, st.paint, railTint, x, y + 0.04, z + 0.02, 0, v(1.02, 0.9, 0.95));
    for (const sx of [-1, 1]) put(village, 'Balcony_Cross_Straight', st.paint, railTint, x, y + 0.04, z + 0.52, sx * Math.PI / 2, v(0.5, 0.9, 1.0));
    if (fb) {
      fb.frame(x, y, z, yaw);
      farHoleWall(fb, layers.map(([y0, y1, ...rest]) => [y0, Math.min(y1, H), ...rest] as Layer), FLAT_DOOR_HOLE);
      farFill(fb, FLAT_DOOR_HOLE, mat.stone, stoneTint, UV_POST, mat.paint, leaf.get(mat.paint)!, -0.12, 0.1);
      fb.box(mat.limestone, stoneTint, -1.02, -0.16, 0.05, 1.02, 0.04, 1.05, '');
      const iron = railTint.get(mat.paint)!;
      // The railing as rails and posts, both faces.
      for (const [x0, y0, x1, y1] of [[-1, 0.93, 1, 1.05], [-1, 0.04, 1, 0.12], [-1, 0.04, -0.94, 1.0], [0.94, 0.04, 1, 1.0], [-0.36, 0.04, -0.3, 1.0], [0.3, 0.04, 0.36, 1.0]]) fb.rect(mat.paint, iron, x0, y0, x1, y1, 1.08, UV_PAINT);
      fb.rect(mat.paint, iron, -1, 0.93, 1, 1.05, 1.06, UV_PAINT, true);
    }
  }

  function awning(): void {
    const w = W - 0.5;
    const g = awningGeometry(w, 1.05, 0.5, (spec.seed % 3) + 1);
    g.translate(0, 2.92, D / 2 + WALL + 0.02);
    geo(g, mat.awning, WHITE);
    fb?.frame().geo(mat.awning, awningGeometry(w, 1.05, 0.5, 1, true).translate(0, 2.92, D / 2 + WALL + 0.02));
    // Iron stays from the wall to the front rail.
    const rods: THREE.BufferGeometry[] = [];
    for (const sx of [-w / 2 + 0.1, w / 2 - 0.1]) {
      const a = new THREE.Vector3(sx, 2.25, D / 2 + WALL);
      const b = new THREE.Vector3(sx, 2.44, D / 2 + WALL + 1.02);
      rods.push(tube([a, a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, -0.04, 0)), b], () => 0.025, 6));
    }
    geo(mergeGeometries(rods, false)!, mat.iron, undefined);
  }

  function frontDressing(): void {
    // Life along the street, from a stream of its own (the house's other draws stay as they were): a bench, tubs of
    // flowers, barrels or crates against the front between the door and the windows, and a sign hung out over a
    // shop's arches (now and then over an inn's door). Dressing only, near the wall: the walk passes them.
    const rd = stream(spec.seed * 104729 + 7);
    const yp = (spec.doorstep ?? spec.ground) - spec.ground;
    const zf = D / 2 + WALL;
    if (spec.shop || rd() < 0.14) sign(rd);
    if (spec.shop) return;
    for (let i = 0; i < spec.width; i++) {
      const q = rd();
      if (i === di || q > 0.55) continue;
      const x = -W / 2 + 1 + 2 * i;
      if (q < 0.15) put(props, 'Bench', k.over.props, null, x, yp, zf + 0.32, 0, v(0.6, 1, 1));
      else if (q < 0.3) {
        for (const sx of [-0.62, 0.62]) {
          put(props, 'Bucket_Wooden_1', k.over.props, null, x + sx, yp, zf + 0.3, rd() * 6, 1.5);
          put(nature, rd() < 0.6 ? 'Flower_3_Single' : 'Plant_7', k.over.nature, null, x + sx, yp + 0.38, zf + 0.3, rd() * 6, 0.3, false);
        }
      } else if (q < 0.43) {
        put(props, 'Barrel', k.over.props, null, x - 0.42, yp, zf + 0.38, rd() * 6, 0.8);
        put(props, rd() < 0.5 ? 'Barrel' : 'Barrel_Apples', k.over.props, null, x + 0.36, yp, zf + 0.36, rd() * 6, 0.75);
      } else {
        put(village, 'Prop_Crate', st.paint, new Map(st.t).set(mat.paint, lin('#9c7650')), x - 0.3, yp, zf + 0.36, rd() * 0.5 - 0.25, 0.6);
        put(props, 'Bag', k.over.props, null, x + 0.45, yp, zf + 0.3, rd() * 6, 0.7);
      }
    }
  }

  function sign(rd: () => number): void {
    // A painted board hung square to the front from an iron arm, a gold roundel on each face.
    const side = (spec.seed >> 3) % 2 ? 1 : -1;
    const dx = -W / 2 + 1 + 2 * di;
    const x = spec.shop ? side * (W / 2 - 0.45) : dx - side * 1.05;
    const y = spec.shop ? 3.72 : 2.98;
    const zf = D / 2 + WALL;
    const board = new THREE.BoxGeometry(0.05, 0.5, 0.62).translate(x, y - 0.42, zf + 0.62);
    geo(board, mat.paint, lin(pick(rd, ['#24508f', '#7a2e2a', '#2b6f5a', '#c9902f', '#3a2f6a', '#1f585c'] as const)));
    const disc = lathe([[0, 0], [0.15, 0], [0.15, 0.012], [0.11, 0.03], [0, 0.03]], 14);
    geo(disc.clone().rotateZ(-Math.PI / 2).translate(x + 0.025, y - 0.42, zf + 0.62), mat.gold, undefined);
    geo(disc.rotateZ(Math.PI / 2).translate(x - 0.025, y - 0.42, zf + 0.62), mat.gold, undefined);
    const arm = tube([new THREE.Vector3(x, y, zf), new THREE.Vector3(x, y, zf + 1.0)], () => 0.025, 6);
    const brace = tube([new THREE.Vector3(x, y - 0.45, zf), new THREE.Vector3(x, y - 0.12, zf + 0.25), new THREE.Vector3(x, y, zf + 0.62)], () => 0.016, 5);
    const rings = [0.38, 0.86].map((z) => tube([new THREE.Vector3(x, y, zf + z), new THREE.Vector3(x, y - 0.17, zf + z)], () => 0.012, 4));
    geo(mergeGeometries([arm, brace, ...rings], false)!, mat.iron, undefined);
  }

  function banner(): void {
    // On a pier between windows, hung below the top storey band from an iron arm.
    const piers = spec.width - 1;
    const px = piers > 0 ? -W / 2 + 2 * (1 + (spec.seed % piers)) : -W / 2 + 0.35;
    const y0 = (F - 1) * H - 0.15;
    const g = bannerGeometry(0.8, 2.6, spec.seed);
    g.translate(px, y0, D / 2 + WALL + 0.42);
    geo(g, mat.banner, WHITE);
    fb?.frame().geo(mat.banner, bannerGeometry(0.8, 2.6, spec.seed, 2, 2).translate(px, y0, D / 2 + WALL + 0.42));
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
    const piece = `Roof_RoundTiles_${span}x${L}`;
    if (ridge === 'x') put(village, piece, st.paint, st.roof, shift, top, 0, Math.PI / 2, scale);
    else put(village, piece, st.paint, st.roof, 0, top, 0, 0, scale);
    if (fb) {
      fb.frame(ridge === 'x' ? shift : 0, top, 0, ridge === 'x' ? Math.PI / 2 : 0, 1, 1, scale.z);
      farRoof(span, village.get(piece));
    }
    // Plastered gables without the kit's timbers; left out against a neighbour of the same roofline.
    const gable = `Roof_Front_Brick${span}`;
    const gOver = k.over.plaster;
    const gt = st.t;
    const farGable = (x: number, z: number, yaw: number) => {
      if (!fb) return;
      const gx = span / 2 + 0.123;
      fb.frame(x, top, z, yaw).poly(mat.plaster, wallTint, [[-gx, 0.02, 0], [gx, 0.02, 0], [0, GABLE_FAR[span], 0]], [[0, 0], [gx, 0], [gx / 2, GABLE_FAR[span] * 0.4167]]);
    };
    if (ridge === 'z') {
      put(village, gable, gOver, gt, 0, top, D / 2, 0);
      farGable(0, D / 2, 0);
      if (!hidden('back', 0, F)) {
        put(village, gable, gOver, gt, 0, top, -D / 2, Math.PI);
        farGable(0, -D / 2, Math.PI);
      }
      finial(0, top + RIDGE[span] + 0.02, D / 2 + 0.55, 1);
    } else {
      if (!spec.trim?.right && !hidden('right', 0, F)) {
        put(village, gable, gOver, gt, W / 2, top, 0, Math.PI / 2);
        farGable(W / 2, 0, Math.PI / 2);
      }
      if (!spec.trim?.left && !hidden('left', 0, F)) {
        put(village, gable, gOver, gt, -W / 2, top, 0, -Math.PI / 2);
        farGable(-W / 2, 0, -Math.PI / 2);
      }
      if (!spec.trim?.left && !spec.trim?.right && r() < 0.5) finial(r() < 0.5 ? -W / 2 - 0.6 : W / 2 + 0.6, top + RIDGE[span] + 0.02, 0, 0.8);
    }
    // Dormers on the street slope of deep eaves roofs.
    if (ridge === 'x' && span >= 6) {
      const n = W >= 6 ? (r() < 0.5 ? 2 : 1) : r() < 0.6 ? 1 : 0;
      for (let j = 0; j < n; j++) {
        const dx = n === 1 ? (r() - 0.5) * (W - 3) : (j === 0 ? -1 : 1) * (W / 4);
        const lit = glassTint(st.roof);
        put(village, 'Roof_Dormer_RoundTile', st.paint, lit, dx, top + 0.95, span / 2 - 1.95, -Math.PI / 2);
        if (fb) farDormer(dx, top + 0.95, span / 2 - 1.95, lit.get(mat.glass)!);
      }
    }
    // Chimney stacks on the party walls, through the ridge.
    const rh = RIDGE[span];
    const stacks = r() < 0.55 ? 2 : 1;
    for (let j = 0; j < stacks; j++) {
      const sideSign = j === 0 ? (spec.seed % 2 ? 1 : -1) : spec.seed % 2 ? -1 : 1;
      const [cx, cz] = ridge === 'x' ? [sideSign * (W / 2 - 0.55), (r() - 0.5) * 0.8] : [sideSign * 0.3 + (r() - 0.5) * 0.4, -D / 4 - r() * D * 0.2];
      const h = rh + 0.9 + r() * 0.6 - (ridge === 'z' ? 0 : 0.1);
      const cyaw = (spec.seed % 4) * (Math.PI / 2);
      put(village, 'Prop_Chimney2', st.wall, st.t, cx, top - 0.4, cz, cyaw, v(0.85, (h + 0.4) / 3, 0.85));
      if (fb) {
        fb.frame(cx, top - 0.4, cz, cyaw, 0.85, (h + 0.4) / 3, 0.85).box(mat.limestone, stoneTint, -0.5, 0, -0.494, 0.446, 2.8, 0.494, 'ny');
        fb.box(mat.limestone, stoneTint, -0.56, 2.8, -0.55, 0.5, 3, 0.55, 'ny');
      }
    }
  }

  /** The far roof: a tiled section with a ridge cap, fascia and soffit on the eaves, bargeboards at the ends. */
  function farRoof(span: number, piece: Piece): void {
    if (!fb) return;
    const p = ROOF_FAR[span];
    const tiles = piece.parts.find((pt) => pt.material.name === 'MI_RoundTiles')?.geometry.boundingBox ?? piece.box;
    const z0 = tiles.min.z;
    const z1 = tiles.max.z;
    const rc = 0.375;
    const xe = p.eave;
    const yAt = (x: number) => p.a - p.k * x;
    const ye = yAt(xe);
    const yc = yAt(rc);
    const slope = Math.hypot(1, p.k);
    const roof = st.roof.get(mat.tiles)!;
    const trim = st.roof.get(mat.paint)!;
    const tu = (z: number) => -0.318 * z;
    const tv = (x: number) => 0.24 * slope * x;
    const wallLine = span / 2;
    const yw = yAt(wallLine);
    for (const sx of [-1, 1]) {
      const X = (x: number) => sx * x;
      // Tiles from the eave to the cap, then the cap to the ridge (counter-clockwise from outside).
      const slab = (xa: number, ya: number, xb: number, yb: number) => {
        const pts: Vec3[] = [[X(xa), ya, z1], [X(xa), ya, z0], [X(xb), yb, z0], [X(xb), yb, z1]];
        fb.poly(mat.tiles, roof, sx > 0 ? pts : [pts[1], pts[0], pts[3], pts[2]], sx > 0 ? [[tu(z1), tv(xa)], [tu(z0), tv(xa)], [tu(z0), tv(xb)], [tu(z1), tv(xb)]] : [[tu(z0), tv(xa)], [tu(z1), tv(xa)], [tu(z1), tv(xb)], [tu(z0), tv(xb)]]);
      };
      slab(xe, ye, rc, yc);
      slab(rc, yc, 0, p.ridge);
      // Fascia board and soffit under the eave, back to the wall line.
      const f0: Vec3[] = [[X(xe), ye - 0.28, z1], [X(xe), ye - 0.28, z0], [X(xe), ye, z0], [X(xe), ye, z1]];
      fb.poly(mat.tiles, roof, sx > 0 ? f0 : [f0[1], f0[0], f0[3], f0[2]], [[tu(z1), 0.1], [tu(z0), 0.1], [tu(z0), 0.16], [tu(z1), 0.16]]);
      const s0: Vec3[] = [[X(wallLine), yw - 0.85, z1], [X(wallLine), yw - 0.85, z0], [X(xe), ye - 0.28, z0], [X(xe), ye - 0.28, z1]];
      fb.poly(mat.paint, trim, sx > 0 ? s0 : [s0[1], s0[0], s0[3], s0[2]], [[0, 0.32], [1, 0.32], [1, 0.55], [0, 0.55]]);
      // Bargeboards: the roof's thickness at both ends.
      for (const [z, out] of [[z0, -1], [z1, 1]] as const) {
        const e: Vec3[] = [[X(xe), ye - 0.28, z], [X(0), p.ridge - 0.42, z], [X(0), p.ridge, z], [X(xe), ye, z]];
        const flip = (sx > 0) !== (out > 0);
        fb.poly(mat.paint, trim, flip ? e : [e[1], e[0], e[3], e[2]], [[0, 0.05], [1, 0.05], [1, 0.25], [0, 0.25]]);
      }
    }
  }

  function farDormer(x: number, y: number, z: number, glass: THREE.Color): void {
    if (!fb) return;
    // Dormer frame: +x is out of the roof (toward the street).
    fb.frame(x, y, z, -Math.PI / 2);
    const roof = st.roof.get(mat.tiles)!;
    const fx = 1.64;
    fb.poly(mat.plaster, wallTint, [[fx, 0.07, 0.72], [fx, 0.07, -0.72], [fx, 1.46, -0.72], [fx, 2.18, 0], [fx, 1.46, 0.72]], [[0, 0], [0.72, 0], [0.72, 0.6], [0.36, 0.9], [0, 0.6]]);
    fb.poly(mat.farGlass, new THREE.Color(glass.r, 2 / 8, 2 / 8), [[fx + 0.01, 0.2, 0.48], [fx + 0.01, 0.2, -0.48], [fx + 0.01, 1.09, -0.48], [fx + 0.01, 1.09, 0.48]], [[-0.1, -0.1], [2.1, -0.1], [2.1, 2.1], [-0.1, 2.1]], 0);
    for (const sz of [-1, 1]) {
      const cheek: Vec3[] = [[0.2, 0.07, sz * 0.72], [fx, 0.07, sz * 0.72], [fx, 1.46, sz * 0.72], [0.2, 1.46, sz * 0.72]];
      fb.poly(mat.plaster, wallTint, sz > 0 ? cheek : [cheek[1], cheek[0], cheek[3], cheek[2]], [[0, 0], [0.7, 0], [0.7, 0.6], [0, 0.6]]);
      const slope: Vec3[] = [[-0.02, 1.5, sz * 1.22], [1.9, 1.5, sz * 1.22], [1.9, 2.7, 0], [-0.02, 2.7, 0]];
      fb.poly(mat.tiles, roof, sz > 0 ? slope : [slope[1], slope[0], slope[3], slope[2]], [[0, 0], [0.6, 0], [0.6, 0.4], [0, 0.4]]);
    }
  }

  /** A gilded finial: turned spike and orb on the gable peak; corner houses fly a weathervane. */
  function finial(x: number, y: number, z: number, s: number): void {
    const g = lathe([[0, 0], [0.09, 0], [0.11, 0.06], [0.05, 0.14], [0.04, 0.42], [0.1, 0.5], [0.13, 0.6], [0.1, 0.7], [0.04, 0.76], [0.025, 1.05], [0, 1.2]], 10).scale(s, s, s).translate(x, y, z);
    geo(g, mat.gold, undefined);
    fb?.frame().geo(mat.gold, lathe(FINIAL_FAR, 3).scale(s, s, s).translate(x, y, z));
    if (spec.corner?.left || spec.corner?.right) {
      const arrow = new THREE.Shape([new THREE.Vector2(-0.55, -0.02), new THREE.Vector2(0.32, -0.02), new THREE.Vector2(0.3, -0.12), new THREE.Vector2(0.55, 0), new THREE.Vector2(0.3, 0.12), new THREE.Vector2(0.32, 0.02), new THREE.Vector2(-0.4, 0.02), new THREE.Vector2(-0.55, 0.16), new THREE.Vector2(-0.48, 0), new THREE.Vector2(-0.55, -0.16)]);
      const vane = new THREE.ExtrudeGeometry(arrow, { depth: 0.03, bevelEnabled: false }).translate(0, 0, -0.015).rotateY((spec.seed % 7) * 0.9);
      geo(vane.scale(s, s, s).translate(x, y + 1.0 * s, z), mat.gold, undefined);
    }
  }
}
const LEAF_TONE = lin('#4f7a2e');
const SHOP_CEILING = lin('#6d5440');
const SHOP_FLOOR = lin('#8a6a4a');
type Vec3 = [number, number, number];

/**
 * A shop awning `w` wide: the cloth falls `proj` out from the wall and `drop` down, sagging between its stays,
 * finished with a scalloped valance. aCloth carries the stripe coordinate (metres across, along the fall).
 */
export function awningGeometry(w: number, proj: number, drop: number, scallopSeed = 1, far = false): THREE.BufferGeometry {
  // The far build keeps the fall and the stripes (they are in the shader) and drops the sag and scallops.
  const nx = far ? 1 : Math.max(8, Math.round(w * 6));
  const nz = far ? 1 : 6;
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
    const hem = far ? 0.2 : 0.14 + 0.1 * Math.sin(Math.PI * phase);
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
export function bannerGeometry(w: number, h: number, seed = 0, nx = 6, ny = 14): THREE.BufferGeometry {
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
  /** The quarter's colours for every house it plans (HOUSE_PALETTES). */
  palette?: string;
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
                palette: o.palette,
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
  for (const l of all) colliders.push(...goodsColliders(l.spec));
  for (const y of yards) if (y.solid > 0) colliders.push({ x: y.x, z: y.z, hx: y.solid, hz: y.solid, c: Math.cos(y.yaw), s: Math.sin(y.yaw), y0: y.y - 1, y1: y.y + 2 });
  return { houses, lots: all, yards, colliders, lanes };
}

// ------------------------------------------------------------------------------------------------
// Districts

export interface DistrictOptions extends DistrictPlanOptions {
  kit: TidecrownKit;
  /** Pennant strings across the streets between facing houses (default on). */
  bunting?: boolean;
  /**
   * A city's shared LOD (see cityLod): the district adds its chunks there and the caller builds it once, after
   * every district. Without one the district makes and builds its own (on `renderer`).
   */
  lod?: TidecrownLod<TideBatch>;
  renderer?: THREE.WebGLRenderer;
  /** Chunk size, switch distances and shadows of the district's own LOD (ignored with `lod`). */
  lodOptions?: LodOptions;
  name?: string;
}
export interface District {
  /** The district's LOD, built; an empty group when it went into a shared `lod`. */
  group: THREE.Object3D;
  lots: TownhouseLot[];
  /** Every solid of the district (houses, yards, shop goods), from the plan. */
  colliders: TidecrownCollider[];
  /** Lantern anchors beside doors (world). */
  lamps: { x: number; y: number; z: number; yaw: number }[];
  /** Back lanes the district added between its rows (pave and keep clear like streets). */
  lanes: DistrictStreet[];
  stats: { houses: number; meshes: number; triangles: number; farTriangles: number; chunks: number; pieces: Record<string, number> };
}

/** A LOD for a whole city of districts: pass it to every fillDistrict, then build it and add it to the scene. */
export function cityLod(kit: TidecrownKit, renderer: THREE.WebGLRenderer, opts: LodOptions = {}, name = 'tidecrown-city'): TidecrownLod<TideBatch> {
  return new TidecrownLod(renderer, (n) => new TideBatch(kit, n), opts, name);
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
function buntingStrings(o: DistrictOptions, plan: DistrictPlan): { x: number; z: number; a: THREE.Vector3; b: THREE.Vector3; sag: number; seed: number }[] {
  const r = stream((o.seed ?? 1) + 77);
  const setback = o.setback ?? 0.9;
  const out: { x: number; z: number; a: THREE.Vector3; b: THREE.Vector3; sag: number; seed: number }[] = [];
  for (const st of o.streets) {
    // Squares and avenues are too wide to string across.
    if (st.width > 20) continue;
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
      out.push({ x, z, a: pa, b: pb, sag: 0.45 + r() * 0.35, seed: Math.floor(r() * 6) });
    }
  }
  return out;
}
const IDENTITY = new THREE.Matrix4();
const TREE_FAR = new THREE.IcosahedronGeometry(1, 0);
const TREE_LEAF = lin('#5d8a34');

/** A batch that keeps nothing: the far pass runs the builder without its kit pieces. */
class NoBatch extends TideBatch {
  override put(): void {}
  override addGeometry(): void {}
}

/**
 * Plan (or take the plan of) a district of townhouses and add it to LOD chunks: the far builds (buildTownhouse's far
 * build) now, the near detail (the kit) as a recipe per house, yard piece and pennant string that the LOD runs when
 * it builds the chunk. On the district's own LOD (built here) or a shared city one (built by the caller, see
 * TidecrownLod.buildFar and stream). Deterministic from `seed`.
 */
export function fillDistrict(o: DistrictOptions, plan: DistrictPlan = planDistrict(o)): District {
  const name = o.name ?? 'tidecrown-district';
  if (!o.lod && !o.renderer) throw new Error('fillDistrict: a district without a shared LOD needs a renderer');
  const lod = o.lod ?? new TidecrownLod(o.renderer!, (n) => new TideBatch(o.kit, n), o.lodOptions, name);
  const extras: HouseExtras = { lamps: [] };
  const none = new NoBatch(o.kit, `${name}:none`);
  for (const h of plan.houses) {
    buildTownhouse(h, none, extras, lod.chunkAt(h.x, h.z).far);
    lod.recipe(h.x, h.z, (b) => buildTownhouse(h, b));
  }
  const m = new THREE.Matrix4();
  for (const y of plan.yards) {
    const kit = o.kit[y.kit];
    const over = y.kit === 'props' ? o.kit.over.props : y.kit === 'nature' ? o.kit.over.nature : o.kit.over.wall;
    lod.recipe(y.x, y.z, (b) => b.put(kit, y.piece, m.copy(trs(y.x, y.y - 0.02, y.z, y.yaw, y.s)), over, null, true));
    // Far: trees as a leafy blob on a trunk; the small yard things are left out.
    if (y.piece.startsWith('CommonTree')) {
      const far = lod.chunkAt(y.x, y.z).far;
      far.house(trs(y.x, y.y, y.z, y.yaw, y.s));
      far.box(o.kit.mat.paint, TRUNK_TONE, -0.35, 0, -0.35, 0.35, 3.2, 0.35, 'ny py');
      far.frame(0, 5.6, 0, 0, 1.95, 2.6, 1.95).geo(o.kit.mat.paint, TREE_FAR, TREE_LEAF);
    }
  }
  if (o.bunting !== false) {
    for (const s of buntingStrings(o, plan)) {
      // Far: the flags without their cord.
      lod.chunkAt(s.x, s.z).far.house(IDENTITY).geo(o.kit.mat.pennant, buntingGeometry(s.a, s.b, s.sag, s.seed).flags);
      lod.recipe(s.x, s.z, (b) => {
        const g = buntingGeometry(s.a, s.b, s.sag, s.seed);
        b.addGeometry(g.flags, o.kit.mat.pennant, null, false);
        b.addGeometry(g.cord, o.kit.mat.iron, null, false);
      });
    }
  }
  let group: THREE.Object3D;
  if (o.lod) {
    group = new THREE.Group();
    group.name = name;
  } else group = lod.build();
  const ls = lod.stats;
  const top = Object.fromEntries([...lod.pieceTris].sort((a, b) => b[1] - a[1]).slice(0, 14));
  return {
    group,
    lots: plan.lots,
    colliders: plan.colliders,
    lamps: extras.lamps,
    lanes: plan.lanes,
    stats: { houses: plan.houses.length, meshes: ls.meshes, triangles: ls.nearTriangles, farTriangles: ls.farTriangles, chunks: ls.chunks, pieces: top },
  };
}
const TRUNK_TONE = lin('#6b5038');
