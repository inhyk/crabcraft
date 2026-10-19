// The night scene's ground: molten fissures opening under the undead's claws, and low mist.
//
//   night-cracks { at: [x, z], radius, t, grow, gain, cells, warp, width, keep, hot, mid, until, fadeOut }
//       meandering glowing fissures (warped Voronoi borders of varying width with a hot core and a
//       halo) spreading from a point over the terrain; `cells` per unit, so patches line up
//   night-mist   { at, box: [x, y, z], count, size, color, opacity, drift: [x, y, z] }
//       slow drifting puffs of ground mist in a box around `at`
import * as THREE from 'three';
import { envelope, num, registerEffect, type Effect, type FxContext } from '../fx';
import type { FxCue } from '../types';
import { Billboards, GLSL, hdr, vec } from './night-kit';

class Fissures implements Effect {
  private mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
    ground: (x: number, z: number) => number,
  ) {
    const [x, z] = cue.at as [number, number];
    const r = num(cue.radius, 3);
    const seg = Math.max(24, Math.min(96, Math.round(r * 12)));
    const geo = new THREE.PlaneGeometry(r * 2, r * 2, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, ground(x + pos.getX(i), z + pos.getZ(i)) + 0.02);
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      uniforms: {
        uTime: { value: 0 },
        uGrow: { value: 0 },
        uGain: { value: 1 },
        uCells: { value: num(cue.cells, 1.1) },
        uWarp: { value: num(cue.warp, 0.9) },
        uWidth: { value: num(cue.width, 0.05) },
        uKeep: { value: num(cue.keep, 0.45) },
        uHot: { value: hdr(cue.hot ?? '#ffd27a', 1) },
        uMid: { value: hdr(cue.mid ?? '#ff7a12', 1) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec2 vW;
        void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uGrow, uGain, uCells, uWarp, uWidth, uKeep; uniform vec3 uHot, uMid;
        varying vec2 vUv; varying vec2 vW;
        ${GLSL}
        vec2 h22(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
        float border(vec2 x){
          vec2 n = floor(x), f = fract(x), mg = vec2(0.), mr = vec2(0.); float md = 8.0;
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
            vec2 g = vec2(float(i), float(j)); vec2 r = g + h22(n + g) - f; float d = dot(r, r);
            if (d < md) { md = d; mr = r; mg = g; }
          }
          md = 8.0;
          for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
            vec2 g = mg + vec2(float(i), float(j)); vec2 r = g + h22(n + g) - f;
            if (dot(mr - r, mr - r) > 1e-5) md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
          }
          return md;
        }
        void main(){
          vec2 q = (vUv - 0.5) * 2.0; float r = length(q);
          vec2 p = vW * uCells;
          p += (vec2(fbm(vec3(p * 0.6, 1.3)), fbm(vec3(p * 0.6 + 5.2, 2.1))) - 0.5) * uWarp * 2.0;
          float md = border(p) / uCells;
          float wn = fbm(vec3(p * 0.45, 7.0));
          float width = uWidth * (0.3 + 1.6 * wn);
          float keep = smoothstep(uKeep - 0.08, uKeep + 0.08, fbm(vec3(p * 0.3 + 11.0, 0.5)));
          float core = smoothstep(width, width * 0.15, md);
          float halo = exp(-md / (width * 3.5 + 0.02));
          float jag = (fbm(vec3(q * 2.5, 3.0)) - 0.5) * 0.45;
          float front = smoothstep(uGrow, uGrow - 0.18, r + jag);
          float edge = smoothstep(1.0, 0.72, r);
          float flick = 0.82 + 0.18 * sin(uTime * 6.0 + p.x * 2.3 + p.y * 1.7) * sin(uTime * 2.3 + wn * 9.0);
          float hotNear = 1.0 + 0.8 * smoothstep(0.6, 0.0, r);
          vec3 col = uHot * core * 3.0 * hotNear + uMid * halo * 0.5;
          gl_FragColor = vec4(col * keep * front * edge * flick * uGain, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.position.set(x, 0, z);
    this.mesh.renderOrder = 4;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(ctx: FxContext): void {
    const env = envelope({ ...this.cue, fadeIn: this.cue.fadeIn ?? 0.0001 }, ctx.t);
    this.mesh.visible = env > 0;
    const u = this.mat.uniforms;
    u.uTime.value = ctx.t;
    const k = Math.max(0, (ctx.t - this.cue.t) / num(this.cue.grow, 1.5));
    u.uGrow.value = (1 - (1 - Math.min(1, k)) ** 2) * 1.3;
    u.uGain.value = num(this.cue.gain, 1) * env;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

class Mist implements Effect {
  private puffs: Billboards;
  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
  ) {
    this.puffs = new Billboards(scene, {
      count: num(cue.count, 60),
      seed: num(cue.seed, 71),
      sprite: 0,
      additive: cue.additive === true,
      decl: 'uniform vec3 uC, uBox, uDrift, uCol; uniform float uSize, uOp;',
      uniforms: {
        uC: { value: new THREE.Vector3() },
        uBox: { value: vec(cue.box, [30, 2, 30]) },
        uDrift: { value: vec(cue.drift, [0.4, 0, 0.15]) },
        uCol: { value: hdr(cue.color ?? '#1a2a1a', num(cue.gain, 1)) },
        uSize: { value: num(cue.size, 3) },
        uOp: { value: 0 },
      },
      renderOrder: 5,
      body: /* glsl */ `
        vec3 p = s1.xyz * uBox + uDrift * (tau + 40.0) * (0.6 + 0.8 * s1.w);
        vec3 rel = mod(p, uBox) - 0.5 * uBox;
        pos = uC + rel;
        vec3 e = abs(rel) / (0.5 * uBox);
        float fade = 1.0 - smoothstep(0.6, 1.0, max(e.x, e.z));
        size = uSize * (0.6 + 0.8 * s2.x);
        col = vec4(uCol, uOp * fade * (0.5 + 0.5 * s2.z));
        rot = s2.y * 6.283 + tau * 0.06 * (s2.w - 0.5);`,
    });
  }

  update(ctx: FxContext): void {
    const env = envelope(this.cue, ctx.t);
    this.puffs.set(ctx.t - this.cue.t, ctx, env > 0);
    this.puffs.u.uOp.value = env * num(this.cue.opacity, 0.35);
    (this.puffs.u.uC.value as THREE.Vector3).copy(ctx.point(this.cue.at));
  }

  dispose(): void {
    this.puffs.dispose();
  }
}

registerEffect('night-cracks', (cue, scene, ground) => new Fissures(cue, scene, ground));
registerEffect('night-mist', (cue, scene) => new Mist(cue, scene));
