import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {starCrystalCluster, starCrystalMaterial} from './starCrystals';
import {STAR_MOON_DIR} from './starNight';
import {STAR_DETAIL} from './starFieldLayout';
import {starForestSpots} from './world2Settlement';
import type {StarGlowSource} from './starLight';

/*
 * Starhaven's trees (star r5): three island species on the forest's old spots, so every trunk keeps its collider.
 * Moon-silvered trees with pale crowns and bleached bark; crystal-infused trees, violet in the crown, the bark veined
 * with light and crystal breaking out of the roots; and dead snags, bare and silver, killed where the star fell. The
 * rest keep the teal night crowns. Every crown takes a moon-side sheen and a pale rim (starWind.ts) and every trunk
 * a cool brown-grey bark. Positions and species only here, plus the snags' and root crystals' meshes.
 */

export type StarTreeSpecies = 'teal' | 'silver' | 'crystal' | 'snag';
/** The lit crystal tree behind the east fields (the view's focal point in its middle third). */
export const STAR_HERO_TREE = 126;
/** Snags where a full crown would hide the hero in a wild view (the west field's tree before the crab). */
const SNAGS = new Set([331]);
const UP = new THREE.Vector3(0, 1, 0);
const hash = (i: number, k: number) => { const a = Math.sin(i * 41.37 + k * 7.13 + 5.1) * 43758.5453; return a - Math.floor(a); };
export function starTreeSpecies(i: number): StarTreeSpecies {
  if (i === STAR_HERO_TREE) return 'crystal';
  if (SNAGS.has(i)) return 'snag';
  const r = hash(i, 1);
  return r < .13 ? 'snag' : r < .24 ? 'crystal' : r < .5 ? 'silver' : 'teal';
}

/** The crystal trees' light on the ground round their roots. */
export function starTreeGlows(): StarGlowSource[] {
  return starForestSpots().filter((p) => !p.rock && starTreeSpecies(p.i) === 'crystal').map((p) => p.i === STAR_HERO_TREE
    ? {x: p.x, z: p.z, radius: 3.6, color: '#a07bff', strength: 2.4}
    : {x: p.x, z: p.z, radius: 1.6 + p.scale, color: '#9a78ff', strength: 1});
}

/** A tapered limb along `curve`: rings of `radial` sides, radius r(t); aT is 0 at the root, 1 at the tip. */
function limb(curve: THREE.Curve<THREE.Vector3>, r: (t: number) => number, segs: number, radial: number, jag: number, seed: number): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(segs, false), pos: number[] = [], t: number[] = [], idx: number[] = [];
  const p = new THREE.Vector3();
  for (let j = 0; j <= segs; j++) {
    const u = j / segs;curve.getPointAt(u, p);
    const N = frames.normals[j], B = frames.binormals[j], rad = r(u);
    for (let k = 0; k <= radial; k++) {
      const a = k / radial * Math.PI * 2;
      // Bark ridges: a few deep vertical folds that wind a little up the limb.
      const fold = 1 + .14 * Math.sin(a * 5 + u * 3 + seed) + .06 * Math.sin(a * 11 - u * 7 + seed * 2);
      // A broken end splinters: the last ring's points stand at different heights.
      const split = j === segs ? jag * hash(seed * 13 + k, 3) : 0;
      const c = Math.cos(a) * rad * fold, s = Math.sin(a) * rad * fold;
      pos.push(p.x + N.x * c + B.x * s - frames.tangents[j].x * split, p.y + N.y * c + B.y * s - frames.tangents[j].y * split, p.z + N.z * c + B.z * s - frames.tangents[j].z * split);
      t.push(u);
    }
  }
  for (let j = 0; j < segs; j++) for (let k = 0; k < radial; k++) {
    const a = j * (radial + 1) + k, b = a + radial + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  // Close the end with a splintered point.
  curve.getPointAt(1, p);const tip = pos.length / 3;pos.push(p.x, p.y + jag * .4, p.z);t.push(1);
  for (let k = 0; k < radial; k++) idx.push(segs * (radial + 1) + k, tip, segs * (radial + 1) + k + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(t, 1));
  g.setIndex(idx);
  return g;
}

/** A dead snag about 3.5 to 5 m tall at unit scale: a leaning, twisted trunk with a root flare and broken limbs. */
function snagGeometry(seed: number, scale: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const H = (4.2 + 1.8 * hash(seed, 2)) * scale, lean = (hash(seed, 3) - .5) * .5, la = hash(seed, 4) * 6.28;
  const pts: THREE.Vector3[] = [];
  for (let k = 0; k <= 5; k++) {
    const u = k / 5, wob = Math.sin(u * 4 + seed) * .22 * scale;
    pts.push(new THREE.Vector3(Math.cos(la) * (lean * u * u * H * .4 + wob), u * H, Math.sin(la) * (lean * u * u * H * .4) + Math.cos(u * 3.3 + seed) * .18 * scale));
  }
  const trunk = new THREE.CatmullRomCurve3(pts);
  const r0 = .36 * scale;
  parts.push(limb(trunk, (u) => r0 * (1 - .78 * u) * (1 + .7 * Math.exp(-u * 22)), 10, 9, .35 * scale, seed));
  // Roots: short tapering flares running out and into the ground.
  for (let k = 0; k < 4; k++) {
    const a = k * 1.57 + hash(seed, 10 + k) * .8, l = (.8 + .5 * hash(seed, 20 + k)) * scale;
    const c = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, .35 * scale, 0), new THREE.Vector3(Math.cos(a) * l * .45, .18 * scale, Math.sin(a) * l * .45), new THREE.Vector3(Math.cos(a) * l, -.12 * scale, Math.sin(a) * l));
    parts.push(limb(c, (u) => r0 * .55 * (1 - .85 * u), 4, 6, 0, seed + k));
  }
  // Limbs: two to four, reaching out and up, most of them snapped short.
  const n = 2 + Math.floor(hash(seed, 5) * 3);
  for (let k = 0; k < n; k++) {
    const u = .42 + .45 * (k + hash(seed, 30 + k) * .6) / n, a = la + k * 2.3 + hash(seed, 40 + k), base = trunk.getPointAt(u);
    const l = (1 + 1.1 * hash(seed, 50 + k)) * scale * (1 - u * .4), up = .5 + .5 * hash(seed, 60 + k);
    const c = new THREE.QuadraticBezierCurve3(base, base.clone().add(new THREE.Vector3(Math.cos(a) * l * .5, l * up * .25, Math.sin(a) * l * .5)), base.clone().add(new THREE.Vector3(Math.cos(a + .3) * l, l * up, Math.sin(a + .3) * l)));
    const rb = r0 * (1 - .78 * u) * .55;
    parts.push(limb(c, (v) => rb * (1 - .7 * v), 5, 6, .12 * scale, seed + 7 * k));
    // A twig off the longer limbs.
    if (l > 1.4 * scale) {
      const m = c.getPointAt(.6), c2 = new THREE.LineCurve3(m, m.clone().add(new THREE.Vector3(Math.cos(a - .9) * l * .35, l * .4, Math.sin(a - .9) * l * .35)));
      parts.push(limb(c2, (v) => rb * .45 * (1 - .8 * v), 2, 5, .05 * scale, seed + 11 * k));
    }
  }
  const g = mergeGeometries(parts, false)!;parts.forEach((p) => p.dispose());
  g.computeVertexNormals();
  return g;
}

const BARK_HEAD = /* glsl */ `
uniform float sgDetail;
varying vec3 vStW;
varying float vStT;
float stH(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float stN(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(stH(i),stH(i+vec2(1.,0.)),f.x),mix(stH(i+vec2(0.,1.)),stH(i+1.),f.x),f.y);}
`;

/** Bleached snag wood: silver-grey under the moon, dark in the grain's furrows, damp and darker at the foot. */
function snagMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({color: '#ffffff', roughness: .82});
  m.name = 'starhaven-snag-wood';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.sgDetail = STAR_DETAIL;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aT;\nvarying vec3 vStW;\nvarying float vStT;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvStW=(modelMatrix*vec4(transformed,1.)).xyz;vStT=aT;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${BARK_HEAD}`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        // The grain runs up the wood: long streaks round the trunk, a few dark checks.
        float stG=stN(vec2((vStW.x+vStW.z)*7.,vStW.y*.9))*.6+stN(vec2((vStW.x-vStW.z)*19.,vStW.y*2.3))*.4;
        vec3 stC=mix(vec3(.2,.2,.24),vec3(.66,.68,.76),smoothstep(.25,.75,stG));
        stC*=mix(1.,.55,smoothstep(.62,.9,stN(vec2((vStW.x+vStW.z)*3.,vStW.y*6.)))*sgDetail);
        // Damp, darker foot; the broken ends paler where the wood is fresh.
        stC*=mix(.45,1.,smoothstep(.0,.25,vStT));
        stC=mix(stC,vec3(.62,.6,.58),smoothstep(.97,1.,vStT)*.6);
        diffuseColor.rgb=stC;`)
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
        // A pale rim where the wood turns from the eye, brighter on the moon's side.
        {vec3 wN=inverseTransformDirection(normal,viewMatrix);float rim=pow(1.-clamp(dot(normal,normalize(vViewPosition)),0.,1.),3.);
        totalEmissiveRadiance+=vec3(.07,.085,.12)*rim*(.4+.6*max(dot(wN,vec3(${STAR_MOON_DIR.x.toFixed(4)},${STAR_MOON_DIR.y.toFixed(4)},${STAR_MOON_DIR.z.toFixed(4)})),0.));}`);
  };
  m.customProgramCacheKey = () => 'starhaven-snag-wood';
  return m;
}

/** The snags (one merged mesh) and the crystal trees' root crystals (one instanced draw). */
export function starTreeDressing(height: (x: number, z: number) => number) {
  const root = new THREE.Group();root.name = 'starhaven-tree-species';
  const spots = starForestSpots().filter((p) => !p.rock);
  const snags: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), e = new THREE.Euler();
  const crystals: THREE.Matrix4[] = [];
  for (const p of spots) {
    const sp = starTreeSpecies(p.i), y = height(p.x, p.z);
    if (sp === 'snag') {
      const g = snagGeometry(p.i, Math.max(.85, p.scale));
      g.applyMatrix4(m.compose(v.set(p.x, y - .08, p.z), q.setFromAxisAngle(UP, p.yaw), s.set(1, 1, 1)));
      snags.push(g);
    } else if (sp === 'crystal') {
      // Crystal breaking out between the roots, leaning out from the trunk.
      const hero = p.i === STAR_HERO_TREE, n = hero ? 6 : 3;
      for (let k = 0; k < n; k++) {
        const a = p.yaw + k / n * Math.PI * 2 + hash(p.i, 70 + k) * .7, d = ((hero ? .75 : .55) + .08 * (k % 3)) * p.scale;
        const h = (hero ? 1.1 + 1.1 * hash(p.i, 80 + k) : .45 + .45 * hash(p.i, 80 + k)) * p.scale;
        const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
        e.set(Math.sin(a) * .45, hash(p.i, 90 + k) * 6.28, -Math.cos(a) * .45, 'YXZ');
        crystals.push(new THREE.Matrix4().compose(v.set(x, height(x, z) + h * .45, z), q.setFromEuler(e), s.set(h * .62, h, h * .62)));
      }
    }
  }
  if (snags.length) {
    const mesh = new THREE.Mesh(mergeGeometries(snags, false)!, snagMaterial());snags.forEach((g) => g.dispose());
    mesh.name = 'starhaven-snags';mesh.castShadow = mesh.receiveShadow = true;root.add(mesh);
  }
  const roots = new THREE.InstancedMesh(starCrystalCluster(), starCrystalMaterial('amethyst', {glow: 1.5}), Math.max(1, crystals.length));
  crystals.forEach((c, i) => roots.setMatrixAt(i, c));roots.count = crystals.length;
  roots.name = 'starhaven-tree-crystals';roots.castShadow = true;root.add(roots);
  root.userData = {snags: spots.filter((p) => starTreeSpecies(p.i) === 'snag').length, crystalTrees: spots.filter((p) => starTreeSpecies(p.i) === 'crystal').length, silverTrees: spots.filter((p) => starTreeSpecies(p.i) === 'silver').length, rootCrystals: crystals.length};
  return root;
}
