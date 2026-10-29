import * as THREE from 'three';
import type {LavaZone} from './emberLava';
import {EMBER_FISSURES,type EmberFeature} from './emberGroundLayout';
import {EMBER_DETAIL,EMBER_NOISE} from './emberNoise';

/*
 * Emberreach's rocks, crystals and dead trees, built once at load from emberGroundLayout.ts:
 * - columnar basalt: packed hexagonal columns of varied height with chamfered, tilted, broken tops, cross joints
 *   and fallen segments at the foot;
 * - spatter cones: lumpy cinder cones with a glowing vent in the crater;
 * - obsidian outcrops: glassy black chunks with conchoidal facets;
 * - the lava-tube arch: a thick roof of a drained tube, glazed and faintly warm underneath;
 * - charred trees: bent trunks with broken branches and embers in the bark;
 * - ember crystals: faceted shards (hexagonal bipyramids) in clusters, emitting, with white-hot cores.
 * All the rock and wood is one merged mesh with one material (vertex colour plus a per-vertex kind, gloss, glow and
 * the warm light baked from nearby lava, crystals and fissures); the crystals are a second mesh. Two draw calls
 * (plus shadows) for every rock on the island.
 */

export type V3 = [number, number, number];
/** Kinds the rock shader tells apart. */
export const K = {column: 0, cone: 1, obsidian: 2, arch: 3, wood: 4, boulder: 5, dressed: 6} as const;

function rng(seed: number) { let s = (seed * 2654435761) >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const fract = (v: number) => v - Math.floor(v);
const hash3 = (x: number, y: number, z: number) => fract(Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453);
/** Smooth 3D value noise in [-1, 1]. */
function vnoise(x: number, y: number, z: number) {
 const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
 const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
 const l = (a: number, b: number, t: number) => a + (b - a) * t;
 const c = (dx: number, dy: number, dz: number) => hash3(ix + dx, iy + dy, iz + dz);
 return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v), l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w) * 2 - 1;
}

/** Collects triangles with their attributes; flat pieces add triangles, smooth ones add whole geometries. */
export class Builder {
 pos: number[] = []; nrm: number[] = []; col: number[] = []; mat: number[] = []; aux: number[] = [];
 constructor(private readonly ground: (x: number, z: number) => number, private readonly heat: (x: number, y: number, z: number) => number) {}
 private vert(p: V3, n: V3, c: THREE.Color, kind: number, gloss: number, glow: number, seed: number, u = .5) {
  this.pos.push(p[0], p[1], p[2]); this.nrm.push(n[0], n[1], n[2]); this.col.push(c.r, c.g, c.b);
  this.mat.push(kind, gloss, glow, seed);
  this.aux.push(p[1] - this.ground(p[0], p[2]), this.heat(p[0], p[1], p[2]), u);
 }
 /** One flat triangle (counter-clockwise seen from outside). */
 tri(a: V3, b: V3, c: V3, col: THREE.Color, kind: number, gloss = 0, seed = 0, glow: (p: V3) => number = () => 0, us?: V3) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  this.vert(a, [nx, ny, nz], col, kind, gloss, glow(a), seed, us?.[0]); this.vert(b, [nx, ny, nz], col, kind, gloss, glow(b), seed, us?.[1]); this.vert(c, [nx, ny, nz], col, kind, gloss, glow(c), seed, us?.[2]);
 }
 quad(a: V3, b: V3, c: V3, d: V3, col: THREE.Color, kind: number, gloss = 0, seed = 0, glow?: (p: V3) => number) { this.tri(a, b, c, col, kind, gloss, seed, glow); this.tri(a, c, d, col, kind, gloss, seed, glow); }
 /** A whole geometry (normals already computed), in world space. */
 geo(g: THREE.BufferGeometry, col: THREE.Color | ((p: V3) => THREE.Color), kind: number, gloss = 0, seed = 0, glow: (p: V3) => number = () => 0) {
  const src = g.index ? g.toNonIndexed() : g, p = src.getAttribute('position'), n = src.getAttribute('normal');
  for (let i = 0; i < p.count; i++) { const v: V3 = [p.getX(i), p.getY(i), p.getZ(i)]; this.vert(v, [n.getX(i), n.getY(i), n.getZ(i)], typeof col === 'function' ? col(v) : col, kind, gloss, glow(v), seed); }
  if (src !== g) src.dispose();
 }
 build() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
  g.setAttribute('aRkMat', new THREE.Float32BufferAttribute(this.mat, 4));
  g.setAttribute('aRkAux', new THREE.Float32BufferAttribute(this.aux, 3));
  g.computeBoundingSphere();
  return g;
 }
}

/** sRGB hex to a linear colour, scaled. */
export const C = (hex: string, k = 1) => new THREE.Color(hex).multiplyScalar(k);

/** An orthonormal frame round axis `a` (unit): u across, v = u x a, so (u, a, v) turns like (x, y, z). */
function frame(a: V3, rot: number): {u: V3; v: V3} {
 let hx = 0, hy = 0, hz = 1; if (Math.abs(a[2]) > .9) { hx = 1; hz = 0; }
 // u0 = h x a
 let ux = hy * a[2] - hz * a[1], uy = hz * a[0] - hx * a[2], uz = hx * a[1] - hy * a[0]; const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
 const vx0 = uy * a[2] - uz * a[1], vy0 = uz * a[0] - ux * a[2], vz0 = ux * a[1] - uy * a[0];
 const c = Math.cos(rot), s = Math.sin(rot);
 return {u: [ux * c + vx0 * s, uy * c + vy0 * s, uz * c + vz0 * s], v: [vx0 * c - ux * s, vy0 * c - uy * s, vz0 * c - uz * s]};
}

/**
 * A hexagonal basalt prism along axis `a` from `o`: sides, a chamfered top cut on a plane tilted by (tu, tv) per metre
 * across, and (for loose drums) a flat base cap. Face 0 points along u rotated by 30 degrees, as the lattice wants.
 */
function prism(b: Builder, o: V3, a: V3, rot: number, len: number, r: number, tu: number, tv: number, col: THREE.Color, seed: number, capBase = false) {
 const {u, v} = frame(a, rot);
 const P = (s: number, x: number, y: number): V3 => [o[0] + a[0] * s + u[0] * x + v[0] * y, o[1] + a[1] * s + u[1] * x + v[1] * y, o[2] + a[2] * s + u[2] * x + v[2] * y];
 const top = (x: number, y: number) => len + tu * x + tv * y;
 const base: V3[] = [], outer: V3[] = [], inner: V3[] = [], ch = Math.min(.12, r * .16);
 for (let k = 0; k < 6; k++) {
  const ang = k * Math.PI / 3, rr = r * (.95 + .1 * hash3(seed, k, 3.1)), x = Math.cos(ang) * rr, y = Math.sin(ang) * rr;
  base.push(P(0, x, y)); outer.push(P(top(x, y) - ch, x, y)); inner.push(P(top(x * .84, y * .84), x * .84, y * .84));
 }
 const c = P(top(0, 0) + .01, 0, 0), c0 = P(0, 0, 0);
 for (let k = 0; k < 6; k++) {
  const k1 = (k + 1) % 6;
  // Side faces carry u across them (0 to 1) so the shader can darken the seams between columns.
  b.tri(base[k], outer[k], outer[k1], col, K.column, 0, seed, undefined, [0, 0, 1]); b.tri(base[k], outer[k1], base[k1], col, K.column, 0, seed, undefined, [0, 1, 1]);
  b.quad(outer[k], inner[k], inner[k1], outer[k1], col, K.column, 0, seed);
  b.tri(inner[k], c, inner[k1], col, K.column, 0, seed);
  if (capBase) b.tri(base[k1], c0, base[k], col, K.column, 0, seed);
 }
}

/** A column drum or broken length lying on the ground, a flat face down, sunk a little. */
function drum(b: Builder, ground: (x: number, z: number) => number, x: number, z: number, len: number, r: number, yaw: number, roll: number, col: THREE.Color, seed: number) {
 const ax = Math.sin(yaw), az = Math.cos(yaw), dip = (ground(x + ax * len / 2, z + az * len / 2) - ground(x - ax * len / 2, z - az * len / 2)) / len;
 const a: V3 = [ax, dip, az], al = Math.hypot(ax, dip, az); a[0] /= al; a[1] /= al; a[2] /= al;
 const o: V3 = [x - a[0] * len / 2, ground(x, z) + r * .78 - a[1] * len / 2, z - a[2] * len / 2];
 prism(b, o, a, roll, len, r, (hash3(seed, 1, 2) - .5) * .5, (hash3(seed, 2, 1) - .5) * .5, col, seed, true);
}

/** Angular scree: a short, randomly turned prism half buried (basalt breaks into blocks, not pebbles). */
function block(b: Builder, ground: (x: number, z: number) => number, x: number, z: number, s: number, seed: number, col: THREE.Color) {
 const R = rng(seed * 31 + 7), th = R() * Math.PI * 2, tilt = .3 + R() * 1.1;
 const a: V3 = [Math.sin(th) * Math.sin(tilt), Math.cos(tilt), Math.cos(th) * Math.sin(tilt)], len = s * (.7 + R() * .9);
 prism(b, [x - a[0] * len * .45, ground(x, z) - s * .35 - a[1] * len * .3, z - a[2] * len * .45], a, R() * 6, len, s * .62, (R() - .5) * .9, (R() - .5) * .9, col, seed, true);
}

/** Smooth fan of talus round a footprint: ash-grey, lumpy, burying the column feet so the stack grows out of the ground. */
function apron(b: Builder, ground: (x: number, z: number) => number, cx: number, cz: number, edge: (th: number) => number, rise: number, reach: number, seed: number) {
 const N = 44, rings = [[-.9, 1], [-.2, .92], [.35, .62], [.75, .32], [1, .1], [1.25, -.08]] as const, pos: number[] = [], idx: number[] = [];
 for (const [t, hk] of rings) for (let s = 0; s < N; s++) {
  const th = s / N * Math.PI * 2, wob = 1 + .3 * vnoise(Math.cos(th) * 2.1 + seed, t, Math.sin(th) * 2.1);
  const rr = edge(th) + t * reach * wob + .25 * vnoise(Math.cos(th) * 5, seed + t * 3, Math.sin(th) * 5);
  const x = cx + Math.cos(th) * rr, z = cz + Math.sin(th) * rr;
  const lump = .12 * vnoise(x * 1.7, seed, z * 1.7) + .06 * vnoise(x * 4.1, seed * 2, z * 4.1);
  pos.push(x, ground(x, z) + Math.max(-.12, hk * rise * (.7 + .5 * (vnoise(Math.cos(th) * 1.3, seed * .7, Math.sin(th) * 1.3) * .5 + .5)) + (hk > 0 ? lump : 0)), z);
 }
 for (let i = 0; i < rings.length - 1; i++) for (let s = 0; s < N; s++) { const p = i * N + s, q = i * N + (s + 1) % N; idx.push(p, q, p + N, q, q + N, p + N); }
 const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
 b.geo(g, (p) => C('#3d3c43', .85 + .3 * (vnoise(p[0] * .7, p[1], p[2] * .7) * .5 + .5)), K.boulder, 0, seed % 61); g.dispose();
}

/**
 * Columnar basalt: bundles of 7 to 20 hexagonal columns on their own jittered lattices, set apart with talus between
 * them. In each bundle the heights fall away from an off-centre peak (tallest two to four times the shortest), every
 * top is broken on a tilted plane and a few columns are snapped short, so no outline is a flat-topped or stepped mass.
 * The stack leans a few degrees; talus buries the feet, fallen drums and angular blocks lie on it, and a column or
 * two leans out of the face where it broke away.
 */
/** Columns per bundle and tallest-to-shortest ratio of every bundle built (rocks stats, QA). */
const bundleLog: {n: number; ratio: number}[] = [];

function columnCluster(b: Builder, ground: (x: number, z: number) => number, e: EmberFeature) {
 const R = rng(e.seed), cy = Math.cos(e.yaw), sy = Math.sin(e.yaw);
 const sp = Math.min(1, .66 + .035 * e.h + .1 * R()), tile = sp * .577;
 const la = R() * Math.PI * 2, lean = .03 + .05 * R(), lx0 = Math.sin(la) * lean, lz0 = Math.cos(la) * lean;
 const fa = R() * Math.PI * 2;
 const toW = (lx: number, lz: number): [number, number] => [e.x + lx * cy + lz * sy, e.z - lx * sy + lz * cy];
 const palette = ['#363941', '#30333b', '#3d3f47', '#2b2e36', '#3a383f', '#33353b'];
 const edgeLoc: number[] = new Array(48).fill(0);
 // Bundles of 7 to 20 columns each, set apart with talus between them; one or two on a small stack, up to five on a big one.
 const nb = Math.max(1, Math.min(5, Math.round(e.r * e.r / 7)));
 const bundles: {x: number; z: number; rb: number; n: number; H: number}[] = [];
 for (let k = 0, tries = 0; k < nb && tries < 60; tries++) {
  const n = 7 + Math.floor(R() * 14), rb = sp * Math.sqrt(n * .866 / Math.PI) + .2;
  const a = R() * Math.PI * 2, d = k === 0 ? R() * e.r * .25 : (e.r - rb) * (.45 + .55 * R());
  const bx = Math.cos(a) * d, bz = Math.sin(a) * d * .85;
  if (Math.hypot(bx, bz) + rb > e.r * 1.05 && k > 0) continue;
  if (bundles.some((o) => Math.hypot(o.x - bx, o.z - bz) < (o.rb + rb) * .8)) continue;
  bundles.push({x: bx, z: bz, rb, n, H: e.h * (k === 0 ? 1 : .5 + .45 * R())}); k++;
 }
 for (const bu of bundles) {
  // The bundle's own lattice: turned its own way, the cells nearest its centre taken (a compact, ragged bunch).
  const brot = R() * Math.PI / 3, bc = Math.cos(brot), bs = Math.sin(brot), m = Math.ceil(bu.rb / sp) + 2, cells: [number, number, number][] = [];
  for (let j = -m; j <= m; j++) for (let i = -m; i <= m; i++) {
   const u = (i + j * .5) * sp, v = j * sp * .866, lx = bu.x + u * bc - v * bs, lz = bu.z + u * bs + v * bc;
   cells.push([lx, lz, Math.hypot(u, v) + R() * sp * .45]);
  }
  cells.sort((p, q) => p[2] - q[2]);
  const peakA = R() * Math.PI * 2, px = bu.x + Math.cos(peakA) * bu.rb * .45, pz = bu.z + Math.sin(peakA) * bu.rb * .45;
  const bl: V3 = [lx0 + (R() - .5) * .05, 1, lz0 + (R() - .5) * .05];
  const rot = -e.yaw - brot - Math.PI / 6;
  let hMin = Infinity, hMax = 0;
  for (const [lx, lz] of cells.slice(0, bu.n)) {
   const [x, z] = toW(lx, lz), g = ground(x, z);
   // Heights fall away from an off-centre peak: the shortest about a third of the tallest; some snapped lower still.
   const dp = Math.min(1, Math.hypot(lx - px, lz - pz) / (bu.rb * 1.3));
   let h = bu.H * (.3 + .7 * Math.pow(1 - dp, 1.1)) * (.86 + .28 * R());
   if (R() < .12) h *= .45 + .3 * R();
   h = Math.max(.5, bu.H * .29, h); hMin = Math.min(hMin, h); hMax = Math.max(hMax, h);
   const th = Math.atan2(z - e.z, x - e.x), bin = Math.floor(((th / (Math.PI * 2)) + 1) % 1 * 48);
   edgeLoc[bin] = Math.max(edgeLoc[bin], Math.hypot(x - e.x, z - e.z) + tile);
   const ax: V3 = [bl[0] + (R() - .5) * .03, 1, bl[2] + (R() - .5) * .03], al = Math.hypot(ax[0], ax[1], ax[2]); ax[0] /= al; ax[1] /= al; ax[2] /= al;
   // Every top broken: cut on a tilted plane, some steeply.
   const tilt = .3 + .45 * R(), ta = R() * Math.PI * 2;
   prism(b, [x, g - 1.2, z], ax, rot + (R() - .5) * .07, h + 1.2, tile * (.92 + .05 * R()), Math.cos(ta) * tilt, Math.sin(ta) * tilt, C(palette[Math.floor(R() * palette.length)], .78 + .44 * R()), R() * 100);
  }
  bundleLog.push({n: bu.n, ratio: hMax / hMin});
 }
 // Fill gaps in the outline so the talus hugs the stack.
 for (let k = 0; k < 48; k++) if (!edgeLoc[k]) edgeLoc[k] = Math.max(edgeLoc[(k + 47) % 48], edgeLoc[(k + 1) % 48]) || e.r * .6;
 const edge = (th: number) => { const f = (((th / (Math.PI * 2)) % 1) + 1) % 1 * 48, k = Math.floor(f) % 48, t = f - Math.floor(f); return (edgeLoc[k] * (1 - t) + edgeLoc[(k + 1) % 48] * t) * .82; };
 const rise = Math.min(1.7, .2 * e.h + .2), reach = 1.6 + e.r * .45;
 apron(b, ground, e.x, e.z, edge, rise, reach, e.seed);
 // Columns that broke away and lean out of the face, resting on the talus.
 for (let k = 0; k < 1 + Math.floor(e.r / 2.5); k++) {
  const th = fa + Math.PI * (.5 + R()), rr = edge(th) + .2, x = e.x + Math.cos(th) * rr, z = e.z + Math.sin(th) * rr;
  const out = .35 + R() * .3, ax: V3 = [Math.cos(th) * Math.sin(out), Math.cos(out), Math.sin(th) * Math.sin(out)];
  prism(b, [x, ground(x, z) - .6, z], ax, R() * 6, e.h * (.35 + .25 * R()), tile * (.85 + .1 * R()), (R() - .5) * .8, (R() - .5) * .8, C(palette[k % palette.length]), R() * 100);
 }
 // Drums and blocks on the talus and the ground beyond, thickest at the foot.
 for (let k = 0; k < 3 + Math.floor(e.r * .9); k++) {
  const th = R() * Math.PI * 2, rr = edge(th) + reach * (.25 + R() * .9), x = e.x + Math.cos(th) * rr, z = e.z + Math.sin(th) * rr;
  drum(b, ground, x, z, sp * (.5 + R() * 1.1), tile * (.8 + .15 * R()), R() * Math.PI, R() * 6, C(palette[Math.floor(R() * palette.length)], .9 + .2 * R()), R() * 100);
 }
 for (let k = 0; k < 14 + Math.floor(e.r * 5); k++) {
  const th = R() * Math.PI * 2, rr = edge(th) + reach * Math.pow(R(), .7) * 1.25, x = e.x + Math.cos(th) * rr, z = e.z + Math.sin(th) * rr;
  block(b, ground, x, z, .14 + R() * .3 * Math.min(1.5, sp), Math.floor(R() * 1e5), C(palette[Math.floor(R() * palette.length)], .85 + .3 * R()));
 }
}

/** A rounded, lumpy boulder (smooth normals), sunk a third into the ground. */
function boulder(b: Builder, ground: (x: number, z: number) => number, x: number, z: number, s: number, seed: number, col: THREE.Color, kind: number = K.boulder) {
 const g = new THREE.IcosahedronGeometry(1, 1), p = g.getAttribute('position');
 for (let i = 0; i < p.count; i++) {
  const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i), k = 1 + .28 * vnoise(vx * 1.6 + seed, vy * 1.6, vz * 1.6) + .1 * vnoise(vx * 4 + seed, vy * 4, vz * 4);
  p.setXYZ(i, vx * k * s * 1.15, vy * k * s * .72, vz * k * s);
 }
 g.rotateY(seed * 2.3); g.translate(x, ground(x, z) + s * .25, z);
 const m = g.toNonIndexed(); g.dispose(); m.computeVertexNormals();
 // Faceted, but softly: average normals over the shared positions.
 smoothNormals(m);
 b.geo(m, col, kind, 0, seed); m.dispose();
}

/** Averages the normals of coincident vertices (a non-indexed geometry built from an indexed shape). */
function smoothNormals(g: THREE.BufferGeometry) {
 const p = g.getAttribute('position'), n = g.getAttribute('normal'), map = new Map<string, number[]>();
 for (let i = 0; i < p.count; i++) { const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`; (map.get(key) ?? map.set(key, []).get(key)!).push(i); }
 for (const ids of map.values()) {
  let x = 0, y = 0, z = 0; for (const i of ids) { x += n.getX(i); y += n.getY(i); z += n.getZ(i); }
  const l = Math.hypot(x, y, z) || 1; for (const i of ids) n.setXYZ(i, x / l, y / l, z / l);
 }
}

/**
 * A spatter cone: steep flanks of welded spatter (lumpy at two scales), a ragged rim breached on one side, a deep
 * crater glowing toward its vent. Scoria is dark at the foot and oxidised rust-red toward the rim, with sulfur
 * crusting a few spots of the lip.
 */
function spatterCone(b: Builder, ground: (x: number, z: number) => number, e: EmberFeature) {
 const R = rng(e.seed), segs = 40, H = e.h, r = e.r, breach = R() * Math.PI * 2;
 const prof: [number, number, number][] = [[1.18, -.45, 0], [1, 0, 0], [.88, .2, 0], [.74, .45, 0], [.6, .7, 0], [.48, .9, 0], [.4, 1, 0], [.33, .97, .05], [.27, .8, .3], [.2, .62, .7], [.11, .48, 1]];
 const g0 = ground(e.x, e.z), pos: number[] = [], glow: number[] = [], hf: number[] = [], idx: number[] = [];
 for (let i = 0; i < prof.length; i++) for (let s = 0; s < segs; s++) {
  const a = s / segs * Math.PI * 2, [pr, ph, pg] = prof[i], ca = Math.cos(a), sa = Math.sin(a);
  const lump = 1 + .13 * vnoise(ca * 2.4 + e.seed, ph * 3, sa * 2.4) + .07 * vnoise(ca * 7, ph * 9 + e.seed, sa * 7);
  const rad = pr * r * lump * (1 + .07 * Math.sin(a * 2 + e.seed));
  const x = e.x + ca * rad, z = e.z + sa * rad;
  // The breach lowers the rim over about 70 degrees; the rim itself is notched.
  const db = Math.abs(Math.atan2(Math.sin(a - breach), Math.cos(a - breach))), cut = Math.max(0, 1 - db / .62);
  const rim = Math.max(0, 1 - Math.abs(ph - 1) / .45) * (.1 * vnoise(ca * 5 + e.seed, 3.3, sa * 5) - .3 * cut * cut);
  const y = i === 0 ? ground(x, z) - .5 : i === 1 ? ground(x, z) + .02 : g0 + (ph + rim) * H * (1 + .06 * vnoise(ca * 3, e.seed, sa * 3));
  pos.push(x, y, z); glow.push(pg); hf.push(Math.max(0, ph));
 }
 for (let i = 0; i < prof.length - 1; i++) for (let s = 0; s < segs; s++) {
  const a = i * segs + s, bb = i * segs + (s + 1) % segs, c = a + segs, d = bb + segs;
  idx.push(a, c, bb, bb, c, d);
 }
 const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
 const key = (x: number, z: number) => `${x.toFixed(3)},${z.toFixed(3)}`, glowAt = new Map<string, number>(), hAt = new Map<string, number>();
 for (let i = 0; i < glow.length; i++) { glowAt.set(key(pos[i * 3], pos[i * 3 + 2]), glow[i]); hAt.set(key(pos[i * 3], pos[i * 3 + 2]), hf[i]); }
 const dark = C('#2c282c'), rust = C('#5c3227'), sulfur = C('#a8913e'), tmp = new THREE.Color();
 b.geo(g, (p) => {
  const h = hAt.get(key(p[0], p[2])) ?? 0, n = vnoise(p[0] * .9, p[1] * .9, p[2] * .9) * .5 + .5, n2 = vnoise(p[0] * 2.3 + 5, p[1] * 2.3, p[2] * 2.3) * .5 + .5;
  tmp.copy(dark).lerp(rust, Math.min(1, Math.max(0, (h - .45) / .45)) * (.45 + .55 * n));
  if (h > .85 && n2 > .74) tmp.lerp(sulfur, Math.min(1, (n2 - .74) * 5) * .7);
  return tmp.clone().multiplyScalar(.85 + .3 * n2);
 }, K.cone, 0, e.seed % 97, (p) => glowAt.get(key(p[0], p[2])) ?? 0);
 g.dispose();
 // The vent: a little molten pool at the crater's bottom.
 const vg = new THREE.CircleGeometry(r * .13, 12); vg.rotateX(-Math.PI / 2); vg.translate(e.x, g0 + .48 * H + .03, e.z);
 b.geo(vg, C('#3a1a14'), K.cone, 0, 0, () => 1.3); vg.dispose();
 // Spatter bombs and welded clots scattered round it, more on the breach side.
 for (let k = 0; k < 11; k++) { const a = k < 5 ? breach + (R() - .5) * 1.2 : R() * Math.PI * 2, rr = r * (1.05 + R() * .9); boulder(b, ground, e.x + Math.cos(a) * rr, e.z + Math.sin(a) * rr, .14 + R() * .26, R() * 40, C(R() < .4 ? '#4a2c26' : '#2f2a2e', .9 + .2 * R())); }
}

/** Glassy obsidian chunks with conchoidal facets (flat normals, tilted out of the ground). */
function obsidian(b: Builder, ground: (x: number, z: number) => number, e: EmberFeature) {
 const R = rng(e.seed);
 for (let k = 0; k < 4 + Math.floor(e.r); k++) {
  const a = R() * Math.PI * 2, rr = k === 0 ? 0 : e.r * (.35 + R() * .6), x = e.x + Math.sin(a) * rr, z = e.z + Math.cos(a) * rr;
  const s = (k === 0 ? 1 : .45 + R() * .45) * e.r * .55, hgt = (k === 0 ? e.h : e.h * (.3 + R() * .5));
  const g = new THREE.IcosahedronGeometry(1, 0), p = g.getAttribute('position'), sd = R() * 50;
  for (let i = 0; i < p.count; i++) {
   const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i), q = 1 + .35 * (hash3(Math.round(vx * 100) + sd, Math.round(vy * 100), Math.round(vz * 100)) - .5);
   p.setXYZ(i, vx * q * s, Math.max(-.3, vy) * q * hgt * .65, vz * q * s * .8);
  }
  g.rotateZ((R() - .5) * .5); g.rotateX((R() - .5) * .4); g.rotateY(R() * 6.3);
  g.translate(x, ground(x, z) + hgt * .2, z); g.computeVertexNormals();
  b.geo(g, C(R() < .25 ? '#24202a' : '#17161c', .9 + .2 * R()), K.obsidian, 1, sd); g.dispose();
 }
 for (let k = 0; k < 8; k++) { const a = R() * Math.PI * 2, rr = e.r * (.9 + R() * 1.1); boulder(b, ground, e.x + Math.sin(a) * rr, e.z + Math.cos(a) * rr, .12 + R() * .2, R() * 40, C('#1b1a20'), K.obsidian); }
}

/** A tube swept along points with a per-point radius pair (width, thickness) and lumpy noise; smooth normals. */
function sweep(path: V3[], width: number[], thick: number[], side: V3, sides: number, lump: number, seed: number) {
 const pos: number[] = [], idx: number[] = [];
 for (let i = 0; i < path.length; i++) {
  const p = path[i], q = path[Math.min(path.length - 1, i + 1)], o = path[Math.max(0, i - 1)];
  let tx = q[0] - o[0], ty = q[1] - o[1], tz = q[2] - o[2]; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
  // n = side x t (the "up" of the section), side kept horizontal.
  let nx = side[1] * tz - side[2] * ty, ny = side[2] * tx - side[0] * tz, nz = side[0] * ty - side[1] * tx; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
  for (let s = 0; s < sides; s++) {
   const a = s / sides * Math.PI * 2, k = 1 + lump * vnoise(Math.cos(a) * 1.7 + seed, i * .45, Math.sin(a) * 1.7);
   const u = Math.cos(a) * width[i] * k, v = Math.sin(a) * thick[i] * k;
   pos.push(p[0] + side[0] * u + nx * v, p[1] + side[1] * u + ny * v, p[2] + side[2] * u + nz * v);
  }
 }
 for (let i = 0; i < path.length - 1; i++) for (let s = 0; s < sides; s++) { const a = i * sides + s, b = i * sides + (s + 1) % sides; idx.push(a, b, a + sides, b, b + sides, a + sides); }
 const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
 return g;
}

/** The drained lava tube's surviving roof: a thick, lumpy arch, glazed and warm on its underside. */
function arch(b: Builder, ground: (x: number, z: number) => number, e: EmberFeature) {
 const R = rng(e.seed), ax = Math.sin(e.yaw), az = Math.cos(e.yaw), side: V3 = [az, 0, -ax], N = 26;
 const path: V3[] = [], w: number[] = [], t: number[] = [];
 for (let i = 0; i <= N; i++) {
  // A flattened roof on steep legs, a little lopsided, the way a tube collapses.
  const th = i / N * Math.PI, s = -Math.cos(th) * e.r * (1.02 + .08 * Math.sin(th * 3)), x = e.x + ax * s, z = e.z + az * s;
  const g = ground(x, z), lift = Math.sin(th);
  path.push([x, g - 1.2 + (e.h - .4) * Math.pow(lift, .42) * (1 + .06 * Math.sin(th * 2 + .7)), z]);
  const end = 1 - lift; w.push(3 + 1.6 * end * end + .35 * Math.sin(i * 1.7)); t.push(1.35 + 1.1 * end * end + .2 * Math.cos(i * 2.3));
 }
 const g = sweep(path, w, t, side, 18, .2, e.seed % 31);
 // Rougher: a second, finer octave pushed along the normals.
 const gp = g.getAttribute('position'), gn = g.getAttribute('normal');
 for (let i = 0; i < gp.count; i++) { const k = .22 * vnoise(gp.getX(i) * 1.3, gp.getY(i) * 1.3, gp.getZ(i) * 1.3) + .08 * vnoise(gp.getX(i) * 3.7, gp.getY(i) * 3.7, gp.getZ(i) * 3.7); gp.setXYZ(i, gp.getX(i) + gn.getX(i) * k, gp.getY(i) + gn.getY(i) * k, gp.getZ(i) + gn.getZ(i) * k); }
 g.computeVertexNormals();
 const apex = e.h - .2 + ground(e.x, e.z) - 1;
 b.geo(g, (p) => C('#34343c', .85 + .25 * (vnoise(p[0] * .6, p[1] * .6, p[2] * .6) * .5 + .5)), K.arch, .25, e.seed % 89, (p) => {
  // The underside of the roof near the apex keeps a dull red glaze.
  return Math.max(0, 1 - Math.abs(p[1] - (apex - 1.2)) / 1.4) * .45 * Math.max(0, 1 - Math.hypot(p[0] - e.x, p[2] - e.z) / (e.r * .8));
 });
 g.dispose();
 // Broken tube wall stubs and talus at both feet.
 for (const k of [-1, 1]) {
  const fx = e.x + ax * e.r * k, fz = e.z + az * e.r * k;
  // Columns stand against each leg: the tube cut through a basalt flow.
  columnCluster(b, ground, {kind: 'columns', x: fx + az * 2.8 * k, z: fz - ax * 2.8 * k, r: 2.4, h: e.h * .55, yaw: e.yaw, seed: e.seed + 11 * k + 3});
  for (let j = 0; j < 9; j++) { const a = R() * Math.PI * 2, rr = 1.8 + R() * 2.6; boulder(b, ground, fx + Math.sin(a) * rr, fz + Math.cos(a) * rr, .25 + R() * .45, R() * 40, C('#33353d', .85 + .3 * R())); }
 }
 // Slabs fallen from the roof, lying across the tube's floor.
 for (let j = 0; j < 3; j++) { const s = (R() - .5) * e.r * 1.2; boulder(b, ground, e.x + ax * s + az * (R() - .5) * 2.5, e.z + az * s - ax * (R() - .5) * 2.5, .5 + R() * .4, R() * 40, C('#30323a')); }
}

/** A dead tree burnt black: bent trunk, a few broken limbs, embers in the cracks low down. */
function charred(b: Builder, ground: (x: number, z: number) => number, e: EmberFeature) {
 const R = rng(e.seed), g0 = ground(e.x, e.z), lean = (R() - .5) * .25, la = R() * 6.3;
 const limb = (o: V3, dir: V3, len: number, r0: number, n: number) => {
  const path: V3[] = [], w: number[] = [];
  let [x, y, z] = o, [dx, dy, dz] = dir;
  for (let i = 0; i <= n; i++) {
   path.push([x, y, z]); w.push(r0 * (1 - i / n * .82));
   const bend = .18; dx += (R() - .5) * bend; dz += (R() - .5) * bend; dy += .02;
   const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
   x += dx * len / n; y += dy * len / n; z += dz * len / n;
  }
  const g = sweep(path, w, w, [Math.cos(la), 0, -Math.sin(la)], 7, .12, R() * 9);
  b.geo(g, (p) => C('#1f1b1c', .8 + .4 * (vnoise(p[0] * 3, p[1] * 3, p[2] * 3) * .5 + .5)), K.wood, 0, R() * 50, (p) => Math.max(0, 1 - (p[1] - g0) / 1.6) * .6);
  g.dispose();
  return path;
 };
 const trunk = limb([e.x, g0 - .4, e.z], [Math.sin(la) * lean, 1, Math.cos(la) * lean], e.h, .32 + R() * .1, 9);
 for (let k = 0; k < 3 + Math.floor(R() * 3); k++) {
  const at = trunk[4 + Math.floor(R() * 5)], a = R() * 6.3, up = .5 + R() * .7;
  limb(at, [Math.sin(a), up, Math.cos(a)], 1.2 + R() * 1.8, .12 + R() * .06, 4);
 }
 // Stump roots: two or three short knuckles.
 for (let k = 0; k < 3; k++) { const a = k * 2.1 + R(); limb([e.x, g0 + .25, e.z], [Math.sin(a), -.35, Math.cos(a)], .9, .16, 3); }
}

/** Faceted ember shards: hexagonal bipyramids leaning out of a cluster's heart. */
function crystalCluster(pos: number[], nrm: number[], uv: number[], ground: (x: number, z: number) => number, e: EmberFeature) {
 const R = rng(e.seed), g0 = ground(e.x, e.z), count = e.h > 3 ? 13 : 4 + Math.floor(R() * 3);
 const tri = (a: V3, bq: V3, c: V3, ua: number[], ub: number[], uc: number[]) => {
  const ux = bq[0] - a[0], uy = bq[1] - a[1], uz = bq[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  for (const [p, u] of [[a, ua], [bq, ub], [c, uc]] as [V3, number[]][]) { pos.push(...p); nrm.push(nx, ny, nz); uv.push(...u); }
 };
 for (let k = 0; k < count; k++) {
  const main = k === 0, len = main ? e.h : e.h * (.3 + R() * .55), w = len * (.13 + R() * .06), seed = R();
  const a = R() * Math.PI * 2, off = main ? 0 : e.r * (.25 + R() * .55), tilt = main ? .08 : .25 + R() * .55;
  const ox = e.x + Math.sin(a) * off, oz = e.z + Math.cos(a) * off, oy = ground(ox, oz) - .35;
  const dx = Math.sin(a) * Math.sin(tilt), dy = Math.cos(tilt), dz = Math.cos(a) * Math.sin(tilt);
  // A frame round the axis.
  let px = dy, py = -dx, pz = 0; if (Math.abs(dz) > .9) { px = 0; py = dz; pz = -dy; }
  const pl = Math.hypot(px, py, pz); px /= pl; py /= pl; pz /= pl;
  const qx = dy * pz - dz * py, qy = dz * px - dx * pz, qz = dx * py - dy * px;
  const ring = (t: number, r: number): V3[] => Array.from({length: 6}, (_, i) => { const an = i / 6 * Math.PI * 2 + seed * 3, c = Math.cos(an) * r * (.85 + .3 * hash3(k, i, e.seed)), s = Math.sin(an) * r; return [ox + dx * t + px * c + qx * s, oy + dy * t + py * c + qy * s, oz + dz * t + pz * c + qz * s]; });
  const r0 = ring(0, w * .85), r1 = ring(len * (.62 + .1 * R()), w), tip: V3 = [ox + dx * len, oy + dy * len, oz + dz * len];
  for (let i = 0; i < 6; i++) {
   const j = (i + 1) % 6;
   tri(r0[i], r0[j], r1[j], [0, seed], [0, seed], [.65, seed]); tri(r0[i], r1[j], r1[i], [0, seed], [.65, seed], [.65, seed]);
   tri(r1[i], r1[j], tip, [.65, seed], [.65, seed], [1, seed]);
  }
 }
 void g0;
}

const ROCK_HEAD = /* glsl */ `
uniform float egDetail;
uniform float rkTime;
varying vec3 vRkW;
varying vec3 vRkN;
varying vec4 vRkMat;
varying vec3 vRkAux;
${EMBER_NOISE}
`;

const ROCK_COLOR = /* glsl */ `
vec3 rkN=normalize(vRkN);
vec3 rkA=abs(rkN);
// Planar projection by the dominant axis (columns, walls and tops each get their own grain).
vec2 rkQ=rkA.y>.7?vRkW.xz:(rkA.x>rkA.z?vRkW.zy:vRkW.xy);
float rkKind=vRkMat.x,rkSeed=vRkMat.w;
float rkFoot=length(fwidth(vRkW));
float rkFine=1.-smoothstep(.04,.2,rkFoot);
float rkN1=egNoise(rkQ*1.3+rkSeed),rkN2=egNoise(rkQ*4.7-rkSeed);
vec3 rkC=vColor.rgb;
// Grain: mottling everywhere, vertical streaks of weathering on the walls.
rkC*=.88+.2*(rkN1*.5+.5)+.1*rkN2*rkFine;
float rkWall=1.-smoothstep(.45,.8,rkA.y);
rkC*=1.-.12*rkWall*smoothstep(.2,.8,egNoise(vec2(rkQ.x*3.,rkQ.y*.25)+rkSeed)*.5+.5);
if(rkKind<.5){
  // Columnar basalt: cross joints every metre or so, a little darker and lit along the lip below.
  float jy=vRkW.y*.92+rkSeed*.37,jf=fract(jy);
  float joint=(1.-smoothstep(.0,.03+rkFoot*.4,jf))*rkWall*step(.35,fract(floor(jy)*.37+rkSeed));
  rkC*=1.-.45*joint;
  rkC*=1.+.12*(1.-smoothstep(.03,.12,jf))*rkWall*(1.-joint);
  // Seams between columns: shadowed gaps at the face edges and a worn, paler arris just inside them; the face itself
  // bellies a little (lighter mid-face), so each column reads as a separate stripe even in shade.
  float fu=vRkAux.z,fe=min(fu,1.-fu)*2.;
  float fw=clamp(fwidth(fu)*1.5,.02,.4);
  rkC*=mix(.42,1.,smoothstep(.0,fw+.06,fe))*(1.+.16*smoothstep(fw+.06,fw+.2,fe)*(1.-smoothstep(.3,.6,fe))*rkFine)*(.93+.1*fe);
}
if(rkKind>5.5){
  // Dressed stone: tooled in fine vertical flutes, edges worn paler.
  rkC*=1.+.05*sin(rkQ.x*40.)*rkFine*rkWall;
}
if(rkKind>3.5&&rkKind<4.5){
  // Charred bark: blocky alligator cracks, near black between.
  vec3 cel=egCells(vec2(rkQ.x*2.3,rkQ.y*1.1)+rkSeed);
  rkC*=mix(.45,1.,smoothstep(.0,.06,cel.x));
  rkC*=.9+.25*cel.y;
}
// Ash settles on everything facing up; the volcano's dust is warmer on the tops.
float rkDust=smoothstep(.55,.95,rkN.y)*smoothstep(-.3,.3,rkN1+.2)*(rkKind>1.5&&rkKind<2.5?.25:1.);
rkC=mix(rkC,vec3(.43,.41,.43)*(.9+.2*rkN2),rkDust*.75);
// Contact shade near the ground, cool rather than black.
float rkAo=smoothstep(-.2,1.4,vRkAux.x);
rkC*=mix(vec3(.5,.48,.58),vec3(1.),rkAo);
diffuseColor.rgb=egSrgb(rkC);
`;

const ROCK_ROUGH = /* glsl */ `
roughnessFactor=mix(.88,.14+.1*egNoise(rkQ*2.),vRkMat.y)*mix(1.,.9,rkDust*0.);
roughnessFactor=mix(roughnessFactor,.95,rkDust);
`;

const ROCK_NORMAL = /* glsl */ `
if(rkKind>1.5&&rkKind<2.5&&vRkMat.y>.5){
  // Conchoidal fracture: each facet scooped into shallow shells with ripple rings round their point of impact.
  vec3 cel=egCells(rkQ*1.5+rkSeed);
  float h=-cel.z*cel.z*.09+sin(cel.z*34.+cel.y*6.)*.0035*(1.-smoothstep(.02,.08,rkFoot))+smoothstep(.0,.05,cel.x)*.01;
  vec3 dx=dFdx(-vViewPosition),dy=dFdy(-vViewPosition);
  float hx=dFdx(h),hy=dFdy(h);
  vec3 r1=cross(dy,normal),r2=cross(normal,dx);float det=dot(dx,r1);
  if(abs(det)>1e-12)normal=normalize(abs(det)*normal-sign(det)*(hx*r1+hy*r2));
}
if(egDetail>.5&&vRkMat.y<.5){
  // Rough grain, only where it can be seen.
  float h=(rkN2*.012+egNoise(rkQ*13.)*.006)*rkFine;
  vec3 dx=dFdx(-vViewPosition),dy=dFdy(-vViewPosition);
  float hx=dFdx(h),hy=dFdy(h);
  vec3 r1=cross(dy,normal),r2=cross(normal,dx);float det=dot(dx,r1);
  if(abs(det)>1e-12)normal=normalize(abs(det)*normal-sign(det)*(hx*r1+hy*r2));
}
`;

const ROCK_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
{
  // Molten glow (vents, glazes, embers in the bark).
  float g=vRkMat.z;
  float flick=.8+.2*sin(rkTime*2.3+vRkW.x*1.7+vRkW.z);
  vec3 hot=mix(vec3(1.,.22,.04),vec3(1.,.6,.22),smoothstep(.8,1.3,g));
  if(rkKind>3.5&&rkKind<4.5){vec3 cel=egCells(vec2(rkQ.x*2.3,rkQ.y*1.1)+rkSeed);g*=(1.-smoothstep(.0,.05,cel.x))*step(.55,cel.y)*1.8;}
  totalEmissiveRadiance+=hot*g*g*2.2*flick;
  // Warm light from the lava, crystals and fissures nearby, landing on faces turned away from the sky.
  float heat=vRkAux.y*(1.-smoothstep(.0,5.,vRkAux.x))*(.55+.45*(1.-max(rkN.y,0.)));
  totalEmissiveRadiance+=vec3(1.,.36,.1)*heat*.16*diffuseColor.rgb*12.;
}
`;

const ROCK_OUT = /* glsl */ `{
  // Obsidian is glass: a sharp rim of the hazy sky on its facets.
  if(vRkMat.y>.5){
    vec3 V=normalize(cameraPosition-vRkW);
    float F=pow(1.-clamp(dot(rkN,V),0.,1.),4.);
    outgoingLight+=vec3(.9,.5,.32)*F*.22*vRkMat.y;
  }
}
#include <opaque_fragment>`;

const CRYSTAL_HEAD = /* glsl */ `
uniform float rkTime;
varying vec3 vCrW;
varying vec3 vCrN;
varying vec2 vCrU;
`;

const CRYSTAL_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
{
  vec3 V=normalize(cameraPosition-vCrW),N=normalize(vCrN);
  float facing=clamp(dot(N,V),0.,1.);
  // Light from inside: white-hot at the heart (low and facing the eye), amber through the body, red at the edges.
  float body=pow(facing,1.5);
  float u=vCrU.x;
  vec3 deep=vec3(.55,.06,.02),amber=vec3(1.,.3,.05),core=vec3(1.,.66,.3);
  vec3 c=mix(deep,amber,body);
  c=mix(c,core,body*body*body*(1.-smoothstep(.1,.5,u)));
  float breathe=.85+.15*sin(rkTime*1.3+vCrU.y*20.);
  totalEmissiveRadiance+=c*(.45+.9*body*(1.-u*.6))*breathe;
}
`;

export interface EmberRocksOptions {
 height: (x: number, z: number) => number;
 zones: readonly LavaZone[];
 features: readonly EmberFeature[];
 /** More pieces in the same mesh and material (the forge court's columns). */
 extra?: (b: Builder) => void;
 /** Loose field stones (emberPlants.emberRubble). */
 rubble?: readonly {x: number; z: number; s: number; seed: number}[];
}

/** Builds the rock mesh and the crystal mesh. Features on the lava (zones read at runtime) are skipped. */
export function emberRocks(opts: EmberRocksOptions) {
 const {height, zones} = opts;
 const onLava = (e: EmberFeature) => zones.some((z) => Math.hypot(z.x - e.x, z.z - e.z) < z.radius + e.r + 1.5);
 const features = opts.features.filter((e) => !onLava(e));
 const crystals = features.filter((e) => e.kind === 'crystal');
 const segDist = (x: number, z: number, a: readonly [number, number], b: readonly [number, number]) => { const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz))); return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t); };
 const heat = (x: number, y: number, z: number) => {
  let h = 0;
  for (const c of crystals) { const d = Math.hypot(x - c.x, z - c.z, (y - height(c.x, c.z) - 1) * .6); h += Math.pow(Math.max(0, 1 - d / (4 + c.r * 2.5)), 2) * (c.h > 3 ? 1.4 : .9); }
  for (const zn of zones) { const d = Math.hypot(x - zn.x, z - zn.z) - zn.radius; h += Math.pow(Math.max(0, 1 - d / 12), 2); }
  for (const line of EMBER_FISSURES) for (let k = 1; k < line.length; k++) h += Math.pow(Math.max(0, 1 - segDist(x, z, line[k - 1], line[k]) / 3.5), 2) * .5;
  const edge = Math.hypot(x / 128, (z - 2) / 155); h += Math.max(0, Math.min(1, (edge - .76) / .08)) * .8;
  return Math.min(1.5, h);
 };
 const b = new Builder(height, heat);
 bundleLog.length = 0;
 for (const e of features) {
  if (e.kind === 'columns') columnCluster(b, height, e);
  else if (e.kind === 'cone') spatterCone(b, height, e);
  else if (e.kind === 'obsidian') obsidian(b, height, e);
  else if (e.kind === 'arch') arch(b, height, e);
  else if (e.kind === 'charred') charred(b, height, e);
  else if (e.kind === 'crystal') {
   // The host rock: a few dark boulders the shards break out of.
   const R = rng(e.seed + 7);
   for (let k = 0; k < 3 + e.r * 2; k++) { const a = R() * 6.3, rr = e.r * (.4 + R() * .8); boulder(b, height, e.x + Math.sin(a) * rr, e.z + Math.cos(a) * rr, .25 + R() * .3 * e.r, R() * 40, C('#2c2d34', .9 + .2 * R())); }
  }
 }
 opts.extra?.(b);
 for (const r of opts.rubble ?? []) boulder(b, height, r.x, r.z, r.s, r.seed, C(r.seed % 3 < 1 ? '#2c2d34' : '#3a3b42', .85 + .03 * (r.seed % 10)));
 const rockGeo = b.build();
 const uniforms = {egDetail: EMBER_DETAIL, rkTime: {value: 0}};
 const rockMat = new THREE.MeshStandardMaterial({color: '#ffffff', vertexColors: true, roughness: .88, metalness: 0});
 rockMat.name = 'ember-rock';
 rockMat.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
   .replace('#include <common>', '#include <common>\nattribute vec4 aRkMat;\nattribute vec3 aRkAux;\nvarying vec3 vRkW;\nvarying vec3 vRkN;\nvarying vec4 vRkMat;\nvarying vec3 vRkAux;')
   .replace('#include <fog_vertex>', '#include <fog_vertex>\nvRkW=(modelMatrix*vec4(transformed,1.)).xyz;vRkN=normalize(mat3(modelMatrix)*objectNormal);vRkMat=aRkMat;vRkAux=aRkAux;');
  shader.fragmentShader = shader.fragmentShader
   .replace('#include <common>', `#include <common>\n${ROCK_HEAD}`)
   .replace('#include <color_fragment>', `#include <color_fragment>\n${ROCK_COLOR}`)
   .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${ROCK_ROUGH}`)
   .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${ROCK_NORMAL}`)
   .replace('#include <emissivemap_fragment>', ROCK_EMISSIVE)
   .replace('#include <opaque_fragment>', ROCK_OUT);
 };
 rockMat.customProgramCacheKey = () => 'ember-rock';
 const rocks = new THREE.Mesh(rockGeo, rockMat);
 rocks.name = 'ember-rocks'; rocks.castShadow = rocks.receiveShadow = true;

 const cp: number[] = [], cn: number[] = [], cu: number[] = [];
 for (const e of crystals) crystalCluster(cp, cn, cu, height, e);
 const crystalGeo = new THREE.BufferGeometry();
 crystalGeo.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
 crystalGeo.setAttribute('normal', new THREE.Float32BufferAttribute(cn, 3));
 crystalGeo.setAttribute('aCrU', new THREE.Float32BufferAttribute(cu, 2));
 crystalGeo.computeBoundingSphere();
 const crystalMat = new THREE.MeshStandardMaterial({color: '#5a1a10', roughness: .22, metalness: .1});
 crystalMat.name = 'ember-crystal';
 crystalMat.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
   .replace('#include <common>', '#include <common>\nattribute vec2 aCrU;\nvarying vec3 vCrW;\nvarying vec3 vCrN;\nvarying vec2 vCrU;')
   .replace('#include <fog_vertex>', '#include <fog_vertex>\nvCrW=(modelMatrix*vec4(transformed,1.)).xyz;vCrN=normalize(mat3(modelMatrix)*objectNormal);vCrU=aCrU;');
  shader.fragmentShader = shader.fragmentShader
   .replace('#include <common>', `#include <common>\n${CRYSTAL_HEAD}`)
   .replace('#include <emissivemap_fragment>', CRYSTAL_EMISSIVE);
 };
 crystalMat.customProgramCacheKey = () => 'ember-crystal';
 const crystalMesh = new THREE.Mesh(crystalGeo, crystalMat);
 crystalMesh.name = 'ember-crystals'; crystalMesh.castShadow = true; crystalMesh.receiveShadow = false;

 return {
  rocks, crystals: crystalMesh, features,
  stats: {features: features.length, skippedOnLava: opts.features.length - features.length, rockTriangles: rockGeo.getAttribute('position').count / 3, crystalTriangles: cp.length / 9,
   bundles: {count: bundleLog.length, minColumns: Math.min(...bundleLog.map((u) => u.n)), maxColumns: Math.max(...bundleLog.map((u) => u.n)), minRatio: +Math.min(...bundleLog.map((u) => u.ratio)).toFixed(2), maxRatio: +Math.max(...bundleLog.map((u) => u.ratio)).toFixed(2), medianRatio: +bundleLog.map((u) => u.ratio).sort((p, q) => p - q)[bundleLog.length >> 1].toFixed(2)}},
  update(time: number) { uniforms.rkTime.value = time; },
 };
}
