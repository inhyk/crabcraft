// The undead's summon assembles: the molten boulders that heave out of the ground round him fly
// together behind him into a towering rock golem (the original's Infernal): boulder legs and pelvis,
// a torso round a rib-caged chest that blazes white-gold, wide boulder shoulders, arms ending in huge
// pincer fists, a sunken head whose two eyes light last. It straightens up and looms over him.
// Everything is a function of the shot clock (seek-safe).
//
//   night-golem { at, right, src, arc, rise, fly, crouch, stand, blaze, eyes, loom, glow, rim, ... }
//       at     the golem's base point (ground), right [x, z] the screen-right unit (it faces the lens)
//       src    the point the boulders rise round (the caster), arc [a0, a1] (x = cos, z = sin)
//       rise   [t0, t1] the boulders climb out of the ground; fly [t0, t1] they fly into place
//       stand  [t0, t1] it straightens from its crouch; loom [t0, t1] it leans over him, fists forward
//       blaze  [t0, t1] the chest blazes; eyes t the eyes light
//       fire   { at, rise, gain, size, color, core, light } (optional): from `at` flame bursts erupt out
//              of the tops of both shoulders and out of both pincer fists, a flare over `rise` (0.4 s),
//              then flames that lick upward, flicker and throw sparks for the rest of the shot; they ride
//              the pose, light the rock round them and throw a warm light (`light`) from each pair.
//              gain/size scale brightness/size; color the flame, core its white-yellow heart
//       flare  [[t, k], ...] (optional) an extra multiplier on every crack's glow (default 1)
import * as THREE from 'three';
import { mulberry, NOISE, num, registerEffect, type Effect, type FxContext } from '../fx';
import type { FxCue } from '../types';
import { Billboards, fogUniforms, hdr, Rocks, syncFog, track } from './night-kit';

type V3 = [number, number, number];
/** A golem part: group (leg stays put, body leans, arm swings from its shoulder, head nods), slot, scale, turn. */
interface Part {
  g: 'leg' | 'body' | 'armL' | 'armR' | 'head';
  p: V3;
  s: V3;
  r?: V3;
  /** Heaves up in place out of the ground (legs, pelvis) instead of flying in. */
  inPlace?: boolean;
  /** Assembly order 0..1 (when it flies in, within `fly`). */
  o: number;
}

const SHOULDER_Y = 4.6;
const SHOULDER_X = 2.0;
const PELVIS_Y = 2.3;
const CHEST: V3 = [0, 3.75, 0.62];
const HEAD: V3 = [0, 5.35, 0.3];
/** The molten core behind the ribs (golem frame), its half size, and its rib bars: centre lines at
 *  y + |x| RIB_SLOPE = RIB_C + RIB_GAP k (core units, from its centre), bars RIB_BAR of each gap. */
const CORE: V3 = [0, 3.72, 0.5];
const CORE_HALF: [number, number] = [1.0, 1.0];
const RIB_SLOPE = 0.55;
const RIB_GAP = 0.34;
const RIB_C = 0.185;
const RIB_BAR = 0.42;
const RIB_K = [-2, -1, 0, 1, 2];

/** One arm, in the shoulder's frame (x outward for the right arm; mirrored for the left). */
const ARM: { p: V3; s: V3; r?: V3; o: number }[] = [
  { p: [0.35, -0.95, 0.05], s: [0.62, 0.85, 0.62], o: 0.5 },
  { p: [0.45, -1.9, 0.2], s: [0.72, 0.75, 0.72], o: 0.58 },
  { p: [0.5, -2.55, 0.3], s: [0.66, 0.5, 0.66], o: 0.64 },
  // The fist: a great palm and two prongs curling toward each other, a crab's pincer.
  { p: [0.55, -3.15, 0.38], s: [0.92, 0.78, 0.9], o: 0.7 },
  { p: [0.98, -3.8, 0.42], s: [0.4, 0.55, 0.42], r: [0, 0, 0.25], o: 0.76 },
  { p: [0.86, -4.3, 0.46], s: [0.27, 0.42, 0.3], r: [0, 0, -0.45], o: 0.8 },
  { p: [0.12, -3.8, 0.42], s: [0.38, 0.52, 0.4], r: [0, 0, -0.25], o: 0.78 },
  { p: [0.26, -4.28, 0.46], s: [0.26, 0.4, 0.28], r: [0, 0, 0.45], o: 0.82 },
];

const PARTS: Part[] = [
  // Legs and pelvis heave up where they stand.
  { g: 'leg', p: [-1.0, 0.5, 0.1], s: [0.85, 0.65, 0.9], inPlace: true, o: 0 },
  { g: 'leg', p: [1.0, 0.5, 0.1], s: [0.85, 0.65, 0.9], inPlace: true, o: 0.04 },
  { g: 'leg', p: [-0.95, 1.5, -0.15], s: [0.75, 0.85, 0.75], inPlace: true, o: 0.08 },
  { g: 'leg', p: [0.95, 1.5, -0.15], s: [0.75, 0.85, 0.75], inPlace: true, o: 0.12 },
  { g: 'body', p: [0, PELVIS_Y, -0.3], s: [1.15, 0.7, 0.85], inPlace: true, o: 0.16 },
  // The torso: a belly, a back wall behind the chest cavity, flanks and an upper back.
  { g: 'body', p: [0, 2.95, -0.25], s: [0.95, 0.6, 0.8], o: 0.2 },
  { g: 'body', p: [-0.55, 3.75, -0.62], s: [0.9, 1.0, 0.75], o: 0.24 },
  { g: 'body', p: [0.55, 3.75, -0.62], s: [0.9, 1.0, 0.75], o: 0.27 },
  { g: 'body', p: [-1.08, 3.75, 0.05], s: [0.55, 1.0, 0.72], o: 0.3 },
  { g: 'body', p: [1.08, 3.75, 0.05], s: [0.55, 1.0, 0.72], o: 0.33 },
  { g: 'body', p: [0, 4.55, -0.45], s: [1.35, 0.72, 0.85], o: 0.36 },
  // Shoulders: the widest thing on it, and the traps that bury its head.
  { g: 'body', p: [-SHOULDER_X, SHOULDER_Y + 0.15, -0.1], s: [1.08, 0.92, 1.0], o: 0.4 },
  { g: 'body', p: [SHOULDER_X, SHOULDER_Y + 0.15, -0.1], s: [1.08, 0.92, 1.0], o: 0.43 },
  { g: 'body', p: [-1.15, 5.0, -0.35], s: [0.72, 0.55, 0.72], o: 0.46 },
  { g: 'body', p: [1.15, 5.0, -0.35], s: [0.72, 0.55, 0.72], o: 0.48 },
  // Arms.
  ...ARM.map((a) => ({ g: 'armR' as const, p: [SHOULDER_X + a.p[0], SHOULDER_Y + a.p[1], a.p[2]] as V3, s: a.s, r: a.r, o: a.o })),
  ...ARM.map((a) => ({
    g: 'armL' as const,
    p: [-SHOULDER_X - a.p[0], SHOULDER_Y + a.p[1], a.p[2]] as V3,
    s: a.s,
    r: a.r ? ([a.r[0], -a.r[1], -a.r[2]] as V3) : undefined,
    o: a.o + 0.02,
  })),
  // Ribs: five dark pairs over the molten core, sloping down and out from a glowing spine (on the
  // core's dark bars), and two cracked plates over the top of the cage.
  ...RIB_K.flatMap((k, j) =>
    [-1, 1].map((sd) => ({
      g: 'body' as const,
      p: [sd * 0.5, CORE[1] + RIB_C + RIB_GAP * (k + RIB_BAR / 2) - 0.5 * RIB_SLOPE, CORE[2] + 0.1 - 0.02 * Math.abs(k)] as V3,
      s: [0.46 - 0.04 * Math.abs(k), 0.068, 0.11] as V3,
      r: [0, 0, -sd * Math.atan(RIB_SLOPE)] as V3,
      o: 0.84 + j * 0.02,
    })),
  ),
  { g: 'body', p: [-0.58, CORE[1] + 0.78, CORE[2] + 0.14], s: [0.55, 0.3, 0.24], r: [0.3, 0, 0.32], o: 0.94 },
  { g: 'body', p: [0.58, CORE[1] + 0.78, CORE[2] + 0.14], s: [0.55, 0.3, 0.24], r: [0.3, 0, -0.32], o: 0.95 },
  // The head, sunk between the shoulders: skull, brow, jaw.
  { g: 'head', p: HEAD, s: [0.86, 0.72, 0.78], o: 0.9 },
  { g: 'head', p: [HEAD[0], HEAD[1] + 0.3, HEAD[2] + 0.45], s: [0.78, 0.2, 0.32], o: 0.95 },
  { g: 'head', p: [HEAD[0], HEAD[1] - 0.42, HEAD[2] + 0.36], s: [0.55, 0.24, 0.4], o: 0.97 },
];

const EYES: V3[] = [
  [-0.27, HEAD[1] + 0.0, HEAD[2] + 0.78],
  [0.27, HEAD[1] + 0.0, HEAD[2] + 0.78],
];

const smooth = (a: number, b: number, t: number) => {
  const k = Math.min(1, Math.max(0, (t - a) / Math.max(1e-6, b - a)));
  return k * k * (3 - 2 * k);
};

/** Fire spots (golem frame): shoulder tops (body), then the fists' palms (arms); `push` toward the lens. */
const FIRE_SPOTS: { g: Part['g']; p: V3; push: number }[] = [
  { g: 'body', p: [-SHOULDER_X - 0.1, SHOULDER_Y + 0.6, 0.2], push: 0.7 },
  { g: 'body', p: [SHOULDER_X + 0.1, SHOULDER_Y + 0.6, 0.2], push: 0.7 },
  { g: 'armL', p: [-SHOULDER_X - 0.55, SHOULDER_Y - 3.5, 0.42], push: 0.8 },
  { g: 'armR', p: [SHOULDER_X + 0.55, SHOULDER_Y - 3.5, 0.42], push: 0.8 },
];
const BURST = 14; // eruption puffs per spot
const FLAMES = 20; // looping flame puffs per spot
const SPARKS = 18; // sparks per spot (the first 7 thrown by the eruption)
const ROCK_FIRE = 40; // how hard the fire lights the rock round it

const FIRE_DECL = /* glsl */ `
  uniform vec3 uE[4]; uniform vec3 uV[4]; uniform float uPush[4];
  uniform vec3 uCol, uCore; uniform float uSz, uK, uFl, uRise;
  vec3 pushCam(vec3 p, float k){ return p + normalize(cameraPosition - p) * k; }
  // White-yellow heart, orange, then a darker orange-red as it cools (a 0..1).
  vec3 fireCol(float a){
    vec3 c = mix(uCore * 1.3, mix(uCol, uCore, 0.3) * 0.9, smoothstep(0.05, 0.3, a));
    return mix(c, uCol * 0.6, smoothstep(0.45, 0.95, a));
  }`;

/** Flame tongues standing on the spots (dusk-fire's tongue look): upright quads turned to the lens. */
const TONGUE_VS = /* glsl */ `
  attribute float aSpot; attribute vec2 aSeed; attribute vec2 aSize;
  uniform vec3 uE[4]; uniform vec3 uV[4]; uniform float uPush[4]; uniform float uTime, uGrow;
  uniform float uFogMode, uFogA, uFogB;
  varying vec2 vUv; varying vec2 vSeed; varying float vFog;
  void main() {
    int e = int(aSpot + 0.5);
    vec3 c = uE[e];
    c += normalize(cameraPosition - c) * uPush[e];
    vec3 toCam = cameraPosition - c; toCam.y = 0.0;
    vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-5, 0.0, 0.0));
    float s = aSeed.x;
    float fl = 0.86 + 0.1 * sin(uTime * (5.0 + 4.0 * s) + s * 40.0) + 0.07 * sin(uTime * 13.7 + s * 17.0);
    float h = aSize.y * uGrow * fl;
    float w = aSize.x * mix(1.0, uGrow, 0.5) * (0.92 + 0.08 * sin(uTime * 7.0 + s * 9.0));
    float y = position.y;
    // Root sunk into the rock; the tip trails behind as the spot moves.
    vec3 p = c + right * (position.x + (s - 0.5) * 0.4) * w + vec3(0.0, (y - 0.15) * h, 0.0) - uV[e] * 0.14 * y * y;
    vUv = vec2(position.x + 0.5, y); vSeed = aSeed;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    float d = -mv.z;
    vFog = uFogMode < 0.5 ? 0.0 : (uFogMode < 1.5 ? 1.0 - exp(-uFogA * uFogA * d * d) : smoothstep(uFogA, uFogB, d));
    gl_Position = projectionMatrix * mv;
  }`;

const TONGUE_FS = /* glsl */ `
  uniform float uTime, uK; uniform vec3 uCol, uCore;
  varying vec2 vUv; varying vec2 vSeed; varying float vFog;
  ${NOISE}
  void main() {
    vec2 uv = vUv;
    float s = vSeed.x;
    float layer = vSeed.y; // 0 back (wide, red), 1 body, 2 core (narrow, hot)
    float n1 = fbm(vec3(uv.x * 2.4 + s * 17.0, uv.y * 1.7 - uTime * 2.6, uTime * 0.5 + s * 5.0));
    float n2 = fbm(vec3(uv.x * 5.5 - s * 3.0, uv.y * 4.2 - uTime * 4.2, uTime * 0.9 + s));
    float x = uv.x - 0.5 + (n1 - 0.5) * 0.6 * uv.y + sin(uv.y * 7.0 - uTime * 7.0 + s * 20.0) * 0.04 * uv.y;
    // A rounded foot widening into the body, narrowing to a tip.
    float w = mix(0.4, 0.03, pow(uv.y, 0.7)) * (0.5 + 0.5 * smoothstep(0.0, 0.3, uv.y));
    float body = 1.0 - smoothstep(w * 0.45, w, abs(x));
    float lobe = 1.0 - smoothstep(w * 0.2, w * 0.6, abs(x + (n2 - 0.5) * 0.3 - 0.12 * sin(s * 30.0)));
    body = max(body, lobe * smoothstep(0.85, 0.3, uv.y));
    float heat = body * (1.0 - smoothstep(0.3, 1.0, uv.y + (n2 - 0.5) * 0.65)) * smoothstep(0.0, 0.2, uv.y);
    heat *= smoothstep(0.18, 0.55, n2 + 0.38 * (1.0 - uv.y));
    heat = clamp(heat * 1.5, 0.0, 1.0);
    if (heat < 0.003) discard;
    vec3 deep = uCol * vec3(0.45, 0.12, 0.05);
    vec3 c = mix(deep, mix(uCol, uCore, 0.15), smoothstep(0.0, 0.35, heat));
    c = mix(c, mix(uCol, uCore, 0.6), smoothstep(0.4, 0.85, heat) * (0.35 + 0.3 * layer));
    c = mix(c, uCore * 1.6, smoothstep(0.8, 1.0, heat) * (1.0 - uv.y) * (0.3 + 0.35 * max(0.0, layer - 1.0)));
    float k = layer < 0.5 ? 0.55 : (layer < 1.5 ? 0.9 : 1.0);
    gl_FragColor = vec4(c * heat * 1.5 * k * uK * (1.0 - vFog), heat);
  }`;

/** Tongues per spot: [width, height, layer] (heights in fire units, uSz). */
const TONGUES: [number, number, number][] = [
  [1.4, 2.3, 0],
  [1.2, 2.9, 1],
  [1.0, 2.2, 1],
  [0.9, 2.5, 1],
  [0.6, 1.6, 2],
];

/** The golem's burning shoulders and fists: flame tongues, eruption and flame puffs, sparks, glows, two lights. */
class GolemFire {
  private tongues: THREE.Mesh;
  private tongueMat: THREE.ShaderMaterial;
  private flames: Billboards;
  private sparks: Billboards;
  private glows: Billboards;
  private lights: THREE.PointLight[];
  readonly at: number;
  private rise: number;
  private gain: number;
  private light: number;
  readonly S: number;
  readonly color: THREE.Color;
  constructor(
    f: Record<string, unknown>,
    S: number,
    scene: THREE.Scene,
  ) {
    this.at = num(f.at, 0);
    this.rise = Math.max(0.05, num(f.rise, 0.4));
    this.gain = num(f.gain, 1);
    this.light = num(f.light, 40);
    this.S = S * num(f.size, 1);
    this.color = new THREE.Color(String(f.color ?? '#ff7c10'));
    const uniforms = () => ({
      uE: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) },
      uV: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) },
      uPush: { value: FIRE_SPOTS.map((s) => s.push * S) },
      uCol: { value: hdr(f.color ?? '#ff7c10', 1) },
      uCore: { value: hdr(f.core ?? '#ffd864', 1) },
      uSz: { value: this.S },
      uK: { value: 0 },
      uFl: { value: 1 },
      uRise: { value: this.rise },
    });
    // Tongues: four per spot, each its own seed.
    const rnd = mulberry(94);
    const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    const spot: number[] = [];
    const seed: number[] = [];
    const size: number[] = [];
    for (let e = 0; e < 4; e++)
      for (const [w, h, layer] of TONGUES) {
        const j = 0.85 + 0.3 * rnd();
        spot.push(e);
        seed.push(rnd(), layer);
        size.push(w * j * this.S, h * j * this.S);
      }
    geo.setAttribute('aSpot', new THREE.InstancedBufferAttribute(new Float32Array(spot), 1));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(seed), 2));
    geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(new Float32Array(size), 2));
    geo.instanceCount = spot.length;
    const u0 = uniforms();
    this.tongueMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { ...u0, uTime: { value: 0 }, uGrow: { value: 1 }, ...fogUniforms() },
      vertexShader: TONGUE_VS,
      fragmentShader: TONGUE_FS,
    });
    this.tongues = new THREE.Mesh(geo, this.tongueMat);
    this.tongues.frustumCulled = false;
    this.tongues.renderOrder = 7;
    scene.add(this.tongues);
    const nf = 4 * (BURST + FLAMES);
    this.flames = new Billboards(scene, {
      count: nf,
      seed: 91,
      sprite: 0,
      doubleSide: true,
      decl: FIRE_DECL,
      uniforms: uniforms(),
      renderOrder: 7,
      body: /* glsl */ `
        int i = int(idx * ${nf - 1}. + 0.5);
        int e = i - 4 * (i / 4);
        int j = i / 4;
        vec3 E = uE[e]; vec3 V = uV[e];
        if (j < ${BURST}) {
          // The eruption: thrown up and out once, swelling and cooling.
          float a = tau / (uRise * (1.4 + 1.3 * s2.x));
          if (a < 1.0) {
            vec3 d = normalize(dirFrom(s1.xy) + vec3(0., 1.15, 0.));
            vec3 p = E + d * (1.1 + 1.7 * s1.z) * uSz * (1. - exp(-tau * 4.)) / 4. * 2.2 + vec3(0., 0.5 * uSz * a * a, 0.) - V * tau * 0.6;
            pos = pushCam(p, uPush[e] * 0.8);
            size = uSz * (0.3 + 0.6 * sqrt(a)) * (0.8 + 0.4 * s1.w);
            rot = s2.y * 6.2831853 + tau * (s2.z - 0.5) * 3.;
            col = vec4(fireCol(a * 0.85), smoothstep(0., 0.05, a) * (1. - smoothstep(0.4, 1., a)) * uK * 0.8);
          }
        } else {
          // Steady flames licking upward, born round the spot and left behind as it moves.
          float L = 0.45 + 0.3 * s1.y;
          float a = fract(tau / L + s1.x);
          if (tau - a * L >= 0.0) {
            float ang = s1.z * 6.2831853;
            vec3 off = vec3(cos(ang), 0., sin(ang)) * sqrt(s1.w) * 0.32 * uSz * (1. + 0.6 * a);
            float sway = sin(tau * 6.3 + s2.x * 31.) * 0.12 + sin(tau * 11.7 + s2.y * 17.) * 0.06;
            vec3 p = E + off + vec3(sway * a * uSz, 1.5 * uSz * pow(a, 0.8), 0.4 * sway * a * uSz) - V * a * L * 0.85;
            pos = pushCam(p, uPush[e]);
            size = uSz * mix(0.42, 0.14, a) * (0.85 + 0.3 * s2.z) * (0.8 + 0.25 * uFl);
            vel = vec3(sway * 0.8, 1., 0.);
            stretch = uSz * 0.5 * (1. - 0.4 * a);
            col = vec4(fireCol(a), smoothstep(0., 0.12, a) * (1. - smoothstep(0.5, 1., a)) * uK * (0.35 + 0.2 * uFl) * (0.8 + 0.4 * s2.w));
          }
        }`,
    });
    const ns = 4 * SPARKS;
    this.sparks = new Billboards(scene, {
      count: ns,
      seed: 92,
      sprite: 1,
      doubleSide: true,
      decl: FIRE_DECL,
      uniforms: uniforms(),
      renderOrder: 7,
      body: /* glsl */ `
        int i = int(idx * ${ns - 1}. + 0.5);
        int e = i - 4 * (i / 4);
        int j = i / 4;
        vec3 E = uE[e]; vec3 V = uV[e];
        float L = 0.7 + 0.6 * s1.y;
        float tt = j < 7 ? tau : fract(tau / L + s1.x) * L;
        float a = tt / L;
        if (a < 1.0 && tau - tt >= 0.0) {
          vec3 d = normalize(dirFrom(s1.zw) * (j < 7 ? 1.0 : 0.6) + vec3(0., 1.3, 0.));
          vec3 vv = d * (j < 7 ? 4.0 + 4.0 * s2.x : 1.8 + 2.4 * s2.x) * uSz;
          vec3 p = E + vv * tt + vec3(sin(tau * 5. + s2.y * 20.) * 0.15 * uSz * a, -0.7 * uSz * tt * tt, 0.) - V * tt * 0.9;
          pos = pushCam(p, uPush[e]);
          size = 0.022 * uSz * (1. - 0.5 * a);
          vel = vv + vec3(0., -1.4 * uSz * tt, 0.);
          stretch = 0.045;
          col = vec4(mix(uCore * 7., uCol * 3., a), (1. - smoothstep(0.55, 1., a)) * min(1., uK));
        }`,
    });
    this.glows = new Billboards(scene, {
      count: 12,
      seed: 93,
      sprite: 2,
      decl: FIRE_DECL,
      uniforms: uniforms(),
      renderOrder: 7,
      body: /* glsl */ `
        int i = int(idx * 11. + 0.5);
        int e = i - 4 * (i / 4);
        int layer = i / 4;
        float fe = float(e);
        float fl = 0.86 + 0.14 * sin(tau * 17. + fe * 2.3) * sin(tau * 6.1 + fe);
        pos = pushCam(uE[e] + vec3(0., 0.4 * uSz, 0.), uPush[e] + 0.25 * uSz);
        float k = uK * fl * uFl;
        if (layer == 0) { size = 0.45 * uSz; col = vec4(uCore * 3.0, min(1., k)); }
        else if (layer == 1) { size = 1.1 * uSz; col = vec4(mix(uCore, uCol, 0.6) * 0.8, min(1., 0.45 * k)); }
        else { size = 2.0 * uSz; col = vec4(uCol * 0.6, min(0.6, 0.2 * k)); }`,
    });
    this.lights = [0, 1].map(() => new THREE.PointLight(this.color, 0, 11 * S, 1.5));
    scene.add(...this.lights);
  }

  /** Brightness at t: off before `at`, a fast flare over `rise`, then steady (0 when hidden). */
  envelope(t: number): { k: number; fl: number } {
    const tau = t - this.at;
    if (tau < 0) return { k: 0, fl: 1 };
    return { k: this.gain * smooth(0, 0.06, tau), fl: 1 + 1.8 * Math.exp(-Math.max(0, tau - this.rise * 0.2) * (4 / this.rise)) };
  }

  /** `spots` and `vel` are the four spots and their velocities (world); fwd points at the lens. */
  update(t: number, ctx: FxContext, spots: THREE.Vector3[], vel: THREE.Vector3[], fwd: THREE.Vector3, on: boolean): void {
    const { k, fl } = this.envelope(t);
    for (const b of [this.flames, this.sparks, this.glows]) {
      const u = b.u;
      (u.uE.value as THREE.Vector3[]).forEach((v, i) => v.copy(spots[i]));
      (u.uV.value as THREE.Vector3[]).forEach((v, i) => v.copy(vel[i]));
      u.uK.value = k;
      u.uFl.value = fl;
      b.set(t - this.at, ctx, on && k > 0);
    }
    const tu = this.tongueMat.uniforms;
    (tu.uE.value as THREE.Vector3[]).forEach((v, i) => v.copy(spots[i]));
    (tu.uV.value as THREE.Vector3[]).forEach((v, i) => v.copy(vel[i]));
    tu.uTime.value = t;
    tu.uK.value = k;
    // Tall in the flare, settling to a steady burn.
    tu.uGrow.value = Math.min(1, (t - this.at) / (this.rise * 0.5)) * (0.75 + 0.25 * fl);
    syncFog(tu, ctx.scene);
    this.tongues.visible = on && k > 0;
    const flick = 0.85 + 0.15 * Math.sin(t * 13.1) * Math.sin(t * 7.7 + 1);
    // One light for the shoulders, one for the fists: between the pair, a little up and toward the lens.
    this.lights.forEach((l, i) => {
      l.position.copy(spots[i * 2]).lerp(spots[i * 2 + 1], 0.5).addScaledVector(fwd, 0.6 * this.S);
      l.position.y += 0.5 * this.S;
      l.intensity = on ? this.light * k * fl * flick : 0;
    });
  }

  dispose(): void {
    for (const b of [this.flames, this.sparks, this.glows]) b.dispose();
    this.tongues.removeFromParent();
    this.tongues.geometry.dispose();
    this.tongueMat.dispose();
    for (const l of this.lights) {
      l.removeFromParent();
      l.dispose();
    }
  }
}

/** The molten core: a ribcage of glowing gaps (a spine, chevrons between dark rib bars) in a ragged egg. */
const CORE_VS = /* glsl */ `
  uniform vec2 uHalf; uniform float uFogMode, uFogA, uFogB;
  varying vec2 vP; varying float vFog;
  void main() {
    vP = position.xy * 2.0 * uHalf;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float d = -mv.z;
    vFog = uFogMode < 0.5 ? 0.0 : (uFogMode < 1.5 ? 1.0 - exp(-uFogA * uFogA * d * d) : smoothstep(uFogA, uFogB, d));
    gl_Position = projectionMatrix * mv;
  }`;

const CORE_FS = /* glsl */ `
  uniform vec2 uHalf; uniform float uK, uTime, uSlope, uGap, uC, uBar; uniform vec3 uHot, uGold, uDeep, uRock, uFogColor;
  varying vec2 vP; varying float vFog;
  ${NOISE}
  void main() {
    vec2 p = vP; float ax = abs(p.x);
    float n = fbm(vec3(p * 3.2, uTime * 0.7));
    float m = fbm(vec3(p * 1.3 - vec2(0., uTime * 0.5), 4.0));
    // A ragged egg, narrower at the bottom.
    vec2 e = vec2(p.x / (uHalf.x * (0.78 + 0.22 * smoothstep(-0.9, 0.5, p.y))), p.y / uHalf.y);
    float r = length(e) + (n - 0.5) * 0.16;
    if (r > 1.0) discard;
    float spine = 1. - smoothstep(0.045 + 0.03 * n, 0.09 + 0.04 * n, ax);
    float fr = fract((p.y + ax * uSlope - uC) / uGap);
    float bar = smoothstep(0.0, 0.05, fr) * (1. - smoothstep(uBar - 0.03, uBar + 0.03, fr)) * (1. - spine);
    bar = max(bar, smoothstep(0.86, 0.97, r));
    // White at the heart, gold, then deep orange out to the rim; churning.
    float heat = clamp(1.15 - r * 0.85 + spine * 0.35 + (m - 0.5) * 0.4, 0., 1.);
    vec3 g = mix(uDeep, uGold, smoothstep(0.05, 0.5, heat));
    g = mix(g, uHot, smoothstep(0.55, 0.95, heat));
    vec3 em = g * (0.6 + 5.5 * heat * heat + 2.5 * spine) * (0.8 + 0.4 * n) * uK;
    // The bars: dark rock lit at their edges by the gaps.
    float lip = smoothstep(0.05, 0.0, min(fr, uBar - fr)) * bar;
    vec3 c = mix(em, uRock * (0.7 + 0.6 * n) + em * (0.03 + 0.25 * lip), bar);
    gl_FragColor = vec4(c * (1. - vFog) + uFogColor * vFog * (1. - min(1., uK * 0.2)), 1.0);
  }`;

interface Rock {
  part: Part;
  src: THREE.Vector3; // hover point (x, z on the ground ring; y = hover height)
  start: number;
  fly0: number;
  fly1: number;
  rot0: THREE.Euler;
  spin: THREE.Vector3;
  slot: THREE.Quaternion;
  scale: THREE.Vector3;
  glow: number;
}

class Golem implements Effect {
  private rocks: Rocks;
  private glows: Billboards;
  private light: THREE.PointLight;
  private rimLight: THREE.PointLight;
  private eyeLight: THREE.PointLight;
  private core: THREE.Mesh;
  private coreMat: THREE.ShaderMaterial;
  private data: Rock[] = [];
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private basis = new THREE.Matrix4();
  private S: number;
  private fire: GolemFire | null = null;
  private spots = [0, 1, 2, 3].map(() => new THREE.Vector3());
  private spots0 = [0, 1, 2, 3].map(() => new THREE.Vector3());
  private coreIn: [number, number];
  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
  ) {
    const S = (this.S = num(cue.scale, 1));
    this.rocks = new Rocks(scene, PARTS.length, { cells: 1.5, crack: '#ffc23a', crack2: '#8dff3a', vein: 1.5, emerge: true, ...cue }, num(cue.seed, 77));
    const rnd = mulberry(num(cue.seed, 77) * 7 + 3);
    const [a0, a1] = (cue.arc as [number, number]) ?? [0, Math.PI * 2];
    const [r0, r1] = (cue.rise as [number, number]) ?? [3.5, 6];
    const [f0, f1] = (cue.fly as [number, number]) ?? [6, 7.8];
    const flyDur = num(cue.flyDur, 0.75);
    const R = num(cue.radius, 4.2);
    const fliers = PARTS.filter((p) => !p.inPlace).length;
    let k = 0;
    for (const part of PARTS) {
      const f = part.inPlace ? 0 : (k++ + 0.5) / fliers;
      const angle = a0 + (a1 - a0) * ((f * 7.31) % 1) + (rnd() - 0.5) * 0.2;
      const fly0 = f0 + (f1 - flyDur - f0) * part.o;
      this.data.push({
        part,
        src: new THREE.Vector3(Math.cos(angle) * R * (0.45 + 0.55 * rnd()), 0.4 + 2.2 * rnd(), Math.sin(angle) * R * (0.45 + 0.55 * rnd())),
        start: part.inPlace ? fly0 - 0.9 : r0 + (r1 - r0) * rnd(),
        fly0,
        fly1: fly0 + (part.inPlace ? 0.9 : flyDur * (0.85 + 0.3 * rnd())),
        rot0: new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6),
        spin: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(0.8),
        slot: new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.r ?? [0, 0, 0]))),
        scale: new THREE.Vector3(...part.s).multiplyScalar(S),
        glow: 0.75 + 0.5 * rnd(),
      });
    }
    // Chest and eye glows (positions set per frame from the pose).
    const u = {
      uChest: { value: new THREE.Vector3() },
      uEyeL: { value: new THREE.Vector3() },
      uEyeR: { value: new THREE.Vector3() },
      uUp: { value: new THREE.Vector3(0, 1, 0) },
      uS: { value: S },
      uChestK: { value: 0 },
      uEyeK: { value: 0 },
      uHot: { value: hdr(cue.hot ?? '#fff6d8', 1) },
      uGold: { value: hdr(cue.gold ?? '#ffc04a', 1) },
      uGreen: { value: hdr(cue.color ?? '#9dff4a', 1) },
    };
    this.glows = new Billboards(scene, {
      count: 9,
      seed: 78,
      sprite: 2,
      decl: 'uniform vec3 uChest, uEyeL, uEyeR, uUp, uHot, uGold, uGreen; uniform float uChestK, uEyeK, uS;',
      uniforms: u,
      renderOrder: 6,
      body: /* glsl */ `
        int i = int(idx * 8.0 + 0.5);
        float fl = 0.9 + 0.1 * sin(tau * 23. + idx * 7.) * sin(tau * 7.3);
        if (i == 0) { pos = uChest; size = 1.0 + 0.3 * uChestK; col = vec4(uGold * 1.2, min(0.45, uChestK * 0.2) * fl); }
        else if (i == 1) { pos = uChest; size = 1.5 + 0.5 * uChestK; col = vec4(mix(uGold, uHot, 0.3) * 0.9, min(0.4, uChestK * 0.14) * fl); }
        else if (i == 2) { pos = uChest - uUp * 0.1; size = 1.2 + 0.9 * uChestK; col = vec4(mix(uGold, uGreen, 0.5) * 0.6, min(0.5, uChestK * 0.22)); }
        else if (i == 3) { pos = uEyeL; size = 0.2; col = vec4(uHot * 8.0, uEyeK); }
        else if (i == 4) { pos = uEyeR; size = 0.2; col = vec4(uHot * 8.0, uEyeK); }
        else if (i == 5) { pos = uEyeL; size = 0.7; col = vec4(uGold * 2.6, uEyeK * 0.85); }
        else if (i == 6) { pos = uEyeR; size = 0.7; col = vec4(uGold * 2.6, uEyeK * 0.85); }
        else if (i == 7) { pos = mix(uEyeL, uEyeR, 0.5); size = 1.5; col = vec4(mix(uGold, uGreen, 0.4) * 0.8, uEyeK * 0.4); }
        else { size = 0.; }
        size *= uS; stretch *= uS;`,
    });
    // The core's orange light, and its spill low onto his back (he stands between it and the lens).
    const orange = new THREE.Color(String(cue.chestColor ?? '#ff8a2c'));
    this.light = new THREE.PointLight(orange, 0, 14 * S, 1.4);
    this.rimLight = new THREE.PointLight(orange, 0, 5 * S, 1.6);
    scene.add(this.rimLight);
    this.coreMat = new THREE.ShaderMaterial({
      uniforms: {
        uHalf: { value: new THREE.Vector2(...CORE_HALF) },
        uK: { value: 0 },
        uTime: { value: 0 },
        uSlope: { value: RIB_SLOPE },
        uGap: { value: RIB_GAP },
        uC: { value: RIB_C },
        uBar: { value: RIB_BAR },
        uHot: { value: hdr(cue.hot ?? '#fff6d8', 1) },
        uGold: { value: hdr(cue.gold ?? '#ffc04a', 1) },
        uDeep: { value: hdr(cue.chestColor ?? '#ff6a14', 0.8) },
        uRock: { value: new THREE.Color(String(cue.rock ?? '#191510')).multiplyScalar(0.7) },
        ...fogUniforms(),
      },
      vertexShader: CORE_VS,
      fragmentShader: CORE_FS,
    });
    this.core = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.coreMat);
    this.core.frustumCulled = false;
    scene.add(this.core);
    const o = 0.24; // the back wall's turn to fly in: the cavity is there from then
    this.coreIn = [f0 + (f1 - flyDur - f0) * o, f0 + (f1 - flyDur - f0) * o + flyDur];
    this.eyeLight = new THREE.PointLight(new THREE.Color(String(cue.gold ?? '#ffc04a')), 0, 5 * S, 1.6);
    scene.add(this.light, this.eyeLight);
    if (cue.fire && typeof cue.fire === 'object') {
      this.fire = new GolemFire(cue.fire as Record<string, unknown>, S, scene);
      // The fire lights the rock round it (the rocks' own shader only knows the chest's heat).
      const m = this.rocks.mat;
      const fs = m.fragmentShader;
      const at = fs.indexOf('col += uRim');
      if (at >= 0) {
        m.uniforms.uFireP = { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) };
        m.uniforms.uFireK = { value: 0 };
        m.uniforms.uFireCol = { value: this.fire.color.clone() };
        m.uniforms.uFireFall = { value: 0.5 / (this.fire.S * this.fire.S) };
        m.fragmentShader =
          'uniform vec3 uFireP[4]; uniform float uFireK, uFireFall; uniform vec3 uFireCol;\n' +
          fs.slice(0, at) +
          `for (int k = 0; k < 4; k++) { vec3 tf = uFireP[k] - vWorld; float df = length(tf);
            col += base * uFireCol * uFireK * (0.25 + max(0., dot(N, tf / max(df, 1e-3)))) / (1. + df * df * uFireFall); }
          ` +
          fs.slice(at);
        m.needsUpdate = true;
      }
    }
  }

  /** The four fire spots (world) at t. */
  private fireSpots(t: number, frame: THREE.Quaternion, base: THREE.Vector3, out: THREE.Vector3[]): void {
    const pose = this.pose(t);
    const rot = new THREE.Quaternion();
    FIRE_SPOTS.forEach((f, i) => {
      this.slot({ g: f.g, p: f.p, s: [1, 1, 1], o: 0 }, pose, out[i], rot);
      out[i].applyQuaternion(frame).add(base);
    });
  }

  /** The pose at t: body lift and lean, arm raise, head nod (radians/units). */
  private pose(t: number) {
    const [s0, s1] = (this.cue.stand as [number, number]) ?? [7.8, 8.7];
    const [l0, l1] = (this.cue.loom as [number, number]) ?? [8.8, 11.5];
    const st = smooth(s0, s1, t);
    const lm = smooth(l0, l1, t);
    const crouch = num(this.cue.crouch, 0.9);
    const eyesAt = num(this.cue.eyes, 10);
    const breathe = Math.sin(t * 2.1) * 0.04;
    return {
      lift: -crouch * (1 - st) + breathe,
      lean: 0.2 * (1 - st) - 0.08 * st * (1 - lm) + num(this.cue.leanTo, 0.3) * lm,
      armOut: (0.12 * (1 - st) + 0.3 * st) * (1 - lm) + num(this.cue.spread, 0.25) * lm,
      armFwd: 0.15 * (1 - lm) + num(this.cue.reach, 0.75) * lm,
      // Head down while it gathers, up as it stands, then lowered at him as the eyes light.
      nod: 0.35 * (1 - st) - 0.12 * st * (1 - lm) + 0.12 * lm + 0.16 * smooth(eyesAt - 0.4, eyesAt + 0.2, t),
    };
  }

  /** A part's slot in the golem's frame at the pose (local units). */
  private slot(part: Part, pose: ReturnType<Golem['pose']>, out: THREE.Vector3, rot: THREE.Quaternion): void {
    out.set(...part.p);
    rot.identity();
    if (part.g === 'leg') {
      out.multiplyScalar(this.S);
      return;
    }
    if (part.g === 'armL' || part.g === 'armR') {
      const sd = part.g === 'armR' ? 1 : -1;
      // Into the shoulder's frame, swing out (about z) and forward (about x), back out.
      out.x -= sd * SHOULDER_X;
      out.y -= SHOULDER_Y;
      this.e.set(-pose.armFwd, 0, sd * pose.armOut);
      this.q2.setFromEuler(this.e);
      out.applyQuaternion(this.q2);
      rot.premultiply(this.q2);
      out.x += sd * SHOULDER_X;
      out.y += SHOULDER_Y;
    } else if (part.g === 'head') {
      out.sub(this.v.set(0, HEAD[1] - 0.4, 0));
      this.q2.setFromAxisAngle(this.s.set(1, 0, 0), pose.nod);
      out.applyQuaternion(this.q2);
      rot.premultiply(this.q2);
      out.add(this.v);
    }
    // The whole upper body: lean about the pelvis (+ toward the lens), then lift.
    out.y -= PELVIS_Y;
    this.q2.setFromAxisAngle(this.s.set(1, 0, 0), pose.lean);
    out.applyQuaternion(this.q2);
    rot.premultiply(this.q2);
    out.y += PELVIS_Y + pose.lift;
    out.multiplyScalar(this.S);
  }

  update(ctx: FxContext): void {
    const t = ctx.t;
    const base = ctx.point(this.cue.at);
    const [rx, rz] = (this.cue.right as [number, number]) ?? [1, 0];
    const right = new THREE.Vector3(rx, 0, rz).normalize();
    const fwd = new THREE.Vector3(-rz, 0, rx).normalize(); // toward the lens
    this.basis.makeBasis(right, new THREE.Vector3(0, 1, 0), fwd);
    const frame = new THREE.Quaternion().setFromRotationMatrix(this.basis);
    const src = ctx.point(this.cue.src ?? this.cue.at);
    const pose = this.pose(t);
    const glowK = track(this.cue.glow, t, 0.7);
    const [b0, b1] = (this.cue.blaze as [number, number]) ?? [8.0, 8.7];
    const blaze = smooth(b0 - 0.5, b0 + 0.15, t) * (1 + 1.6 * (1 - smooth(b0 + 0.15, b1 + 0.6, t)));
    const eyesAt = num(this.cue.eyes, 10);
    const eyes = smooth(eyesAt - 0.08, eyesAt + 0.12, t) * (1 + 0.8 * Math.exp(-Math.max(0, t - eyesAt - 0.12) * 3));
    const until = num(this.cue.until, Infinity);
    const flare = track(this.cue.flare, t, 1);
    const local = new THREE.Vector3();
    const slotRot = new THREE.Quaternion();
    const world = new THREE.Vector3();
    this.data.forEach((r, i) => {
      if (t < r.start || t > until) {
        this.rocks.setScaled(i, base, this.q.identity(), this.s.setScalar(0), 0);
        return;
      }
      this.slot(r.part, pose, local, slotRot);
      world.copy(local).applyQuaternion(frame).add(base);
      this.q.copy(frame).multiply(slotRot).multiply(r.slot);
      const mean = (r.scale.x + r.scale.y + r.scale.z) / 3;
      let glow = r.glow * glowK;
      if (r.part.inPlace) {
        // Heaves up out of the ground into its slot.
        const k = smooth(r.start, r.fly1, t);
        world.y -= (1 - k) * (r.scale.y * 2 + 0.6 * this.S);
        this.e.set(r.rot0.x * 0.15 * (1 - k), r.rot0.y * 0.15 * (1 - k), 0);
        this.q.multiply(this.q2.setFromEuler(this.e));
        glow *= 1 + 1.5 * Math.exp(-Math.max(0, t - r.fly1) * 2.5);
      } else {
        // Climbs out of the ground round the caster and hovers, tumbling.
        const gx = src.x + r.src.x;
        const gz = src.z + r.src.z;
        const g = ctx.ground(gx, gz);
        const rk = Math.min(1, (t - r.start) / 1.8);
        const re = 1 - (1 - rk) ** 2.5;
        const tl = t - r.start;
        const hover = this.v.set(gx, g - mean + (r.src.y + mean) * re + Math.sin(t * 1.3 + i) * 0.1 * re, gz);
        this.e.set(r.rot0.x + r.spin.x * tl, r.rot0.y + r.spin.y * tl, r.rot0.z + r.spin.z * tl);
        const tumble = this.q2.setFromEuler(this.e);
        const fk = smooth(r.fly0, r.fly1, t);
        // Molten as it heaves out, still hot as it hangs there, cooling as it flies into place.
        glow *= 1 + (0.7 + 1.5 * Math.exp(-Math.max(0, t - r.start) * 1.5)) * (1 - fk);
        if (fk <= 0) {
          world.copy(hover);
          this.q.copy(tumble);
        } else {
          // Pulled along an arc into its slot, turning into place, snapping home with a flare.
          const mid = hover.clone().lerp(world, 0.5);
          mid.y += 1.0 + 0.25 * hover.distanceTo(world);
          const a = hover.clone().lerp(mid, fk);
          const b = mid.lerp(world, fk);
          world.copy(a.lerp(b, fk));
          this.q.copy(tumble.slerp(this.q.clone(), fk));
          glow *= 1 + 0.6 * Math.sin(fk * Math.PI) + 1.6 * (fk >= 1 ? Math.exp(-(t - r.fly1) * 2.5) : 0);
        }
      }
      // The blaze runs out through every crack.
      glow *= (1 + num(this.cue.blazeCracks, 0.6) * blaze) * flare;
      this.rocks.setScaled(i, world, this.q, r.scale, glow);
    });
    const chest = this.v.set(0, 0, 0);
    const p: Part = { g: 'body', p: CHEST, s: [1, 1, 1], o: 0 };
    this.slot(p, pose, chest, slotRot);
    const chestW = chest.clone().applyQuaternion(frame).add(base);
    const eyeW = EYES.map((e) => {
      this.slot({ g: 'head', p: e, s: [1, 1, 1], o: 0 }, pose, local, slotRot);
      return local.clone().applyQuaternion(frame).add(base);
    });
    const smoulder = smooth(num(this.cue.lit, 7.4), b0, t) * 0.35;
    const chestK = t > until ? 0 : smoulder + blaze;
    const gu = this.glows.u;
    (gu.uChest.value as THREE.Vector3).copy(chestW);
    (gu.uEyeL.value as THREE.Vector3).copy(eyeW[0]);
    (gu.uEyeR.value as THREE.Vector3).copy(eyeW[1]);
    (gu.uUp.value as THREE.Vector3).set(0, 1, 0).applyQuaternion(this.q2.setFromAxisAngle(this.s.set(1, 0, 0), pose.lean)).applyQuaternion(frame);
    gu.uChestK.value = chestK * num(this.cue.chestGain, 1);
    gu.uEyeK.value = t > until ? 0 : eyes;
    this.glows.set(t, ctx, chestK > 0.001 || eyes > 0.001);
    const ru = this.rocks.mat.uniforms;
    // The heat sits in the core, behind the ribs, so their fronts stay dark bars against it.
    this.slot({ g: 'body', p: [CORE[0], CORE[1], CORE[2] - 0.2], s: [1, 1, 1], o: 0 }, pose, local, slotRot);
    (ru.uHeatPos.value as THREE.Vector3).copy(local).applyQuaternion(frame).add(base);
    ru.uHeat.value = num(this.cue.heat, 3.5) * chestK;
    this.rocks.commit(ctx);
    this.light.position.copy(chestW).addScaledVector(fwd, 0.9 * this.S);
    this.light.intensity = num(this.cue.light, 90) * chestK;
    this.rimLight.position.copy(chestW).lerp(this.v.copy(src).setY(src.y + 1.5), 0.62);
    this.rimLight.intensity = num(this.cue.rimLight, 30) * chestK;
    // The core, in once the torso has flown together round it.
    const cin = smooth(this.coreIn[0], this.coreIn[1], t);
    this.slot({ g: 'body', p: CORE, s: [1, 1, 1], o: 0 }, pose, local, slotRot);
    this.core.position.copy(local).applyQuaternion(frame).add(base);
    this.core.quaternion.copy(frame).multiply(slotRot);
    this.core.scale.set(2 * CORE_HALF[0] * this.S * cin, 2 * CORE_HALF[1] * this.S * cin, 1);
    this.core.visible = cin > 0.001 && t <= until;
    const cu = this.coreMat.uniforms;
    cu.uK.value = chestK * num(this.cue.coreGain, 1) * flare;
    cu.uTime.value = t;
    syncFog(cu, ctx.scene);
    this.eyeLight.position.copy(eyeW[0]).lerp(eyeW[1], 0.5).addScaledVector(fwd, 0.3);
    this.eyeLight.intensity = num(this.cue.eyeLight, 8) * (t > until ? 0 : eyes);
    if (this.fire) {
      // Spots and their velocities from the pose now and a moment ago (the flames trail as it lurches).
      const dt = 0.05;
      this.fireSpots(t, frame, base, this.spots);
      this.fireSpots(t - dt, frame, base, this.spots0);
      const vel = this.spots0.map((p, i) => p.sub(this.spots[i]).multiplyScalar(-1 / dt));
      const on = t <= until;
      this.fire.update(t, ctx, this.spots, vel, fwd, on);
      if (ru.uFireP) {
        (ru.uFireP.value as THREE.Vector3[]).forEach((v, i) => v.copy(this.spots[i]));
        const { k, fl } = this.fire.envelope(t);
        ru.uFireK.value = on ? ROCK_FIRE * k * fl : 0;
      }
    }
  }

  dispose(): void {
    this.fire?.dispose();
    this.rocks.dispose();
    this.glows.dispose();
    this.core.removeFromParent();
    this.core.geometry.dispose();
    this.coreMat.dispose();
    for (const l of [this.light, this.rimLight, this.eyeLight]) {
      l.removeFromParent();
      l.dispose();
    }
  }
}

registerEffect('night-golem', (cue, scene) => new Golem(cue, scene));
