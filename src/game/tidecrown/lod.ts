// Tidecrown's distance LOD. A city is cut into square chunks on the world grid; each chunk has a near build (the
// full kit townhouses) and a far build (walls, roofs, windows and trims as plain quads and prisms in the same
// materials, a few hundred triangles a house). Every chunk of one material draws as one multi-draw BatchedMesh,
// so draw calls do not grow with the chunk count. Each frame the chunks swap near/far by distance with
// hysteresis, and near chunks past the shadow distance cast their far build's shadow instead of the near one.
// The far builds are made once; a chunk's near detail is built only as the camera approaches it and freed once it
// has left it behind, into pools whose compact vertex data (int8 normals, uint8 colours) lives only on the GPU.
import * as THREE from 'three';

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
// Compact vertex data

type Kind = 'f32' | 'i8n' | 'u8n';
/** One attribute of a pool: float, or normalised int8 (normals, padded to 4 for aligned strides) or uint8 (colour). */
interface AttrLayout {
  name: string;
  size: number;
  kind: Kind;
}
const BYTES: Record<Kind, 1 | 4> = { f32: 4, i8n: 1, u8n: 1 };
const GL_TYPE: Record<Kind, number> = { f32: 5126, i8n: 5120, u8n: 5121 };
type Packed = { count: number; index: Uint32Array; data: (Float32Array | Int8Array | Uint8Array)[]; box: THREE.Box3; sphere: THREE.Sphere; triangles: number };

const patched = (m: THREE.Material) => m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile;

/**
 * What a material's pool keeps: positions, normals as int8, uv only where a map or a shader patch can read it,
 * colour as uint8 only on vertex-coloured materials, and the cloth weights where the geometry has them.
 */
function layoutFor(material: THREE.Material, geo: THREE.BufferGeometry): AttrLayout[] {
  const m = material as THREE.MeshStandardMaterial;
  const out: AttrLayout[] = [{ name: 'position', size: 3, kind: 'f32' }, { name: 'normal', size: 4, kind: 'i8n' }];
  const maps = m.map || m.normalMap || m.roughnessMap || m.metalnessMap || m.aoMap || m.emissiveMap || m.bumpMap || m.alphaMap || m.lightMap;
  if (geo.getAttribute('uv') && (maps || patched(m))) out.push({ name: 'uv', size: 2, kind: 'f32' });
  if (m.vertexColors) out.push({ name: 'color', size: 4, kind: 'u8n' });
  if (geo.getAttribute('aCloth')) out.push({ name: 'aCloth', size: 2, kind: 'f32' });
  return out;
}

/** A merged geometry in a pool's layout (missing attributes get defaults: normal up, colour white, zeros). */
function pack(geo: THREE.BufferGeometry, layout: AttrLayout[]): Packed {
  const n = geo.getAttribute('position').count;
  const data = layout.map((a) => {
    const src = geo.getAttribute(a.name) as THREE.BufferAttribute | undefined;
    const plain = src && !(src as unknown as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute && !src.normalized ? (src.array as ArrayLike<number>) : null;
    const k = src?.itemSize ?? 0;
    const get = (i: number, c: number, d: number) => (c >= k ? d : plain ? plain[i * k + c] : src!.getComponent(i, c));
    if (a.kind === 'f32') {
      if (src && plain instanceof Float32Array && k === a.size) return plain;
      const out = new Float32Array(n * a.size);
      if (src) for (let i = 0; i < n; i++) for (let c = 0; c < a.size; c++) out[i * a.size + c] = get(i, c, 0);
      return out;
    }
    if (a.kind === 'i8n') {
      const out = new Int8Array(n * 4);
      for (let i = 0; i < n; i++) {
        const x = src ? get(i, 0, 0) : 0, y = src ? get(i, 1, 1) : 1, z = src ? get(i, 2, 0) : 0;
        const l = Math.hypot(x, y, z) || 1;
        out[i * 4] = Math.round((x / l) * 127);
        out[i * 4 + 1] = Math.round((y / l) * 127);
        out[i * 4 + 2] = Math.round((z / l) * 127);
      }
      return out;
    }
    const out = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) for (let c = 0; c < 4; c++) out[i * 4 + c] = Math.round(Math.min(1, Math.max(0, src ? get(i, c, 1) : 1)) * 255);
    return out;
  });
  const idx = geo.getIndex();
  let index: Uint32Array;
  if (!idx) index = Uint32Array.from({ length: n }, (_, i) => i);
  else index = idx.array instanceof Uint32Array ? idx.array : Uint32Array.from(idx.array as ArrayLike<number>);
  if (!geo.boundingBox) geo.computeBoundingBox();
  const sphere = new THREE.Sphere();
  geo.boundingBox!.getBoundingSphere(sphere);
  return { count: n, index, data, box: geo.boundingBox!.clone(), sphere, triangles: index.length / 3 };
}

/** Free ranges of a buffer (first fit, neighbours merged). */
class Ranges {
  private at: number[] = [];
  private len: number[] = [];
  cap = 0;
  take(n: number): number {
    for (let i = 0; i < this.at.length; i++) {
      if (this.len[i] < n) continue;
      const a = this.at[i];
      this.at[i] += n;
      this.len[i] -= n;
      if (!this.len[i]) {
        this.at.splice(i, 1);
        this.len.splice(i, 1);
      }
      return a;
    }
    return -1;
  }
  give(a: number, n: number): void {
    if (n <= 0) return;
    let i = 0;
    while (i < this.at.length && this.at[i] < a) i++;
    this.at.splice(i, 0, a);
    this.len.splice(i, 0, n);
    if (i + 1 < this.at.length && this.at[i] + this.len[i] === this.at[i + 1]) {
      this.len[i] += this.len[i + 1];
      this.at.splice(i + 1, 1);
      this.len.splice(i + 1, 1);
    }
    if (i > 0 && this.at[i - 1] + this.len[i - 1] === this.at[i]) {
      this.len[i - 1] += this.len[i];
      this.at.splice(i, 1);
      this.len.splice(i, 1);
    }
  }
  grow(cap: number): void {
    this.give(this.cap, cap - this.cap);
    this.cap = cap;
  }
  get used(): number {
    return this.cap - this.len.reduce((a, b) => a + b, 0);
  }
}

// ------------------------------------------------------------------------------------------------
// Batched meshes on GPU-only buffers, with a visibility mask per render pass

/** Per-frame cost of the LOD's meshes, both passes. */
export interface LodFrame {
  calls: number;
  triangles: number;
  shadowCalls: number;
  shadowTriangles: number;
}

/** BatchedMesh internals the pool fills in itself (three.js r186). */
interface BatchedInternals {
  _geometryInitialized: boolean;
  _geometryCount: number;
  _geometryInfo: Record<string, unknown>[];
  _availableGeometryIds: number[];
  _instanceInfo: { visible: boolean; active: boolean; geometryIndex: number }[];
  _visibilityChanged: boolean;
  _multiDrawCount: number;
  _multiDrawCounts: Int32Array;
}
const NO_INDEX = new Uint32Array(0);
let scratch = new Uint32Array(1 << 16);

/**
 * A multi-draw BatchedMesh of one material whose chunks (instances) can be shown in the camera pass and the shadow
 * pass independently. Its vertex and index buffers live only on the GPU: a chunk is written into a free range with
 * bufferSubData and its arrays are dropped, a removed chunk frees its range, and a full pool grows by a GPU-side copy.
 * three.js's own BatchedMesh keeps a CPU copy of every buffer to write partial updates from, which for the near
 * detail would double the memory, so the pool hands it GLBufferAttributes and its own geometry ranges instead.
 */
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
  /** Bytes held on the GPU (capacity, not just what is in use). */
  bytes = 0;
  private mask: Uint8Array;
  private gl: WebGL2RenderingContext;
  private bufs: WebGLBuffer[] = [];
  private ibuf: WebGLBuffer | null = null;
  private vfree = new Ranges();
  private ifree = new Ranges();
  /** Per chunk: vertex start, count, index start, count. */
  private span: Int32Array;
  private stride: number;
  private bounds = true;

  constructor(
    renderer: THREE.WebGLRenderer,
    readonly layout: AttrLayout[],
    chunks: number,
    vertices: number,
    indices: number,
    material: THREE.Material,
    readonly far: boolean,
  ) {
    super(chunks, Math.max(1, vertices), Math.max(1, indices), material);
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    (this as unknown as BatchedInternals)._geometryInitialized = true;
    this.slot = new Int32Array(chunks).fill(-1);
    this.chunkOf = new Int32Array(chunks).fill(-1);
    this.main = new Uint8Array(chunks);
    this.shadow = new Uint8Array(chunks);
    this.mask = new Uint8Array(chunks);
    this.span = new Int32Array(chunks * 4);
    this.stride = layout.reduce((s, a) => s + a.size * BYTES[a.kind], 0);
    this.perObjectFrustumCulled = true;
    // Front to back: fewer overdrawn pixels on the near chunks.
    this.sortObjects = true;
    this.resize(Math.max(1, vertices), Math.max(1, indices));
  }

  private get internals(): BatchedInternals {
    return this as unknown as BatchedInternals;
  }

  /** New buffers of the given capacity with the old contents copied over on the GPU; fresh attributes rebind them. */
  private resize(vcap: number, icap: number): void {
    const gl = this.gl;
    const usage = this.far ? gl.STATIC_DRAW : gl.DYNAMIC_DRAW;
    if (vcap !== this.vfree.cap) {
      this.bufs = this.layout.map((a, k) => {
        const b = gl.createBuffer()!;
        gl.bindBuffer(gl.COPY_WRITE_BUFFER, b);
        gl.bufferData(gl.COPY_WRITE_BUFFER, vcap * a.size * BYTES[a.kind], usage);
        const old = this.bufs[k];
        if (old) {
          gl.bindBuffer(gl.COPY_READ_BUFFER, old);
          gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, 0, 0, this.vfree.cap * a.size * BYTES[a.kind]);
          gl.deleteBuffer(old);
        }
        return b;
      });
      this.vfree.grow(vcap);
    }
    if (icap !== this.ifree.cap) {
      const b = gl.createBuffer()!;
      // An index buffer takes its type from its first binding, which must not land in whatever VAO three.js left bound.
      const vao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, icap * 4, usage);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
      gl.bindVertexArray(vao);
      if (this.ibuf) {
        gl.bindBuffer(gl.COPY_READ_BUFFER, this.ibuf);
        gl.bindBuffer(gl.COPY_WRITE_BUFFER, b);
        gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, 0, 0, this.ifree.cap * 4);
        gl.deleteBuffer(this.ibuf);
      }
      this.ibuf = b;
      this.ifree.grow(icap);
    }
    gl.bindBuffer(gl.COPY_READ_BUFFER, null);
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);
    const g = this.geometry;
    this.layout.forEach((a, k) => {
      const attr = new THREE.GLBufferAttribute(this.bufs[k], GL_TYPE[a.kind], a.size, BYTES[a.kind], vcap, a.kind !== 'f32');
      g.setAttribute(a.name, attr as unknown as THREE.BufferAttribute);
    });
    const index = new THREE.GLBufferAttribute(this.ibuf!, gl.UNSIGNED_INT, 1, 4, icap);
    // BatchedMesh reads the index's element size from its array.
    (index as unknown as { array: Uint32Array }).array = NO_INDEX;
    g.setIndex(index as unknown as THREE.BufferAttribute);
    this.bytes = vcap * this.stride + icap * 4;
  }

  /** Write a chunk's geometry into free ranges (growing the buffers by a quarter when none fits). */
  insert(chunk: number, p: Packed): void {
    if (this.slot[chunk] >= 0) this.drop(chunk);
    let vs = this.vfree.take(p.count);
    if (vs < 0) {
      this.resize(Math.max(this.vfree.cap + p.count, Math.ceil(this.vfree.cap * 1.25)), this.ifree.cap);
      vs = this.vfree.take(p.count);
    }
    let is = this.ifree.take(p.index.length);
    if (is < 0) {
      this.resize(this.vfree.cap, Math.max(this.ifree.cap + p.index.length, Math.ceil(this.ifree.cap * 1.25)));
      is = this.ifree.take(p.index.length);
    }
    const gl = this.gl;
    this.layout.forEach((a, k) => {
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, this.bufs[k]);
      gl.bufferSubData(gl.COPY_WRITE_BUFFER, vs * a.size * BYTES[a.kind], p.data[k]);
    });
    const m = p.index.length;
    if (scratch.length < m) scratch = new Uint32Array(Math.max(m, scratch.length * 2));
    for (let i = 0; i < m; i++) scratch[i] = p.index[i] + vs;
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, this.ibuf);
    gl.bufferSubData(gl.COPY_WRITE_BUFFER, is * 4, scratch, 0, m);
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);
    const b = this.internals;
    const info = {
      vertexStart: vs, vertexCount: p.count, reservedVertexCount: p.count,
      indexStart: is, indexCount: m, reservedIndexCount: m,
      start: is, count: m, boundingBox: p.box, boundingSphere: p.sphere, active: true,
    };
    let gid: number;
    if (b._availableGeometryIds.length) {
      b._availableGeometryIds.sort((x, y) => x - y);
      gid = b._availableGeometryIds.shift()!;
      b._geometryInfo[gid] = info;
    } else {
      gid = b._geometryCount++;
      b._geometryInfo.push(info);
    }
    const id = this.addInstance(gid);
    this.slot[chunk] = id;
    this.chunkOf[id] = chunk;
    this.main[id] = this.shadow[id] = 0;
    this.span.set([vs, p.count, is, m], chunk * 4);
    this.bounds = true;
  }

  /** Free a chunk's ranges. */
  drop(chunk: number): void {
    const id = this.slot[chunk];
    if (id < 0) return;
    this.deleteGeometry(this.internals._instanceInfo[id].geometryIndex);
    const [vs, n, is, m] = this.span.subarray(chunk * 4, chunk * 4 + 4);
    this.vfree.give(vs, n);
    this.ifree.give(is, m);
    this.slot[chunk] = -1;
    this.chunkOf[id] = -1;
    this.main[id] = this.shadow[id] = 0;
    this.bounds = true;
  }

  /** Bytes of the buffers in use. */
  get usedBytes(): number {
    return this.vfree.used * this.stride + this.ifree.used * 4;
  }

  get empty(): boolean {
    return this.internals._instanceInfo.every((i) => !i.active);
  }

  private show(mask: Uint8Array): void {
    const info = this.internals._instanceInfo;
    for (let i = 0; i < info.length; i++) {
      const v = !!mask[i];
      if (info[i].active && info[i].visible !== v) {
        info[i].visible = v;
        this.internals._visibilityChanged = true;
      }
    }
  }

  private tally(shadow: boolean): void {
    const f = this.frame;
    if (!f) return;
    // three.js keeps the multi-draw list of the pass it just culled for on these fields.
    const n = this.internals._multiDrawCount;
    if (!n) return;
    let idx = 0;
    for (let i = 0; i < n; i++) idx += this.internals._multiDrawCounts[i];
    if (shadow) {
      f.shadowCalls += this.multiDraw ? 1 : n;
      f.shadowTriangles += idx / 3;
    } else {
      f.calls += this.multiDraw ? 1 : n;
      f.triangles += idx / 3;
    }
  }

  /** Bounds of what is in, once per change (before the renderer's frustum test reads them). */
  refreshBounds(): void {
    if (!this.bounds) return;
    this.bounds = false;
    this.computeBoundingBox();
    this.computeBoundingSphere();
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

  /** Free the GPU buffers (three.js frees the same ones again harmlessly when the geometry is disposed). */
  override dispose(): void {
    for (const b of this.bufs) this.gl.deleteBuffer(b);
    if (this.ibuf) this.gl.deleteBuffer(this.ibuf);
    this.bufs = [];
    this.ibuf = null;
    this.bytes = 0;
    super.dispose();
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
  /** Streaming: a chunk's near detail is built once the camera (or where it is heading) comes within near + this (default 10). */
  prebuild?: number;
  /** Streaming: it is freed past near + hysteresis + prebuild + this (default 4). */
  evict?: number;
  /** Streaming: at most this many chunks keep near detail; the farthest past their switch distance go first (default 130). */
  cap?: number;
}

/** A chunk's near detail is built into one of these, then merged a material at a time. */
export interface NearSink {
  mergeSteps(): Generator<void, Merged[]>;
  readonly pieceTris?: Map<string, number>;
}

interface Chunk<N extends NearSink> {
  i: number;
  j: number;
  far: FarBatch;
  /** Steps that fill a fresh near sink with this chunk's detail (houses, yards, bunting), in order. */
  recipe: ((near: N) => void)[];
  box: THREE.Box3;
  isNear: boolean;
  shadowNear: boolean;
  nearTriangles: number;
  farTriangles: number;
  /** Near detail is on the GPU. */
  resident: boolean;
  /** Distance from the camera, and the least of that and from where it is heading. */
  d: number;
  da: number;
}

const _p = new THREE.Vector3();
const _c = new THREE.Vector3();
const _e = new THREE.Vector3();
const _l = new THREE.Vector3();
const _ahead = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
/** A near build's steps: a recipe fill (a house), a material's merge, a material packed into its pool. */
type Step = 'fill' | 'merge' | 'pack';
/** Seconds of camera travel the streaming builds ahead for. */
const LOOKAHEAD = 1.5;

/**
 * The city's houses as LOD chunks. Add far builds with `chunkAt(x, z).far` and near detail with `recipe(x, z, fill)`,
 * then either `build()` (every chunk's near detail now, for a small scene) or `buildFar()` and `stream(budget)` each
 * frame: near detail is built for the chunks the camera approaches and freed behind it. Put it in the scene; it
 * updates itself for the camera that renders it (or only for `follow` when set).
 */
export class TidecrownLod<N extends NearSink = NearSink> extends THREE.LOD {
  readonly opts: Required<LodOptions>;
  readonly chunks: Chunk<N>[] = [];
  private grid = new Map<string, Chunk<N>>();
  readonly meshes: LodMesh[] = [];
  private pools = new Map<string, LodMesh>();
  /** Only this camera moves the LOD (others render whatever state it left). */
  follow: THREE.Camera | null = null;
  /** Force every chunk near (those with detail in) or far (QA). */
  force: 'near' | 'far' | null = null;
  /** Cost of the last render (camera and shadow pass). */
  readonly frame: LodFrame = { calls: 0, triangles: 0, shadowCalls: 0, shadowTriangles: 0 };
  built = false;
  /** Near detail follows the camera (buildFar); false when build() put it all in. */
  streaming = false;
  /** Triangles per kit piece over every near build so far. */
  readonly pieceTris = new Map<string, number>();
  /** The camera's frustum of the last update, and which chunks' shadows can fall inside it. */
  private view = new THREE.Frustum();
  private casting = new Uint8Array(0);
  private castingFor = -1;
  private frameNo = 0;
  private eye = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private eyeT = -1;
  private job: { ci: number; steps: Generator<Step | void, void>; pools: LodMesh[]; next: Step } | null = null;
  /** About what each kind of build step costs (ms), to keep stream() slices within their budget. */
  private stepMs: Record<Step, number> = { fill: 1, merge: 1, pack: 1 };

  constructor(
    private renderer: THREE.WebGLRenderer,
    private makeNear: (name: string) => N,
    opts: LodOptions = {},
    name = 'tidecrown-lod',
  ) {
    super();
    this.name = name;
    const set = Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined && !Number.isNaN(v)));
    this.opts = { chunk: 16, near: 100, hysteresis: 12, shadow: 50, farShadows: true, prebuild: 10, evict: 4, cap: 130, ...set };
  }

  /** The chunk holding world point (x, z). */
  chunkAt(x: number, z: number): Chunk<N> {
    const i = Math.floor(x / this.opts.chunk);
    const j = Math.floor(z / this.opts.chunk);
    const key = `${i},${j}`;
    let c = this.grid.get(key);
    if (!c) {
      if (this.built) throw new Error('TidecrownLod: chunk added after the build');
      c = { i, j, far: new FarBatch(), recipe: [], box: new THREE.Box3(), isNear: false, shadowNear: false, nearTriangles: 0, farTriangles: 0, resident: false, d: Infinity, da: Infinity };
      this.grid.set(key, c);
      this.chunks.push(c);
    }
    return c;
  }

  /** A step of near detail for the chunk holding (x, z). */
  recipe(x: number, z: number, fill: (near: N) => void): void {
    this.chunkAt(x, z).recipe.push(fill);
  }

  /** Every chunk's far and near builds now (a small city: no streaming). */
  build(): this {
    this.buildFar();
    this.streaming = false;
    for (let ci = 0; ci < this.chunks.length; ci++) for (const _ of this.nearSteps(ci, [])) void _;
    this.apply();
    return this;
  }

  /** Only the far builds; near detail comes with stream(). */
  buildFar(): this {
    if (this.built) throw new Error('TidecrownLod built twice');
    this.built = true;
    this.streaming = true;
    const farCasts = (m: THREE.Material) => this.opts.farShadows && !/glass|vine/.test(m.name);
    const lists = new Map<string, { material: THREE.Material; castShadow: boolean; items: { ci: number; p: Packed }[]; layout: AttrLayout[] }>();
    this.chunks.forEach((c, ci) => {
      for (const e of c.far.merge(farCasts)) {
        const key = `${e.material.uuid}|${e.castShadow}`;
        let l = lists.get(key);
        if (!l) lists.set(key, (l = { material: e.material, castShadow: e.castShadow, items: [], layout: layoutFor(e.material, e.geometry) }));
        const p = pack(e.geometry, l.layout);
        e.geometry.dispose();
        c.box.union(p.box);
        c.farTriangles += p.triangles;
        l.items.push({ ci, p });
      }
    });
    for (const l of lists.values()) {
      const verts = l.items.reduce((s, it) => s + it.p.count, 0);
      const idx = l.items.reduce((s, it) => s + it.p.index.length, 0);
      const mesh = this.pool(l.material, l.castShadow, true, l.layout, verts, idx);
      for (const it of l.items) mesh.insert(it.ci, it.p);
    }
    for (const c of this.chunks) if (c.box.isEmpty()) c.box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3());
    this.casting = new Uint8Array(this.chunks.length).fill(1);
    this.apply();
    return this;
  }

  private pool(material: THREE.Material, castShadow: boolean, far: boolean, layout: AttrLayout[], verts: number, idx: number): LodMesh {
    const key = `${material.uuid}|${castShadow}|${far}`;
    let mesh = this.pools.get(key);
    if (mesh) return mesh;
    mesh = new LodMesh(this.renderer, layout, this.chunks.length, verts, idx, material, far);
    mesh.name = `${this.name}:${far ? 'far' : 'near'}:${material.name}${castShadow ? '' : ':noshadow'}`;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.frame = this.frame;
    mesh.casts = (cam) => this.castsInto(cam);
    this.pools.set(key, mesh);
    this.meshes.push(mesh);
    this.add(mesh);
    return mesh;
  }

  /** Build one chunk's near detail: its recipe a step at a time, the merge a material at a time, then into the pools. */
  private *nearSteps(ci: number, pools: LodMesh[]): Generator<Step | void, void> {
    const c = this.chunks[ci];
    const sink = this.makeNear(`${this.name}:${c.i},${c.j}`);
    for (const fill of c.recipe) {
      yield 'fill';
      fill(sink);
    }
    // The merge yields (nothing) before each material.
    const merged = yield* sink.mergeSteps();
    if (sink.pieceTris) for (const [k, t] of sink.pieceTris) this.pieceTris.set(k, (this.pieceTris.get(k) ?? 0) + t);
    let tris = 0;
    for (const e of merged) {
      yield 'pack';
      const m = e.material;
      const key = `${m.uuid}|${e.castShadow}|false`;
      const layout = this.pools.get(key)?.layout ?? layoutFor(m, e.geometry);
      const p = pack(e.geometry, layout);
      e.geometry.dispose();
      // A new pool starts at four times its first chunk and grows by a quarter when full.
      const mesh = this.pool(m, e.castShadow, false, layout, Math.max(p.count * 4, 16384), Math.max(p.index.length * 4, 49152));
      mesh.insert(ci, p);
      pools.push(mesh);
      c.box.union(p.box);
      tris += p.triangles;
    }
    c.nearTriangles = tris;
    c.resident = true;
  }

  /** Drop a chunk's near detail. */
  private free(ci: number): void {
    const c = this.chunks[ci];
    for (const m of this.meshes) if (!m.far) m.drop(ci);
    c.resident = c.isNear = c.shadowNear = false;
  }

  private cancel(): void {
    if (!this.job) return;
    for (const m of this.job.pools) m.drop(this.job.ci);
    this.job = null;
  }

  /**
   * Streaming: free the near detail the camera has left behind, then build what it is approaching, nearest first,
   * for about `budget` ms (a step at a time: a house, a material's merge, a material into its pool). True when every
   * chunk the camera needs is in.
   */
  stream(budget: number): boolean {
    if (!this.built || !this.streaming) return true;
    const { near, hysteresis, prebuild, evict, cap } = this.opts;
    const keep = near + hysteresis + prebuild + evict;
    let resident = 0;
    let changed = false;
    this.chunks.forEach((c, ci) => {
      if (!c.resident) return;
      if (c.da > keep) {
        this.free(ci);
        changed = true;
      } else resident++;
    });
    // Over the cap: the farthest chunks past their switch distance go first.
    if (resident > cap) {
      const spare = this.chunks.map((c, ci) => ({ c, ci })).filter(({ c }) => c.resident && c.da > near + hysteresis).sort((a, b) => b.c.da - a.c.da);
      for (const { ci } of spare.slice(0, resident - cap)) this.free(ci);
      changed = true;
    }
    if (this.job && this.chunks[this.job.ci].da > keep) this.cancel();
    const t0 = performance.now();
    let idle = false;
    for (let t = t0; t - t0 < budget; ) {
      if (!this.job) {
        let best = -1;
        this.chunks.forEach((c, ci) => {
          if (!c.resident && c.recipe.length && c.da < near + prebuild && (best < 0 || c.da < this.chunks[best].da)) best = ci;
        });
        if (best < 0) {
          idle = true;
          break;
        }
        const pools: LodMesh[] = [];
        this.job = { ci: best, steps: this.nearSteps(best, pools), pools, next: 'pack' };
      }
      // A step that would likely overrun the slice waits for the next frame (the first step of a slice always runs).
      const kind = this.job.next;
      if (t > t0 && t - t0 + this.stepMs[kind] > budget) break;
      const r = this.job.steps.next();
      const now = performance.now(), d = now - t;
      // Rises fast, falls slowly: about the dearest recent step of the kind.
      this.stepMs[kind] = d > this.stepMs[kind] ? (d + this.stepMs[kind]) / 2 : this.stepMs[kind] * 0.97 + d * 0.03;
      t = now;
      if (r.done) {
        this.job = null;
        changed = true;
      } else this.job.next = r.value ?? 'merge';
    }
    if (changed) {
      for (let k = this.meshes.length - 1; k >= 0; k--) {
        const m = this.meshes[k];
        if (m.far || !m.empty || this.job?.pools.includes(m)) continue;
        // An emptied pool gives its buffers back.
        this.dropPool(m);
      }
      this.apply();
    }
    return idle && !this.job;
  }

  private dropPool(m: LodMesh): void {
    for (const [k, v] of this.pools) if (v === m) this.pools.delete(k);
    this.meshes.splice(this.meshes.indexOf(m), 1);
    this.remove(m);
    m.dispose();
  }

  /** Free every chunk's near detail and its GPU buffers (leaving the city); stream() builds it again on return. */
  releaseNear(): void {
    this.cancel();
    this.chunks.forEach((c, ci) => c.resident && this.free(ci));
    for (const m of [...this.meshes]) if (!m.far) this.dropPool(m);
    this.eyeT = -1;
    for (const c of this.chunks) c.d = c.da = Infinity;
    this.apply();
  }

  /** Swap chunks for `camera` (three.js calls this while projecting the scene, before the shadow pass). */
  override update(camera: THREE.Camera): void {
    if (!this.built || (this.follow && camera !== this.follow)) return;
    this.frame.calls = this.frame.triangles = this.frame.shadowCalls = this.frame.shadowTriangles = 0;
    this.frameNo++;
    this.view.setFromProjectionMatrix(_m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem);
    camera.getWorldPosition(_p);
    // Where the camera is heading: its smoothed speed, reset by a cut (a jump of more than 25 or a stall).
    const now = performance.now();
    const dt = (now - this.eyeT) / 1000;
    if (this.eyeT < 0 || dt > 0.5 || _p.distanceTo(this.eye) > 25) this.vel.set(0, 0, 0);
    else if (dt > 0) this.vel.lerp(_ahead.subVectors(_p, this.eye).divideScalar(dt), Math.min(1, dt * 4));
    this.eye.copy(_p);
    this.eyeT = now;
    _ahead.copy(_p).addScaledVector(this.vel, LOOKAHEAD);
    const { near, hysteresis, shadow } = this.opts;
    let changed = false;
    for (const c of this.chunks) {
      const d = c.box.distanceToPoint(_p);
      c.d = d;
      c.da = Math.min(d, c.box.distanceToPoint(_ahead));
      const isNear = !c.resident ? false : this.force ? this.force === 'near' : c.isNear ? d < near + hysteresis : d < near;
      const shadowNear = isNear && (this.force ? this.force === 'near' && d < shadow : c.shadowNear ? d < shadow + hysteresis : d < shadow);
      if (isNear !== c.isNear || shadowNear !== c.shadowNear) changed = true;
      c.isNear = isNear;
      c.shadowNear = shadowNear;
    }
    if (changed) this.apply();
    for (const m of this.meshes) m.refreshBounds();
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
      m.refreshBounds();
    }
  }

  /** Free every batched mesh's GPU buffers (and take them out of the scene). */
  dispose(): void {
    this.cancel();
    for (const m of this.meshes) {
      this.remove(m);
      m.dispose();
    }
    this.meshes.length = 0;
    this.pools.clear();
  }

  /** Chunk counts, triangles (near: of every chunk built so far) and the GPU bytes of the near and far pools. */
  get stats(): { chunks: number; near: number; resident: number; meshes: number; nearTriangles: number; farTriangles: number; nearBytes: number; nearUsed: number; farBytes: number } {
    let nearTriangles = 0;
    let farTriangles = 0;
    let near = 0;
    let resident = 0;
    for (const c of this.chunks) {
      nearTriangles += c.nearTriangles;
      farTriangles += c.farTriangles;
      if (c.isNear) near++;
      if (c.resident) resident++;
    }
    let nearBytes = 0;
    let nearUsed = 0;
    let farBytes = 0;
    for (const m of this.meshes) {
      if (m.far) farBytes += m.bytes;
      else {
        nearBytes += m.bytes;
        nearUsed += m.usedBytes;
      }
    }
    return { chunks: this.chunks.length, near, resident, meshes: this.meshes.length, nearTriangles, farTriangles, nearBytes, nearUsed, farBytes };
  }
}
