// The night elf's beast form. The game has no animal models and the contest forbids bringing any, so
// the beast is one of the game's own robot rigs re-dressed at runtime: a sleek black-violet hunter with
// violet eyes and glowing seams, stretched long and low.
//
//   night-shade { actor, body, glow, eyes, metal, rough, stretch: [sx, sy, sz] }
//       re-colours every material of the actor's rig (cloned, so other rigs keep theirs): lit parts
//       to `body` (their old brightness kept as a little panel variation), glowing parts and the LED
//       face to `glow`/`eyes`; `stretch` scales the rig once (long and low)
//   night-fly { actor, from: [x, y, z], vel: [vx, vy, vz], g, until, pitch }
//       from t to `until` the actor flies a parabola in absolute world height (over a cliff edge and
//       the sea, where a path's lift over the ground would jump), facing along it, nose down by
//       `pitch` times its dive angle. Runs after the actors move, so camera keys aim at absolute points.
import * as THREE from 'three';
import { num, registerEffect, type Effect, type FxContext } from '../fx';
import type { FxCue } from '../types';
import type { Unit } from '../../../game/unit';

/** The stage's actor of this id (the stage names its units after the actor ids; the latest wins). */
function actorUnit(id: unknown): Unit | null {
  const g = (window as unknown as { app?: { current?: { game?: { units: Unit[] } } } }).app?.current?.game;
  const us = g?.units ?? [];
  for (let i = us.length - 1; i >= 0; i--) if (us[i].name === id) return us[i];
  return null;
}

type Lit = THREE.MeshStandardMaterial & { emissive?: THREE.Color; color?: THREE.Color };

class Shade implements Effect {
  private done = false;
  constructor(private cue: FxCue) {}

  update(): void {
    if (this.done) return;
    const u = actorUnit(this.cue.actor);
    if (!u) return;
    this.done = true;
    const body = new THREE.Color(String(this.cue.body ?? '#120c1e'));
    const glow = new THREE.Color(String(this.cue.glow ?? '#b45cff')).multiplyScalar(num(this.cue.glowK, 2.5));
    const metal = num(this.cue.metal, 0.55);
    const rough = num(this.cue.rough, 0.32);
    const lum = (c: THREE.Color) => 0.3 * c.r + 0.59 * c.g + 0.11 * c.b;
    u.rig.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.material) return;
      const one = (src: THREE.Material): THREE.Material => {
        // The LED face is a shader the face drives by its own uniforms: left alone, tinted below.
        if ((src as THREE.ShaderMaterial).isShaderMaterial) return src;
        const mat = src.clone() as Lit;
        const e = mat.emissive ? lum(mat.emissive) * (mat.emissiveIntensity ?? 1) : 0;
        if (e > 0.08) {
          mat.emissive.copy(glow);
          mat.emissiveIntensity = 1;
          mat.color?.copy(body).multiplyScalar(0.5);
        } else if (mat.color) {
          const l = lum(mat.color);
          mat.color.copy(body).multiplyScalar(0.7 + 0.9 * l);
          if (mat.emissive) mat.emissive.setRGB(0, 0, 0);
        }
        if ('metalness' in mat) mat.metalness = metal;
        if ('roughness' in mat) mat.roughness = rough;
        return mat;
      };
      m.material = Array.isArray(m.material) ? m.material.map(one) : one(m.material);
    });
    u.setBaseTint(String(this.cue.eyes ?? '#c77dff'));
    const s = this.cue.stretch as [number, number, number] | undefined;
    if (s) u.rig.root.scale.multiply(new THREE.Vector3(...s));
  }

  dispose(): void {}
}

class Fly implements Effect {
  private flew = false;
  constructor(private cue: FxCue) {}

  update(ctx: FxContext): void {
    const u = actorUnit(this.cue.actor);
    if (!u) return;
    const root = u.rig.root;
    const tau = ctx.t - this.cue.t;
    if (tau < 0 || tau > num(this.cue.until, Infinity) - this.cue.t) {
      if (this.flew) root.rotation.x = 0;
      this.flew = false;
      return;
    }
    this.flew = true;
    const [x, y, z] = this.cue.from as [number, number, number];
    const [vx, vy, vz] = this.cue.vel as [number, number, number];
    const g = num(this.cue.g, 9.8);
    u.pos.set(x + vx * tau, y + vy * tau - 0.5 * g * tau * tau, z + vz * tau);
    const h = Math.hypot(vx, vz);
    u.setYaw(Math.atan2(vx, vz));
    root.rotation.order = 'YXZ';
    root.rotation.x = Math.atan2(-(vy - g * tau), h) * num(this.cue.pitch, 0.8);
  }

  reset(): void {
    this.flew = true;
  }

  dispose(): void {}
}

registerEffect('night-shade', (cue) => new Shade(cue));
registerEffect('night-fly', (cue) => new Fly(cue));
