// dusk-climb: a crab climbing a wall hand over hand. Each limb's tip holds a grip on the wall and
// swings off it to the next; the joints come from an IK solve every frame (damped least squares from
// the standing pose each time, so a still matches the render). The stage moves the root (path lift);
// this pitches it onto the wall and heaves the body over it.
//   actor   the actor id
//   limbs   { LF: [[t0, t1, [x, y, z], normal?]...], ... } world grips: the tip leaves the previous grip
//           at t0 and lands on this one at t1 (the first entry's times are ignored: where it starts).
//           Each grip is snapped onto the surface by a ray along -normal (default the cue's `normal`),
//           from 3 in front of it to 0.3 behind (a window or an opening keeps the given point).
//   normal  the wall's outward normal (default [0, 0, 1])
//   clear   how far a swinging tip lifts off the wall (default 1)
//   pitch   [[t, degrees]...] nose up over the root (default 90: flat on the wall)
//   heave   [[t, units]...] the body pushed off the wall (+) or drawn in to it (-)
//   sway    [[t, degrees]...] the body rolled about its long axis
//   w       { LF: [[t, weight]...] } per limb: 0 = the clip's pose, 1 = the climb (default 1)
import * as THREE from 'three';
import { HOME } from '../../../crab/pose';
import type { JointName } from '../../../crab/types';
import { JOINT_NAMES } from '../../../crab/types';
import { curve, registerEffect, type Effect, type FxContext } from '../fx';
import type { FxCue } from '../types';

type Rig = {
  root: THREE.Object3D;
  body: THREE.Object3D;
  metersToUnits: number;
  jointBias: Readonly<Float32Array>;
  template: { info: { standZ: number }; links: { name: string; joint?: string; lower: number; upper: number }[] };
  linkNode(n: string): THREE.Object3D;
  setJoint(n: JointName, a: number): void;
  getPose(): Float32Array;
  onUpdate(fn: (dt: number) => void): void;
  /** The joint nodes and their axes, JOINT_NAMES order (rig internals). */
  jointNodes: THREE.Object3D[];
  axes: THREE.Vector3[];
};
type Unit = { name: string; rig: Rig };
type V3 = [number, number, number];
type Grip = [number, number, V3, V3?];

const LIMBS = ['LF', 'RF', 'LM', 'RM', 'LR', 'RR'] as const;
type LimbId = (typeof LIMBS)[number];
const sm = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

interface Limb {
  id: LimbId;
  claw: boolean;
  joints: JointName[];
  idx: number[];
  nodes: THREE.Object3D[];
  axes: THREE.Vector3[];
  tip: THREE.Object3D;
  lo: number[];
  hi: number[];
  grips: Grip[];
  points: THREE.Vector3[];
}

class Climb implements Effect {
  private unit: Unit | null = null;
  private limbs: Limb[] = [];
  private hook: ((dt: number) => void) | null = null;
  private q = new Map<JointName, number>();
  private t = -Infinity;
  private normal: THREE.Vector3;
  private v = new THREE.Vector3();
  private w = new THREE.Vector3();
  constructor(private cue: FxCue) {
    this.normal = new THREE.Vector3(...((cue.normal as V3) ?? [0, 0, 1])).normalize();
  }
  private find(scene: THREE.Scene): Unit | null {
    if (this.unit) return this.unit;
    const g = (window as unknown as { app?: { current?: { game?: { units: Unit[] } } } }).app?.current?.game;
    const u = g?.units.find((x) => x.name === this.cue.actor) ?? null;
    if (!u) return null;
    this.unit = u;
    const rig = u.rig;
    const lim = new Map(rig.template.links.filter((l) => l.joint).map((l) => [l.joint!, [l.lower, l.upper]]));
    const spec = (this.cue.limbs ?? {}) as Record<string, Grip[]>;
    for (const id of LIMBS) {
      const grips = spec[id];
      if (!grips?.length) continue;
      const claw = id.endsWith('F');
      const joints = (claw ? [0, 1, 2, 3] : [0, 1, 2]).map((k) => `${id}_J${k}_joint` as JointName);
      const idx = joints.map((j) => JOINT_NAMES.indexOf(j));
      this.limbs.push({
        id,
        claw,
        joints,
        idx,
        nodes: idx.map((i) => rig.jointNodes[i]),
        axes: idx.map((i) => rig.axes[i]),
        tip: rig.linkNode(claw ? `${id}_finger_tip_link` : `${id}_foot_tip_link`),
        lo: joints.map((j, k) => (lim.get(j)?.[0] ?? -9) - rig.jointBias[idx[k]]),
        hi: joints.map((j, k) => (lim.get(j)?.[1] ?? 9) - rig.jointBias[idx[k]]),
        grips,
        points: grips.map((gr) => this.snap(scene, gr)),
      });
    }
    return u;
  }
  /** A grip point moved onto the surface under it (a ray along -normal), or left as given. */
  private snap(scene: THREE.Scene, gr: Grip): THREE.Vector3 {
    const p = new THREE.Vector3(...gr[2]);
    const n = gr[3] ? new THREE.Vector3(...gr[3]).normalize() : this.normal;
    const mine = new Set<THREE.Object3D>();
    this.unit!.rig.root.traverse((o) => mine.add(o));
    const ray = new THREE.Raycaster(p.clone().addScaledVector(n, 3), n.clone().negate(), 0, 3.3);
    let best: THREE.Intersection | null = null;
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.visible || mine.has(m) || (m.material as THREE.Material)?.transparent) return;
      try {
        const h = ray.intersectObject(m, false)[0];
        if (h && (!best || h.distance < best.distance)) best = h;
      } catch {
        // Meshes that cannot be ray cast (LOD proxies) are skipped.
      }
    });
    return best ? (best as THREE.Intersection).point.clone() : p;
  }
  /** Where a limb's tip should be at t: on a grip, or swinging off the wall between two. */
  private target(l: Limb, t: number, out: THREE.Vector3): { swing: number } {
    const g = l.grips;
    let i = 0;
    while (i + 1 < g.length && t >= g[i + 1][0]) i++;
    if (i + 1 >= g.length || t < g[i + 1][0]) return out.copy(l.points[i]), { swing: 0 };
    const [t0, t1] = g[i + 1];
    const s = Math.min(1, (t - t0) / Math.max(1e-3, t1 - t0));
    if (s >= 1) return out.copy(l.points[i + 1]), { swing: 0 };
    // Off the wall fast, along it smoothly, down hard at the end (a slam).
    const along = sm(Math.min(1, s * 1.15));
    const off = Math.sin(Math.PI * Math.pow(s, 0.75)) * num(this.cue.clear, 1) * (l.claw ? 1.2 : 1);
    const n = g[i + 1][3] ? this.w.set(...g[i + 1][3]!).normalize() : this.normal;
    out.copy(l.points[i]).lerp(l.points[i + 1], along).addScaledVector(n, off);
    return { swing: Math.sin(Math.PI * s) };
  }
  private solve(l: Limb, goal: THREE.Vector3, rig: Rig): void {
    const n = l.joints.length;
    const q = l.joints.map((j) => HOME[j]);
    // The claws' wrist and the legs' hip yaw lean back to their standing angle.
    const rest = q.slice();
    const mu = l.claw ? [0.02, 0.01, 0.01, 0.08] : [0.04, 0.005, 0.005];
    const tip = new THREE.Vector3();
    const p = new THREE.Vector3();
    const a = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const J: number[][] = [];
    for (let it = 0; it < 30; it++) {
      for (let k = 0; k < n; k++) rig.setJoint(l.joints[k], q[k]);
      l.nodes[0].updateMatrixWorld(true);
      l.tip.getWorldPosition(tip);
      const e = [goal.x - tip.x, goal.y - tip.y, goal.z - tip.z];
      if (Math.hypot(e[0], e[1], e[2]) < 1e-3) break;
      for (let k = 0; k < n; k++) {
        const node = l.nodes[k];
        node.getWorldPosition(p);
        node.getWorldQuaternion(quat);
        a.copy(l.axes[k]).applyQuaternion(quat);
        const c = a.clone().cross(tip.clone().sub(p));
        J[k] = [c.x, c.y, c.z];
      }
      // (JᵀJ + λ² + μ²) dq = Jᵀe + μ²(rest - q)
      const lam = 0.05;
      const A: number[][] = [];
      const b: number[] = [];
      for (let r = 0; r < n; r++) {
        A[r] = [];
        for (let c = 0; c < n; c++) A[r][c] = J[r][0] * J[c][0] + J[r][1] * J[c][1] + J[r][2] * J[c][2] + (r === c ? lam + mu[r] : 0);
        b[r] = J[r][0] * e[0] + J[r][1] * e[1] + J[r][2] * e[2] + mu[r] * (rest[r] - q[r]);
      }
      const dq = gauss(A, b);
      for (let k = 0; k < n; k++) q[k] = Math.min(l.hi[k], Math.max(l.lo[k], q[k] + Math.max(-0.35, Math.min(0.35, dq[k]))));
    }
    for (let k = 0; k < n; k++) this.q.set(l.joints[k], q[k]);
  }
  /** The solved joints over the clip's pose `pose`, by each limb's weight. */
  private apply(pose: Float32Array): void {
    const u = this.unit;
    if (!u) return;
    for (const [j, a] of this.q) {
      const l = j.slice(0, 2);
      const wk = (this.cue.w as Record<string, [number, number][]> | undefined)?.[l];
      const w = wk ? Math.max(0, Math.min(1, curve(wk, this.t))) : 1;
      const i = JOINT_NAMES.indexOf(j);
      u.rig.setJoint(j, pose[i] + (a - pose[i]) * w);
    }
  }
  update(ctx: FxContext): void {
    this.t = ctx.t;
    const u = this.find(ctx.scene);
    if (!u) return;
    const rig = u.rig;
    if (!this.hook) {
      this.hook = () => this.apply(rig.getPose());
      rig.onUpdate(this.hook);
    }
    // The body onto the wall: pitch over the root, heave off it, sway about its long axis.
    const r = rig.root.rotation;
    r.order = 'YXZ';
    r.x = -(this.cue.pitch ? curve(this.cue.pitch as [number, number][], ctx.t) : 90) * (Math.PI / 180);
    const s = 1 / (rig.root.scale.x || 1);
    rig.body.position.set(0, rig.template.info.standZ * rig.metersToUnits + (this.cue.heave ? curve(this.cue.heave as [number, number][], ctx.t) : 0) * s, 0);
    rig.body.rotation.set(0, 0, this.cue.sway ? (curve(this.cue.sway as [number, number][], ctx.t) * Math.PI) / 180 : 0);
    rig.root.updateMatrixWorld(true);
    this.q.clear();
    const pose = rig.getPose();
    for (const l of this.limbs) {
      const { swing } = this.target(l, ctx.t, this.v);
      this.solve(l, this.v, rig);
      // The pincer opens as it reaches and shuts on the grip.
      if (l.claw) this.q.set(`${l.id}_J4_joint` as JointName, HOME[`${l.id}_J4_joint` as JointName] + (l.id === 'LF' ? -0.9 : 0.9) * swing);
    }
    // The solve left the joints at its answers; blend them over the clip's pose.
    this.apply(pose);
  }
  dispose(): void {
    const u = this.unit;
    const list = (u?.rig as unknown as { updaters?: ((dt: number) => void)[] })?.updaters;
    if (list && this.hook) {
      const i = list.indexOf(this.hook);
      if (i >= 0) list.splice(i, 1);
    }
    this.hook = null;
    if (u) {
      u.rig.root.rotation.x = 0;
      u.rig.body.rotation.set(0, 0, 0);
    }
  }
}

const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);

/** Solves A x = b (small, symmetric positive definite) by Gaussian elimination. */
function gauss(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-9;
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / (M[r][r] || 1e-9);
  }
  return x;
}

registerEffect('dusk-climb', (cue) => new Climb(cue));
