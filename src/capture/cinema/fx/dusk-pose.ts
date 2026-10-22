// dusk-pose: tilts a staged actor nose up (or down) about its own side axis, for a crab that climbs
// a wall. The stage only sets an actor's yaw each frame, so the pitch is laid on after it.
//   actor   the actor id
//   pitch   [[t, degrees]...], positive = nose up (omit to leave it level)
//   roll    [[t, degrees]...], positive = over onto its right side (a crab knocked tumbling)
//   nocull  draw every mesh of the actor whatever the frustum says: a skinned weapon's bounds stay
//           at its rest pose, so a claw flung wide in a close shot drops its blade otherwise
import type * as THREE from 'three';
import { curve, registerEffect, type Effect, type FxContext } from '../fx';
import type { FxCue } from '../types';

type Unit = { name: string; rig: { root: THREE.Object3D } };

class Pose implements Effect {
  private unit: Unit | null = null;
  private uncull = false;
  constructor(private cue: FxCue) {}
  private find(): Unit | null {
    if (this.unit) return this.unit;
    const g = (window as unknown as { app?: { current?: { game?: { units: Unit[] } } } }).app?.current?.game;
    this.unit = g?.units.find((u) => u.name === this.cue.actor) ?? null;
    return this.unit;
  }
  update(ctx: FxContext): void {
    const u = this.find();
    if (!u) return;
    if (this.cue.nocull && !this.uncull) {
      this.uncull = true;
      u.rig.root.traverse((o) => (o.frustumCulled = false));
    }
    if (!this.cue.pitch && !this.cue.roll) return;
    const r = u.rig.root.rotation;
    r.order = 'YXZ';
    if (this.cue.pitch) r.x = -(curve(this.cue.pitch as [number, number][], ctx.t) * Math.PI) / 180;
    if (this.cue.roll) r.z = (curve(this.cue.roll as [number, number][], ctx.t) * Math.PI) / 180;
  }
  dispose(): void {
    if (this.unit) {
      this.unit.rig.root.rotation.x = 0;
      this.unit.rig.root.rotation.z = 0;
    }
  }
}

registerEffect('dusk-pose', (cue) => new Pose(cue));
