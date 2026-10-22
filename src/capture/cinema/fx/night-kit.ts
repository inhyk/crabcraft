// Building blocks for the night scene's effects (night-look.ts, night-impact.ts): camera-facing
// particles whose every attribute is a GLSL function of the cue's clock (so any frame renders on its
// own, like fx.ts's volumes), chipped boulders with molten veins, and the scene fog for both.
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

/** Clods and dust puffs per rock breaking out of the ground. */
const DEBRIS_CLODS = 9;
const DEBRIS_DUST = 3;

/**
 * Chipped basalt boulders with molten veins (an infernal's boulders, a meteor's core, flying debris).
 * Each instance is a seeded lump sheared flat by a few planes (big cuts, then chips off its edges),
 * so every rock has its own faceted silhouette for good. The veins are branching cracks of varying
 * width (warped noise isolines: wide trunks with white-hot deep stretches, thin offshoots near them),
 * HDR, with a slow pulse running along them. Each instance has a glow; positions and turns are set
 * per frame by the owner. With `emerge` (on by default for night-rocks) a rock breaking out of the
 * ground pops clods and dust off its hole and leaves the broken earth lying round it, all read off its
 * height over the ground each frame (seek-safe).
 *   rock, crack (vein, white-hot at its core), crack2 (the glow round the veins), cells (vein scale),
 *   lump, cut (0..1 how hard the planes shear it, default 1), bump, vein (vein brightness, default 1),
 *   dirt (clod colour)
 */
export class Rocks {
  readonly mesh: THREE.InstancedMesh;
  readonly mat: THREE.ShaderMaterial;
  private glow: THREE.InstancedBufferAttribute;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  /** Per instance: x, y, z, radius (for the emergence debris). */
  private at: Float32Array;
  private debris: Billboards | null = null;
  constructor(scene: THREE.Scene, count: number, cue: FxCue, seed = 5) {
    const geo = new THREE.IcosahedronGeometry(1, Math.max(2, num(cue.detail, 3)));
    const rnd = mulberry(seed);
    const sd = new Float32Array(count * 4);
    for (let i = 0; i < sd.length; i++) sd[i] = rnd();
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(sd, 4));
    this.glow = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    geo.setAttribute('aGlow', this.glow);
    this.at = new Float32Array(count * 4);
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
        uRim: { value: hdr(cue.rim ?? '#000000', num(cue.rimK, 1)) },
        uLump: { value: num(cue.lump, 0.6) },
        uCut: { value: num(cue.cut, 1) },
        uBump: { value: num(cue.bump, 1) },
        uVein: { value: num(cue.vein, 1) },
        uTime: { value: 0 },
        ...fogUniforms(),
      },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed; attribute float aGlow; uniform float uLump, uCut;
        ${FOG_GLSL}
        ${GLSL}
        varying vec3 vObj; varying vec3 vWorld; varying float vGlow; varying vec4 vSeed; varying float vFog;
        void main(){
          vec3 p = position;
          float n = fbm(p * 1.2 + aSeed.xyz * 10.);
          p *= 1.0 - uLump * 0.5 + uLump * n;
          // Shear it flat: five big cuts, then six chips off its edges, each plane seeded per rock.
          for (int k = 0; k < 11; k++) {
            vec3 h = h33(aSeed.xyz * 91.7 + aSeed.w * 13.1 + float(k) * vec3(3.17, 5.71, 7.13));
            vec3 dir = dirFrom(h.xy);
            float d = mix(1.6, k < 5 ? 0.5 + 0.22 * h.z : 0.76 + 0.14 * h.z, uCut);
            p -= dir * max(0., dot(p, dir) - d);
          }
          p *= vec3(0.9 + 0.22 * aSeed.x, 0.75 + 0.35 * aSeed.w, 0.9 + 0.22 * aSeed.z);
          vObj = p; vGlow = aGlow; vSeed = aSeed;
          vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
          vWorld = w.xyz;
          vec4 mv = viewMatrix * w;
          gl_Position = projectionMatrix * mv;
          vFog = fogAmount(-mv.z);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uBase, uCrack, uCrack2, uKeyDir, uKey, uAmb, uHeatPos, uHeatCol, uRim; uniform float uHeat, uCells, uBump, uVein, uTime;
        ${FOG_GLSL}
        ${GLSL}
        varying vec3 vObj; varying vec3 vWorld; varying float vGlow; varying vec4 vSeed; varying float vFog;
        // Distance to the nearest cell border, and two hashes of that border (its cells' pair).
        vec3 crackNet(vec3 p){
          vec3 i = floor(p), f = fract(p);
          float d1 = 9., d2 = 9.; vec3 r1 = vec3(0.), r2 = vec3(0.), c1 = vec3(0.), c2 = vec3(0.);
          for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec3 g = vec3(float(x), float(y), float(z));
            vec3 r = g + h33(i + g) - f; float d = dot(r, r);
            if (d < d1) { d2 = d1; r2 = r1; c2 = c1; d1 = d; r1 = r; c1 = i + g; }
            else if (d < d2) { d2 = d; r2 = r; c2 = i + g; }
          }
          vec3 h = h33(c1 + c2 + abs(c1 - c2) * 0.37 + 0.13);
          return vec3(dot(0.5 * (r1 + r2), normalize(r2 - r1)), h.x, h.y);
        }
        void main(){
          vec3 dpx = dFdx(vWorld), dpy = dFdy(vWorld);
          vec3 Nf = normalize(cross(dpx, dpy));
          vec3 q = vObj * uCells + vSeed.xyz * 7.;
          // Veins: the borders of big warped cells, about half of them shut (so they branch and end
          // instead of closing into a grid), each its own width, deepest (white-hot) in the widest; thin
          // offshoots off a finer net only near an open trunk.
          vec3 wq = q + (vec3(vnoise(q * 0.7), vnoise(q * 0.7 + 17.3), vnoise(q * 0.7 + 31.7)) - 0.5) * 0.8;
          vec3 T = crackNet(wq * 0.7);
          T.x += (vnoise(q * 9.1) - 0.5) * 0.05 + (vnoise(q * 21.) - 0.5) * 0.025;
          vec3 B = crackNet(wq * 2.0 + 5.3);
          B.x += (vnoise(q * 13.) - 0.5) * 0.04;
          float wobble = 0.75 + 0.5 * vnoise(q * 2.3 + 11.);
          float wT = (0.018 + 0.085 * T.z * T.z) * wobble * step(T.y, 0.62);
          float trunk = 1. - smoothstep(wT * 0.5, wT, max(T.x, 0.));
          float near = step(T.y, 0.62) * (1. - smoothstep(0.05, 0.32, T.x));
          float shoot = (1. - smoothstep(0.012, 0.03 + 0.03 * B.z, B.x)) * step(B.y, 0.5) * near;
          float vein = max(trunk, shoot * 0.8);
          float prof = trunk * clamp(1. - T.x / max(wT, 1e-3), 0., 1.);
          float core = (1. - smoothstep(0., wT * 0.45, T.x)) * smoothstep(0.35, 0.8, T.z) * step(T.y, 0.62);
          float halo = (1. - smoothstep(0., 0.3, T.x)) * step(T.y, 0.62);
          // Rough basalt: pitted grain, grooves along the veins (bumped normal).
          float g1 = fbm(vObj * 3.3 + vSeed.zxy * 5.), g2 = fbm(vObj * 11. + 2.);
          float hgt = g1 * 0.07 + g2 * 0.025 - vein * 0.045 - halo * 0.02;
          vec3 r1 = cross(dpy, Nf), r2 = cross(Nf, dpx);
          float det = dot(dpx, r1);
          vec3 sg = sign(det) * (dFdx(hgt) * r1 + dFdy(hgt) * r2);
          vec3 N = normalize(abs(det) * Nf - uBump * sg);
          float grain = 0.5 + 0.7 * g1 * (0.7 + 0.6 * g2);
          vec3 tint = mix(vec3(0.82, 0.86, 0.8), vec3(1.2, 1.02, 0.86), fbm(vObj * 1.6 + vSeed.wxy * 4.));
          vec3 base = uBase * grain * tint * (1. - 0.45 * halo * (1. - vein));
          vec3 col = base * (uAmb + uKey * max(0., dot(N, uKeyDir)));
          // Wet-looking sheen on some faces, chalky on others.
          vec3 V = normalize(cameraPosition - vWorld);
          float rough = smoothstep(0.35, 0.7, fbm(q * 0.7 + 50.));
          col += uKey * pow(max(0., dot(N, normalize(uKeyDir + V))), mix(5., 36., rough)) * mix(0.015, 0.16, rough) * grain;
          vec3 toH = uHeatPos - vWorld; float dh = length(toH);
          col += base * uHeatCol * uHeat * max(0., dot(N, toH / max(dh, 1e-3))) / (1. + dh * dh * 0.01);
          col += uRim * pow(1. - abs(dot(N, V)), 3.0) * grain;
          // Molten veins: white-hot where deepest, a pulse creeping along them, the rock round them aglow.
          float pulse = 0.68 + 0.32 * sin(fbm(q * 0.35 + 61.) * 18. - uTime * 1.7 + vSeed.w * 6.2831853);
          vec3 hot = mix(uCrack, vec3(max(uCrack.r, max(uCrack.g, uCrack.b))) * vec3(1., 0.96, 0.85), 0.65);
          vec3 e = mix(uCrack * vec3(1., 0.62, 0.3) * 2.5, uCrack * 6.5, prof) * vein + hot * core * 14.0 + mix(uCrack, uCrack2, 0.65) * halo * halo * 0.7;
          // Lit from beneath by its own heat (the hole it climbs out of, the fire round it).
          e += uCrack * (0.05 + 0.1 * halo) * pow(max(0., -N.y), 2.);
          col += e * uVein * vGlow * pulse;
          col = mix(col, uFogColor, vFog);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    if (cue.emerge ?? cue.kind === 'night-rocks') this.debris = this.makeDebris(scene, count, cue);
  }

  /** Clods and dust for each rock, placed in GLSL off its base point and how far it is out of the ground. */
  private makeDebris(scene: THREE.Scene, count: number, cue: FxCue): Billboards {
    const per = DEBRIS_CLODS + DEBRIS_DUST;
    const total = count * per;
    return new Billboards(scene, {
      count: total,
      seed: 37,
      sprite: 0,
      additive: false,
      renderOrder: 6,
      decl: `uniform vec4 uRk[${count}]; uniform vec2 uEm[${count}]; uniform vec3 uDirt, uDust, uLava;`,
      uniforms: {
        uRk: { value: [...Array(count)].map(() => new THREE.Vector4()) },
        uEm: { value: [...Array(count)].map(() => new THREE.Vector2()) },
        uDirt: { value: new THREE.Color(String(cue.dirt ?? '#2a2519')) },
        uDust: { value: new THREE.Color(String(cue.dust ?? '#3b3a2a')) },
        uLava: { value: hdr(cue.crack ?? '#ffc23a', 1) },
      },
      body: /* glsl */ `
        int i = int(idx * ${total - 1}. + 0.5);
        int rk = i / ${per}; int j = i - rk * ${per};
        vec4 R = uRk[rk]; vec2 E = uEm[rk];
        float e = E.x;
        if (R.w > 0.0 && e > 0.002 && E.y > 0.002) {
          float ang = s1.x * 6.2831853;
          vec3 dir = vec3(cos(ang), 0., sin(ang));
          if (j < ${DEBRIS_CLODS}) {
            // Thrown off the hole in the first third of its climb, then lying round it.
            float k = clamp((e / 0.34 - s1.y * 0.4) / 0.6, 0., 1.);
            float reach = R.w * (0.75 + 0.2 * s1.z + (0.35 + 0.9 * s1.w) * k);
            size = R.w * (0.07 + 0.11 * s2.y * s2.y);
            pos = R.xyz + dir * reach + vec3(0., size * 0.55 + R.w * (0.25 + 1.0 * s2.x) * 4. * k * (1. - k), 0.);
            rot = s2.z * 6.2831853 + k * (s2.w - 0.5) * 9.;
            vec3 c = uDirt * (0.55 + 0.7 * s2.w);
            col = vec4(c + uLava * 0.25 * (1. - k) * step(0.5, s1.z), E.y);
          } else {
            // A dust puff billowing off the break and settling.
            float k = clamp(e / 0.55 - s1.y * 0.25, 0., 1.);
            pos = R.xyz + dir * R.w * (0.55 + 1.1 * k) + vec3(0., R.w * (0.15 + 0.8 * k), 0.);
            size = R.w * (0.3 + 0.55 * k) * (0.8 + 0.4 * s2.x);
            rot = s2.y * 6.2831853 + tau * 0.2;
            col = vec4(uDust * (0.8 + 0.4 * s2.z), 0.26 * sin(3.14159 * k) * E.y);
          }
        }`,
    });
  }

  set(i: number, pos: THREE.Vector3, rot: THREE.Euler, scale: number, glow: number): void {
    this.q.setFromEuler(rot);
    this.s.setScalar(Math.max(1e-4, scale));
    this.m.compose(pos, this.q, this.s);
    this.mesh.setMatrixAt(i, this.m);
    this.glow.setX(i, glow);
    this.at.set([pos.x, pos.y, pos.z, scale], i * 4);
  }

  /** Place instance `i` with a turn and a per-axis scale (stretched rocks: ribs, claws). */
  setScaled(i: number, pos: THREE.Vector3, rot: THREE.Quaternion, scale: THREE.Vector3, glow: number): void {
    this.m.compose(pos, rot, this.s.copy(scale).max(new THREE.Vector3(1e-4, 1e-4, 1e-4)));
    this.mesh.setMatrixAt(i, this.m);
    this.glow.setX(i, glow);
    this.at.set([pos.x, pos.y, pos.z, (scale.x + scale.y + scale.z) / 3], i * 4);
  }

  commit(ctx: FxContext): void {
    if (this.debris) {
      // How far each rock is out of the ground (0 buried .. 1 clear of it); a breaking rock glows hotter.
      const u = this.debris.u;
      const rk = u.uRk.value as THREE.Vector4[];
      const em = u.uEm.value as THREE.Vector2[];
      let any = false;
      for (let i = 0; i < rk.length; i++) {
        const [x, y, z, s] = this.at.subarray(i * 4, i * 4 + 4);
        const r = s * 0.95;
        const g = ctx.ground(x, z);
        const e = r > 0.01 ? Math.min(1, Math.max(0, (y - g + r) / (2 * r))) : 0;
        // Gone once the rock is well up off its hole (flown away, thrown).
        const keep = 1 - THREE.MathUtils.smoothstep(y - g, 2.2 * r + 1.2, 4 * r + 2.6);
        rk[i].set(x, g, z, r > 0.01 ? r : 0);
        em[i].set(e, keep);
        if (e > 0.002 && keep > 0.002) {
          any = true;
          if (e < 1) this.glow.setX(i, this.glow.getX(i) * (1 + 1.3 * (1 - e)));
        }
      }
      this.debris.set(ctx.t, ctx, any && this.mesh.visible);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.glow.needsUpdate = true;
    this.mat.uniforms.uTime.value = ctx.t;
    syncFog(this.mat.uniforms, ctx.scene);
  }

  dispose(): void {
    this.debris?.dispose();
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
