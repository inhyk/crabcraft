// Building blocks for the night scene's effects (night-look.ts, night-impact.ts): camera-facing
// particles whose every attribute is a GLSL function of the cue's clock (so any frame renders on its
// own, like fx.ts's volumes), lumpy rocks with glowing cracks, and the scene fog for both.
import * as THREE from 'three';
import { mulberry, NOISE, num, type FxContext } from '../fx';
import type { FxCue } from '../types';

/** Noise plus a few hashes and a direction from two uniforms. */
export const GLSL = /* glsl */ `
  ${NOISE}
  vec3 h33(vec3 p){ p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
  vec3 dirFrom(vec2 s){ float z = s.x * 2. - 1.; float a = s.y * 6.2831853; float r = sqrt(max(0., 1. - z * z)); return vec3(r * cos(a), z, r * sin(a)); }
`;

const FOG_GLSL = /* glsl */ `
  uniform vec3 uFogColor; uniform float uFogMode, uFogA, uFogB;
  float fogAmount(float d){
    if (uFogMode < 0.5) return 0.;
    if (uFogMode < 1.5) return 1. - exp(-uFogA * uFogA * d * d);
    return smoothstep(uFogA, uFogB, d);
  }
`;

export function fogUniforms(): Record<string, THREE.IUniform> {
  return { uFogColor: { value: new THREE.Color() }, uFogMode: { value: 0 }, uFogA: { value: 0 }, uFogB: { value: 1 } };
}

/** Copy the scene's fog (exponential or linear) into a material's fog uniforms. */
export function syncFog(u: Record<string, THREE.IUniform>, scene: THREE.Scene, k = 1): void {
  const f = scene.fog;
  if (f instanceof THREE.FogExp2) {
    u.uFogMode.value = 1;
    u.uFogA.value = f.density * k;
    (u.uFogColor.value as THREE.Color).copy(f.color);
  } else if (f instanceof THREE.Fog) {
    u.uFogMode.value = 2;
    u.uFogA.value = f.near / Math.max(k, 1e-3);
    u.uFogB.value = f.far / Math.max(k, 1e-3);
    (u.uFogColor.value as THREE.Color).copy(f.color);
  } else u.uFogMode.value = 0;
}

export const hdr = (hex: unknown, k: number, d = '#ffffff') => new THREE.Color(String(hex ?? d)).multiplyScalar(k);
export const vec = (v: unknown, d: [number, number, number]) => new THREE.Vector3(...(Array.isArray(v) && v.length === 3 ? (v as [number, number, number]) : d));

export interface BillboardOpts {
  count: number;
  seed?: number;
  /**
   * GLSL statements run per particle with `tau` (the cue's clock), `idx` (0..1), `s1`, `s2` (random
   * vec4s); they set `pos` (world), `size` (half width, units), `col` (rgb, HDR; a = alpha), and
   * either `rot` (radians) or `vel` (world velocity) with `stretch` (seconds of travel the streak spans).
   */
  body: string;
  uniforms?: Record<string, THREE.IUniform>;
  /** Extra GLSL declarations (uniforms, functions) for the vertex shader. */
  decl?: string;
  /** Sprite: 0 noisy puff, 1 spark streak, 2 soft glow, 3 ring. */
  sprite?: 0 | 1 | 2 | 3;
  additive?: boolean;
  fog?: boolean;
  depthTest?: boolean;
  /** Write depth (small sharp particles under depth of field, which reads the depth buffer). */
  depthWrite?: boolean;
  /**
   * Draw both faces. A `stretch` streak's corner basis (n, d) is mirrored, so its quad winds backwards
   * and single-sided streaks are culled; opt in here rather than change every older effect's look.
   */
  doubleSide?: boolean;
  renderOrder?: number;
}

/** Camera-facing particles, one instanced quad each, placed by a GLSL function of time. */
export class Billboards {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  private fog: boolean;
  constructor(scene: THREE.Scene, o: BillboardOpts) {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const rnd = mulberry(o.seed ?? 11);
    const s1 = new Float32Array(o.count * 4);
    const s2 = new Float32Array(o.count * 4);
    const ix = new Float32Array(o.count);
    for (let i = 0; i < o.count; i++) {
      for (let k = 0; k < 4; k++) {
        s1[i * 4 + k] = rnd();
        s2[i * 4 + k] = rnd();
      }
      ix[i] = o.count > 1 ? i / (o.count - 1) : 0;
    }
    geo.setAttribute('aS1', new THREE.InstancedBufferAttribute(s1, 4));
    geo.setAttribute('aS2', new THREE.InstancedBufferAttribute(s2, 4));
    geo.setAttribute('aIdx', new THREE.InstancedBufferAttribute(ix, 1));
    geo.instanceCount = o.count;
    this.fog = o.fog ?? true;
    const additive = o.additive ?? true;
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: o.depthWrite ?? false,
      depthTest: o.depthTest ?? true,
      side: o.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      defines: { SPRITE: o.sprite ?? 0, ADDITIVE: additive ? 1 : 0 },
      uniforms: { uTime: { value: 0 }, ...fogUniforms(), ...(o.uniforms ?? {}) },
      vertexShader: /* glsl */ `
        attribute vec4 aS1; attribute vec4 aS2; attribute float aIdx;
        uniform float uTime;
        ${FOG_GLSL}
        ${GLSL}
        ${o.decl ?? ''}
        varying vec2 vUv; varying vec4 vCol; varying vec4 vS; varying float vFog;
        void main(){
          float tau = uTime; float idx = aIdx; vec4 s1 = aS1; vec4 s2 = aS2;
          vec3 pos = vec3(0.); float size = 0.; vec4 col = vec4(1.); float rot = 0.; vec3 vel = vec3(0., 1., 0.); float stretch = 0.;
          ${o.body}
          vec4 mv = viewMatrix * vec4(pos, 1.0);
          vec2 c = position.xy;
          if (stretch > 0.0) {
            vec2 sv = (viewMatrix * vec4(vel, 0.0)).xy;
            float L = length(sv);
            vec2 d = L > 1e-5 ? sv / L : vec2(0., 1.);
            vec2 n = vec2(-d.y, d.x);
            c = n * c.x * size + d * c.y * (size + stretch * L * 0.5);
          } else {
            float cs = cos(rot), sn = sin(rot);
            c = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * size;
          }
          mv.xy += c;
          gl_Position = projectionMatrix * mv;
          if (size <= 0.0 || col.a <= 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          vUv = position.xy * 0.5 + 0.5; vCol = col; vS = s1;
          vFog = fogAmount(-mv.z);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        ${FOG_GLSL}
        ${NOISE}
        varying vec2 vUv; varying vec4 vCol; varying vec4 vS; varying float vFog;
        void main(){
          vec2 q = vUv * 2. - 1.; float r = length(q);
          vec3 c = vCol.rgb; float a;
          #if SPRITE == 0
            float n = fbm(vec3(q * 1.7 + vS.xy * 23., uTime * 0.4 + vS.z * 11.));
            a = smoothstep(1.0, 0.3, r + (n - 0.5) * 1.1);
            c *= 0.55 + 0.9 * n;
          #elif SPRITE == 1
            a = exp(-q.x * q.x * 5.) * smoothstep(1.0, 0.3, abs(q.y)) * (0.6 + 0.4 * (q.y + 1.0) * 0.5);
          #elif SPRITE == 2
            a = pow(max(0., 1. - r), 2.4);
          #else
            a = smoothstep(0.72, 0.86, r) * smoothstep(1.0, 0.9, r);
          #endif
          a *= vCol.a;
          if (a < 0.003) discard;
          #if ADDITIVE == 1
            gl_FragColor = vec4(c * (1.0 - vFog), a);
          #else
            gl_FragColor = vec4(mix(c, uFogColor, vFog), a);
          #endif
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = o.renderOrder ?? 7;
    scene.add(this.mesh);
  }

  get u(): Record<string, THREE.IUniform> {
    return this.mat.uniforms;
  }

  /** Put the particles at the cue's local time `tau`; hidden before it starts. */
  set(tau: number, ctx: FxContext, visible = true): void {
    this.mesh.visible = visible && tau >= 0;
    this.mat.uniforms.uTime.value = tau;
    if (this.fog) syncFog(this.mat.uniforms, ctx.scene);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

/**
 * Lumpy faceted rocks with molten cracks (an infernal's boulders, a meteor's core, flying debris).
 * Each instance has a glow; positions and turns are set per frame by the owner.
 */
export class Rocks {
  readonly mesh: THREE.InstancedMesh;
  readonly mat: THREE.ShaderMaterial;
  private glow: THREE.InstancedBufferAttribute;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  constructor(scene: THREE.Scene, count: number, cue: FxCue, seed = 5) {
    const geo = new THREE.IcosahedronGeometry(1, 3);
    const rnd = mulberry(seed);
    const sd = new Float32Array(count * 4);
    for (let i = 0; i < sd.length; i++) sd[i] = rnd();
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(sd, 4));
    this.glow = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    geo.setAttribute('aGlow', this.glow);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uBase: { value: new THREE.Color(String(cue.rock ?? '#1c1712')) },
        uCrack: { value: hdr(cue.crack ?? '#ffc23a', 1) },
        uCrack2: { value: hdr(cue.crack2 ?? '#8dff3a', 1) },
        uKeyDir: { value: vec(cue.keyDir, [-0.35, 0.55, 0.76]).normalize() },
        uKey: { value: hdr(cue.key ?? '#8a90b8', num(cue.keyK, 0.9)) },
        uAmb: { value: hdr(cue.amb ?? '#2a2f3a', num(cue.ambK, 0.6)) },
        uHeatPos: { value: new THREE.Vector3() },
        uHeatCol: { value: hdr(cue.heatColor ?? '#ffd27a', 1) },
        uHeat: { value: 0 },
        uCells: { value: num(cue.cells, 2.2) },
        ...fogUniforms(),
      },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed; attribute float aGlow;
        ${FOG_GLSL}
        ${GLSL}
        varying vec3 vObj; varying vec3 vWorld; varying float vGlow; varying vec4 vSeed; varying float vFog;
        void main(){
          vec3 p = position;
          float n = fbm(p * 1.2 + aSeed.xyz * 10.);
          p *= 0.7 + 0.6 * n;
          p.y *= 0.75 + 0.35 * aSeed.w;
          vObj = p; vGlow = aGlow; vSeed = aSeed;
          vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
          vWorld = w.xyz;
          vec4 mv = viewMatrix * w;
          gl_Position = projectionMatrix * mv;
          vFog = fogAmount(-mv.z);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uBase, uCrack, uCrack2, uKeyDir, uKey, uAmb, uHeatPos, uHeatCol; uniform float uHeat, uCells;
        ${FOG_GLSL}
        ${GLSL}
        varying vec3 vObj; varying vec3 vWorld; varying float vGlow; varying vec4 vSeed; varying float vFog;
        void main(){
          vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
          vec3 p = vObj * uCells + vSeed.xyz * 7.;
          vec3 i = floor(p), f = fract(p);
          float d1 = 9., d2 = 9.;
          for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec3 g = vec3(float(x), float(y), float(z));
            float d = length(g + h33(i + g) - f);
            if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
          }
          float n = fbm(vObj * 3.1 + vSeed.yzx * 5.);
          float edge = 1. - smoothstep(0.0, 0.07 + 0.08 * n, d2 - d1);
          float crack = edge * smoothstep(0.32, 0.55, n);
          float grain = 0.55 + 0.6 * fbm(vObj * 7.0 + 2.0);
          vec3 base = uBase * grain;
          vec3 col = base * (uAmb + uKey * max(0., dot(N, uKeyDir)));
          vec3 toH = uHeatPos - vWorld; float dh = length(toH);
          col += base * uHeatCol * uHeat * max(0., dot(N, toH / max(dh, 1e-3))) / (1. + dh * dh * 0.01);
          vec3 cc = mix(uCrack, uCrack2, smoothstep(0.35, 0.75, fbm(vObj * 1.4 + 3.0)));
          col += cc * (crack * 6.0 + smoothstep(0.55, 0.9, n) * 0.35) * vGlow;
          col = mix(col, uFogColor, vFog);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
  }

  set(i: number, pos: THREE.Vector3, rot: THREE.Euler, scale: number, glow: number): void {
    this.q.setFromEuler(rot);
    this.s.setScalar(Math.max(1e-4, scale));
    this.m.compose(pos, this.q, this.s);
    this.mesh.setMatrixAt(i, this.m);
    this.glow.setX(i, glow);
  }

  commit(ctx: FxContext): void {
    this.mesh.instanceMatrix.needsUpdate = true;
    this.glow.needsUpdate = true;
    syncFog(this.mat.uniforms, ctx.scene);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

/** A quad over the whole view (clip space), drawn after the scene's transparent objects. */
export function screenQuad(mat: THREE.ShaderMaterial, renderOrder: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  return mesh;
}

export const SCREEN_VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** Piecewise-linear [t, v] pairs, or a constant. */
export function track(v: unknown, t: number, d: number): number {
  if (typeof v === 'number') return v;
  if (!Array.isArray(v) || !v.length) return d;
  const p = v as [number, number][];
  if (t <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++) if (t <= p[i][0]) return p[i - 1][1] + (p[i][1] - p[i - 1][1]) * ((t - p[i - 1][0]) / Math.max(1e-6, p[i][0] - p[i - 1][0]));
  return p[p.length - 1][1];
}
