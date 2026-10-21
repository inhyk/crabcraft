// The dwarf's beast in the snow charge: the dwarf riding on its shell, the beast rearing up to roar with
// its eyes flaring and its breath steaming, powder thrown up by its run and by its crash into the tauren.
//
//   snow-ride   { actor, mount, seat [left, up, ahead], lean (degrees forward), until }
//               keeps the rider on the mount's shell top (its 'head' socket), turned and tilted with
//               the mount's body every frame; give the rider a looping act so its legs hold still
//   snow-rear   { actor, pitch [[t, degrees]...], pivot (units behind the centre) }
//               pitches an actor nose up about its hind legs; the actor needs `align` (the stage then
//               rebuilds its orientation every frame and this adds to it)
//   snow-eyes   { actor, k [[t, gain]...] }  LED brightness, 1 = the rig's own
//   snow-breath { actor, t, until, rate, speed, size, life, color, down }  vapour out of the face, along it
//               and `down` below it (the face of a reared crab looks up)
//   snow-powder { at, t, count, spread, rise, size, life, color, flakes }  one burst of powder snow
//   snow-kick   { actor, t, until, rate, size, back }  powder kicked up behind a running actor
import * as THREE from 'three';
import { curve, num, registerEffect, type Effect, type FxContext } from '../fx';
import type { FxCue } from '../types';
import type { Unit } from '../../../game/unit';
import { Sprite } from '../../../game/vfx/atlas';

function actorUnit(id: unknown): Unit | null {
  const g = (window as unknown as { app?: { current?: { game?: { units: Unit[] } } } }).app?.current?.game;
  const us = g?.units ?? [];
  for (let i = us.length - 1; i >= 0; i--) if (us[i].name === id) return us[i];
  return null;
}

const X = new THREE.Vector3(1, 0, 0);
const rnd = () => Math.random() * 2 - 1;

class Ride implements Effect {
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  constructor(private cue: FxCue) {}
  update(ctx: FxContext): void {
    if (ctx.t > num(this.cue.until, Infinity)) return;
    const r = actorUnit(this.cue.actor);
    const m = actorUnit(this.cue.mount);
    if (!r || !m) return;
    m.rig.root.updateMatrixWorld(true);
    const seat = m.rig.getSocket('head').getWorldPosition(this.v);
    m.rig.body.getWorldQuaternion(this.q);
    const [l, up, a] = (this.cue.seat as number[]) ?? [0, 0, 0];
    seat.add(new THREE.Vector3(l, up, a).applyQuaternion(this.q));
    r.setYaw(m.yaw);
    r.pos.copy(seat);
    r.rig.root.quaternion.copy(this.q).multiply(new THREE.Quaternion().setFromAxisAngle(X, THREE.MathUtils.degToRad(num(this.cue.lean, 0))));
    r.rig.root.updateMatrixWorld(true);
  }
  dispose(): void {}
}

class Rear implements Effect {
  constructor(private cue: FxCue) {}
  update(ctx: FxContext): void {
    const u = actorUnit(this.cue.actor);
    if (!u) return;
    const p = THREE.MathUtils.degToRad(curve((this.cue.pitch as [number, number][]) ?? [[0, 0]], ctx.t));
    if (Math.abs(p) < 1e-4) return;
    const root = u.rig.root;
    const d = num(this.cue.pivot, 1.5);
    root.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(X, -p));
    // About the hind legs: the centre rises and draws back.
    const back = d * (1 - Math.cos(p));
    u.pos.y += d * Math.sin(p);
    u.pos.x -= Math.sin(u.yaw) * back;
    u.pos.z -= Math.cos(u.yaw) * back;
    root.updateMatrixWorld(true);
  }
  dispose(): void {}
}

class Eyes implements Effect {
  constructor(private cue: FxCue) {}
  update(ctx: FxContext): void {
    const u = actorUnit(this.cue.actor);
    const mat = (u?.rig.face as unknown as { material?: THREE.ShaderMaterial })?.material;
    if (!mat?.uniforms.uIntensity) return;
    mat.uniforms.uIntensity.value = 7 * curve((this.cue.k as [number, number][]) ?? [[0, 1]], ctx.t);
  }
  dispose(): void {}
}

class Breath implements Effect {
  private acc = 0;
  private q = new THREE.Quaternion();
  constructor(private cue: FxCue) {}
  update(ctx: FxContext): void {
    if (ctx.t < this.cue.t || ctx.t > num(this.cue.until, Infinity)) return;
    const u = actorUnit(this.cue.actor);
    if (!u) return;
    u.rig.root.updateMatrixWorld(true);
    const at = u.rig.getSocket('face').getWorldPosition(new THREE.Vector3());
    u.rig.body.getWorldQuaternion(this.q);
    const fwd = new THREE.Vector3(0, -num(this.cue.down, 0.45), 1).normalize().applyQuaternion(this.q);
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(this.q);
    const sp = num(this.cue.speed, 5);
    const size = num(this.cue.size, 0.5);
    const c = new THREE.Color(String(this.cue.color ?? '#eef3fa'));
    this.acc += ctx.dt * num(this.cue.rate, 90);
    while (this.acc >= 1) {
      this.acc -= 1;
      const s = sp * (0.6 + 0.5 * Math.random());
      const vel = fwd.clone().multiplyScalar(s).addScaledVector(side, rnd() * sp * 0.3);
      vel.y += rnd() * sp * 0.15 + 0.3;
      const p = at.clone().addScaledVector(fwd, 0.2 * size).addScaledVector(side, rnd() * 0.25 * size);
      ctx.vfx.alpha.emit({ x: p.x, y: p.y, z: p.z, vx: vel.x, vy: vel.y, vz: vel.z, life: num(this.cue.life, 0.9) * (0.7 + 0.5 * Math.random()), size: size * 0.4, sizeEnd: size * (2 + Math.random()), color: c, alpha: 0.5, drag: 2.4, sprite: Sprite.Smoke, spin: rnd(), fadeIn: 0.08 });
    }
  }
  reset(): void {
    this.acc = 0;
  }
  dispose(): void {}
}

/** Powder snow thrown from `at`: soft clouds plus flakes that fall back. */
function powder(ctx: FxContext, at: THREE.Vector3, cue: FxCue, k = 1, dir?: THREE.Vector3): void {
  const spread = num(cue.spread, 2);
  const rise = num(cue.rise, 2.5);
  const size = num(cue.size, 0.7);
  const c = new THREE.Color(String(cue.color ?? '#f2f5fb'));
  const n = Math.round(num(cue.count, 40) * k);
  for (let i = 0; i < n; i++) {
    const th = Math.random() * Math.PI * 2;
    const s = spread * (0.3 + 0.7 * Math.random());
    const vx = Math.cos(th) * s + (dir?.x ?? 0);
    const vz = Math.sin(th) * s + (dir?.z ?? 0);
    const g = 0.9 + 0.1 * Math.random();
    ctx.vfx.alpha.emit({ x: at.x + rnd() * 0.3, y: at.y + Math.random() * 0.3, z: at.z + rnd() * 0.3, vx, vy: rise * (0.4 + 0.8 * Math.random()) + (dir?.y ?? 0), vz, life: num(cue.life, 1.2) * (0.6 + 0.6 * Math.random()), size: size * 0.5, sizeEnd: size * (1.6 + Math.random()), color: c.clone().multiplyScalar(g), alpha: 0.75, gravity: 1.2, drag: 2.2, sprite: Sprite.Smoke, spin: rnd(), fadeIn: 0.05 });
  }
  const f = Math.round(num(cue.flakes, n) * k);
  for (let i = 0; i < f; i++) {
    const th = Math.random() * Math.PI * 2;
    const s = spread * 1.5 * Math.random();
    ctx.vfx.alpha.emit({ x: at.x, y: at.y + 0.2, z: at.z, vx: Math.cos(th) * s + (dir?.x ?? 0), vy: rise * 1.4 * Math.random() + (dir?.y ?? 0), vz: Math.sin(th) * s + (dir?.z ?? 0), life: 0.6 + Math.random() * 0.8, size: 0.05 + Math.random() * 0.07, sizeEnd: 0.04, color: c, alpha: 1, gravity: 7, drag: 0.8, sprite: Sprite.Snow, spin: rnd() * 4 });
  }
}

class Powder implements Effect {
  private fired = false;
  constructor(private cue: FxCue) {}
  update(ctx: FxContext): void {
    if (this.fired || ctx.t < this.cue.t) return;
    this.fired = true;
    const d = this.cue.dir as number[] | undefined;
    powder(ctx, ctx.point(this.cue.at), this.cue, 1, d ? new THREE.Vector3(d[0], d[1], d[2]) : undefined);
  }
  reset(): void {
    this.fired = false;
  }
  dispose(): void {}
}

class Kick implements Effect {
  private acc = 0;
  constructor(private cue: FxCue) {}
  update(ctx: FxContext): void {
    if (ctx.t < this.cue.t || ctx.t > num(this.cue.until, Infinity)) return;
    const u = actorUnit(this.cue.actor);
    if (!u) return;
    this.acc += ctx.dt * num(this.cue.rate, 14);
    const back = num(this.cue.back, 1);
    const sc = u.rig.root.scale.x;
    while (this.acc >= 1) {
      this.acc -= 1;
      // Under a foot on one side or the other, thrown back and up.
      const side = (Math.random() < 0.5 ? -1 : 1) * (0.5 + 0.4 * Math.random()) * sc;
      const ahead = (Math.random() - 0.3) * 0.8 * sc;
      const s = Math.sin(u.yaw);
      const c = Math.cos(u.yaw);
      const x = u.pos.x + side * c + ahead * s;
      const z = u.pos.z - side * s + ahead * c;
      const at = new THREE.Vector3(x, ctx.ground(x, z) + 0.05, z);
      const dir = new THREE.Vector3(-s * 2.5 * back, 0.6, -c * 2.5 * back);
      powder(ctx, at, { t: 0, kind: '', count: 3, flakes: 4, spread: 0.9, rise: 1.6, size: num(this.cue.size, 0.45), life: 0.8 }, 1, dir);
    }
  }
  reset(): void {
    this.acc = 0;
  }
  dispose(): void {}
}

registerEffect('snow-ride', (cue) => new Ride(cue));
registerEffect('snow-rear', (cue) => new Rear(cue));
registerEffect('snow-eyes', (cue) => new Eyes(cue));
registerEffect('snow-breath', (cue) => new Breath(cue));
registerEffect('snow-powder', (cue) => new Powder(cue));
registerEffect('snow-kick', (cue) => new Kick(cue));
