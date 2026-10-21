// night-blight: the undead's step and the corruption spreading out of it. Everything is a function of
// the blight's clock, so any frame renders on its own.
//
//   night-blight { at: [x, z], t, radius, dur, rate, jag, ... }
//       the front leaves the step at `t` and reaches `radius` after `dur` seconds, fast at first, then
//       slowing (r = radius (1 - e^(-rate k)) / (1 - e^-rate), k = time / dur); `jag` ruffles its edge.
//       Inside the front the ground rots (darker, green-black), winding fissures run out of the step
//       with their tips ahead of the front and a finer crack net opens behind it, hottest at the front
//       and cooling to a gold glow; a thin burning rim rides the front. Grass round the step dries,
//       flares and droops as the front crosses it, pebbles twitch, embers and sickly smoke rise off the
//       front. `step` (shot seconds) puffs dust and kicks grit out of the step.
//   params: rays, width, cells, warp, keep, hot, mid, rot, gain, grass (clumps), pebbles, embers, smoke,
//           clear [[x, z, r]...] (no grass there: the lens), light (peak of the warm lights),
//           toward (a point: the front lights ride the front on the side facing it), dust
import * as THREE from 'three';
import { num, registerEffect, mulberry, type Effect, type FxContext } from '../fx';
import type { FxCue } from '../types';
import { Billboards, GLSL, Rocks, fogUniforms, hdr, syncFog } from './night-kit';

/** The blight's front and the ground under it, shared by every layer. */
const BLIGHT = /* glsl */ `
  uniform vec2 uC; uniform float uTau, uR, uDur, uA, uJag, uY0, uS; uniform sampler2D uHgt;
  float bRad(float tau){ return tau <= 0. ? 0. : uR * (1. - exp(-uA * tau / uDur)) / (1. - exp(-uA)); }
  float bReach(float d){ float x = 1. - d * (1. - exp(-uA)) / uR; return x <= 1e-4 ? 1e4 : -uDur / uA * log(x); }
  float bJag(float a){ return 0.5 * sin(3. * a + 1.3) + 0.3 * sin(5. * a + 4.1) + 0.2 * sin(8. * a + 2.2); }
  float bDist(vec2 w){ vec2 r = w - uC + vec2(1e-5, 0.); float d = length(r); return d * (1. + uJag * bJag(atan(r.y, r.x))); }
  float bAge(vec2 w){ return uTau - bReach(bDist(w)); }
  float bGround(vec2 w){ vec2 uv = (w - uC) / (2. * uS) + 0.5; return uY0 + texture2D(uHgt, uv).r; }
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
  private cx: number;
  private cz: number;
  private R: number;
  private dur: number;
  private A: number;
  private J: number;
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
    const S = this.R * 1.3 + 1.5;
    const y0 = ground(cx, cz);
    // The ground under the blight, for particles that rise off it.
    const N = 96;
    const hd = new Uint16Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) hd[j * N + i] = THREE.DataUtils.toHalfFloat(ground(cx + ((i + 0.5) / N - 0.5) * 2 * S, cz + ((j + 0.5) / N - 0.5) * 2 * S) - y0);
    this.hgt = new THREE.DataTexture(hd, N, N, THREE.RedFormat, THREE.HalfFloatType);
    this.hgt.minFilter = this.hgt.magFilter = THREE.LinearFilter;
    this.hgt.needsUpdate = true;
    this.uni = {
      uC: { value: new THREE.Vector2(cx, cz) },
      uTau: { value: -1 },
      uR: { value: this.R },
      uDur: { value: this.dur },
      uA: { value: this.A },
      uJag: { value: this.J },
      uY0: { value: y0 },
      uS: { value: S },
      uHgt: { value: this.hgt },
    };

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
      uniforms: { ...this.uni, uRot: { value: hdr(cue.rot ?? '#d2d8b8', 1) } },
      vertexShader: DECAL_VERT,
      fragmentShader: /* glsl */ `
        uniform vec3 uRot; varying vec2 vW;
        ${GLSL}
        ${BLIGHT}
        void main(){
          float age = bAge(vW) + (fbm(vec3(vW * 3.0, 2.0)) - 0.5) * 0.35;
          float inside = smoothstep(-0.05, 0.35, age);
          float n = fbm(vec3(vW * 1.7, 1.0)), n2 = fbm(vec3(vW * 6.5, 4.0)), n3 = fbm(vec3(vW * 19.0, 6.0));
          // Mottled dirt everywhere (the sand reads as a floor otherwise)...
          vec3 earth = mix(vec3(0.5, 0.46, 0.38), vec3(1.0, 0.97, 0.88), smoothstep(0.3, 0.7, n)) * (0.8 + 0.4 * n2) * (0.85 + 0.3 * n3);
          // ...rotting green-black behind the front, deepening as it settles in; scorched right behind it.
          vec3 r = uRot * (0.6 + 0.6 * n) * (0.8 + 0.4 * n2) * (1.0 - 0.3 * smoothstep(0.3, 3.0, age));
          vec3 m = earth * mix(vec3(1.0), r, inside);
          m *= 1.0 - 0.5 * exp(-max(age, 0.0) / 0.45) * smoothstep(-0.05, 0.1, age);
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
      defines: { RAYS: Math.round(num(cue.rays, 7)) },
      uniforms: {
        ...this.uni,
        uGain: { value: 1 },
        uTime: { value: 0 },
        uWidth: { value: num(cue.width, 0.022) },
        uCells: { value: num(cue.cells, 1.6) },
        uWarp: { value: num(cue.warp, 0.9) },
        uKeep: { value: num(cue.keep, 0.42) },
        uHot: { value: hdr(cue.hot ?? '#ffd27a', 1) },
        uMid: { value: hdr(cue.mid ?? '#ff7a12', 1) },
      },
      vertexShader: DECAL_VERT,
      fragmentShader: /* glsl */ `
        uniform float uGain, uTime, uWidth, uCells, uWarp, uKeep; uniform vec3 uHot, uMid; varying vec2 vW;
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
          float rad = bRad(uTau);
          float bd = bDist(vW);
          float age = uTau - bReach(bd);
          float flick = 0.85 + 0.15 * sin(uTime * 7.0 + d * 5.0) * sin(uTime * 2.9 + phi * 3.0);
          // Winding fissures out of the step, each to its own length; their tips snake ahead of the front.
          float ray = 0.0, rayHot = 0.0, rayGlow = 0.0;
          for (int i = 0; i < RAYS; i++) {
            float fi = float(i);
            vec3 hs = h33(vec3(fi * 1.7, 3.7, 9.1));
            float th = 6.2831853 * (fi + 0.7 * hs.x) / float(RAYS);
            float wig = (fbm(vec3(d * 0.5 + hs.y * 10.0, fi * 3.3, 1.7)) - 0.5) * 2.6 + (fbm(vec3(d * 2.4, fi * 1.9, 5.0)) - 0.5) * 0.7;
            float dphi = abs(mod(phi - th - wig * min(1.0, d * 1.2) + 3.14159265, 6.2831853) - 3.14159265);
            float dl = d * dphi;
            float len = uR * (0.45 + 0.75 * hs.z);
            float tip = min(len, rad * (1.06 + 0.12 * hs.y) + 0.08);
            float along = smoothstep(tip, tip - 0.3, bd) * smoothstep(0.04 + 0.3 * hs.z, 0.14 + 0.3 * hs.z, d);
            float w = uWidth * (1.5 - 0.8 * smoothstep(0.0, len, d)) * (0.45 + 1.1 * fbm(vec3(d * 2.6, fi, 2.0))) * smoothstep(0.0, 0.25, d + 0.05);
            float core = smoothstep(w, w * 0.2, dl) * along;
            ray = max(ray, core);
            rayGlow = max(rayGlow, exp(-dl / (w * 6.0 + 0.03)) * along);
            // The newest stretch of each fissure, near its tip, burns hottest.
            rayHot = max(rayHot, core * exp(-max(0.0, tip - bd) / 0.6));
          }
          // A finer crack net opening behind the front.
          vec2 p = vW * uCells;
          p += (vec2(fbm(vec3(p * 0.6, 1.3)), fbm(vec3(p * 0.6 + 5.2, 2.1))) - 0.5) * uWarp * 2.0;
          float md = border(p) / uCells;
          float wn = fbm(vec3(p * 0.45, 7.0));
          float width = uWidth * 0.7 * (0.3 + 1.5 * wn);
          float keep = smoothstep(uKeep - 0.08, uKeep + 0.08, fbm(vec3(p * 0.3 + 11.0, 0.5)));
          float open = smoothstep(-0.02, 0.25, age);
          float net = smoothstep(width, width * 0.15, md) * keep * open;
          float netHalo = exp(-md / (width * 3.5 + 0.02)) * keep * open;
          // Heat: white-gold at the front, cooling to a steady gold glow behind it.
          float hot = exp(-max(age, 0.0) / 0.8);
          vec3 cRay = mix(uMid, uHot, 0.45 + 0.55 * max(hot, rayHot));
          vec3 col = cRay * ray * (2.2 + 3.5 * rayHot);
          col += mix(uMid, uHot, hot) * net * (0.7 + 3.0 * hot);
          col += uMid * netHalo * (0.06 + 0.35 * hot);
          col += uMid * rayGlow * (0.12 + 0.3 * rayHot);
          // The burning rim: a thin ragged line of fire riding the front, with a soft glow round it.
          float rq = (bd - rad) / 0.08, bq = (bd - rad + 0.2) / 0.4;
          float rim = exp(-rq * rq) * smoothstep(0.3, 0.6, fbm(vec3(vW * 2.2, uTime * 0.6)));
          float band = exp(-bq * bq);
          col += (uHot * rim * 4.0 + uMid * band * 0.4) * step(0.02, rad);
          // The step itself, white-hot for a moment.
          col += uHot * exp(-d / 0.18) * exp(-max(uTau, 0.0) / 0.6) * step(0.0, uTau) * 2.5;
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

    // Grass: clumps of blades round the step that dry, flare and droop as the front crosses them.
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
      const rows = 5;
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
            float age = bAge(aBase.xz);
            float wither = smoothstep(0.05, 1.1, age);
            float bq = (age - 0.12) / 0.2;
            float burn = exp(-bq * bq);
            float h = aShape.y * (1.0 - 0.4 * wither);
            float sway = 0.08 * sin(uTime * 1.4 + aShape.w * 23.0) * (1.0 - wither);
            float lean = (aShape.z + sway + wither * (1.1 + 0.5 * aShape.w)) * v * v;
            float w = 0.012 * (1.0 - v) * (0.7 + 0.6 * aShape.w);
            vec3 local = vec3(position.x * w, h * v * cos(lean), h * v * sin(lean));
            float c = cos(aShape.x), s = sin(aShape.x);
            vec3 world = aBase + vec3(local.x * c + local.z * s, local.y, -local.x * s + local.z * c);
            vec4 mv = viewMatrix * vec4(world, 1.0);
            gl_Position = projectionMatrix * mv;
            vV = v; vWither = wither; vBurn = burn; vSeed = aShape.w;
            float rad = bRad(uTau);
            float nq = (bDist(aBase.xz) - rad) / 0.7;
            vNear = exp(-nq * nq) * step(0.02, rad) + exp(-length(aBase.xz - uC) / 0.8) * step(0.0, uTau) * 0.6;
            float dd = -mv.z;
            vFog = uFogMode < 0.5 ? 0. : uFogMode < 1.5 ? 1. - exp(-uFogA * uFogA * dd * dd) : smoothstep(uFogA, uFogB, dd);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uLow, uHigh, uDead, uFire, uFogColor; uniform float uLit;
          varying float vV; varying float vWither; varying float vBurn; varying float vNear; varying float vFog; varying float vSeed;
          void main(){
            vec3 live = mix(uLow, uHigh, vV) * (0.75 + 0.5 * vSeed);
            vec3 c = mix(live, uDead * (0.6 + 0.6 * vV), vWither) * uLit;
            // The front's fire lights the blades near it and sets the ones it crosses alight.
            c += uFire * vNear * (0.25 + 0.5 * vV) * 0.6;
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

    // Pebbles: twitch and glow as the front reaches them.
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
        this.pebbles.push({ x, y: ground(x, z) + s * 0.25, z, s, reach: this.reach(this.dist(x, z)), hop: (0.4 + rnd()) * Math.min(0.06, s * 2.2), rot: new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6), spin: (rnd() - 0.5) * 3 });
      }
      this.rocks.mesh.count = this.pebbles.length;
    }

    const decl = (extra: string) => `${BLIGHT}\n${extra}`;
    // Embers off the front: each spark is born on the front where it was, and rises.
    const ne = Math.round(num(cue.embers, 320));
    if (ne > 0) {
      this.embers = new Billboards(scene, {
        count: ne,
        seed: 41,
        sprite: 1,
        doubleSide: true,
        depthWrite: true,
        decl: decl('uniform vec3 uE1, uE2; uniform float uSz;'),
        uniforms: { ...this.uni, uE1: { value: hdr(cue.hot ?? '#ffd27a', 4) }, uE2: { value: hdr(cue.mid ?? '#ff7a12', 3) }, uSz: { value: num(cue.emberSize, 0.007) } },
        body: /* glsl */ `
          float P = 0.9 + 1.3 * s1.w;
          float cyc = floor((tau + s1.z * P) / P);
          float b = cyc * P - s1.z * P;
          float age = tau - b;
          vec3 hs = h33(vec3(cyc + 0.31, s1.x * 91.0, s1.y * 37.0));
          float phi = hs.x * 6.2831853;
          float r0 = bRad(b) / (1.0 + uJag * bJag(phi)) + (hs.y - 0.5) * 0.15;
          vec2 xz = uC + vec2(cos(phi), sin(phi)) * r0;
          float vy = 0.35 + 0.8 * hs.z;
          vec3 wob = vec3(sin(age * 3.1 + s2.x * 20.0), 0.0, cos(age * 2.7 + s2.y * 20.0)) * 0.08 * age;
          pos = vec3(xz.x, bGround(xz) + 0.01 + vy * age - 0.08 * age * age, xz.y) + wob;
          vel = vec3(wob.x * 2.0, vy, wob.z * 2.0);
          stretch = 0.035;
          float life = age / P;
          size = uSz * (0.6 + 0.9 * s2.z) * (1.0 - 0.6 * life);
          col = vec4(mix(uE1, uE2, smoothstep(0.0, 0.6, life + s2.w * 0.3)), smoothstep(0.0, 0.05, age) * (1.0 - smoothstep(0.55, 1.0, life)) * step(0.0, b) * step(0.03, r0));`,
      });
    }
    // Sickly smoke off the front, curling up.
    const ns = Math.round(num(cue.smoke, 90));
    if (ns > 0) {
      this.smoke = new Billboards(scene, {
        count: ns,
        seed: 43,
        sprite: 0,
        additive: false,
        decl: decl('uniform vec3 uSm; uniform float uSmA;'),
        uniforms: { ...this.uni, uSm: { value: hdr(cue.smokeColor ?? '#55662a', 1) }, uSmA: { value: num(cue.smokeA, 0.28) } },
        renderOrder: 6,
        body: /* glsl */ `
          float P = 2.2 + 1.4 * s1.w;
          float cyc = floor((tau + s1.z * P) / P);
          float b = cyc * P - s1.z * P;
          float age = tau - b;
          vec3 hs = h33(vec3(cyc + 0.77, s1.x * 53.0, s1.y * 71.0));
          float phi = hs.x * 6.2831853;
          float r0 = bRad(b) / (1.0 + uJag * bJag(phi)) + (hs.y - 0.5) * 0.2;
          vec2 xz = uC + vec2(cos(phi), sin(phi)) * r0;
          vec3 curl = vec3(sin(age * 1.3 + s2.x * 9.0), 0.0, cos(age * 1.1 + s2.y * 9.0)) * 0.12 * age;
          pos = vec3(xz.x, bGround(xz) + 0.04 + (0.18 + 0.2 * hs.z) * age, xz.y) + curl;
          float life = age / P;
          size = (0.08 + 0.28 * life) * (0.7 + 0.6 * s2.z);
          col = vec4(uSm * (0.7 + 0.6 * s2.w), uSmA * smoothstep(0.0, 0.25, life) * (1.0 - smoothstep(0.5, 1.0, life)) * step(0.0, b) * step(0.05, r0));
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
        decl: decl('uniform vec3 uD;'),
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
    // Warm light: one over the step, three riding the front on the camera's side.
    const L = num(cue.light, 3);
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(String(cue.mid ?? '#ff8a2a'), 0, i ? 2.6 : 3.2, 1.6);
      scene.add(l);
      this.lights.push(l);
    }
    this.lightK = L;
  }

  private rad(tau: number): number {
    return tau <= 0 ? 0 : (this.R * (1 - Math.exp((-this.A * tau) / this.dur))) / (1 - Math.exp(-this.A));
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

  update(ctx: FxContext): void {
    const tau = ctx.t - this.cue.t;
    const u = this.uni;
    u.uTau.value = tau;
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
          // A hop as the front passes, a smaller one after, then still.
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
    // Lights: the step glows as the fire opens; the front's lights face the given point.
    const r = this.rad(tau);
    const y0 = this.uni.uY0.value as number;
    const on = tau > 0 ? Math.min(1, tau / 0.3) : 0;
    this.lights[0].position.set(this.cx, y0 + 0.35, this.cz);
    this.lights[0].intensity = this.lightK * on * (1.2 + 0.15 * Math.sin(ctx.t * 17));
    const to = this.cue.toward ? ctx.point(this.cue.toward) : ctx.camera.position;
    const base = Math.atan2(to.z - this.cz, to.x - this.cx);
    for (let i = 1; i < 4; i++) {
      const a = base + (i - 2) * 0.75;
      const rr = r / (1 + this.J * this.jag(a));
      const x = this.cx + Math.cos(a) * rr;
      const z = this.cz + Math.sin(a) * rr;
      this.lights[i].position.set(x, ctx.ground(x, z) + 0.25, z);
      this.lights[i].intensity = this.lightK * 0.8 * on * Math.min(1, r / 0.6) * (1 + 0.2 * Math.sin(ctx.t * 11 + i * 2));
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
