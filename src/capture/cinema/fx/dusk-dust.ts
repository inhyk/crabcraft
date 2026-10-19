// dusk-dust: a stream of dust let go into the wind that heats into embers: each grain is born at
// the emitter, carried down the wind faster and faster, spreading and tumbling, drawn as a soft
// grain or, as it heats, a glowing streak along its own path. Every grain is a pure function of
// its seed and t, so any frame renders on its own.
//   at        emitter point (a point spec), or
//   socket    { actor, name: 'clawR', o: [x, y, z] } emit from a rig socket (local offset)
//   t..until  grains are born in this window (until is required; default t + 8)
//   rate      grains per second; life seconds each
//   box       [x, y, z] emitter extent (a field of grains upwind instead of a point)
//   wind      [x, y, z] direction; v0 start speed, acc acceleration along it
//   vel       [x, y, z] initial velocity, damped over `damp` seconds (the pour out of the claw)
//   rise      upward acceleration; spread0/spread1 lateral spread at birth/per second
//   turb      tumbling amplitude; size0/size1 grain radius at birth/death (world units)
//   heat      [[t, h]...] 0 dust .. 1 ember, by shot time; heatAge adds per second of age
//   streak    [[t, s]...] streak length in seconds of travel (0 = round grains)
//   color/color2 dust (sunlit), hot/hot2 ember colours (HDR gain `glow`), opacity, seed
//   fade      [[t, k]...] opacity over time; order render order (1001: over a dusk-haze card)
import * as THREE from 'three';
import { curve, mulberry, num, registerEffect, type Effect, type FxContext } from '../fx';
import type { FxCue } from '../types';

type V3 = [number, number, number];
type Unit = { name: string; rig: { getSocket(n: string): THREE.Object3D } };
const v3 = (v: unknown, d: V3): V3 => (Array.isArray(v) && v.length === 3 ? (v as V3) : d);

class Dust implements Effect {
  private mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private unit: Unit | null = null;
  private tmp = new THREE.Vector3();
  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
  ) {
    const t0 = cue.t;
    const t1 = num(cue.until, t0 + 8);
    const rate = num(cue.rate, 900);
    const count = Math.max(1, Math.round(rate * (t1 - t0)));
    const rnd = mulberry(num(cue.seed, 5) * 104729 + 17);
    const seed = new Float32Array(count * 4);
    const born = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < 4; k++) seed[i * 4 + k] = rnd();
      born[i] = t0 + (i + rnd()) / rate;
    }
    const base = new THREE.PlaneGeometry(2, 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('seed', new THREE.InstancedBufferAttribute(seed, 4));
    geo.setAttribute('born', new THREE.InstancedBufferAttribute(born, 1));
    geo.instanceCount = count;
    const wind = new THREE.Vector3(...v3(cue.wind, [1, 0, 0])).normalize();
    const side = new THREE.Vector3().crossVectors(wind, new THREE.Vector3(0, 1, 0));
    if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
    side.normalize();
    const up = new THREE.Vector3().crossVectors(side, wind).normalize();
    const hot = new THREE.Color(String(cue.hot ?? '#ff8a2a')).multiplyScalar(num(cue.glow, 3));
    const hot2 = new THREE.Color(String(cue.hot2 ?? '#ff3a0c')).multiplyScalar(num(cue.glow, 3));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      // Premultiplied: a dust grain covers what is behind it, an ember adds light.
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      uniforms: {
        uT: { value: 0 },
        uLife: { value: num(cue.life, 4) },
        uEmit: { value: new THREE.Vector3() },
        uBox: { value: new THREE.Vector3(...v3(cue.box, [0, 0, 0])) },
        uWind: { value: wind },
        uSide: { value: side },
        uUp: { value: up },
        uV0: { value: num(cue.v0, 1.5) },
        uAcc: { value: num(cue.acc, 3) },
        uVel: { value: new THREE.Vector3(...v3(cue.vel, [0, 0, 0])) },
        uDamp: { value: num(cue.damp, 0.6) },
        uRise: { value: num(cue.rise, 0) },
        uSpread: { value: new THREE.Vector2(num(cue.spread0, 0.04), num(cue.spread1, 0.5)) },
        uTurb: { value: num(cue.turb, 0.3) },
        uSize: { value: new THREE.Vector2(num(cue.size0, 0.012), num(cue.size1, 0.05)) },
        uHeat: { value: 0 },
        uHeatAge: { value: num(cue.heatAge, 0) },
        uStreak: { value: 0 },
        uAspect: { value: 2.2 },
        uPxMax: { value: num(cue.pxMax, 0.05) },
        uC1: { value: new THREE.Color(String(cue.color ?? '#e8c08a')) },
        uC2: { value: new THREE.Color(String(cue.color2 ?? '#ffdcaa')) },
        uH1: { value: hot },
        uH2: { value: hot2 },
        uOpacity: { value: num(cue.opacity, 0.8) },
      },
      vertexShader: /* glsl */ `
        attribute vec4 seed; attribute float born;
        uniform float uT, uLife, uV0, uAcc, uDamp, uRise, uTurb, uHeat, uHeatAge, uStreak, uAspect, uPxMax;
        uniform vec3 uEmit, uBox, uWind, uSide, uUp, uVel; uniform vec2 uSpread, uSize;
        varying vec2 vQ; varying float vLen, vHeat, vFade, vSeed;
        vec3 at(float a) {
          vec3 s = seed.xyz * 2.0 - 1.0;
          vec3 p = uEmit + s * 0.5 * uBox;
          float sp = 0.75 + 0.5 * seed.w;
          p += uVel * uDamp * (1.0 - exp(-a / uDamp));
          p += uWind * sp * (uV0 * a + 0.5 * uAcc * a * a);
          p.y += 0.5 * uRise * a * a;
          float r = uSpread.x + uSpread.y * pow(a, 1.25);
          p += (uSide * s.y + uUp * s.z * 0.6) * r;
          p += uTurb * a * vec3(sin(a * (1.3 + seed.x) + seed.y * 40.0), 0.6 * sin(a * (1.7 + seed.z) + seed.x * 30.0), cos(a * (1.1 + seed.w) + seed.z * 50.0));
          return p;
        }
        void main() {
          float age = uT - born;
          vSeed = seed.w;
          if (age < 0.0 || age > uLife) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          float k = age / uLife;
          vHeat = clamp(uHeat + uHeatAge * age + (seed.x - 0.5) * 0.25, 0.0, 1.0);
          vFade = smoothstep(0.0, 0.06, k) * (1.0 - smoothstep(0.7, 1.0, k));
          float rad = mix(uSize.x, uSize.y, k) * (0.5 + seed.w);
          vec4 c1 = projectionMatrix * modelViewMatrix * vec4(at(age), 1.0);
          float tail = uStreak * vHeat * (0.6 + 0.8 * seed.z);
          vec4 c0 = projectionMatrix * modelViewMatrix * vec4(at(max(0.0, age - tail)), 1.0);
          if (c1.w < 0.05) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          if (c0.w < 0.05) c0 = c1;
          vec2 n1 = c1.xy / c1.w, n0 = c0.xy / c0.w;
          // Work in a square space (x scaled by the aspect), radius in that space.
          vec2 a1 = vec2(n1.x * uAspect, n1.y), a0 = vec2(n0.x * uAspect, n0.y);
          float r = min(rad * projectionMatrix[1][1] / c1.w, uPxMax);
          vFade *= smoothstep(0.05, 0.4, c1.w);
          vec2 d = a1 - a0; float L = length(d);
          vec2 dir = L > 1e-5 ? d / L : vec2(1.0, 0.0); vec2 nrm = vec2(-dir.y, dir.x);
          // position.xy in [-1, 1]: x along the streak (tail to head), y across.
          float u = position.x * 0.5 + 0.5;
          vec2 q = mix(a0, a1, u) + dir * position.x * r + nrm * position.y * r;
          vQ = vec2(position.x * (L / r + 2.0) * 0.5, position.y);
          vLen = L / r;
          gl_Position = vec4(q.x / uAspect, q.y, c1.z / c1.w, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uC1, uC2, uH1, uH2; uniform float uOpacity, uT;
        varying vec2 vQ; varying float vLen, vHeat, vFade, vSeed;
        void main() {
          // Capsule distance: vQ.x runs -(L/2 + 1) .. (L/2 + 1) in radii.
          float h = 0.5 * vLen;
          float x = vQ.x;
          float dx = max(abs(x) - h, 0.0);
          float d = length(vec2(dx, vQ.y));
          if (d > 1.0) discard;
          float head = vLen > 0.01 ? mix(0.25, 1.0, clamp((x + h) / max(2.0 * h, 1e-3), 0.0, 1.0)) : 1.0;
          float soft = pow(1.0 - d, mix(1.6, 2.4, vHeat));
          float flick = 0.75 + 0.25 * sin(uT * (9.0 + 7.0 * vSeed) + vSeed * 60.0);
          vec3 dust = mix(uC1, uC2, vSeed);
          vec3 ember = mix(uH1, uH2, vSeed) * mix(1.0, flick, vHeat);
          vec3 col = mix(dust, ember, vHeat);
          float a = soft * head * vFade * uOpacity;
          // Dust covers (alpha), embers add (no alpha).
          gl_FragColor = vec4(col * a, a * (1.0 - vHeat));
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = num(cue.order, 6);
    scene.add(this.mesh);
  }

  private find(): Unit | null {
    if (this.unit) return this.unit;
    const s = this.cue.socket as { actor?: string } | undefined;
    const g = (window as unknown as { app?: { current?: { game?: { units: Unit[] } } } }).app?.current?.game;
    this.unit = g?.units.find((u) => u.name === s?.actor) ?? null;
    return this.unit;
  }

  update(ctx: FxContext): void {
    const u = this.mat.uniforms;
    u.uT.value = ctx.t;
    this.mesh.visible = ctx.t >= this.cue.t;
    if (!this.mesh.visible) return;
    const s = this.cue.socket as { name?: string; o?: V3 } | undefined;
    if (s) {
      const unit = this.find();
      if (unit) {
        const o = unit.rig.getSocket(s.name ?? 'clawR');
        o.updateWorldMatrix(true, false);
        u.uEmit.value.copy(this.tmp.set(...v3(s.o, [0, 0, 0])).applyMatrix4(o.matrixWorld));
      }
    } else if (this.cue.at !== undefined) u.uEmit.value.copy(ctx.point(this.cue.at));
    u.uHeat.value = this.cue.heat ? curve(this.cue.heat as [number, number][], ctx.t) : 0;
    u.uStreak.value = this.cue.streak ? curve(this.cue.streak as [number, number][], ctx.t) : 0;
    u.uAspect.value = ctx.camera.aspect;
    if (this.cue.fade) u.uOpacity.value = num(this.cue.opacity, 0.8) * curve(this.cue.fade as [number, number][], ctx.t);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

registerEffect('dusk-dust', (cue, scene) => new Dust(cue, scene));
