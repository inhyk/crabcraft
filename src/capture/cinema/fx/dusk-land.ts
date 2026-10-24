// The canyon land beyond the tauren's lip for the dusk scene's sunset shots in Clawhaven: the bay is
// replaced, inside an arc of bearings round a centre, by a red-rock valley that breaks off the shore in
// terraced cliffs to a broad floor, knolls standing on it and a river winding out toward the mesas.
// Pure function of the shot clock (the river's ripples run on ctx.t).
//
//   dusk-land  center [x, z], arc [b0, b1] (bearings, degrees, 0 = +z, 90 = +x), reach (outer radius),
//              cut (the world's terrain under this height and everything past the shore goes), floor
//              (valley floor height), drop (rim to floor, units), rise (floor climb per unit past 250),
//              river [[bearing, dist]...] and width [near, far], knolls [[bearing, dist, r, top]...],
//              haze, hazeK, hazeMax (as dusk-mesa), sun (far point: the river's glint), sky [hi, lo]
import * as THREE from 'three';
import { num, registerEffect, type Effect, type FxContext } from '../fx';
import { backdropLight } from './dusk-mesa';
import type { FxCue } from '../types';

const smooth = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
const deg = Math.PI / 180;
/** Smooth value noise in 2D (fixed lattice hash): the floor's rolls and the rim's bites. */
function vnoise(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const h = (a: number, b: number) => {
    const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  return (h(xi, zi) * (1 - u) + h(xi + 1, zi) * u) * (1 - v) + (h(xi, zi + 1) * (1 - u) + h(xi + 1, zi + 1) * u) * v;
}
const fbm = (x: number, z: number) => vnoise(x, z) * 0.55 + vnoise(x * 2.1 + 5.2, z * 2.1 - 1.7) * 0.3 + vnoise(x * 4.3 - 2.1, z * 4.3 + 7.7) * 0.15;

const RIM_N = 96;
const GLSL_NOISE = /* glsl */ `
float lhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float lnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(lhash(i), lhash(i + vec2(1.0, 0.0)), u.x), mix(lhash(i + vec2(0.0, 1.0)), lhash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float lfbm(vec2 p) { return lnoise(p) * 0.5 + lnoise(p * 2.03 + 3.1) * 0.27 + lnoise(p * 4.1 - 1.7) * 0.15 + lnoise(p * 8.3 + 9.2) * 0.08; }
`;

class Land implements Effect {
  private land: THREE.Mesh;
  private river: THREE.Mesh;
  private riverMat: THREE.ShaderMaterial;
  private hooks = new Map<THREE.Material, { onBeforeCompile: THREE.Material['onBeforeCompile']; key: () => string }>();
  private cutU: Record<string, { value: unknown }> = {};
  private hidden: THREE.Object3D[] | null = null;
  private moved: { mesh: THREE.InstancedMesh; i: number; m: THREE.Matrix4 }[] = [];
  private water: THREE.Object3D | null = null;
  private c: [number, number];
  private arc: [number, number];
  private rim: Float32Array;
  private sunDir = new THREE.Vector3();

  constructor(
    cue: FxCue,
    private scene: THREE.Scene,
    ground: (x: number, z: number) => number,
  ) {
    const c = (this.c = (cue.center as [number, number]) ?? [0, 0]);
    const arc = (this.arc = (cue.arc as [number, number]) ?? [0, 180]);
    const reach = num(cue.reach, 1400);
    const cut = num(cue.cut, 0.2);
    const floor = num(cue.floor, -14);
    const drop = num(cue.drop, 30);
    const rise = num(cue.rise, 0.01);
    const at = (b: number, d: number): [number, number] => [c[0] + Math.sin(b * deg) * d, c[1] + Math.cos(b * deg) * d];

    // The shore per bearing: the first point out from the centre where the world dips under `cut`.
    this.rim = new Float32Array(RIM_N);
    for (let i = 0; i < RIM_N; i++) {
      const b = arc[0] + ((arc[1] - arc[0]) * i) / (RIM_N - 1);
      let d = 6;
      while (d < 400 && ground(...at(b, d)) >= cut) d += 0.5;
      this.rim[i] = d;
    }
    const rimAt = (b: number) => {
      const f = Math.min(RIM_N - 1, Math.max(0, ((b - arc[0]) / (arc[1] - arc[0])) * (RIM_N - 1)));
      const i = Math.min(RIM_N - 2, Math.floor(f));
      return this.rim[i] + (this.rim[i + 1] - this.rim[i]) * (f - i);
    };

    // The river: the polyline resampled every ~2 units, with its width.
    const rp = ((cue.river as number[][]) ?? []).map(([b, d]) => at(b, d));
    const [w0, w1] = (cue.width as [number, number]) ?? [2.5, 8];
    const pts: [number, number][] = [];
    for (let k = 0; k < rp.length - 1; k++) {
      // Catmull-Rom through the given points.
      const p0 = rp[Math.max(0, k - 1)];
      const p1 = rp[k];
      const p2 = rp[k + 1];
      const p3 = rp[Math.min(rp.length - 1, k + 2)];
      const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 2));
      for (let j = 0; j < n; j++) {
        const t = j / n;
        const t2 = t * t;
        const t3 = t2 * t;
        const cr = (a: number, b2: number, c2: number, d2: number) => 0.5 * (2 * b2 + (-a + c2) * t + (2 * a - 5 * b2 + 4 * c2 - d2) * t2 + (-a + 3 * b2 - 3 * c2 + d2) * t3);
        pts.push([cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    if (rp.length) pts.push(rp[rp.length - 1]);
    const distC = (x: number, z: number) => Math.hypot(x - c[0], z - c[1]);
    const widthAt = (x: number, z: number) => w0 + (w1 - w0) * smooth(40, 500, distC(x, z));
    const floorY = (d: number) => floor + Math.max(0, d - 250) * rise;
    const waterY = (d: number) => floorY(d) - 0.9;
    const riverDist = (x: number, z: number) => {
      let best = 1e9;
      for (let k = 0; k < pts.length - 1; k++) {
        const [ax, az] = pts[k];
        const [bx, bz] = pts[k + 1];
        const ex = bx - ax;
        const ez = bz - az;
        const l2 = ex * ex + ez * ez || 1;
        const t = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / l2));
        const dx = x - ax - ex * t;
        const dz = z - az - ez * t;
        const dd = dx * dx + dz * dz;
        if (dd < best) best = dd;
      }
      return Math.sqrt(best);
    };
    const knolls = ((cue.knolls as number[][]) ?? []).map(([b, d, r, top]) => [...at(b, d), r, top]);

    const height = (b: number, d: number, x: number, z: number): [number, number] => {
      const rim = rimAt(b);
      const u = d - rim;
      if (u < 0) return [cut - 0.12, 0];
      // The rim bites in and out; the drop comes down in three benches with cliffs between.
      const dr = drop * (0.8 + 0.4 * vnoise(b * 0.08, 3.3));
      const s = Math.min(1, u / dr);
      const st = s * 3;
      const fl = Math.min(2, Math.floor(st));
      const stepped = (fl + smooth(0.3 + 0.2 * vnoise(b * 0.2, fl * 7.1), 0.9, st - fl)) / 3;
      const rough = (fbm(x * 0.035, z * 0.035) - 0.5) * 3.2 + (fbm(x * 0.15, z * 0.15) - 0.5) * 0.8;
      const fy = floorY(d) + rough;
      let h = cut - 0.05 + (fy - (cut - 0.05)) * stepped;
      // Knolls on the floor: steep sided, flat topped, benched.
      for (const [kx, kz, r, top] of knolls) {
        const ang = Math.atan2(z - kz, x - kx);
        const q = Math.hypot(x - kx, z - kz) / (r * (0.78 + 0.3 * vnoise(ang * 2.5, kx) + 0.12 * vnoise(ang * 9, kz)));
        if (q > 1.9) continue;
        const prof = smooth(1.85, 1.0, q) ** 1.6 * 0.4 + smooth(1.0, 0.86, q) * 0.3 + smooth(0.72, 0.6, q) * 0.3;
        const cap = 1 - 0.06 * vnoise(x * 0.2, z * 0.2);
        h = Math.max(h, fy + (top - fy) * prof * cap);
      }
      // The river's channel, cut under its water with low banks.
      const rd = riverDist(x, z);
      const w = widthAt(x, z);
      const bank = 1 - smooth(w * 0.45, w * 1.7, rd);
      if (bank > 0 && s >= 1) h = h + (floorY(d) - 1.7 - h) * bank;
      return [h, 1 - smooth(w * 0.8, w * 3.2, rd)];
    };

    // The land: a polar grid over the arc, fine near the shore and coarse at the horizon.
    const rIn = Math.max(4, Math.min(...this.rim) - 2);
    const radii: number[] = [];
    for (let d = rIn; d < reach; d *= 1.022) radii.push(d);
    radii.push(reach);
    const NB = Math.ceil((arc[1] - arc[0]) / 0.45);
    const pos: number[] = [];
    const wet: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j <= NB; j++) {
      const b = arc[0] + ((arc[1] - arc[0]) * j) / NB;
      for (const d of radii) {
        const [x, z] = at(b, d);
        const [h, wv] = height(b, d, x, z);
        pos.push(x, h, z);
        wet.push(wv);
      }
    }
    const NR = radii.length;
    for (let j = 0; j < NB; j++) {
      for (let i = 0; i < NR - 1; i++) {
        const a = j * NR + i;
        const b2 = (j + 1) * NR + i;
        idx.push(a, a + 1, b2, b2, a + 1, b2 + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aWet', new THREE.Float32BufferAttribute(wet, 1));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const uHaze = { value: new THREE.Color(String(cue.haze ?? '#ea8c6a')) };
    const uK = { value: num(cue.hazeK, 0.0013) };
    const uMax = { value: num(cue.hazeMax, 0.56) };
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, metalness: 0, fog: false });
    const bl = backdropLight(cue);
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { uHaze, uK, uMax }, bl?.uniforms ?? {});
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aWet; varying float vWet; varying vec3 vLW; varying vec3 vLN;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWet = aWet; vLW = (modelMatrix * vec4(transformed, 1.0)).xyz; vLN = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform vec3 uHaze; uniform float uK, uMax; varying float vWet; varying vec3 vLW; varying vec3 vLN;\n${GLSL_NOISE}\n${bl?.glsl ?? ''}`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            vec3 n = normalize(vLN);
            float steep = smoothstep(0.82, 0.55, n.y);
            float g1 = lfbm(vLW.xz * 0.08);
            float g2 = lfbm(vLW.xz * 0.7 + 13.0);
            // The floor: red dust and gravel, dark scrub in patches, pale silt by the river.
            vec3 dust = mix(vec3(0.3, 0.1, 0.05), vec3(0.55, 0.24, 0.11), g1);
            dust *= 0.7 + 0.45 * g2;
            dust *= 0.75 + 0.35 * smoothstep(0.3, 0.6, lfbm(vLW.xz * 0.025 + 7.0));
            float scrub = smoothstep(0.5, 0.62, lfbm(vLW.xz * 0.22 + 41.0));
            dust = mix(dust, vec3(0.16, 0.1, 0.06), scrub * 0.75 * (1.0 - vWet));
            dust = mix(dust, vec3(0.66, 0.44, 0.28), smoothstep(0.25, 0.75, vWet) * 0.7);
            dust = mix(dust, vec3(0.2, 0.12, 0.08), smoothstep(0.85, 1.0, vWet));
            // The cliffs: sandstone strata by height, wavering, with dark seams and pale bands.
            float y = vLW.y + (lnoise(vLW.xz * 0.04) - 0.5) * 4.0;
            float band = lnoise(vec2(y * 0.45, 0.5)) * 0.7 + lnoise(vec2(y * 1.7, 3.5)) * 0.3;
            vec3 rock = mix(vec3(0.36, 0.12, 0.06), vec3(0.62, 0.28, 0.13), band);
            rock = mix(rock, vec3(0.72, 0.44, 0.26), smoothstep(0.78, 0.9, band) * 0.5);
            rock *= 0.8 + 0.3 * lfbm(vec2((vLW.x + vLW.z) * 0.12, y * 0.15));
            diffuseColor.rgb = mix(dust, rock, steep);
          }`,
        )
        .replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>
          ${bl ? 'gl_FragColor.rgb = blLight(diffuseColor.rgb, normalize(vLN), vLW, 1.0);' : ''}
          float hz = 1.0 - exp(-length(vViewPosition) * uK);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, clamp(hz, 0.0, uMax));`,
        );
    };
    this.land = new THREE.Mesh(geo, mat);
    this.land.name = 'cinema-land';
    this.land.frustumCulled = false;
    this.land.receiveShadow = true;
    scene.add(this.land);

    // The water: a ribbon along the river at its level, wide enough that the banks trim it.
    const rpos: number[] = [];
    const ridx: number[] = [];
    for (let k = 0; k < pts.length; k++) {
      const [x, z] = pts[k];
      const [ax, az] = pts[Math.max(0, k - 1)];
      const [bx, bz] = pts[Math.min(pts.length - 1, k + 1)];
      let tx = bx - ax;
      let tz = bz - az;
      const l = Math.hypot(tx, tz) || 1;
      tx /= l;
      tz /= l;
      const hw = widthAt(x, z) * 1.5;
      const y = waterY(distC(x, z));
      rpos.push(x - tz * hw, y, z + tx * hw, x + tz * hw, y, z - tx * hw);
      if (k < pts.length - 1) {
        const a = k * 2;
        ridx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
    }
    const rgeo = new THREE.BufferGeometry();
    rgeo.setAttribute('position', new THREE.Float32BufferAttribute(rpos, 3));
    rgeo.setIndex(ridx);
    const [skyHi, skyLo] = ((cue.sky as string[]) ?? ['#c8708a', '#ffc890']).map((s) => new THREE.Color(s));
    this.riverMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: {
        uT: { value: 0 },
        uSun: { value: this.sunDir },
        uHi: { value: skyHi },
        uLo: { value: skyLo },
        uHaze,
        uK,
        uMax,
      },
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform float uT, uK, uMax; uniform vec3 uSun, uHi, uLo, uHaze;
        varying vec3 vW;
        ${GLSL_NOISE}
        void main() {
          vec2 p = vW.xz;
          float e = 0.35;
          float h0 = lfbm(p * 0.45 + vec2(uT * 0.35, uT * 0.12));
          float hx = lfbm((p + vec2(e, 0.0)) * 0.45 + vec2(uT * 0.35, uT * 0.12));
          float hz2 = lfbm((p + vec2(0.0, e)) * 0.45 + vec2(uT * 0.35, uT * 0.12));
          vec3 n = normalize(vec3((h0 - hx) * 0.9, 1.0, (h0 - hz2) * 0.9));
          vec3 v = normalize(vW - cameraPosition);
          vec3 r = reflect(v, n);
          float el = clamp(r.y, 0.0, 1.0);
          vec3 sky = mix(uLo, uHi, smoothstep(0.0, 0.35, el));
          float fres = 0.55 + 0.45 * pow(clamp(1.0 - dot(-v, n), 0.0, 1.0), 3.0);
          vec3 deep = vec3(0.3, 0.16, 0.14);
          vec3 c = mix(deep, sky, fres);
          float gl = pow(max(dot(r, uSun), 0.0), 60.0);
          c += vec3(1.0, 0.86, 0.6) * gl * 2.2;
          float hz = 1.0 - exp(-length(vW - cameraPosition) * uK);
          c = mix(c, uHaze, clamp(hz, 0.0, uMax) * 0.7);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.river = new THREE.Mesh(rgeo, this.riverMat);
    this.river.name = 'cinema-river';
    this.river.frustumCulled = false;
    scene.add(this.river);
    const sp = (cue.sun as number[]) ?? [c[0], 100, c[1] + 900];
    this.sunDir.set(sp[0] - c[0], sp[1], sp[2] - c[1]).normalize();
    this.cutTerrain(cut, rIn);
  }

  /** Past the shore inside the arc, the world's terrain is cut away (the land replaces it). */
  private cutTerrain(cut: number, rIn: number): void {
    this.cutU = {
      uCutC: { value: new THREE.Vector2(this.c[0], this.c[1]) },
      uCutArc: { value: new THREE.Vector2(this.arc[0], this.arc[1]) },
      uCutRim: { value: Array.from(this.rim) },
      uCutY: { value: cut },
      uCutIn: { value: rIn },
    };
    const terrain = this.scene.getObjectByName('terrain') as THREE.Mesh | undefined;
    if (terrain && !Array.isArray(terrain.material)) this.cut(terrain.material, true);
  }

  /** Discard a material's fragments past the shore in the arc (and, for the ground, under the cut). */
  private cut(mat: THREE.Material, ground: boolean): void {
    if (this.hooks.has(mat) || (mat as THREE.ShaderMaterial).isShaderMaterial) return;
    const hook = { onBeforeCompile: mat.onBeforeCompile, key: mat.customProgramCacheKey };
    this.hooks.set(mat, hook);
    const u = this.cutU;
    mat.onBeforeCompile = (sh, r) => {
      hook.onBeforeCompile.call(mat, sh, r);
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCutW;')
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vec4 cutW = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
          cutW = instanceMatrix * cutW;
          #endif
          vCutW = (modelMatrix * cutW).xyz;`,
        );
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vCutW; uniform vec2 uCutC, uCutArc; uniform float uCutRim[${RIM_N}]; uniform float uCutY, uCutIn;`)
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
          {
            vec2 dv = vCutW.xz - uCutC;
            float dd = length(dv);
            float rel = mod(degrees(atan(dv.x, dv.y)) - uCutArc.x, 360.0);
            float span = uCutArc.y - uCutArc.x;
            if (rel < span && dd > uCutIn) {
              float f = rel / span * float(${RIM_N - 1});
              int i = int(min(floor(f), float(${RIM_N - 2})));
              float rim = mix(uCutRim[i], uCutRim[i + 1], f - float(i));
              if (dd > rim${ground ? ' || vCutW.y < uCutY' : ' + 1.0'}) discard;
            }
          }`,
        );
    };
    const key = hook.key.call(mat);
    mat.customProgramCacheKey = () => `${key}-cut${ground ? 'g' : ''}`;
    mat.needsUpdate = true;
  }

  /** Props past the shore inside the arc would float over the canyon: hidden (instances shrunk). */
  private hideProps(): void {
    this.hidden = [];
    const box = new THREE.Box3();
    const p = new THREE.Vector3();
    const m = new THREE.Matrix4();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const [c0, c1] = this.c;
    const arc = this.arc;
    const beyond = (x: number, z: number) => {
      const dx = x - c0;
      const dz = z - c1;
      const d = Math.hypot(dx, dz);
      const rel = (((Math.atan2(dx, dz) / deg - arc[0]) % 360) + 360) % 360;
      if (rel > arc[1] - arc[0]) return false;
      const f = (rel / (arc[1] - arc[0])) * (RIM_N - 1);
      const i = Math.min(RIM_N - 2, Math.floor(f));
      return d > this.rim[i] + (this.rim[i + 1] - this.rim[i]) * (f - i) + 1.5;
    };
    this.scene.updateMatrixWorld(true);
    this.scene.traverse((o) => {
      if (o === this.land || o === this.river || o.name === 'terrain' || o.name.startsWith('cinema')) return;
      if (o.name === 'water') {
        this.water = o;
        return;
      }
      if (!(o as THREE.Mesh).isMesh || !o.visible) return;
      const im = o as THREE.InstancedMesh;
      if (im.isInstancedMesh) {
        for (let i = 0; i < im.count; i++) {
          im.getMatrixAt(i, m);
          p.setFromMatrixPosition(m).applyMatrix4(im.matrixWorld);
          if (beyond(p.x, p.z)) {
            this.moved.push({ mesh: im, i, m: m.clone() });
            im.setMatrixAt(i, zero);
          }
        }
        if (this.moved.some((e) => e.mesh === im)) im.instanceMatrix.needsUpdate = true;
        return;
      }
      box.setFromObject(o);
      if (box.isEmpty() || box.max.y - box.min.y > 400) return;
      const n = [box.min.x, box.max.x].flatMap((x) => [box.min.z, box.max.z].map((z) => (beyond(x, z) ? 1 : 0))).reduce((a: number, b2: number) => a + b2, 0);
      box.getCenter(p);
      if (n === 4 && beyond(p.x, p.z)) {
        o.visible = false;
        this.hidden!.push(o);
      } else if (n > 0 || beyond(p.x, p.z)) {
        for (const m2 of ([] as THREE.Material[]).concat((o as THREE.Mesh).material)) this.cut(m2, false);
      }
    });
  }

  update(ctx: FxContext): void {
    if (!this.hidden) this.hideProps();
    if (this.water) this.water.visible = false;
    this.riverMat.uniforms.uT.value = ctx.t;
  }

  dispose(): void {
    this.land.removeFromParent();
    this.land.geometry.dispose();
    (this.land.material as THREE.Material).dispose();
    this.river.removeFromParent();
    this.river.geometry.dispose();
    this.riverMat.dispose();
    for (const o of this.hidden ?? []) o.visible = true;
    const meshes = new Set<THREE.InstancedMesh>();
    for (const { mesh, i, m } of this.moved) {
      mesh.setMatrixAt(i, m);
      meshes.add(mesh);
    }
    for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
    if (this.water) this.water.visible = true;
    for (const [mat, hook] of this.hooks) {
      mat.onBeforeCompile = hook.onBeforeCompile;
      mat.customProgramCacheKey = hook.key;
      mat.needsUpdate = true;
    }
  }
}

registerEffect('dusk-land', (cue, scene, ground) => new Land(cue, scene, ground));
