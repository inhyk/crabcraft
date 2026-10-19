// Tidecrown's districts as meshes, from the plan in cityLayout.ts: the townhouses on one distance LOD, the market's
// stalls, every kit piece of the landmarks and the street furniture as one multi-draw per material (Scatter culls each
// piece), the terrace parapets, canal walls and bridges in the castle's limestone, the canals' water, the harbour's
// quays, piers, crane and moored boats, and what moves: the ships, a gondola, the waterwheel, the seaglass crystals,
// the forge's smoke and the fountains' water.
import * as THREE from 'three';
import { type Kit, Scatter, StaticBatch, trs } from '../../world/kit';
import { addPatch, WORLD_UNIFORMS } from '../../world/materials';
import { GLSL_NOISE } from '../../world/noise';
import { TC_CANAL, TC_CANALS } from '../../sim/world/tidecrownCity';
import type { CityLayout } from './cityLayout';
import {
  type DistrictId, TC_FORGE, TC_GRAND_STAIRS, TC_HARBOUR_LEVEL, TC_LANDMARKS, TC_RETAINING, TC_WATERWHEEL,
} from './cityPlan';
import { cityLod, type District, fillDistrict, type TidecrownCollider, type TidecrownKit } from './houses';
import type { TidecrownLod } from './lod';
import { districtOverrides, type TidecrownMaterials } from './materials';
import { dressMarket } from './marketStalls';
import { worldUV } from './structures';

type Height = (x: number, z: number) => number;

export interface TidecrownCity {
  group: THREE.Group;
  lod: TidecrownLod;
  /** Colliders the near house builds add (goods on the pavements), for the island's collision once refine is done. */
  extraColliders: TidecrownCollider[];
  /** Build the houses' near detail for about `budget` ms; true once it is all in. */
  refine(budget: number): boolean;
  update(time: number, camera?: THREE.Camera): void;
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

/** Still water (canals, basins): sky-lit, rippling, deeper teal toward the middle of a channel. */
function stillWater(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ name: 'tc-canal-water', color: '#1d6a80', roughness: 0.05, metalness: 0.0, envMapIntensity: 1.5, transparent: true, opacity: 0.94 });
  addPatch(m, 'tc-canal-water', (shader) => {
    shader.uniforms.uTime = WORLD_UNIFORMS.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCwW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvCwW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vCwW;\nuniform float uTime;\n${GLSL_NOISE}`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          float n = cc_vnoise(vCwW.xz * 0.35 + vec2(uTime * 0.05, -uTime * 0.03));
          diffuseColor.rgb = mix(vec3(0.07, 0.3, 0.36), vec3(0.16, 0.52, 0.55), n);
        }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec2 p = vCwW.xz * 1.3;
          float e = 0.08;
          float a = cc_vnoise(p + vec2(uTime * 0.35, uTime * 0.21)) + 0.5 * cc_vnoise(p * 2.3 - vec2(uTime * 0.5, -uTime * 0.27));
          float bx = cc_vnoise(p + vec2(e, 0.0) + vec2(uTime * 0.35, uTime * 0.21)) + 0.5 * cc_vnoise((p + vec2(e, 0.0)) * 2.3 - vec2(uTime * 0.5, -uTime * 0.27));
          float bz = cc_vnoise(p + vec2(0.0, e) + vec2(uTime * 0.35, uTime * 0.21)) + 0.5 * cc_vnoise((p + vec2(0.0, e)) * 2.3 - vec2(uTime * 0.5, -uTime * 0.27));
          vec3 nW = normalize(vec3((a - bx) * 1.6, 1.0, (a - bz) * 1.6));
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
        }`,
      );
  });
  return m;
}

/** Falling or running water: bright streaks scrolling along the geometry's v (uv.y), foam at its foot. */
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

export function buildTidecrownCity(kits: CityKits, mats: TidecrownMaterials, plan: CityLayout, height: Height): TidecrownCity {
  const ms: Record<string, number> = {};
  let t0 = performance.now();
  const lap = (k: string) => { ms[k] = Math.round(performance.now() - t0); t0 = performance.now(); };
  const group = new THREE.Group();
  group.name = 'tidecrown-city';
  const cityOver = districtOverrides(mats, false), harbourOver = districtOverrides(mats, true);
  const forCity = (m: THREE.Material) => cityOver[m.name] ?? m;
  const forHarbour = (m: THREE.Material) => harbourOver[m.name] ?? m;

  // Townhouses: every zone on one LOD, the far builds now and the near ones a little at a time afterwards (refine).
  const lod = cityLod(kits.tide, { near: 90, shadow: 45 });
  const districts: District[] = plan.zones.map((z, i) => fillDistrict({ kit: kits.tide, ...z.options, lod, name: `tidecrown-${z.zone.district}-${i}` }, z.plan, true));
  lod.buildFar();
  lod.name = 'tidecrown-houses';
  group.add(lod);
  function* nearSteps(): Generator<void, void> {
    for (const d of districts) yield* d.near!();
    yield* lod.buildNearSteps();
  }
  const near = nearSteps();
  let nearDone = false, nearMs = 0;
  lap('houses');

  const market = dressMarket({ kit: kits.tide, ...plan.market.options, name: 'tidecrown-market' }, plan.market.plan);
  group.add(market.group);
  const marketBox = new THREE.Box3().setFromObject(market.group);
  lap('market');

  // City kit pieces: landmarks, terrace walls, stairs, lamps, banner poles and wall banners.
  const pieces = new Scatter(kits.city, 'tidecrown-city-pieces');
  for (const l of TC_LANDMARKS) pieces.add(l.piece, trs(l.x, height(l.x, l.z) - 0.12, l.z, l.yaw, l.scale));
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
  for (const f of furniture) {
    if (!f.s.count) continue;
    const g = f.s.build({ materialFor: forCity });
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
  // Canal walls: 2 thick from the bed to a coping that overhangs the water a little.
  const top = TC_CANAL.street + 0.06, bed = TC_CANAL.bed - 0.4;
  for (const w of plan.canalWalls) {
    const dx = w.bx - w.ax, dz = w.bz - w.az, len = Math.hypot(dx, dz), yaw = Math.atan2(-dz, dx);
    const mx = (w.ax + w.bx) / 2, mz = (w.az + w.bz) / 2, b = sector(mx);
    // Local +Z toward the water (n).
    const lz = Math.sign(Math.sin(yaw) * w.nx + Math.cos(yaw) * w.nz) || 1;
    b.addGeometry(frameBox(mx, mz, yaw, 0, (top + bed) / 2, -lz * 1.0, len + 0.04, top - bed, 2.0), D, null);
    b.addGeometry(frameBox(mx, mz, yaw, 0, top + 0.1, -lz * 0.94, len + 0.04, 0.2, 2.12), L, null);
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
  for (const b of stone) group.add(b.build());
  lap('stone');

  // Water: the canals, the forge's channel and race, the fountains' basins.
  const water = stillWater();
  const wpos: number[] = [], widx: number[] = [];
  const quadAt = (pts: [number, number][], y: number) => {
    const i0 = wpos.length / 3;
    for (const [x, z] of pts) wpos.push(x, y, z);
    widx.push(i0, i0 + 2, i0 + 1, i0, i0 + 3, i0 + 2);
  };
  for (const c of TC_CANALS) {
    for (let i = 0; i < c.points.length - 1; i++) {
      const [ax, az] = c.points[i], [bx, bz] = c.points[i + 1], len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len, h = c.width / 2 + 0.15;
      const e0 = i === 0 ? 0.1 : c.width / 2, e1 = i === c.points.length - 2 ? 0.1 : c.width / 2;
      quadAt([[ax - ux * e0 - uz * h, az - uz * e0 + ux * h], [bx + ux * e1 - uz * h, bz + uz * e1 + ux * h], [bx + ux * e1 + uz * h, bz + uz * e1 - ux * h], [ax - ux * e0 + uz * h, az - uz * e0 - ux * h]], TC_CANAL.water);
    }
  }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
  wg.setIndex(widx);
  wg.computeVertexNormals();
  // Faces up whichever way the quads wound.
  const nrm = wg.getAttribute('normal');
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
  const canalWater = new THREE.Mesh(wg, water);
  canalWater.name = 'tc-canal-water';
  canalWater.receiveShadow = true;
  group.add(canalWater);

  water.side = THREE.DoubleSide;
  const falls = fallingWater(1.4), race2 = fallingWater(0.9);
  // The spout's fall into the basin.
  const fall: THREE.Vector3[] = [];
  for (let i = 0; i <= 10; i++) { const f = i / 10; fall.push(new THREE.Vector3(chx, spoutY - (spoutY - fy - 0.7) * f * f, wallZ + 0.5 + 0.9 * f)); }
  // Channel and race: running water along the channel to the wheel.
  const run: THREE.Vector3[] = [];
  const [rx1, rz1] = local(TC_FORGE.x, TC_FORGE.z, TC_FORGE.yaw, rx, race.z[1]);
  for (let i = 0; i <= 8; i++) { const f = i / 8; run.push(new THREE.Vector3(chx + (rx1 - chx) * f, fy + race.water + 0.02, wallZ + 1.4 + (rz1 - wallZ - 1.4) * f)); }
  const flowMesh = new THREE.Mesh(waterRibbon(fall, 0.55, new THREE.Vector3(1, 0, 0)), falls);
  flowMesh.name = 'tc-forge-fall';
  const raceMesh = new THREE.Mesh(waterRibbon(run, 2.3, new THREE.Vector3(1, 0, 0)), race2);
  raceMesh.name = 'tc-forge-race';
  group.add(flowMesh, raceMesh);

  // Fountains: two basins of still water, the eight jets and the spill from the upper bowl.
  const jets: THREE.BufferGeometry[] = [];
  for (const f of TC_LANDMARKS.filter((l) => l.piece === 'TC_Fountain')) {
    const y = height(f.x, f.z) - 0.12, s = f.scale;
    const basin = (r: number, sides: number, yy: number, rot: number) => {
      const g = new THREE.CircleGeometry(r * s, sides, rot).rotateX(-Math.PI / 2);
      g.applyMatrix4(trs(f.x, y + yy * s, f.z, f.yaw));
      return g;
    };
    const b0 = new THREE.Mesh(basin(6.45, 8, 0.85, Math.PI / 8), water), b1 = new THREE.Mesh(basin(2.8, 16, 2.55, 0), water);
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
    }
    const spill = new THREE.CylinderGeometry(3.12, 3.32, 1.75, 32, 1, true);
    spill.translate(0, 2.66 - 0.875, 0).scale(s, s, s).applyMatrix4(trs(f.x, y, f.z, f.yaw));
    jets.push(spill);
  }
  for (const g of jets) {
    const m = new THREE.Mesh(g, falls);
    m.name = 'tc-fountain-jet';
    m.renderOrder = 2;
    group.add(m);
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
  for (const t of TC_LANDMARKS.filter((l) => l.piece === 'TC_SeaglassTower')) {
    const g = pieceGroup(kits.city, 'TC_SeaglassCrystal', cityOver, `tidecrown-crystal-${t.id}`, false);
    // Twice the kit's size, hovering a little higher than its anchor (69.5) so it clears the finial.
    const y = height(t.x, t.z) - 0.12 + 72 * t.scale;
    g.position.set(t.x, y, t.z);
    g.scale.setScalar(t.scale * 2.1);
    group.add(g, glow('#b07cff', new THREE.Vector3(t.x, y, t.z), 30 * t.scale, 'tc-crystal-glow'), glow('#4fd8e0', new THREE.Vector3(t.x, y - 22 * t.scale, t.z), 22 * t.scale, 'tc-seaglass-glow'));
    crystals.push({ g, y, ph: t.x * 0.1 });
  }
  const chimneys = [[-7.2, 28.4, -3.6], [7.2, 28.4, -3.6]].map(([lx, ly, lz]) => {
    const [x, z] = local(TC_FORGE.x, TC_FORGE.z, TC_FORGE.yaw, lx, lz);
    return new THREE.Vector3(x, fy + ly, z);
  });
  group.add(smoke(chimneys));
  const [gx, gz] = local(TC_FORGE.x, TC_FORGE.z, TC_FORGE.yaw, 0, 7.6);
  const forgeGlow = glow('#ff8a3a', new THREE.Vector3(gx, fy + 2.4, gz), 9, 'tc-forge-glow');
  group.add(forgeGlow);
  lap('moving');

  // Fine detail far from the camera is left out: the market's stalls, the harbour's small pieces, the ships.
  culled.push({ o: market.group, box: marketBox, max: 150 });
  culled.push({ o: harbourPieces, box: new THREE.Box3().setFromObject(harbourPieces), max: 230 });
  for (const s of ships) culled.push({ o: s.g, box: new THREE.Box3().setFromObject(s.g), max: 320 });
  const eye = new THREE.Vector3();

  return {
    group,
    lod,
    refine(budget) {
      if (nearDone) return true;
      const t = performance.now();
      while (performance.now() - t < budget) {
        if (near.next().done) {
          nearDone = true;
          break;
        }
      }
      nearMs += performance.now() - t;
      if (nearDone) {
        this.stats.nearMs = Math.round(nearMs);
        const ls = lod.stats;
        this.stats.houseTriangles = ls.nearTriangles;
        this.stats.farTriangles = ls.farTriangles;
        this.stats.chunks = ls.chunks;
        districts.forEach((d, i) => this.extraColliders.push(...d.colliders.slice(plan.zones[i].plan.colliders.length)));
      }
      return nearDone;
    },
    extraColliders: [],
    update(time, camera) {
      if (camera) {
        camera.getWorldPosition(eye);
        for (const c of culled) c.o.visible = c.box.distanceToPoint(eye) < c.max;
      }
      wheel.rotation.x = -time * 0.55;
      for (const c of crystals) {
        c.g.rotation.y = time * 0.25 + c.ph;
        c.g.position.y = c.y + 0.5 * Math.sin(time * 0.7 + c.ph);
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
      forgeGlow.material.opacity = 0.75 + 0.25 * Math.sin(time * 7.3) * Math.sin(time * 3.1);
    },
    stats: { houses: plan.houses, houseTriangles: 0, farTriangles: lod.stats.farTriangles, chunks: lod.stats.chunks, nearMs: 0, ms },
  };
}
