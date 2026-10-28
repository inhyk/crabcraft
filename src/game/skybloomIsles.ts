import * as THREE from 'three';
import {mergeVertices} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {realmHeight} from '../sim/world/ground';
import {CLOUD_Y,CLOUD_TOP} from './skybloomClouds';

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
/** A cauliflower crown mass: a welded icosphere pushed out by two scales of noise, so no canopy is a smooth ball. */
function crownTemplate() {
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, 2).deleteAttribute('normal').deleteAttribute('uv'));
  const p = g.getAttribute('position').array as Float32Array;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    const k = 1 + 0.22 * (vn(x * 2.2 + 5, z * 2.2 + y * 1.3, 3) - 0.5) * 2 + 0.1 * (vn(x * 5.5 + y * 3.1, z * 5.5, 4) - 0.5) * 2;
    p[i] = x * k; p[i + 1] = y * k * (y < 0 ? 0.7 : 1); p[i + 2] = z * k;
  }
  return {pos: p, idx: g.getIndex()!.array};
}
/** A box template with a few segments, so cut stone takes the bevelled lighting of smooth normals at its edges. */
function blockTemplate() {
  const g = mergeVertices(new THREE.BoxGeometry(1, 1, 1, 2, 2, 2).deleteAttribute('normal').deleteAttribute('uv'));
  const p = g.getAttribute('position').array as Float32Array;
  // Pull corners in a touch: worn arrises instead of razor edges.
  for (let i = 0; i < p.length; i += 3) { const k = 1 - 0.08 * (Math.abs(p[i]) + Math.abs(p[i + 1]) + Math.abs(p[i + 2]) - 0.5); p[i] *= k; p[i + 1] *= k; p[i + 2] *= k; }
  return {pos: p, idx: g.getIndex()!.array};
}

const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
/**
 * Capes of the lip by bearing (rad, 0 faces +Z, PI/2 faces +X): centre, half-width, how far out (fraction of the lip
 * radius). Only outward, so nothing inside the play bound (edge .8) moves; none on the falls or the north strip.
 */
const CAPES: readonly (readonly [number, number, number])[] = [
  [0.42, 0.13, 0.085], [1.12, 0.17, 0.06], [2.22, 0.12, 0.1], [3.98, 0.14, 0.075], [5.18, 0.11, 0.095], [5.78, 0.16, 0.06],
];
/** The lip's edge value at bearing t: the ellipse, pushed out into capes and a broken, never-smooth outline. */
export function lipScale(t: number): number {
  let b = 0.026 * ring(t, 11, 21) + 0.014 * ring(t, 29, 22);
  for (const [c, w, a] of CAPES) { const d = angDiff(t, c) / w; b += a * Math.exp(-d * d); }
  // The north strip (|x| < 30 under the world tree) belongs to the tree lane's roots: the plain ellipse there.
  return SKY_LIP * (1 + b * smooth(0.3, 0.5, Math.abs(angDiff(t, Math.PI))));
}
const lipPoint = (t: number, k = 1) => { const e = lipScale(t) * k; return [RX * e * Math.sin(t), CZ + RZ * e * Math.cos(t)]; };
/** Grass height on the lip at bearing t: the play surface's own height at the ellipse, rolling down a little on capes. */
const lipHeight = (t: number, e: number) => realmHeight(6, RX * (SKY_LIP - 0.0004) * Math.sin(t), CZ + RZ * (SKY_LIP - 0.0004) * Math.cos(t)) - 18 * Math.max(0, e - SKY_LIP);

/** The lip at bearing t (0 faces +Z, PI/2 faces +X): point, outward normal and the grass height there. */
export function skyLip(t: number) {
  const [x, z] = lipPoint(t), [ax, az] = lipPoint(t - 0.002), [bx, bz] = lipPoint(t + 0.002);
  const tx = bx - ax, tz = bz - az, tl = Math.hypot(tx, tz);
  return {x, z, y: lipHeight(t, lipScale(t)), nx: tz / tl, nz: -tx / tl};
}

/**
 * Pull every terrain vertex past the lip back onto it at the lip's own height, so the grass ends in a clean, broken
 * curve on top of the cliff instead of a stair-stepped slope into the void. Inside the ellipse (edge .83) nothing
 * moves; on a cape the grass carries on at the lip's height, rolling gently down toward its point.
 */
export function clipTerrainToLip(g: THREE.BufferGeometry): number {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  let moved = 0;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), e = Math.hypot(x / RX, (z - CZ) / RZ);
    if (e <= SKY_LIP) continue;
    const t = Math.atan2(x / RX, (z - CZ) / RZ), S = lipScale(t);
    if (e <= S) p.setY(i, lipHeight(t, e));
    else { const l = skyLip(t); p.setXYZ(i, l.x, l.y, l.z); }
    moved++;
  }
  if (moved) { p.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere(); }
  return moved;
}

/** Bearings (rad) of the springs that pour off the main island, away from the harbour and the portal. */
const FALLS_MAIN = [1.62, 4.66, 3.62, 2.72];

/** Radial offset of the rock face from the lip line, metres, at bearing-arc s and height y, `d` below the lip. */
function faceOffset(s: number, y: number, d: number): number {
  const layer = 6 + 5 * vn(s / 70, 3.1, 4);
  const f = (((y + 5 * vn(s / 45, y / 60, 5)) / layer) % 1 + 1) % 1;
  const ledge = 2.2 * Math.pow(1 - f, 1.4);
  // Tepui-like walls: big buttresses and bays along the cliff, tall columns between vertical joints within them,
  // smaller ribs on the columns; all of it grows from nothing under the turf.
  const bulge = 9 * (vn(s / 34, y / 50, 6) - 0.5) * 2, column = 2.8 * (vn(s / 7.5, y / 45, 7) - 0.5) * 2, rib = 1 * (vn(s / 2.6, y / 11, 10) - 0.5) * 2;
  return -0.6 + (ledge + bulge + column + rib) * smooth(2.5, 12, d) - 0.06 * d - 0.0055 * d * d;
}

/** Strata by height: warm cream sandstone under the turf, sand-grey through the middle, cool cloud-lit grey low down. */
const ROCK_TOP = lin(0xcfc2a3), ROCK_MID = lin(0xa89c86), ROCK_LOW = lin(0x8a90a8);
function strataTone(y: number, d: number): V3 {
  const low = smooth(CLOUD_TOP + 40, CLOUD_TOP + 4, y), top = 1 - smooth(1.5, 14, d);
  const band = 0.94 + 0.12 * hash(Math.floor((y + 3 * vn(y * 0.1, d * 0.05, 9)) / 5.5), 7, 31);
  const c = mix3(mix3(ROCK_MID, ROCK_TOP, top), ROCK_LOW, low);
  return [c[0] * band / ROCK_TOP[0] * 0.8, c[1] * band / ROCK_TOP[0] * 0.8, c[2] * band / ROCK_TOP[0] * 0.8];
}

/** The skirt: lip roll, soil band with roots, then bedded rock down past the deepest cloud valley. */
function buildSkirt(b: Builder, falls: {p: V3; dir: V3; w: number; len: number}[]) {
  const M = 640, LIP_ROWS: [number, number, V3, number][] = [
    // depth below lip, outward offset, colour, material
    // The turf rolls out over the rock as an overhanging lip, then the soil band tucks back under it.
    [0, 0, GRASS[0], PAINT], [0.35, 0.7, mix3(GRASS[3], SOIL, 0.3), PAINT], [1.0, 1.05, mix3(MOSS, SOIL, 0.55), PAINT],
    [1.6, 0.6, mix3(SOIL, ROCK_TOP, 0.35), PAINT], [2.4, -0.3, mix3(SOIL_DARK, ROCK_MID, 0.3), PAINT],
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
    const top = l.y - 3;
    for (let j = 0; j < ROCK_ROWS; j++) {
      const u = j / (ROCK_ROWS - 1), y = top + (BOTTOM - top) * Math.pow(u, 1.25), d = l.y - y;
      let off = faceOffset(s, y, d);
      off -= cave * 2.6 * Math.exp(-((d - 4.5) ** 2) / 5);
      // Damp, darker rock in the cave and on the deep undercuts; the shader adds strata and moss.
      const ao = 0.68 + 0.32 * smooth(-7, 2, off + 0.6 + 0.06 * d + 0.0055 * d * d) - cave * 0.3 * Math.exp(-((d - 4.5) ** 2) / 6);
      const c = strataTone(y, d);
      b.v(l.x + l.nx * off, y, l.z + l.nz * off, [c[0] * ao, c[1] * ao, c[2] * ao], ROCK);
    }
    // Remember the springs' mouths for the water.
    for (const ft of FALLS_MAIN) if (Math.abs(Math.atan2(Math.sin(t - ft), Math.cos(t - ft))) < Math.PI / M) {
      const y = l.y - 4.2;
      falls.push({p: [l.x + l.nx * (faceOffset(s, y, 4.2) - 1.2), y, l.z + l.nz * (faceOffset(s, y, 4.2) - 1.2)], dir: [l.nx, 0, l.nz], w: 3.6 + hash(i, 3) * 2, len: y - (CLOUD_TOP - 4)});
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
      // Roots wander and kink as they hang; vines swing in a slow S.
      const u = q / (n - 1), sway = (Math.sin(q * 0.8 + k * 2.1) * (vine ? 0.7 : 0.8) + Math.sin(q * 0.35 + k) * 0.5) * u;
      pts.push([l.x + l.nx * (o + Math.abs(sway) * 0.3) - l.nz * sway, y, l.z + l.nz * (o + Math.abs(sway) * 0.3) + l.nx * sway]);
      radii.push(r0 * (1 - 0.85 * (q / (n - 1))));
    }
    const c = vine ? mix3(VINE, MOSS, hash(k, 6)) : mix3(ROOT, BARK_DARK, hash(k, 6));
    b.tube(pts, radii, vine ? 4 : 5, q => mix3(c, SOIL_DARK, 0.25 * (1 - q / n)));
  }
}

interface Isle {x: number; z: number; y: number; r: number; seed: number; trees: number; ruin?: boolean; garden?: boolean; blossom?: boolean; falls?: number[]; rock?: boolean}
/**
 * Floating isles in three size classes (refs-w6-sky 3.3): three hero isles 42 to 54 m across at 250 to 300 m with
 * trees, a ruin and falls; six mid isles 20 to 26 m across at 380 to 640 m that go blue in the haze; and clusters of
 * bare rocks a few metres across beside the heroes. Placed by bearing (degrees clockwise from north, so most sit in
 * the views up the avenue) and distance from the island's middle; each top sits 5 to 15 degrees above a ground
 * camera's horizon (eye about 15 m), never on one ring at one spacing.
 */
const ISLE_PLAN: readonly (readonly [number, number, number, number, number, Partial<Isle>])[] = [
  // bearing, distance, radius, elevation, trees, extras
  [-27, 250, 24, 9, 3, {ruin: true}], [28, 290, 27, 12, 4, {garden: true, blossom: true}], [94, 245, 24, 6, 3, {blossom: true}],
  [-56, 470, 11, 7, 2, {ruin: true}], [62, 520, 12, 10, 2, {garden: true}], [9, 640, 13, 14, 2, {blossom: true}],
  [-100, 430, 12, 5, 2, {garden: true, blossom: true}], [140, 410, 10, 8, 1, {}], [-142, 380, 11, 11, 2, {ruin: true}],
];
/** Bare rocks around the heroes: [hero index, bearing offset deg, distance offset m, radius, height offset m]. */
const ROCKS: readonly (readonly [number, number, number, number, number])[] = [
  [0, 4, 34, 3.6, 6], [0, -3, 30, 2.4, -4], [0, 6, 52, 2, 2], [1, -5, 38, 3.2, -7], [1, -7, 26, 2.2, 3], [2, 4, 30, 3, 5], [2, 6, 44, 2.1, -3],
];
const ISLE_BASE: Isle[] = ISLE_PLAN.map(([b, d, r, el, trees, extra], i) => {
  const a = THREE.MathUtils.degToRad(b), x = Math.sin(a) * d, z = -Math.cos(a) * d, toIsland = Math.atan2(-x, -z);
  return {x, z, y: 15 + d * Math.tan(THREE.MathUtils.degToRad(el)) - r * 0.25, r, seed: i + 1, trees, ...extra, falls: i === 2 ? [toIsland - 0.12] : i < 3 ? [toIsland + (i % 2 ? 0.5 : -0.5)] : i === 4 ? [toIsland + 0.4] : []};
});
export const SKY_ISLES: readonly Isle[] = [
  ...ISLE_BASE,
  ...ROCKS.map(([h, db, dd, r, dy], i): Isle => {
    const hero = ISLE_PLAN[h], a = THREE.MathUtils.degToRad(hero[0] + db), d = hero[1] + dd;
    return {x: Math.sin(a) * d, z: -Math.cos(a) * d, y: ISLE_BASE[h].y + dy, r, seed: 40 + i, trees: 0, rock: true};
  }),
  // A chunk of the cliff breaking away: a gap of a few metres, the same strata, the turf still on it.
  ...[[5.0, 7.5, 4.5]].map(([t, r, drop], i): Isle => { const l = skyLip(t), o = r + 4.5; return {x: l.x + l.nx * o, z: l.z + l.nz * o, y: l.y - drop, r, seed: 70 + i, trees: 1}; }),
];

/** Underside profile (refs-w6-sky 3.1): depth fraction -> radius fraction. An overhang under the lip, then strata steps. */
const PROFILE_T = [0, 0.05, 0.13, 0.3, 0.45, 0.62, 0.8, 1], PROFILE_R = [1, 1.05, 0.82, 0.74, 0.58, 0.47, 0.3, 0.1];
const profileAt = (f: number) => { let k = 0; while (k < PROFILE_T.length - 2 && f > PROFILE_T[k + 1]) k++; return PROFILE_R[k] + (PROFILE_R[k + 1] - PROFILE_R[k]) * sat((f - PROFILE_T[k]) / (PROFILE_T[k + 1] - PROFILE_T[k])); };


function buildIsle(b: Builder, isle: Isle, blob: ReturnType<typeof blobTemplate>, crown: ReturnType<typeof crownTemplate>, block: ReturnType<typeof blockTemplate>, falls: {p: V3; dir: V3; w: number; len: number}[]) {
  const {x: cx, z: cz, y: ty, r: R, seed} = isle, M = Math.max(isle.rock ? 20 : 40, Math.round(R * 4)), K = isle.rock ? 3 : 7;
  const outline = (t: number) => 1 + 0.2 * (ring(t, 5, seed) - 0.5) * 2 + 0.07 * (ring(t, 17, seed + 1) - 0.5) * 2;
  // Depth: big isles 0.6 to 0.9 of their diameter, bare rocks deeper than wide.
  const D0 = R * (isle.rock ? 1.9 : 1.3 + 0.3 * hash(seed, 3)), depth = (t: number) => D0 * (0.88 + 0.24 * ring(t, 3, seed + 2));
  const topY = (x: number, z: number, e: number) => ty + R * 0.05 * (vn(x / 9, z / 9, seed) - 0.5) * 2 + R * 0.04 * (1 - e * e) - 0.5 * smooth(0.82, 1, e);
  // The underside hangs off-centre (a symmetric one reads as a spinning top).
  const lean = hash(seed, 5) * Math.PI * 2, leanR = R * (0.24 + 0.12 * hash(seed, 6));
  const base = b.pos.length / 3;
  const cap = (x: number, z: number, e: number): V3 => {
    if (isle.rock) return mix3(MOSS, SOIL, smooth(0.6, 1, e) * 0.5);
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
  // Underside rows: a soil roll under the turf, then for each stratum a ledge (a short flat step in) and its face,
  // every band with its own wobble so the ledges never line up; the lowest rows close on the pendant.
  // dd: metres below the turf, or with `frac` a fraction of the local depth.
  type Row = {dd: number; frac: boolean; r: (t: number) => number; c: V3; m: number};
  const rows: Row[] = [
    {dd: 0.5, frac: false, r: t => R * outline(t) + 0.45, c: SOIL, m: PAINT}, {dd: 1.6, frac: false, r: t => R * outline(t) + 0.2, c: SOIL_DARK, m: PAINT},
  ];
  for (let k = 0; k < PROFILE_T.length - 1; k++) {
    const wob = (t: number) => 1 + 0.16 * (ring(t, 4 + (k % 3), seed + 30 + k) - 0.5) * 2 + 0.05 * (ring(t, 13, seed + 50 + k) - 0.5) * 2;
    const ledge = 0.35 + 0.9 * hash(k, seed, 7), PR = PROFILE_R, t0 = PROFILE_T[k], t1 = PROFILE_T[k + 1], r0 = PR[k], r1 = PR[k + 1];
    const tone = mix3(mix3(ROCK_TOP, ROCK_MID, smooth(0, 0.45, t0)), ROCK_LOW, smooth(0.35, 1, t0)), j = (0.94 + 0.12 * hash(k, seed, 8)) / ROCK_TOP[0] * 0.8;
    const c: V3 = [tone[0] * j, tone[1] * j, tone[2] * j];
    const face = (u: number) => (t: number) => R * outline(t) * (r0 + (r1 - r0) * Math.pow(u, 0.8)) * wob(t);
    rows.push(k === 0 ? {dd: 2.2, frac: false, r: face(0), c, m: ROCK} : {dd: t0, frac: true, r: t => face(0)(t) - ledge, c, m: ROCK});
    rows.push({dd: t0 + (t1 - t0) * 0.45, frac: true, r: face(0.45), c, m: ROCK}, {dd: t1 - (t1 - t0) * 0.05, frac: true, r: face(0.95), c, m: ROCK});
  }
  const U = rows.length + 1, ub = b.pos.length / 3, rimBase = base + 1 + (K - 1) * M;
  for (let i = 0; i < M; i++) {
    const t = (i / M) * Math.PI * 2, D = depth(t), s = t * R;
    for (let j = 0; j < U; j++) {
      const last = j === U - 1, row = rows[Math.min(j, rows.length - 1)];
      const dd = last ? D * 1.02 : row.frac ? row.dd * D : row.dd, y = ty - 0.5 - dd, f = dd / D;
      let r = last ? 0 : row.r(t);
      // Grain on the faces: ribs and bulges within a band.
      if (row.m === ROCK && !last) r += 1.2 * (vn(s / 6, y / 9, seed + 8) - 0.5) * Math.min(1, r / 3);
      r = Math.max(0, r);
      const sx = Math.sin(lean) * leanR * Math.pow(f, 1.5), sz = Math.cos(lean) * leanR * Math.pow(f, 1.5);
      b.v(cx + sx + Math.sin(t) * r, y, cz + sz + Math.cos(t) * r, row.c, row.m);
    }
  }
  for (let i = 0; i < M; i++) {
    const n = (i + 1) % M;
    b.quad(rimBase + i, rimBase + n, ub + i * U, ub + n * U);
    for (let j = 0; j < U - 1; j++) b.quad(ub + i * U + j, ub + n * U + j, ub + i * U + j + 1, ub + n * U + j + 1);
  }
  if (isle.rock) return;
  // Roots under the rim.
  for (let k = 0; k < Math.round(R * 1.6); k++) {
    // They drop from under the overhang, clear of the strata faces that step in below it, and sway as they hang.
    const t = hash(k, seed, 9) * Math.PI * 2, ro = R * outline(t) * 1.07 + 0.25, len = 2 + hash(k, seed, 10) * Math.min(R * 0.5, depth(t) * 0.4), n = 7;
    const pts: V3[] = [], radii: number[] = [], r0 = 0.08 + hash(k, seed, 11) * 0.14;
    for (let q = 0; q < n; q++) {
      const d = 0.8 + (len * q) / (n - 1), u = q / (n - 1), sw = Math.sin(q * 0.9 + k * 2.3) * 0.5 * u, rr = ro + r0 - 0.4 * u;
      pts.push([cx + Math.sin(t) * rr + Math.cos(t) * sw, ty - 0.5 - d, cz + Math.cos(t) * rr - Math.sin(t) * sw]);
      radii.push(r0 * (1 - 0.8 * u));
    }
    const c = hash(k, seed, 12) < 0.4 ? VINE : ROOT;
    b.tube(pts, radii, 4, () => c);
  }
  // Trees: pale silver trunks, teal-to-jade canopy masses, blossom on some isles.
  for (let k = 0; k < isle.trees; k++) {
    const a = hash(k, seed, 13) * Math.PI * 2, rr = R * (k === 0 ? 0.15 : 0.35 + 0.35 * hash(k, seed, 14)), x = cx + Math.sin(a) * rr, z = cz + Math.cos(a) * rr;
    const y = topY(x, z, rr / R), h = (6 + hash(k, seed, 15) * 5) * Math.min(1.25, 0.55 + R / 40), lean = (hash(k, seed, 16) - 0.5) * 0.25;
    const pts: V3[] = [], radii: number[] = [];
    for (let q = 0; q <= 6; q++) { const u = q / 6; pts.push([x + Math.sin(a) * lean * h * u * u, y - 0.4 + h * u, z + Math.cos(a) * lean * h * u * u]); radii.push(h * 0.06 * (1.6 - u) * (q === 0 ? 1.4 : 1)); }
    b.tube(pts, radii, 7, (q, s) => mix3(BARK, BARK_DARK, 0.3 * (1 - q / 6) + 0.25 * hash(q, s, seed)));
    // A full crown: one big mass over the trunk and a ring of smaller ones hanging lower, lit top, deep teal under.
    const top = pts[6], cr = h * 0.4, blooms = isle.blossom && k % 2 === 0, masses = 7;
    for (let m = 0; m < masses; m++) {
      const ma = m * 2.4 + a, mr = m === 0 ? 0 : cr * (0.7 + 0.2 * hash(m, k, seed + 2)), sc = cr * (m === 0 ? 1.05 : 0.55 + 0.2 * hash(m, k, seed));
      const mx = top[0] + Math.sin(ma) * mr, my = top[1] + (m === 0 ? cr * 0.2 : -cr * 0.35 + hash(m, k, seed + 1) * cr * 0.45), mz = top[2] + Math.cos(ma) * mr;
      const mtx = new THREE.Matrix4().compose(new THREE.Vector3(mx, my, mz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ma, 0)), new THREE.Vector3(sc, sc * 0.78, sc));
      const tone = blooms && m % 2 ? BLOSSOM[(m + k) % 3] : CANOPY[(m + k) % 3];
      b.place(crown, mtx, (px, py, pz, ny) => mix3(mix3(tone, CANOPY[0], blooms && m % 2 ? 0.15 : 0), [tone[0] * 0.42, tone[1] * 0.55, tone[2] * 0.62], sat(0.45 - ny * 0.75) * (0.75 + 0.25 * vn(px * 1.3, pz * 1.3, py))), PAINT);
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
  // Two or three pendant lobes off the low end, on the side the underside already leans to: no single point.
  for (let k = 0; k < 2 + Math.round(hash(seed, 24)); k++) {
    // Each one bulges out of the face where the profile has narrowed, so it shows on the silhouette.
    const a = lean + (k - 1) * 1.9 + (hash(k, seed, 25) - 0.5) * 0.6, D = depth(a), f = 0.62 + 0.26 * hash(k, seed, 27), dd = D * f;
    const rr = R * outline(a) * profileAt(f) * 0.85, rad = R * (0.14 + 0.07 * hash(k, seed, 28));
    const px = cx + Math.sin(lean) * leanR * Math.pow(f, 1.5) + Math.sin(a) * rr, pz = cz + Math.cos(lean) * leanR * Math.pow(f, 1.5) + Math.cos(a) * rr;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(px, ty - 0.5 - dd, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler((hash(k, seed, 29) - 0.5) * 0.4, a, 0)), new THREE.Vector3(rad, rad * 2.1, rad * 0.9));
    const c = mix3(ROCK_MID, ROCK_LOW, 0.7), j = 0.8 / ROCK_TOP[0];
    b.place(blob, m, () => [c[0] * j, c[1] * j, c[2] * j], ROCK);
  }
  for (const ft of isle.falls ?? []) {
    // An isle's spring is small: it pours off the lip, widens and is lost in spray long before the clouds.
    const ro = R * outline(ft) * 1.02, y = ty - 0.9;
    falls.push({p: [cx + Math.sin(ft) * ro, y, cz + Math.cos(ft) * ro], dir: [Math.sin(ft), 0, Math.cos(ft)], w: Math.max(2.4, R * 0.17), len: Math.min(y - CLOUD_TOP, 12 + R * 0.9)});
  }
}

const LAND_VERT_PARS = /* glsl */ `
attribute float aMat;
varying float vMat;
varying vec3 vWPos;
varying vec3 vWNormal;
`;
const LAND_FRAG_PARS = /* glsl */ `
uniform float cloudTop;
uniform vec3 mistColor;
uniform vec3 cloudBounce;
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
function landMaterial(mist: THREE.Color, bounce: THREE.Color): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.92, metalness: 0, name: 'skybloom-land'});
  const uniforms = {cloudTop: {value: CLOUD_TOP}, mistColor: {value: mist}, cloudBounce: {value: bounce}};
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
    // Bedded sandstone: the strata hue is in the vertex colour (cream high, cool low); each warped bed only shifts
    // it a little (a value step of about 6 percent, a hint of rose or grey), with a dark seam under its overhang.
    float warp=lNoise(wp*.045)*7.+lNoise(wp*.21)*1.3;
    // Beds thicken and thin along the cliff (a warp on the bed index, not on the thickness, so they never fold).
    float yy=(wp.y+warp)/3.2+.8*lNoise(vec3(wp.xz*.012,wp.y*.05)),bed=floor(yy),f=fract(yy);
    float hsh=lHash(vec3(bed,3.1,7.7));
    vec3 c=vec3(1.)*(.9+.14*hsh)*mix(vec3(1.),hsh<.3?vec3(1.04,.97,.93):hsh>.8?vec3(.95,.97,1.04):vec3(1.),.8);
    c*=.88+.2*grain;
    float seam=smoothstep(.0,.07,f)*smoothstep(1.,.9,f);
    c*=.84+.16*seam;
    // Moss and grass on shelves, damp streaks running down from them.
    float up=smoothstep(.42,.82,vWNormal.y);
    float streak=smoothstep(.55,.85,lNoise(vec3(wp.x*.7,wp.y*.05,wp.z*.7)))*(1.-up)*.45;
    c=mix(c,vec3(.32,.46,.26),max(up*smoothstep(.45,.7,lNoise(wp*.6)+.1),streak*.5));
    // A sunlit ledge top reads as a bright line along the bed: that line is what makes the strata legible.
    c*=1.+.18*up*(1.-smoothstep(.45,.7,lNoise(wp*.6)+.1));
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
      .replace('#include <lights_fragment_end>', /* glsl */ `#include <lights_fragment_end>
  // The cloud sea below lights every downward and sideways face (cloud albedo is high): undersides read pale, never
  // a dark dish. Rock only; the grass caps keep their own sky and meadow fill.
  reflectedLight.indirectDiffuse+=diffuseColor.rgb*cloudBounce*clamp(.5-.5*vWNormal.y,0.,1.)*step(.5,vMat);`)
      .replace('#include <fog_fragment>', /* glsl */ `
  // Rock sinking into the cloud tops turns to cloud shade: a band where it is swallowed, broken by slow noise.
  float sink=smoothstep(cloudTop+12.,cloudTop-5.,vWPos.y)*(.75+.25*lNoise(vec3(vWPos.xz*.06,1.7)));
  gl_FragColor.rgb=mix(gl_FragColor.rgb,mistColor,sink);
  #include <fog_fragment>`);
  };
  m.customProgramCacheKey = () => 'skybloom-land-2';
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
/**
 * A fall is one ribbon that widens as it drops (geometry) and comes apart (here): a glassy sheet off the lip, then
 * ropes of white water combed by two scales of scrolling noise on an accelerating flow coordinate (v^0.6), tearing
 * into spray that thins to nothing; never a solid line top to bottom (refs-w6-sky 3.3).
 */
const FALL_FRAG = /* glsl */ `
uniform float time;
uniform float cloudTop;
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
  float v=vUv.y,flow=pow(v,.6)*vLen;
  float big=fNoise(vec2(vUv.x*5.,flow*.07-time*.9));
  float fine=fNoise(vec2(vUv.x*17.,flow*.3-time*3.1));
  float s=big*.6+fine*.4;
  float edge=smoothstep(0.,.22,vUv.x)*smoothstep(1.,.78,vUv.x);
  // Sheet near the lip, ropes in the middle, spray at the end: the mask's threshold climbs as it falls.
  float rope=smoothstep(.25+.35*v,.55+.3*v,s+.15*(1.-edge));
  float body=mix(1.,rope,smoothstep(.04,.35,v))*mix(edge,sqrt(edge),v);
  // Cyan water between white ropes up top, all white spray low down: the colour, not just the alpha, reads as water.
  vec3 col=mix(waterColor,foamColor,clamp(.12+.85*smoothstep(.4,.78,s)+v*.55,0.,1.));
  // Lip: a bright glassy curl.
  col=mix(col,foamColor*1.15,1.-smoothstep(0.,.05,v));
  float a=body*(1.-smoothstep(.5,1.,v))*.9;
  // Where it meets the cloud tops it turns to the cloud's own shade.
  float mist=smoothstep(cloudTop+16.,cloudTop-4.,vY);
  col=mix(col,mistColor,max(mist,smoothstep(.55,1.,v)*.5));
  gl_FragColor=vec4(col,a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

function fallsGeometry(falls: {p: V3; dir: V3; w: number; len: number}[]): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], len: number[] = [], idx: number[] = [];
  const N = 22, C = 5;
  for (const f of falls) {
    const base = pos.length / 3, side: V3 = [-f.dir[2], 0, f.dir[0]];
    for (let j = 0; j <= N; j++) {
      // It shoots out a little off the lip and fans to about 2.4 times its width at the end.
      const u = j / N, drop = f.len * u, out = f.w * 0.5 * Math.sqrt(u) + u * f.len * 0.05, w = f.w * (1 + 1.4 * Math.pow(u, 1.2));
      for (let i = 0; i <= C; i++) {
        const v = i / C - 0.5, bow = (1 - 4 * v * v) * 0.3 * w;
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
  // aPuff.w: size in whole metres plus a 0..1 seed.
  float seed=fract(aPuff.w),size=floor(aPuff.w);
  vUv=uv;vSeed=seed;
  vec3 c=aPuff.xyz+vec3(sin(time*.05+seed*9.)*2.,sin(time*.08+seed*5.)*.8,0.)*min(1.,size/12.);
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

export function skybloomLand(colors: {mist: THREE.Color; cloudLit: THREE.Color; bounce: THREE.Color}): SkybloomLand {
  const b = new Builder(), falls: {p: V3; dir: V3; w: number; len: number}[] = [];
  buildSkirt(b, falls);
  const blob = blobTemplate(2), block = blockTemplate();
  const crown = crownTemplate();
  for (const isle of SKY_ISLES) buildIsle(b, isle, blob, crown, block, falls);
  const land = new THREE.Mesh(b.geometry(), landMaterial(colors.mist, colors.bounce));
  land.name = 'skybloom-cliffs-and-isles';
  // Below the grass and far off: no shadow pass for it (the island's sun box covers only the play area).
  land.castShadow = false; land.receiveShadow = false;
  const time = {value: 0};
  const fallMat = new THREE.ShaderMaterial({
    name: 'skybloom-waterfall', vertexShader: FALL_VERT, fragmentShader: FALL_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {time: {value: 0}, cloudTop: {value: CLOUD_TOP}, waterColor: {value: new THREE.Color('#7fd6e6')}, foamColor: {value: new THREE.Color('#f4fbff').multiplyScalar(1.1)}, mistColor: {value: colors.mist}}]),
  });
  fallMat.uniforms.time = time;
  const fallMesh = new THREE.Mesh(fallsGeometry(falls), fallMat);
  fallMesh.name = 'skybloom-waterfalls';
  // Mist: at each fall's foot and in a broken ring where the cliff meets the cloud tops.
  const puffs: number[] = [];
  // Spray where each fall gives out: a few soft puffs sized to the fall, drifting.
  falls.forEach((f, k) => {
    const end = f.w * 2.4, out = f.w * 0.5 + f.len * 0.05;
    for (let i = 0; i < 4; i++) puffs.push(f.p[0] + f.dir[0] * (out + i * 0.6) + (hash(i, k, 30) - 0.5) * end, f.p[1] - f.len * (0.78 + 0.08 * i), f.p[2] + f.dir[2] * (out + i * 0.6) + (hash(i, k, 31) - 0.5) * end, Math.round(end * (1.1 + 0.5 * hash(i, k, 33))) + hash(i, k, 32));
  });
  // Two broken rings hug the cliff foot so the rock sinks into billows instead of ending on a line.
  for (let i = 0; i < 170; i++) {
    const t = (i / 170) * Math.PI * 2 + hash(i, 33) * 0.04, l = skyLip(t), o = -14 + hash(i, 34) * 16 + (i % 2) * 8;
    puffs.push(l.x + l.nx * o, CLOUD_TOP - 6 + hash(i, 35) * 10 + (i % 2) * 5, l.z + l.nz * o, 14 + Math.floor(hash(i, 37) * 16) + hash(i, 36));
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
