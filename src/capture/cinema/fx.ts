// Cinema effects: weather, fire, washes and lights the game itself does not have, plus cues into
// the game's own Vfx recipes. Particle layers and shader cards are pure functions of the shot clock
// (a flake's place at t comes from its seed and t alone), so any frame renders on its own; the Vfx
// cues are bursts the capture clock steps deterministically from the shot's pre-roll.
import * as THREE from 'three';
import type { Vfx } from '../../game/vfx/vfx';
import type { FxCue, V3 } from './types';

/** What an effect needs from the stage each frame. */
export interface FxContext {
  t: number;
  dt: number;
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  vfx: Vfx;
  /** Resolve a point spec (see types.ts Pt) at the current time. */
  point(p: unknown): THREE.Vector3;
  ground(x: number, z: number): number;
  /** Screen overlay, 0..1 alpha of a colour (the strongest wins this frame). */
  overlay(color: string, a: number): void;
  /** Camera shake to add this frame, units. */
  shake(amp: number): void;
  /** Drawing-buffer pixels per world unit at distance 1 (point sprite sizes). */
  pxPerUnit: number;
}

export interface Effect {
  update(ctx: FxContext): void;
  dispose(): void;
  /** Back to the state before t (the stage seeks backwards for stills and pre-rolls). */
  reset?(): void;
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const v3 = (v: unknown, d: V3): V3 => (Array.isArray(v) && v.length === 3 ? (v as V3) : d);
const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Envelope: 0 before t, rises over `fadeIn`, holds, falls over `fadeOut` before `until`. */
function envelope(cue: FxCue, t: number): number {
  const t0 = cue.t;
  const t1 = num(cue.until, Infinity);
  const fi = num(cue.fadeIn, 0.0001);
  const fo = num(cue.fadeOut, 0.0001);
  if (t < t0 || t > t1) return 0;
  return Math.min(smooth((t - t0) / fi), Number.isFinite(t1) ? smooth((t1 - t) / fo) : 1);
}

/** Piecewise linear curve through [t, value] pairs. */
function curve(pairs: [number, number][], t: number): number {
  if (!pairs.length) return 0;
  if (t <= pairs[0][0]) return pairs[0][1];
  for (let i = 1; i < pairs.length; i++) {
    const [ta, a] = pairs[i - 1];
    const [tb, b] = pairs[i];
    if (t <= tb) return a + (b - a) * ((t - ta) / Math.max(1e-6, tb - ta));
  }
  return pairs[pairs.length - 1][1];
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const NOISE = /* glsl */ `
  float h31(vec3 p){p=fract(p*.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}
  float vnoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(mix(h31(i),h31(i+vec3(1,0,0)),f.x),mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x),mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x),f.y),f.z);}
  float fbm(vec3 p){float s=0.,a=.5;for(int i=0;i<5;i++){s+=a*vnoise(p);p=p*2.03+vec3(1.7,9.2,3.1);a*=.5;}return s;}
`;

// ------------------------------------------------------------------------------ particle volumes

/**
 * A box of particles wrapped around the camera (snow, leaves) or fixed in the world (embers), each a
 * pure function of its seed and t. `shape` picks the sprite: soft flake, leaf, or spark.
 */
class Volume implements Effect {
  private points: THREE.Points;
  private mat: THREE.ShaderMaterial;
  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
    shape: 0 | 1 | 2,
    defaults: { count: number; box: V3; drift: V3; size: number; color: string; color2?: string; opacity: number; wobble: number; additive?: boolean },
  ) {
    const count = Math.round(num(cue.count, defaults.count));
    const rnd = mulberry(num(cue.seed, 7) * 7919 + shape);
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < seed.length; i++) seed[i] = rnd();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
    const c1 = new THREE.Color(String(cue.color ?? defaults.color));
    const c2 = new THREE.Color(String(cue.color2 ?? defaults.color2 ?? cue.color ?? defaults.color));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: cue.additive ?? defaults.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uCentre: { value: new THREE.Vector3() },
        uBox: { value: new THREE.Vector3(...v3(cue.box, defaults.box)) },
        uDrift: { value: new THREE.Vector3(...v3(cue.drift, defaults.drift)) },
        uWobble: { value: num(cue.wobble, defaults.wobble) },
        uSize: { value: num(cue.size, defaults.size) },
        uScale: { value: 500 },
        uC1: { value: c1 },
        uC2: { value: c2 },
        uOpacity: { value: 0 },
        uShape: { value: shape },
        uRise: { value: num(cue.rise, 0) },
      },
      vertexShader: /* glsl */ `
        attribute vec4 seed;
        uniform float uTime, uWobble, uSize, uScale, uShape, uRise;
        uniform vec3 uCentre, uBox, uDrift;
        varying vec4 vSeed; varying float vFade;
        void main(){
          vSeed = seed;
          float speed = 0.75 + 0.5 * seed.w;
          vec3 p = seed.xyz * uBox + uDrift * uTime * speed;
          p += uWobble * vec3(sin(uTime * (1.1 + seed.w) + seed.x * 40.), 0.4 * sin(uTime * 1.7 + seed.y * 30.), cos(uTime * (0.9 + seed.z) + seed.z * 50.));
          // Wrap into the box around the centre.
          vec3 rel = mod(p - uCentre + 0.5 * uBox, uBox) - 0.5 * uBox;
          vec3 w = uCentre + rel;
          // Fade out toward the box faces so the wrap never pops.
          vec3 edge = abs(rel) / (0.5 * uBox);
          vFade = 1.0 - smoothstep(0.75, 1.0, max(max(edge.x, edge.y), edge.z));
          if (uRise > 0.0) vFade *= 1.0 - smoothstep(0.55, 1.0, (rel.y / uBox.y) + 0.5);
          vec4 mv = modelViewMatrix * vec4(w, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uSize * (0.6 + 0.8 * seed.w) * uScale / max(0.25, -mv.z);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uC1, uC2; uniform float uOpacity, uShape, uTime;
        varying vec4 vSeed; varying float vFade;
        void main(){
          vec2 q = gl_PointCoord * 2.0 - 1.0;
          float a;
          if (uShape < 0.5) { a = smoothstep(1.0, 0.15, length(q)); }
          else if (uShape < 1.5) {
            float ang = uTime * (1.5 + 3.0 * vSeed.x) + vSeed.y * 6.283;
            vec2 r = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * q;
            // A leaf seen turning: an ellipse whose width breathes.
            float wdt = 0.25 + 0.3 * abs(sin(uTime * (2.0 + 2.0 * vSeed.z) + vSeed.w * 9.0));
            a = smoothstep(1.0, 0.8, length(vec2(r.x / wdt, r.y)));
          } else { a = pow(max(0.0, 1.0 - length(q)), 2.2); }
          if (a < 0.01) discard;
          vec3 c = mix(uC1, uC2, vSeed.z);
          gl_FragColor = vec4(c, a * uOpacity * vFade);
        }`,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  update(ctx: FxContext): void {
    const u = this.mat.uniforms;
    const env = envelope(this.cue, ctx.t);
    this.points.visible = env > 0;
    if (!this.points.visible) return;
    u.uTime.value = ctx.t + num(this.cue.offset, 30);
    u.uOpacity.value = env * num(this.cue.opacity, 1);
    if (this.cue.at !== undefined) u.uCentre.value.copy(ctx.point(this.cue.at));
    else u.uCentre.value.copy(ctx.camera.position).add(new THREE.Vector3(...v3(this.cue.shift, [0, 0, 0])));
    u.uScale.value = ctx.pxPerUnit;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}

// ----------------------------------------------------------------------------- shader billboards

/** Procedural flames on camera-facing quads: a burning field, a torch, a wall of fire. */
class Flames implements Effect {
  private group = new THREE.Group();
  private mat: THREE.ShaderMaterial;
  private items: { mesh: THREE.Mesh; base: THREE.Vector3 }[] = [];
  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
    ground: (x: number, z: number) => number,
  ) {
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uGain: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aSeed; varying vec2 vUv; varying float vSeed;
        void main(){ vUv = uv; vSeed = aSeed; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uGain; varying vec2 vUv; varying float vSeed;
        ${NOISE}
        void main(){
          vec2 uv = vUv;
          float n = fbm(vec3(uv.x * 3.0 + vSeed * 17.0, uv.y * 2.2 - uTime * 2.6, uTime * 0.6 + vSeed * 5.0));
          float n2 = fbm(vec3(uv.x * 7.0 - vSeed * 3.0, uv.y * 5.0 - uTime * 4.2, uTime));
          // A tongue: wide at the base, licking up to a ragged tip.
          float w = (1.0 - uv.y) * 0.5 + 0.08;
          float body = smoothstep(w, w * 0.25, abs(uv.x - 0.5 + (n - 0.5) * 0.35 * uv.y));
          float heat = body * smoothstep(1.0, 0.0, uv.y + (n2 - 0.5) * 0.55) * smoothstep(0.0, 0.08, uv.y);
          heat = clamp(heat * 1.35, 0.0, 1.0);
          vec3 col = mix(vec3(0.45, 0.03, 0.0), vec3(1.0, 0.32, 0.02), smoothstep(0.05, 0.5, heat));
          col = mix(col, vec3(1.0, 0.75, 0.3), smoothstep(0.7, 1.0, heat));
          gl_FragColor = vec4(col * heat * 1.5 * uGain, heat);
        }`,
    });
    const spots = (cue.spots as [number, number, number?][] | undefined) ?? [];
    const h = num(cue.height, 4);
    const rnd = mulberry(num(cue.seed, 3));
    for (const [x, z, s = 1] of spots) {
      const hh = h * s * (0.75 + 0.5 * rnd());
      const geo = new THREE.PlaneGeometry(hh * 0.7, hh, 1, 1);
      geo.translate(0, hh / 2, 0);
      const seed = rnd();
      geo.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(4).fill(seed), 1));
      const mesh = new THREE.Mesh(geo, this.mat);
      const base = new THREE.Vector3(x, ground(x, z) - 0.1 * hh, z);
      mesh.position.copy(base);
      mesh.frustumCulled = false;
      mesh.renderOrder = 6;
      this.group.add(mesh);
      this.items.push({ mesh, base });
    }
    scene.add(this.group);
  }

  update(ctx: FxContext): void {
    const env = envelope(this.cue, ctx.t);
    this.group.visible = env > 0;
    if (!this.group.visible) return;
    this.mat.uniforms.uTime.value = ctx.t;
    this.mat.uniforms.uGain.value = env * num(this.cue.gain, 1);
    const cam = ctx.camera.position;
    for (const it of this.items) it.mesh.rotation.y = Math.atan2(cam.x - it.base.x, cam.z - it.base.z);
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const it of this.items) it.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

/** A noise card over the whole view (smoke rolling across the lens, a coloured whoosh). */
class Wash implements Effect {
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
        uC1: { value: new THREE.Color(String(cue.color ?? '#5a1206')) },
        uC2: { value: new THREE.Color(String(cue.color2 ?? '#ff5a1a')) },
        uScale: { value: num(cue.scale, 2.2) },
        uFlow: { value: new THREE.Vector2(...((cue.flow as [number, number]) ?? [0.15, 0.25])) },
        uCover: { value: 0.5 },
      },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uA, uScale, uCover; uniform vec3 uC1, uC2; uniform vec2 uFlow; varying vec2 vUv;
        ${NOISE}
        void main(){
          vec2 p = vec2(vUv.x * 2.2, vUv.y) * uScale;
          float n = fbm(vec3(p - uFlow * uTime, uTime * 0.15));
          float m = fbm(vec3(p * 2.1 + vec2(3.1, 1.7) - uFlow * uTime * 1.6, uTime * 0.3 + 4.0));
          float d = smoothstep(1.0 - uCover - 0.25, 1.0 - uCover + 0.25, n * 0.75 + m * 0.35);
          vec3 c = mix(uC1, uC2, smoothstep(0.35, 0.85, m));
          gl_FragColor = vec4(c, d * uA);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 999;
    scene.add(this.mesh);
  }

  update(ctx: FxContext): void {
    const a = this.cue.alpha ? curve(this.cue.alpha as [number, number][], ctx.t) : envelope(this.cue, ctx.t);
    this.mesh.visible = a > 0.001;
    this.mat.uniforms.uTime.value = ctx.t;
    this.mat.uniforms.uA.value = a;
    this.mat.uniforms.uCover.value = this.cue.cover ? curve(this.cue.cover as [number, number][], ctx.t) : 0.5;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

/** Glowing cracks spreading over the ground from a point (Voronoi edges, additive). */
class Cracks implements Effect {
  private mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
    ground: (x: number, z: number) => number,
  ) {
    const [x, z] = cue.at as [number, number];
    const r = num(cue.radius, 3);
    const seg = 48;
    const geo = new THREE.PlaneGeometry(r * 2, r * 2, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, ground(x + pos.getX(i), z + pos.getZ(i)) + 0.03);
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      uniforms: { uTime: { value: 0 }, uGrow: { value: 0 }, uColor: { value: new THREE.Color(String(cue.color ?? '#ffb02e')) }, uGain: { value: num(cue.gain, 2.5) }, uCells: { value: num(cue.cells, 3.2) } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uGrow, uGain, uCells; uniform vec3 uColor; varying vec2 vUv;
        vec2 h22(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
        void main(){
          vec2 q = (vUv - 0.5) * 2.0; float r = length(q);
          vec2 p = q * uCells * 2.0; vec2 i = floor(p), f = fract(p);
          float d1 = 9.0, d2 = 9.0;
          for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec2 g = vec2(float(x), float(y)); vec2 o = h22(i + g);
            float d = length(g + o - f); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
          }
          float edge = smoothstep(0.09, 0.0, d2 - d1);
          float front = smoothstep(uGrow, uGrow - 0.25, r);
          float flick = 0.8 + 0.2 * sin(uTime * 9.0 + r * 13.0);
          float a = edge * front * smoothstep(1.0, 0.7, r) * flick;
          gl_FragColor = vec4(uColor * uGain * a, a);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.position.set(x, 0, z);
    this.mesh.renderOrder = 4;
    scene.add(this.mesh);
  }

  update(ctx: FxContext): void {
    const env = envelope(this.cue, ctx.t);
    this.mesh.visible = env > 0;
    this.mat.uniforms.uTime.value = ctx.t;
    this.mat.uniforms.uGrow.value = smooth((ctx.t - this.cue.t) / num(this.cue.grow, 2)) * 1.25;
    this.mat.uniforms.uGain.value = num(this.cue.gain, 2.5) * env;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

// ---------------------------------------------------------------------------------- lights, fades

class Light implements Effect {
  private light: THREE.PointLight;
  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
  ) {
    this.light = new THREE.PointLight(String(cue.color ?? '#ffffff'), 0, num(cue.distance, 30), num(cue.decay, 1.6));
    scene.add(this.light);
  }

  update(ctx: FxContext): void {
    const i = this.cue.curve ? curve(this.cue.curve as [number, number][], ctx.t) : envelope(this.cue, ctx.t) * num(this.cue.intensity, 20);
    const flicker = num(this.cue.flicker, 0);
    this.light.intensity = Math.max(0, i * (1 + flicker * (Math.sin(ctx.t * 23.1) * 0.5 + Math.sin(ctx.t * 37.7 + 1) * 0.5)));
    this.light.position.copy(ctx.point(this.cue.at ?? [0, 0, 0]));
  }

  dispose(): void {
    this.light.removeFromParent();
    this.light.dispose();
  }
}

/** The screen goes to a colour and back: `curve` [[t, alpha]...], or a flash peaking at t over `d`. */
class Overlay implements Effect {
  constructor(private cue: FxCue) {}
  update(ctx: FxContext): void {
    let a: number;
    if (this.cue.curve) a = curve(this.cue.curve as [number, number][], ctx.t);
    else {
      const rise = num(this.cue.rise, 0.04);
      const d = num(this.cue.d, 0.5);
      const t = ctx.t - this.cue.t;
      a = t < -rise || t > d ? 0 : t < 0 ? 1 + t / rise : 1 - t / d;
      a *= num(this.cue.a, 1);
    }
    if (a > 0) ctx.overlay(String(this.cue.color ?? '#ffffff'), Math.min(1, a));
  }
  dispose(): void {}
}

class Shake implements Effect {
  constructor(private cue: FxCue) {}
  update(ctx: FxContext): void {
    const t = ctx.t - this.cue.t;
    const d = num(this.cue.d, 0.6);
    if (t < 0 || t > d) return;
    ctx.shake(num(this.cue.amp, 0.15) * (1 - t / d) ** 2);
  }
  dispose(): void {}
}

// --------------------------------------------------------------------------------- one-off bursts

/** A burst: fires once when the clock passes t. */
class Burst implements Effect {
  private fired = false;
  constructor(
    private cue: FxCue,
    private fire: (ctx: FxContext) => void,
  ) {}
  update(ctx: FxContext): void {
    if (this.fired || ctx.t < this.cue.t) return;
    this.fired = true;
    this.fire(ctx);
  }
  reset(): void {
    this.fired = false;
  }
  dispose(): void {}
}

/** A per-frame emitter between t and until (a swirl of motes, a meteor's trail). */
class Emitter implements Effect {
  private acc = 0;
  constructor(
    private cue: FxCue,
    private emit: (ctx: FxContext, k: number) => void,
  ) {}
  update(ctx: FxContext): void {
    if (ctx.t < this.cue.t || ctx.t > num(this.cue.until, Infinity)) return;
    this.acc += ctx.dt * num(this.cue.rate, 30);
    while (this.acc >= 1) {
      this.acc -= 1;
      this.emit(ctx, (ctx.t - this.cue.t) / Math.max(1e-3, num(this.cue.until, ctx.t + 1) - this.cue.t));
    }
  }
  reset(): void {
    this.acc = 0;
  }
  dispose(): void {}
}

const hdr = (hex: string, k: number) => new THREE.Color(hex).multiplyScalar(k);

/** A meteor from `from` to `to` over `d` seconds; it explodes on impact. */
class Meteor implements Effect {
  private core: THREE.Mesh;
  private halo: THREE.Sprite;
  private light: THREE.PointLight;
  private exploded = false;
  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
  ) {
    const color = String(cue.color ?? '#9dff4a');
    const size = num(cue.size, 1.2);
    this.core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(size, 1),
      new THREE.MeshBasicMaterial({ color: hdr(String(cue.coreColor ?? '#fff3c4'), 3), toneMapped: false }),
    );
    const tex = glowTexture();
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: hdr(color, 4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.halo.scale.setScalar(size * 9);
    this.core.add(this.halo);
    this.light = new THREE.PointLight(color, 0, 120, 1.2);
    this.core.add(this.light);
    this.core.visible = false;
    scene.add(this.core);
  }

  update(ctx: FxContext): void {
    const d = num(this.cue.d, 1.5);
    const k = (ctx.t - this.cue.t) / d;
    const from = new THREE.Vector3(...(this.cue.from as V3));
    const to = ctx.point(this.cue.to);
    this.core.visible = k >= 0 && k < 1;
    if (this.core.visible) {
      const e = k * k;
      this.core.position.lerpVectors(from, to, e);
      this.core.rotation.set(ctx.t * 3, ctx.t * 2, 0);
      this.light.intensity = num(this.cue.light, 400);
      const c = hdr(String(this.cue.color ?? '#9dff4a'), 3);
      // The trail: sparks and smoke shed along the path.
      ctx.vfx.sparks(this.core.position, c, 6, 3, { life: 0.7 });
      ctx.vfx.smoke(this.core.position, new THREE.Color(String(this.cue.smoke ?? '#2a3a1a')), 2, 0.6, 0.2, 2.2, 1.6);
      ctx.vfx.glow(this.core.position, c, num(this.cue.size, 1.2) * 4, 0.25);
    }
    if (!this.exploded && k >= 1) {
      this.exploded = true;
      explode(ctx, to, this.cue);
    }
  }

  reset(): void {
    this.exploded = false;
  }

  dispose(): void {
    this.core.removeFromParent();
    this.core.geometry.dispose();
    (this.core.material as THREE.Material).dispose();
    this.halo.material.dispose();
    this.light.dispose();
  }
}

let glowTex: THREE.Texture | null = null;
function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

/** A big impact: light flash, white-hot core, sparks, a ring over the ground, smoke and a shake. */
function explode(ctx: FxContext, at: THREE.Vector3, cue: FxCue): void {
  const scale = num(cue.scale, 1);
  const color = hdr(String(cue.color ?? '#9dff4a'), 3.5);
  const v = ctx.vfx;
  v.impact(at, color, 2.5 * scale);
  v.glow(at, hdr('#fff6d0', 5), 9 * scale, 0.6, 2 * scale);
  v.sparks(at, color, Math.round(120 * scale), 16 * scale, { life: 1.4 });
  v.sparks(at, hdr('#ffd27a', 3), Math.round(60 * scale), 10 * scale, { life: 1.1 });
  v.ring(at, color, 0.5, 14 * scale, 0.9, 0.55, 0.15);
  v.smoke(at, new THREE.Color(String(cue.smoke ?? '#33402a')), Math.round(40 * scale), 3.5 * scale, 2.2, 3.2 * scale, 2.6);
  if (cue.flash !== false) ctx.overlay(String(cue.flashColor ?? '#ffffff'), num(cue.flashA, 0.85));
}

// -------------------------------------------------------------------------------------- registry

export type EffectFactory = (cue: FxCue, scene: THREE.Scene, ground: (x: number, z: number) => number) => Effect;
const extra = new Map<string, EffectFactory>();

/**
 * Add an effect kind. A scene's own effects live in src/capture/cinema/fx/<name>.ts and register
 * themselves there; index.ts loads every file in that folder.
 */
export function registerEffect(kind: string, factory: EffectFactory): void {
  extra.set(kind, factory);
}

export { envelope, curve, num, mulberry, glowTexture, explode, NOISE };

export function makeEffect(cue: FxCue, scene: THREE.Scene, ground: (x: number, z: number) => number): Effect | null {
  const own = extra.get(cue.kind);
  if (own) return own(cue, scene, ground);
  switch (cue.kind) {
    case 'snow':
      // Driving snow around the camera.
      return new Volume(cue, scene, 0, { count: 9000, box: [44, 26, 44], drift: [9, -3.2, 2], size: 0.07, color: '#ffffff', color2: '#dfe9ff', opacity: 0.9, wobble: 0.8 });
    case 'leaves':
      return new Volume(cue, scene, 1, { count: 900, box: [26, 16, 26], drift: [1.2, -1.4, 0.6], size: 0.16, color: '#c79bff', color2: '#ff9ad6', opacity: 0.95, wobble: 1.2 });
    case 'motes':
      return new Volume(cue, scene, 2, { count: 400, box: [20, 10, 20], drift: [0.2, 0.15, 0.1], size: 0.06, color: '#9fe8ff', color2: '#c7a4ff', opacity: 0.8, wobble: 0.6, additive: true });
    case 'embers':
      return new Volume(cue, scene, 2, { count: 1500, box: [30, 18, 30], drift: [0.6, 2.4, 0.3], size: 0.06, color: '#ffb347', color2: '#ff5a1a', opacity: 1, wobble: 0.7, additive: true });
    case 'flames':
      return new Flames(cue, scene, ground);
    case 'wash':
      return new Wash(cue, scene);
    case 'cracks':
      return new Cracks(cue, scene, ground);
    case 'light':
      return new Light(cue, scene);
    case 'flash':
    case 'fade':
      return new Overlay(cue);
    case 'shake':
      return new Shake(cue);
    case 'meteor':
      return new Meteor(cue, scene);
    case 'explode':
      return new Burst(cue, (ctx) => explode(ctx, ctx.point(cue.at), cue));
    case 'swirl': {
      // Motes drawn in from a ring around `at` to it (a channelled spell gathering).
      const color = hdr(String(cue.color ?? '#7dff6a'), 3);
      const r = num(cue.radius, 3);
      return new Emitter(cue, (ctx) => {
        const c = ctx.point(cue.at);
        const a = Math.random() * Math.PI * 2;
        const p = new THREE.Vector3(c.x + Math.cos(a) * r, c.y + (Math.random() - 0.3) * r * 0.6, c.z + Math.sin(a) * r);
        const vel = c.clone().sub(p).multiplyScalar(1.6);
        ctx.vfx.add.emit({ x: p.x, y: p.y, z: p.z, vx: vel.x, vy: vel.y, vz: vel.z, life: 0.62, size: num(cue.size, 0.35), sizeEnd: 0.05, color, sprite: 0, fadeIn: 0.2 });
      });
    }
    case 'vfx': {
      // A game recipe by name: { recipe: 'frostSpray', from: actor, ... } (see Vfx).
      return new Burst(cue, (ctx) => {
        const v = ctx.vfx as unknown as Record<string, (...a: unknown[]) => void>;
        const args = ((cue.args as unknown[]) ?? []).map((a) => (a && typeof a === 'object' && !Array.isArray(a) && 'pt' in (a as object) ? ctx.point((a as { pt: unknown }).pt) : a && typeof a === 'object' && 'color' in (a as object) ? hdr(String((a as { color: string }).color), num((a as { k?: number }).k, 3)) : a));
        v[String(cue.recipe)]?.(...args);
      });
    }
    default:
      console.warn(`cinema: unknown effect ${cue.kind}`);
      return null;
  }
}
