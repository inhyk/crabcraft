// dusk-arm: lays a held arm pose over an actor's motion clip, for a claw held out and opened.
//   actor   the actor id
//   joints  { RF_J1_joint: delta, ... } radians added to the crab's standing pose (HOME)
//   w       [[t, weight]...] 0 = the clip's pose, 1 = the held pose
//   hide    socket names whose held gear is hidden for the shot (an empty claw: ['clawR'])
// The motion clip sets the joints every frame; this runs after it (a rig updater) and again in the
// effect pass, so the held pose wins whichever runs last.
import { HOME } from '../../../crab/pose';
import type { JointName } from '../../../crab/types';
import { JOINT_NAMES } from '../../../crab/types';
import { curve, registerEffect, type Effect, type FxContext } from '../fx';
import type { FxCue } from '../types';

type Rig = { setJoint(n: JointName, a: number): void; getPose(): Float32Array; onUpdate(fn: (dt: number) => void): void; getSocket(n: string): { children: { visible: boolean }[] } };
type Unit = { name: string; rig: Rig };

class Arm implements Effect {
  private unit: Unit | null = null;
  private hook: ((dt: number) => void) | null = null;
  private t = -Infinity;
  private hidden: { visible: boolean }[] = [];
  constructor(private cue: FxCue) {}
  private find(): Unit | null {
    if (this.unit) return this.unit;
    const g = (window as unknown as { app?: { current?: { game?: { units: Unit[] } } } }).app?.current?.game;
    this.unit = g?.units.find((u) => u.name === this.cue.actor) ?? null;
    return this.unit;
  }
  private apply(): void {
    const u = this.unit;
    if (!u) return;
    const w = Math.max(0, Math.min(1, curve((this.cue.w as [number, number][]) ?? [[0, 1]], this.t)));
    if (w <= 0) return;
    const q = u.rig.getPose();
    for (const [name, d] of Object.entries((this.cue.joints ?? {}) as Record<string, number>)) {
      const i = JOINT_NAMES.indexOf(name as JointName);
      if (i < 0) continue;
      const goal = HOME[name as JointName] + d;
      u.rig.setJoint(name as JointName, q[i] + (goal - q[i]) * w);
    }
  }
  update(ctx: FxContext): void {
    this.t = ctx.t;
    const u = this.find();
    if (!u) return;
    if (!this.hook) {
      this.hook = () => this.apply();
      u.rig.onUpdate(this.hook);
      for (const n of (this.cue.hide ?? []) as string[]) for (const c of u.rig.getSocket(n).children) if (c.visible) this.hidden.push(c);
    }
    for (const c of this.hidden) c.visible = false;
    this.apply();
  }
  dispose(): void {
    const list = (this.unit?.rig as unknown as { updaters?: ((dt: number) => void)[] })?.updaters;
    if (list && this.hook) {
      const i = list.indexOf(this.hook);
      if (i >= 0) list.splice(i, 1);
    }
    this.hook = null;
    for (const c of this.hidden) c.visible = true;
    this.hidden = [];
  }
}

registerEffect('dusk-arm', (cue) => new Arm(cue));
