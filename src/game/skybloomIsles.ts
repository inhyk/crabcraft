import * as THREE from 'three';
import {mergeVertices} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {realmHeight} from '../sim/world/ground';
import {CLOUD_Y} from './skybloomClouds';

/*
 * Skybloom's land below the grass: the cliff skirt that carries the island down into the cloud sea, the floating
 * isles around it, the roots and vines hanging off both and the waterfalls spilling into the mist. Everything solid
 * is one merged mesh with one material (vertex colour plus a material id per vertex): bedded limestone with ledges
 * and moss for the rock, cut cream stone for ruins, painted grass, bark and canopy; the shader adds the strata,
 * grain and bump, and dissolves anything that reaches down into the cloud tops. The water is a second mesh.
 */

/** The island's lip: the ellipse edge value where the grass ends and the cliff begins (realmHeight falls past .83). */
export const SKY_LIP = 0.83;
const RX = 128, RZ = 155, CZ = 2;

type V3 = [number, number, number];
const lin = (hex: number): V3 => {
  const f = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return [f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255)];
};
const mix3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sat = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const hash = (i: number, j: number, s = 0) => { const h = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453; return h - Math.floor(h); };
/** 2D value noise, 0..1. */
function vn(x: number, y: number, s = 0): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
/** Periodic 1D noise round a circle of `n` cells, 0..1. */
const ring = (t: number, n: number, s: number) => vn(Math.cos(t) * n / 6.283 + 50, Math.sin(t) * n / 6.283 + 50, s);

// Material ids carried per vertex (aMat): painted (grass, soil, bark, leaves), bedded rock, cut stone.
const PAINT = 0, ROCK = 1, CUT = 2;
const GRASS = [lin(0x5f9a5e), lin(0x4f8f63), lin(0x7aa86a), lin(0x3d6f66)], DRY = lin(0xa7c27a);
const SOIL = lin(0x5b4936), SOIL_DARK = lin(0x3f3329), MOSS = lin(0x557f4c);
const BARK = lin(0xa9a39a), BARK_DARK = lin(0x7d776e), ROOT = lin(0x6e5d4b), VINE = lin(0x467f58);
const CANOPY = [lin(0x3f8f80), lin(0x5fae95), lin(0x4a9a86)], BLOSSOM = [lin(0xf2b8c6), lin(0xf7f3ea), lin(0xb8a6e8)];
const STONE = lin(0xe6dcc4), STONE_WARM = lin(0xd8c8a6), TRIM = lin(0x3fb7b0), GOLD = lin(0xd4a64a);
const FLOWERS = [lin(0xf2b8c6), lin(0xf7f3ea), lin(0xb8a6e8), lin(0xf3dc8a)];

/** Growing arrays for one merged mesh. */
class Builder {
  pos: number[] = []; col: number[] = []; mat: number[] = []; idx: number[] = [];
  v(x: number, y: number, z: number, c: V3, m: number): number {
    this.pos.push(x, y, z); this.col.push(c[0], c[1], c[2]); this.mat.push(m);
    return this.pos.length / 3 - 1;
  }
  quad(a: number, b: number, c: number, d: number) { this.idx.push(a, c, b, b, c, d); }
  /** A tapered tube through `pts` (radius per point), `sides` round, capped at the thin end by convergence. */
  tube(pts: V3[], radii: number[], sides: number, color: (k: number, s: number) => V3) {
    const base = this.pos.length / 3, n = pts.length;
    for (let k = 0; k < n; k++) {
      const p = pts[k], q = pts[Math.min(n - 1, k + 1)], o = pts[Math.max(0, k - 1)];
      const t = new THREE.Vector3(q[0] - o[0], q[1] - o[1], q[2] - o[2]).normalize();
      const a = Math.abs(t.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      const u = new THREE.Vector3().crossVectors(t, a).normalize(), w = new THREE.Vector3().crossVectors(t, u);
      for (let s = 0; s < sides; s++) {
        const ang = (s / sides) * Math.PI * 2, r = radii[k];
        this.v(p[0] + (u.x * Math.cos(ang) + w.x * Math.sin(ang)) * r, p[1] + (u.y * Math.cos(ang) + w.y * Math.sin(ang)) * r, p[2] + (u.z * Math.cos(ang) + w.z * Math.sin(ang)) * r, color(k, s), PAINT);
      }
    }
    for (let k = 0; k < n - 1; k++) for (let s = 0; s < sides; s++) {
      const a = base + k * sides + s, b = base + k * sides + (s + 1) % sides;
      this.quad(a, b, a + sides, b + sides);
    }
  }
  /** Indexed template geometry placed by a matrix, coloured per vertex. */
  place(t: {pos: Float32Array; idx: ArrayLike<number>}, m: THREE.Matrix4, color: (x: number, y: number, z: number, ny: number) => V3, mat: number) {
    const base = this.pos.length / 3, p = new THREE.Vector3();
    for (let i = 0; i < t.pos.length; i += 3) {
      p.set(t.pos[i], t.pos[i + 1], t.pos[i + 2]);
      const ny = p.y / (p.length() || 1);
      p.applyMatrix4(m);
      this.v(p.x, p.y, p.z, color(p.x, p.y, p.z, ny), mat);
    }
    for (let i = 0; i < t.idx.length; i++) this.idx.push(base + t.idx[i]);
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.mat, 1));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** A lumpy sphere template (welded icosphere) for canopy masses and boulders. */
function blobTemplate(detail: number) {
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, detail).deleteAttribute('normal').deleteAttribute('uv'));
  return {pos: g.getAttribute('position').array as Float32Array, idx: g.getIndex()!.array};
}
/** A box template with a few segments, so cut stone takes the bevelled lighting of smooth normals at its edges. */
function blockTemplate() {
  const g = mergeVertices(new THREE.BoxGeometry(1, 1, 1, 2, 2, 2).deleteAttribute('normal').deleteAttribute('uv'));
  const p = g.getAttribute('position').array as Float32Array;
  // Pull corners in a touch: worn arrises instead of razor edges.
  for (let i = 0; i < p.length; i += 3) { const k = 1 - 0.08 * (Math.abs(p[i]) + Math.abs(p[i + 1]) + Math.abs(p[i + 2]) - 0.5); p[i] *= k; p[i + 1] *= k; p[i + 2] *= k; }
  return {pos: p, idx: g.getIndex()!.array};
}

/** The lip ellipse at bearing t (0 faces +Z, PI/2 faces +X): point, outward normal and the grass height there. */
export function skyLip(t: number) {
  const x = RX * SKY_LIP * Math.sin(t), z = CZ + RZ * SKY_LIP * Math.cos(t);
  const nx = Math.sin(t) / RX, nz = Math.cos(t) / RZ, nl = Math.hypot(nx, nz);
  const y = realmHeight(6, RX * (SKY_LIP - 0.0004) * Math.sin(t), CZ + RZ * (SKY_LIP - 0.0004) * Math.cos(t));
  return {x, z, y, nx: nx / nl, nz: nz / nl};
}

/**
 * Pull every terrain vertex past the lip back onto it at the lip's own height, so the grass ends in a clean curve
 * on top of the cliff instead of a stair-stepped slope into the void. Heights inside the lip are untouched.
 */
export function clipTerrainToLip(g: THREE.BufferGeometry): number {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  let moved = 0;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), e = Math.hypot(x / RX, (z - CZ) / RZ);
    if (e <= SKY_LIP) continue;
    const t = Math.atan2(x / RX, (z - CZ) / RZ), l = skyLip(t);
    p.setXYZ(i, l.x, l.y, l.z); moved++;
  }
  if (moved) { p.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere(); }
  return moved;
}

/** Bearings (rad) of the springs that pour off the main island, away from the harbour and the portal. */
const FALLS_MAIN = [1.62, 4.66, 3.62, 2.72];

/** Radial offset of the rock face from the lip line, metres, at bearing-arc s and height y, `d` below the lip. */
function faceOffset(s: number, y: number, d: number): number {
  const layer = 7 + 4 * vn(s / 70, 3.1, 4);
  const f = (((y + 5 * vn(s / 45, y / 60, 5)) / layer) % 1 + 1) % 1;
  const ledge = 1.6 * Math.pow(1 - f, 1.4);
  // Big rounded bulges and recesses along the cliff, vertical ribs within them.
  const bulge = 5 * (vn(s / 26, y / 55, 6) - 0.5) * 2, rib = 1.6 * (vn(s / 5, y / 22, 7) - 0.5) * 2;
  return -0.6 + (ledge + bulge + rib) * smooth(2.5, 12, d) - 0.06 * d - 0.0055 * d * d;
}

/** The skirt: lip roll, soil band with roots, then bedded rock down past the deepest cloud valley. */
function buildSkirt(b: Builder, falls: {p: V3; dir: V3; w: number; len: number}[]) {
  const M = 640, LIP_ROWS: [number, number, V3, number][] = [
    // depth below lip, outward offset, colour, material
    [0, 0, GRASS[0], PAINT], [0.3, 0.35, mix3(GRASS[3], SOIL, 0.3), PAINT], [0.9, 0.5, mix3(MOSS, SOIL, 0.55), PAINT],
    [1.8, 0.25, SOIL, PAINT], [2.9, -0.45, SOIL_DARK, PAINT],
  ];
  const ROCK_ROWS = 58, BOTTOM = CLOUD_Y - 42, rows = LIP_ROWS.length + ROCK_ROWS, base = b.pos.length / 3;
  const perim = 2 * Math.PI * Math.sqrt((RX * RX + RZ * RZ) / 2) * SKY_LIP;
  for (let i = 0; i < M; i++) {
    const t = (i / M) * Math.PI * 2, l = skyLip(t), s = (t / (Math.PI * 2)) * perim;
    // Caves where a spring leaves the rock.
    let cave = 0;
    for (const ft of FALLS_MAIN) { const da = Math.atan2(Math.sin(t - ft), Math.cos(t - ft)) * perim / (Math.PI * 2); cave = Math.max(cave, Math.exp(-da * da / 6)); }
    for (const [d, off, c, m] of LIP_ROWS) {
      const tint = 0.9 + 0.2 * vn(s / 5, d, 8);
      b.v(l.x + l.nx * off, l.y - d, l.z + l.nz * off, [c[0] * tint, c[1] * tint, c[2] * tint], m);
    }
    const top = l.y - 3.6;
    for (let j = 0; j < ROCK_ROWS; j++) {
      const u = j / (ROCK_ROWS - 1), y = top + (BOTTOM - top) * Math.pow(u, 1.25), d = l.y - y;
      let off = faceOffset(s, y, d);
      off -= cave * 2.6 * Math.exp(-((d - 4.5) ** 2) / 5);
      // Damp, darker rock in the cave and on the deep undercuts; the shader adds strata and moss.
      const ao = 0.78 + 0.22 * smooth(-3, 1.5, off + 0.6) - cave * 0.3 * Math.exp(-((d - 4.5) ** 2) / 6);
      b.v(l.x + l.nx * off, y, l.z + l.nz * off, [ao, ao, ao], ROCK);
    }
    // Remember the springs' mouths for the water.
    for (const ft of FALLS_MAIN) if (Math.abs(Math.atan2(Math.sin(t - ft), Math.cos(t - ft))) < Math.PI / M) {
      const y = l.y - 4.2;
      falls.push({p: [l.x + l.nx * (faceOffset(s, y, 4.2) - 1.2), y, l.z + l.nz * (faceOffset(s, y, 4.2) - 1.2)], dir: [l.nx, 0, l.nz], w: 3.2 + hash(i, 3) * 2, len: y - (CLOUD_Y + 6)});
    }
  }
  for (let i = 0; i < M; i++) for (let j = 0; j < rows - 1; j++) {
    const a = base + i * rows + j, c = base + ((i + 1) % M) * rows + j;
    b.quad(a, c, a + 1, c + 1);
  }
  // Roots and vines hang from the soil band; they follow the face out over the ledges and never cut into it.
  for (let k = 0; k < 260; k++) {
    // Roots come in clumps where a tree above reaches the edge, with bare rock between.
    const clump = Math.floor(k / 6.5), t = hash(clump, 1) * Math.PI * 2 + (hash(k, 41) - 0.5) * 0.09, l = skyLip(t), s = (t / (Math.PI * 2)) * perim;
    if (FALLS_MAIN.some(ft => Math.abs(Math.atan2(Math.sin(t - ft), Math.cos(t - ft))) * perim / (Math.PI * 2) < 4)) continue;
    const vine = hash(k, 2) < 0.4, len = (vine ? 6 : 3) + hash(k, 3) * (vine ? 18 : 12), d0 = 0.8 + hash(k, 4) * 1.8;
    const n = 9, pts: V3[] = [], radii: number[] = [], r0 = vine ? 0.07 + hash(k, 5) * 0.05 : 0.14 + hash(k, 5) * 0.16;
    let o = 0.35 + (vine ? 0.1 : 0.25);
    for (let q = 0; q < n; q++) {
      const d = d0 + (len * q) / (n - 1), y = l.y - d;
      o = Math.max(o, (d > 2.9 ? faceOffset(s, y, d) : 0.3) + 0.3 + r0);
      const sway = Math.sin(q * 0.9 + k) * 0.25 * (q / n);
      pts.push([l.x + l.nx * o - l.nz * sway, y, l.z + l.nz * o + l.nx * sway]);
      radii.push(r0 * (1 - 0.85 * (q / (n - 1))));
    }
    const c = vine ? mix3(VINE, MOSS, hash(k, 6)) : mix3(ROOT, BARK_DARK, hash(k, 6));
    b.tube(pts, radii, vine ? 4 : 5, q => mix3(c, SOIL_DARK, 0.25 * (1 - q / n)));
  }
}

interface Isle {x: number; z: number; y: number; r: number; seed: number; trees: number; ruin?: boolean; garden?: boolean; blossom?: boolean; falls?: number[]}
/** Floating isles at varied distance: near ones read in detail, far ones go blue in the haze. */
export const SKY_ISLES: readonly Isle[] = [
  {x: 205, z: -150, y: 26, r: 26, seed: 1, trees: 3, ruin: true, falls: [3.6]},
  {x: -235, z: -105, y: 42, r: 32, seed: 2, trees: 4, garden: true, blossom: true, falls: [1.4]},
  {x: 300, z: 55, y: 14, r: 21, seed: 3, trees: 2, garden: true},
  {x: -300, z: 20, y: 22, r: 24, seed: 4, trees: 2, ruin: true, falls: [1.9]},
  {x: 70, z: -430, y: 72, r: 44, seed: 5, trees: 6, ruin: true, blossom: true, falls: [0.2, 5.9]},
  {x: 250, z: 300, y: 8, r: 28, seed: 6, trees: 3, blossom: true},
  {x: -215, z: 255, y: 34, r: 18, seed: 7, trees: 2, garden: true, falls: [0.9]},
  {x: -470, z: -310, y: 88, r: 40, seed: 8, trees: 5, ruin: true},
  {x: 168, z: 40, y: 20, r: 8, seed: 9, trees: 1},
  {x: 520, z: -240, y: 48, r: 36, seed: 10, trees: 4, blossom: true},
];

function buildIsle(b: Builder, isle: Isle, blob: ReturnType<typeof blobTemplate>, block: ReturnType<typeof blockTemplate>, falls: {p: V3; dir: V3; w: number; len: number}[]) {
  const {x: cx, z: cz, y: ty, r: R, seed} = isle, M = Math.max(48, Math.round(R * 4.5)), K = 7;
  const outline = (t: number) => 1 + 0.2 * (ring(t, 5, seed) - 0.5) * 2 + 0.07 * (ring(t, 17, seed + 1) - 0.5) * 2;
  const depth = (t: number) => R * (0.8 + 0.45 * ring(t, 3, seed + 2) + 0.2 * ring(t, 9, seed + 3));
  const topY = (x: number, z: number, e: number) => ty + R * 0.05 * (vn(x / 9, z / 9, seed) - 0.5) * 2 + R * 0.04 * (1 - e * e) - 0.5 * smooth(0.82, 1, e);
  const base = b.pos.length / 3;
  // Top cap, centre ring first: drifts of grass shades with a flower bed on garden isles.
  const cap = (x: number, z: number, e: number): V3 => {
    let c = mix3(GRASS[Math.floor(vn(x / 6, z / 6, seed + 4) * 3.99)], DRY, smooth(0.55, 0.85, vn(x / 4, z / 4, seed + 5)) * 0.5);
    if (isle.garden && vn(x / 3, z / 3, seed + 6) > 0.62) c = mix3(c, FLOWERS[Math.floor(hash(Math.round(x / 3), Math.round(z / 3), seed) * 3.99)], 0.75);
    return mix3(c, SOIL, smooth(0.9, 1, e) * 0.6);
  };
  b.v(cx, topY(cx, cz, 0), cz, cap(cx, cz, 0), PAINT);
  for (let k = 1; k <= K; k++) for (let i = 0; i < M; i++) {
    const t = (i / M) * Math.PI * 2, e = k / K, r = R * outline(t) * e, x = cx + Math.sin(t) * r, z = cz + Math.cos(t) * r;
    b.v(x, topY(x, z, e), z, cap(x, z, e), PAINT);
  }
  for (let i = 0; i < M; i++) b.idx.push(base, base + 1 + i, base + 1 + (i + 1) % M);
  for (let k = 1; k < K; k++) for (let i = 0; i < M; i++) {
    const a = base + 1 + (k - 1) * M + i, c = base + 1 + (k - 1) * M + (i + 1) % M;
    b.quad(a, c, a + M, c + M);
  }
  // Underside: soil lip, then bedded rock narrowing to hanging lobes of different depth.
  const U = 22, ub = b.pos.length / 3, rimBase = base + 1 + (K - 1) * M;
  for (let i = 0; i < M; i++) {
    const t = (i / M) * Math.PI * 2, ro = R * outline(t), D = depth(t), s = t * R;
    for (let j = 1; j <= U; j++) {
      const u = j / U, dd = j === 1 ? 0.9 : j === 2 ? 2.2 : 2.2 + (D - 2.2) * Math.pow((j - 2) / (U - 2), 1.1);
      const y = ty - 0.5 - dd;
      let r = ro * Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, dd / D), 1.7)), 0.62) + (j <= 2 ? 0.3 - j * 0.35 : 0);
      if (j > 2) { const f = (((y + 2.5 * vn(s / 20, y / 30, seed + 7)) / 4.5) % 1 + 1) % 1; r += (0.9 * Math.pow(1 - f, 1.3) + 1.6 * (vn(s / 6, y / 14, seed + 8) - 0.5)) * Math.min(1, r / 3); }
      r = Math.max(0, r);
      if (j === U) r = 0;
      const c: V3 = j === 1 ? SOIL : j === 2 ? SOIL_DARK : [0.86, 0.86, 0.86];
      b.v(cx + Math.sin(t) * r, y, cz + Math.cos(t) * r, c, j <= 2 ? PAINT : ROCK);
      void u;
    }
  }
  for (let i = 0; i < M; i++) {
    const n = (i + 1) % M;
    b.quad(rimBase + i, rimBase + n, ub + i * U, ub + n * U);
    for (let j = 0; j < U - 1; j++) b.quad(ub + i * U + j, ub + n * U + j, ub + i * U + j + 1, ub + n * U + j + 1);
  }
  // Roots under the rim.
  for (let k = 0; k < Math.round(R * 1.6); k++) {
    const t = hash(k, seed, 9) * Math.PI * 2, ro = R * outline(t) * 0.97, len = 2 + hash(k, seed, 10) * R * 0.45, n = 7;
    const pts: V3[] = [], radii: number[] = [], r0 = 0.08 + hash(k, seed, 11) * 0.14;
    for (let q = 0; q < n; q++) {
      const d = 0.6 + (len * q) / (n - 1), rr = Math.max(ro * Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, d / depth(t)), 1.7)), 0.62) + 0.25, 0) + 0.2;
      pts.push([cx + Math.sin(t) * rr, ty - 0.5 - d, cz + Math.cos(t) * rr]);
      radii.push(r0 * (1 - 0.8 * q / (n - 1)));
    }
    const c = hash(k, seed, 12) < 0.4 ? VINE : ROOT;
    b.tube(pts, radii, 4, () => c);
  }
  // Trees: pale silver trunks, teal-to-jade canopy masses, blossom on some isles.
  for (let k = 0; k < isle.trees; k++) {
    const a = hash(k, seed, 13) * Math.PI * 2, rr = R * (k === 0 ? 0.15 : 0.35 + 0.35 * hash(k, seed, 14)), x = cx + Math.sin(a) * rr, z = cz + Math.cos(a) * rr;
    const y = topY(x, z, rr / R), h = (7 + hash(k, seed, 15) * 6) * Math.min(1.25, 0.55 + R / 40), lean = (hash(k, seed, 16) - 0.5) * 0.25;
    const pts: V3[] = [], radii: number[] = [];
    for (let q = 0; q <= 6; q++) { const u = q / 6; pts.push([x + Math.sin(a) * lean * h * u * u, y - 0.4 + h * u, z + Math.cos(a) * lean * h * u * u]); radii.push(h * 0.06 * (1.6 - u) * (q === 0 ? 1.4 : 1)); }
    b.tube(pts, radii, 7, (q, s) => mix3(BARK, BARK_DARK, 0.3 * (1 - q / 6) + 0.25 * hash(q, s, seed)));
    const top = pts[6], cr = h * 0.42, blooms = isle.blossom && k % 2 === 0;
    for (let m = 0; m < 5; m++) {
      const ma = m * 2.4 + a, mr = m === 0 ? 0 : cr * 0.62, sc = cr * (m === 0 ? 1 : 0.62 + 0.2 * hash(m, k, seed));
      const mx = top[0] + Math.sin(ma) * mr, my = top[1] + (m === 0 ? cr * 0.15 : -cr * 0.15 + hash(m, k, seed + 1) * cr * 0.3), mz = top[2] + Math.cos(ma) * mr;
      const mtx = new THREE.Matrix4().compose(new THREE.Vector3(mx, my, mz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ma, 0)), new THREE.Vector3(sc, sc * 0.72, sc));
      const tone = blooms && m % 2 ? BLOSSOM[(m + k) % 3] : CANOPY[(m + k) % 3];
      b.place(blob, mtx, (px, py, pz, ny) => mix3(mix3(tone, CANOPY[0], blooms && m % 2 ? 0.15 : 0), [tone[0] * 0.45, tone[1] * 0.55, tone[2] * 0.62], sat(0.5 - ny * 0.6) * (0.7 + 0.3 * vn(px, pz, py))), PAINT);
    }
  }
  // A ruined arch of cream stone with turquoise and gold trim on the ruin isles.
  if (isle.ruin) {
    const a = hash(seed, 17) * Math.PI * 2, rr = R * 0.45, x = cx + Math.sin(a) * rr, z = cz + Math.cos(a) * rr, y = topY(x, z, 0.45);
    const along = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)), span = 3.4, hp = 4.6, q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
    const put = (p: THREE.Vector3, s: V3, c: V3, tilt = 0) => b.place(block, new THREE.Matrix4().compose(p, q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, 0, tilt * 0.6))), new THREE.Vector3(...s)), (px, py, pz) => mix3(c, STONE_WARM, 0.35 * vn(px * 2, py * 2, pz)), CUT);
    for (const side of [-1, 1]) {
      const broken = side > 0, n = broken ? 3 : 5;
      for (let k = 0; k < n; k++) put(new THREE.Vector3(x, y + 0.5 + k * 0.95, z).addScaledVector(along, side * span), [1.25, 0.9, 1.25], k === n - 1 ? mix3(STONE, TRIM, 0.55) : STONE, (hash(k, side, seed) - 0.5) * 0.06);
      put(new THREE.Vector3(x, y + 0.1, z).addScaledVector(along, side * span), [1.7, 0.35, 1.7], STONE_WARM);
    }
    // The surviving half of the arch springs from the whole pier.
    for (let k = 0; k <= 4; k++) {
      const ang = (k / 8) * Math.PI, p = new THREE.Vector3(x, y + hp + Math.sin(ang) * span, z).addScaledVector(along, -Math.cos(ang) * span);
      const blk = new THREE.Matrix4().compose(p, q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ang - Math.PI / 2)), new THREE.Vector3(1.1, 0.95, 1.1));
      b.place(block, blk, () => (k === 2 ? GOLD : STONE), CUT);
    }
    for (let k = 0; k < 3; k++) put(new THREE.Vector3(x + (hash(k, seed, 18) - 0.5) * 6, y + 0.35, z + (hash(k, seed, 19) - 0.5) * 6), [1.1, 0.8, 1.1], STONE, 0.4 + k * 0.3);
  }
  for (const ft of isle.falls ?? []) {
    const ro = R * outline(ft) * 0.9, y = ty - 1.6;
    falls.push({p: [cx + Math.sin(ft) * ro, y, cz + Math.cos(ft) * ro], dir: [Math.sin(ft), 0, Math.cos(ft)], w: Math.max(1.6, R * 0.09), len: y - (CLOUD_Y + 4)});
  }
}

const LAND_VERT_PARS = /* glsl */ `
attribute float aMat;
varying float vMat;
varying vec3 vWPos;
varying vec3 vWNormal;
`;
const LAND_FRAG_PARS = /* glsl */ `
uniform float cloudY;
uniform vec3 mistColor;
varying float vMat;
varying vec3 vWPos;
varying vec3 vWNormal;
float lHash(vec3 p){p=fract(p*.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}
float lNoise(vec3 p){vec3 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
  return mix(mix(mix(lHash(i),lHash(i+vec3(1,0,0)),u.x),mix(lHash(i+vec3(0,1,0)),lHash(i+vec3(1,1,0)),u.x),u.y),
             mix(mix(lHash(i+vec3(0,0,1)),lHash(i+vec3(1,0,1)),u.x),mix(lHash(i+vec3(0,1,1)),lHash(i+vec3(1,1,1)),u.x),u.y),u.z);}
vec3 landBump(vec3 surf_pos,vec3 surf_norm,vec2 dHdxy,float faceDirection){
  vec3 sx=dFdx(surf_pos),sy=dFdy(surf_pos);vec3 r1=cross(sy,surf_norm),r2=cross(surf_norm,sx);
  float det=dot(sx,r1)*faceDirection;vec3 grad=sign(det)*(dHdxy.x*r1+dHdxy.y*r2);
  return normalize(abs(det)*surf_norm-grad);
}
`;

/** One material for all of it: strata, grain and moss on rock, grain on cut stone, mist where it meets the clouds. */
function landMaterial(mist: THREE.Color): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.92, metalness: 0, name: 'skybloom-land'});
  const uniforms = {cloudY: {value: CLOUD_Y}, mistColor: {value: mist}};
  m.onBeforeCompile = s => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n' + LAND_VERT_PARS)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvMat=aMat;vWPos=(modelMatrix*vec4(transformed,1.)).xyz;vWNormal=normalize(mat3(modelMatrix)*objectNormal);');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\n' + LAND_FRAG_PARS)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
  float rockW=clamp(1.-abs(vMat-1.),0.,1.),cutW=clamp(vMat-1.,0.,1.);
  vec3 wp=vWPos;
  float grain=lNoise(wp*1.9)*.6+lNoise(wp*5.3)*.4;
  float bumpH=0.;
  if(rockW>.01){
    // Bedded limestone: beds of cream, sand, rose ochre and lavender grey, warped, with dark seams between.
    float warp=lNoise(wp*.045)*7.+lNoise(wp*.21)*1.3;
    float yy=(wp.y+warp)/3.4,bed=floor(yy),f=fract(yy);
    float hsh=lHash(vec3(bed,3.1,7.7));
    vec3 c=hsh<.32?vec3(.78,.71,.56):hsh<.55?vec3(.56,.53,.48):hsh<.72?vec3(.66,.52,.37):hsh<.88?vec3(.46,.45,.51):vec3(.34,.31,.3);
    c=mix(c,vec3(.8,.74,.6),.25*lNoise(wp*.02));
    c*=.86+.22*grain;
    float seam=smoothstep(.0,.07,f)*smoothstep(1.,.9,f);
    c*=.62+.38*seam;
    // Moss and grass on shelves, damp streaks running down from them.
    float up=smoothstep(.42,.82,vWNormal.y);
    float streak=smoothstep(.55,.85,lNoise(vec3(wp.x*.7,wp.y*.05,wp.z*.7)))*(1.-up)*.45;
    c=mix(c,vec3(.2,.33,.17),max(up*smoothstep(.35,.6,lNoise(wp*.6)+.2),streak*.6));
    diffuseColor.rgb=mix(diffuseColor.rgb,c*diffuseColor.rgb,rockW);
    bumpH+=rockW*(f*.35-(1.-seam)*.25+grain*.35);
  }
  if(cutW>.01){
    diffuseColor.rgb*=mix(1.,.88+.2*grain,cutW);
    bumpH+=cutW*grain*.12;
  }
  // Painted surfaces keep a little grain so no face is flat colour.
  diffuseColor.rgb*=mix(.93+.12*lNoise(wp*2.7),1.,rockW+cutW);
`)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  normal=landBump(-vViewPosition,normal,vec2(dFdx(bumpH),dFdy(bumpH)),faceDirection);')
      .replace('#include <fog_fragment>', /* glsl */ `
  // Whatever reaches down into the cloud tops dissolves into them.
  float mist=smoothstep(cloudY+30.,cloudY+6.,vWPos.y);
  gl_FragColor.rgb=mix(gl_FragColor.rgb,mistColor,mist*mist*.95);
  #include <fog_fragment>`);
  };
  m.customProgramCacheKey = () => 'skybloom-land-1';
  return m;
}

const FALL_VERT = /* glsl */ `
attribute float aLen;
varying vec2 vUv;
varying float vLen;
varying float vY;
#include <fog_pars_vertex>
void main(){
  vUv=uv;vLen=aLen;
  vec4 w=modelMatrix*vec4(position,1.);vY=w.y;
  vec4 mvPosition=viewMatrix*w;
  gl_Position=projectionMatrix*mvPosition;
  #include <fog_vertex>
}
`;
const FALL_FRAG = /* glsl */ `
uniform float time;
uniform float cloudY;
uniform vec3 waterColor;
uniform vec3 foamColor;
uniform vec3 mistColor;
varying vec2 vUv;
varying float vLen;
varying float vY;
#include <fog_pars_fragment>
float fHash(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
float fNoise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);return mix(mix(fHash(i),fHash(i+vec2(1,0)),u.x),mix(fHash(i+vec2(0,1)),fHash(i+vec2(1,1)),u.x),u.y);}
void main(){
  float along=vUv.y*vLen;
  // Streaks pour down faster as the water falls; the sheet tears into ropes and spray lower down.
  float speed=4.+along*.15;
  float s=fNoise(vec2(vUv.x*9.,along*.18-time*speed*.18))*.6+fNoise(vec2(vUv.x*23.,along*.5-time*speed*.5))*.4;
  float edge=smoothstep(0.,.18,vUv.x)*smoothstep(1.,.82,vUv.x);
  float tear=smoothstep(.15,.9,vUv.y);
  float body=edge*mix(.85,smoothstep(.35,.75,s),tear);
  vec3 col=mix(waterColor,foamColor,smoothstep(.45,.8,s)*.8+(1.-smoothstep(0.,.08,vUv.y))*.6);
  float a=body*(1.-smoothstep(.72,1.,vUv.y))*.92;
  // Mist at the foot.
  float mist=smoothstep(cloudY+30.,cloudY+8.,vY);
  col=mix(col,mistColor,mist);a*=1.-mist*.65;
  gl_FragColor=vec4(col,a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

function fallsGeometry(falls: {p: V3; dir: V3; w: number; len: number}[]): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], len: number[] = [], idx: number[] = [];
  const N = 26, C = 5;
  for (const f of falls) {
    const base = pos.length / 3, side: V3 = [-f.dir[2], 0, f.dir[0]];
    for (let j = 0; j <= N; j++) {
      const u = j / N, drop = f.len * u, out = 1.2 * Math.sqrt(u) * Math.min(1, f.len / 20) + u * 2, w = f.w * (1 + u * 1.6);
      for (let i = 0; i <= C; i++) {
        const v = i / C - 0.5, bow = (1 - 4 * v * v) * 0.35 * w;
        pos.push(f.p[0] + side[0] * v * w + f.dir[0] * (out + bow), f.p[1] - drop, f.p[2] + side[2] * v * w + f.dir[2] * (out + bow));
        uv.push(i / C, u); len.push(f.len);
      }
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < C; i++) {
      const a = base + j * (C + 1) + i, b = a + 1, c = a + C + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aLen', new THREE.Float32BufferAttribute(len, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Soft mist billows where the falls and the cliff meet the cloud tops: camera-facing quads, one draw. */
const MIST_VERT = /* glsl */ `
attribute vec4 aPuff;
uniform float time;
varying vec2 vUv;
varying float vSeed;
#include <fog_pars_vertex>
void main(){
  vUv=uv;vSeed=aPuff.w;
  vec3 c=aPuff.xyz+vec3(sin(time*.05+aPuff.w*9.)*2.,sin(time*.08+aPuff.w*5.)*.8,0.);
  float size=(aPuff.w<.0?1.:1.)*(14.+fract(aPuff.w*13.7)*16.);
  vec4 mvPosition=viewMatrix*vec4(c,1.);
  mvPosition.xy+=position.xy*size;
  gl_Position=projectionMatrix*mvPosition;
  #include <fog_vertex>
}
`;
const MIST_FRAG = /* glsl */ `
uniform vec3 mistColor;
uniform vec3 litColor;
varying vec2 vUv;
varying float vSeed;
#include <fog_pars_fragment>
void main(){
  vec2 p=vUv-.5;float r=length(p)*2.;
  float a=(1.-smoothstep(.2,1.,r))*(.55+.45*sin(atan(p.y,p.x)*3.+vSeed*20.)*.3);
  vec3 col=mix(mistColor,litColor,smoothstep(-.3,.4,p.y));
  gl_FragColor=vec4(col,a*.7);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export interface SkybloomLand {
  land: THREE.Mesh;
  falls: THREE.Mesh;
  mist: THREE.Mesh;
  /** Materials whose `time` uniform the island's update drives. */
  animated: THREE.ShaderMaterial[];
  isles: number;
  fallCount: number;
}

export function skybloomLand(colors: {mist: THREE.Color; cloudLit: THREE.Color}): SkybloomLand {
  const b = new Builder(), falls: {p: V3; dir: V3; w: number; len: number}[] = [];
  buildSkirt(b, falls);
  const blob = blobTemplate(2), block = blockTemplate();
  for (const isle of SKY_ISLES) buildIsle(b, isle, blob, block, falls);
  const land = new THREE.Mesh(b.geometry(), landMaterial(colors.mist));
  land.name = 'skybloom-cliffs-and-isles';
  // Below the grass and far off: no shadow pass for it (the island's sun box covers only the play area).
  land.castShadow = false; land.receiveShadow = false;
  const time = {value: 0};
  const fallMat = new THREE.ShaderMaterial({
    name: 'skybloom-waterfall', vertexShader: FALL_VERT, fragmentShader: FALL_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {time: {value: 0}, cloudY: {value: CLOUD_Y}, waterColor: {value: new THREE.Color('#7fd6e6')}, foamColor: {value: new THREE.Color('#f4fbff')}, mistColor: {value: colors.mist}}]),
  });
  fallMat.uniforms.time = time;
  const fallMesh = new THREE.Mesh(fallsGeometry(falls), fallMat);
  fallMesh.name = 'skybloom-waterfalls';
  // Mist: at each fall's foot and in a broken ring where the cliff meets the cloud tops.
  const puffs: number[] = [];
  falls.forEach((f, k) => { for (let i = 0; i < 6; i++) puffs.push(f.p[0] + f.dir[0] * (3 + i) + (hash(i, k, 30) - 0.5) * 8, f.p[1] - f.len + 4 + i * 1.5, f.p[2] + f.dir[2] * (3 + i) + (hash(i, k, 31) - 0.5) * 8, hash(i, k, 32)); });
  // Two broken rings hug the cliff foot so the rock sinks into billows instead of ending on a line.
  for (let i = 0; i < 170; i++) {
    const t = (i / 170) * Math.PI * 2 + hash(i, 33) * 0.04, l = skyLip(t), o = -14 + hash(i, 34) * 16 + (i % 2) * 8;
    puffs.push(l.x + l.nx * o, CLOUD_Y + 14 + hash(i, 35) * 12 + (i % 2) * 6, l.z + l.nz * o, hash(i, 36));
  }
  const quad = new THREE.PlaneGeometry(1, 1), mistGeo = new THREE.InstancedBufferGeometry();
  mistGeo.index = quad.index; mistGeo.setAttribute('position', quad.getAttribute('position')); mistGeo.setAttribute('uv', quad.getAttribute('uv'));
  mistGeo.setAttribute('aPuff', new THREE.InstancedBufferAttribute(new Float32Array(puffs), 4));
  mistGeo.instanceCount = puffs.length / 4;
  mistGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 900);
  const mistMat = new THREE.ShaderMaterial({
    name: 'skybloom-mist', vertexShader: MIST_VERT, fragmentShader: MIST_FRAG, transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {time: {value: 0}, mistColor: {value: colors.mist}, litColor: {value: colors.cloudLit}}]),
  });
  mistMat.uniforms.time = time;
  const mist = new THREE.Mesh(mistGeo, mistMat);
  mist.name = 'skybloom-mist'; mist.frustumCulled = false; mist.renderOrder = 5;
  // Both share one time uniform object, so driving either drives both.
  return {land, falls: fallMesh, mist, animated: [fallMat], isles: SKY_ISLES.length, fallCount: falls.length};
}
