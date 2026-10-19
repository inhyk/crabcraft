// Tidecrown's distance LOD. A city is cut into square chunks on the world grid; each chunk has a near build (the
// full kit townhouses) and a far build (walls, roofs, windows and trims as plain quads and prisms in the same
// materials, a few hundred triangles a house). Every chunk of one material draws as one multi-draw BatchedMesh,
// so draw calls do not grow with the chunk count. Each frame the chunks swap near/far by distance with
// hysteresis, and near chunks past the shadow distance cast their far build's shadow instead of the near one.
import * as THREE from 'three';
import { harmonise } from '../../world/kit';

export interface Merged {
  material: THREE.Material;
  castShadow: boolean;
  geometry: THREE.BufferGeometry;
}

// ------------------------------------------------------------------------------------------------
// Far builds

type Vec = [number, number, number];

class Lump {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  cloth: number[] | null = null;
  idx: number[] = [];
  get count(): number {
    return this.pos.length / 3;
  }
}

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/**
 * Cheap stand-in geometry, appended straight into per-material arrays. Points are given in the current frame
 * (`frame()`), usually a wall module or a house; colours ride on vertex colour like the near build's tints.
 */
export class FarBatch {
  readonly lumps = new Map<THREE.Material, Lump>();
  private m = new THREE.Matrix4();
  private nm = new THREE.Matrix3();
  private base = new THREE.Matrix4();
  /** Triangles added, for budgeting. */
  triangles = 0;

  /** The house (or other) frame that sub-frames are relative to. */
  house(m: THREE.Matrix4): this {
    this.base.copy(m);
    return this.frame();
  }
  /** A sub-frame of the house: position and yaw (and optional scale) like trs(). */
  frame(x = 0, y = 0, z = 0, yaw = 0, sx = 1, sy = 1, sz = 1): this {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    this.m.set(c * sx, 0, s * sz, x, 0, sy, 0, y, -s * sx, 0, c * sz, z, 0, 0, 0, 1).premultiply(this.base);
    this.nm.getNormalMatrix(this.m);
    return this;
  }
  /** Use an explicit matrix (relative to the house frame). */
  frameMatrix(local: THREE.Matrix4): this {
    this.m.multiplyMatrices(this.base, local);
    this.nm.getNormalMatrix(this.m);
    return this;
  }

  private lump(mat: THREE.Material): Lump {
    let l = this.lumps.get(mat);
    if (!l) this.lumps.set(mat, (l = new Lump()));
    return l;
  }

  /** A planar polygon (convex, counter-clockwise seen from its front), flat-shaded. */
  poly(mat: THREE.Material, color: THREE.Color, pts: Vec[], uvs: [number, number][], alpha = 1): void {
    const l = this.lump(mat);
    const i0 = l.count;
    _a.set(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]);
    _b.set(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1], pts[pts.length - 1][2] - pts[0][2]);
    _n.crossVectors(_a, _b).applyMatrix3(this.nm).normalize();
    for (let i = 0; i < pts.length; i++) {
      _v.set(pts[i][0], pts[i][1], pts[i][2]).applyMatrix4(this.m);
      l.pos.push(_v.x, _v.y, _v.z);
      l.nor.push(_n.x, _n.y, _n.z);
      l.uv.push(uvs[i][0], uvs[i][1]);
      l.col.push(color.r, color.g, color.b, alpha);
      l.cloth?.push(0, 0);
    }
    for (let i = 1; i < pts.length - 1; i++) l.idx.push(i0, i0 + i, i0 + i + 1);
    this.triangles += pts.length - 2;
  }

  /**
   * A rectangle in the frame's xy plane at depth z, facing +z (or -z with `back`). UVs are world-scaled from the
   * frame origin: u = (x - ou) * su, v = (y - ov) * sv.
   */
  rect(mat: THREE.Material, color: THREE.Color, x0: number, y0: number, x1: number, y1: number, z: number, uv: [number, number, number, number] = [0.5, 0.5, 0, 0], back = false): void {
    if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4) return;
    const [su, sv, ou, ov] = uv;
    const u0 = (x0 - ou) * su;
    const u1 = (x1 - ou) * su;
    const v0 = (y0 - ov) * sv;
    const v1 = (y1 - ov) * sv;
    if (back)
      this.poly(mat, color, [[x1, y0, z], [x0, y0, z], [x0, y1, z], [x1, y1, z]], [[u1, v0], [u0, v0], [u0, v1], [u1, v1]]);
    else this.poly(mat, color, [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
  }

  /** An axis-aligned box in the frame, without the faces in `skip` ('px','nx','py','ny','pz','nz'). */
  box(mat: THREE.Material, color: THREE.Color, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, skip = 'ny', s = 0.5): void {
    const f = (k: string) => !skip.includes(k);
    if (f('pz')) this.poly(mat, color, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [[x0 * s, y0 * s], [x1 * s, y0 * s], [x1 * s, y1 * s], [x0 * s, y1 * s]]);
    if (f('nz')) this.poly(mat, color, [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [[x1 * s, y0 * s], [x0 * s, y0 * s], [x0 * s, y1 * s], [x1 * s, y1 * s]]);
    if (f('px')) this.poly(mat, color, [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [[z1 * s, y0 * s], [z0 * s, y0 * s], [z0 * s, y1 * s], [z1 * s, y1 * s]]);
    if (f('nx')) this.poly(mat, color, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [[z0 * s, y0 * s], [z1 * s, y0 * s], [z1 * s, y1 * s], [z0 * s, y1 * s]]);
    if (f('py')) this.poly(mat, color, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [[x0 * s, z1 * s], [x1 * s, z1 * s], [x1 * s, z0 * s], [x0 * s, z0 * s]]);
    if (f('ny')) this.poly(mat, color, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [[x0 * s, z0 * s], [x1 * s, z0 * s], [x1 * s, z1 * s], [x0 * s, z1 * s]]);
  }

  /**
   * A box of trim (bands, pilasters) whose faces each take one strip of a trim sheet: the face's long side runs
   * along u (`s` per unit), its short side across v0..v1.
   */
  trimBox(mat: THREE.Material, color: THREE.Color, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, skip: string, s: number, v0: number, v1: number): void {
    const faces: [string, Vec[]][] = [
      ['pz', [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
      ['nz', [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]],
      ['px', [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]],
      ['nx', [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]],
      ['py', [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]],
      ['ny', [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
    ];
    for (const [k, p] of faces) {
      if (skip.includes(k)) continue;
      const d = (a: Vec, b: Vec) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const w = d(p[0], p[1]);
      const h = d(p[0], p[3]);
      // Long side along u.
      const uv: [number, number][] = w >= h ? [[0, v0], [w * s, v0], [w * s, v1], [0, v1]] : [[0, v0], [0, v1], [h * s, v1], [h * s, v0]];
      this.poly(mat, color, p, uv);
    }
  }

  /** Any indexed or plain geometry in the frame (its uv, colour and aCloth are kept; colour multiplies `color`). */
  geo(mat: THREE.Material, g: THREE.BufferGeometry, color: THREE.Color = WHITE): void {
    const l = this.lump(mat);
    const i0 = l.count;
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const uv = g.getAttribute('uv');
    const col = g.getAttribute('color');
    const cloth = g.getAttribute('aCloth');
    if (cloth && !l.cloth) l.cloth = new Array(i0 * 2).fill(0);
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(this.m);
      l.pos.push(_v.x, _v.y, _v.z);
      if (nor) _n.fromBufferAttribute(nor, i).applyMatrix3(this.nm).normalize();
      else _n.set(0, 1, 0);
      l.nor.push(_n.x, _n.y, _n.z);
      l.uv.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
      if (col) l.col.push(col.getX(i) * color.r, col.getY(i) * color.g, col.getZ(i) * color.b, 1);
      else l.col.push(color.r, color.g, color.b, 1);
      if (l.cloth) l.cloth.push(cloth ? cloth.getX(i) : 0, cloth ? cloth.getY(i) : 0);
    }
    const index = g.getIndex();
    const n = index ? index.count : pos.count;
    for (let i = 0; i < n; i++) l.idx.push(i0 + (index ? index.getX(i) : i));
    this.triangles += n / 3;
  }

  /** One geometry per material; empties the batch. */
  merge(castShadow: (m: THREE.Material) => boolean): Merged[] {
    const out: Merged[] = [];
    for (const [material, l] of this.lumps) {
      if (!l.idx.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(l.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(l.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(l.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(l.col, 4));
      if (l.cloth) g.setAttribute('aCloth', new THREE.Float32BufferAttribute(l.cloth, 2));
      g.setIndex(l.idx);
      out.push({ material, castShadow: castShadow(material), geometry: g });
    }
    this.lumps.clear();
    return out;
  }
}
const WHITE = new THREE.Color(1, 1, 1);

// ------------------------------------------------------------------------------------------------
// Batched meshes with a visibility mask per render pass

/** Per-frame cost of the LOD's meshes, both passes. */
export interface LodFrame {
  calls: number;
  triangles: number;
  shadowCalls: number;
  shadowTriangles: number;
}

/** A BatchedMesh whose instances (chunks) can be shown in the camera pass and the shadow pass independently. */
export class LodMesh extends THREE.BatchedMesh {
  /** Instance index per chunk index (-1: the chunk has nothing in this material). */
  readonly slot: Int32Array;
  /** Chunk index per instance. */
  readonly chunkOf: Int32Array;
  readonly main: Uint8Array;
  readonly shadow: Uint8Array;
  frame: LodFrame | null = null;
  /** Per chunk: can its shadow reach the camera's view this frame (set by the LOD before the shadow pass). */
  casts: ((shadowCamera: THREE.Camera) => Uint8Array) | null = null;
  multiDraw = true;
  private mask: Uint8Array;

  constructor(
    chunks: number,
    instances: number,
    vertices: number,
    indices: number,
    material: THREE.Material,
    readonly far: boolean,
  ) {
    super(instances, vertices, indices, material);
    this.slot = new Int32Array(chunks).fill(-1);
    this.chunkOf = new Int32Array(instances).fill(-1);
    this.main = new Uint8Array(instances);
    this.shadow = new Uint8Array(instances);
    this.mask = new Uint8Array(instances);
    this.perObjectFrustumCulled = true;
    // Front to back: fewer overdrawn pixels on the near chunks.
    this.sortObjects = true;
  }

  private show(mask: Uint8Array): void {
    for (let i = 0; i < mask.length; i++) if (this.getVisibleAt(i) !== !!mask[i]) this.setVisibleAt(i, !!mask[i]);
  }

  private tally(shadow: boolean): void {
    const f = this.frame;
    if (!f) return;
    // three.js keeps the multi-draw list of the pass it just culled for on these fields.
    const md = this as unknown as { _multiDrawCount: number; _multiDrawCounts: Int32Array };
    const n = md._multiDrawCount;
    if (!n) return;
    let idx = 0;
    for (let i = 0; i < n; i++) idx += md._multiDrawCounts[i];
    if (shadow) {
      f.shadowCalls += this.multiDraw ? 1 : n;
      f.shadowTriangles += idx / 3;
    } else {
      f.calls += this.multiDraw ? 1 : n;
      f.triangles += idx / 3;
    }
  }

  override onBeforeRender(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, geometry: THREE.BufferGeometry, material: THREE.Material, group: THREE.Group): void {
    this.multiDraw = renderer.extensions.has('WEBGL_multi_draw');
    this.show(this.main);
    super.onBeforeRender(renderer, scene, camera, geometry, material, group);
    this.tally(false);
  }

  override onBeforeShadow(renderer: THREE.WebGLRenderer, scene: THREE.Scene, _camera: THREE.Camera, shadowCamera: THREE.Camera, geometry: THREE.BufferGeometry, depthMaterial: THREE.Material, group: THREE.Group): void {
    const casts = this.casts?.(shadowCamera);
    for (let i = 0; i < this.mask.length; i++) this.mask[i] = this.shadow[i] && (!casts || casts[this.chunkOf[i]]) ? 1 : 0;
    this.show(this.mask);
    // BatchedMesh's own onBeforeShadow would call our onBeforeRender (and its camera-pass mask): cull directly.
    super.onBeforeRender(renderer, scene, shadowCamera, geometry, depthMaterial, group);
    this.tally(true);
  }
}

// ------------------------------------------------------------------------------------------------
// The chunked LOD

export interface LodOptions {
  /** Chunk edge on the world grid (default 16: draw calls do not grow with chunks, triangles shrink with them). */
  chunk?: number;
  /** A chunk whose bounds come closer than this shows its near build (default 100). */
  near?: number;
  /** It goes back to the far build only past near + hysteresis, and shadows likewise (default 12). */
  hysteresis?: number;
  /** Near chunks closer than this cast their own shadows; the rest cast the far build's (default 50). */
  shadow?: number;
  /** Far builds cast shadows (default true; glass never does). */
  farShadows?: boolean;
}

export interface NearSink {
  merge(): Merged[];
}

interface Chunk<N extends NearSink> {
  i: number;
  j: number;
  near: N;
  far: FarBatch;
  box: THREE.Box3;
  isNear: boolean;
  shadowNear: boolean;
  nearTriangles: number;
  farTriangles: number;
}

const _p = new THREE.Vector3();
const _c = new THREE.Vector3();
const _e = new THREE.Vector3();
const _l = new THREE.Vector3();
const _m4 = new THREE.Matrix4();

/**
 * The city's houses as LOD chunks. Add builds with `chunkAt(x, z)`, call `build()` once, put it in the scene; it
 * updates itself for the camera that renders it (or only for `follow` when set).
 */
export class TidecrownLod<N extends NearSink = NearSink> extends THREE.LOD {
  readonly opts: Required<LodOptions>;
  readonly chunks: Chunk<N>[] = [];
  private grid = new Map<string, Chunk<N>>();
  readonly meshes: LodMesh[] = [];
  /** Only this camera moves the LOD (others render whatever state it left). */
  follow: THREE.Camera | null = null;
  /** Force every chunk near or far (QA). */
  force: 'near' | 'far' | null = null;
  /** Cost of the last render (camera and shadow pass). */
  readonly frame: LodFrame = { calls: 0, triangles: 0, shadowCalls: 0, shadowTriangles: 0 };
  built = false;
  /** The camera's frustum of the last update, and which chunks' shadows can fall inside it. */
  private view = new THREE.Frustum();
  private casting = new Uint8Array(0);
  private castingFor = -1;
  private frameNo = 0;

  constructor(
    private makeNear: (name: string) => N,
    opts: LodOptions = {},
    name = 'tidecrown-lod',
  ) {
    super();
    this.name = name;
    const set = Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined && !Number.isNaN(v)));
    this.opts = { chunk: 16, near: 100, hysteresis: 12, shadow: 50, farShadows: true, ...set };
  }

  /** The chunk holding world point (x, z). */
  chunkAt(x: number, z: number): { near: N; far: FarBatch } {
    const i = Math.floor(x / this.opts.chunk);
    const j = Math.floor(z / this.opts.chunk);
    const key = `${i},${j}`;
    let c = this.grid.get(key);
    if (!c) {
      c = { i, j, near: this.makeNear(`${this.name}:${key}`), far: new FarBatch(), box: new THREE.Box3(), isNear: false, shadowNear: false, nearTriangles: 0, farTriangles: 0 };
      this.grid.set(key, c);
      this.chunks.push(c);
    }
    return c;
  }

  /** Merge every chunk into one BatchedMesh per material (near ones split by shadow flag). */
  build(): this {
    if (this.built) throw new Error('TidecrownLod built twice');
    this.built = true;
    const lists = new Map<string, { material: THREE.Material; castShadow: boolean; far: boolean; items: { chunk: number; geometry: THREE.BufferGeometry }[] }>();
    const farCasts = (m: THREE.Material) => this.opts.farShadows && !/glass|vine/.test(m.name);
    this.chunks.forEach((c, ci) => {
      const add = (list: Merged[], far: boolean) => {
        for (const e of list) {
          const key = `${far ? 'far' : 'near'}|${e.material.uuid}|${e.castShadow}`;
          let l = lists.get(key);
          if (!l) lists.set(key, (l = { material: e.material, castShadow: e.castShadow, far, items: [] }));
          e.geometry.computeBoundingBox();
          c.box.union(e.geometry.boundingBox!);
          const tris = (e.geometry.getIndex()?.count ?? e.geometry.getAttribute('position').count) / 3;
          if (far) c.farTriangles += tris;
          else c.nearTriangles += tris;
          l.items.push({ chunk: ci, geometry: e.geometry });
        }
      };
      add(c.near.merge(), false);
      add(c.far.merge(farCasts), true);
    });
    const identity = new THREE.Matrix4();
    for (const l of lists.values()) {
      const geos = harmonise(l.items.map((it) => it.geometry));
      let verts = 0;
      let idx = 0;
      for (const g of geos) {
        verts += g.getAttribute('position').count;
        idx += g.getIndex()!.count;
      }
      const mesh = new LodMesh(this.chunks.length, geos.length, verts, idx, l.material, l.far);
      mesh.name = `${this.name}:${l.far ? 'far' : 'near'}:${l.material.name}${l.castShadow ? '' : ':noshadow'}`;
      mesh.castShadow = l.castShadow;
      mesh.receiveShadow = true;
      mesh.frame = this.frame;
      mesh.casts = (cam) => this.castsInto(cam);
      l.items.forEach((it, k) => {
        const id = mesh.addInstance(mesh.addGeometry(geos[k]));
        mesh.setMatrixAt(id, identity);
        mesh.slot[it.chunk] = id;
        mesh.chunkOf[id] = it.chunk;
        geos[k].dispose();
      });
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      this.meshes.push(mesh);
      this.add(mesh);
    }
    for (const c of this.chunks) if (c.box.isEmpty()) c.box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3());
    this.casting = new Uint8Array(this.chunks.length).fill(1);
    this.apply();
    return this;
  }

  /** Swap chunks for `camera` (three.js calls this while projecting the scene, before the shadow pass). */
  override update(camera: THREE.Camera): void {
    if (!this.built || (this.follow && camera !== this.follow)) return;
    this.frame.calls = this.frame.triangles = this.frame.shadowCalls = this.frame.shadowTriangles = 0;
    this.frameNo++;
    this.view.setFromProjectionMatrix(_m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem);
    camera.getWorldPosition(_p);
    const { near, hysteresis, shadow } = this.opts;
    let changed = false;
    for (const c of this.chunks) {
      const d = c.box.distanceToPoint(_p);
      const isNear = this.force ? this.force === 'near' : c.isNear ? d < near + hysteresis : d < near;
      const shadowNear = this.force ? this.force === 'near' && d < shadow : c.shadowNear ? d < shadow + hysteresis : d < shadow;
      if (isNear !== c.isNear || shadowNear !== c.shadowNear) changed = true;
      c.isNear = isNear;
      c.shadowNear = shadowNear;
    }
    if (changed) this.apply();
  }

  /**
   * Per chunk: can its shadow fall inside the camera's view? Each chunk's bounding sphere is swept away from the
   * sun until it reaches the ground under it; a chunk whose sweep misses the view frustum casts nothing anyone sees.
   */
  private castsInto(shadowCamera: THREE.Camera): Uint8Array {
    if (this.castingFor === this.frameNo) return this.casting;
    this.castingFor = this.frameNo;
    // Toward the sun: the shadow camera looks from the light at its target.
    shadowCamera.getWorldDirection(_l).negate();
    const up = Math.max(_l.y, 0.15);
    const planes = this.view.planes;
    this.chunks.forEach((c, ci) => {
      c.box.getCenter(_c);
      const r = c.box.getSize(_e).length() / 2;
      const t = (c.box.max.y - c.box.min.y + 2) / up;
      let inside = 1;
      for (const pl of planes) {
        const d0 = pl.distanceToPoint(_c);
        const d1 = d0 - t * pl.normal.dot(_l);
        if (d0 < -r && d1 < -r) {
          inside = 0;
          break;
        }
      }
      this.casting[ci] = inside;
    });
    return this.casting;
  }

  private apply(): void {
    for (const m of this.meshes) {
      this.chunks.forEach((c, ci) => {
        const id = m.slot[ci];
        if (id < 0) return;
        const nearCasts = c.isNear && c.shadowNear;
        m.main[id] = m.far ? +!c.isNear : +c.isNear;
        m.shadow[id] = m.far ? +!nearCasts : +nearCasts;
      });
    }
  }

  /** Free the batched meshes' GPU buffers. */
  dispose(): void {
    for (const m of this.meshes) m.dispose();
  }

  /** Chunk counts and triangles of the whole city. */
  get stats(): { chunks: number; near: number; meshes: number; nearTriangles: number; farTriangles: number } {
    let nearTriangles = 0;
    let farTriangles = 0;
    let near = 0;
    for (const c of this.chunks) {
      nearTriangles += c.nearTriangles;
      farTriangles += c.farTriangles;
      if (c.isNear) near++;
    }
    return { chunks: this.chunks.length, near, meshes: this.meshes.length, nearTriangles, farTriangles };
  }
}
