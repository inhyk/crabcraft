// Tidecrown's districts as meshes, from the plan in cityLayout.ts: the townhouses on one distance LOD, the market's
// stalls, every kit piece of the landmarks and the street furniture as one multi-draw per material (Scatter culls each
// piece), the terrace parapets, canal walls and bridges in the castle's limestone, the canals' water, the harbour's
// quays, piers, crane and moored boats, and what moves: the ships, a gondola, the waterwheel, the seaglass crystals,
// the forge's smoke and the fountains' water.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type Kit, Scatter, StaticBatch, trs } from '../../world/kit';
import { addPatch, WORLD_UNIFORMS } from '../../world/materials';
import { GLSL_NOISE } from '../../world/noise';
import { CC_SKY, CC_SKY_UNIFORMS, type SkyUniforms } from '../../world/sky';
import { TC_CANAL, TC_CANALS } from '../../sim/world/tidecrownCity';
import type { CityLayout } from './cityLayout';
import {
  cascadeSpot, type DistrictId, TC_FORGE, TC_GRAND_STAIRS, TC_HARBOUR_LEVEL, TC_LANDMARKS, TC_RETAINING, TC_WATERWHEEL,
} from './cityPlan';
import { cityLod, fillDistrict, type TideBatch, type TidecrownKit } from './houses';
import type { TidecrownLod } from './lod';
import { lampHalos } from './groundLight';
import { districtOverrides, type TidecrownMaterials } from './materials';
import { dressMarket } from './marketStalls';
import { buildReturnArch } from './returnArch';
import { worldUV } from './structures';

type Height = (x: number, z: number) => number;

export interface TidecrownCity {
  group: THREE.Group;
  lod: TidecrownLod<TideBatch>;
  /** Build (and free) the houses' near detail around the camera for about `budget` ms; true once all it needs is in. */
  refine(budget: number): boolean;
  /** Free every house's near detail (on leaving the city). */
  release(): void;
  update(time: number, camera?: THREE.Camera): void;
  dispose(): void;
  stats: { houses: Record<DistrictId, number>; houseTriangles: number; farTriangles: number; chunks: number; nearMs: number; ms: Record<string, number> };
}

/** A point in a frame (rotation.y = yaw). */
const local = (x: number, z: number, yaw: number, lx: number, lz: number): [number, number] => {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [x + c * lx + s * lz, z - s * lx + c * lz];
};

/** A box in a frame: centre (lx, y, lz) and size, in world space with world UVs. */
function frameBox(x: number, z: number, yaw: number, lx: number, y: number, lz: number, w: number, h: number, d: number): THREE.BufferGeometry {
  const [wx, wz] = local(x, z, yaw, lx, lz);
  const g = new THREE.BoxGeometry(w, h, d);
  g.applyMatrix4(trs(wx, y, wz, yaw));
  return worldUV(g);
}

/** One mesh per material of a kit piece, in its own frame (for the pieces that move). */
function pieceGroup(kit: Kit, piece: string, over: Record<string, THREE.Material>, name: string, shadow = true): THREE.Group {
  const b = new StaticBatch(kit, name);
  b.add(piece, new THREE.Matrix4(), { override: over, castShadow: shadow });
  const g = b.build();
  g.matrixAutoUpdate = true;
  for (const m of g.children) m.matrixAutoUpdate = true;
  return g;
}

// ------------------------------------------------------------------------------------------------
// Water

/**
 * Canal and basin water: a dark green-blue body (lit, so the houses' shadows fall on it and the sun glints), ripples
 * drifting down the channel (aFlow), the painted sky reflected with a fresnel (the walls and fronts hide the low sky,
 * so only the steep reflections are bright), and foam along the walls (aCross, -1..1 across the channel) and in rings
 * where the cascade lands (uSplash).
 */
function skyWater(sky: SkyUniforms, channel: boolean, splash = new THREE.Vector3()): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ name: channel ? 'tc-canal-water' : 'tc-basin-water', color: '#0d3540', roughness: 0.07, metalness: 0, envMapIntensity: 0, emissive: '#ffffff' });
  addPatch(m, `tc-sky-water-${channel}`, (shader) => {
    Object.assign(shader.uniforms, sky, { uSplash: { value: splash } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vCwW;\n${channel ? 'attribute vec2 aFlow;\nattribute float aCross;\nvarying vec2 vCwFlow;\nvarying float vCwCross;' : ''}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\nvCwW = (modelMatrix * vec4(transformed, 1.0)).xyz;${channel ? '\nvCwFlow = aFlow;\nvCwCross = aCross;' : ''}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vCwW;\n${channel ? 'varying vec2 vCwFlow;\nvarying float vCwCross;' : ''}\nuniform vec3 uSplash;\n${CC_SKY_UNIFORMS}\n${CC_SKY}
float tcRipple(vec2 p, vec2 drift) {
  return cc_vnoise(p * 0.8 - drift) + 0.5 * cc_vnoise(p * 1.9 - drift * 1.7 + 3.1) + 0.25 * cc_vnoise(p * 4.1 + vec2(uTime * 0.45, -uTime * 0.31));
}
vec3 tcN;
float tcFoam;`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          vec2 drift = ${channel ? 'vCwFlow * uTime * 0.55' : 'vec2(uTime * 0.12, -uTime * 0.08)'};
          vec2 p = vCwW.xz;
          float e = 0.06, a = tcRipple(p, drift);
          float gx = (tcRipple(p + vec2(e, 0.0), drift) - a) / e, gz = (tcRipple(p + vec2(0.0, e), drift) - a) / e;
          tcN = normalize(vec3(-gx * 0.16, 1.0, -gz * 0.16));
          float body = cc_vnoise(p * 0.12 + drift * 0.2);
          diffuseColor.rgb = mix(vec3(0.012, 0.06, 0.07), vec3(0.03, 0.12, 0.12), body);
          tcFoam = 0.0;
          ${channel ? `float wall = abs(vCwCross);
          float lap = cc_vnoise(vec2(dot(p, vCwFlow) * 1.6 - uTime * 0.9, wall * 3.0)) * cc_vnoise(p * 3.1 + uTime * 0.3);
          tcFoam = smoothstep(0.9, 0.99, wall) * (0.35 + 0.65 * smoothstep(0.15, 0.45, lap));
          // Rings spreading where the cascade lands.
          float d = length(p - uSplash.xz);
          if (d < 6.0 && uSplash.y > 0.0) {
            float ring = 0.5 + 0.5 * sin(d * 4.2 - uTime * 5.0 + cc_vnoise(p * 2.0) * 3.0);
            tcFoam = max(tcFoam, (1.0 - smoothstep(0.6, 5.5, d)) * (0.45 + 0.55 * ring) * smoothstep(0.2, 0.6, cc_vnoise(p * 3.0 - uTime * 0.7)));
            tcFoam = max(tcFoam, 1.0 - smoothstep(0.4, 1.4, d));
          }
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.9, 0.88), tcFoam);` : ''}
        }`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.8, tcFoam);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(tcN, 0.0)).xyz);')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec3 V = normalize(cameraPosition - vCwW);
          vec3 R = reflect(-V, tcN);
          R.y = abs(R.y);
          float fres = 0.025 + 0.975 * pow(1.0 - max(dot(tcN, V), 0.0), 5.0);
          // The fronts along the water stand in for the low sky: a dim warm stone instead.
          vec3 refl = mix(vec3(0.09, 0.08, 0.075), ccSky(R, 0.0), smoothstep(${channel ? '0.18, 0.62' : '0.02, 0.2'}, R.y));
          totalEmissiveRadiance = refl * fres * 0.9 * (1.0 - tcFoam);
        }`,
      );
  });
  return m;
}

/** Falling water: bright streaks scrolling along the geometry's v (uv.y), foam at its foot. */
function fallingWater(speed = 1.6): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ name: 'tc-falling-water', color: '#d9f6f4', transparent: true, depthWrite: false, side: THREE.DoubleSide });
  addPatch(m, `tc-falling-water-${speed}`, (shader) => {
    shader.uniforms.uTime = WORLD_UNIFORMS.uTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vFwUv;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvFwUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vFwUv;\nuniform float uTime;\n${GLSL_NOISE}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float streak = cc_vnoise(vec2(vFwUv.x * 9.0, vFwUv.y * 2.5 - uTime * ${speed.toFixed(2)}));
          float fine = cc_vnoise(vec2(vFwUv.x * 23.0, vFwUv.y * 6.0 - uTime * ${(speed * 1.7).toFixed(2)}));
          diffuseColor.rgb *= mix(vec3(0.55, 0.82, 0.86), vec3(1.0), smoothstep(0.35, 0.8, streak * 0.7 + fine * 0.3));
          diffuseColor.a = 0.42 + 0.45 * smoothstep(0.3, 0.75, streak) + 0.2 * smoothstep(0.85, 1.0, vFwUv.y);
        }`,
      );
  });
  return m;
}

/**
 * A fountain's thin water: a lit, mostly clear sheet of threads running down (uv `along`, 1 at the lip), brighter
 * where the threads bunch, fading in at the lip and out at the foot so it never shows an edge.
 */
function waterSheet(along: 'x' | 'y', threads: number, speed: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ name: 'tc-water-sheet', color: '#a9dcdc', roughness: 0.12, metalness: 0, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  addPatch(m, `tc-water-sheet-${along}-${threads}-${speed}`, (shader) => {
    shader.uniforms.uTime = WORLD_UNIFORMS.uTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vWsUv;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvWsUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vWsUv;\nuniform float uTime;\n${GLSL_NOISE}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float v = vWsUv.${along}, u = vWsUv.${along === 'x' ? 'y' : 'x'};
          float thread = cc_vnoise(vec2(u * ${threads.toFixed(1)}, v * 2.2 + uTime * ${speed.toFixed(2)}));
          float fine = cc_vnoise(vec2(u * ${(threads * 2.7).toFixed(1)}, v * 5.0 + uTime * ${(speed * 1.6).toFixed(2)}));
          float t = smoothstep(0.45, 0.85, thread * 0.65 + fine * 0.35);
          diffuseColor.rgb *= mix(vec3(0.62, 0.84, 0.86), vec3(1.0), t);
          diffuseColor.a = (0.07 + 0.5 * t) * smoothstep(1.0, 0.9, v) * smoothstep(0.0, 0.25, v);
        }`,
      );
  });
  return m;
}

/** A ribbon of falling water along a path (width across, uv.y from top to foot). */
function waterRibbon(pts: THREE.Vector3[], width: number, side: THREE.Vector3): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  pts.forEach((p, i) => {
    const v = i / (pts.length - 1);
    for (const k of [-1, 1]) {
      pos.push(p.x + side.x * k * width / 2, p.y + side.y * k * width / 2, p.z + side.z * k * width / 2);
      uv.push(k < 0 ? 0 : 1, v);
    }
    if (i) idx.push((i - 1) * 2, (i - 1) * 2 + 1, i * 2, (i - 1) * 2 + 1, i * 2 + 1, i * 2);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** White water where falling water lands: churning foam on discs (uv 0.5 at the centre), all splashes in one draw. */
function foamSplash(discs: { at: THREE.Vector3; r: number; sx?: number }[], color = '#f2fbf8', strength = 0.95): THREE.Mesh {
  const g = mergeGeometries(discs.map(({ at, r, sx = 1 }) => new THREE.CircleGeometry(r, 20).rotateX(-Math.PI / 2).scale(sx, 1, 1).translate(at.x, at.y, at.z)));
  const m = new THREE.MeshBasicMaterial({ name: 'tc-foam', color, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  addPatch(m, `tc-foam-${strength}`, (shader) => {
    shader.uniforms.uTime = WORLD_UNIFORMS.uTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vFoUv;\nvarying vec2 vFoW;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvFoUv = uv;\nvFoW = position.xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vFoUv;\nvarying vec2 vFoW;\nuniform float uTime;\n${GLSL_NOISE}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float r = length(vFoUv - 0.5) * 2.0;
          float churn = cc_vnoise(vFoW * 2.6 + vec2(uTime * 1.3, -uTime * 0.9)) * 0.6 + cc_vnoise(vFoW * 6.0 - uTime * 2.1) * 0.4;
          float ring = 0.5 + 0.5 * sin(r * 9.0 - uTime * 6.0 + churn * 4.0);
          diffuseColor.a = (1.0 - smoothstep(0.35, 1.0, r)) * smoothstep(0.3, 0.6, churn * 0.7 + ring * 0.3 + (1.0 - r) * 0.35) * ${strength.toFixed(2)};
        }`,
      );
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'tc-foam';
  mesh.renderOrder = 2;
  return mesh;
}

/** A claw along `pts`: a tube tapering from `r0` to `r1`, closed at the tip. */
function clawGeometry(pts: THREE.Vector3[], r0: number, r1: number, radial = 7): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(pts), n = 18, frames = curve.computeFrenetFrames(n, false);
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const p = curve.getPointAt(i / n), r = r0 + (r1 - r0) * Math.pow(i / n, 0.8);
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2, N = frames.normals[i], B = frames.binormals[i];
      pos.push(p.x + r * (Math.cos(a) * N.x + Math.sin(a) * B.x), p.y + r * (Math.cos(a) * N.y + Math.sin(a) * B.y), p.z + r * (Math.cos(a) * N.z + Math.sin(a) * B.z));
      if (i < n) {
        const a0 = i * radial + j, a1 = i * radial + ((j + 1) % radial);
        idx.push(a0, a1, a0 + radial, a1, a1 + radial, a0 + radial);
      }
    }
  }
  const tip = curve.getPointAt(1).addScaledVector(curve.getTangentAt(1), r1 * 2.5), t = pos.length / 3;
  pos.push(tip.x, tip.y, tip.z);
  for (let j = 0; j < radial; j++) idx.push(n * radial + j, n * radial + ((j + 1) % radial), t);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------------------------------------
// Smoke and glows

/** Chimney smoke: soft puffs rising and spreading downwind, all chimneys in one draw. */
function smoke(sources: THREE.Vector3[]): THREE.Points {
  const per = 26, n = sources.length * per;
  const base = new Float32Array(n * 3), seed = new Float32Array(n);
  sources.forEach((s, i) => {
    for (let k = 0; k < per; k++) {
      base.set([s.x, s.y, s.z], (i * per + k) * 3);
      seed[i * per + k] = (k + 0.5) / per + i * 0.137;
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(base, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    name: 'tc-smoke',
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: WORLD_UNIFORMS.uTime, uScale: { value: 900 } },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime, uScale;
      varying float vAge, vSeed;
      #include <fog_pars_vertex>
      void main() {
        float age = fract(uTime * 0.07 + aSeed);
        vAge = age; vSeed = aSeed;
        vec3 p = position + vec3(-0.6, 0.0, 0.35) * age * age * 14.0 + vec3(sin(aSeed * 40.0 + uTime * 0.5), 0.0, cos(aSeed * 31.0)) * age * 2.5;
        p.y += age * 17.0;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uScale * (0.9 + age * 4.2) / -mvPosition.z;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      varying float vAge, vSeed;
      #include <fog_pars_fragment>
      void main() {
        vec2 q = gl_PointCoord * 2.0 - 1.0;
        float r = dot(q, q);
        if (r > 1.0) discard;
        float soft = (1.0 - r) * (1.0 - r);
        float a = soft * smoothstep(0.0, 0.08, vAge) * (1.0 - vAge) * 0.42;
        vec3 c = mix(vec3(0.62, 0.58, 0.56), vec3(0.93, 0.9, 0.88), vAge);
        gl_FragColor = vec4(c, a);
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  const p = new THREE.Points(g, mat);
  p.name = 'tc-smoke';
  p.frustumCulled = false;
  p.renderOrder = 2;
  return p;
}

/** The forge's fire behind its glass: embers that churn and flicker, orange to white-hot. */
function forgeFire(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ name: 'tc-forge-fire', color: '#2a120a', emissive: '#ffffff', emissiveIntensity: 1, roughness: 0.6, vertexColors: true });
  addPatch(m, 'tc-forge-fire', (shader) => {
    shader.uniforms.uTime = WORLD_UNIFORMS.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFfW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvFfW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vFfW;\nuniform float uTime;\n${GLSL_NOISE}`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float n = cc_vnoise(vec2(vFfW.x * 1.7 + vFfW.z, vFfW.y * 2.2 - uTime * 1.6)) * 0.65 + cc_vnoise(vec2(vFfW.x * 4.0, vFfW.y * 5.0 - uTime * 3.1)) * 0.35;
          float flick = 0.85 + 0.15 * sin(uTime * 9.0 + vFfW.x) * sin(uTime * 5.3);
          totalEmissiveRadiance = mix(vec3(0.9, 0.22, 0.04), vec3(1.0, 0.75, 0.35), smoothstep(0.35, 0.85, n)) * (1.4 + 1.8 * n) * flick;
        }`,
      );
  });
  return m;
}

/** A soft additive glow that reads as light from far away. */
function glow(color: string, at: THREE.Vector3, size: number, name: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  const col = new THREE.Color(color);
  const rgba = (a: number) => `rgba(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)},${a})`;
  grad.addColorStop(0, rgba(0.9));
  grad.addColorStop(0.25, rgba(0.4));
  grad.addColorStop(1, rgba(0));
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.tidecrown = true;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.position.copy(at);
  s.scale.setScalar(size);
  s.name = name;
  s.renderOrder = 3;
  return s;
}

// ------------------------------------------------------------------------------------------------
// The build

export interface CityKits {
  tide: TidecrownKit;
  city: Kit;
  harbour: Kit;
}

/** Near detail reach by graphics quality: the switch distance and own shadows (low: less of the city in detail). */
const NEAR = { high: { near: 90, shadow: 45 }, low: { near: 60, shadow: 30, hysteresis: 10, cap: 80 } } as const;

export function buildTidecrownCity(kits: CityKits, mats: TidecrownMaterials, sky: SkyUniforms, plan: CityLayout, height: Height, renderer: THREE.WebGLRenderer, quality: 'low' | 'high' = 'high'): TidecrownCity {
  const ms: Record<string, number> = {};
  let t0 = performance.now();
  const lap = (k: string) => { ms[k] = Math.round(performance.now() - t0); t0 = performance.now(); };
  const group = new THREE.Group();
  group.name = 'tidecrown-city';
  const cityOver = districtOverrides(mats, false), harbourOver = districtOverrides(mats, true);
  const forCity = (m: THREE.Material) => cityOver[m.name] ?? m;
  const forHarbour = (m: THREE.Material) => harbourOver[m.name] ?? m;

  // Townhouses: every zone on one LOD, the far builds now, near detail streamed around the camera (refine).
  const lod = cityLod(kits.tide, renderer, NEAR[quality]);
  plan.zones.forEach((z, i) => fillDistrict({ kit: kits.tide, ...z.options, lod, name: `tidecrown-${z.zone.district}-${i}` }, z.plan));
  lod.buildFar();
  lod.name = 'tidecrown-houses';
  group.add(lod);
  let nearMs = 0;
  lap('houses');

  // The arcade's floor stands two steps (0.24) over the landmark's footing.
  const halls = TC_LANDMARKS.filter((l) => l.piece === 'TC_MarketArcade').map((l) => ({ x: l.x, z: l.z, y: height(l.x, l.z) - 0.12 + 0.24, yaw: l.yaw }));
  const market = dressMarket({ kit: kits.tide, ...plan.market.options, name: 'tidecrown-market', halls }, plan.market.plan);
  group.add(market.group);
  const marketBox = new THREE.Box3().setFromObject(market.group);
  lap('market');

  // City kit pieces: landmarks, terrace walls, stairs, lamps, banner poles and wall banners.
  const pieces = new Scatter(kits.city, 'tidecrown-city-pieces');
  // The forge on its own: its glass is the fire's glow (the hearth and the lit windows).
  const forge = new Scatter(kits.city, 'tidecrown-forge');
  for (const l of TC_LANDMARKS) (l.piece === 'TC_Forge' ? forge : pieces).add(l.piece, trs(l.x, height(l.x, l.z) - 0.12, l.z, l.yaw, l.scale));
  const fire = forgeFire();
  group.add(forge.build({ materialFor: (m) => (m.name === 'TC_Glass' ? fire : forCity(m)) }));
  for (const w of plan.walls.runs) pieces.add('TC_RetainingWall_12', trs(w.x, w.y, w.z, w.yaw, new THREE.Vector3(w.sx, w.sy, 1)));
  for (const s of TC_GRAND_STAIRS) pieces.add('TC_Stair_8', trs(s.x, s.y - 0.05, s.z, s.yaw, new THREE.Vector3(s.sx, s.sy, s.sz)));
  group.add(pieces.build({ materialFor: forCity }));
  // Street furniture in three sectors, each shown only when the camera comes within 160 of it: lamps, banner poles,
  // and wall banners on every other terrace wall facing the lower town.
  const furniture = [-1e9, 0, 120, 1e9].slice(0, 3).map((x0, i, a) => ({ x0, x1: a[i + 1] ?? 1e9, s: new Scatter(kits.city, `tidecrown-furniture-${i}`), box: new THREE.Box3() }));
  const furnish = (piece: string, x: number, y: number, z: number, yaw: number) => {
    const f = furniture.find((f) => x < f.x1)!;
    f.s.add(piece, trs(x, y, z, yaw));
    f.box.expandByPoint(new THREE.Vector3(x, y, z));
  };
  for (const l of plan.lamps) furnish('TC_Lamp', l.x, height(l.x, l.z) - 0.05, l.z, l.yaw);
  for (const p of plan.poles) furnish('TC_BannerPole', p.x, height(p.x, p.z) - 0.05, p.z, p.yaw);
  plan.walls.runs.forEach((w, i) => {
    if (i % 2 || w.sx < 0.7) return;
    const [x, z] = local(w.x, w.z, w.yaw, 0, TC_RETAINING.face + 0.04);
    furnish('TC_BannerWall', x, w.top - 5.55, z, w.yaw);
  });
  const culled: { o: THREE.Object3D; box: THREE.Box3; max: number }[] = [];
  // Benches, anvils and stock, in one props scatter with its own reach.
  const propsScatter = new Scatter(kits.tide.props, 'tidecrown-dressing'), propsBox = new THREE.Box3();
  for (const p of plan.dressing.props) {
    const y = height(p.x, p.z) - 0.02;
    propsScatter.add(p.piece, trs(p.x, y, p.z, p.yaw, p.s));
    propsBox.expandByPoint(new THREE.Vector3(p.x, y, p.z));
  }
  if (propsScatter.count) {
    const g = propsScatter.build({ materialFor: (m) => kits.tide.over.props[m.name] ?? m });
    group.add(g);
    culled.push({ o: g, box: propsBox.expandByScalar(4), max: 140 });
  }
  // The street lamps burn warm (the kit's lantern panes are the stained glass otherwise), each with a halo.
  const lampGlass = new THREE.MeshStandardMaterial({ name: 'tc-lamp-glass', color: '#3a2c1c', emissive: '#ffc070', emissiveIntensity: 3.4, roughness: 0.3, vertexColors: true });
  const lampFor = (m: THREE.Material) => (m.name === 'TC_Glass' ? lampGlass : forCity(m));
  // The arch at the return line, with its own pair of lamps.
  const arch = buildReturnArch(kits.city, mats, lampFor, height);
  group.add(arch.group, lampHalos([...plan.lamps.map((l) => new THREE.Vector3(l.x, height(l.x, l.z) - 0.05 + 4.45, l.z)), ...arch.lampHeads]));
  for (const f of furniture) {
    if (!f.s.count) continue;
    const g = f.s.build({ materialFor: lampFor });
    group.add(g);
    culled.push({ o: g, box: f.box.expandByScalar(6), max: 160 });
  }
  lap('pieces');

  // Limestone the kit does not carry: parapets and copings on the terrace walls, their end piers, the canal walls and
  // bridges, the forge's water channel.
  const L = mats.TC_Limestone, D = mats.TC_LimestoneDark, G = mats.TC_Gold;
  const stone = [new StaticBatch(kits.city, 'tidecrown-stone-west'), new StaticBatch(kits.city, 'tidecrown-stone-centre'), new StaticBatch(kits.city, 'tidecrown-stone-east')];
  const sector = (x: number) => stone[x < 0 ? 0 : x < 120 ? 1 : 2];
  for (const w of plan.walls.runs) {
    const len = TC_RETAINING.len * w.sx, b = sector(w.x);
    b.addGeometry(frameBox(w.x, w.z, w.yaw, 0, w.top + 0.5, 0.5, len, 1.0, 0.6), L, null);
    b.addGeometry(frameBox(w.x, w.z, w.yaw, 0, w.top + 1.08, 0.5, len + 0.12, 0.16, 0.84), D, null);
    b.addGeometry(frameBox(w.x, w.z, w.yaw, 0, w.top - 0.15, -2.05, len + 0.06, 0.3, 1.92), L, null);
  }
  for (const p of plan.walls.piers) {
    const b = sector(p.x), h = p.top + 0.2 - p.y;
    b.addGeometry(frameBox(p.x, p.z, 0, 0, p.y + h / 2, 0, 2.3, h, 2.3), D, null);
    b.addGeometry(frameBox(p.x, p.z, 0, 0, p.top + 0.35, 0, 2.75, 0.3, 2.75), L, null);
    const ball = new THREE.SphereGeometry(0.55, 12, 8);
    ball.translate(p.x, p.top + 1.05, p.z);
    b.addGeometry(worldUV(ball), G, null);
  }
  // Planters: dressed stone boxes with a coping, their plants grow with the foliage.
  for (const p of plan.dressing.planters) {
    const b = sector(p.x), y = height(p.x, p.z);
    b.addGeometry(frameBox(p.x, p.z, p.yaw, 0, y + 0.3, 0, p.hx * 2, 0.9, p.hz * 2), D, null);
    b.addGeometry(frameBox(p.x, p.z, p.yaw, 0, y + 0.82, 0, p.hx * 2 + 0.3, 0.16, p.hz * 2 + 0.3), L, null);
  }
  // Canal walls: 2 thick from the bed, their tops flagged flush with the quay, a raised kerb along the water's edge
  // overhanging it a little, a dark wet band at the waterline, mooring rings every few metres.
  const bed = TC_CANAL.bed - 0.4;
  const darken = (g: THREE.BufferGeometry, k: number) => {
    const c = g.getAttribute('color');
    for (let i = 0; i < c.count; i++) c.setXYZ(i, k, k * 1.02, k * 1.04);
    return g;
  };
  for (const w of plan.canalWalls) {
    const dx = w.bx - w.ax, dz = w.bz - w.az, len = Math.hypot(dx, dz), yaw = Math.atan2(-dz, dx);
    const mx = (w.ax + w.bx) / 2, mz = (w.az + w.bz) / 2, b = sector(mx);
    // Local +Z toward the water (n). The flags sit just over the quay's own ground along the wall's back (the plan's
    // walk over the wall top is at the same height).
    const lz = Math.sign(Math.sin(yaw) * w.nx + Math.cos(yaw) * w.nz) || 1;
    const flush = w.top;
    b.addGeometry(frameBox(mx, mz, yaw, 0, (flush + bed) / 2, -lz * 1.0, len + 0.04, flush - bed, 2.0), D, null);
    b.addGeometry(frameBox(mx, mz, yaw, 0, flush + 0.09, -lz * 0.3, len + 0.04, 0.22, 0.84), L, null);
    b.addGeometry(darken(frameBox(mx, mz, yaw, 0, TC_CANAL.water + 0.12, lz * 0.02, len + 0.02, 0.5, 0.06), 0.5), D, null);
    for (let u = -len / 2 + 2.5; u < len / 2 - 1; u += 6.5) {
      const [rx, rz] = local(mx, mz, yaw, u, lz * 0.06);
      const ring = new THREE.TorusGeometry(0.22, 0.045, 5, 10).rotateY(yaw);
      ring.translate(rx, TC_CANAL.water + 1.1, rz);
      b.addGeometry(worldUV(ring), mats.TC_Iron, null, false);
    }
  }
  // Bridges: a stone arch over the water, ramps onto the quays, parapets along both sides.
  for (const br of plan.bridges) {
    const b = sector(br.x), y0 = TC_CANAL.street, topY = y0 + br.crown, ramp = br.ramp, half = br.span / 2;
    const shape = new THREE.Shape();
    shape.moveTo(-br.hl, y0 - 0.02);
    shape.lineTo(-br.hl + ramp, topY);
    shape.lineTo(br.hl - ramp, topY);
    shape.lineTo(br.hl, y0 - 0.02);
    shape.lineTo(br.hl, y0 - 0.3);
    shape.lineTo(half + 0.2, y0 - 0.3);
    shape.lineTo(half, TC_CANAL.water + 0.35);
    for (let i = 1; i < 12; i++) {
      const a = (i / 12) * Math.PI;
      shape.lineTo(Math.cos(a) * half, TC_CANAL.water + 0.35 + Math.sin(a) * (topY - 0.5 - TC_CANAL.water - 0.35));
    }
    shape.lineTo(-half, TC_CANAL.water + 0.35);
    shape.lineTo(-half - 0.2, y0 - 0.3);
    shape.lineTo(-br.hl, y0 - 0.3);
    const deck = new THREE.ExtrudeGeometry(shape, { depth: br.hw * 2, bevelEnabled: false, curveSegments: 1 });
    // Shape x runs across the canal (local +Z), the extrusion along local x.
    deck.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.PI / 2)).translate(br.hw, 0, 0);
    deck.applyMatrix4(trs(br.x, 0, br.z, br.yaw));
    b.addGeometry(worldUV(deck), L, null);
    for (const k of [-1, 1]) {
      const par = new THREE.Shape();
      par.moveTo(-br.hl, y0 - 0.1);
      par.lineTo(-br.hl, y0 + 0.85);
      par.lineTo(-br.hl + ramp, topY + 0.85);
      par.lineTo(br.hl - ramp, topY + 0.85);
      par.lineTo(br.hl, y0 + 0.85);
      par.lineTo(br.hl, y0 - 0.1);
      par.lineTo(br.hl - ramp, topY - 0.1);
      par.lineTo(-br.hl + ramp, topY - 0.1);
      const g = new THREE.ExtrudeGeometry(par, { depth: 0.38, bevelEnabled: false, curveSegments: 1 });
      g.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.PI / 2)).translate(k > 0 ? br.hw : -br.hw + 0.38, 0, 0);
      g.applyMatrix4(trs(br.x, 0, br.z, br.yaw));
      b.addGeometry(worldUV(g), D, null);
    }
    // Newels with gold caps at the four corners.
    for (const kx of [-1, 1]) for (const kz of [-1, 1]) {
      const lx = kx * (br.hw - 0.19), lz = kz * (br.hl - 0.25);
      b.addGeometry(frameBox(br.x, br.z, br.yaw, lx, y0 + 0.6, lz, 0.62, 1.4, 0.62), L, null);
      const [x, z] = local(br.x, br.z, br.yaw, lx, lz);
      const cap = new THREE.SphereGeometry(0.24, 10, 6);
      cap.translate(x, y0 + 1.5, z);
      b.addGeometry(worldUV(cap), G, null);
    }
  }
  // The forge's race is fed from the terrace: a spout in the wall pours into a basin and a stone channel runs to the
  // wheel.
  const fy = height(TC_FORGE.x, TC_FORGE.z) - 0.12, race = TC_WATERWHEEL.race;
  const rx = (race.x[0] + race.x[1]) / 2, raceZ0 = race.z[0];
  const [chx, chz0] = local(TC_FORGE.x, TC_FORGE.z, TC_FORGE.yaw, rx, raceZ0);
  const wallZ = 7.2, chLen = chz0 - wallZ;
  const ch = sector(chx);
  ch.addGeometry(frameBox(chx, wallZ + chLen / 2, 0, 0, fy + 0.15, 0, 2.6, 0.3, chLen), D, null);
  for (const k of [-1, 1]) ch.addGeometry(frameBox(chx, wallZ + chLen / 2, 0, k * 1.45, fy + 0.55, 0, 0.35, 1.1, chLen), L, null);
  ch.addGeometry(frameBox(chx, wallZ + 1.3, 0, 0, fy + 0.4, 0, 4.2, 0.8, 2.6), D, null);
  const spoutY = fy + 6.4;
  const pipe = new THREE.CylinderGeometry(0.32, 0.38, 1.4, 12).rotateX(Math.PI / 2);
  pipe.translate(chx, spoutY, wallZ - 0.2);
  ch.addGeometry(worldUV(pipe), G, null);
  // The branch canal's cascade: a gold spout on a corbel in the terrace wall above the canal's head.
  const cas = cascadeSpot(), cy = cas.y, cb = sector(cas.x);
  const casYaw = Math.atan2(cas.nx, cas.nz);
  cb.addGeometry(frameBox(cas.x, cas.z, casYaw, 0, cy - 0.7, 0.35, 1.6, 1.1, 0.9), L, null);
  const [spx, spz] = local(cas.x, cas.z, casYaw, 0, 0.6);
  const spout = new THREE.CylinderGeometry(0.42, 0.5, 1.5, 12).rotateX(Math.PI / 2).applyMatrix4(trs(spx, cy, spz, casYaw));
  cb.addGeometry(worldUV(spout), G, null);
  for (const b of stone) group.add(b.build());
  lap('stone');

  // Water: the canals, the forge's channel and race, the fountains' basins. The Grand Canal runs east to the harbour,
  // the branch south from the cascade.
  const splash = new THREE.Vector3(cas.x + cas.nx * 2.9, 1, cas.z + cas.nz * 2.9);
  const water = skyWater(sky, true, splash), basinWater = skyWater(sky, false);
  water.side = basinWater.side = THREE.DoubleSide;
  const wpos: number[] = [], wflow: number[] = [], wcross: number[] = [], widx: number[] = [];
  const quadAt = (pts: [number, number][], y: number, fx: number, fz: number) => {
    const i0 = wpos.length / 3;
    for (const [x, z] of pts) wpos.push(x, y, z), wflow.push(fx, fz);
    wcross.push(1, 1, -1, -1);
    widx.push(i0, i0 + 2, i0 + 1, i0, i0 + 3, i0 + 2);
  };
  TC_CANALS.forEach((c, ci) => {
    const flow = ci === 1 ? -1 : 1;
    for (let i = 0; i < c.points.length - 1; i++) {
      const [ax, az] = c.points[i], [bx, bz] = c.points[i + 1], len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len, h = c.width / 2 + 0.15;
      const e0 = i === 0 ? 0.1 : c.width / 2, e1 = i === c.points.length - 2 ? 0.1 : c.width / 2;
      quadAt([[ax - ux * e0 - uz * h, az - uz * e0 + ux * h], [bx + ux * e1 - uz * h, bz + uz * e1 + ux * h], [bx + ux * e1 + uz * h, bz + uz * e1 - ux * h], [ax - ux * e0 + uz * h, az - uz * e0 - ux * h]], TC_CANAL.water, ux * flow, uz * flow);
    }
  });
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
  wg.setAttribute('aFlow', new THREE.Float32BufferAttribute(wflow, 2));
  wg.setAttribute('aCross', new THREE.Float32BufferAttribute(wcross, 1));
  wg.setIndex(widx);
  wg.computeVertexNormals();
  // Faces up whichever way the quads wound.
  const nrm = wg.getAttribute('normal');
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
  const canalWater = new THREE.Mesh(wg, water);
  canalWater.name = 'tc-canal-water';
  canalWater.receiveShadow = true;
  group.add(canalWater);

  const falls = fallingWater(1.4);
  // The spout's fall into the basin.
  const fall: THREE.Vector3[] = [];
  for (let i = 0; i <= 10; i++) { const f = i / 10; fall.push(new THREE.Vector3(chx, spoutY - (spoutY - fy - 0.7) * f * f, wallZ + 0.5 + 0.9 * f)); }
  // Channel and race: running water along the channel to the wheel.
  const run: THREE.Vector3[] = [];
  const [rx1, rz1] = local(TC_FORGE.x, TC_FORGE.z, TC_FORGE.yaw, rx, race.z[1]);
  for (let i = 0; i <= 8; i++) { const f = i / 8; run.push(new THREE.Vector3(chx + (rx1 - chx) * f, fy + race.water + 0.02, wallZ + 1.4 + (rz1 - wallZ - 1.4) * f)); }
  // The cascade's fall into the canal.
  const cfall: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) { const f = i / 12; cfall.push(new THREE.Vector3(cas.x + cas.nx * (1.3 + 1.6 * f), cy - (cy - TC_CANAL.water) * f * f, cas.z + cas.nz * (1.3 + 1.6 * f))); }
  const cascade = new THREE.Mesh(waterRibbon(cfall, 0.9, new THREE.Vector3(-cas.nz, 0, cas.nx)), falls);
  cascade.name = 'tc-canal-cascade';
  group.add(cascade);
  const flowMesh = new THREE.Mesh(waterRibbon(fall, 0.55, new THREE.Vector3(1, 0, 0)), falls);
  flowMesh.name = 'tc-forge-fall';
  // The race is a channel like the canals: their water, flowing to the wheel.
  const raceGeo = waterRibbon(run, 2.3, new THREE.Vector3(1, 0, 0)), rl = Math.hypot(rx1 - chx, rz1 - wallZ - 1.4);
  const ruv = raceGeo.getAttribute('uv');
  raceGeo.setAttribute('aFlow', new THREE.Float32BufferAttribute(Array.from({ length: ruv.count }, () => [(rx1 - chx) / rl, (rz1 - wallZ - 1.4) / rl]).flat(), 2));
  raceGeo.setAttribute('aCross', new THREE.Float32BufferAttribute(Array.from({ length: ruv.count }, (_, i) => ruv.getX(i) * 2 - 1), 1));
  raceGeo.computeVertexNormals();
  const raceMesh = new THREE.Mesh(raceGeo, water);
  raceMesh.receiveShadow = true;
  raceMesh.name = 'tc-forge-race';
  group.add(flowMesh, raceMesh);
  // White water where the cascade meets the canal, the spout's fall the basin, and the wheel's paddles the race.
  const [wfx, wfz] = local(TC_FORGE.x, TC_FORGE.z, TC_FORGE.yaw, 14.85, -1);
  group.add(foamSplash([
    { at: new THREE.Vector3(splash.x, TC_CANAL.water + 0.05, splash.z), r: 1.9 },
    { at: new THREE.Vector3(chx, fy + 0.84, wallZ + 1.4), r: 1.0 },
    { at: new THREE.Vector3(wfx, fy + race.water + 0.06, wfz), r: 1.15, sx: 0.95 },
  ]));

  // Fountains: two basins of still water, the eight jets and the thin spill from the upper bowl, foam where they land.
  const jets: THREE.BufferGeometry[] = [], spills: THREE.BufferGeometry[] = [], landing: { at: THREE.Vector3; r: number }[] = [];
  for (const f of TC_LANDMARKS.filter((l) => l.piece === 'TC_Fountain')) {
    const y = height(f.x, f.z) - 0.12, s = f.scale;
    const basin = (r: number, sides: number, yy: number, rot: number) => {
      const g = new THREE.CircleGeometry(r * s, sides, rot).rotateX(-Math.PI / 2);
      g.applyMatrix4(trs(f.x, y + yy * s, f.z, f.yaw));
      return g;
    };
    const b0 = new THREE.Mesh(basin(6.45, 8, 0.85, Math.PI / 8), basinWater), b1 = new THREE.Mesh(basin(2.8, 16, 2.55, 0), basinWater);
    b0.name = b1.name = 'tc-fountain-water';
    group.add(b0, b1);
    const spouts: [number, number, number, number, number, number][] = [[0.746, 1.802], [1.802, 0.746], [1.802, -0.746], [0.746, -1.802], [-0.746, -1.802], [-1.802, -0.746], [-1.802, 0.746], [-0.746, 1.802]].map(([x, z]) => {
      const l = Math.hypot(x, z);
      return [x, 1.55, z, (x / l) * 0.93, 0.33, (z / l) * 0.93];
    });
    for (const [x, yy, z, dx, dy, dz] of spouts) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12, d = 3.4 * t;
        pts.push(new THREE.Vector3(x + dx * d, yy + dy * d * 1.2 + 1.1 * t - 1.9 * t * t, z + dz * d));
      }
      const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.07, 5, false);
      g.scale(s, s, s).applyMatrix4(trs(f.x, y, f.z, f.yaw));
      jets.push(g);
      const end = pts[pts.length - 1].clone().multiplyScalar(s).applyMatrix4(trs(f.x, y, f.z, f.yaw));
      landing.push({ at: end.setY(y + 0.87 * s), r: 0.32 * s });
    }
    // The spill: a sheet falling from the upper bowl's lip, flaring a little as it drops, into a ring of foam.
    const spill = new THREE.CylinderGeometry(3.12, 3.4, 1.75, 40, 1, true);
    spill.translate(0, 2.66 - 0.875, 0).scale(s, s, s).applyMatrix4(trs(f.x, y, f.z, f.yaw));
    spills.push(spill);
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      landing.push({ at: new THREE.Vector3(f.x + Math.cos(a) * 3.45 * s, y + 0.87 * s, f.z + Math.sin(a) * 3.45 * s), r: 0.5 * s });
    }
  }
  if (jets.length) {
    const jet = new THREE.Mesh(mergeGeometries(jets), waterSheet('x', 3, 2.4));
    const sheet = new THREE.Mesh(mergeGeometries(spills), waterSheet('y', 90, 1.4));
    jet.name = sheet.name = 'tc-fountain-jet';
    jet.renderOrder = sheet.renderOrder = 2;
    group.add(jet, sheet, foamSplash(landing, '#c4dcda', 0.5));
  }
  lap('water');

  // Harbour kit: quays, piers, the crane, cargo and the moored gondolas.
  const hp = new Scatter(kits.harbour, 'tidecrown-harbour-pieces');
  for (const p of plan.harbour.pieces) if (p.piece) hp.add(p.piece, trs(p.x, p.y, p.z, p.yaw));
  hp.add('TC_Crane', trs(plan.harbour.crane.x, TC_HARBOUR_LEVEL.pier, plan.harbour.crane.z, plan.harbour.crane.yaw));
  for (const c of plan.harbour.cargo) hp.add('TC_CargoSet', trs(c.x, c.y, c.z, c.yaw));
  for (const g of plan.gondolas.moored) hp.add('TC_Gondola', trs(g.x, TC_CANAL.water, g.z, g.yaw));
  const harbourPieces = hp.build({ materialFor: forHarbour });
  // Plank ramps from the quay down to the piers: a pitched deck on stringers, piles into the water, rails.
  const wood = new StaticBatch(kits.harbour, 'tidecrown-harbour-ramps');
  for (const p of plan.harbour.pieces) {
    if (!p.ramp) continue;
    const { len, w, drop } = p.ramp, pitch = Math.atan2(drop, len), frame = trs(p.x, p.y, p.z, p.yaw, 1, pitch);
    const part = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => wood.addGeometry(worldUV(g.translate(x, y, z).applyMatrix4(frame), 0.49), m, null);
    part(new THREE.BoxGeometry(w, 0.28, len + 0.6), mats.TC_DeckWood, 0, -0.14, 0);
    for (const k of [-1, 1]) {
      part(new THREE.BoxGeometry(0.32, 0.6, len + 0.6), mats.TC_WoodDark, k * (w / 2 - 0.2), -0.55, 0);
      part(new THREE.BoxGeometry(0.16, 0.16, len + 0.4), mats.TC_WoodDark, k * (w / 2 - 0.15), 0.95, 0);
      for (const z of [-len / 2 + 0.6, 0, len / 2 - 0.6]) {
        // Upright in the world: undo the pitch for the posts.
        const [px, pz] = local(p.x, p.z, p.yaw, k * (w / 2 - 0.15), z * Math.cos(pitch));
        const top = p.y - z * Math.sin(pitch) + 1.05, post = new THREE.CylinderGeometry(0.17, 0.2, top + 4, 8);
        wood.addGeometry(worldUV(post.translate(px, (top - 4) / 2, pz), 0.49), mats.TC_WoodDark, null);
      }
    }
  }
  group.add(harbourPieces, wood.build());
  // Ships ride on the swell; a gangplank from each to its pier.
  const ships: { g: THREE.Group; y: number; bob: number; ph: number; yaw: number }[] = [];
  plan.harbour.ships.forEach((s, i) => {
    const g = pieceGroup(kits.harbour, s.piece, harbourOver, `tidecrown-${s.piece}`);
    g.position.set(s.x, 0, s.z);
    g.rotation.y = s.yaw;
    // Gangplank in the ship's frame: from the deck anchor down to the pier beside it.
    const [ax, ay, az] = s.plank, side = Math.sign(ax), reach = 3.2;
    const from = new THREE.Vector3(ax, ay, az), to = new THREE.Vector3(ax + side * reach, TC_HARBOUR_LEVEL.pier + 0.05, az);
    const len = from.distanceTo(to), mid = from.clone().add(to).multiplyScalar(0.5);
    const plank = new THREE.BoxGeometry(len, 0.12, 1.3);
    plank.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.atan2(to.y - from.y, to.x - from.x))).translate(mid.x, mid.y, mid.z);
    const pm = new THREE.Mesh(worldUV(plank, 0.45), mats.TC_DeckWood);
    pm.castShadow = true;
    g.add(pm);
    group.add(g);
    ships.push({ g, y: 0, bob: s.bob, ph: i * 2.1, yaw: s.yaw });
  });
  // A gondola gliding the Grand Canal to and fro under its bridges.
  const route = plan.gondolas.route;
  const gondola = pieceGroup(kits.harbour, 'TC_Gondola', harbourOver, 'tidecrown-gondola-moving');
  group.add(gondola);
  const seg: number[] = [0];
  for (let i = 1; i < route.length; i++) seg.push(seg[i - 1] + Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]));
  const routeLen = seg[seg.length - 1];
  lap('harbour');

  // What turns: the waterwheel on the forge, the crystal over each seaglass tower; the forge's smoke and glow.
  const wheel = pieceGroup(kits.city, 'TC_Waterwheel', cityOver, 'tidecrown-waterwheel');
  const [wx, wz] = local(TC_FORGE.x, TC_FORGE.z, TC_FORGE.yaw, 14.85, -1);
  wheel.position.set(wx, fy + TC_WATERWHEEL.y, wz);
  wheel.rotation.order = 'YXZ';
  wheel.rotation.y = TC_FORGE.yaw;
  group.add(wheel);
  const crystals: { g: THREE.Group; y: number; ph: number }[] = [];
  const claws = new StaticBatch(kits.city, 'tidecrown-crystal-claws');
  for (const t of TC_LANDMARKS.filter((l) => l.piece === 'TC_SeaglassTower')) {
    const g = pieceGroup(kits.city, 'TC_SeaglassCrystal', cityOver, `tidecrown-crystal-${t.id}`, false);
    // Nearly three times the kit's size, its point on the finial's tip (66.4) and its waist in four gold claws that
    // rise from the cap, so it reads as held there and turning.
    const y0 = height(t.x, t.z) - 0.12, y = y0 + 72.2 * t.scale;
    g.position.set(t.x, y, t.z);
    g.scale.setScalar(t.scale * 2.8);
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2, c = Math.cos(a), sn = Math.sin(a);
      const prof: [number, number][] = [[0.95, 61.9], [2.0, 64.0], [3.05, 67.2], [3.35, 70.4], [2.95, 73.0], [2.2, 74.6]];
      claws.addGeometry(worldUV(clawGeometry(prof.map(([r, h]) => new THREE.Vector3(t.x + c * r * t.scale, y0 + h * t.scale, t.z + sn * r * t.scale)), 0.34 * t.scale, 0.07 * t.scale)), mats.TC_Gold, null, false);
    }
    group.add(g, glow('#c08cff', new THREE.Vector3(t.x, y, t.z), 34 * t.scale, 'tc-crystal-glow'), glow('#4fd8e0', new THREE.Vector3(t.x, y - 22 * t.scale, t.z), 24 * t.scale, 'tc-seaglass-glow'));
    crystals.push({ g, y, ph: t.x * 0.1 });
  }
  group.add(claws.build());
  const chimneys = [[-7.2, 28.4, -3.6], [7.2, 28.4, -3.6]].map(([lx, ly, lz]) => {
    const [x, z] = local(TC_FORGE.x, TC_FORGE.z, TC_FORGE.yaw, lx, lz);
    return new THREE.Vector3(x, fy + ly, z);
  });
  group.add(smoke(chimneys));
  // The cathedral's candles burn by its doors.
  for (const [x, z] of plan.dressing.candles) group.add(glow('#ffc070', new THREE.Vector3(x, height(x, z) + 2.25, z), 1.6, 'tc-candle-glow'));
  const [gx, gz] = local(TC_FORGE.x, TC_FORGE.z, TC_FORGE.yaw, 0, 7.4);
  const forgeGlow = glow('#ff9a4a', new THREE.Vector3(gx, fy + 1.6, gz), 7, 'tc-forge-glow');
  // The hearth lights its yard and the house fronts across it (one of the city's few real lights).
  const forgeLight = new THREE.PointLight('#ff8a3a', 90, 34, 1.6);
  forgeLight.position.set(gx, fy + 3, gz);
  forgeLight.name = 'tc-forge-light';
  group.add(forgeGlow, forgeLight);
  lap('moving');

  // Fine detail far from the camera is left out: the market's stalls, the harbour's small pieces, the ships.
  culled.push({ o: market.group, box: marketBox, max: 200 });
  culled.push({ o: harbourPieces, box: new THREE.Box3().setFromObject(harbourPieces), max: 230 });
  for (const s of ships) culled.push({ o: s.g, box: new THREE.Box3().setFromObject(s.g), max: 320 });
  const eye = new THREE.Vector3();

  return {
    group,
    lod,
    refine(budget) {
      const t = performance.now();
      const done = lod.stream(budget);
      nearMs += performance.now() - t;
      this.stats.nearMs = Math.round(nearMs);
      this.stats.houseTriangles = lod.stats.nearTriangles;
      return done;
    },
    release() {
      lod.releaseNear();
    },
    dispose() {
      lod.dispose();
    },
    update(time, camera) {
      if (camera) {
        camera.getWorldPosition(eye);
        for (const c of culled) c.o.visible = c.box.distanceToPoint(eye) < c.max;
      }
      wheel.rotation.x = -time * 0.55;
      for (const c of crystals) {
        c.g.rotation.y = time * 0.25 + c.ph;
        c.g.position.y = c.y + 0.08 * Math.sin(time * 0.7 + c.ph);
      }
      for (const s of ships) {
        s.g.position.y = s.bob * Math.sin(time * 0.6 + s.ph);
        s.g.rotation.z = 0.012 * Math.sin(time * 0.43 + s.ph);
        s.g.rotation.x = 0.006 * Math.sin(time * 0.31 + s.ph * 1.7);
      }
      // Ping-pong along the route at about a crab's walk.
      const u = (time * 1.1) % (2 * routeLen), d = u < routeLen ? u : 2 * routeLen - u, back = u >= routeLen;
      let i = 0;
      while (i < seg.length - 2 && d > seg[i + 1]) i++;
      const f = (d - seg[i]) / (seg[i + 1] - seg[i]), a = route[i], b = route[i + 1];
      gondola.position.set(a[0] + (b[0] - a[0]) * f, TC_CANAL.water + 0.04 * Math.sin(time * 1.3), a[1] + (b[1] - a[1]) * f);
      gondola.rotation.y = Math.atan2(b[0] - a[0], b[1] - a[1]) + (back ? Math.PI : 0);
      const flick = Math.sin(time * 7.3) * Math.sin(time * 3.1);
      forgeGlow.material.opacity = 0.55 + 0.2 * flick;
      forgeLight.intensity = 90 * (0.88 + 0.12 * flick);
    },
    stats: { houses: plan.houses, houseTriangles: 0, farTriangles: lod.stats.farTriangles, chunks: lod.stats.chunks, nearMs: 0, ms },
  };
}
