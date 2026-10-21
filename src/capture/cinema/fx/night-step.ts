// night-step: a keyed joint pose over an actor's motion clip (a claw lifted and stamped down), and a
// body pitch with it. Like dusk-arm, but the pose moves between keys.
//   actor   the actor id
//   keys    [[t, { RF_J1_joint: delta, ... }, ease?]...] radians added to the standing pose (HOME);
//           `ease` shapes the segment that ends on that key ('in' accelerates into it: a stamp)
//   w       [[t, weight]...] 0 = the clip's pose, 1 = the keyed pose (default 1)
//   pitch   [[t, degrees]...] the body, positive = nose up
// The clip sets the joints every frame; this runs after it (a rig updater) and again in the effect
// pass, so the keyed pose wins whichever runs last.
import type * as THREE from 'three';
import { HOME } from '../../../crab/pose';
import type { JointName } from '../../../crab/types';
import { JOINT_NAMES } from '../../../crab/types';
import { curve, registerEffect, type Effect, type FxContext } from '../fx';
import type { FxCue } from '../types';

type Rig = { root: THREE.Object3D; setJoint(n: JointName, a: number): void; getPose(): Float32Array; onUpdate(fn: (dt: number) => void): void };
type Unit = { name: string; rig: Rig };
type Key = [number, Record<string, number>, string?];

const EASE: Record<string, (x: number) => number> = {
  linear: (x) => x,
  in: (x) => x * x * x,
  out: (x) => 1 - (1 - x) ** 3,
  inout: (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
};

class Step implements Effect {
  private unit: Unit | null = null;
  private hook: ((dt: number) => void) | null = null;
  private t = -Infinity;
  private keys: Key[];
  private names: JointName[];
  constructor(private cue: FxCue) {
    this.keys = ((cue.keys ?? []) as Key[]).slice().sort((a, b) => a[0] - b[0]);
    this.names = [...new Set(this.keys.flatMap((k) => Object.keys(k[1])))].filter((n) => JOINT_NAMES.includes(n as JointName)) as JointName[];
  }
  private find(): Unit | null {
    if (this.unit) return this.unit;
    const g = (window as unknown as { app?: { current?: { game?: { units: Unit[] } } } }).app?.current?.game;
    this.unit = g?.units.find((u) => u.name === this.cue.actor) ?? null;
    return this.unit;
  }
  /** The keyed delta of joint `n` at t. */
  private delta(n: string, t: number): number {
    const k = this.keys;
    if (!k.length) return 0;
    if (t <= k[0][0]) return k[0][1][n] ?? 0;
    for (let i = 1; i < k.length; i++) {
      if (t > k[i][0]) continue;
      const a = k[i - 1];
      const b = k[i];
      const x = (EASE[b[2] ?? 'inout'] ?? EASE.inout)((t - a[0]) / Math.max(1e-6, b[0] - a[0]));
      return (a[1][n] ?? 0) + ((b[1][n] ?? 0) - (a[1][n] ?? 0)) * x;
    }
    return k[k.length - 1][1][n] ?? 0;
  }
  private apply(): void {
    const u = this.unit;
    if (!u) return;
    const w = Math.max(0, Math.min(1, this.cue.w ? curve(this.cue.w as [number, number][], this.t) : 1));
    if (w <= 0) return;
    const q = u.rig.getPose();
    for (const n of this.names) {
      const i = JOINT_NAMES.indexOf(n);
      const goal = HOME[n] + this.delta(n, this.t);
      u.rig.setJoint(n, q[i] + (goal - q[i]) * w);
    }
  }
  update(ctx: FxContext): void {
    this.t = ctx.t;
    const u = this.find();
    if (!u) return;
    if (!this.hook) {
      this.hook = () => this.apply();
      u.rig.onUpdate(this.hook);
    }
    this.apply();
    if (this.cue.pitch) {
      const r = u.rig.root.rotation;
      r.order = 'YXZ';
      r.x = -(curve(this.cue.pitch as [number, number][], ctx.t) * Math.PI) / 180;
    }
  }
  dispose(): void {
    const list = (this.unit?.rig as unknown as { updaters?: ((dt: number) => void)[] })?.updaters;
    if (list && this.hook) {
      const i = list.indexOf(this.hook);
      if (i >= 0) list.splice(i, 1);
    }
    this.hook = null;
    if (this.unit && this.cue.pitch) this.unit.rig.root.rotation.x = 0;
  }
}

registerEffect('night-step', (cue) => new Step(cue));
