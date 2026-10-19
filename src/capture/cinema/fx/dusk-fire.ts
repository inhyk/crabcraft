// The tribute's dusk scene effects: fire that reads as fire, smoke that billows, a fireball with a
// burning trail and a blast at world scale (a hill or a tower, not a crab). Every effect here is a
// pure function of the shot clock and its seed, so a still, a seek and a recording show the same
// frame.
//
//   dusk-fire      layered flame tongues at spots, each with a base glow and its own smoke
//   dusk-plume     a column of smoke rising from a point (lit by fire at its foot)
//   dusk-fireball  a burning ball from `from` to `to` over `d` with a trail that turns to smoke
//   dusk-blast     an impact: flash, fireball, flying debris, dust ring, a rising smoke column
//   dusk-haze      a card over the lens: smoke rolling across the frame, glowing from below
//   dusk-grade     the frame multiplied by a colour (a red grade that keeps the blacks)
//   dusk-hide      scene objects kept hidden every frame
import * as THREE from 'three';
import { curve, envelope, mulberry, NOISE, num, registerEffect, type Effect, type FxContext } from '../fx';
import type { FxCue, V3 } from '../types';

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** A colour as linear RGB numbers, scaled (HDR above 1 feeds the bloom). */
function rgb(hex: unknown, dflt: string, k = 1): [number, number, number] {
  const c = new THREE.Color(String(hex ?? dflt));
  return [c.r * k, c.g * k, c.b * k];
}

const FOG_FS = /* glsl */ `
  #include <fog_pars_fragment>
  float fogK() {
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        return 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      #else
        return smoothstep(fogNear, fogFar, vFogDepth);
      #endif
    #else
      return 0.0;
    #endif
  }
`;

// ------------------------------------------------------------------------------------ puff layers

const PUFF_VS = /* glsl */ `
  attribute vec3 iPos; attribute float iSize; attribute vec4 iCol; attribute vec2 iSeed;
  varying vec2 vUv; varying vec4 vCol; varying float vSeed;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv; vCol = iCol; vSeed = iSeed.x;
    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
    float c = cos(iSeed.y), s = sin(iSeed.y);
    vec2 q = position.xy;
    mv.xy += vec2(c * q.x - s * q.y, s * q.x + c * q.y) * iSize;
    #ifdef USE_FOG
      vFogDepth = -mv.z;
    #endif
    gl_Position = projectionMatrix * mv;
  }`;

const SMOKE_FS = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv; varying vec4 vCol; varying float vSeed;
  ${NOISE}
  ${FOG_FS}
  void main() {
    vec2 q = vUv * 2.0 - 1.0;
    float r = length(q);
    float n = fbm(vec3(q * 1.6 + vSeed * 31.0, uTime * 0.18 + vSeed * 7.0));
    float a = smoothstep(1.0, 0.25, r + (n - 0.5) * 0.95) * vCol.a;
    if (a < 0.004) discard;
    // Billows: lit lobes and darker folds, a little lighter toward the top.
    float shade = 0.62 + 0.7 * n + 0.12 * q.y;
    vec3 c = vCol.rgb * shade;
    c = mix(c, fogColor, fogK() * 0.85);
    gl_FragColor = vec4(c, a);
  }`;

const FIRE_FS = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv; varying vec4 vCol; varying float vSeed;
  ${NOISE}
  ${FOG_FS}
  void main() {
    vec2 q = vUv * 2.0 - 1.0;
    float r = length(q);
    float n = fbm(vec3(q * 2.1 + vSeed * 13.0, uTime * 1.1 + vSeed * 3.0));
    float a = smoothstep(1.0, 0.05, r + (n - 0.5) * 0.85);
    a = a * a * vCol.a;
    if (a < 0.003) discard;
    vec3 c = vCol.rgb * (0.55 + 0.95 * n) + vCol.rgb * smoothstep(0.55, 0.0, r) * 0.5;
    gl_FragColor = vec4(c * (1.0 - fogK() * 0.9), a);
  }`;

/** A batch of camera-facing soft puffs (smoke or fire) the CPU lays out each frame. */
class PuffLayer {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private mat: THREE.ShaderMaterial;
  private stage: Float32Array;
  private attrs: { pos: THREE.InstancedBufferAttribute; size: THREE.InstancedBufferAttribute; col: THREE.InstancedBufferAttribute; seed: THREE.InstancedBufferAttribute };
  private n = 0;
  private v = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private cap: number,
    private additive: boolean,
    renderOrder: number,
  ) {
    const base = new THREE.PlaneGeometry(2, 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    const mk = (w: number) => new THREE.InstancedBufferAttribute(new Float32Array(cap * w), w).setUsage(THREE.DynamicDrawUsage);
    this.attrs = { pos: mk(3), size: mk(1), col: mk(4), seed: mk(2) };
    geo.setAttribute('iPos', this.attrs.pos);
    geo.setAttribute('iSize', this.attrs.size);
    geo.setAttribute('iCol', this.attrs.col);
    geo.setAttribute('iSeed', this.attrs.seed);
    geo.instanceCount = 0;
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
      vertexShader: PUFF_VS,
      fragmentShader: additive ? FIRE_FS : SMOKE_FS,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.stage = new Float32Array(cap * 11);
    scene.add(this.mesh);
  }

  begin(t: number): void {
    this.n = 0;
    this.mat.uniforms.uTime.value = t;
  }

  push(x: number, y: number, z: number, size: number, r: number, g: number, b: number, a: number, seed: number, rot = seed * 40): void {
    if (this.n >= this.cap || a <= 0.002 || size <= 0) return;
    const s = this.stage;
    const o = this.n * 11;
    s[o] = x;
    s[o + 1] = y;
    s[o + 2] = z;
    s[o + 3] = size;
    s[o + 4] = r;
    s[o + 5] = g;
    s[o + 6] = b;
    s[o + 7] = a;
    s[o + 8] = seed;
    s[o + 9] = rot;
    this.n++;
  }

  end(camera: THREE.Camera): void {
    const n = this.n;
    const s = this.stage;
    const order = Array.from({ length: n }, (_, i) => i);
    if (!this.additive) {
      // Back to front, so near smoke covers far smoke.
      const cp = camera.getWorldPosition(this.v);
      for (let i = 0; i < n; i++) s[i * 11 + 10] = (s[i * 11] - cp.x) ** 2 + (s[i * 11 + 1] - cp.y) ** 2 + (s[i * 11 + 2] - cp.z) ** 2;
      order.sort((a, b) => s[b * 11 + 10] - s[a * 11 + 10]);
    }
    const { pos, size, col, seed } = this.attrs;
    const P = pos.array as Float32Array;
    const S = size.array as Float32Array;
    const C = col.array as Float32Array;
    const D = seed.array as Float32Array;
    order.forEach((i, k) => {
      const o = i * 11;
      P.set([s[o], s[o + 1], s[o + 2]], k * 3);
      S[k] = s[o + 3];
      C.set([s[o + 4], s[o + 5], s[o + 6], s[o + 7]], k * 4);
      D.set([s[o + 8], s[o + 9]], k * 2);
    });
    for (const a of [pos, size, col, seed]) {
      a.needsUpdate = true;
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * a.itemSize);
    }
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

/**
 * A plume of smoke: puffs born at `rate` per second from `at`, each rising and swelling over `life`
 * seconds. A pure function of t: puff i is born at t0 + i / rate whatever the frame rate.
 */
interface PlumeOpts {
  rate: number;
  life: number;
  rise: number;
  spread: number;
  size0: number;
  size1: number;
  wind: [number, number];
  color: [number, number, number];
  glow: [number, number, number];
  glowH: number;
  opacity: number;
  prewarm: number;
  seed: number;
}

function plume(layer: PuffLayer, o: PlumeOpts, origin: THREE.Vector3, t: number, t0: number, gain: number, stop = Infinity): void {
  if (gain <= 0) return;
  const first = Math.max(Math.ceil((t - o.life - t0) * o.rate), Math.ceil(-o.prewarm * o.rate));
  const last = Math.floor((Math.min(t, stop) - t0) * o.rate);
  for (let i = first; i <= last; i++) {
    const born = t0 + i / o.rate;
    const age = t - born;
    if (age < 0 || age > o.life) continue;
    const r = mulberry(o.seed * 7919 + i * 31 + 17);
    const k = age / o.life;
    const ang = r() * Math.PI * 2;
    const rad = Math.sqrt(r()) * o.spread;
    const sw = 0.6 + 0.8 * r();
    const h = o.rise * age * (1 - 0.35 * k) * sw;
    const curl = Math.sin(age * 1.3 + r() * 6) * o.spread * 0.6 * k;
    const x = origin.x + Math.cos(ang) * rad * (1 + k) + o.wind[0] * age + curl;
    const z = origin.z + Math.sin(ang) * rad * (1 + k) + o.wind[1] * age + curl * 0.5;
    const y = origin.y + h;
    const size = lerp(o.size0, o.size1, Math.sqrt(k)) * (0.75 + 0.5 * r());
    const a = o.opacity * gain * smooth(k / 0.12) * (1 - k) ** 1.4;
    const lit = 1 - smooth(h / Math.max(0.01, o.glowH));
    const c = o.color;
    const g = o.glow;
    layer.push(x, y, z, size, c[0] + g[0] * lit, c[1] + g[1] * lit, c[2] + g[2] * lit, a, r(), r() * 6.28 + age * (r() - 0.5) * 0.6);
  }
}

function plumeOpts(cue: FxCue, d: Partial<PlumeOpts> = {}): PlumeOpts {
  return {
    rate: num(cue.rate, d.rate ?? 6),
    life: num(cue.life, d.life ?? 6),
    rise: num(cue.rise, d.rise ?? 3),
    spread: num(cue.spread, d.spread ?? 1),
    size0: num(cue.size0, d.size0 ?? 1.2),
    size1: num(cue.size1, d.size1 ?? 5),
    wind: (cue.wind as [number, number]) ?? d.wind ?? [0.8, 0.2],
    color: rgb(cue.color, '#2a211d', 1),
    glow: rgb(cue.glow, '#b8400e', num(cue.glowK, 1.4)),
    glowH: num(cue.glowH, d.glowH ?? 3),
    opacity: num(cue.opacity, d.opacity ?? 0.85),
    prewarm: num(cue.prewarm, d.prewarm ?? 0),
    seed: num(cue.seed, d.seed ?? 5),
  };
}

class Plume implements Effect {
  private layer: PuffLayer;
  private o: PlumeOpts;
  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
  ) {
    this.o = plumeOpts(cue);
    this.layer = new PuffLayer(scene, Math.ceil(this.o.rate * this.o.life) + 4, false, num(cue.order, 5));
  }
  update(ctx: FxContext): void {
    this.layer.begin(ctx.t);
    plume(this.layer, this.o, ctx.point(this.cue.at), ctx.t, this.cue.t, envelope({ ...this.cue, until: undefined }, ctx.t), num(this.cue.until, Infinity));
    this.layer.end(ctx.camera);
  }
  dispose(): void {
    this.layer.dispose();
  }
}

// ----------------------------------------------------------------------------------- flame tongues

const TONGUE_VS = /* glsl */ `
  attribute vec3 aCenter; attribute vec2 aSize; attribute vec2 aSeed;
  uniform float uTime, uGrow;
  varying vec2 vUv; varying vec2 vSeed;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv; vSeed = aSeed;
    vec3 toCam = cameraPosition - aCenter; toCam.y = 0.0;
    vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-5, 0.0, 0.0));
    float s = aSeed.x;
    float fl = 0.86 + 0.1 * sin(uTime * (5.0 + 4.0 * s) + s * 40.0) + 0.07 * sin(uTime * 13.7 + s * 17.0);
    float h = aSize.y * uGrow * fl;
    vec3 p = aCenter + right * position.x * aSize.x * uGrow * (0.92 + 0.08 * sin(uTime * 7.0 + s * 9.0)) + vec3(0.0, position.y * h, 0.0);
    vec4 mv = viewMatrix * vec4(p, 1.0);
    #ifdef USE_FOG
      vFogDepth = -mv.z;
    #endif
    gl_Position = projectionMatrix * mv;
  }`;

const TONGUE_FS = /* glsl */ `
  uniform float uTime, uGain;
  varying vec2 vUv; varying vec2 vSeed;
  ${NOISE}
  ${FOG_FS}
  void main() {
    vec2 uv = vUv;
    float s = vSeed.x;
    float layer = vSeed.y; // 0 back (wide, red), 1 body, 2 core (narrow, hot)
    float n1 = fbm(vec3(uv.x * 2.4 + s * 17.0, uv.y * 1.7 - uTime * 2.3, uTime * 0.45 + s * 5.0));
    float n2 = fbm(vec3(uv.x * 5.5 - s * 3.0, uv.y * 4.2 - uTime * 3.9, uTime * 0.8 + s));
    // Licking sideways more toward the top.
    float x = uv.x - 0.5 + (n1 - 0.5) * 0.6 * uv.y + sin(uv.y * 7.0 - uTime * 6.0 + s * 20.0) * 0.035 * uv.y;
    // Round, wide foot narrowing to a tip; two lobes so it is never one triangle.
    float w = mix(0.4, 0.03, pow(uv.y, 0.7));
    float body = 1.0 - smoothstep(w * 0.45, w, abs(x));
    float lobe = 1.0 - smoothstep(w * 0.2, w * 0.6, abs(x + (n2 - 0.5) * 0.3 - 0.12 * sin(s * 30.0)));
    body = max(body, lobe * smoothstep(0.85, 0.3, uv.y));
    float top = 1.0 - smoothstep(0.3, 1.0, uv.y + (n2 - 0.5) * 0.65);
    float foot = smoothstep(0.0, 0.08, uv.y);
    float heat = body * top * foot;
    // Breaking into tongues and wisps.
    heat *= smoothstep(0.18, 0.55, n2 + 0.38 * (1.0 - uv.y));
    heat = clamp(heat * 1.5, 0.0, 1.0);
    vec3 deep = vec3(0.42, 0.025, 0.0);
    vec3 orange = vec3(1.0, 0.27, 0.02);
    vec3 yellow = vec3(1.0, 0.6, 0.14);
    vec3 white = vec3(1.0, 0.9, 0.62);
    vec3 c = mix(deep, orange, smoothstep(0.0, 0.35, heat));
    c = mix(c, yellow, smoothstep(0.45, 0.85, heat) * (0.25 + 0.35 * layer));
    c = mix(c, white, smoothstep(0.85, 1.0, heat) * (1.0 - uv.y) * (0.15 + 0.35 * max(0.0, layer - 1.0)));
    float k = layer < 0.5 ? 0.5 : (layer < 1.5 ? 0.85 : 1.0);
    if (layer < 0.5) c = mix(c, deep * 1.8, 0.4);
    gl_FragColor = vec4(c * heat * 1.7 * k * uGain * (1.0 - fogK() * 0.9), heat);
  }`;

type Spot = { x: number; z: number; s: number; lift: number; at?: unknown };

/**
 * Flames at spots. Spot: [x, z, scale?, lift?] (lift: units above the ground) or { at: Pt, s }.
 * Params: height, gain, grow ([[t, k]...] scale over time), smoke (opacity, 0 for none), glow,
 * layers (1..3), seed, wind ([x, z] for the smoke).
 */
class Fire implements Effect {
  private mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private geo: THREE.InstancedBufferGeometry;
  private center: THREE.InstancedBufferAttribute;
  private spots: Spot[];
  private quads: { spot: number; dx: number; dz: number; dy: number }[] = [];
  private smoke: PuffLayer | null;
  private glowL: PuffLayer;
  private plume: PlumeOpts;
  private base: THREE.Vector3[] = [];

  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
    private ground: (x: number, z: number) => number,
  ) {
    const h = num(cue.height, 3);
    const rnd = mulberry(num(cue.seed, 3) * 131 + 7);
    const layers = Math.max(1, Math.min(3, Math.round(num(cue.layers, 3))));
    this.spots = ((cue.spots as unknown[]) ?? []).map((s) => {
      if (Array.isArray(s)) return { x: s[0], z: s[1], s: s[2] ?? 1, lift: s[3] ?? 0 };
      const o = s as { at: unknown; s?: number };
      return { x: 0, z: 0, s: o.s ?? 1, lift: 0, at: o.at };
    });
    const sizes: number[] = [];
    const seeds: number[] = [];
    const quadGeo = new THREE.PlaneGeometry(1, 1, 1, 1);
    quadGeo.translate(0, 0.5, 0);
    this.spots.forEach((sp, i) => {
      const hh = h * sp.s * (0.8 + 0.4 * rnd());
      // Back (wide, low, red), body, core (narrow, hot), each a little apart.
      const L: [number, number, number][] = [
        [0.9, 0.78, 0],
        [0.6, 1.0, 1],
        [0.34, 0.6, 2],
      ];
      for (const [w, hk, layer] of layers === 3 ? L : layers === 2 ? [L[0], L[1]] : [L[1]]) {
        const j = rnd();
        this.quads.push({ spot: i, dx: (rnd() - 0.5) * hh * 0.25, dz: (rnd() - 0.5) * hh * 0.25, dy: -0.06 * hh });
        sizes.push(hh * w, hh * hk);
        seeds.push(j, layer);
      }
    });
    const n = this.quads.length;
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quadGeo.index;
    geo.setAttribute('position', quadGeo.getAttribute('position'));
    geo.setAttribute('uv', quadGeo.getAttribute('uv'));
    this.center = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aCenter', this.center);
    geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(new Float32Array(sizes), 2));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(seeds), 2));
    geo.instanceCount = n;
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uGain: { value: 1 }, uGrow: { value: 1 } }]),
      vertexShader: TONGUE_VS,
      fragmentShader: TONGUE_FS,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = num(cue.order, 6);
    scene.add(this.mesh);
    const smokeA = num(cue.smoke, 0.7);
    this.plume = plumeOpts({ t: 0, kind: '', ...((cue.plume as object) ?? {}) }, { rate: 2.2, life: 4.5, rise: 2.2 * h / 3, spread: 0.25 * h, size0: 0.45 * h, size1: 1.8 * h, glowH: 1.6 * h, opacity: smokeA, wind: (cue.wind as [number, number]) ?? [0.6, 0.15], prewarm: 4.5 });
    this.smoke = smokeA > 0 ? new PuffLayer(scene, Math.ceil(this.spots.length * (this.plume.rate * this.plume.life + 2)), false, 5) : null;
    this.glowL = new PuffLayer(scene, this.spots.length * 2, true, 6);
  }

  update(ctx: FxContext): void {
    const env = envelope(this.cue, ctx.t);
    const grow = this.cue.grow ? Math.max(0, curve(this.cue.grow as [number, number][], ctx.t)) : 1;
    const on = env > 0 && grow > 0.001;
    this.mesh.visible = on;
    this.mat.uniforms.uTime.value = ctx.t;
    this.mat.uniforms.uGain.value = env * num(this.cue.gain, 1);
    this.mat.uniforms.uGrow.value = grow;
    // Spot bases (actor-relative spots move).
    this.base = this.spots.map((sp) => {
      if (sp.at !== undefined) return ctx.point(sp.at).clone();
      return new THREE.Vector3(sp.x, this.ground(sp.x, sp.z) + sp.lift, sp.z);
    });
    const C = this.center.array as Float32Array;
    this.quads.forEach((q, i) => {
      const b = this.base[q.spot];
      C[i * 3] = b.x + q.dx;
      C[i * 3 + 1] = b.y + q.dy;
      C[i * 3 + 2] = b.z + q.dz;
    });
    this.center.needsUpdate = true;
    const h = num(this.cue.height, 3);
    this.glowL.begin(ctx.t);
    this.smoke?.begin(ctx.t);
    if (on) {
      const glowK = num(this.cue.glow, 1);
      this.spots.forEach((sp, i) => {
        const b = this.base[i];
        const fl = 0.8 + 0.2 * Math.sin(ctx.t * 9.3 + i * 2.1) * Math.sin(ctx.t * 5.1 + i);
        const s = h * sp.s * grow;
        if (glowK > 0) this.glowL.push(b.x, b.y + s * 0.35, b.z, s * 0.9, 1.0 * glowK * env, 0.32 * glowK * env, 0.05 * glowK * env, 0.35 * fl, i * 0.37);
        if (this.smoke) plume(this.smoke, { ...this.plume, seed: this.plume.seed + i * 13, size0: this.plume.size0 * sp.s, size1: this.plume.size1 * sp.s, rise: this.plume.rise * Math.sqrt(sp.s) }, new THREE.Vector3(b.x, b.y + s * 0.75, b.z), ctx.t, this.cue.t, env * Math.min(1, grow));
      });
    }
    this.glowL.end(ctx.camera);
    this.smoke?.end(ctx.camera);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
    this.smoke?.dispose();
    this.glowL.dispose();
  }
}

// ---------------------------------------------------------------------------------------- fireball

/** Fire colour by age: white-hot, yellow, orange, deep red. */
function fireColor(k: number, out: [number, number, number], hot = 1): [number, number, number] {
  const stops: [number, number, number, number][] = [
    [0, 4.2, 2.9, 1.4],
    [0.15, 3.8, 1.6, 0.3],
    [0.4, 2.5, 0.62, 0.07],
    [0.7, 1.1, 0.18, 0.02],
    [1, 0.3, 0.04, 0.01],
  ];
  const kk = clamp01(k);
  let i = 0;
  while (i < stops.length - 2 && kk > stops[i + 1][0]) i++;
  const a = stops[i];
  const b = stops[i + 1];
  const f = (kk - a[0]) / (b[0] - a[0]);
  out[0] = lerp(a[1], b[1], f) * hot;
  out[1] = lerp(a[2], b[2], f) * hot;
  out[2] = lerp(a[3], b[3], f) * hot;
  return out;
}

class Fireball implements Effect {
  private fire: PuffLayer;
  private smoke: PuffLayer;
  private light: THREE.PointLight;
  private n: number;
  private c: [number, number, number] = [0, 0, 0];
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private p = new THREE.Vector3();

  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
  ) {
    this.n = Math.round(num(cue.trail, 110));
    this.fire = new PuffLayer(scene, this.n + 16, true, 7);
    this.smoke = new PuffLayer(scene, this.n + 4, false, 5);
    this.light = new THREE.PointLight(String(cue.color ?? '#ff7a22'), 0, num(cue.distance, 90), 1.3);
    scene.add(this.light);
  }

  private at(k: number, out: THREE.Vector3): THREE.Vector3 {
    const e = Math.pow(clamp01(k), num(this.cue.accel, 1.5));
    return out.lerpVectors(this.from, this.to, e);
  }

  update(ctx: FxContext): void {
    const cue = this.cue;
    const t0 = cue.t;
    const d = num(cue.d, 1);
    const size = num(cue.size, 1.5);
    const life = num(cue.trailLife, 3);
    this.from.copy(ctx.point(cue.from));
    this.to.copy(ctx.point(cue.to));
    const k = (ctx.t - t0) / d;
    this.fire.begin(ctx.t);
    this.smoke.begin(ctx.t);
    const smokeC = rgb(cue.smoke, '#2b2420');
    const fade = 1 - smooth((ctx.t - (t0 + d)) / num(cue.trailFade, 4));
    for (let j = 0; j < this.n; j++) {
      const kj = j / this.n;
      const born = t0 + d * kj;
      const age = ctx.t - born;
      if (age < 0 || age > life) continue;
      const r = mulberry(num(cue.seed, 9) * 977 + j * 13);
      this.at(kj, this.p);
      const dir = [r() - 0.5, r() - 0.3, r() - 0.5];
      const spread = size * (0.25 + 1.4 * age);
      const x = this.p.x + dir[0] * spread;
      const y = this.p.y + dir[1] * spread + 0.6 * size * age;
      const z = this.p.z + dir[2] * spread;
      const fk = age / num(cue.fireLife, 0.8);
      if (fk < 1) {
        fireColor(fk, this.c, num(cue.hot, 1));
        this.fire.push(x, y, z, size * (1.1 + 1.6 * fk) * (0.7 + 0.6 * r()), this.c[0], this.c[1], this.c[2], (1 - fk) * 0.9, r());
      }
      const sk = age / life;
      if (age > 0.12) {
        const a = num(cue.smokeA, 0.38) * smooth((age - 0.12) / 0.5) * (1 - sk) ** 1.2 * fade;
        const lit = 1 - smooth(age / 1.2);
        this.smoke.push(x, y, z, size * (1.4 + 3.2 * Math.sqrt(sk)) * (0.7 + 0.6 * r()), smokeC[0] + 1.2 * lit, smokeC[1] + 0.35 * lit, smokeC[2] + 0.04 * lit, a, r());
      }
    }
    const live = k >= 0 && k < 1;
    if (live) {
      this.at(k, this.p);
      const hot = num(cue.hot, 1);
      // Head: white core, orange body, red halo, and licks of flame around it.
      this.fire.push(this.p.x, this.p.y, this.p.z, size * 1.3, 7 * hot, 6 * hot, 4.2 * hot, 1, 0.1);
      this.fire.push(this.p.x, this.p.y, this.p.z, size * 2.6, 4 * hot, 1.4 * hot, 0.2 * hot, 0.85, 0.3, ctx.t * 3);
      this.fire.push(this.p.x, this.p.y, this.p.z, size * 5.5, 1.6 * hot, 0.35 * hot, 0.05 * hot, 0.45, 0.5);
      for (let i = 0; i < 8; i++) {
        const r = mulberry(i * 71 + Math.floor(ctx.t * 24));
        this.fire.push(this.p.x + (r() - 0.5) * size * 1.6, this.p.y + (r() - 0.5) * size * 1.6, this.p.z + (r() - 0.5) * size * 1.6, size * (0.9 + r()), 4.5 * hot, 1.6 * hot, 0.25 * hot, 0.7, r());
      }
      this.light.position.copy(this.p);
      this.light.intensity = num(cue.light, 600) * (0.85 + 0.15 * Math.sin(ctx.t * 31));
    } else this.light.intensity = 0;
    this.fire.end(ctx.camera);
    this.smoke.end(ctx.camera);
  }

  dispose(): void {
    this.fire.dispose();
    this.smoke.dispose();
    this.light.removeFromParent();
    this.light.dispose();
  }
}

// ------------------------------------------------------------------------------------------- blast

/**
 * An impact at `at`, sized by `r` (units). Flash (`flashA`, `flashD` seconds, `flashColor`), a
 * fireball that billows out and rises, debris flying on ballistic arcs with burning trails, a ring
 * of dust along the ground, and a column of smoke (`column`: seconds it keeps rising, 0 for none).
 */
class Blast implements Effect {
  private fire: PuffLayer;
  private smoke: PuffLayer;
  private light: THREE.PointLight;
  private c: [number, number, number] = [0, 0, 0];
  private o = new THREE.Vector3();
  private col: PlumeOpts;

  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
    private ground: (x: number, z: number) => number,
  ) {
    this.fire = new PuffLayer(scene, 700, true, 7);
    this.smoke = new PuffLayer(scene, 600, false, 5);
    this.light = new THREE.PointLight(String(cue.color ?? '#ff8a2e'), 0, num(cue.distance, num(cue.r, 4) * 14), 1.2);
    scene.add(this.light);
    const r = num(cue.r, 4);
    this.col = plumeOpts({ t: 0, kind: '', ...((cue.plume as object) ?? {}) }, { rate: 5, life: num(cue.columnLife, 9), rise: r * 1.4, spread: r * 0.5, size0: r * 1.1, size1: r * 4, glowH: r * 2.5, opacity: 0.8, wind: (cue.wind as [number, number]) ?? [r * 0.15, r * 0.05], seed: num(cue.seed, 4) + 99 });
  }

  update(ctx: FxContext): void {
    const cue = this.cue;
    const age = ctx.t - cue.t;
    this.fire.begin(ctx.t);
    this.smoke.begin(ctx.t);
    if (age < 0) {
      this.light.intensity = 0;
      this.fire.end(ctx.camera);
      this.smoke.end(ctx.camera);
      return;
    }
    const at = this.o.copy(ctx.point(cue.at));
    const r = num(cue.r, 4);
    const hot = num(cue.hot, 1);
    const seed = num(cue.seed, 4);
    const fade = 1 - smooth((age - num(cue.until, 1e9)) / 2);
    // Flash on the lens and light on the world.
    const fa = num(cue.flashA, 0.8) * Math.exp(-age / num(cue.flashD, 0.25));
    if (cue.flash !== false && fa > 0.004) ctx.overlay(String(cue.flashColor ?? '#fff1d6'), fa);
    this.light.position.set(at.x, at.y + r * 1.2, at.z);
    this.light.intensity = num(cue.light, 900) * Math.exp(-age / num(cue.lightD, 1.1)) * (0.85 + 0.15 * Math.sin(ctx.t * 27));
    if (age < num(cue.shakeD, 0.8)) ctx.shake(num(cue.shake, 0) * (1 - age / num(cue.shakeD, 0.8)) ** 2);
    const smokeC = rgb(cue.smoke, '#2a221e');
    // Fireball: puffs bursting out over the upper hemisphere, slowing, rising, cooling to smoke.
    const nf = Math.round(num(cue.puffs, 48));
    for (let i = 0; i < nf; i++) {
      const R = mulberry(seed * 1009 + i * 7);
      const th = R() * Math.PI * 2;
      const up = Math.pow(R(), 0.7);
      const dir = [Math.cos(th) * Math.sqrt(1 - up * up), up, Math.sin(th) * Math.sqrt(1 - up * up)];
      const reach = r * (0.9 + 1.6 * R()) * (1 - Math.exp(-age * 4.5));
      const rise = r * 0.55 * age * (0.6 + R());
      const x = at.x + dir[0] * reach;
      const y = at.y + dir[1] * reach * 0.8 + rise + r * 0.15;
      const z = at.z + dir[2] * reach;
      const fl = num(cue.fireLife, 1.3) * (0.7 + 0.6 * R());
      const fk = age / fl;
      const sz = r * (0.45 + 0.5 * R()) * (0.35 + 1.1 * (1 - Math.exp(-age * 3)));
      if (fk < 1) {
        fireColor(fk * 0.95, this.c, hot);
        this.fire.push(x, y, z, sz * 0.8, this.c[0], this.c[1], this.c[2], (1 - fk) ** 0.8 * num(cue.fireA, 0.55), R());
      }
      const sl = num(cue.smokeLife, 7);
      const s0 = fl * 0.18;
      if (age > s0 && age < sl) {
        const sk = (age - s0) / (sl - s0);
        const lit = Math.max(0, 1 - age / (fl * 2.2)) ** 1.5;
        const a = 0.9 * smooth(sk / 0.06) * (1 - sk) ** 1.3 * fade;
        this.smoke.push(x, y + r * 0.5 * sk * 3, z, sz * (1.1 + 1.8 * sk), smokeC[0] + 2.2 * lit, smokeC[1] + 0.6 * lit, smokeC[2] + 0.08 * lit, a, R());
      }
    }
    // Debris: chunks on ballistic arcs, each with a short burning trail.
    const nd = Math.round(num(cue.debris, 36));
    const g = num(cue.gravity, 9.8) * (r / 4);
    for (let i = 0; i < nd; i++) {
      const R = mulberry(seed * 3001 + i * 11);
      const th = R() * Math.PI * 2;
      const up = 0.25 + 0.75 * R();
      const sp = r * (2.2 + 3.5 * R());
      const vx = Math.cos(th) * Math.sqrt(1 - up * up) * sp;
      const vy = up * sp * 1.1;
      const vz = Math.sin(th) * Math.sqrt(1 - up * up) * sp;
      const life = 1.2 + 1.4 * R();
      for (let k = 0; k < 4; k++) {
        const ta = age - k * 0.035;
        if (ta < 0 || ta > life) continue;
        const x = at.x + vx * ta;
        const y = at.y + vy * ta - 0.5 * g * ta * ta;
        const z = at.z + vz * ta;
        if (y < this.ground(x, z) - 0.2) continue;
        const kk = ta / life;
        fireColor(0.1 + 0.6 * kk, this.c, hot);
        this.fire.push(x, y, z, r * (0.09 - k * 0.015) * (0.7 + 0.6 * R()), this.c[0], this.c[1], this.c[2], (1 - kk) * (1 - k * 0.2), R());
        if (k === 0 && i % 2 === 0 && ta > 0.08) this.smoke.push(x, y, z, r * 0.22 * (1 + kk * 2), smokeC[0], smokeC[1], smokeC[2], 0.45 * (1 - kk) * fade, R());
      }
    }
    // Dust ring rolling out along the ground.
    const nr = Math.round(num(cue.ring, 28));
    for (let i = 0; i < nr; i++) {
      const R = mulberry(seed * 4001 + i * 5);
      const th = (i / nr) * Math.PI * 2 + R() * 0.2;
      const reach = r * (0.6 + 3.2 * (1 - Math.exp(-age * 2.2))) * (0.85 + 0.3 * R());
      const x = at.x + Math.cos(th) * reach;
      const z = at.z + Math.sin(th) * reach;
      const y = Math.max(this.ground(x, z), at.y - r) + r * 0.35;
      const k = age / 3.5;
      if (k > 1) continue;
      const dust = rgb(cue.dust, '#4a3528');
      const lit = Math.max(0, 1 - age / 0.7);
      this.smoke.push(x, y, z, r * (0.5 + 0.9 * k), dust[0] + 0.9 * lit, dust[1] + 0.3 * lit, dust[2] + 0.05 * lit, 0.7 * smooth(age / 0.1) * (1 - k) ** 1.5 * fade, R());
    }
    // The column: smoke keeps rising from the impact for `column` seconds.
    const column = num(cue.column, 4);
    if (column > 0) plume(this.smoke, this.col, at, ctx.t, cue.t, fade, cue.t + column);
    this.fire.end(ctx.camera);
    this.smoke.end(ctx.camera);
  }

  dispose(): void {
    this.fire.dispose();
    this.smoke.dispose();
    this.light.removeFromParent();
    this.light.dispose();
  }
}

// ------------------------------------------------------------------------------------ screen cards

/**
 * Smoke over the lens: dark billows (`color`) rolling across a glowing backdrop (`color2`, hottest
 * toward the bottom, `color3`). `alpha` [[t, a]...] covers the frame (1 = nothing shows through);
 * `cover` [[t, c]...] how much of it the billows fill; `flow` [x, y] drift per second.
 */
class Haze implements Effect {
  private mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
  ) {
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: cue.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uA: { value: 0 },
        uCover: { value: 0.6 },
        uBack: { value: num(cue.back, 1) },
        uC1: { value: new THREE.Color(String(cue.color ?? '#1c0604')) },
        uC2: { value: new THREE.Color(String(cue.color2 ?? '#a0240a')) },
        uC3: { value: new THREE.Color(String(cue.color3 ?? '#ff7a1e')) },
        uFlow: { value: new THREE.Vector2(...((cue.flow as [number, number]) ?? [-0.12, 0.05])) },
        uScale: { value: num(cue.scale, 1.6) },
        uAspect: { value: 2.2 },
      },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uA, uCover, uScale, uAspect, uBack; uniform vec3 uC1, uC2, uC3; uniform vec2 uFlow;
        varying vec2 vUv;
        ${NOISE}
        void main() {
          vec2 p = vec2(vUv.x * uAspect, vUv.y) * uScale;
          // The glowing backdrop: hotter low in the frame, breathing.
          float g = fbm(vec3(p * 0.7 - uFlow * uTime * 0.5, uTime * 0.12));
          float low = smoothstep(1.0, 0.0, vUv.y);
          vec3 back = mix(uC2, uC3, clamp(low * 0.8 + (g - 0.5) * 0.9, 0.0, 1.0));
          // Billows: two layers drifting at different speeds.
          float n1 = fbm(vec3(p - uFlow * uTime, uTime * 0.1));
          float n2 = fbm(vec3(p * 1.9 + vec2(4.1, 2.3) - uFlow * uTime * 1.7, uTime * 0.22 + 3.0));
          float d = smoothstep(1.0 - uCover - 0.2, 1.0 - uCover + 0.25, n1 * 0.7 + n2 * 0.45);
          float rim = smoothstep(0.0, 0.5, d) * (1.0 - smoothstep(0.5, 1.0, d));
          vec3 smoke = uC1 * (0.7 + 0.6 * n2) + uC2 * rim * 0.35;
          vec3 c = mix(back, smoke, d);
          float a = uA * mix(d, 1.0, uBack);
          gl_FragColor = vec4(c, a);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = num(cue.order, 999);
    scene.add(this.mesh);
  }

  update(ctx: FxContext): void {
    const a = this.cue.alpha ? curve(this.cue.alpha as [number, number][], ctx.t) : envelope(this.cue, ctx.t);
    this.mesh.visible = a > 0.001;
    const u = this.mat.uniforms;
    u.uTime.value = ctx.t + num(this.cue.offset, 0);
    u.uA.value = a;
    u.uCover.value = this.cue.cover ? curve(this.cue.cover as [number, number][], ctx.t) : 0.6;
    u.uAspect.value = ctx.camera.aspect;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

/** The frame multiplied by `color` (weight `alpha` [[t, a]...] or 1): a grade that keeps blacks. */
class Grade implements Effect {
  private mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private c: THREE.Color;
  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
  ) {
    this.c = new THREE.Color(String(cue.color ?? '#ffb08a'));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.SrcColorFactor,
      uniforms: { uC: { value: new THREE.Color(1, 1, 1) } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `uniform vec3 uC; varying vec2 vUv; void main(){ gl_FragColor = vec4(uC, 1.0); }`,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = num(cue.order, 1000);
    scene.add(this.mesh);
  }
  update(ctx: FxContext): void {
    const a = this.cue.alpha ? curve(this.cue.alpha as [number, number][], ctx.t) : envelope(this.cue, ctx.t);
    this.mesh.visible = a > 0.001;
    (this.mat.uniforms.uC.value as THREE.Color).setRGB(1, 1, 1).lerp(this.c, clamp01(a));
  }
  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}


/**
 * Keeps named scene objects hidden every frame (the game shows some quest props again each frame,
 * so the stage's one-off `hide` does not hold for them). `names`: object names.
 */
class Hide implements Effect {
  private objs: THREE.Object3D[] | null = null;
  constructor(
    private cue: FxCue,
    private scene: THREE.Scene,
  ) {}
  update(): void {
    if (!this.objs) {
      const names = new Set((this.cue.names as string[]) ?? []);
      this.objs = [];
      this.scene.traverse((o) => {
        if (names.has(o.name)) this.objs!.push(o);
      });
    }
    for (const o of this.objs) o.visible = false;
  }
  dispose(): void {
    for (const o of this.objs ?? []) o.visible = true;
  }
}

registerEffect('dusk-fire', (cue, scene, ground) => new Fire(cue, scene, ground));
registerEffect('dusk-plume', (cue, scene) => new Plume(cue, scene));
registerEffect('dusk-fireball', (cue, scene) => new Fireball(cue, scene));
registerEffect('dusk-blast', (cue, scene, ground) => new Blast(cue, scene, ground));
registerEffect('dusk-haze', (cue, scene) => new Haze(cue, scene));
registerEffect('dusk-grade', (cue, scene) => new Grade(cue, scene));
registerEffect('dusk-hide', (cue, scene) => new Hide(cue, scene));

export type { V3 };
