import * as THREE from 'three';
import {SNOW_WIND} from '../sim/world/snowGround';
import {FROST_NOISE} from './frostPaving';

/*
 * Dressed granite for Frostlight's story architecture (Boreas's throne, the glacial citadel, the standing stones).
 * Every block is its own prism with a chamfered face, a tint, a set and a lean of its own, laid in courses over a
 * dark mortar core so the joints read, and shaded by the arena rim's granite (frostPaving.ts graniteMaterial:
 * vertex colour, a frost line over `aGround`, snow on the tops by `aSnow`). masonryMaterial() adds what a winter
 * on the north cliff leaves: snow lodged on every ledge and upper chamfer, so the courses read; rime feathered on
 * the windward faces, heavier up high; and glazed meltwater runs down from the joints.
 * So a wall never reads as one repeated tile: every stone its own value and hue (iron-stained, pale, dark), thin and
 * tall courses among the common ones, long stones and short, some slots laid as two stacked stones, long-and-short
 * quoins at the corners; the joints packed with frost and snow in drifts, damp low on the wall, lichen in places.
 */

export type V3 = [number, number, number];
/** Maps block-local (u along the face, v up, t into the wall from the face) to world space. */
export type Warp = (u: number, v: number, t: number) => V3;

export interface BlockOpts {
  /** Chamfer on the four face edges, metres. */
  bevel?: number;
  /** Face subdivisions along u, for curved warps. */
  seg?: number;
  tint?: V3;
  /** Also close the back and bottom (free-standing pieces). */
  closed?: boolean;
  /** Also lay it, plain, in the far mason (a silhouette piece: merlons, the throne). */
  far?: boolean;
}

/** Straight face: origin, unit direction along it, and the outward normal (horizontal). */
export function planeWarp(ox: number, oz: number, ax: number, az: number): Warp {
  // Outward normal is the along-direction turned a quarter to the right (looking down, +x east, +z south).
  const nx = az, nz = -ax;
  return (u, v, t) => [ox + ax * u - nx * t, v, oz + az * u - nz * t];
}

/** Round face: centre, outer radius; u runs clockwise seen from above starting at angle a0 (0 = +z). */
export function ringWarp(cx: number, cz: number, r: number, a0 = 0): Warp {
  return (u, v, t) => { const a = a0 + u / r, rr = r - t; return [cx + Math.sin(a) * rr, v, cz + Math.cos(a) * rr]; };
}

export class Masonry {
  private pos: number[] = [];
  private col: number[] = [];
  private gnd: number[] = [];
  private snw: number[] = [];
  private crs: number[] = [];
  private idx: number[] = [];
  blocks = 0;
  /**
   * The far version of what this mason lays: each course run as one slab whose joints the shader draws (`aCourse`),
   * merlons and other silhouette pieces as plain boxes. Swapped in by a THREE.LOD past a hundred metres.
   */
  far: Masonry | null = null;
  /** 1 for a far mason: the shader cuts the courses and joints into its slabs. */
  course = 0;
  /** Ground height for the frost line and how much snow the tops hold, for what is laid next. */
  ground = 0;
  snow = .3;
  /**
   * The mason's own choices (course heights, splits, quoins), from a stream of their own: `rand` sees the same calls
   * in the same order as before, so whatever else draws from it (the camps' logs, the prison) stays where it was.
   */
  private q: () => number;
  constructor(readonly rand: () => number, salt = 0) {
    let s = (40503 + salt * 977) >>> 0;
    this.q = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  }

  /** Blue-grey granite, every stone its own; `k` darkens (mortar, recesses) or lightens. */
  tint(k = 1, rng: () => number = this.rand): V3 {
    // Blue in albedo: the low amber sun brings it back to a cold grey, the shade keeps it slate. Three draws, as ever:
    // the first picks the stone (iron-stained, cold slate, the common grey), the second a pale or a dark one.
    const r = rng, a = r(), b = r(), c = r();
    const warm = a < .12 ? .004 + a * .04 : 0, cold = a > .86 ? .005 : 0;
    const v = b < .14 ? 1.42 : b > .9 ? .62 : .82 + (b - .14) * .45;
    const g = (.034 + c * .032) * v;
    return [(g + warm * 1.4 - .005 - cold) * k, (g + .006 + warm * .35) * k, (g + .03 - warm + cold * .6) * k];
  }

  private vert(p: V3, tint: V3): number {
    this.pos.push(p[0], p[1], p[2]); this.col.push(tint[0], tint[1], tint[2]); this.gnd.push(this.ground); this.snw.push(this.snow); this.crs.push(this.course);
    return this.pos.length / 3 - 1;
  }

  /** True when a-b-c winds away from `centre` (the warps can mirror, so every face checks). */
  private outward(a: V3, b: V3, c: V3, centre: V3): boolean {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (a[0] + b[0] + c[0]) / 3 - centre[0], my = (a[1] + b[1] + c[1]) / 3 - centre[1], mz = (a[2] + b[2] + c[2]) / 3 - centre[2];
    return nx * mx + ny * my + nz * mz >= 0;
  }

  tri(a: V3, b: V3, c: V3, tint: V3, centre: V3): void {
    const i = this.vert(a, tint), j = this.vert(b, tint), k = this.vert(c, tint);
    if (this.outward(a, b, c, centre)) this.idx.push(i, j, k); else this.idx.push(i, k, j);
  }

  /** A planar quad as four shared corners (indexed: two thirds of the vertices of two loose triangles). */
  quad(a: V3, b: V3, c: V3, d: V3, tint: V3, centre: V3): void {
    const i = this.vert(a, tint), j = this.vert(b, tint), k = this.vert(c, tint), l = this.vert(d, tint);
    if (this.outward(a, b, c, centre)) this.idx.push(i, j, k, i, k, l); else this.idx.push(i, k, j, i, l, k);
  }

  /** One dressed block: u0..u0+w along, v0..v0+h up, t0..t0+d deep; the face at t0 is chamfered. */
  block(warp: Warp, u0: number, v0: number, t0: number, w: number, h: number, d: number, o: BlockOpts = {}): void {
    const b = Math.min(o.bevel ?? .07, w * .3, h * .3, d * .3), seg = o.seg ?? 1, tint = o.tint ?? this.tint();
    const u1 = u0 + w, v1 = v0 + h, t1 = t0 + d;
    const c = warp(u0 + w / 2, v0 + h / 2, t0 + d / 2);
    const P = (u: number, v: number, t: number) => warp(u, v, t);
    for (let i = 0; i < seg; i++) {
      const a = u0 + w * i / seg, e = u0 + w * (i + 1) / seg;
      // The chamfer pulls in at both ends only on the end columns.
      const fa = i === 0 ? a + b : a, fe = i === seg - 1 ? e - b : e;
      this.quad(P(fa, v0 + b, t0), P(fe, v0 + b, t0), P(fe, v1 - b, t0), P(fa, v1 - b, t0), tint, c);
      this.quad(P(fa, v1 - b, t0), P(fe, v1 - b, t0), P(e, v1, t0 + b), P(a, v1, t0 + b), tint, c);
      this.quad(P(fa, v0 + b, t0), P(fe, v0 + b, t0), P(e, v0, t0 + b), P(a, v0, t0 + b), tint, c);
      this.quad(P(a, v1, t0 + b), P(e, v1, t0 + b), P(e, v1, t1), P(a, v1, t1), tint, c);
      if (o.closed) { this.quad(P(a, v0, t0 + b), P(e, v0, t0 + b), P(e, v0, t1), P(a, v0, t1), tint, c); this.quad(P(a, v0, t1), P(e, v0, t1), P(e, v1, t1), P(a, v1, t1), tint, c); }
    }
    this.quad(P(u0 + b, v0 + b, t0), P(u0 + b, v1 - b, t0), P(u0, v1, t0 + b), P(u0, v0, t0 + b), tint, c);
    this.quad(P(u1 - b, v0 + b, t0), P(u1 - b, v1 - b, t0), P(u1, v1, t0 + b), P(u1, v0, t0 + b), tint, c);
    this.quad(P(u0, v0, t0 + b), P(u0, v1, t0 + b), P(u0, v1, t1), P(u0, v0, t1), tint, c);
    this.quad(P(u1, v0, t0 + b), P(u1, v1, t0 + b), P(u1, v1, t1), P(u1, v0, t1), tint, c);
    this.blocks++;
    if (o.far && this.far) { const f = this.far; f.ground = this.ground; f.snow = this.snow; f.slab(warp, u0, v0, t0, w, h, d, tint, seg, o.closed ? 63 : 1 | 4 | 16 | 32); }
  }

  /** Plain box in warp space (a core, a slab), every face, no chamfer. */
  slab(warp: Warp, u0: number, v0: number, t0: number, w: number, h: number, d: number, tint: V3, seg = 1, faces = 63): void {
    const u1 = u0 + w, v1 = v0 + h, t1 = t0 + d, c = warp(u0 + w / 2, v0 + h / 2, t0 + d / 2), P = warp;
    for (let i = 0; i < seg; i++) {
      const a = u0 + w * i / seg, e = u0 + w * (i + 1) / seg;
      if (faces & 1) this.quad(P(a, v0, t0), P(e, v0, t0), P(e, v1, t0), P(a, v1, t0), tint, c);
      if (faces & 2) this.quad(P(a, v0, t1), P(e, v0, t1), P(e, v1, t1), P(a, v1, t1), tint, c);
      if (faces & 4) this.quad(P(a, v1, t0), P(e, v1, t0), P(e, v1, t1), P(a, v1, t1), tint, c);
      if (faces & 8) this.quad(P(a, v0, t0), P(e, v0, t0), P(e, v0, t1), P(a, v0, t1), tint, c);
    }
    if (faces & 16) this.quad(P(u0, v0, t0), P(u0, v1, t0), P(u0, v1, t1), P(u0, v0, t1), tint, c);
    if (faces & 32) this.quad(P(u1, v0, t0), P(u1, v1, t0), P(u1, v1, t1), P(u1, v0, t1), tint, c);
  }

  /** The draws base147's plain running bond took from `rand` for this face (mortar, courses, stones), and no more. */
  private spendPlain(u0: number, u1: number, v0: number, v1: number, o: {len?: number; course?: number; skip?: (u: number, v: number) => boolean}): void {
    const r = this.rand, len = o.len ?? 1.7, course = o.course ?? .95, tint = () => { r(); r(); r(); };
    tint();
    for (let v = v0; v < v1 - .05;) {
      let h = course * (.82 + r() * .36);
      if (v1 - (v + h) < course * .5) h = v1 - v;
      for (let u = u0 - r() * len * .6; u < u1 - .02;) {
        let w = len * (.6 + r() * .8);
        const a = Math.max(u, u0), e = Math.min(u + w, u1);
        if (u1 - e < len * .3) w = u1 - u;
        const ee = Math.min(u + w, u1);
        if (!o.skip?.(a + (ee - a) / 2, v + h / 2) && ee - a > .25) { r(); r(); tint(); }
        u += w;
      }
      v += h;
    }
  }

  /**
   * Courses of blocks over a mortar core on the face u0..u1, v0..v1 (running bond). `len` is the mean block length,
   * `course` the mean course height; `skip(u, v)` leaves a block out (an opening). Returns the course tops.
   */
  face(warp: Warp, u0: number, u1: number, v0: number, v1: number, o: {len?: number; course?: number; depth?: number; core?: number; curve?: number; skip?: (u: number, v: number) => boolean; quoins?: number} = {}): number[] {
    // `rand` is drawn exactly as the plain running bond drew it (spendPlain), so whatever draws from the same stream
    // after the wall (the citadel's ice, the camps' logs, the prison's bars) stays where it was; the wall itself is
    // laid from the mason's own stream.
    this.spendPlain(u0, u1, v0, v1, o);
    const q = this.q, r = q, len = o.len ?? 1.7, course = o.course ?? .95, depth = o.depth ?? .55, gap = .055;
    const tops: number[] = [];
    // The mortar a few centimetres behind the faces, seen only in the joints (aCourse 2: the shader packs frost in it).
    const core = (o.core ?? 1) > 0, mortar = this.tint(.32, q);
    const joint = (fn: () => void) => { const c = this.course; this.course = 2; fn(); this.course = c; };
    const segs = (a: number, ee: number) => o.curve ? Math.max(1, Math.ceil((ee - a) / o.curve)) : 1;
    if (this.far) { const f = this.far; f.ground = this.ground; f.snow = this.snow; f.slab(warp, u0, v0, 0, u1 - u0, v1 - v0, depth, f.tint(1.05), Math.max(1, Math.ceil((u1 - u0) / (o.curve ? 1.4 : 1e9))), 1 | 4); }
    if (core && !o.skip) joint(() => this.slab(warp, u0, v0, .14, u1 - u0, v1 - v0, depth, mortar, Math.max(1, Math.ceil((u1 - u0) / (o.curve ?? 1e9))), 1));
    const lay = (a: number, ee: number, v: number, h: number, set: number, bevel: number, tint?: V3) => {
      const seg = segs(a, ee);
      this.block(warp, a + gap / 2, v + gap / 2, set, ee - a - gap, h - gap, depth, {bevel, seg, tint: tint ?? this.tint(1, q)});
      // With openings the mortar goes behind each block alone, so the openings stay open.
      if (core && o.skip) joint(() => this.slab(warp, a, v, .14, ee - a, h, depth, mortar, seg, 1));
    };
    /** One stone in a slot: now and then laid as two stacked stones of their own, so the courses do not run on. */
    const stone = (a: number, ee: number, v: number, h: number, set: number, bevel: number) => {
      if (h > course * .8 && ee - a < len * 1.3 && q() < .13) {
        const k = .42 + q() * .16, h0 = h * k, seg = segs(a, ee);
        this.block(warp, a + gap / 2, v + gap / 2, set, ee - a - gap, h0 - gap, depth, {bevel: bevel * .8, seg, tint: this.tint(1, q)});
        this.block(warp, a + gap / 2, v + h0 + gap / 2, set + (q() - .5) * .03, ee - a - gap, h - h0 - gap, depth, {bevel: bevel * .8, seg, tint: this.tint(1, q)});
        if (core && o.skip) joint(() => this.slab(warp, a, v, .14, ee - a, h, depth, mortar, seg, 1));
      } else lay(a, ee, v, h, set, bevel);
    };
    /** Through stones: a stone of one course run up through the next, so no bed joint runs the wall's whole length. */
    type Through = {a: number; ee: number; v: number; h: number; set: number; bevel: number; tint: V3};
    let through: Through[] = [];
    let v = v0, n = 0;
    while (v < v1 - .05) {
      // Mostly common courses, some thin, some tall: the rows of a wall built over generations.
      const kc = q();
      let h = course * (.82 + r() * .36) * (kc < .16 ? .62 : kc > .86 ? 1.36 : 1);
      if (v1 - (v + h) < course * .5) h = v1 - v;
      // The stones held over from the course below rise through this one (unless an opening would cut them).
      const below = through; through = [];
      for (const t of below) {
        if (o.skip?.((t.a + t.ee) / 2, v + h / 2)) { lay(t.a, t.ee, t.v, t.h, t.set, t.bevel, t.tint); continue; }
        lay(t.a, t.ee, t.v, t.h + h, t.set, t.bevel, t.tint);
      }
      const held = below.filter(t => !o.skip?.((t.a + t.ee) / 2, v + h / 2));
      const last = v1 - (v + h) < course * .6;
      let u = u0 - r() * len * .6;
      // Long-and-short quoins: the end stones alternate course by course, paler, dressed and a little proud.
      let uEnd = u1;
      if (o.quoins) {
        const qa = o.quoins * (n % 2 ? 1.35 : .72), qb = o.quoins * (n % 2 ? .72 : 1.35), qt = this.tint(1.22, q);
        if (!o.skip?.(u0 + qa / 2, v + h / 2)) { this.block(warp, u0 + gap / 2, v + gap / 2, -.035, qa - gap, h - gap, depth, {bevel: .06, tint: qt}); if (core && o.skip) joint(() => this.slab(warp, u0, v, .14, qa, h, depth, mortar, 1, 1)); }
        if (!o.skip?.(u1 - qb / 2, v + h / 2)) { this.block(warp, u1 - qb + gap / 2, v + gap / 2, -.035, qb - gap, h - gap, depth, {bevel: .06, tint: qt}); if (core && o.skip) joint(() => this.slab(warp, u1 - qb, v, .14, qb, h, depth, mortar, 1, 1)); }
        u = u0 + qa; uEnd = u1 - qb;
      }
      while (u < uEnd - .02) {
        const kw = q();
        let w = len * (.6 + r() * .8) * (kw < .14 ? .55 : kw > .84 ? 1.5 : 1);
        const e = Math.min(u + w, uEnd);
        if (uEnd - e < len * .3) w = uEnd - u;
        let a = Math.max(u, u0), ee = Math.min(u + w, uEnd);
        if (!o.skip?.(a + (ee - a) / 2, v + h / 2) && ee - a > .25) {
          const set = (r() - .5) * .05, bevel = .05 + r() * .05;
          // Cut round a through stone from the course below: the part on its left keeps this slot's draws, a part on
          // its right is a stone of its own.
          const hit = held.find(t => t.a < ee - .02 && t.ee > a + .02);
          if (hit) {
            const left = hit.a - a, right = ee - hit.ee, tint = this.tint(1, q);
            if (left > .3) lay(a, hit.a, v, h, set, bevel, tint);
            if (right > .3) lay(hit.ee, ee, v, h, set + (q() - .5) * .03, bevel, left > .3 ? this.tint(1, q) : tint);
          } else if (!last && n > 0 && h > course * .75 && ee - a < len * 1.25 && a > u0 + .2 && ee < uEnd - .2 && q() < .11) {
            through.push({a, ee, v, h, set, bevel, tint: this.tint(1, q)});
          } else stone(a, ee, v, h, set, bevel);
        }
        u += w;
      }
      v += h; tops.push(v); n++;
    }
    for (const t of through) lay(t.a, t.ee, t.v, t.h, t.set, t.bevel, t.tint);
    return tops;
  }

  /**
   * A rough-hewn standing stone: eight faces, each ring's corners knocked in or out, tapering to a blunt crown.
   * Its front face (toward nx, nz) stays flat and true, for the runes cut into it. Returns that face's depth.
   */
  menhir(x: number, z: number, y: number, h: number, w: number, d: number, nx: number, nz: number, lean: number): number {
    const r = this.rand, tint = this.tint(), tx = -nz, tz = nx;
    const rings = [[-.5, 1.04], [.15, 1], [.4, .97], [.68, .9], [.86, .74], [.97, .42]] as const;
    // Octagon corners in the stone's frame: across (a) and toward the front (b).
    const corner = (k: number) => { const a = (k + .5) / 8 * Math.PI * 2; return [Math.sin(a) * w / 2 * 1.08, Math.cos(a) * d / 2 * 1.08] as const; };
    const front = new Set([0, 7]);
    const pts = rings.map(([f, k], ri) => Array.from({length: 8}, (_, c) => {
      const [a, b] = corner(c), j = front.has(c) && ri < 5 ? 1 : 1 + (r() - .5) * .22, yy = y + (f < 0 ? f : f * h) + (ri > 3 ? (r() - .5) * .12 : 0);
      const ly = Math.max(0, yy - y);
      return [x + tx * a * k * j + nx * (b * k * j + lean * ly), yy, z + tz * a * k * j + nz * (b * k * j + lean * ly)] as V3;
    }));
    const c: V3 = [x, y + h * .45, z];
    for (let ri = 0; ri < rings.length - 1; ri++) for (let k = 0; k < 8; k++) { const k1 = (k + 1) % 8; this.quad(pts[ri][k], pts[ri][k1], pts[ri + 1][k1], pts[ri + 1][k], tint, c); }
    const top = pts[rings.length - 1], apex: V3 = [x + (r() - .5) * w * .1 + nx * lean * h, y + h * (1 + r() * .04), z + (r() - .5) * d * .1 + nz * lean * h];
    for (let k = 0; k < 8; k++) this.tri(top[k], top[(k + 1) % 8], apex, tint, c);
    this.blocks++;
    return d / 2 * 1.08 * Math.cos(Math.PI / 8);
  }

  /** A flat round cap facing up (tower floors, collar tops). */
  disc(x: number, y: number, z: number, r: number, n = 20, tint = this.tint(.9)): void {
    if (this.far) { this.far.ground = this.ground; this.far.snow = this.snow; this.far.disc(x, y, z, r, Math.max(8, n >> 1), tint); }
    const c: V3 = [x, y - 1, z];
    for (let i = 0; i < n; i++) {
      const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2;
      this.tri([x, y, z], [x + Math.sin(a0) * r, y, z + Math.cos(a0) * r], [x + Math.sin(a1) * r, y, z + Math.cos(a1) * r], tint, c);
    }
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aGround', new THREE.Float32BufferAttribute(this.gnd, 1));
    g.setAttribute('aSnow', new THREE.Float32BufferAttribute(this.snw, 1));
    g.setAttribute('aCourse', new THREE.Float32BufferAttribute(this.crs, 1));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** The granite of the arena rim (graniteMaterial) weathered for the citadel: lodged snow, windward rime, glaze. */
export function masonryMaterial(name: string): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({color: '#ffffff', vertexColors: true, roughness: .86});
  material.name = name;
  // The scene's environment map belongs to another world (as snowSurface.ts): the hemisphere light is the sky here.
  material.envMapIntensity = 0;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uMWind = {value: new THREE.Vector2(SNOW_WIND[0], SNOW_WIND[1])};
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGround;\nattribute float aSnow;\nattribute float aCourse;\nvarying float vMG;\nvarying float vMS;\nvarying float vMC;\nvarying vec3 vMW;\nvarying vec3 vMN;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvMG=aGround;vMS=aSnow;vMC=aCourse;vMW=(modelMatrix*vec4(transformed,1.)).xyz;vMN=normalize(mat3(modelMatrix)*objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FROST_NOISE}\nuniform vec2 uMWind;\nvarying float vMG;\nvarying float vMS;\nvarying float vMC;\nvarying vec3 vMW;\nvarying vec3 vMN;\nfloat mWhite;\nfloat mGlaze;`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        vec3 mNW=normalize(vMN),mA=abs(mNW)/(abs(mNW.x)+abs(mNW.y)+abs(mNW.z));
        #define M3(f,o) (fpNoise(vMW.zy*(f)+(o))*mA.x+fpNoise(vMW.xz*(f)+(o))*mA.y+fpNoise(vMW.xy*(f)+(o))*mA.z)
        float mN=M3(3.1,0.),mWind=dot(mNW.xz,-uMWind);
        // Broad mottling, dark and light grains up close (light: each stone's own tint has to carry the wall).
        diffuseColor.rgb*=.8+.28*(M3(.7,2.)*.5+.5);
        float mG1=M3(38.,5.)*.5+.5,mG2=M3(91.,9.)*.5+.5,mNear=1.-smoothstep(.004,.02,length(fwidth(vMW)));
        diffuseColor.rgb*=mix(1.,mix(1.,.55,smoothstep(.62,.8,mG1))*mix(1.,1.35,smoothstep(.66,.84,mG2)),mNear);
        // Far slabs: the courses and joints drawn, courses of uneven height (edges jittered by a quarter course),
        // stones of uneven length course by course, each its own value and hue, a line of snow on some courses.
        float mLodge=0.;
        if(vMC>.5&&vMC<1.5){
          vec2 mT=normalize(vec2(-mNW.z,mNW.x)+1e-4);
          #define MEDGE(k) ((k)+(fpHash12(vec2(k,4.1))-.5)*.5)
          float mY=(vMW.y-.37)/1.12,mCi=floor(mY),e0=MEDGE(mCi),e1=MEDGE(mCi+1.);
          if(mY<e0){mCi-=1.;e1=e0;e0=MEDGE(mCi);}else if(mY>=e1){mCi+=1.;e0=e1;e1=MEDGE(mCi+1.);}
          float mFy=(mY-e0)/(e1-e0),mBl=mix(1.4,2.9,fpHash12(vec2(mCi,8.3)));
          float mBx=(dot(vMW.xz,mT)+fpHash12(vec2(mCi,2.7))*mBl)/mBl,mBi=floor(mBx),mFx=fract(mBx);
          float mJ=(1.-smoothstep(0.,fwidth(mBx)*1.2+.03,min(mFx,1.-mFx))*smoothstep(0.,fwidth(mY)/(e1-e0)*1.2+.05,min(mFy,1.-mFy)))*(1.-abs(mNW.y));
          float mH1=fpHash12(vec2(mCi*1.7+3.,mBi)),mH2=fpHash12(vec2(mBi*.37+5.,mCi));
          vec3 mHue=mH2<.12?vec3(1.1,1.02,.91):mH2>.86?vec3(.94,.98,1.06):vec3(1.);
          diffuseColor.rgb*=mHue*(mH1<.14?1.38:mH1>.9?.64:.82+(mH1-.14)*.45)*mix(1.,.32,mJ);
          mLodge=smoothstep(.92,.98,mFy)*step(.72,fpHash12(vec2(mCi*3.1,mBi*7.7))+vMS*.3)*(1.-abs(mNW.y))*.4;
        }
        // The joints (the mortar behind the stones): frost packed into them in drifts across the wall, more to
        // windward and up high, dark elsewhere, so the joint grid never runs unbroken. The frost sits in the joint's
        // shade (grey, not white), and past a few metres the joint takes the stone's own value: from across the
        // arena a grid of light or dark lines is what reads as a repeated tile.
        float mJFar=smoothstep(.008,.035,length(fwidth(vMW)));
        if(vMC>1.5){
          float mPack=smoothstep(.5,.74,M3(.55,17.)*.5+.5+mWind*.16+(vMW.y-vMG)*.006)*(1.-mJFar);
          diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.15,.175,.22),mPack*.65);
          diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.026,.032,.048)*(.8+.4*(M3(.7,2.)*.5+.5)),mJFar*.85);
        }
        // Weather bigger than a stone, so no stretch of wall repeats: broad patches bleached or darkened, and long
        // stains run down the faces from the merlons and the slits, each its own length.
        float mAbove=vMW.y-vMG,mSide=1.-abs(mNW.y);
        vec2 mTw=normalize(vec2(-mNW.z,mNW.x)+1e-4);float mAlong=dot(vMW.xz,mTw);
        diffuseColor.rgb*=.76+.44*smoothstep(.15,.85,M3(.13,41.)*.5+.5);
        float mStain=smoothstep(.5,.8,fpNoise(vec2(mAlong*.7,vMW.y*.04+fpNoise(vec2(mAlong*.3,3.))*.4))*.5+.5)*smoothstep(.1,.7,fpNoise(vec2(mAlong*.7+9.,vMW.y*.09))*.5+.5);
        diffuseColor.rgb*=mix(vec3(1.),vec3(.56,.58,.6),mStain*mSide*step(vMC,1.5));
        // Damp low on the wall where the drift melts against it; lichen, ochre and rust, on the lee faces.
        diffuseColor.rgb*=mix(1.,.76,smoothstep(.0,.25,mAbove)*(1.-smoothstep(.4,2.4,mAbove+M3(1.1,23.)*.5))*mSide);
        float mLich=smoothstep(.76,.92,M3(.9,31.)*.5+.5+mN*.06)*mSide*smoothstep(-.3,.3,-mWind)*step(vMC,1.5);
        diffuseColor.rgb*=mix(vec3(1.),vec3(1.45,1.12,.6),mLich*.65);
        // Snow lodged on the tops and the upper chamfers, so every course carries a white line.
        float mUp=mNW.y+mN*.1;
        float mSnow=smoothstep(.45,.62,mUp)*smoothstep(.1,.4,fpNoise(vMW.xz*1.7+vMW.y*.9+7.)*.9+vMS-.52+mN*.25)*.85;
        mSnow=max(mSnow,smoothstep(.86,.95,mUp)*smoothstep(-.25,.25,vMS-.3+(M3(.45,4.)*.6+mN*.12)));
        // Rime feathered on the faces the wind meets, heavier up high; the lee stays dark.
        float mFeather=fpNoise(vec2(dot(vMW.xz,vec2(-uMWind.y,uMWind.x))*1.7,vMW.y*5.))*.5+.5;
        float mRime=smoothstep(.1,.75,mWind)*smoothstep(.5,.8,M3(.22,13.)*.5+.5+(mFeather-.5)*.25+(vMW.y-vMG)*.01-.08);
        float mFrost=(1.-smoothstep(0.,.03+mN*.012,vMW.y-vMG))*.8;
        // Meltwater glazed down the faces from the joints: darker, cooler, glossy.
        mGlaze=smoothstep(.62,.9,fpNoise(vec2((vMW.x+vMW.z)*1.9,vMW.y*.16+3.))*.6+fpNoise(vec2((vMW.x+vMW.z)*7.,vMW.y*.4))*.4)*(1.-abs(mNW.y));
        diffuseColor.rgb*=mix(vec3(1.),vec3(.72,.82,.95),mGlaze);
        mWhite=max(max(max(mSnow,mFrost),mRime*.6),mLodge);
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.84,.92,1.),mWhite);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=mix(mix(.88,.55,mGlaze),.92,mWhite);')
      // Weathered stone is dull: the low sun's sheen across a whole wall reads as tan plaster, not granite.
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.directSpecular*=mix(.3,.7,max(mGlaze,mWhite));')
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        {
          // Chisel marks: a small world-space bump, softened under snow and rime.
          #define MF(q) (fpNoise((q).zy*14.+1.)*mA.x+fpNoise((q).xz*14.+1.)*mA.y+fpNoise((q).xy*14.+1.)*mA.z)
          float e=.012,f0=MF(vMW);
          vec3 g=vec3(MF(vMW+vec3(e,0.,0.))-f0,MF(vMW+vec3(0.,e,0.))-f0,MF(vMW+vec3(0.,0.,e))-f0)/e;
          vec3 nW=inverseTransformDirection(normal,viewMatrix);
          g=(g-dot(g,nW)*nW)*.006*(1.-mWhite*.7);
          nW=normalize(nW-g);
          normal=normalize((viewMatrix*vec4(nW,0.)).xyz);
        }`);
  };
  material.customProgramCacheKey = () => 'frostlight-masonry';
  return material;
}
