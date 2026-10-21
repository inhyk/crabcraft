// night-staff: the undead's mage staff dressed for the close-ups. The game's pale driftwood shaft and
// prongs (tools/build_gear.py, weapon_staff) give way to gnarled dark wood on this actor's clone only:
// a twisted, knotted shaft with a bark shader (grain along the shaft, fissures, knots, a sickly green
// creeping down from the head); the grip wraps turn tarnished bronze; a few turns of dark cord under the
// head hold a loop of red prayer beads with a short tail, a big bead and a tassel, hanging on world-down.
//   actor    the actor id
//   bark     the bark's base colour; bark2 its fissures and knot cores; tint the green toward the head
//   ferrule  the grip wraps' colour (tarnished bronze); false keeps the game's
//   beads    { count, size, color, color2, glow, length, at, sway, swing, freq, damp, lag, turn, seed }
//            count beads on a dark cord (loop plus a tail of four; 24); size their radius in staff
//            lengths (0.011); color2 the darker few; glow their own faint red (0.12); length how far the
//            whole string hangs, in staff lengths (0.33); at where it hangs from, as a share of the
//            shaft's height (0.9, under the head); sway the idle swing in radians (0.1); swing
//            [[t, amp, deg?]...] kicks, each a swing of amp radians from t dying away (deg turns it round
//            world up from his left, 90 = ahead); freq rad/s (5.2) and damp 1/s (1.4) of the kicks; lag
//            seconds the bottom trails the top (0.22); turn the loop's face round world up (25 deg)
//   until    the game's staff again after this (default never)
// A pure function of the shot clock: the string hangs from its anchor along world-down, its sway a sum
// of sines plus the kicks, the lower beads lagging the upper ones; it is pushed out of the shaft and
// kept above the ground. Nothing carries between frames, so a seek renders any still faithfully.
import * as THREE from 'three';
import { mulberry, NOISE, num, registerEffect, type Effect, type FxContext } from '../fx';
import type { FxCue } from '../types';

type Unit = { name: string; yaw: number; rig: { gearMeshes: THREE.Object3D[] } };
type V = [number, number, number];

// The staff in its piece frame (tools/build_gear.py): the shaft is a cubic Bezier, the claw grips at
// y 0, three prongs cradle the orb at the head.
const SHAFT: V[] = [[0, -0.08, 0], [0.002, 0, 0.001], [-0.002, 0.1, 0], [0, 0.2, 0.002]];
const FOOT = -0.08;
const TOP = 0.252;
const HEIGHT = TOP - FOOT;
const R0 = 0.006;
const prong = (k: number): V[] => {
  const a = (k * 2 * Math.PI) / 3;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [[0, 0.195, 0], [0.016 * c, 0.21, 0.016 * s], [0.017 * c, 0.235, 0.017 * s], [0.006 * c, 0.252, 0.006 * s]];
};
const PRONG_R = [0.004, 0.003, 0.0025, 0.0012];

const bez = (p: V[], t: number, out: THREE.Vector3): THREE.Vector3 => {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return out.set(a * p[0][0] + b * p[1][0] + c * p[2][0] + d * p[3][0], a * p[0][1] + b * p[1][1] + c * p[2][1] + d * p[3][1], a * p[0][2] + b * p[1][2] + c * p[2][2] + d * p[3][2]);
};
const bez1 = (v: number[], t: number) => {
  const u = 1 - t;
  return u * u * u * v[0] + 3 * u * u * t * v[1] + 3 * u * t * t * v[2] + t * t * t * v[3];
};
const smooth = (a: number, b: number, x: number) => {
  const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

interface Knot {
  y: number;
  a: number;
  amp: number;
  w: number;
}

/** Arrays a gnarled tube appends to. */
class Builder {
  pos: number[] = [];
  bark: number[] = [];
  knot: number[] = [];
  index: number[] = [];

  /**
   * A tube along `centre` (t 0..1) whose radius is `radius(t, y, angle)`, with bark coordinates
   * (cos, sin of the twisted angle; distance along in shaft radii; height up the staff 0..1).
   */
  tube(centre: (t: number, out: THREE.Vector3) => THREE.Vector3, radius: (t: number, y: number, a: number) => [number, number], rings: number, sides: number, twist: number, along0: number): void {
    const base = this.pos.length / 3;
    const c: THREE.Vector3[] = [];
    for (let i = 0; i <= rings; i++) c.push(centre(i / rings, new THREE.Vector3()));
    const tan = new THREE.Vector3();
    const n = new THREE.Vector3();
    const b = new THREE.Vector3();
    const p = new THREE.Vector3();
    let along = along0;
    for (let i = 0; i <= rings; i++) {
      tan.subVectors(c[Math.min(rings, i + 1)], c[Math.max(0, i - 1)]).normalize();
      if (i === 0) n.set(1, 0, 0).sub(tan.clone().multiplyScalar(tan.x)).normalize();
      else n.sub(tan.clone().multiplyScalar(n.dot(tan))).normalize();
      b.crossVectors(tan, n);
      if (i > 0) along += c[i].distanceTo(c[i - 1]) / R0;
      const t = i / rings;
      const h = (c[i].y - FOOT) / HEIGHT;
      for (let j = 0; j < sides; j++) {
        const a = (j / sides) * Math.PI * 2;
        const [r, k] = radius(t, c[i].y, a);
        p.copy(c[i]).addScaledVector(n, Math.cos(a) * r).addScaledVector(b, Math.sin(a) * r);
        this.pos.push(p.x, p.y, p.z);
        const tw = a + twist * along;
        this.bark.push(Math.cos(tw), Math.sin(tw), along, h);
        this.knot.push(k);
      }
    }
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < sides; j++) {
        const a = base + i * sides + j;
        const b2 = base + i * sides + ((j + 1) % sides);
        const c2 = a + sides;
        const d = b2 + sides;
        this.index.push(a, c2, b2, b2, c2, d);
      }
    }
    // Caps: a fan to a point just past each end.
    for (const [ring, sgn] of [[0, -1], [rings, 1]] as const) {
      tan.subVectors(c[Math.min(rings, ring + 1)], c[Math.max(0, ring - 1)]).normalize();
      const tip = c[ring].clone().addScaledVector(tan, sgn * R0 * 0.25);
      const v = this.pos.length / 3;
      this.pos.push(tip.x, tip.y, tip.z);
      this.bark.push(0, 0, ring === 0 ? along0 : along, (tip.y - FOOT) / HEIGHT);
      this.knot.push(0);
      for (let j = 0; j < sides; j++) {
        const a = base + ring * sides + j;
        const b2 = base + ring * sides + ((j + 1) % sides);
        if (sgn < 0) this.index.push(v, a, b2);
        else this.index.push(v, b2, a);
      }
    }
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('bark', new THREE.Float32BufferAttribute(this.bark, 4));
    g.setAttribute('knot', new THREE.Float32BufferAttribute(this.knot, 1));
    g.setIndex(this.index);
    g.computeVertexNormals();
    return g;
  }
}

/** The gnarled shaft and prongs in the staff's piece frame. */
function woodGeometry(seed: number): THREE.BufferGeometry {
  const rnd = mulberry(seed);
  const ph = Array.from({ length: 8 }, () => rnd() * Math.PI * 2);
  const knots: Knot[] = [-0.06, 0.045, 0.075, 0.105, 0.14, 0.165].map((y) => ({ y, a: rnd() * Math.PI * 2, amp: 0.32 + rnd() * 0.26, w: 0.005 + rnd() * 0.004 }));
  /** No wobble or knots where the claw and its wraps grip (y about -0.012..0.012) nor at the head. */
  const free = (y: number) => smooth(0.014, 0.03, Math.abs(y)) * (1 - smooth(0.17, 0.2, y));
  const b = new Builder();
  const centre = (t: number, out: THREE.Vector3) => {
    bez(SHAFT, t, out);
    const y = out.y;
    const e = free(y) * 0.0022;
    const s = (y - FOOT) / HEIGHT;
    out.x += e * (0.6 * Math.sin(s * 13.0 + ph[0]) + 0.4 * Math.sin(s * 27.0 + ph[1]));
    out.z += e * (0.6 * Math.sin(s * 11.0 + ph[2]) + 0.4 * Math.sin(s * 23.0 + ph[3]));
    return out;
  };
  const radius = (t: number, y: number, a: number): [number, number] => {
    let r = 0.0058;
    // A rounded foot, a swelling where it splits into the prongs.
    r *= Math.sqrt(Math.max(0.04, Math.min(1, t / 0.025)));
    r *= 1 + 0.28 * smooth(0.17, 0.2, y);
    const f = free(y);
    // Twisting ridges and lumps.
    const ridge = 0.09 * Math.sin(5 * a + y * 160 + ph[4]) + 0.05 * Math.sin(9 * a - y * 90 + ph[5]) + 0.08 * Math.sin(2 * a + y * 70 + ph[6]);
    let k = 0;
    for (const kn of knots) {
      const g = Math.exp(-(((y - kn.y) / kn.w) ** 2) - (angDiff(a, kn.a) / 0.9) ** 2);
      k = Math.max(k, g);
      r *= 1 + kn.amp * g * f;
    }
    r *= 1 + ridge * (0.35 + 0.65 * f);
    return [r, k * f];
  };
  b.tube(centre, radius, 140, 16, 0.025, 0);
  const along0 = 0.28 / R0;
  for (let k = 0; k < 3; k++) {
    const pts = prong(k);
    const pr = (t: number, _y: number, a: number): [number, number] => {
      const r = bez1(PRONG_R, t) * (1 + 0.12 * Math.sin(3 * a + t * 9 + ph[7] + k) + 0.18 * Math.exp(-(((t - 0.45) / 0.12) ** 2)));
      return [r, 0];
    };
    b.tube((t, out) => bez(pts, t, out), pr, 32, 9, 0.04, along0);
  }
  return b.geometry();
}

/** The centre and outer radius of the wood's cross-section at height y (the cord wraps round it). */
function girthAt(g: THREE.BufferGeometry, y: number): { x: number; z: number; r: number } {
  const p = g.getAttribute('position');
  const ring: [number, number][] = [];
  for (let i = 0; i < p.count; i++) if (Math.abs(p.getY(i) - y) < 0.0015 && Math.hypot(p.getX(i), p.getZ(i)) < 0.012) ring.push([p.getX(i), p.getZ(i)]);
  if (!ring.length) return { x: 0, z: 0, r: R0 };
  const x = ring.reduce((s, q) => s + q[0], 0) / ring.length;
  const z = ring.reduce((s, q) => s + q[1], 0) / ring.length;
  return { x, z, r: Math.max(...ring.map((q) => Math.hypot(q[0] - x, q[1] - z))) };
}

const BARK_VERT = /* glsl */ `
  attribute vec4 bark;
  attribute float knot;
  varying vec4 vBark;
  varying float vKnot;
`;
const BARK_FRAG = /* glsl */ `
  uniform vec3 uBark, uBark2, uTint;
  uniform float uBump;
  varying vec4 vBark;
  varying float vKnot;
  ${NOISE}
  // Mikkelsen's bump with unnormalised screen derivatives: the relief is in view units, so it reads the
  // same however close the lens is.
  vec3 barkBump(vec3 p, vec3 n, vec2 dH, float face) {
    vec3 sx = dFdx(p), sy = dFdy(p);
    vec3 r1 = cross(sy, n), r2 = cross(n, sx);
    float det = dot(sx, r1) * face;
    vec3 grad = sign(det) * (dH.x * r1 + dH.y * r2);
    return normalize(abs(det) * n - grad);
  }
`;

/** Bark: long grain and fissures along the shaft, knots, the green from the head; matte, bumped. */
function barkMaterial(cue: FxCue, bump: { value: number }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, metalness: 0 });
  const u = {
    uBark: { value: new THREE.Color(String(cue.bark ?? '#170f0a')) },
    uBark2: { value: new THREE.Color(String(cue.bark2 ?? '#040302')) },
    uTint: { value: new THREE.Color(String(cue.tint ?? '#3c4c16')) },
    uBump: bump,
  };
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\n${BARK_VERT}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vBark = bark; vKnot = knot;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${BARK_FRAG}`)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        vec2 bxy = vBark.xy;
        float bz = vBark.z;
        float bg = fbm(vec3(bxy * 1.3, bz * 0.1));
        float bf = abs(vnoise(vec3(bxy * 1.15 + 3.1, bz * 0.07)) * 2. - 1.);
        float bcrev = 1. - smoothstep(0.04, 0.24, bf + (bg - .5) * .16);
        float bfine = vnoise(vec3(bxy * 5., bz * 0.55));
        float bH = bg * .5 + bfine * .2 - bcrev + vKnot * .5;
        vec3 bc = uBark * (0.4 + 1.2 * bg) * (0.75 + 0.5 * bfine);
        bc = mix(bc, uBark * 1.6, smoothstep(.2, .45, vKnot) * (1. - smoothstep(.55, .8, vKnot)) * .5);
        bc = mix(bc, uBark2, smoothstep(.7, .95, vKnot) * .9);
        bc = mix(bc, uBark2, bcrev * .85);
        float btint = smoothstep(.42, 1., vBark.w);
        bc = mix(bc, uTint * (0.45 + 0.8 * bg), btint * (.22 + .5 * bcrev));
        diffuseColor.rgb = bc;`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(.86, 1., bcrev);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  normal = barkBump(-vViewPosition, normal, vec2(dFdx(bH), dFdy(bH)) * uBump, faceDirection);');
  };
  return m;
}

interface Dressing {
  piece: THREE.Object3D;
  hidden: THREE.Mesh[];
  swapped: [THREE.Mesh, THREE.Material | THREE.Material[]][];
  added: THREE.Object3D[];
}

class Staff implements Effect {
  private unit: Unit | null = null;
  private dressing: Dressing | null = null;
  private wood: THREE.BufferGeometry;
  private woodMat: THREE.MeshStandardMaterial;
  private bump = { value: 0.0005 };
  private bronze: THREE.MeshStandardMaterial | null;
  private cordMat: THREE.MeshStandardMaterial;
  private beadMat: THREE.MeshPhysicalMaterial;
  private tasselMat: THREE.MeshStandardMaterial;
  private beads: THREE.InstancedMesh;
  private tassel: THREE.Mesh;
  private cordLoop: THREE.Mesh;
  private cordTail: THREE.Mesh;
  private group = new THREE.Group();
  private bc: Record<string, unknown>;
  private nLoop: number;
  private nTail = 4;
  private kicks: [number, number, number][];
  private seed: number;
  /** The shaft's centre and outer radius where the string hangs (piece frame). */
  private girth: { x: number; z: number; r: number };
  private tmp = { a: new THREE.Vector3(), b: new THREE.Vector3(), d: new THREE.Vector3(), m: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new THREE.Vector3() };

  constructor(private cue: FxCue, scene: THREE.Scene, private ground: (x: number, z: number) => number) {
    this.bc = (cue.beads as Record<string, unknown>) ?? {};
    this.seed = num(this.bc.seed, 13);
    this.wood = woodGeometry(this.seed);
    this.woodMat = barkMaterial(cue, this.bump);
    this.girth = girthAt(this.wood, this.anchorY());
    this.bronze = cue.ferrule === false ? null : new THREE.MeshStandardMaterial({ color: String(cue.ferrule ?? '#2b2013'), metalness: 0.7, roughness: 0.58 });
    this.cordMat = new THREE.MeshStandardMaterial({ color: '#140d09', roughness: 0.92 });
    this.beadMat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.42, clearcoat: 0.3, clearcoatRoughness: 0.4 });
    this.tasselMat = new THREE.MeshStandardMaterial({ color: '#4a0808', roughness: 0.95 });
    const count = Math.max(8, Math.round(num(this.bc.count, 24)));
    this.nLoop = count - this.nTail;
    this.beads = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 12), this.beadMat, count);
    const rnd = mulberry(this.seed * 31 + 5);
    const c1 = new THREE.Color(String(this.bc.color ?? '#8a0b0d'));
    const c2 = new THREE.Color(String(this.bc.color2 ?? '#3a0406'));
    // A faint glow of their own so the red still reads against the night.
    this.beadMat.emissive.copy(c1).multiplyScalar(num(this.bc.glow, 0.12));
    for (let i = 0; i < count; i++) {
      const c = (rnd() < 0.22 ? c2 : c1).clone().multiplyScalar(0.85 + rnd() * 0.3);
      this.beads.setColorAt(i, c);
    }
    this.tassel = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 10, 1, true), this.tasselMat);
    this.cordLoop = new THREE.Mesh(new THREE.BufferGeometry(), this.cordMat);
    this.cordTail = new THREE.Mesh(new THREE.BufferGeometry(), this.cordMat);
    for (const o of [this.beads, this.tassel, this.cordLoop, this.cordTail]) {
      o.frustumCulled = false;
      o.castShadow = false;
      o.receiveShadow = true;
      this.group.add(o);
    }
    this.group.visible = false;
    scene.add(this.group);
    this.kicks = ((this.bc.swing ?? []) as number[][]).map((k) => [k[0], k[1] ?? 0, ((k[2] ?? 0) * Math.PI) / 180]);
  }

  private find(): Unit | null {
    if (this.unit) return this.unit;
    const g = (window as unknown as { app?: { current?: { game?: { units: Unit[] } } } }).app?.current?.game;
    this.unit = g?.units.find((u) => u.name === this.cue.actor) ?? null;
    return this.unit;
  }

  /** Dress the staff in this actor's gear (again, if the gear was rebuilt). */
  private dress(u: Unit): Dressing | null {
    const piece = u.rig.gearMeshes.find((o) => o.name === 'weapon_staff' || (o.userData as { id?: string }).id === 'staff') ?? null;
    if (!piece) return null;
    if (this.dressing?.piece === piece) return this.dressing;
    this.undress();
    const d: Dressing = { piece, hidden: [], swapped: [], added: [] };
    piece.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || Array.isArray(m.material)) return;
      // The material cache names gear materials "gear:<palette name>:<tint>".
      const name = (m.material as THREE.Material).name.split(':');
      if (name.includes('driftwood') && m.visible) {
        m.visible = false;
        d.hidden.push(m);
      } else if (name.includes('leather-dark') && this.bronze) {
        d.swapped.push([m, m.material]);
        m.material = this.bronze;
      }
    });
    const wood = new THREE.Mesh(this.wood, this.woodMat);
    wood.castShadow = false;
    wood.receiveShadow = true;
    piece.add(wood);
    d.added.push(wood);
    // A few turns of cord where the beads hang from.
    const y = this.anchorY();
    const gr = this.girth;
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(gr.r + R0 * 0.08, R0 * 0.2, 6, 24), this.cordMat);
      ring.position.set(gr.x, y + (i - 1) * R0 * 0.42, gr.z);
      ring.rotation.set(Math.PI / 2 + (i - 1) * 0.12, 0.1 * i, 0);
      piece.add(ring);
      d.added.push(ring);
    }
    this.dressing = d;
    return d;
  }

  private undress(): void {
    const d = this.dressing;
    if (!d) return;
    for (const m of d.hidden) m.visible = true;
    for (const [m, mat] of d.swapped) m.material = mat;
    for (const o of d.added) {
      o.removeFromParent();
      if (o !== d.added[0]) (o as THREE.Mesh).geometry.dispose();
    }
    this.dressing = null;
  }

  /** Where the string hangs from, in the piece frame (on the shaft, just under the head by default). */
  private anchorY(): number {
    const at = Math.max(0, Math.min(1, num(this.bc.at, 0.9)));
    return FOOT + at * (0.2 - FOOT);
  }

  /** The string's horizontal lean (radians, along his left and his front) at time t. */
  private lean(t: number, out: [number, number]): [number, number] {
    const sw = num(this.bc.sway, 0.1);
    let l = sw * (0.55 * Math.sin(1.7 * t + 0.4) + 0.3 * Math.sin(3.1 * t + 2.1) + 0.15 * Math.sin(5.3 * t + 4.0));
    let f = sw * (0.5 * Math.sin(1.3 * t + 1.9) + 0.3 * Math.sin(2.6 * t + 0.7) + 0.2 * Math.sin(4.4 * t + 3.3));
    const w = num(this.bc.freq, 5.2);
    const damp = num(this.bc.damp, 1.4);
    for (const [t0, amp, dir] of this.kicks) {
      const s = t - t0;
      if (s <= 0) continue;
      const k = amp * Math.exp(-damp * s) * Math.sin(w * s);
      l += k * Math.cos(dir);
      f += k * Math.sin(dir);
    }
    out[0] = l;
    out[1] = f;
    return out;
  }

  update(ctx: FxContext): void {
    const u = this.find();
    const on = ctx.t >= this.cue.t && ctx.t <= num(this.cue.until, Infinity);
    if (!u || !on) {
      if (!on) this.undress();
      this.group.visible = false;
      return;
    }
    const d = this.dress(u);
    if (!d) {
      this.group.visible = false;
      return;
    }
    const piece = d.piece;
    piece.updateWorldMatrix(true, false);
    const scale = piece.matrixWorld.getMaxScaleOnAxis();
    const L = HEIGHT * scale;
    const Rw = R0 * scale;
    this.bump.value = Rw * 0.35;
    const T = this.tmp;
    const anchor = piece.localToWorld(T.a.set(this.girth.x, this.anchorY(), this.girth.z)).clone();
    const foot = piece.localToWorld(T.b.set(0, FOOT, 0)).clone();
    const head = piece.localToWorld(T.b.set(0, 0.2, 0)).clone();

    // The rest shape: a teardrop loop from either side of the shaft, a tail from its bottom.
    let r = num(this.bc.size, 0.011) * L;
    const total = num(this.bc.length, 0.33) * L;
    const tailDepth = (this.nTail - 1) * 2.1 * r + 2.6 * r + 3.2 * r;
    const D = Math.max(6 * r, total - tailDepth);
    const W = 0.22 * D;
    const Rg = this.girth.r * scale;
    const off = Rg + r * 0.4;
    const N = 160;
    const pts: [number, number][] = [];
    const arc: number[] = [0];
    for (let i = 0; i <= N; i++) {
      const p = (i / N) * Math.PI * 2;
      const x = W * Math.sin(p) * (0.35 + 0.65 * Math.sin(p / 2)) + Math.sign(Math.PI - p) * off * Math.cos(p / 2) ** 2;
      pts.push([x, (D * (1 - Math.cos(p))) / 2]);
      if (i) arc.push(arc[i - 1] + Math.hypot(x - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    const P = arc[N];
    const spacing = P / (this.nLoop + 1);
    r = Math.min(r, spacing / 2.1);
    const at = (s: number): [number, number] => {
      let i = 1;
      while (i < N && arc[i] < s) i++;
      const k = (s - arc[i - 1]) / Math.max(1e-9, arc[i] - arc[i - 1]);
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k];
    };
    // Rest offsets (side, depth) and radii: the loop, then the tail and the big bead.
    const rest: [number, number, number][] = [];
    for (let i = 0; i < this.nLoop; i++) rest.push([...at(((i + 1) / (this.nLoop + 1)) * P), r]);
    for (let j = 1; j < this.nTail; j++) rest.push([0, D + j * 2.1 * r, r]);
    const big = 1.45 * r;
    rest.push([0, D + (this.nTail - 1) * 2.1 * r + r + big, big]);
    const depth = rest[rest.length - 1][1] + big;

    // His frame on the ground: left and ahead.
    const yaw = u.yaw + (num(this.bc.turn, 25) * Math.PI) / 180;
    const left = new THREE.Vector3(Math.cos(u.yaw), 0, -Math.sin(u.yaw));
    const ahead = new THREE.Vector3(Math.sin(u.yaw), 0, Math.cos(u.yaw));
    const side0 = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const lagT = num(this.bc.lag, 0.22);
    const lean: [number, number] = [0, 0];
    const dir = new THREE.Vector3();
    const side = new THREE.Vector3();
    const axis = new THREE.Vector3().subVectors(head, foot);
    const axisLen = axis.length();
    axis.divideScalar(axisLen);
    const place = (x: number, y: number, rad: number, out: THREE.Vector3): THREE.Vector3 => {
      const q = y / depth;
      this.lean(ctx.t - lagT * q, lean);
      const whip = 1 + 0.5 * q;
      dir.set(0, -1, 0).addScaledVector(left, lean[0] * whip).addScaledVector(ahead, lean[1] * whip).normalize();
      side.copy(side0).addScaledVector(dir, -side0.dot(dir)).normalize();
      out.copy(anchor).addScaledVector(dir, y).addScaledVector(side, x);
      // Out of the shaft...
      const v = T.d.subVectors(out, foot);
      const along = Math.max(0, Math.min(axisLen, v.dot(axis)));
      const radial = v.addScaledVector(axis, -along);
      const dist = radial.length();
      const min = Math.max(Rw * 1.15, Rg) + rad;
      if (dist < min) {
        if (dist < 1e-6) radial.copy(side);
        out.addScaledVector(radial.normalize(), min - dist);
      }
      // ...and above the ground.
      const g = this.ground(out.x, out.z) + rad;
      if (out.y < g) out.y = g;
      return out;
    };
    const centres: THREE.Vector3[] = [];
    for (let i = 0; i < rest.length; i++) {
      const [x, y, rad] = rest[i];
      const c = place(x, y, rad, new THREE.Vector3());
      centres.push(c);
      T.m.compose(c, T.q.identity(), T.s.setScalar(rad));
      this.beads.setMatrixAt(i, T.m);
    }
    this.beads.instanceMatrix.needsUpdate = true;
    if (this.beads.instanceColor) this.beads.instanceColor.needsUpdate = true;

    // The cord: from one side of the shaft round the loop to the other; the tail from the loop's bottom.
    const cordR = Math.max(r * 0.2, Rw * 0.12);
    const ends = [at(0), at(P)];
    const loopPts = [place(ends[0][0], ends[0][1], cordR, new THREE.Vector3()), ...centres.slice(0, this.nLoop), place(ends[1][0], ends[1][1], cordR, new THREE.Vector3())];
    const bottom = place(0, D, cordR, new THREE.Vector3());
    const tailPts = [bottom, ...centres.slice(this.nLoop)];
    this.setCord(this.cordLoop, loopPts, cordR);
    this.setCord(this.cordTail, tailPts, cordR);

    // The tassel under the big bead, hanging along the bottom's lean.
    const end = centres[centres.length - 1];
    const below = place(0, depth + 3.2 * r, r, new THREE.Vector3());
    const tdir = new THREE.Vector3().subVectors(below, end).normalize();
    const len = 3.2 * r;
    this.tassel.position.copy(end).addScaledVector(tdir, big * 0.6 + len / 2);
    this.tassel.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tdir.clone().negate());
    this.tassel.scale.set(r * 0.85, len, r * 0.85);
    this.group.visible = true;
  }

  private setCord(mesh: THREE.Mesh, pts: THREE.Vector3[], r: number): void {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const geo = new THREE.TubeGeometry(curve, pts.length * 4, r, 5, false);
    mesh.geometry.dispose();
    mesh.geometry = geo;
  }

  dispose(): void {
    this.undress();
    this.group.removeFromParent();
    this.wood.dispose();
    this.woodMat.dispose();
    this.bronze?.dispose();
    this.cordMat.dispose();
    this.beadMat.dispose();
    this.tasselMat.dispose();
    this.beads.geometry.dispose();
    this.beads.dispose();
    this.tassel.geometry.dispose();
    this.cordLoop.geometry.dispose();
    this.cordTail.geometry.dispose();
  }
}

registerEffect('night-staff', (cue, scene, ground) => new Staff(cue, scene, ground));
