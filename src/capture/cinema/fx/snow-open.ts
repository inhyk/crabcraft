// The tribute's snow opening: a blizzard that thickens and lifts on cue, and back lights that keep the
// cast's edges off the white.
//
//   snow-fog  { color, density [[t, d]...] }  the scene's exponential fog on a curve (the city hidden in the
//             storm, then coming through it); give the shot no `fog` of its own
//   snow-rim  { actor, k [[t, intensity]...] (or intensity), color, back (units beyond the actor on the lens
//             ray, 2.2), up (over its middle, 0.6), side (to the lens's right, 0), distance (6), decay (1.4) }
//             a point light kept behind an actor as seen from the lens: its silhouette glows
import * as THREE from 'three';
import { curve, num, registerEffect, type Effect, type FxContext } from '../fx';
import type { FxCue } from '../types';
import type { Unit } from '../../../game/unit';

function actorUnit(id: unknown): Unit | null {
  const g = (window as unknown as { app?: { current?: { game?: { units: Unit[] } } } }).app?.current?.game;
  const us = g?.units ?? [];
  for (let i = us.length - 1; i >= 0; i--) if (us[i].name === id) return us[i];
  return null;
}

class Fog implements Effect {
  private own: THREE.FogExp2 | null = null;
  private prev: THREE.Scene['fog'] = null;
  constructor(private cue: FxCue, private scene: THREE.Scene) {}
  update(ctx: FxContext): void {
    let f = this.scene.fog;
    if (!(f instanceof THREE.FogExp2)) {
      if (!this.own) this.prev = f;
      f = this.own ??= new THREE.FogExp2('#ffffff', 0.01);
      this.scene.fog = f;
    }
    // The world sets its fog every frame before the stage's effects run; this wins until the shot ends.
    f.color.set(String(this.cue.color ?? '#dde2ec'));
    f.density = curve((this.cue.density as [number, number][]) ?? [[0, 0.01]], ctx.t);
  }
  dispose(): void {
    if (this.own && this.scene.fog === this.own) this.scene.fog = this.prev;
    this.own = null;
  }
}

class Rim implements Effect {
  private light: THREE.PointLight;
  private v = new THREE.Vector3();
  constructor(private cue: FxCue, scene: THREE.Scene) {
    this.light = new THREE.PointLight(String(cue.color ?? '#e8f0ff'), 0, num(cue.distance, 6), num(cue.decay, 1.4));
    scene.add(this.light);
  }
  update(ctx: FxContext): void {
    const u = actorUnit(this.cue.actor);
    const i = this.cue.k ? curve(this.cue.k as [number, number][], ctx.t) : num(this.cue.intensity, 20);
    if (!u || u.hidden || i <= 0) {
      this.light.intensity = 0;
      return;
    }
    const mid = this.v.copy(u.pos);
    mid.y += u.height * 0.5 + num(this.cue.up, 0.6);
    const ray = mid.clone().sub(ctx.camera.position).setY(0).normalize();
    const right = new THREE.Vector3(-ray.z, 0, ray.x);
    this.light.position.copy(mid).addScaledVector(ray, num(this.cue.back, 2.2)).addScaledVector(right, num(this.cue.side, 0));
    this.light.intensity = i;
  }
  dispose(): void {
    this.light.removeFromParent();
    this.light.dispose();
  }
}

registerEffect('snow-fog', (cue, scene) => new Fog(cue, scene));
registerEffect('snow-rim', (cue, scene) => new Rim(cue, scene));
