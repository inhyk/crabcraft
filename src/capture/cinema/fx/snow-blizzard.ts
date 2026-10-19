// Blizzard effects for the tribute's snow scene: motion-blurred driving snow, an overcast sky that
// swallows the world's clear dome and aurora, an overcast light balance and a cold white balance.
// Every one is a pure function of the shot clock, like the stock particle volumes in ../fx.ts.
//
//   snow-streaks  flakes drawn as streaks along their own travel over `trail` seconds (a shutter):
//                 count, box, drift, gust, wobble, size (world width), trail, minPx, color, color2,
//                 opacity, near (fade distance at the lens), shift/at, seed, and the usual envelope
//   snow-sky      a dome inside the world's sky: horizon (= the fog colour) to zenith, flowing
//                 snow sheets in it, `opacity`; hides the aurora while it runs
//   snow-light    scales the world's sun (`sun`) and sky light (`hemi`) while it runs
//   snow-grade    multiplies the frame by `tint` (top) and `tint2` (bottom), linear HDR, before
//                 tone mapping: a white balance
import * as THREE from 'three';
import { envelope, num, mulberry, NOISE, registerEffect, type Effect, type FxContext } from '../fx';
import type { FxCue, V3 } from '../types';

const v3 = (v: unknown, d: V3): V3 => (Array.isArray(v) && v.length === 3 ? (v as V3) : d);

// ------------------------------------------------------------------------------- streaking snow

class Streaks implements Effect {
  private mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  constructor(private cue: FxCue, scene: THREE.Scene) {
    const count = Math.round(num(cue.count, 3000));
    const rnd = mulberry(num(cue.seed, 11) * 104729 + 3);
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < seed.length; i++) seed[i] = rnd();
    const geo = new THREE.InstancedBufferGeometry();
    // A quad: x along the streak (0 tail, 1 head), y across it (-1..1).
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('seed', new THREE.InstancedBufferAttribute(seed, 4));
    geo.instanceCount = count;
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: cue.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uCentre: { value: new THREE.Vector3() },
        uBox: { value: new THREE.Vector3(...v3(cue.box, [24, 14, 24])) },
        uDrift: { value: new THREE.Vector3(...v3(cue.drift, [12, -3, 2])) },
        uGust: { value: new THREE.Vector3(...v3(cue.gust, [3, 1, 2])) },
        uWobble: { value: num(cue.wobble, 0.5) },
        uSize: { value: num(cue.size, 0.03) },
        uTrail: { value: num(cue.trail, 0.06) },
        uMinPx: { value: num(cue.minPx, 1.3) },
        uNear: { value: num(cue.near, 0.6) },
        uRes: { value: new THREE.Vector2(1920, 872) },
        uC1: { value: new THREE.Color(String(cue.color ?? '#ffffff')) },
        uC2: { value: new THREE.Color(String(cue.color2 ?? cue.color ?? '#dce8ff')) },
        uOpacity: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute vec4 seed;
        uniform float uTime, uWobble, uSize, uTrail, uMinPx, uNear;
        uniform vec3 uCentre, uBox, uDrift, uGust;
        uniform vec2 uRes;
        varying vec2 vQ; varying float vA; varying float vTone;
        vec3 at(float t) {
          float speed = 0.7 + 0.6 * seed.w;
          vec3 p = seed.xyz * uBox + uDrift * t * speed;
          // Gusts: the whole field surges together, each flake a little out of step.
          float ph = seed.x * 2.0;
          p += uGust * vec3(sin(t * 0.83 + ph) + 0.5 * sin(t * 2.1 + ph * 3.0), sin(t * 1.27 + ph), cos(t * 0.71 + ph));
          p += uWobble * vec3(sin(t * (1.3 + seed.w) + seed.y * 40.0), 0.5 * sin(t * 1.9 + seed.z * 30.0), cos(t * (1.1 + seed.z) + seed.x * 50.0));
          return p;
        }
        void main() {
          vec3 now = at(uTime);
          vec3 back = now - at(uTime - uTrail);
          vec3 rel = mod(now - uCentre + 0.5 * uBox, uBox) - 0.5 * uBox;
          vec3 head = uCentre + rel;
          vec3 tail = head - back;
          vec3 edge = abs(rel) / (0.5 * uBox);
          float fade = 1.0 - smoothstep(0.7, 1.0, max(max(edge.x, edge.y), edge.z));
          vec4 h = projectionMatrix * viewMatrix * vec4(head, 1.0);
          vec4 tl = projectionMatrix * viewMatrix * vec4(tail, 1.0);
          float near = 0.05;
          if (h.w < near || tl.w < near) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; return; }
          vec2 sh = h.xy / h.w * 0.5 * uRes;
          vec2 st = tl.xy / tl.w * 0.5 * uRes;
          // Width in pixels from the flake's size at its depth, never thinner than uMinPx (the
          // missing width becomes transparency, so a far flake keeps its share of light).
          float px = uSize * projectionMatrix[1][1] * 0.5 * uRes.y / h.w * (0.6 + 0.8 * seed.w);
          float w = max(px, uMinPx);
          vec2 d = sh - st;
          float len = length(d);
          vec2 dir = len > 1e-3 ? d / len : vec2(1.0, 0.0);
          vec2 nrm = vec2(-dir.y, dir.x);
          // Rounded ends: the quad reaches half a width past head and tail.
          vec2 s = mix(st - dir * w * 0.5, sh + dir * w * 0.5, position.x) + nrm * position.y * w * 0.5;
          vec4 c = mix(tl, h, position.x);
          gl_Position = vec4(s / (0.5 * uRes) * c.w, c.z, c.w);
          vQ = vec2(position.x, position.y);
          // Motion blur spreads the flake's light along its streak.
          float energy = clamp(px / w, 0.0, 1.0) * pow(clamp(w / (len + w), 0.0, 1.0), 0.45);
          vA = fade * energy * smoothstep(uNear, uNear * 2.5, h.w);
          vTone = seed.z;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uC1, uC2; uniform float uOpacity;
        varying vec2 vQ; varying float vA; varying float vTone;
        void main() {
          float across = 1.0 - smoothstep(0.25, 1.0, abs(vQ.y));
          float along = smoothstep(0.0, 0.35, vQ.x) * (0.55 + 0.45 * vQ.x);
          float a = across * along * vA * uOpacity;
          if (a < 0.003) discard;
          gl_FragColor = vec4(mix(uC1, uC2, vTone), a);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);
  }

  update(ctx: FxContext): void {
    const u = this.mat.uniforms;
    const env = envelope(this.cue, ctx.t);
    this.mesh.visible = env > 0;
    if (!this.mesh.visible) return;
    u.uTime.value = ctx.t + num(this.cue.offset, 40);
    u.uOpacity.value = env * num(this.cue.opacity, 0.9);
    if (this.cue.at !== undefined) u.uCentre.value.copy(ctx.point(this.cue.at));
    else u.uCentre.value.copy(ctx.camera.position).add(new THREE.Vector3(...v3(this.cue.shift, [0, 0, 0])));
    // Drawing-buffer height from pxPerUnit = h / (2 tan(fov / 2)).
    const h = ctx.pxPerUnit * 2 * Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov / 2));
    u.uRes.value.set(h * ctx.camera.aspect, h);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

// ------------------------------------------------------------------------------- overcast sky

/** The aurora curtain (world4.ts: a 650 x 90 plane on an additive shader). */
function findAurora(scene: THREE.Scene): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    const g = m.geometry as THREE.PlaneGeometry | undefined;
    if (m.isMesh && g?.type === 'PlaneGeometry' && g.parameters?.width === 650 && (m.material as THREE.Material).blending === THREE.AdditiveBlending) out.push(o);
  });
  return out;
}

class Sky implements Effect {
  private mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private hidden: THREE.Object3D[] = [];
  constructor(private cue: FxCue, private scene: THREE.Scene) {
    const r = num(cue.radius, 700);
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uA: { value: 0 },
        uHorizon: { value: new THREE.Color(String(cue.horizon ?? '#c8d3e2')) },
        uZenith: { value: new THREE.Color(String(cue.zenith ?? '#8e9cb4')) },
        uSheets: { value: num(cue.sheets, 0.35) },
        uFlow: { value: new THREE.Vector2(...((cue.flow as [number, number]) ?? [0.25, 0.04])) },
        uLow: { value: num(cue.low, -0.05) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uA, uSheets, uLow; uniform vec3 uHorizon, uZenith; uniform vec2 uFlow;
        varying vec3 vDir;
        ${NOISE}
        void main() {
          vec3 d = normalize(vDir);
          float up = clamp((d.y - uLow) / 0.6, 0.0, 1.0);
          vec3 c = mix(uHorizon, uZenith, pow(up, 0.8));
          // Sheets of blown snow: stretched noise flowing across the sky.
          vec2 q = vec2(atan(d.x, d.z) * 3.0, d.y * 9.0);
          float n = fbm(vec3(q.x * 1.3 - uTime * uFlow.x, q.y - uTime * uFlow.y, uTime * 0.05));
          c *= 1.0 + uSheets * (n - 0.5);
          gl_FragColor = vec4(c, uA);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 48, 24), this.mat);
    this.mesh.frustumCulled = false;
    // First of the transparent pass: it veils the sky and anything past its radius only.
    this.mesh.renderOrder = -50;
    scene.add(this.mesh);
  }

  update(ctx: FxContext): void {
    const a = envelope(this.cue, ctx.t) * num(this.cue.opacity, 1);
    this.mesh.visible = a > 0.001;
    this.mesh.position.copy(ctx.camera.position);
    this.mat.uniforms.uTime.value = ctx.t;
    this.mat.uniforms.uA.value = a;
    if (!this.hidden.length && this.cue.aurora !== true) {
      this.hidden = findAurora(this.scene).filter((o) => o.visible);
      for (const o of this.hidden) o.visible = false;
    }
  }

  dispose(): void {
    for (const o of this.hidden) o.visible = true;
    this.hidden = [];
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

// ------------------------------------------------------------------------------- light balance

class LightScale implements Effect {
  private lights = new Map<THREE.Light, { base: number; set: number }>();
  constructor(private cue: FxCue, private scene: THREE.Scene) {}
  update(ctx: FxContext): void {
    const env = envelope(this.cue, ctx.t);
    const sun = 1 + (num(this.cue.sun, 1) - 1) * env;
    const hemi = 1 + (num(this.cue.hemi, 1) - 1) * env;
    this.scene.traverseVisible((o) => {
      const l = o as THREE.Light;
      const k = (l as THREE.DirectionalLight).isDirectionalLight ? sun : (l as THREE.HemisphereLight).isHemisphereLight ? hemi : 0;
      if (!k) return;
      let s = this.lights.get(l);
      // Someone else changed it since we did: that is the new base.
      if (!s || Math.abs(l.intensity - s.set) > 1e-6) s = { base: l.intensity, set: 0 };
      s.set = s.base * k;
      l.intensity = s.set;
      this.lights.set(l, s);
    });
  }
  dispose(): void {
    for (const [l, s] of this.lights) if (Math.abs(l.intensity - s.set) < 1e-6) l.intensity = s.base;
    this.lights.clear();
  }
}

// ------------------------------------------------------------------------------- white balance

class Grade implements Effect {
  private mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  constructor(private cue: FxCue, scene: THREE.Scene) {
    const t1 = v3(cue.tint, [0.9, 0.96, 1.08]);
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.SrcColorFactor,
      uniforms: {
        uTop: { value: new THREE.Vector3(...t1) },
        uBottom: { value: new THREE.Vector3(...v3(cue.tint2, t1)) },
        uK: { value: 1 },
      },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop, uBottom; uniform float uK; varying vec2 vUv;
        void main(){ vec3 t = mix(uBottom, uTop, vUv.y); gl_FragColor = vec4(mix(vec3(1.0), t, uK), 1.0); }`,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1001;
    scene.add(this.mesh);
  }
  update(ctx: FxContext): void {
    const k = envelope(this.cue, ctx.t);
    this.mesh.visible = k > 0.001;
    this.mat.uniforms.uK.value = k;
  }
  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

// ------------------------------------------------------------------------- white, then leaves

/**
 * The picture whitens inside the scene (the stage's screen overlay sits above everything), so a
 * layer drawn after it, the leaves, stays visible on full white. `curve` [[t, a]...]; `level` is the
 * linear white it mixes toward (tone mapping turns about 12 into display white).
 */
class Whiteout implements Effect {
  private mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  constructor(private cue: FxCue, scene: THREE.Scene) {
    const c = new THREE.Color(String(cue.color ?? '#ffffff')).multiplyScalar(num(cue.level, 12));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: { uC: { value: c }, uA: { value: 0 } },
      vertexShader: /* glsl */ `void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `uniform vec3 uC; uniform float uA; void main(){ gl_FragColor = vec4(uC, uA); }`,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = num(cue.order, 1002);
    scene.add(this.mesh);
  }
  update(ctx: FxContext): void {
    const pairs = (this.cue.curve as [number, number][]) ?? [];
    let a = 0;
    if (pairs.length) {
      if (ctx.t <= pairs[0][0]) a = pairs[0][1];
      else {
        a = pairs[pairs.length - 1][1];
        for (let i = 1; i < pairs.length; i++) {
          const [ta, va] = pairs[i - 1];
          const [tb, vb] = pairs[i];
          if (ctx.t <= tb) {
            a = va + (vb - va) * ((ctx.t - ta) / Math.max(1e-6, tb - ta));
            break;
          }
        }
      }
    }
    // Light adds up before tone mapping: an even ramp in alpha would whiten at once.
    const k = Math.min(1, Math.max(0, a)) ** num(this.cue.gamma, 2.6);
    this.mesh.visible = k > 0.0005;
    this.mat.uniforms.uA.value = k;
  }
  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

/**
 * Leaves blowing past the lens on camera-facing quads, tumbling (their width breathes as they
 * turn) and spinning. Drawn after the whiteout and through everything (`front`, the default).
 */
class Leaves implements Effect {
  private mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  constructor(private cue: FxCue, scene: THREE.Scene) {
    const count = Math.round(num(cue.count, 240));
    const rnd = mulberry(num(cue.seed, 5) * 7727 + 1);
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < seed.length; i++) seed[i] = rnd();
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('seed', new THREE.InstancedBufferAttribute(seed, 4));
    geo.instanceCount = count;
    const front = cue.front !== false;
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: !front,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uCentre: { value: new THREE.Vector3() },
        uBox: { value: new THREE.Vector3(...v3(cue.box, [10, 7, 10])) },
        uDrift: { value: new THREE.Vector3(...v3(cue.drift, [-2, -1, 3])) },
        uWobble: { value: num(cue.wobble, 0.9) },
        uSize: { value: num(cue.size, 0.18) },
        uNear: { value: num(cue.near, 0.35) },
        uC1: { value: new THREE.Color(String(cue.color ?? '#d7709a')) },
        uC2: { value: new THREE.Color(String(cue.color2 ?? '#9a63d4')) },
        uOpacity: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute vec4 seed;
        uniform float uTime, uWobble, uSize, uNear;
        uniform vec3 uCentre, uBox, uDrift;
        varying vec2 vQ; varying vec4 vSeed; varying float vA; varying float vTurn;
        void main() {
          vSeed = seed;
          float t = uTime;
          float speed = 0.7 + 0.6 * seed.w;
          vec3 p = seed.xyz * uBox + uDrift * t * speed;
          p += uWobble * vec3(sin(t * (0.9 + seed.w) + seed.x * 40.0), 0.6 * sin(t * 1.6 + seed.y * 30.0), cos(t * (0.8 + seed.z) + seed.z * 50.0));
          vec3 rel = mod(p - uCentre + 0.5 * uBox, uBox) - 0.5 * uBox;
          vec3 edge = abs(rel) / (0.5 * uBox);
          vec4 mv = viewMatrix * vec4(uCentre + rel, 1.0);
          float turn = cos(t * (1.5 + 2.5 * seed.x) + seed.y * 6.283);
          vTurn = turn;
          float spin = t * (0.8 + 2.2 * seed.z) * (seed.w > 0.5 ? 1.0 : -1.0) + seed.x * 6.283;
          vec2 q = position.xy;
          vec2 s = vec2(q.x * (0.15 + 0.85 * abs(turn)), q.y);
          s = mat2(cos(spin), sin(spin), -sin(spin), cos(spin)) * s;
          mv.xy += s * uSize * (0.7 + 0.6 * seed.w);
          gl_Position = projectionMatrix * mv;
          vQ = q;
          vA = (1.0 - smoothstep(0.75, 1.0, max(max(edge.x, edge.y), edge.z))) * smoothstep(uNear, uNear * 2.0, -mv.z);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uC1, uC2; uniform float uOpacity;
        varying vec2 vQ; varying vec4 vSeed; varying float vA; varying float vTurn;
        void main() {
          // A leaf: pointed at both ends, widest a little below the middle, a stem at the foot.
          float y = vQ.y;
          float hw = 0.62 * pow(max(0.0, 1.0 - y * y), 0.85) * (1.0 - 0.18 * y);
          float leaf = 1.0 - smoothstep(hw - 0.06, hw, abs(vQ.x));
          float stem = (1.0 - smoothstep(0.02, 0.05, abs(vQ.x))) * step(y, -0.85) * step(-1.0, y);
          float a = max(leaf * step(-0.98, y), stem);
          if (a * vA * uOpacity < 0.01) discard;
          vec3 c = mix(uC1, uC2, vSeed.z);
          // Midrib and a darker rim; the far side is a little duller.
          c *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 0.05, abs(vQ.x))) * leaf;
          c *= mix(0.72, 1.0, smoothstep(hw * 0.2, hw * 0.9, hw - abs(vQ.x)) * 0.5 + 0.5);
          c *= vTurn > 0.0 ? 1.0 : 0.78;
          gl_FragColor = vec4(c, a * vA * uOpacity);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = num(cue.order, front ? 1003 : 6);
    scene.add(this.mesh);
  }
  update(ctx: FxContext): void {
    const u = this.mat.uniforms;
    const env = envelope(this.cue, ctx.t);
    this.mesh.visible = env > 0;
    if (!this.mesh.visible) return;
    u.uTime.value = ctx.t + num(this.cue.offset, 20);
    u.uOpacity.value = env * num(this.cue.opacity, 1);
    if (this.cue.at !== undefined) u.uCentre.value.copy(ctx.point(this.cue.at));
    else u.uCentre.value.copy(ctx.camera.position).add(new THREE.Vector3(...v3(this.cue.shift, [0, 0, 0])));
  }
  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

// ---------------------------------------------------------------------------- set dressing out

/**
 * Hides the world's small props inside a ground rectangle while it runs (the road's lamp posts in
 * a whiteout): meshes under `root` (default the Frostlight world) whose bounds are smaller than
 * `max` units and whose centre lies in `box` [x0, z0, x1, z1].
 */
class Hide implements Effect {
  private hidden: THREE.Object3D[] = [];
  private done = false;
  constructor(private cue: FxCue, private scene: THREE.Scene) {}
  update(ctx: FxContext): void {
    const on = envelope(this.cue, ctx.t) > 0;
    if (on && !this.done) {
      this.done = true;
      const [x0, z0, x1, z1] = (this.cue.box as number[]) ?? [0, 0, 0, 0];
      const max = num(this.cue.max, 4);
      const root = this.scene.getObjectByName(String(this.cue.root ?? 'WORLD IV · Frostlight'));
      const box = new THREE.Box3();
      const c = new THREE.Vector3();
      const s = new THREE.Vector3();
      root?.updateMatrixWorld(true);
      root?.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.visible || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return;
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        box.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld);
        box.getCenter(c);
        box.getSize(s);
        if (Math.max(s.x, s.y, s.z) > max || c.x < x0 || c.x > x1 || c.z < z0 || c.z > z1) return;
        m.visible = false;
        this.hidden.push(m);
      });
    }
    for (const o of this.hidden) o.visible = !on;
  }
  dispose(): void {
    for (const o of this.hidden) o.visible = true;
    this.hidden = [];
  }
}

// ------------------------------------------------------------------------------- frost eruption

/**
 * Ice shards bursting out of the ground along a line (a frost nova running toward the lens): from
 * `from` [x, z] along `yaw` for `length` units, `count` clusters spreading `spread` units sideways,
 * up to `height` tall; the wave reaches the far end `grow` seconds after t and each shard springs up
 * in `rise` seconds. `ring: true` throws them out in a circle of radius `length` instead.
 */
class Shards implements Effect {
  private group = new THREE.Group();
  private mat: THREE.MeshStandardMaterial;
  private geo: THREE.BufferGeometry;
  private items: { mesh: THREE.Mesh; at: number; s: number }[] = [];
  constructor(private cue: FxCue, scene: THREE.Scene, ground: (x: number, z: number) => number) {
    this.geo = new THREE.ConeGeometry(0.5, 1, 6, 1);
    this.geo.translate(0, 0.5, 0);
    this.mat = new THREE.MeshStandardMaterial({
      color: String(cue.color ?? '#cfeeff'),
      emissive: String(cue.emissive ?? '#3f9dff'),
      emissiveIntensity: num(cue.glow, 0.9),
      roughness: 0.12,
      metalness: 0.15,
      transparent: true,
      opacity: num(cue.opacity, 0.88),
      flatShading: true,
    });
    const [x0, z0] = (cue.from as [number, number]) ?? [0, 0];
    const yaw = num(cue.yaw, 0);
    const length = num(cue.length, 6);
    const count = Math.round(num(cue.count, 14));
    const spread = num(cue.spread, 1.2);
    const height = num(cue.height, 1.6);
    const grow = num(cue.grow, 0.5);
    const ring = cue.ring === true;
    const rnd = mulberry(num(cue.seed, 9) * 6151 + 7);
    for (let i = 0; i < count; i++) {
      const k = (i + 0.5) / count;
      let x: number;
      let z: number;
      let out: number;
      if (ring) {
        const a = (i / count) * Math.PI * 2 + rnd() * 0.4;
        const r = length * (0.75 + 0.25 * rnd());
        x = x0 + Math.sin(a) * r;
        z = z0 + Math.cos(a) * r;
        out = a;
      } else {
        const d = length * (0.15 + 0.85 * k) + (rnd() - 0.5) * 0.4;
        const side = (rnd() - 0.5) * 2 * spread * (0.3 + 0.7 * k);
        x = x0 + Math.sin(yaw) * d + Math.cos(yaw) * side;
        z = z0 + Math.cos(yaw) * d - Math.sin(yaw) * side;
        out = yaw + Math.atan2(side, d);
      }
      // A cluster: one big shard and two leaning satellites, all leaning away from the source.
      for (let j = 0; j < 3; j++) {
        const m = new THREE.Mesh(this.geo, this.mat);
        const h = height * (j ? 0.45 + 0.3 * rnd() : 0.7 + 0.5 * rnd()) * (ring ? 1 : 1.1 - 0.45 * k);
        const w = h * (0.22 + 0.1 * rnd());
        const jx = j ? (rnd() - 0.5) * w * 2.5 : 0;
        const jz = j ? (rnd() - 0.5) * w * 2.5 : 0;
        m.position.set(x + jx, ground(x + jx, z + jz) - 0.05, z + jz);
        m.rotation.set(0, rnd() * Math.PI, 0);
        const lean = 0.25 + 0.35 * rnd() + (j ? 0.3 : 0);
        m.rotateOnWorldAxis(new THREE.Vector3(Math.cos(out), 0, -Math.sin(out)), lean);
        m.scale.set(w, h, w);
        m.castShadow = true;
        m.visible = false;
        this.group.add(m);
        this.items.push({ mesh: m, at: cue.t + grow * (ring ? 0.1 * rnd() : k) + j * 0.04, s: 1 });
      }
    }
    for (const it of this.items) it.s = it.mesh.scale.y;
    scene.add(this.group);
  }
  update(ctx: FxContext): void {
    const env = envelope(this.cue, ctx.t);
    const rise = num(this.cue.rise, 0.14);
    for (const it of this.items) {
      const k = (ctx.t - it.at) / rise;
      if (k <= 0 || env <= 0) {
        it.mesh.visible = false;
        continue;
      }
      // Springs up with a little overshoot, then holds.
      const e = k >= 1 ? 1 : 1 + 2.2 * (k - 1) ** 3 + 1.2 * (k - 1) ** 2;
      it.mesh.visible = true;
      const w = it.mesh.scale.x;
      it.mesh.scale.set(w, Math.max(0.001, it.s * e * env), w);
    }
  }
  dispose(): void {
    this.group.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

registerEffect('snow-shards', (cue, scene, ground) => new Shards(cue, scene, ground));
registerEffect('snow-hide', (cue, scene) => new Hide(cue, scene));
registerEffect('snow-whiteout', (cue, scene) => new Whiteout(cue, scene));
registerEffect('snow-leaves', (cue, scene) => new Leaves(cue, scene));
registerEffect('snow-streaks', (cue, scene) => new Streaks(cue, scene));
registerEffect('snow-sky', (cue, scene) => new Sky(cue, scene));
registerEffect('snow-light', (cue, scene) => new LightScale(cue, scene));
registerEffect('snow-grade', (cue, scene) => new Grade(cue, scene));
