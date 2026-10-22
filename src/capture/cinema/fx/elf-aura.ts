// The night elf's change as light in the wood's mist rather than a flat star: soft shafts thrown out
// of her in 3D (foreshortened toward the lens, cut by the trunks in front), dust lit along them, a
// white-hot core and pink halo, a shell of sparks bursting out, sparks spiralling round the shape
// forming inside, glowing smoke rolling off, and a strong light on everything round her. After
// `stream` seconds the sparks and smoke stream away along `streamDir` (the glow left behind the beast).
//
//   elf-aura { at, d, size, pre, color, color2, rays, motes, sparks, light, gain, stream, streamDir }
//       t is the burst; the core, halo and spiral already build over the `pre` seconds before it
import * as THREE from 'three';
import { num, registerEffect, type Effect, type FxContext } from '../fx';
import type { FxCue } from '../types';
import { Billboards, hdr, vec } from './night-kit';

const DECL = 'uniform vec3 uC, uC1, uC2, uStream; uniform float uS, uD, uK, uPre, uSt;';
/** The stream's pull on a particle born at the burst (tau), quadratic after `uSt`. */
const PULL = 'vec3 pull = uStream * pow(max(0., tau - uSt), 2.0) * (0.6 + 0.8 * s2.w);';

class Aura implements Effect {
  private parts: Billboards[] = [];
  private light: THREE.PointLight;
  private fill: THREE.PointLight;
  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
  ) {
    const S = num(cue.size, 1.2);
    const u = () => ({
      uC: { value: new THREE.Vector3() },
      uC1: { value: hdr(cue.color ?? '#ff3fd0', 1) },
      uC2: { value: hdr(cue.color2 ?? '#ffa6f2', 1) },
      uStream: { value: vec(cue.streamDir, [0, 0.3, -2.5]) },
      uS: { value: S },
      uD: { value: num(cue.d, 0.7) },
      uK: { value: num(cue.gain, 1) },
      uPre: { value: num(cue.pre, 0.15) },
      uSt: { value: num(cue.stream, 0.3) },
    });
    // Shafts: long soft beams from the core outward, brightest at the core end, cut by the trunks.
    this.parts.push(
      new Billboards(scene, {
        count: num(cue.rays, 22),
        seed: 31,
        sprite: 1,
        decl: DECL,
        uniforms: u(),
        doubleSide: true,
        renderOrder: 8,
        body: /* glsl */ `
          if (tau > 0.0) {
            vec3 d = dirFrom(s1.xy); d.y = abs(d.y) * 0.75 + 0.08; d = normalize(d);
            float L = uS * (2.2 + 4.5 * s1.z) * (1. - exp(-tau * 12.)) * (1. + 0.6 * tau);
            pos = uC + d * L * 0.5;
            vel = -d * L; stretch = 1.0;
            size = uS * (0.22 + 0.4 * s2.x) * (1. + 1.5 * tau);
            float fl = 0.8 + 0.2 * sin(tau * 23. + s2.z * 6.2831);
            float f = smoothstep(0., 0.03, tau) * exp(-tau * 2.6 / max(uD, 0.1));
            // Soft volumes, not lines: wide, faint, and gone where they would cross the lens.
            float vd = -(viewMatrix * vec4(pos, 1.)).z;
            col = vec4(mix(uC1, uC2, s2.y) * 1.1 * fl * uK, f * (0.2 + 0.4 * s1.w) * smoothstep(1.0, 3.0, vd));
          }`,
      }),
    );
    // Dust caught in the shafts: motes along the same directions, drifting out, lit near the core.
    this.parts.push(
      new Billboards(scene, {
        count: num(cue.motes, 420),
        seed: 32,
        sprite: 2,
        decl: DECL,
        uniforms: u(),
        renderOrder: 8,
        body: /* glsl */ `
          ${PULL}
          if (tau > -uPre * 0.5) {
            float tt = max(tau, 0.);
            vec3 d = dirFrom(s1.xy); d.y = d.y * 0.7 + 0.15;
            float r = uS * (0.4 + 5.0 * pow(s1.z, 1.5)) + uS * 1.6 * (1. - exp(-tt * 3.)) * s2.x;
            pos = uC + d * r + vec3(0., 0.35 * tt, 0.) + pull;
            size = uS * (0.012 + 0.03 * s2.z);
            float near = exp(-r / (uS * 2.2));
            float f = smoothstep(-uPre * 0.5, 0.05, tau) * exp(-tt * 1.4 / max(uD, 0.1));
            col = vec4(mix(uC2, vec3(1.), 0.4) * (1.5 + 7.0 * near) * uK, f);
          }`,
      }),
    );
    // Core, halo and the bloom that floods the frame, building over `pre` and peaking on the burst.
    this.parts.push(
      new Billboards(scene, {
        count: 5,
        seed: 33,
        sprite: 2,
        decl: DECL,
        uniforms: u(),
        renderOrder: 9,
        body: /* glsl */ `
          int i = int(idx * 4.0 + 0.5);
          float up = smoothstep(-uPre, 0.0, tau);
          float tt = max(tau, 0.);
          float dec = exp(-tt * 2.2 / max(uD, 0.1));
          pos = uC;
          if (i == 0) { size = uS * (0.35 + 0.5 * up) ; col = vec4(vec3(1., 0.92, 1.) * 9.0, up * dec); }
          else if (i == 1) { size = uS * (0.9 + 1.4 * up + 1.5 * (1. - exp(-tt * 6.))); col = vec4(mix(uC1, uC2, 0.5) * 4.0, up * dec); }
          else if (i == 2) { size = uS * (3.0 + 4.0 * (1. - exp(-tt * 5.))); col = vec4(uC1 * 1.4, up * 0.6 * exp(-tt * 1.2 / max(uD, 0.1))); }
          else if (i == 3) { size = uS * (7.0 + 5.0 * tt); col = vec4(uC1 * 0.55, smoothstep(0., 0.05, tau) * exp(-tt * 1.6 / max(uD, 0.1))); }
          else { size = uS * 0.9 * (1. + 0.2 * sin(tau * 40.)); col = vec4(uC2 * 3.0, up * (1. - up * 0.6) * step(tau, 0.)); }
          col.rgb *= uK;`,
      }),
    );
    // Sparks: a shell bursting out, and a spiral wound round the shape forming inside, streaking.
    this.parts.push(
      new Billboards(scene, {
        count: num(cue.sparks, 520),
        seed: 34,
        sprite: 1,
        decl: DECL,
        uniforms: u(),
        doubleSide: true,
        renderOrder: 8,
        body: /* glsl */ `
          ${PULL}
          float life = 0.45 + 0.7 * s1.w;
          if (s2.x < 0.55) {
            float t = tau - s2.y * 0.08;
            if (t > 0.0 && t < life) {
              vec3 d = dirFrom(s1.xy); d.y = d.y * 0.8 + 0.12;
              float sp = uS * (5.0 + 6.0 * s1.z);
              float k = 3.2;
              pos = uC + d * sp * (1. - exp(-k * t)) / k + vec3(0., 0.4 * t * t, 0.) + pull;
              vel = d * sp * exp(-k * t) + vec3(0., 0.8 * t, 0.);
              stretch = 0.07; size = uS * 0.02 * (0.6 + s2.z);
              float f = 1. - t / life;
              col = vec4(mix(uC2, vec3(1.), 0.3 * s2.w) * (2.0 + 7.0 * f) * uK, f);
            }
          } else {
            float t = tau + uPre - s2.y * uPre;
            float lifeS = life + uPre;
            if (t > 0.0 && t < lifeS) {
              float a = s1.x * 6.2831 + t * (7.0 + 5.0 * s1.z);
              float r = uS * (0.45 + 0.55 * s1.y) * (1. + 1.4 * max(tau, 0.));
              float h = uS * (-0.4 + 1.6 * s1.z) + t * 0.9;
              pos = uC + vec3(cos(a) * r, h, sin(a) * r) + pull;
              vel = vec3(-sin(a), 0.15, cos(a)) * r * (7.0 + 5.0 * s1.z);
              stretch = 0.05; size = uS * 0.018 * (0.6 + s2.z);
              float f = smoothstep(0., 0.08, t) * (1. - t / lifeS);
              col = vec4(mix(uC1, uC2, s2.w) * (2.5 + 5.0 * f) * uK, f);
            }
          }`,
      }),
    );
    // Glowing smoke rolling out of the burst and lagging behind as it streams.
    this.parts.push(
      new Billboards(scene, {
        count: num(cue.smoke, 34),
        seed: 35,
        sprite: 0,
        decl: DECL,
        uniforms: u(),
        renderOrder: 7,
        body: /* glsl */ `
          ${PULL}
          if (tau > 0.0) {
            vec3 d = dirFrom(s1.xy); d.y = d.y * 0.5 + 0.2;
            float r = uS * (0.3 + 2.2 * s1.z) * (1. - exp(-tau * 3.5));
            pos = uC + d * r + vec3(0., 0.5 * tau, 0.) + pull * 0.7;
            size = uS * (0.5 + 0.6 * s2.x) * (1. + 1.6 * tau);
            rot = s2.y * 6.2831 + tau * (s2.z - 0.5);
            col = vec4(mix(uC1, uC2, s2.w) * 0.55 * uK, 0.3 * smoothstep(0., 0.06, tau) * exp(-tau * 1.3 / max(uD, 0.1)));
          }`,
      }),
    );
    const c1 = hdr(cue.color ?? '#ff3fd0', 1);
    this.light = new THREE.PointLight(c1.clone(), 0, S * 16, 1.3);
    this.fill = new THREE.PointLight(hdr(cue.color2 ?? '#ffa6f2', 1), 0, S * 7, 1.6);
    scene.add(this.light, this.fill);
  }

  update(ctx: FxContext): void {
    const tau = ctx.t - this.cue.t;
    const d = num(this.cue.d, 0.7);
    const pre = num(this.cue.pre, 0.15);
    const on = tau >= -pre && tau < d + 1.8;
    const c = ctx.point(this.cue.at);
    for (const b of this.parts) {
      (b.u.uC.value as THREE.Vector3).copy(c);
      b.mat.uniforms.uTime.value = tau;
      b.mesh.visible = on;
      b.set(tau, ctx, on);
      b.mesh.visible = on;
    }
    const up = Math.min(1, Math.max(0, (tau + pre) / Math.max(pre, 1e-3)));
    const L = num(this.cue.light, 40);
    this.light.position.copy(c).y += 0.6;
    this.fill.position.copy(c);
    this.light.intensity = on ? L * (tau < 0 ? 0.25 * up * up : 0.25 + 0.75 * Math.exp(-tau * 2.4 / d)) * 4 : 0;
    this.fill.intensity = on ? L * (tau < 0 ? 0.5 * up : Math.exp(-tau * 3 / d)) : 0;
  }

  dispose(): void {
    for (const b of this.parts) b.dispose();
    this.light.removeFromParent();
    this.light.dispose();
    this.fill.removeFromParent();
    this.fill.dispose();
  }
}

registerEffect('elf-aura', (cue, scene) => new Aura(cue, scene));
