// The undead's summoning, at cinematic scale: molten boulders rising around him, a burning rock
// falling out of the sky, and the impact (the stock `explode` is game-sized and its flash lasts a
// frame). Everything is a function of the shot clock, so a seek or a still lands on the same frame.
//
//   night-impact { at, t, scale, color, hot, mid, smoke, toward, light, until }
//       fireball of billowing puffs, flash and core glows, a shock dome and ground ring, a dust wave,
//       burning debris rocks and sparks (biased toward `toward`), a rising fire and smoke column, light
//   night-rocks  { at, n, radius, arc, size, rise, riseDur, h, glow, burst, burstAt, burstSpeed, heat, heatAt }
//       molten boulders that climb out of the ground and hover, then blast apart at `burst`
//   night-meteor { from, to, t, d, size, color, core, light }
//       a burning rock with a fiery tail and sparks, from `from` to `to` in `d` seconds
import * as THREE from 'three';
import { mulberry, num, registerEffect, type Effect, type FxContext } from '../fx';
import type { FxCue } from '../types';
import { Billboards, hdr, Rocks, track, vec } from './night-kit';

const UP = new THREE.Vector3(0, 1, 0);

interface Chunk {
  dir: THREE.Vector3;
  speed: number;
  size: number;
  spin: THREE.Vector3;
  rot0: THREE.Vector3;
  born: number;
}

class Impact implements Effect {
  private fire: Billboards;
  private column: Billboards;
  private dust: Billboards;
  private sparks: Billboards;
  private glows: Billboards;
  private ring: THREE.Mesh;
  private shell: THREE.Mesh;
  private chunks: Rocks;
  private chunkData: Chunk[] = [];
  private light: THREE.PointLight;
  private S: number;
  private tmp = new THREE.Vector3();
  private eul = new THREE.Euler();
  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
  ) {
    const S = (this.S = num(cue.scale, 6));
    const u = {
      uC: { value: new THREE.Vector3() },
      uG: { value: 0 },
      uS: { value: S },
      uBias: { value: new THREE.Vector3() },
      uHot: { value: hdr(cue.hot ?? '#fff1c0', 1) },
      uMid: { value: hdr(cue.mid ?? '#ffb02a', 1) },
      uCool: { value: hdr(cue.color ?? '#7dff3a', 1) },
      uSmoke: { value: hdr(cue.smoke ?? '#10160b', 1) },
      uFlash: { value: num(cue.flash, 1) },
    };
    const decl = 'uniform vec3 uC, uBias, uHot, uMid, uCool, uSmoke; uniform float uS, uG, uFlash;';
    const heatColor = /* glsl */ `
      vec3 heatCol(float h){
        vec3 c = mix(uSmoke, uCool * 0.6, smoothstep(0.04, 0.22, h));
        c = mix(c, uCool, smoothstep(0.2, 0.42, h));
        c = mix(c, uMid, smoothstep(0.4, 0.7, h));
        return mix(c, uHot, smoothstep(0.72, 0.95, h));
      }`;
    // The fireball: puffs flung out over a hemisphere, swelling and rising as they cool.
    this.fire = new Billboards(scene, {
      count: num(cue.puffs, 90),
      seed: 31,
      sprite: 0,
      additive: false,
      decl: decl + heatColor,
      uniforms: u,
      renderOrder: 7,
      body: /* glsl */ `
        float t = tau - s2.x * 0.16;
        if (t > 0.0) {
          vec3 d = dirFrom(s1.xy); d.y = abs(d.y) * 0.85 + 0.12; d = normalize(d);
          float reach = uS * (0.15 + 0.85 * s1.z);
          float k = 1. - exp(-t * (2.6 + 2.4 * s2.y));
          pos = uC + d * reach * k + vec3(0., 1., 0.) * uS * (0.28 * t + 0.3 * k);
          size = uS * (0.28 + 0.3 * s2.z) * (0.22 + 0.95 * k) * (1. + 0.22 * t);
          float h = exp(-t * (0.75 + 0.9 * s2.w)) * (1. - 0.45 * s1.z) + 0.1 * (s1.w - 0.5);
          float glow = 0.35 + 7.0 * h * h;
          col = vec4(heatCol(h) * glow, smoothstep(0.0, 0.05, t) * (1. - smoothstep(3.0, 5.0, t)) * (0.9 + 0.1 * s1.w));
          rot = s2.y * 6.283 + t * (s2.z - 0.5) * 0.8;
        }`,
    });
    // The column: puffs keep rising from the crater, fire at the base, smoke above.
    this.column = new Billboards(scene, {
      count: num(cue.columnPuffs, 80),
      seed: 32,
      sprite: 0,
      additive: false,
      decl: decl + heatColor,
      uniforms: u,
      renderOrder: 7,
      body: /* glsl */ `
        float born = 0.12 + idx * 4.0;
        float t = tau - born; float life = 2.4 + s1.w * 1.2;
        if (t > 0.0 && t < life) {
          float rise = uS * (0.9 + 0.7 * s1.z) * t;
          vec3 j = vec3(s2.x - 0.5, 0., s2.y - 0.5) * uS * (0.35 + 0.25 * t);
          pos = uC + j + vec3(0., uS * 0.2 + rise, 0.);
          size = uS * (0.22 + 0.18 * s2.z) * (1. + 0.6 * t);
          float h = exp(-t * (1.2 + s2.w)) * 0.95;
          col = vec4(heatCol(h) * (0.3 + 6.0 * h * h), smoothstep(0.0, 0.25, t) * (1. - smoothstep(life * 0.55, life, t)) * 0.95);
          rot = s2.w * 6.283 + t * 0.4 * (s1.x - 0.5);
        }`,
    });
    // The dust wave: dark puffs racing out over the ground, lit from the fire.
    this.dust = new Billboards(scene, {
      count: num(cue.dustPuffs, 56),
      seed: 33,
      sprite: 0,
      additive: false,
      decl,
      uniforms: u,
      renderOrder: 6,
      body: /* glsl */ `
        float t = tau - 0.04;
        if (t > 0.0) {
          float a = idx * 6.2831853 + s1.x * 0.3;
          float R = uS * (1.0 + 4.5 * (0.75 + 0.25 * s1.y)) * (1. - exp(-t * 2.4));
          pos = vec3(uC.x + cos(a) * R, uG + uS * (0.12 + 0.12 * s1.z) * (1. + t), uC.z + sin(a) * R);
          size = uS * (0.3 + 0.25 * s2.z) * (0.5 + 0.8 * (1. - exp(-t * 2.)));
          float h = exp(-t * 2.2);
          col = vec4(mix(uSmoke * 1.6, uMid * 2.5, h), (1. - smoothstep(1.4, 3.2, t)) * 0.8);
          rot = s2.y * 6.283;
        }`,
    });
    // Sparks and burning bits, some thrown toward `toward`.
    this.sparks = new Billboards(scene, {
      count: num(cue.sparks, 320),
      seed: 34,
      sprite: 1,
      decl,
      uniforms: u,
      renderOrder: 8,
      body: /* glsl */ `
        float t = tau - s2.x * 0.1; float life = 0.8 + 2.0 * s1.w;
        if (t > 0.0 && t < life) {
          vec3 d = dirFrom(s1.xy); d.y = abs(d.y) * 0.75 + 0.25;
          if (s2.y > 0.55) d += uBias * 1.4;
          d = normalize(d);
          vec3 v0 = d * uS * (1.6 + 4.4 * s1.z);
          float k = 0.9;
          vec3 g = vec3(0., -9.8 * uS / 7.0, 0.);
          pos = uC + v0 * (1. - exp(-k * t)) / k + 0.5 * g * t * t;
          vel = v0 * exp(-k * t) + g * t;
          stretch = 0.05;
          size = uS * 0.018 * (0.5 + s2.z);
          float f = 1. - t / life;
          col = vec4(mix(uCool, mix(uMid, uHot, f), smoothstep(0.2, 0.6, f + s2.w * 0.3)) * (2.0 + 9.0 * f * f), min(1.0, f * 2.0));
        }`,
    });
    // Flash, core, ground fire and a high glow.
    this.glows = new Billboards(scene, {
      count: 4,
      seed: 35,
      sprite: 2,
      decl,
      uniforms: u,
      renderOrder: 9,
      body: /* glsl */ `
        int i = int(idx * 3.0 + 0.5);
        if (i == 0) { pos = uC + vec3(0., uS * 0.3, 0.); size = uS * (1.2 + 3.0 * (1. - exp(-tau * 10.))); col = vec4(uHot * 5.0, exp(-tau * 4.5) * uFlash); }
        else if (i == 1) { pos = uC + vec3(0., uS * (0.4 + 0.25 * tau), 0.); size = uS * 1.8; col = vec4(mix(uMid, uHot, exp(-tau)) * 2.5, smoothstep(0.0, 0.04, tau) * (0.45 + 0.55 * exp(-tau * 0.8)) * (0.9 + 0.1 * sin(tau * 31.))); }
        else if (i == 2) { pos = vec3(uC.x, uG + uS * 0.2, uC.z); size = uS * 4.0; col = vec4(uCool * 1.4, smoothstep(0.0, 0.1, tau) * (0.35 + 0.65 * exp(-tau * 0.6))); }
        else { pos = uC + vec3(0., uS * (1.2 + 0.4 * tau), 0.); size = uS * 3.0; col = vec4(mix(uCool, uMid, 0.4) * 1.0, smoothstep(0.1, 0.6, tau) * exp(-tau * 0.35)); }`,
    });
    // Ground ring: a bright band racing out over the ground.
    const ringMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      uniforms: { uA: { value: 0 }, uC: { value: hdr(cue.mid ?? '#ffb02a', 3) }, uC2: { value: hdr(cue.color ?? '#7dff3a', 3) }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uA, uTime; uniform vec3 uC, uC2; varying vec2 vUv;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
        void main(){
          vec2 q = vUv * 2. - 1.; float r = length(q); float a = atan(q.y, q.x);
          float br = 0.7 + 0.3 * h21(vec2(floor(a * 40.), 1.0));
          float band = smoothstep(0.78, 0.97, r) * smoothstep(1.0, 0.97, r) * br;
          float inner = smoothstep(1.0, 0.0, r) * 0.15;
          gl_FragColor = vec4(mix(uC2, uC, smoothstep(0.85, 1.0, r)) * (band + inner) * uA, 1.0);
        }`,
    });
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), ringMat);
    this.ring.frustumCulled = false;
    this.ring.renderOrder = 6;
    // Shock dome: a thin bright shell swelling out of the blast.
    const shellMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uA: { value: 0 }, uC: { value: hdr(cue.hot ?? '#fff1c0', 2.5) } },
      vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vV; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `uniform float uA; uniform vec3 uC; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1. - abs(dot(normalize(vN), normalize(vV))), 3.0); gl_FragColor = vec4(uC * f * uA, 1.0); }`,
    });
    this.shell = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.62), shellMat);
    this.shell.frustumCulled = false;
    this.shell.renderOrder = 8;
    scene.add(this.ring, this.shell);
    // Debris rocks.
    const n = Math.round(num(cue.chunks, 30));
    this.chunks = new Rocks(scene, n, { ...cue, crack: cue.mid ?? '#ffb02a', crack2: cue.color ?? '#7dff3a', cells: 1.6 }, 41);
    const rnd = mulberry(num(cue.seed, 9));
    for (let i = 0; i < n; i++) {
      const z = rnd() * 2 - 1;
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      const dir = new THREE.Vector3(r * Math.cos(a), Math.abs(z) * 0.8 + 0.35, r * Math.sin(a));
      const toward = rnd() > 0.45;
      this.chunkData.push({
        dir: dir.normalize(),
        speed: S * (1.4 + 3.2 * rnd()),
        size: S * (0.035 + 0.11 * rnd() ** 2),
        spin: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(14),
        rot0: new THREE.Vector3(rnd() * 6, rnd() * 6, rnd() * 6),
        born: toward ? -1 : rnd() * 0.08,
      });
    }
    this.light = new THREE.PointLight(new THREE.Color(String(cue.mid ?? '#ffb02a')).lerp(new THREE.Color(String(cue.color ?? '#7dff3a')), 0.45), 0, S * 30, 1.2);
    scene.add(this.light);
  }

  update(ctx: FxContext): void {
    const tau = ctx.t - this.cue.t;
    const on = tau >= 0 && ctx.t <= num(this.cue.until, Infinity);
    const c = ctx.point(this.cue.at);
    const S = this.S;
    const g = ctx.ground(c.x, c.z);
    const bias = this.cue.toward !== undefined ? ctx.point(this.cue.toward).sub(c).normalize() : new THREE.Vector3();
    for (const b of [this.fire, this.column, this.dust, this.sparks, this.glows]) {
      (b.u.uC.value as THREE.Vector3).copy(c);
      (b.u.uBias.value as THREE.Vector3).copy(bias);
      b.u.uG.value = g;
      b.set(tau, ctx, on);
    }
    // Ring and dome.
    const ra = on ? Math.exp(-tau * 1.6) * Math.min(1, tau / 0.03) : 0;
    this.ring.visible = ra > 0.002;
    this.ring.position.set(c.x, g + 0.12, c.z);
    this.ring.scale.setScalar(Math.max(0.01, S * 6.5 * (1 - Math.exp(-tau * 2.0))));
    (this.ring.material as THREE.ShaderMaterial).uniforms.uA.value = ra;
    const sa = on ? Math.exp(-tau * 3.5) * Math.min(1, tau / 0.02) : 0;
    this.shell.visible = sa > 0.002;
    this.shell.position.set(c.x, g, c.z);
    this.shell.scale.setScalar(Math.max(0.01, S * 4.2 * (1 - Math.exp(-tau * 4.5))));
    (this.shell.material as THREE.ShaderMaterial).uniforms.uA.value = sa;
    // Debris: thrown, tumbling, landing.
    const grav = (9.8 * S) / 7;
    this.chunkData.forEach((k, i) => {
      const t = tau - Math.max(0, k.born);
      if (!on || t < 0) {
        this.chunks.set(i, c, this.eul.set(0, 0, 0), 0, 0);
        return;
      }
      const d = k.born < 0 ? this.tmp.copy(k.dir).addScaledVector(bias, 1.3).normalize() : this.tmp.copy(k.dir);
      const vy = d.y * k.speed;
      const y0 = c.y + S * 0.2;
      const tl = (vy + Math.sqrt(vy * vy + 2 * grav * Math.max(0, y0 - g))) / grav;
      const tt = Math.min(t, tl);
      const p = new THREE.Vector3(c.x + d.x * k.speed * tt, y0 + vy * tt - 0.5 * grav * tt * tt, c.z + d.z * k.speed * tt);
      this.eul.set(k.rot0.x + k.spin.x * tt, k.rot0.y + k.spin.y * tt, k.rot0.z + k.spin.z * tt);
      this.chunks.set(i, p, this.eul, k.size, 1.6 * Math.exp(-t * 0.5) + 0.3);
    });
    const L = num(this.cue.light, 900);
    const li = on ? L * Math.min(1, tau / 0.04) * (0.25 + 0.75 * Math.exp(-tau * 1.1)) * (1 + 0.12 * Math.sin(tau * 37) * Math.sin(tau * 11)) : 0;
    this.light.intensity = li;
    this.light.position.copy(c).addScaledVector(UP, S * 0.8);
    const cu = this.chunks.mat.uniforms;
    (cu.uHeatPos.value as THREE.Vector3).copy(this.light.position);
    cu.uHeat.value = on ? 30 * Math.exp(-tau * 0.8) : 0;
    this.chunks.mesh.visible = on;
    this.chunks.commit(ctx);
  }

  dispose(): void {
    for (const b of [this.fire, this.column, this.dust, this.sparks, this.glows]) b.dispose();
    for (const m of [this.ring, this.shell]) {
      m.removeFromParent();
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.chunks.dispose();
    this.light.removeFromParent();
    this.light.dispose();
  }
}

interface Boulder {
  angle: number;
  r: number;
  size: number;
  h: number;
  start: number;
  rot0: THREE.Vector3;
  spin: THREE.Vector3;
  glow: number;
  burst: THREE.Vector3;
}

/** Molten boulders climbing out of the ground around a point, hovering, then blasting apart. */
class Boulders implements Effect {
  private rocks: Rocks;
  private data: Boulder[] = [];
  private eul = new THREE.Euler();
  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
  ) {
    const n = Math.round(num(cue.n, 10));
    this.rocks = new Rocks(scene, n, { ...cue, cells: cue.cells ?? 1.7 }, num(cue.seed, 51));
    const rnd = mulberry(num(cue.seed, 51) * 13 + 1);
    const [a0, a1] = (cue.arc as [number, number]) ?? [0, Math.PI * 2];
    const [s0, s1] = (cue.size as [number, number]) ?? [0.6, 1.8];
    const [h0, h1] = (cue.h as [number, number]) ?? [1.2, 4.5];
    const [r0, r1] = (cue.rise as [number, number]) ?? [0, 3];
    const order = [...Array(n).keys()].sort(() => rnd() - 0.5);
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n;
      this.data.push({
        angle: a0 + (a1 - a0) * (f + (rnd() - 0.5) / n),
        r: num(cue.radius, 5) * (0.45 + 0.55 * rnd()),
        size: s0 + (s1 - s0) * rnd() ** 1.5,
        h: h0 + (h1 - h0) * rnd(),
        start: r0 + (r1 - r0) * (order[i] / Math.max(1, n - 1)),
        rot0: new THREE.Vector3(rnd() * 6, rnd() * 6, rnd() * 6),
        spin: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(0.6),
        glow: 0.7 + 0.6 * rnd(),
        burst: new THREE.Vector3(rnd() - 0.5, rnd() * 0.8 + 0.3, rnd() - 0.5),
      });
    }
  }

  update(ctx: FxContext): void {
    const t = ctx.t;
    const c = ctx.point(this.cue.at);
    const riseDur = num(this.cue.riseDur, 1.6);
    const burst = num(this.cue.burst, Infinity);
    const bAt = this.cue.burstAt !== undefined ? ctx.point(this.cue.burstAt) : c;
    const bs = num(this.cue.burstSpeed, 10);
    const glowK = track(this.cue.glow, t, 1);
    const until = num(this.cue.until, Infinity);
    this.data.forEach((b, i) => {
      const x = c.x + Math.cos(b.angle) * b.r;
      const z = c.z + Math.sin(b.angle) * b.r;
      const g = ctx.ground(x, z);
      const k = Math.min(1, Math.max(0, (t - b.start) / riseDur));
      if (k <= 0 || t > until) {
        this.rocks.set(i, c, this.eul.set(0, 0, 0), 0, 0);
        return;
      }
      const e = 1 - (1 - k) ** 3;
      const bob = Math.sin(t * 1.3 + b.angle * 3) * 0.12 * b.size * e;
      let p = new THREE.Vector3(x, g - b.size * 0.9 + (b.h + b.size * 0.9) * e + bob, z);
      const tl = t - b.start;
      this.eul.set(b.rot0.x + b.spin.x * tl, b.rot0.y + b.spin.y * tl, b.rot0.z + b.spin.z * tl);
      let glow = b.glow * glowK * (0.85 + 0.15 * Math.sin(t * 5 + i));
      if (t > burst) {
        const tb = t - burst;
        const d = p.clone().sub(bAt).setY(0).normalize().multiplyScalar(0.8).add(b.burst).normalize();
        p = p.addScaledVector(d, bs * tb * (0.7 + 0.6 * b.glow)).add(new THREE.Vector3(0, -4.9 * tb * tb, 0));
        this.eul.x += tb * b.spin.x * 12;
        this.eul.z += tb * b.spin.z * 12;
        glow *= 1 + 2.5 * Math.exp(-tb * 2);
      }
      this.rocks.set(i, p, this.eul, b.size, glow);
    });
    const u = this.rocks.mat.uniforms;
    u.uHeat.value = track(this.cue.heat, t, 0);
    if (this.cue.heatAt !== undefined) (u.uHeatPos.value as THREE.Vector3).copy(ctx.point(this.cue.heatAt));
    this.rocks.commit(ctx);
  }

  dispose(): void {
    this.rocks.dispose();
  }
}

/** A burning rock falling out of the sky with a tail of fire, sparks and light. */
class Meteor implements Effect {
  private head: Rocks;
  private tail: Billboards;
  private sparks: Billboards;
  private glow: Billboards;
  private light: THREE.PointLight;
  private eul = new THREE.Euler();
  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
  ) {
    const size = num(cue.size, 1.2);
    this.head = new Rocks(scene, 1, { ...cue, crack: cue.core ?? '#ffd04a', crack2: cue.color ?? '#9dff4a', cells: 1.4 }, 61);
    const u = {
      uFrom: { value: vec(cue.from, [0, 60, 0]) },
      uTo: { value: new THREE.Vector3() },
      uD: { value: num(cue.d, 2) },
      uR: { value: size },
      uCore: { value: hdr(cue.core ?? '#ffd04a', 1) },
      uCol: { value: hdr(cue.color ?? '#9dff4a', 1) },
    };
    const decl = /* glsl */ `
      uniform vec3 uFrom, uTo, uCore, uCol; uniform float uD, uR;
      vec3 headAt(float t){ float k = clamp(t / uD, 0., 1.); return mix(uFrom, uTo, k * (0.45 + 0.55 * k)); }`;
    this.tail = new Billboards(scene, {
      count: 110,
      seed: 62,
      sprite: 0,
      decl,
      uniforms: u,
      renderOrder: 7,
      body: /* glsl */ `
        float age = idx * 0.55 + s1.w * 0.02;
        float tt = tau - age;
        if (tt > 0.0 && tau < uD + 0.6 && tt < uD) {
          vec3 a = headAt(tt); vec3 b = headAt(tt + 0.02);
          vec3 v = normalize(b - a + 1e-4);
          vec3 side = normalize(cross(v, vec3(0., 1., 0.)) + 1e-4);
          vec3 up2 = cross(side, v);
          pos = a + (side * (s2.x - 0.5) + up2 * (s2.y - 0.5)) * uR * (0.4 + 3.0 * age);
          size = uR * (0.9 + 5.0 * age) * (0.7 + 0.5 * s2.z);
          float h = exp(-age * 5.0);
          vec3 c = mix(uCol * 0.25, uCol, smoothstep(0.05, 0.4, h));
          c = mix(c, uCore, smoothstep(0.5, 0.9, h));
          float fade = tau > uD ? exp(-(tau - uD) * 6.0) : 1.0;
          col = vec4(c * (1.0 + 7.0 * h), (1. - idx) * 0.6 * fade);
          rot = s2.w * 6.28 + tt * 2.0;
        }`,
    });
    this.sparks = new Billboards(scene, {
      count: 160,
      seed: 63,
      sprite: 1,
      decl,
      uniforms: u,
      renderOrder: 8,
      body: /* glsl */ `
        float born = idx * uD; float t = tau - born; float life = 0.4 + 0.6 * s1.w;
        if (t > 0.0 && t < life && born < uD) {
          vec3 a = headAt(born);
          vec3 v0 = (dirFrom(s1.xy) * (2.0 + 6.0 * s1.z)) * uR;
          vec3 g = vec3(0., -6.0, 0.);
          pos = a + v0 * t + 0.5 * g * t * t;
          vel = v0 + g * t;
          stretch = 0.06; size = uR * 0.05;
          float f = 1. - t / life;
          col = vec4(mix(uCol, uCore, f) * (3.0 + 6.0 * f), f);
        }`,
    });
    this.glow = new Billboards(scene, {
      count: 2,
      seed: 64,
      sprite: 2,
      decl,
      uniforms: u,
      renderOrder: 9,
      body: /* glsl */ `
        if (tau >= 0.0 && tau < uD) {
          pos = headAt(tau);
          if (idx < 0.5) { size = uR * 4.0; col = vec4(uCore * 4.0, 1.0); }
          else { size = uR * 11.0; col = vec4(uCol * 1.6, 0.8); }
        }`,
    });
    this.light = new THREE.PointLight(new THREE.Color(String(cue.color ?? '#9dff4a')), 0, 160, 1.2);
    scene.add(this.light);
  }

  update(ctx: FxContext): void {
    const tau = ctx.t - this.cue.t;
    const d = num(this.cue.d, 2);
    const to = ctx.point(this.cue.to);
    for (const b of [this.tail, this.sparks, this.glow]) {
      (b.u.uTo.value as THREE.Vector3).copy(to);
      b.set(tau, ctx, tau < d + 1);
    }
    const from = vec(this.cue.from, [0, 60, 0]);
    const k = Math.min(1, Math.max(0, tau / d));
    const p = from.clone().lerp(to, k * (0.45 + 0.55 * k));
    const on = tau >= 0 && tau < d;
    this.eul.set(ctx.t * 2.1, ctx.t * 1.3, ctx.t * 0.7);
    this.head.set(0, p, this.eul, on ? num(this.cue.size, 1.2) : 0, 2.5);
    this.head.mesh.visible = on;
    this.head.commit(ctx);
    this.light.position.copy(p);
    this.light.intensity = on ? num(this.cue.light, 600) * Math.min(1, tau / 0.3) : 0;
  }

  dispose(): void {
    this.head.dispose();
    for (const b of [this.tail, this.sparks, this.glow]) b.dispose();
    this.light.removeFromParent();
    this.light.dispose();
  }
}

registerEffect('night-impact', (cue, scene) => new Impact(cue, scene));
registerEffect('night-rocks', (cue, scene) => new Boulders(cue, scene));
registerEffect('night-meteor', (cue, scene) => new Meteor(cue, scene));
