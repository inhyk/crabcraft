// Under the water after the dive, in depth rather than flat lines on the lens: shafts of moonlight
// slanting down from the broken surface, bubbles of every size boiling up past the camera (rims and
// a highlight, near ones large and soft, far ones small), and churning white water billowing below
// the surface where the beast went in.
//
//   elf-under { at, box: [x, y, z], d, shafts, bubbles, foam, color, color2, gain, rise }
//       at: the middle of the water volume to fill; box its size; all of it fades in over `fadeIn`
//       from t and out by t + d
import * as THREE from 'three';
import { num, registerEffect, type Effect, type FxContext } from '../fx';
import type { FxCue } from '../types';
import { Billboards, hdr, vec } from './night-kit';

const DECL = 'uniform vec3 uC, uBox, uC1, uC2; uniform float uK, uA, uRise;';

class Under implements Effect {
  private parts: Billboards[] = [];
  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
  ) {
    const u = () => ({
      uC: { value: new THREE.Vector3() },
      uBox: { value: vec(cue.box, [10, 5, 10]) },
      uC1: { value: hdr(cue.color ?? '#7ff6ff', 1) },
      uC2: { value: hdr(cue.color2 ?? '#e8ffff', 1) },
      uK: { value: num(cue.gain, 1) },
      uA: { value: 0 },
      uRise: { value: num(cue.rise, 1.8) },
    });
    // Shafts: from the surface down, slanting a little, swaying, brightest at the top.
    this.parts.push(
      new Billboards(scene, {
        count: num(cue.shafts, 26),
        seed: 41,
        sprite: 1,
        decl: DECL,
        uniforms: u(),
        doubleSide: true,
        fog: false,
        renderOrder: 6,
        body: /* glsl */ `
          vec3 d = normalize(vec3(0.25 * (s1.x - 0.5) + 0.12 * sin(tau * 1.3 + s2.x * 6.), -1.0, 0.25 * (s1.y - 0.5)));
          float L = uBox.y * (0.7 + 0.6 * s1.z);
          vec3 top = uC + vec3((s2.x - 0.5) * uBox.x, 0.5 * uBox.y, (s2.y - 0.5) * uBox.z);
          pos = top + d * L * 0.5;
          vel = -d * L; stretch = 1.0;
          size = 0.12 + 0.35 * s2.z;
          float fl = 0.6 + 0.4 * sin(tau * 2.2 + s1.w * 6.2831);
          float vd = -(viewMatrix * vec4(pos, 1.)).z;
          col = vec4(mix(uC1, uC2, s2.w) * 0.9 * fl * uK, uA * (0.25 + 0.5 * s1.w) * smoothstep(2.0, 4.5, vd));`,
      }),
    );
    // Bubble rims and their highlights, rising and wobbling; the two passes share one seed.
    for (const sprite of [3, 2] as const) {
      this.parts.push(
        new Billboards(scene, {
          count: num(cue.bubbles, 420),
          seed: 42,
          sprite,
          decl: DECL,
          uniforms: u(),
          fog: false,
          renderOrder: 7,
          body: /* glsl */ `
            float r = 0.012 + 0.11 * pow(s1.w, 3.0);
            vec3 p = vec3(s1.x - 0.5, s1.y, s1.z - 0.5) * uBox;
            p.y += tau * uRise * (0.5 + 0.9 * sqrt(r / 0.12)) + 0.5 * tau * tau;
            p.y = mod(p.y, uBox.y) - 0.5 * uBox.y;
            p.x += 0.06 * sin(tau * 9. + s2.x * 6.2831); p.z += 0.06 * cos(tau * 8. + s2.y * 6.2831);
            pos = uC + p;
            ${sprite === 3 ? 'size = r; rot = s2.z * 6.2831; col = vec4(uC2 * 1.6 * uK, uA * 0.85);' : 'size = r * 0.45; col = vec4(uC2 * 2.4 * uK, uA * 0.7); pos += vec3(-0.3, 0.3, 0.) * r;'}`,
        }),
      );
    }
    // Churned white water: lit puffs billowing below the surface, normally blended so they hide.
    this.parts.push(
      new Billboards(scene, {
        count: num(cue.foam, 70),
        seed: 43,
        sprite: 0,
        additive: false,
        decl: DECL,
        uniforms: u(),
        fog: false,
        renderOrder: 5,
        body: /* glsl */ `
          vec3 p = vec3(s1.x - 0.5, s1.y * 0.45 + 0.5 - 0.45, s1.z - 0.5) * uBox;
          p += normalize(vec3(s1.x - 0.5, -0.4, s1.z - 0.5)) * tau * 0.8;
          pos = uC + p;
          size = 0.5 + 1.3 * s2.x + tau * 0.6;
          rot = s2.y * 6.2831 + tau * (s2.z - 0.5) * 0.8;
          float vd = -(viewMatrix * vec4(pos, 1.)).z;
          col = vec4(mix(uC1 * 0.55, uC2 * 0.9, s2.w) * uK, uA * 0.55 * (0.4 + 0.6 * s1.w) * smoothstep(1.5, 3.5, vd));`,
      }),
    );
  }

  update(ctx: FxContext): void {
    const tau = ctx.t - this.cue.t;
    const d = num(this.cue.d, 1.2);
    const fi = num(this.cue.fadeIn, 0.15);
    const a = tau < 0 ? 0 : Math.min(1, tau / fi) * (1 - Math.min(1, Math.max(0, (tau - d * 0.6) / (d * 0.4))));
    const c = ctx.point(this.cue.at);
    for (const b of this.parts) {
      (b.u.uC.value as THREE.Vector3).copy(c);
      b.u.uA.value = a;
      b.set(tau, ctx, a > 0.002);
    }
  }

  dispose(): void {
    for (const b of this.parts) b.dispose();
  }
}

registerEffect('elf-under', (cue, scene) => new Under(cue, scene));
