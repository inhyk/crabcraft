// Grooming: where every hair of a crab's costume roots, which way it lies and how it hangs. Roots are
// sampled on the crab's own skinned part geometry (robot metres, the model's bind space: +x left, +y up,
// +z forward), weighted by a layer's mask; each hair is grown as a polyline under gravity and a comb
// direction, kept outside the shell, and pulled toward its clump's guide hair so the coat parts into
// locks. The result is one float texture per (layer, bone): the control points of every strand in that
// bone's frame, ready for shader.ts.
import * as THREE from 'three';
import type { PartClass } from '../../../crab/template';
import type { HairLook } from './shader';

export type V = THREE.Vector3;

export interface Layer {
  name: string;
  classes: PartClass[];
  /** Links whose triangles may grow hair (bind-space test on the link name). */
  links: RegExp;
  /** 0..1 weight of a surface point. */
  mask(p: V, n: V): number;
  count: number;
  /** Control points per strand and ribbon segments when drawn. */
  points: number;
  seg: number;
  /** Metres. */
  length(p: V, n: V, r: number): number;
  /** Direction the hair leaves the root (normalised by the groomer). */
  dir(p: V, n: V, r: number, out: V): V;
  /** How far the hair droops: added downward per unit of length. */
  gravity: number;
  /** Random wander per step. */
  curl: number;
  /** Random turn of the hair's first direction (locks then lie a little every way). */
  jitter?: number;
  /** Root width, metres. */
  width: number;
  /** Wind response divisor (1 normal, 2 half as much). */
  stiff: number;
  clump: { size: number; pull: number; pow: number };
  /** A lazy S along the hair (amplitude as a share of its length, cycles over the length). */
  wave?: { amp: number; freq: number };
  snow(p: V, n: V, r: number): number;
  look: HairLook;
  bits?: { clumps: number; crystals: number; size: number };
  /** Replaces the grower for special hair (braids). */
  grow?: (rng: () => number) => Grown;
}

export interface Grown {
  /** Model-space points, `points` per strand. */
  pts: Float32Array;
  roots: Float32Array;
  normals: Float32Array;
  data: Float32Array;
  count: number;
}

/** One layer grown: strands in bind space with the bone each rides. */
interface Crop {
  layer: Layer;
  grown: Grown;
  bones: Int32Array;
  /** Light reaching each control point through the coat above it, 0..1 (count * points). */
  occ: Float32Array;
}

/** One drawable set: a layer's strands that ride one bone. */
export interface StrandSet {
  layer: Layer;
  bone: number;
  count: number;
  stride: number;
  tex: THREE.DataTexture;
  /** Snow bits on the strands' tips (strand index, v, size, spin). */
  bits: { strand: Float32Array; at: Float32Array; size: Float32Array; spin: Float32Array } | null;
}

export const TEX_W = 4096;

export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Surface triangles of the chosen parts, in bind space, with their bone and corner normals. */
interface Surface {
  bone: Int32Array;
  pos: Float32Array; // 9 per triangle
  nrm: Float32Array; // 9 per triangle
  count: number;
}

export interface RigParts {
  meshes: Map<PartClass, THREE.SkinnedMesh>;
  linkOfBone: string[];
  boneInverses: THREE.Matrix4[];
}

function surface(parts: RigParts, layer: Layer): Surface {
  const bone: number[] = [];
  const pos: number[] = [];
  const nrm: number[] = [];
  for (const cls of layer.classes) {
    const mesh = parts.meshes.get(cls);
    if (!mesh) continue;
    const g = mesh.geometry;
    const P = g.attributes.position;
    const N = g.attributes.normal;
    const S = g.attributes.skinIndex;
    const idx = g.index;
    const tris = idx ? idx.count / 3 : P.count / 3;
    for (let t = 0; t < tris; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      const b = S.getX(i0);
      if (!layer.links.test(parts.linkOfBone[b])) continue;
      bone.push(b);
      for (const i of [i0, i1, i2]) {
        pos.push(P.getX(i), P.getY(i), P.getZ(i));
        nrm.push(N.getX(i), N.getY(i), N.getZ(i));
      }
    }
  }
  return { bone: Int32Array.from(bone), pos: Float32Array.from(pos), nrm: Float32Array.from(nrm), count: bone.length };
}

/** The shell as an ellipsoid hair is kept outside of (bind space, metres). */
const SHELL_C = new THREE.Vector3(0, 0.024, -0.009);
const SHELL_R = new THREE.Vector3(0.097, 0.052, 0.108);

const ss01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

function inShell(x: number, y: number, z: number, f = 1): boolean {
  const a = (x - SHELL_C.x) / SHELL_R.x;
  const b = (y - SHELL_C.y) / SHELL_R.y;
  const c = (z - SHELL_C.z) / SHELL_R.z;
  return a * a + b * b + c * c < f * f;
}

function keepOut(p: V): void {
  const x = (p.x - SHELL_C.x) / SHELL_R.x;
  const y = (p.y - SHELL_C.y) / SHELL_R.y;
  const z = (p.z - SHELL_C.z) / SHELL_R.z;
  const f = Math.sqrt(x * x + y * y + z * z);
  if (f < 1.02 && f > 1e-6) {
    const k = 1.02 / f;
    p.set(SHELL_C.x + (p.x - SHELL_C.x) * k, SHELL_C.y + (p.y - SHELL_C.y) * k, SHELL_C.z + (p.z - SHELL_C.z) * k);
  }
}

/** Data channels: width, random, snow, random 2 (texels 0..3 w), stiffness (normal texel w). */
function growLayer(parts: RigParts, layer: Layer, rng: () => number, density: number): { grown: Grown; bones: Int32Array } {
  const surf = surface(parts, layer);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const na = new THREE.Vector3();
  const nb = new THREE.Vector3();
  const nc = new THREE.Vector3();
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  // Area times mask at the centroid, accumulated for sampling.
  const cum = new Float64Array(surf.count);
  let total = 0;
  for (let t = 0; t < surf.count; t++) {
    a.fromArray(surf.pos, t * 9);
    b.fromArray(surf.pos, t * 9 + 3);
    c.fromArray(surf.pos, t * 9 + 6);
    const area = b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
    p.copy(a).add(b).add(c).divideScalar(3);
    n.fromArray(surf.nrm, t * 9).add(nb.fromArray(surf.nrm, t * 9 + 3)).add(nc.fromArray(surf.nrm, t * 9 + 6)).normalize();
    total += area * Math.max(0, layer.mask(p, n));
    cum[t] = total;
  }
  const N = Math.max(0, Math.round(layer.count * density));
  const P = layer.points;
  const pts = new Float32Array(N * P * 3);
  const roots = new Float32Array(N * 3);
  const normals = new Float32Array(N * 3);
  const data = new Float32Array(N * 5);
  const bones = new Int32Array(N);
  if (total <= 0 || N === 0) return { grown: { pts, roots, normals, data, count: 0 }, bones };
  const d = new THREE.Vector3();
  const q = new THREE.Vector3();
  let made = 0;
  let guard = 0;
  while (made < N && guard++ < N * 20) {
    const x = rng() * total;
    let lo = 0;
    let hi = surf.count - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    const t = lo;
    let u = rng();
    let v = rng();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    a.fromArray(surf.pos, t * 9);
    b.fromArray(surf.pos, t * 9 + 3);
    c.fromArray(surf.pos, t * 9 + 6);
    na.fromArray(surf.nrm, t * 9);
    nb.fromArray(surf.nrm, t * 9 + 3);
    nc.fromArray(surf.nrm, t * 9 + 6);
    p.copy(a).multiplyScalar(1 - u - v).addScaledVector(b, u).addScaledVector(c, v);
    n.copy(na).multiplyScalar(1 - u - v).addScaledVector(nb, u).addScaledVector(nc, v).normalize();
    // The mask is per point, not only per triangle: reject by it so edges are clean.
    if (rng() > layer.mask(p, n)) continue;
    const r = rng();
    const len = layer.length(p, n, r);
    if (len <= 0) continue;
    const i = made++;
    bones[i] = surf.bone[t];
    p.toArray(roots, i * 3);
    n.toArray(normals, i * 3);
    // Grow: from just above the surface, along the comb, drooping, wandering a little.
    layer.dir(p, n, r, d).normalize();
    if (layer.jitter) d.add(new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(layer.jitter * 2)).normalize();
    const step = len / (P - 1);
    q.copy(p).addScaledVector(n, 0.00025);
    q.toArray(pts, i * P * 3);
    for (let j = 1; j < P; j++) {
      d.y -= layer.gravity / (P - 1);
      d.x += (rng() - 0.5) * layer.curl;
      d.y += (rng() - 0.5) * layer.curl;
      d.z += (rng() - 0.5) * layer.curl;
      d.normalize();
      q.addScaledVector(d, step);
      keepOut(q);
      q.toArray(pts, (i * P + j) * 3);
    }
    if (layer.wave) {
      // An S across the hair, rising from nothing at the root.
      const side = new THREE.Vector3().fromArray(pts, (i * P + 1) * 3).sub(p).cross(n).normalize();
      const ph = rng() * Math.PI * 2;
      const amp = layer.wave.amp * len;
      for (let j = 1; j < P; j++) {
        const v = j / (P - 1);
        const o = amp * Math.sin(Math.PI * 2 * layer.wave.freq * v + ph) * ss01(v / 0.25);
        pts[(i * P + j) * 3] += side.x * o;
        pts[(i * P + j) * 3 + 1] += side.y * o;
        pts[(i * P + j) * 3 + 2] += side.z * o;
      }
    }
    data[i * 5] = layer.width * (0.75 + 0.5 * rng());
    data[i * 5 + 1] = r;
    data[i * 5 + 2] = Math.max(0, Math.min(1, layer.snow(p, n, rng())));
    data[i * 5 + 3] = rng();
    data[i * 5 + 4] = layer.stiff;
  }
  const count = made;
  clump(layer, { pts, roots, normals, data, count }, rng);
  return { grown: { pts, roots, normals, data, count }, bones };
}

/** Pull each hair's tip toward its clump's guide hair (the nearest of a sparse set of guides). */
function clump(layer: Layer, g: Grown, rng: () => number): void {
  const { size, pull, pow } = layer.clump;
  if (pull <= 0 || g.count < 2) return;
  const P = layer.points;
  const guides: number[] = [];
  for (let i = 0; i < g.count; i++) if (rng() < 1 / size) guides.push(i);
  if (!guides.length) return;
  // Grid over the roots, cell about one clump across.
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < g.count; i++) {
    minX = Math.min(minX, g.roots[i * 3]);
    maxX = Math.max(maxX, g.roots[i * 3]);
    minY = Math.min(minY, g.roots[i * 3 + 1]);
    maxY = Math.max(maxY, g.roots[i * 3 + 1]);
    minZ = Math.min(minZ, g.roots[i * 3 + 2]);
    maxZ = Math.max(maxZ, g.roots[i * 3 + 2]);
  }
  const vol = Math.max(1e-9, (maxX - minX) * (maxY - minY) + (maxY - minY) * (maxZ - minZ) + (maxX - minX) * (maxZ - minZ));
  const cell = Math.max(0.0015, Math.sqrt(vol / guides.length) * 1.2);
  const key = (x: number, y: number, z: number) => `${Math.floor((x - minX) / cell)},${Math.floor((y - minY) / cell)},${Math.floor((z - minZ) / cell)}`;
  const grid = new Map<string, number[]>();
  for (const gi of guides) {
    const k = key(g.roots[gi * 3], g.roots[gi * 3 + 1], g.roots[gi * 3 + 2]);
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(gi);
  }
  const guideOf = new Int32Array(g.count).fill(-1);
  for (let i = 0; i < g.count; i++) {
    const x = g.roots[i * 3];
    const y = g.roots[i * 3 + 1];
    const z = g.roots[i * 3 + 2];
    const cx = Math.floor((x - minX) / cell);
    const cy = Math.floor((y - minY) / cell);
    const cz = Math.floor((z - minZ) / cell);
    let best = -1;
    let bd = Infinity;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const list = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!list) continue;
          for (const gi of list) {
            const ex = g.roots[gi * 3] - x;
            const ey = g.roots[gi * 3 + 1] - y;
            const ez = g.roots[gi * 3 + 2] - z;
            const dd = ex * ex + ey * ey + ez * ez;
            if (dd < bd) {
              bd = dd;
              best = gi;
            }
          }
        }
    guideOf[i] = best;
  }
  // Guides first keep their own shape; members bend toward theirs (copy guides' points before).
  const guidePts = new Map<number, Float32Array>();
  for (const gi of guides) guidePts.set(gi, g.pts.slice(gi * P * 3, (gi + 1) * P * 3));
  const own = new THREE.Vector3();
  const gp = new THREE.Vector3();
  for (let i = 0; i < g.count; i++) {
    const gi = guideOf[i];
    if (gi < 0 || gi === i) continue;
    const gpts = guidePts.get(gi)!;
    const k = pull * (0.7 + 0.6 * g.data[i * 5 + 3]);
    // A lock shares its colour and its tips' bleaching, with a little spread.
    g.data[i * 5 + 1] = g.data[gi * 5 + 1] * 0.7 + g.data[i * 5 + 1] * 0.3;
    g.data[i * 5 + 3] = g.data[gi * 5 + 3] * 0.6 + g.data[i * 5 + 3] * 0.4;
    for (let j = 1; j < P; j++) {
      const v = j / (P - 1);
      const f = Math.min(0.95, k * Math.pow(v, pow));
      own.fromArray(g.pts, (i * P + j) * 3);
      gp.fromArray(gpts, j * 3);
      own.lerp(gp, f);
      keepOut(own);
      own.toArray(g.pts, (i * P + j) * 3);
    }
  }
}

/** Splits grown strands by bone and packs each bone's into a texture in that bone's frame. */
function pack(parts: RigParts, crop: Crop, rng: () => number): StrandSet[] {
  const { layer, grown, bones, occ } = crop;
  const P = layer.points;
  // Points, the root normal, then the occlusion of each point four to a texel.
  const stride = P + 1 + Math.ceil(P / 4);
  const byBone = new Map<number, number[]>();
  for (let i = 0; i < grown.count; i++) (byBone.get(bones[i]) ?? byBone.set(bones[i], []).get(bones[i])!).push(i);
  const out: StrandSet[] = [];
  const v = new THREE.Vector3();
  for (const [bone, list] of byBone) {
    // Shuffle, so any prefix (or the shader's random subset) is an even thinning.
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    const inv = parts.boneInverses[bone];
    const texels = list.length * stride;
    const h = Math.max(1, Math.ceil(texels / TEX_W));
    const arr = new Float32Array(TEX_W * h * 4);
    list.forEach((src, k) => {
      const o = k * stride * 4;
      for (let j = 0; j < P; j++) {
        v.fromArray(grown.pts, (src * P + j) * 3).applyMatrix4(inv);
        arr[o + j * 4] = v.x;
        arr[o + j * 4 + 1] = v.y;
        arr[o + j * 4 + 2] = v.z;
      }
      arr[o + 3] = grown.data[src * 5];
      arr[o + 7] = grown.data[src * 5 + 1];
      arr[o + 11] = grown.data[src * 5 + 2];
      arr[o + 15] = grown.data[src * 5 + 3];
      v.fromArray(grown.normals, src * 3).transformDirection(inv);
      arr[o + P * 4] = v.x;
      arr[o + P * 4 + 1] = v.y;
      arr[o + P * 4 + 2] = v.z;
      arr[o + P * 4 + 3] = grown.data[src * 5 + 4];
      for (let j = 0; j < P; j++) arr[o + (P + 1) * 4 + j] = occ[src * P + j];
    });
    const tex = new THREE.DataTexture(arr, TEX_W, h, THREE.RGBAFormat, THREE.FloatType);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    let bits: StrandSet['bits'] = null;
    if (layer.bits) {
      const s: number[] = [];
      const at: number[] = [];
      const size: number[] = [];
      const spin: number[] = [];
      const { clumps, crystals } = layer.bits;
      list.forEach((src, k) => {
        const snow = grown.data[src * 5 + 2];
        if (snow < 0.25) return;
        const tries = (clumps + crystals) * snow;
        for (let m = 0; m < 4; m++) {
          if (rng() > tries / 4) continue;
          const crystal = rng() < crystals / (clumps + crystals);
          s.push(k);
          at.push(0.62 + 0.38 * Math.sqrt(rng()));
          // Mostly fine rime and granules, now and then a whole flake.
          const sz = layer.bits!.size * (crystal ? 0.35 + 1.1 * Math.pow(rng(), 3) : 0.25 + 0.4 * rng());
          size.push(crystal ? -sz : sz);
          // A crystal's facet normal, biased to face up and out; w turns the star.
          const nx = rng() * 2 - 1;
          const ny = rng() * 0.8 + 0.2;
          const nz = rng() * 2 - 1;
          const l = Math.hypot(nx, ny, nz);
          spin.push((nx / l) * 0.5 + 0.5, (ny / l) * 0.5 + 0.5, (nz / l) * 0.5 + 0.5, rng());
        }
      });
      if (s.length) bits = { strand: Float32Array.from(s), at: Float32Array.from(at), size: Float32Array.from(size), spin: Float32Array.from(spin) };
    }
    out.push({ layer, bone, count: list.length, stride, tex, bits });
  }
  return out;
}

/**
 * How much sky reaches each control point through the hair above it and out along its root's normal:
 * every hair segment deposits its projected area into a voxel grid (an optical depth), the shell is
 * solid, and each point sums the depth it looks through. Hair deep in the coat, under the beard's
 * roots and in the gaps between locks comes out dark; tips at the surface stay lit.
 */
function occlusion(crops: Crop[]): void {
  const h = 0.0015;
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  for (const c of crops) {
    const pts = c.grown.pts;
    const n = c.grown.count * c.layer.points * 3;
    for (let i = 0; i < n; i += 3)
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], pts[i + k]);
        hi[k] = Math.max(hi[k], pts[i + k]);
      }
  }
  if (!Number.isFinite(lo[0])) return;
  lo = lo.map((x) => x - 0.04);
  hi = hi.map((x) => x + 0.04);
  const nx = Math.ceil((hi[0] - lo[0]) / h);
  const ny = Math.ceil((hi[1] - lo[1]) / h);
  const nz = Math.ceil((hi[2] - lo[2]) / h);
  const tau = new Float32Array(nx * ny * nz);
  const cell = (x: number, y: number, z: number) => {
    const i = Math.floor((x - lo[0]) / h);
    const j = Math.floor((y - lo[1]) / h);
    const k = Math.floor((z - lo[2]) / h);
    return i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? -1 : (k * ny + j) * nx + i;
  };
  const SUB = 4;
  for (const c of crops) {
    const P = c.layer.points;
    const { pts, data, count } = c.grown;
    for (let s = 0; s < count; s++) {
      const w = data[s * 5];
      for (let j = 0; j < P - 1; j++) {
        const a = (s * P + j) * 3;
        const b = a + 3;
        const len = Math.hypot(pts[b] - pts[a], pts[b + 1] - pts[a + 1], pts[b + 2] - pts[a + 2]);
        const dep = (w * (1 - 0.6 * (j / (P - 1))) * len) / SUB / (h * h);
        for (let m = 0; m < SUB; m++) {
          const f = (m + 0.5) / SUB;
          const ci = cell(pts[a] + (pts[b] - pts[a]) * f, pts[a + 1] + (pts[b + 1] - pts[a + 1]) * f, pts[a + 2] + (pts[b + 2] - pts[a + 2]) * f);
          if (ci >= 0) tau[ci] += dep;
        }
      }
    }
  }
  // The shell itself: solid.
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++)
        if (inShell(lo[0] + (i + 0.5) * h, lo[1] + (j + 0.5) * h, lo[2] + (k + 0.5) * h, 0.97)) tau[(k * ny + j) * nx + i] += 6;
  const march = (x: number, y: number, z: number, dx: number, dy: number, dz: number) => {
    let sum = 0;
    for (let m = 1; m <= 16; m++) {
      const ci = cell(x + dx * m * h * 2, y + dy * m * h * 2, z + dz * m * h * 2);
      if (ci < 0) break;
      sum += tau[ci];
    }
    return sum;
  };
  for (const c of crops) {
    const P = c.layer.points;
    const { pts, normals, count } = c.grown;
    for (let s = 0; s < count; s++) {
      const nx0 = normals[s * 3];
      const ny0 = normals[s * 3 + 1];
      const nz0 = normals[s * 3 + 2];
      for (let j = 0; j < P; j++) {
        const a = (s * P + j) * 3;
        const up = march(pts[a], pts[a + 1], pts[a + 2], 0, 1, 0);
        const out = march(pts[a], pts[a + 1], pts[a + 2], nx0, ny0, nz0);
        c.occ[s * P + j] = Math.exp(-(0.55 * up + 0.45 * out) * 0.5);
      }
    }
  }
}

/** Every set of an outfit: strands grown on the rig, shaded by their own coat, split per bone. */
export function groom(parts: RigParts, layers: Layer[], seed: number, density: number): StrandSet[] {
  const crops: Crop[] = layers.map((layer, li) => {
    const rng = mulberry(seed * 977 + li * 131 + 7);
    if (layer.grow) {
      const grown = layer.grow(rng);
      return { layer, grown, bones: new Int32Array(grown.count), occ: new Float32Array(grown.count * layer.points).fill(1) };
    }
    const { grown, bones } = growLayer(parts, layer, rng, density);
    return { layer, grown, bones, occ: new Float32Array(grown.count * layer.points).fill(1) };
  });
  occlusion(crops);
  const out: StrandSet[] = [];
  crops.forEach((crop, li) => out.push(...pack(parts, crop, mulberry(seed * 31 + li * 17 + 3))));
  return out;
}
