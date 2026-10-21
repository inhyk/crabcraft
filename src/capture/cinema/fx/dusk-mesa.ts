// Backdrop and lens pieces for the dusk scene's sunset shots in Clawhaven, and stone for the
// cathedral's parapet. Pure functions of the shot clock like the other dusk effects.
//
//   dusk-mesa     red sandstone mesas and buttes on the far horizon (the world has none): banded cliffs
//                 over talus skirts, flat caps, grooves down the walls, hazed toward a colour with distance
//   dusk-glare    the low sun's glare over the lens: a hot core, a wide bloom and a horizontal streak
//   dusk-merlons  weathered, soot-dark stone blocks laid over a parapet's pale merlons
import * as THREE from 'three';
import { curve, envelope, mulberry, num, registerEffect, type Effect, type FxContext } from '../fx';
import type { FxCue } from '../types';

const smooth = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

// ------------------------------------------------------------------------------------------ mesas

const STRATA = ['#7a2e1c', '#a4482a', '#c06a3c', '#8a3a22', '#d08a58', '#9a4426', '#6a2618', '#b85a32', '#c97d4c', '#8e3a20'];

/**
 * One mesa into the shared arrays: a ring of `NA` columns by `NV` levels around [cx, cz], a fan cap.
 * r: the cliff's footprint radius; top: the cap's height; base: the foot's height.
 */
function addMesa(pos: number[], col: number[], idx: number[], cx: number, cz: number, r: number, top: number, base: number, seed: number, stretch: number, yaw: number): void {
  const R = mulberry(seed * 7919 + 13);
  const NA = 96;
  const NV = 40;
  const ph = Array.from({ length: 7 }, () => R() * 6.283);
  const amp = [0.22, 0.14, 0.09, 0.06, 0.04, 0.025, 0.015];
  const plan = (a: number) => 1 + amp.reduce((s, A, k) => s + A * Math.sin(a * (k + 1) + ph[k]), 0);
  const gp = [R() * 6.28, R() * 6.28, R() * 6.28];
  const gf = [17 + Math.floor(R() * 8), 31 + Math.floor(R() * 10), 53 + Math.floor(R() * 12)];
  const groove = (a: number) => Math.max(0, Math.sin(a * gf[0] + gp[0]) * 0.55 + Math.sin(a * gf[1] + gp[1]) * 0.3 + Math.sin(a * gf[2] + gp[2]) * 0.15) ** 2.5;
  const H = top - base;
  const talus = 0.3 + R() * 0.12;
  const layers = 9 + Math.floor(R() * 5);
  const bandShift = Math.floor(R() * STRATA.length);
  const lean = Array.from({ length: layers + 1 }, () => 0.015 + R() * 0.04);
  // Most stand in two tiers: a bench part way up, the upper cliff narrower and off centre.
  const bench = R() < 0.7 ? 0.5 + R() * 0.25 : 2;
  const tierK = 0.58 + R() * 0.22;
  const tierOff = [(R() - 0.5) * r * 0.3, (R() - 0.5) * r * 0.3];
  // Scree fans down some sides; a ragged rim.
  const fanP = R() * 6.28;
  const rimP = [R() * 6.28, R() * 6.28];
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const c = new THREE.Color();
  const dust = new THREE.Color('#9a5c3c');
  const scrub = new THREE.Color('#4e3424');
  const first = pos.length / 3;
  for (let v = 0; v <= NV; v++) {
    const u = v / NV;
    // Skirt: wide and concave; cliff: each stratum stepping in a little; cap edge rounded off.
    let f: number;
    let band = 0;
    if (u < talus) f = 1 + 0.95 * ((talus - u) / talus) ** 1.5;
    else {
      const w = ((u - talus) / (1 - talus)) * layers;
      band = Math.floor(w);
      f = (1 - lean[band] * (w - band)) * (1 - 0.16 * (u - talus));
      if (u > 0.97) f *= 0.985;
    }
    const tier = smooth(bench, bench + 0.03, u);
    f *= 1 - (1 - tierK) * tier;
    const y = base + H * u;
    for (let a = 0; a < NA; a++) {
      const ang = (a / NA) * Math.PI * 2;
      const g = groove(ang);
      const cliff = smooth(talus, talus + 0.08, u);
      const fan = u < talus ? 1 + 0.45 * Math.max(0, Math.sin(ang * 2 + fanP)) * ((talus - u) / talus) : 1;
      const k = f * fan * plan(ang) * (1 - 0.09 * g * cliff + 0.05 * g * (1 - cliff)) * (1 + (R() - 0.5) * 0.012);
      const lx = Math.cos(ang) * r * k * stretch + tierOff[0] * tier;
      const lz = Math.sin(ang) * r * k + tierOff[1] * tier;
      const rim = v === NV ? H * (0.025 * Math.sin(ang * 3 + rimP[0]) + 0.015 * Math.sin(ang * 7 + rimP[1])) : 0;
      pos.push(cx + lx * cy + lz * sy, y + rim + (u > 0.02 && u < 0.98 ? (R() - 0.5) * H * 0.006 : 0), cz - lx * sy + lz * cy);
      // Strata by height (wavering a little round the mesa), dusty talus, grooves in shadow.
      if (u < talus) {
        c.set(STRATA[(bandShift + 1) % STRATA.length]).lerp(dust, 0.55 + 0.3 * (1 - u / talus));
      } else {
        const wob = 0.35 * Math.sin(ang * 3 + ph[0]) + 0.2 * Math.sin(ang * 7 + ph[1]);
        const bi = Math.floor(((u - talus) / (1 - talus)) * layers * 1.7 + wob);
        c.set(STRATA[(((bi + bandShift) % STRATA.length) + STRATA.length) % STRATA.length]);
        if (u > 0.985) c.lerp(scrub, 0.7);
      }
      c.multiplyScalar(1 - 0.38 * g * cliff);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let v = 0; v < NV; v++) {
    for (let a = 0; a < NA; a++) {
      const i0 = first + v * NA + a;
      const i1 = first + v * NA + ((a + 1) % NA);
      const j0 = i0 + NA;
      const j1 = i1 + NA;
      idx.push(i0, j0, i1, i1, j0, j1);
    }
  }
  // The cap: a gently domed fan of scrubby rock.
  const ci = pos.length / 3;
  pos.push(cx + (tierOff[0] * cy + tierOff[1] * sy) * (bench < 1 ? 1 : 0), top + H * 0.01, cz + (-tierOff[0] * sy + tierOff[1] * cy) * (bench < 1 ? 1 : 0));
  c.set(scrub);
  col.push(c.r, c.g, c.b);
  const ring = first + NV * NA;
  for (let a = 0; a < NA; a++) idx.push(ci, ring + ((a + 1) % NA), ring + a);
}

/**
 * Mesas: [[x, z, r, top, seed?, stretch?, yawDeg?], ...]. base (foot height, -8), haze (colour), hazeK
 * (per unit, 0.0016), hazeMax (0.85), lift (shadow fill, 0.12).
 */
class Mesas implements Effect {
  private mesh: THREE.Mesh;
  constructor(cue: FxCue, scene: THREE.Scene) {
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const base = num(cue.base, -8);
    for (const [i, m] of ((cue.mesas as number[][]) ?? []).entries()) {
      const [x, z, r, top, seed = i + 1, stretch = 1, yaw = 0] = m;
      addMesa(pos, col, idx, x, z, r, top, base, seed, stretch, (yaw * Math.PI) / 180);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0, fog: false });
    const haze = new THREE.Color(String(cue.haze ?? '#e89a78'));
    const uHaze = { value: haze };
    const uK = { value: num(cue.hazeK, 0.0016) };
    const uMax = { value: num(cue.hazeMax, 0.85) };
    const uLift = { value: num(cue.lift, 0.12) };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { uHaze, uK, uMax, uLift });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vWY;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWY = (modelMatrix * vec4(transformed, 1.0)).y;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uHaze; uniform float uK, uMax, uLift; varying float vWY;')
        .replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>
          float dist = length(vViewPosition);
          gl_FragColor.rgb += diffuseColor.rgb * uLift;
          float hz = (1.0 - exp(-dist * uK)) * mix(1.0, 0.72, smoothstep(0.0, 140.0, vWY));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, clamp(hz, 0.0, uMax));`,
        );
    };
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'cinema-mesas';
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  update(): void {}
  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

// ------------------------------------------------------------------------------------------ glare

/**
 * The sun's glare over the lens at the screen position of `at` (a far world point): `alpha` [[t, a]...],
 * `radius` [[t, r]...] (fraction of the frame's height the bloom reaches), color (core), color2 (bloom).
 */
class Glare implements Effect {
  private mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private p = new THREE.Vector3();
  constructor(
    private cue: FxCue,
    scene: THREE.Scene,
  ) {
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uC: { value: new THREE.Vector2() },
        uR: { value: 0.3 },
        uA: { value: 0 },
        uAspect: { value: 2.2 },
        uCore: { value: new THREE.Color(String(cue.color ?? '#fff4e0')) },
        uBloom: { value: new THREE.Color(String(cue.color2 ?? '#ffb060')) },
      },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec2 uC; uniform float uR, uA, uAspect; uniform vec3 uCore, uBloom;
        varying vec2 vUv;
        void main() {
          vec2 d = (vUv - uC) * vec2(uAspect, 1.0);
          float r = length(d) / max(uR, 1e-3);
          float core = exp(-r * r * 9.0);
          float bloom = exp(-r * 2.2);
          float streak = exp(-abs(d.y) / (uR * 0.05)) * exp(-abs(d.x) / (uR * 2.2));
          vec3 c = uCore * core * 1.6 + uBloom * (bloom * 0.75 + streak * 0.45);
          gl_FragColor = vec4(c * uA, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = num(cue.order, 998);
    scene.add(this.mesh);
  }
  update(ctx: FxContext): void {
    const a = this.cue.alpha ? curve(this.cue.alpha as [number, number][], ctx.t) : envelope(this.cue, ctx.t);
    this.mesh.visible = a > 0.001;
    if (!this.mesh.visible) return;
    this.p.copy(ctx.point(this.cue.at)).project(ctx.camera);
    const u = this.mat.uniforms;
    (u.uC.value as THREE.Vector2).set(this.p.x * 0.5 + 0.5, this.p.y * 0.5 + 0.5);
    u.uR.value = this.cue.radius ? curve(this.cue.radius as [number, number][], ctx.t) : 0.3;
    u.uA.value = a;
    u.uAspect.value = ctx.camera.aspect;
  }
  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

// ---------------------------------------------------------------------------------------- merlons

/**
 * Rough stone blocks: boxes [[x, y, z, w, h, d, yawDeg?], ...] (centre, size; world units), each a
 * subdivided box pushed in and out by noise so its edges chip and its faces pit. color, color2 (stone
 * tones), soot (top and edge darkening, 0.5), seed.
 */
class Merlons implements Effect {
  private mesh: THREE.Mesh;
  constructor(cue: FxCue, scene: THREE.Scene) {
    const boxes = (cue.boxes as number[][]) ?? [];
    const R = mulberry(num(cue.seed, 7) * 131 + 3);
    const c1 = new THREE.Color(String(cue.color ?? '#4a3e38'));
    const c2 = new THREE.Color(String(cue.color2 ?? '#6e5a4c'));
    const sootC = new THREE.Color('#120c0a');
    const soot = num(cue.soot, 0.5);
    const geos: THREE.BufferGeometry[] = [];
    const c = new THREE.Color();
    for (const [x, y, z, w0, h0, d0, yaw = 0] of boxes) {
      // No two blocks cut alike: a little off in size, set a little askew.
      const w = w0 * (0.92 + 0.14 * R());
      const h = h0 * (0.9 + 0.16 * R());
      const d = d0 * (0.94 + 0.1 * R());
      const g = new THREE.BoxGeometry(w, h, d, 6, 6, 5).toNonIndexed();
      g.rotateZ((R() - 0.5) * 0.08);
      g.rotateX((R() - 0.5) * 0.06);
      const p = g.getAttribute('position');
      const cols = new Float32Array(p.count * 3);
      const ph = [R() * 9, R() * 9, R() * 9];
      // A smooth displacement field per block (same at shared corners, so the faces stay closed).
      const field = (px: number, py: number, pz: number) =>
        Math.sin(px * 7.1 + ph[0]) * Math.sin(py * 6.3 + ph[1]) * Math.sin(pz * 7.7 + ph[2]) * 0.6 +
        Math.sin(px * 17.3 + py * 3.1 + ph[1]) * Math.sin(pz * 15.1 + ph[0]) * 0.4;
      const tone = R();
      for (let i = 0; i < p.count; i++) {
        const px = p.getX(i);
        const py = p.getY(i);
        const pz = p.getZ(i);
        // Edges and corners chip deepest.
        const ex = Math.abs(px) / (w / 2);
        const ey = Math.abs(py) / (h / 2);
        const ez = Math.abs(pz) / (d / 2);
        const edge = Math.max(0, (ex > 0.95 ? 1 : 0) + (ey > 0.95 ? 1 : 0) + (ez > 0.95 ? 1 : 0) - 1);
        const n = field(px, py, pz);
        const k = 1 - 0.035 * (1 + n) - 0.06 * edge * (0.6 + 0.4 * n);
        p.setXYZ(i, px * k, py * (py > 0 ? 1 - 0.05 * edge * (0.5 + 0.5 * n) : 1), pz * k);
        c.copy(c1).lerp(c2, Math.min(1, Math.max(0, tone * 0.6 + 0.4 * (0.5 + 0.5 * n))));
        c.lerp(sootC, soot * Math.min(1, 0.35 * edge + 0.6 * Math.max(0, py / (h / 2))));
        cols[i * 3] = c.r;
        cols[i * 3 + 1] = c.g;
        cols[i * 3 + 2] = c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      g.deleteAttribute('uv');
      g.computeVertexNormals();
      g.rotateY((yaw * Math.PI) / 180);
      g.translate(x, y, z);
      geos.push(g);
    }
    const all = new THREE.BufferGeometry();
    const n = geos.reduce((s, g) => s + g.getAttribute('position').count, 0);
    const P = new Float32Array(n * 3);
    const N = new Float32Array(n * 3);
    const C = new Float32Array(n * 3);
    let o = 0;
    for (const g of geos) {
      P.set(g.getAttribute('position').array as Float32Array, o);
      N.set(g.getAttribute('normal').array as Float32Array, o);
      C.set(g.getAttribute('color').array as Float32Array, o);
      o += g.getAttribute('position').count * 3;
      g.dispose();
    }
    all.setAttribute('position', new THREE.BufferAttribute(P, 3));
    all.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    all.setAttribute('color', new THREE.BufferAttribute(C, 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, flatShading: true });
    this.mesh = new THREE.Mesh(all, mat);
    this.mesh.name = 'cinema-merlons';
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
  }
  update(): void {}
  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

registerEffect('dusk-mesa', (cue, scene) => new Mesas(cue, scene));
registerEffect('dusk-glare', (cue, scene) => new Glare(cue, scene));
registerEffect('dusk-merlons', (cue, scene) => new Merlons(cue, scene));
