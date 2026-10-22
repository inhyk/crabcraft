// night-blight: the undead's step and the corruption spreading out of it. Everything is a function of
// the blight's clock, so any frame renders on its own.
//
//   night-blight { at: [x, z], t, radius, dur, rate, jag, ... }
//       Out of the step `lead` long winding veins split the ground first, each tip running out at about
//       `speed` units/s and slowing; they are recessed (charred lips either side, a hot core shifted to the
//       far wall, white-hot at the tip) and vary in width along their length. `branches` fork off them a
//       little later, `rays` more veins leave the step later still. The ground rots outward from each vein
//       at `lat` units/s, and a finer crack net opens there `netDelay` s after the rot, so early on it
//       only shows near the veins. A radial front (r = radius (1 - e^(-rate k)) / (1 - e^-rate),
//       k = (time - lag) / dur; `jag` ruffles it) follows `lag` s behind and rots the rest, so the
//       network is wide round him later. Grass dries, flares and droops as the rot reaches it and glows
//       near the veins, pebbles twitch, embers rise off the vein tips and smoke off the rot.
//       `step` (shot seconds) puffs dust and kicks grit out of the step.
//   params: aim [x, z] (the veins fan round the direction to it: the lens), lead, branches, rays, speed,
//           width (vein width), lat, lag, netDelay, cells, warp, keep, hot, mid, rot, gain, grass (clumps),
//           pebbles, embers, smoke, clear [[x, z, r]...] (no grass there: the lens), light (peak of the
//           warm lights), dust
import * as THREE from 'three';
import { num, registerEffect, mulberry, type Effect, type FxContext } from '../fx';
import type { FxCue } from '../types';
import { Billboards, GLSL, Rocks, fogUniforms, hdr, syncFog } from './night-kit';

/** One vein: base angle, start distance and time, length, tip speed, width, drift, glow, wiggle. */
interface Vein {
  th: number;
  d0: number;
  t0: number;
  L: number;
  v: number;
  w: number;
  k: number;
  glow: number;
  a: [number, number, number, number];
  p: [number, number, number, number];
}

/** The veins' path and growth, the same formulas the shaders run (BLIGHT below). */
const vTh = (V: Vein, x: number) =>
  V.th +
  V.k * x +
  Math.min(1, x * 1.5) * (V.a[0] * Math.sin(0.55 * x + V.p[0]) + V.a[1] * Math.sin(1.6 * x + V.p[1])) +
  (Math.min(1, x * 4) * (V.a[2] * Math.sin(6.5 * x + V.p[2]) + V.a[3] * Math.sin(19 * x + V.p[3]))) / (V.d0 + x + 0.25);
const vTip = (V: Vein, tau: number) => (tau <= V.t0 ? -1 : V.L * (1 - Math.exp((-(tau - V.t0) * V.v) / V.L)));
const vPass = (V: Vein, x: number) => {
  const q = 1 - x / V.L;
  return q <= 1e-3 ? 1e4 : V.t0 - (V.L / V.v) * Math.log(q);
};

/** The blight's front, its veins and the ground under it, shared by every layer. */
const BLIGHT = /* glsl */ `
  uniform vec2 uC; uniform float uTau, uR, uDur, uA, uJag, uY0, uS, uLag, uLat; uniform sampler2D uHgt; uniform vec3 uCam;
  uniform vec4 uVa[VEINS], uVb[VEINS], uVc[VEINS], uVd[VEINS];
  float bRad(float tau){ return tau <= 0. ? 0. : uR * (1. - exp(-uA * tau / uDur)) / (1. - exp(-uA)); }
  float bReach(float d){ float x = 1. - d * (1. - exp(-uA)) / uR; return x <= 1e-4 ? 1e4 : -uDur / uA * log(x); }
  float bJag(float a){ return 0.5 * sin(3. * a + 1.3) + 0.3 * sin(5. * a + 4.1) + 0.2 * sin(8. * a + 2.2); }
  float bDist(vec2 w){ vec2 r = w - uC + vec2(1e-5, 0.); float d = length(r); return d * (1. + uJag * bJag(atan(r.y, r.x))); }
  float bAge(vec2 w){ return uTau - uLag - bReach(bDist(w)); }
  float bGround(vec2 w){ vec2 uv = (w - uC) / (2. * uS) + 0.5; return uY0 + texture2D(uHgt, uv).r; }
  // Vein i: its angle at x along it, where its tip is, when the tip passed x, its width there, a point on it.
  float vTh(int i, float x){ vec4 A = uVa[i], B = uVb[i], C = uVc[i], D = uVd[i];
    return A.x + B.z * x + min(1., x * 1.5) * (C.x * sin(.55 * x + D.x) + C.y * sin(1.6 * x + D.y))
         + min(1., x * 4.) * (C.z * sin(6.5 * x + D.z) + C.w * sin(19. * x + D.w)) / (A.y + x + .25); }
  float vTip(int i, float tau){ vec4 A = uVa[i]; float tt = tau - A.z; return tt <= 0. ? -1. : A.w * (1. - exp(-tt * uVb[i].x / A.w)); }
  float vPass(int i, float x){ vec4 A = uVa[i]; float q = 1. - x / A.w; return q <= 1e-3 ? 1e4 : A.z - A.w / uVb[i].x * log(q); }
  float vWid(int i, float x){ float s = uVd[i].w; return uVb[i].y * (.55 + .28 * sin(2.3 * x + s * 1.7) + .17 * sin(6.1 * x + s * 3.1)); }
  vec2 vPt(int i, float x){ float th = vTh(i, x); return uC + vec2(cos(th), sin(th)) * (uVa[i].y + x); }
  // Every vein at a point: its core (the hot slit, shifted to the wall facing the lens), how white-hot,
  // the soft light round it, the charred lips, and how long the ground here has been rotting (cAge).
  void vField(vec2 w, float tau, float aa, out float core, out float hot, out float halo, out float lip, out float cAge){
    vec2 r = w - uC + vec2(1e-5, 0.); float d = length(r), phi = atan(r.y, r.x);
    vec2 n = vec2(-sin(phi), cos(phi)); vec2 tc = uCam.xz - w; float side = dot(n, tc / max(length(tc), 1e-4));
    core = 0.; hot = 0.; halo = 0.; lip = 0.; cAge = -1e4;
    for (int i = 0; i < VEINS; i++) {
      float tip = vTip(i, tau);
      float x = d - uVa[i].y;
      if (tip <= 0. || x < -0.1 || x > tip + 0.4) continue;
      float xc = clamp(x, 0., tip);
      float th = vTh(i, xc), thd = (vTh(i, xc + .01) - th) / .01;
      float dp = mod(phi - th + 3.14159265, 6.2831853) - 3.14159265;
      float sl = d * dp / sqrt(1. + d * d * thd * thd);
      float age = tau - vPass(i, xc);
      cAge = max(cAge, age - (abs(sl) + max(0., x - tip)) / uLat);
      float along = smoothstep(-0.02, 0.03, x) * (1. - smoothstep(tip - 0.03, tip + 0.01, x));
      if (along <= 0.) continue;
      float wv = vWid(i, xc) * (0.25 + 0.75 * (1. - smoothstep(tip - 0.35, tip, x))) * min(1., 0.45 + x * 2.5);
      // Never thinner than about a pixel (the slit would break into dashes), dimmer instead.
      float we = max(wv, aa);
      float sf = sl * sign(side);
      float q = (sf + 0.4 * we * abs(side)) / we;
      float g = uVb[i].w * wv / we;
      float tipHot = exp(-max(0., tip - x) / 0.35);
      core = max(core, (1. - smoothstep(0.55, 1.0, abs(q))) * along * g);
      hot = max(hot, exp(-q * q * 5.) * along * g * (0.35 + 0.65 * max(tipHot, exp(-max(age, 0.) / 1.5))));
      halo = max(halo, exp(-abs(sl) / (wv * 5. + 0.035)) * along * g);
      float lw = wv * (1.5 + 2.8 * (1. - exp(-max(age, 0.) / 1.3))) + 0.006;
      // Charred lips either side, the near wall's darker (it hides the slit's floor).
      lip = max(lip, exp(-(sl * sl) / (lw * lw)) * along * (0.75 + 0.25 * smoothstep(0., wv, sf)));
    }
    cAge = max(cAge, uTau - uLag - bReach(bDist(w)));
  }
`;

const DECAL_VERT = /* glsl */ `
  varying vec2 vW;
  void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`;

class Blight implements Effect {
  private uni: Record<string, THREE.IUniform>;
  private meshes: THREE.Mesh[] = [];
  private rocks: Rocks | null = null;
  private pebbles: { x: number; y: number; z: number; s: number; reach: number; hop: number; rot: THREE.Euler; spin: number }[] = [];
  private embers: Billboards | null = null;
  private smoke: Billboards | null = null;
  private dust: Billboards | null = null;
  private grit: Billboards | null = null;
  private lights: THREE.PointLight[] = [];
  private hgt: THREE.DataTexture;
  private veins: Vein[] = [];
  private lead: number;
  private cx: number;
  private cz: number;
  private R: number;
  private dur: number;
  private A: number;
  private J: number;
  private lag: number;
  private lat: number;
  private lightK: number;
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
    ground: (x: number, z: number) => number,
  ) {
    const [cx, cz] = cue.at as [number, number];
    this.cx = cx;
    this.cz = cz;
    this.R = num(cue.radius, 7);
    this.dur = num(cue.dur, 4.6);
    this.A = num(cue.rate, 1.6);
    this.J = num(cue.jag, 0.18);
    this.lag = num(cue.lag, 2.4);
    this.lat = num(cue.lat, 0.35);
    const S = this.R * 1.3 + 1.5;
    const y0 = ground(cx, cz);
    // The ground under the blight, for particles that rise off it.
    const N = 96;
    const hd = new Uint16Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) hd[j * N + i] = THREE.DataUtils.toHalfFloat(ground(cx + ((i + 0.5) / N - 0.5) * 2 * S, cz + ((j + 0.5) / N - 0.5) * 2 * S) - y0);
    this.hgt = new THREE.DataTexture(hd, N, N, THREE.RedFormat, THREE.HalfFloatType);
    this.hgt.minFilter = this.hgt.magFilter = THREE.LinearFilter;
    this.hgt.needsUpdate = true;

    // The veins: the leaders fanned round the lens (one toward it, two across the frame), forks off
    // them, then later veins out of the step all round.
    const vr = mulberry(num(cue.seed, 23) + 101);
    const aim = cue.aim as [number, number] | undefined;
    const a0 = aim ? Math.atan2(aim[1] - cz, aim[0] - cx) : vr() * Math.PI * 2;
    const W = num(cue.width, 0.055);
    const speed = num(cue.speed, 0.95);
    const wig = (big: number): Pick<Vein, 'a' | 'p'> => ({
      a: [(0.2 + 0.25 * vr()) * big * (vr() < 0.5 ? -1 : 1), (0.08 + 0.12 * vr()) * big, 0.04 + 0.05 * vr(), 0.018 + 0.017 * vr()],
      p: [vr() * 6.28, vr() * 6.28, vr() * 6.28, vr() * 6.28],
    });
    this.lead = Math.round(num(cue.lead, 3));
    const fan = [0.25, -1.5, 1.6, -0.6, 2.6];
    for (let i = 0; i < this.lead; i++) {
      this.veins.push({ th: a0 + fan[i % fan.length] + (vr() - 0.5) * 0.35, d0: 0.05, t0: 0.05 * i, L: 6 + 3 * vr(), v: speed * (0.85 + 0.3 * vr()), w: W * (0.9 + 0.3 * vr()), k: (vr() - 0.5) * 0.15, glow: 1, ...wig(i ? 1 : 0.5) });
    }
    const nb = Math.round(num(cue.branches, 6));
    for (let i = 0; i < nb && this.lead > 0; i++) {
      const P = this.veins[i % this.lead];
      const x0 = 0.25 + vr() * 1.3;
      const th = vTh(P, x0);
      this.veins.push({ th, d0: P.d0 + x0, t0: vPass(P, x0) + 0.25 + vr() * 0.6, L: 0.8 + 2.4 * vr(), v: speed * (0.4 + 0.3 * vr()), w: W * (0.5 + 0.25 * vr()), k: (vr() < 0.5 ? -1 : 1) * (0.25 + 0.5 * vr()), glow: 0.85, ...wig(0.6) });
    }
    const nr = Math.round(num(cue.rays, 7));
    for (let i = 0; i < nr; i++) {
      this.veins.push({ th: a0 + Math.PI + ((i + 0.5 + (vr() - 0.5) * 0.6) / nr - 0.5) * Math.PI * 2 * 0.8, d0: 0.08, t0: 1.6 + i * 0.35 + vr() * 0.4, L: 4 + 4 * vr(), v: speed * (0.7 + 0.3 * vr()), w: W * (0.6 + 0.25 * vr()), k: (vr() - 0.5) * 0.2, glow: 0.9, ...wig(1) });
    }
    const NV = Math.max(1, this.veins.length);
    const pack = (f: (V: Vein) => [number, number, number, number]) => Array.from({ length: NV }, (_, i) => (this.veins[i] ? new THREE.Vector4(...f(this.veins[i])) : new THREE.Vector4(0, 0, 1e5, 1)));
    this.uni = {
      uC: { value: new THREE.Vector2(cx, cz) },
      uTau: { value: -1 },
      uR: { value: this.R },
      uDur: { value: this.dur },
      uA: { value: this.A },
      uJag: { value: this.J },
      uY0: { value: y0 },
      uS: { value: S },
      uLag: { value: this.lag },
      uLat: { value: this.lat },
      uHgt: { value: this.hgt },
      uCam: { value: new THREE.Vector3() },
      uVa: { value: pack((V) => [V.th, V.d0, V.t0, V.L]) },
      uVb: { value: pack((V) => [V.v, V.w, V.k, V.glow]) },
      uVc: { value: pack((V) => V.a) },
      uVd: { value: pack((V) => V.p) },
    };
    const defines = { VEINS: NV };

    // The ground: one terrain-hugging sheet, drawn twice (the rot multiplies, the fire adds).
    const seg = 160;
    const geo = new THREE.PlaneGeometry(S * 2, S * 2, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, ground(cx + pos.getX(i), cz + pos.getZ(i)) + 0.012);
    geo.computeBoundingSphere();
    const rot = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.ZeroFactor,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      defines,
      uniforms: { ...this.uni, uRot: { value: hdr(cue.rot ?? '#d2d8b8', 1) } },
      vertexShader: DECAL_VERT,
      fragmentShader: /* glsl */ `
        uniform vec3 uRot; varying vec2 vW;
        ${GLSL}
        ${BLIGHT}
        void main(){
          float core, hot, halo, lip, cAge;
          vField(vW, uTau, 0.6 * length(fwidth(vW)), core, hot, halo, lip, cAge);
          float age = cAge + (fbm(vec3(vW * 3.0, 2.0)) - 0.5) * 0.35;
          float inside = smoothstep(-0.05, 0.35, age);
          float n = fbm(vec3(vW * 1.7, 1.0)), n2 = fbm(vec3(vW * 6.5, 4.0)), n3 = fbm(vec3(vW * 19.0, 6.0));
          // Mottled dirt everywhere (the sand reads as a floor otherwise)...
          vec3 earth = mix(vec3(0.62, 0.58, 0.5), vec3(1.0, 0.97, 0.88), smoothstep(0.3, 0.7, n)) * (0.85 + 0.3 * n2) * (0.88 + 0.24 * n3);
          // ...rotting green-black as the blight reaches it, deepening as it settles in; scorched at first.
          vec3 r = uRot * (0.6 + 0.6 * n) * (0.8 + 0.4 * n2) * (1.0 - 0.3 * smoothstep(0.3, 3.0, age));
          vec3 m = earth * mix(vec3(1.0), r, inside);
          m *= 1.0 - 0.45 * exp(-max(age, 0.0) / 0.45) * smoothstep(-0.05, 0.1, age);
          // The veins' charred lips, ragged.
          m *= 1.0 - 0.85 * lip * (0.75 + 0.5 * n3);
          float edge = smoothstep(uS, uS * 0.85, length(vW - uC));
          gl_FragColor = vec4(mix(vec3(1.0), m, edge), 1.0);
        }`,
    });
    const glow = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -5,
      polygonOffsetUnits: -5,
      defines,
      uniforms: {
        ...this.uni,
        uGain: { value: 1 },
        uTime: { value: 0 },
        uWidth: { value: W },
        uCells: { value: num(cue.cells, 1.6) },
        uWarp: { value: num(cue.warp, 0.9) },
        uKeep: { value: num(cue.keep, 0.5) },
        uNetD: { value: num(cue.netDelay, 0.5) },
        uHot: { value: hdr(cue.hot ?? '#ffd27a', 1) },
        uMid: { value: hdr(cue.mid ?? '#ff7a12', 1) },
      },
      vertexShader: DECAL_VERT,
      fragmentShader: /* glsl */ `
        uniform float uGain, uTime, uWidth, uCells, uWarp, uKeep, uNetD; uniform vec3 uHot, uMid; varying vec2 vW;
        ${GLSL}
        ${BLIGHT}
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
          vec2 rel = vW - uC + vec2(1e-5, 0.0); float d = length(rel); float phi = atan(rel.y, rel.x);
          float core, hot, halo, lip, cAge;
          vField(vW, uTau, 0.6 * length(fwidth(vW)), core, hot, halo, lip, cAge);
          float flick = 0.85 + 0.15 * sin(uTime * 7.0 + d * 5.0) * sin(uTime * 2.9 + phi * 3.0);
          // The veins: an orange slit with a white-gold core, a little light spilling round them.
          vec3 col = mix(uMid, uHot, 0.35 + 0.65 * hot) * core * 2.6 + mix(uHot, vec3(1.0, 0.93, 0.8), 0.5 * hot) * hot * 3.4;
          col += uMid * halo * 0.1;
          // A finer crack net opening where the ground has rotted a while: near the veins first. Its
          // cracks wander and break up into short runs, so it never reads as a tiling.
          float open = smoothstep(uNetD, uNetD + 0.6, cAge);
          if (open > 0.0) {
            float sc = uCells;
            vec2 p = vW * sc;
            p += (vec2(fbm(vec3(p * 0.6, 1.3)), fbm(vec3(p * 0.6 + 5.2, 2.1))) - 0.5) * uWarp * 2.0;
            float md = border(p) / sc;
            float wn = fbm(vec3(p * 0.45, 7.0));
            float width = uWidth * 0.45 * (0.25 + 1.6 * wn * wn);
            float keep = smoothstep(uKeep - 0.06, uKeep + 0.1, fbm(vec3(p * 0.9 + 11.0, 0.5)));
            float net = smoothstep(width, width * 0.15, md) * keep * open;
            float netHalo = exp(-md / (width * 3.0 + 0.015)) * keep * open;
            float fresh = exp(-max(cAge - uNetD, 0.0) / 0.9);
            col += mix(uMid, uHot, fresh) * net * (0.6 + 2.2 * fresh) * (0.55 + 0.45 * smoothstep(0.0, 0.5, halo + 0.3 * open));
            col += uMid * netHalo * (0.04 + 0.2 * fresh);
            // Flecks of fire in the rotted ground round the veins.
            float fl = smoothstep(0.84, 0.93, vnoise(vec3(vW * 110.0, uTime * 1.5)));
            col += uHot * fl * open * halo * halo * 2.5;
          }
          // The step itself, white-hot for a moment.
          col += uHot * exp(-d / 0.12) * exp(-max(uTau, 0.0) / 0.6) * step(0.0, uTau) * 2.0;
          float edge = smoothstep(uS, uS * 0.8, d);
          gl_FragColor = vec4(col * flick * edge * uGain, 1.0);
        }`,
    });
    for (const [m, order] of [[rot, 3], [glow, 4]] as const) {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(cx, 0, cz);
      mesh.renderOrder = order;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.meshes.push(mesh);
    }

    const rnd = mulberry(num(cue.seed, 23));
    const clear = ((cue.clear ?? []) as [number, number, number][]);
    const free = (x: number, z: number) => clear.every(([qx, qz, r]) => Math.hypot(x - qx, z - qz) > r);

    // Grass: clumps of tapered, curving blades round the step that dry, flare and droop as the rot
    // reaches them, lit by the veins near them.
    const clumps = Math.round(num(cue.grass, 520));
    if (clumps > 0) {
      const base: number[] = [];
      const shape: number[] = [];
      for (let c = 0; c < clumps; c++) {
        const a = rnd() * Math.PI * 2;
        const r = 0.25 + Math.sqrt(rnd()) * (this.R + 1.5);
        const qx = cx + Math.cos(a) * r;
        const qz = cz + Math.sin(a) * r;
        if (!free(qx, qz)) continue;
        const n = 6 + Math.floor(rnd() * 12);
        const tall = 0.09 + rnd() * 0.16;
        for (let b = 0; b < n; b++) {
          const ba = rnd() * Math.PI * 2;
          const br = Math.sqrt(rnd()) * 0.09;
          const x = qx + Math.cos(ba) * br;
          const z = qz + Math.sin(ba) * br;
          base.push(x, ground(x, z) - 0.01, z);
          // yaw (the way it leans), height, lean, seed
          shape.push(ba + (rnd() - 0.5) * 1.2, tall * (0.55 + 0.7 * rnd()), 0.2 + 0.7 * rnd() * (br / 0.09), rnd());
        }
      }
      const blade = new THREE.InstancedBufferGeometry();
      const bv: number[] = [];
      const idx: number[] = [];
      const rows = 6;
      for (let i = 0; i <= rows; i++) {
        const v = i / rows;
        bv.push(-0.5, v, 0, 0.5, v, 0);
        if (i < rows) idx.push(i * 2, i * 2 + 1, i * 2 + 3, i * 2, i * 2 + 3, i * 2 + 2);
      }
      blade.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bv), 3));
      blade.setIndex(idx);
      blade.setAttribute('aBase', new THREE.InstancedBufferAttribute(new Float32Array(base), 3));
      blade.setAttribute('aShape', new THREE.InstancedBufferAttribute(new Float32Array(shape), 4));
      blade.instanceCount = base.length / 3;
      const mat = new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        defines,
        uniforms: {
          ...this.uni,
          ...fogUniforms(),
          uTime: { value: 0 },
          uLow: { value: hdr(cue.grassLow ?? '#0d1608', 1) },
          uHigh: { value: hdr(cue.grassHigh ?? '#4a6630', 1) },
          uDead: { value: hdr(cue.grassDead ?? '#140f08', 1) },
          uFire: { value: hdr(cue.mid ?? '#ff7a12', 1) },
          uLit: { value: num(cue.grassLit, 1) },
        },
        vertexShader: /* glsl */ `
          attribute vec3 aBase; attribute vec4 aShape;
          uniform float uTime;
          ${GLSL}
          ${BLIGHT}
          uniform vec3 uFogColor; uniform float uFogMode, uFogA, uFogB;
          varying float vV; varying float vWither; varying float vBurn; varying float vNear; varying float vFog; varying float vSeed;
          void main(){
            float v = position.y;
            float core, hot, halo, lip, age;
            vField(aBase.xz, uTau, 0.0, core, hot, halo, lip, age);
            float wither = smoothstep(0.05, 1.1, age);
            float bq = (age - 0.12) / 0.2;
            float burn = exp(-bq * bq);
            float h = aShape.y * (1.0 - 0.4 * wither);
            float sway = 0.08 * sin(uTime * 1.4 + aShape.w * 23.0) * (1.0 - wither);
            float lean = (aShape.z + sway + wither * (1.1 + 0.5 * aShape.w)) * v * v;
            // Tapered to a point, a little wider low down; some blades broad, some fine.
            float w = 0.013 * pow(1.0 - v, 0.75) * (0.45 + 0.9 * aShape.w) * (1.0 + 0.4 * v * (1.0 - v));
            vec3 local = vec3(position.x * w, h * v * cos(lean), h * v * sin(lean));
            float c = cos(aShape.x), s = sin(aShape.x);
            vec3 world = aBase + vec3(local.x * c + local.z * s, local.y, -local.x * s + local.z * c);
            vec4 mv = viewMatrix * vec4(world, 1.0);
            gl_Position = projectionMatrix * mv;
            vV = v; vWither = wither; vBurn = burn; vSeed = aShape.w;
            vNear = halo * 1.4 + exp(-length(aBase.xz - uC) / 0.8) * step(0.0, uTau) * 0.6;
            float dd = -mv.z;
            vFog = uFogMode < 0.5 ? 0. : uFogMode < 1.5 ? 1. - exp(-uFogA * uFogA * dd * dd) : smoothstep(uFogA, uFogB, dd);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uLow, uHigh, uDead, uFire, uFogColor; uniform float uLit;
          varying float vV; varying float vWither; varying float vBurn; varying float vNear; varying float vFog; varying float vSeed;
          void main(){
            vec3 live = mix(uLow, uHigh, vV) * (0.75 + 0.5 * vSeed);
            vec3 c = mix(live, uDead * (0.6 + 0.6 * vV), vWither) * uLit;
            // The veins' fire lights the blades near them (from below) and sets the ones the rot reaches alight.
            c += uFire * vNear * (0.55 - 0.3 * vV) * 0.8;
            c += uFire * vBurn * vV * 2.5;
            gl_FragColor = vec4(mix(c, uFogColor, vFog), 1.0);
          }`,
      });
      const mesh = new THREE.Mesh(blade, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      scene.add(mesh);
      this.meshes.push(mesh);
    }

    // Pebbles: twitch and glow as the rot reaches them.
    const np = Math.round(num(cue.pebbles, 70));
    if (np > 0) {
      this.rocks = new Rocks(scene, np, { detail: 1, rock: '#1d1a14', key: '#7d8a66', keyK: 0.35, amb: '#1a2014', ambK: 0.4, crack: cue.hot ?? '#ffc23a', crack2: cue.mid ?? '#ff7a12', lump: 0.55, cells: 2.0 } as unknown as FxCue, num(cue.seed, 23) + 5);
      for (let i = 0; i < np; i++) {
        const a = rnd() * Math.PI * 2;
        const r = 0.2 + Math.sqrt(rnd()) * this.R;
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r;
        const s = 0.01 + rnd() ** 2 * 0.03;
        if (!free(x, z)) continue;
        this.pebbles.push({ x, y: ground(x, z) + s * 0.25, z, s, reach: this.reachAt(x, z), hop: (0.4 + rnd()) * Math.min(0.06, s * 2.2), rot: new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6), spin: (rnd() - 0.5) * 3 });
      }
      this.rocks.mesh.count = this.pebbles.length;
    }

    const decl = (extra: string) => `#define VEINS ${NV}\n${BLIGHT}\n${extra}`;
    // Embers: most born at a vein near its running tip, the rest off the rot's front; each rises.
    const ne = Math.round(num(cue.embers, 320));
    if (ne > 0) {
      this.embers = new Billboards(scene, {
        count: ne,
        seed: 41,
        sprite: 1,
        doubleSide: true,
        depthWrite: true,
        decl: decl(`uniform vec3 uE1, uE2; uniform float uSz;`),
        uniforms: { ...this.uni, uE1: { value: hdr(cue.hot ?? '#ffd27a', 4) }, uE2: { value: hdr(cue.mid ?? '#ff7a12', 3) }, uSz: { value: num(cue.emberSize, 0.007) } },
        body: /* glsl */ `
          float P = 0.9 + 1.3 * s1.w;
          float cyc = floor((tau + s1.z * P) / P);
          float b = cyc * P - s1.z * P;
          float age = tau - b;
          vec3 hs = h33(vec3(cyc + 0.31, s1.x * 91.0, s1.y * 37.0));
          vec2 xz; float ok;
          if (s2.w < 0.75) {
            int j = int(min(hs.x * float(VEINS), float(VEINS) - 1.0));
            float tip = vTip(j, b);
            float x = max(tip, 0.0) * (1.0 - 0.75 * hs.y * hs.y);
            xz = vPt(j, x) + (h33(vec3(cyc, s2.x * 13.0, 2.0)).xy - 0.5) * 0.04;
            ok = step(0.02, tip);
          } else {
            float phi = hs.x * 6.2831853;
            float r0 = bRad(b - uLag) / (1.0 + uJag * bJag(phi)) + (hs.y - 0.5) * 0.15;
            xz = uC + vec2(cos(phi), sin(phi)) * r0;
            ok = step(0.03, r0);
          }
          float vy = 0.3 + 0.7 * hs.z;
          vec3 wob = vec3(sin(age * 3.1 + s2.x * 20.0), 0.0, cos(age * 2.7 + s2.y * 20.0)) * 0.08 * age;
          pos = vec3(xz.x, bGround(xz) + 0.01 + vy * age - 0.08 * age * age, xz.y) + wob;
          vel = vec3(wob.x * 2.0, vy, wob.z * 2.0);
          stretch = 0.035;
          float life = age / P;
          size = uSz * (0.6 + 0.9 * s2.z) * (1.0 - 0.6 * life);
          col = vec4(mix(uE1, uE2, smoothstep(0.0, 0.6, life + s2.w * 0.3)), smoothstep(0.0, 0.05, age) * (1.0 - smoothstep(0.55, 1.0, life)) * step(0.0, b) * ok);`,
      });
    }
    // Sickly smoke curling up off the veins and the rot's front.
    const ns = Math.round(num(cue.smoke, 90));
    if (ns > 0) {
      this.smoke = new Billboards(scene, {
        count: ns,
        seed: 43,
        sprite: 0,
        additive: false,
        decl: decl(`uniform vec3 uSm; uniform float uSmA;`),
        uniforms: { ...this.uni, uSm: { value: hdr(cue.smokeColor ?? '#55662a', 1) }, uSmA: { value: num(cue.smokeA, 0.28) } },
        renderOrder: 6,
        body: /* glsl */ `
          float P = 2.2 + 1.4 * s1.w;
          float cyc = floor((tau + s1.z * P) / P);
          float b = cyc * P - s1.z * P;
          float age = tau - b;
          vec3 hs = h33(vec3(cyc + 0.77, s1.x * 53.0, s1.y * 71.0));
          vec2 xz; float ok;
          if (s2.w < 0.55) {
            int j = int(min(hs.x * float(VEINS), float(VEINS) - 1.0));
            float tip = vTip(j, b);
            xz = vPt(j, max(tip, 0.0) * (1.0 - hs.y));
            ok = step(0.1, tip);
          } else {
            float phi = hs.x * 6.2831853;
            float r0 = bRad(b - uLag) / (1.0 + uJag * bJag(phi)) + (hs.y - 0.5) * 0.2;
            xz = uC + vec2(cos(phi), sin(phi)) * r0;
            ok = step(0.05, r0);
          }
          vec3 curl = vec3(sin(age * 1.3 + s2.x * 9.0), 0.0, cos(age * 1.1 + s2.y * 9.0)) * 0.12 * age;
          pos = vec3(xz.x, bGround(xz) + 0.04 + (0.18 + 0.2 * hs.z) * age, xz.y) + curl;
          float life = age / P;
          size = (0.08 + 0.28 * life) * (0.7 + 0.6 * s2.z);
          col = vec4(uSm * (0.7 + 0.6 * s2.w), uSmA * smoothstep(0.0, 0.25, life) * (1.0 - smoothstep(0.5, 1.0, life)) * step(0.0, b) * ok);
          rot = s2.y * 6.283 + age * 0.4 * (s2.w - 0.5);`,
      });
    }
    // The step: a puff of dust rolling out low, and grit kicked out of it.
    if (cue.step !== undefined) {
      const dc = hdr(cue.dust ?? '#3d3428', 1);
      this.dust = new Billboards(scene, {
        count: 30,
        seed: 47,
        sprite: 0,
        additive: false,
        decl: decl(`uniform vec3 uD;`),
        uniforms: { ...this.uni, uD: { value: dc } },
        renderOrder: 6,
        body: /* glsl */ `
          float a = s1.x * 6.2831853;
          float sp = 0.5 + 0.9 * s1.y;
          float out_ = sp * (1.0 - exp(-tau * 3.0)) / 3.0 + 0.04;
          vec2 xz = uC + vec2(cos(a), sin(a)) * out_;
          pos = vec3(xz.x, bGround(xz) + 0.03 + 0.14 * s1.z * (1.0 - exp(-tau * 2.0)), xz.y);
          size = (0.05 + 0.22 * (1.0 - exp(-tau * 2.5))) * (0.7 + 0.6 * s2.x);
          col = vec4(uD * (0.7 + 0.6 * s2.y), 0.55 * smoothstep(0.0, 0.03, tau) * exp(-tau / 0.75));
          rot = s2.z * 6.283 + tau * (s2.w - 0.5);`,
      });
      this.grit = new Billboards(scene, {
        count: 26,
        seed: 53,
        sprite: 2,
        additive: false,
        depthWrite: true,
        decl: decl(''),
        uniforms: { ...this.uni },
        body: /* glsl */ `
          float a = s1.x * 6.2831853;
          float vo = 0.4 + 0.7 * s1.y, vy = 0.9 + 1.0 * s1.z;
          float tl = 2.0 * vy / 7.0;
          float tt = min(tau, tl);
          vec2 xz = uC + vec2(cos(a), sin(a)) * (0.03 + vo * tt);
          pos = vec3(xz.x, bGround(xz) + 0.02 + vy * tt - 3.5 * tt * tt, xz.y);
          size = 0.008 + 0.01 * s2.x;
          col = vec4(vec3(0.02, 0.018, 0.012), step(0.0, tau) * (1.0 - smoothstep(tl + 0.2, tl + 0.5, tau)));`,
      });
    }
    // Warm light: one over the step, one riding behind each leading vein's tip, low.
    const L = num(cue.light, 3);
    for (let i = 0; i < 1 + this.lead; i++) {
      const l = new THREE.PointLight(String(cue.mid ?? '#ff8a2a'), 0, i ? 1.8 : 3.2, 1.6);
      scene.add(l);
      this.lights.push(l);
    }
    this.lightK = L;
  }

  private reach(d: number): number {
    const x = 1 - (d * (1 - Math.exp(-this.A))) / this.R;
    return x <= 1e-4 ? 1e4 : (-this.dur / this.A) * Math.log(x);
  }
  private jag(a: number): number {
    return 0.5 * Math.sin(3 * a + 1.3) + 0.3 * Math.sin(5 * a + 4.1) + 0.2 * Math.sin(8 * a + 2.2);
  }
  private dist(x: number, z: number): number {
    const dx = x - this.cx;
    const dz = z - this.cz;
    return Math.hypot(dx, dz) * (1 + this.J * this.jag(Math.atan2(dz, dx)));
  }
  /** When the rot reaches a point (the shaders' cAge crossing zero): off the nearest vein or the radial front. */
  private reachAt(px: number, pz: number): number {
    const dx = px - this.cx;
    const dz = pz - this.cz;
    const d = Math.hypot(dx, dz);
    const phi = Math.atan2(dz, dx);
    let best = this.reach(this.dist(px, pz)) + this.lag;
    for (const V of this.veins) {
      const x = d - V.d0;
      if (x < 0 || x >= V.L * 0.999) continue;
      const th = vTh(V, x);
      const thd = (vTh(V, x + 0.01) - th) / 0.01;
      const dp = ((((phi - th + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
      const sl = (d * dp) / Math.sqrt(1 + d * d * thd * thd);
      best = Math.min(best, vPass(V, x) + Math.abs(sl) / this.lat);
    }
    return best;
  }

  update(ctx: FxContext): void {
    const tau = ctx.t - this.cue.t;
    const u = this.uni;
    u.uTau.value = tau;
    (u.uCam.value as THREE.Vector3).copy(ctx.camera.position);
    for (const m of this.meshes) {
      const mu = (m.material as THREE.ShaderMaterial).uniforms;
      if (mu.uTime) mu.uTime.value = ctx.t;
      if (mu.uGain) mu.uGain.value = num(this.cue.gain, 1);
      if (mu.uFogMode) syncFog(mu, ctx.scene);
    }
    this.meshes[1].visible = tau > -0.05;
    if (this.rocks) {
      this.pebbles.forEach((pb, i) => {
        const a = tau - pb.reach;
        let y = 0;
        let turn = 0;
        if (a > 0) {
          // A hop as the rot reaches it, a smaller one after, then still.
          if (a < 0.35) y = pb.hop * Math.sin((Math.PI * a) / 0.35);
          else if (a > 0.5 && a < 0.72) y = 0.35 * pb.hop * Math.sin((Math.PI * (a - 0.5)) / 0.22);
          turn = pb.spin * Math.min(1, a / 0.35) + 0.4 * pb.spin * Math.min(1, Math.max(0, (a - 0.5) / 0.22));
        }
        this.e.set(pb.rot.x + turn, pb.rot.y + turn * 0.6, pb.rot.z);
        const glow = a > 0 ? 0.25 + 1.8 * Math.exp(-a / 0.4) : 0;
        this.rocks!.set(i, this.p.set(pb.x, pb.y + y, pb.z), this.e, pb.s, glow);
      });
      const mu = this.rocks.mat.uniforms;
      (mu.uHeatPos.value as THREE.Vector3).set(this.cx, this.uni.uY0.value + 0.4, this.cz);
      mu.uHeat.value = tau > 0 ? 0.6 : 0;
      this.rocks.commit(ctx);
    }
    this.embers?.set(tau, ctx);
    this.smoke?.set(tau, ctx);
    const ts = ctx.t - num(this.cue.step, this.cue.t);
    this.dust?.set(ts, ctx, ts < 2.5);
    this.grit?.set(ts, ctx, ts < 1.5);
    // Lights: the step glows as the fire opens; one rides behind each leading vein's tip.
    const y0 = this.uni.uY0.value as number;
    const on = tau > 0 ? Math.min(1, tau / 0.3) : 0;
    this.lights[0].position.set(this.cx, y0 + 0.35, this.cz);
    this.lights[0].intensity = this.lightK * on * (1.2 + 0.15 * Math.sin(ctx.t * 17));
    for (let i = 1; i < this.lights.length; i++) {
      const V = this.veins[i - 1];
      const tip = vTip(V, tau);
      const x = Math.max(0, tip - 0.2);
      const th = vTh(V, x);
      const px = this.cx + Math.cos(th) * (V.d0 + x);
      const pz = this.cz + Math.sin(th) * (V.d0 + x);
      this.lights[i].position.set(px, ctx.ground(px, pz) + 0.1, pz);
      this.lights[i].intensity = tip > 0 ? this.lightK * 0.7 * Math.min(1, tip / 0.3) * (1 + 0.2 * Math.sin(ctx.t * 11 + i * 2)) : 0;
    }
  }

  dispose(): void {
    const geos = new Set<THREE.BufferGeometry>();
    for (const m of this.meshes) {
      m.removeFromParent();
      geos.add(m.geometry);
      (m.material as THREE.Material).dispose();
    }
    for (const g of geos) g.dispose();
    this.rocks?.dispose();
    this.embers?.dispose();
    this.smoke?.dispose();
    this.dust?.dispose();
    this.grit?.dispose();
    for (const l of this.lights) {
      l.removeFromParent();
      l.dispose();
    }
    this.hgt.dispose();
  }
}

registerEffect('night-blight', (cue, scene, ground) => new Blight(cue, scene, ground));
