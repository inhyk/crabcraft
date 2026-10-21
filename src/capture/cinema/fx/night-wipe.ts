// A tree trunk whipping past close to the lens, the original's cut device in the night elf's run
// (75.4 s there): a dark, motion-blurred vertical band that sweeps across the frame and covers it
// whole at its middle, so the cut can hide under it. Drawn in screen space over the scene.
//   night-wipe { t, d (sweep seconds, 0.5), from, to (band centre at start and end, -1 left edge to 1
//                right edge; 1.9 -> -1.9), width (band width in the same units, 2.4: wider than the
//                frame so it covers it at the middle), soft (edge blur, 0.35), color ('#221a34'; the original's trunk sits near luma 30, and the
//                capture treats a near-black frame as a failed render),
//                rim (a cold edge light on the leading side, '#6a5c96'), order }
import * as THREE from 'three';
import { NOISE, num, registerEffect, type Effect, type FxContext } from '../fx';
import type { FxCue } from '../types';

class Wipe implements Effect {
  private mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  constructor(private cue: FxCue, scene: THREE.Scene) {
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uC: { value: num(cue.from, 1.9) },
        uW: { value: num(cue.width, 2.4) },
        uSoft: { value: num(cue.soft, 0.35) },
        uDir: { value: 1 },
        uColor: { value: new THREE.Color(String(cue.color ?? '#221a34')) },
        uRim: { value: new THREE.Color(String(cue.rim ?? '#6a5c96')) },
      },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uC, uW, uSoft, uDir; uniform vec3 uColor, uRim;
        varying vec2 vUv;
        ${NOISE}
        void main() {
          float x = vUv.x * 2.0 - 1.0;
          // The bark, smeared sideways by the motion: streaks that run along the sweep.
          float bark = fbm(vec3(x * 0.6, vUv.y * 26.0, 1.7));
          float edge = uW * 0.5 + (bark - 0.5) * 0.25;
          float d = abs(x - uC);
          float a = 1.0 - smoothstep(edge - uSoft, edge, d);
          // A cold rim on the leading side, where the moonlight catches the bark.
          float lead = (x - uC) * uDir;
          float rim = smoothstep(edge - uSoft * 1.6, edge - uSoft * 0.4, lead) * (1.0 - smoothstep(edge - uSoft * 0.4, edge, lead));
          vec3 c = uColor * (0.55 + 0.9 * bark) + uRim * rim * 0.35;
          gl_FragColor = vec4(c, a);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = num(cue.order, 1003);
    scene.add(this.mesh);
  }

  update(ctx: FxContext): void {
    const d = num(this.cue.d, 0.5);
    const raw = (ctx.t - this.cue.t) / d;
    this.mesh.visible = raw >= 0 && raw <= 1;
    if (!this.mesh.visible) return;
    const k = Math.min(1, Math.max(0, raw));
    const from = num(this.cue.from, 1.9);
    const to = num(this.cue.to, -1.9);
    // Fast through the middle, as a trunk close to a moving lens is.
    const e = k < 0.5 ? 0.5 * Math.pow(2 * k, 0.8) : 1 - 0.5 * Math.pow(2 - 2 * k, 0.8);
    const u = this.mat.uniforms;
    u.uC.value = from + (to - from) * e;
    u.uDir.value = Math.sign(to - from) || 1;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

registerEffect('night-wipe', (cue, scene) => new Wipe(cue, scene));
