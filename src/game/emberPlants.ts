import * as THREE from 'three';
import type {LavaZone} from './emberLava';
import {onIslandPath} from './islandPaths';
import {EMBER_FISSURES,EMBER_PATHS,type EmberFeature} from './emberGroundLayout';
import {FRONTIER_POINTS} from './frontierQuests';

/*
 * What still grows on Emberreach: sparse ash grass in clumps at the feet of the rocks and in the ash hollows,
 * red fire-ferns where the ground is warm (fissures, crystals), and ash-grey twiggy shrubs, burnt leafless, round
 * the rock groups. Clumped, never sprinkled: everything is scattered round a seed point with open ground between.
 * Three instanced meshes; none on the roads, in the town, on the court, on the lava or on a quest prop.
 */

function rng(seed: number) { let s = (seed * 2654435761) >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/** A tuft of curved, tapering blades; colour runs from a dark base to pale tips. uv.y = height along the blade. */
function tuftGeometry(blades: number, height: number, width: number, lean: number, segs: number, leaflets: boolean) {
 const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
 const R = rng(blades * 31 + segs);
 for (let b = 0; b < blades; b++) {
  const a = b / blades * Math.PI * 2 + R() * .6, h = height * (.65 + R() * .5), l = lean * (.6 + R() * .7), ca = Math.cos(a), sa = Math.sin(a);
  const base = pos.length / 3;
  for (let i = 0; i <= segs; i++) {
   const t = i / segs, out = l * t * t * h, y = h * (t - l * .35 * t * t), w = width * (1 - t * .9) * (leaflets ? (i % 2 ? 1.9 : .6) : 1);
   const cx = ca * out, cz = sa * out;
   // The blade's face turns across its bend; a soft upward normal keeps the backs from going black.
   pos.push(cx - sa * w, y, cz + ca * w, cx + sa * w, y, cz - ca * w);
   for (let k = 0; k < 2; k++) { nrm.push(ca * .35, .9, sa * .35); uv.push(k, t); }
  }
  for (let i = 0; i < segs; i++) { const q = base + i * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
 }
 const g = new THREE.BufferGeometry();
 g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
 g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
 g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
 g.setIndex(idx);
 return g;
}

/** A burnt, leafless shrub: thin three-sided twigs forking up and out. */
function shrubGeometry() {
 const pos: number[] = [], idx: number[] = [], uv: number[] = [];
 const R = rng(77);
 const twig = (o: THREE.Vector3, d: THREE.Vector3, len: number, r: number, depth: number) => {
  const end = o.clone().addScaledVector(d, len), side = new THREE.Vector3(0, 1, 0).cross(d).normalize(), up = d.clone().cross(side).normalize();
  const base = pos.length / 3;
  for (const [p, rr, t] of [[o, r, 0], [end, r * .35, 1]] as [THREE.Vector3, number, number][]) for (let k = 0; k < 3; k++) {
   const a = k / 3 * Math.PI * 2; pos.push(p.x + (side.x * Math.cos(a) + up.x * Math.sin(a)) * rr, p.y + (side.y * Math.cos(a) + up.y * Math.sin(a)) * rr, p.z + (side.z * Math.cos(a) + up.z * Math.sin(a)) * rr); uv.push(k / 3, t * (depth + 1) / 3);
  }
  for (let k = 0; k < 3; k++) { const k1 = (k + 1) % 3; idx.push(base + k, base + k1, base + 3 + k, base + k1, base + 3 + k1, base + 3 + k); }
  if (depth < 2) for (let j = 0; j < 2; j++) {
   const nd = d.clone().add(new THREE.Vector3((R() - .5) * 1.1, R() * .4, (R() - .5) * 1.1)).normalize();
   twig(o.clone().lerp(end, .55 + R() * .4), nd, len * (.55 + R() * .2), r * .55, depth + 1);
  }
 };
 for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + R() * .5; twig(new THREE.Vector3(0, -.05, 0), new THREE.Vector3(Math.cos(a) * .55, 1, Math.sin(a) * .55).normalize(), .45 + R() * .25, .035, 0); }
 const g = new THREE.BufferGeometry();
 g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
 g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
 g.setIndex(idx); g.computeVertexNormals();
 return g;
}

export interface EmberPlantsOptions {
 height: (x: number, z: number) => number;
 zones: readonly LavaZone[];
 features: readonly EmberFeature[];
}

export function emberPlants(opts: EmberPlantsOptions) {
 const {height, zones, features} = opts;
 const quest = Object.values(FRONTIER_POINTS[5]);
 const blockedBy = (x: number, z: number, pad: number) =>
  onIslandPath(EMBER_PATHS, x, z) || Math.hypot(x / 128, (z - 2) / 155) > .79 || Math.abs(x) < 44 && z > 22 && z < 97 || Math.hypot(x, z + 72) < 26 ||
  zones.some((zn) => Math.hypot(zn.x - x, zn.z - z) < zn.radius + 2.5) || quest.some(([qx, qz]) => Math.hypot(qx - x, qz - z) < 1.8) ||
  features.some((e) => { const d = Math.hypot(e.x - x, e.z - z); return e.kind === 'charred' ? d < .6 : e.kind === 'arch' ? false : d < e.r * .92 + pad; }) ||
  features.some((e) => { if (e.kind !== 'arch') return false; const s = Math.sin(e.yaw), c = Math.cos(e.yaw); return [-1, 1].some((k) => Math.hypot(e.x + s * e.r * k - x, e.z + c * e.r * k - z) < 2.4 + pad || Math.hypot(e.x + s * e.r * k + c * 2.8 * k - x, e.z + c * e.r * k - s * 2.8 * k - z) < 2.4 + pad); });
 const R = rng(5150);
 type P = {x: number; z: number; s: number; a: number};
 const grass: P[] = [], ferns: P[] = [], shrubs: P[] = [];
 const clump = (list: P[], cx: number, cz: number, n: number, spread: number, s0: number, s1: number, pad = 0) => {
  for (let i = 0; i < n; i++) {
   const a = R() * Math.PI * 2, r = spread * Math.sqrt(R()), x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
   if (blockedBy(x, z, pad)) continue;
   list.push({x, z, s: s0 + (s1 - s0) * R(), a: R() * Math.PI * 2});
  }
 };
 for (const e of features) {
  const ring = e.kind === 'charred' ? 1.2 : e.kind === 'arch' ? e.r + 2 : e.r + 1;
  // Grass at the foot, in two or three clumps round each group.
  for (let k = 0; k < (e.kind === 'charred' ? 1 : 3); k++) { const a = R() * Math.PI * 2; clump(grass, e.x + Math.sin(a) * ring, e.z + Math.cos(a) * ring, e.kind === 'charred' ? 6 : 9, 2.2, .7, 1.25, .2); }
  if (e.kind === 'columns' || e.kind === 'obsidian' || e.kind === 'arch') for (let k = 0; k < 2; k++) { const a = R() * Math.PI * 2; clump(shrubs, e.x + Math.sin(a) * (ring + 1), e.z + Math.cos(a) * (ring + 1), 3, 2.5, .7, 1.3, .4); }
  if (e.kind === 'charred') clump(shrubs, e.x, e.z, 2, 3, .6, 1.1, .3);
  if (e.kind === 'crystal') clump(ferns, e.x, e.z, 3 + e.r * 2, e.r + 2.5, .7, 1.2, .1);
 }
 // Ferns follow the warm fissures.
 for (const line of EMBER_FISSURES) for (let k = 1; k < line.length; k++) {
  const [ax, az] = line[k - 1], [bx, bz] = line[k];
  for (let t = 0; t < 1; t += .5) { const x = ax + (bx - ax) * t, z = az + (bz - az) * t, side = R() < .5 ? -1 : 1, nx = -(bz - az), nz = bx - ax, l = Math.hypot(nx, nz) || 1; clump(ferns, x + nx / l * side * 1.3, z + nz / l * side * 1.3, 2, .9, .6, 1.1); }
 }
 // Ash hollows: a few loose clumps of grass and shrubs out in the open, on the drifts.
 for (let k = 0; k < 70; k++) {
  const x = (R() - .5) * 200, z = (R() - .5) * 250 - 5, hill = Math.sin(x * .047) * Math.sin(z * .035) * (1 - Math.exp(-x * x / 900));
  if (hill > -.35) continue;
  clump(grass, x, z, 7, 2.6, .6, 1.1);
  if (R() < .35) clump(shrubs, x, z, 1, 1.5, .6, 1);
 }
 const dummy = new THREE.Object3D(), col = new THREE.Color();
 const make = (geo: THREE.BufferGeometry, mat: THREE.Material, list: P[], name: string, tint: (i: number) => THREE.Color, shadow: boolean) => {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  list.forEach((p, i) => { dummy.position.set(p.x, height(p.x, p.z) - .03, p.z); dummy.rotation.set(0, p.a, 0); dummy.scale.setScalar(p.s); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); m.setColorAt(i, tint(i)); });
  m.count = list.length; m.name = name; m.castShadow = shadow; m.receiveShadow = true; m.computeBoundingSphere(); return m;
 };
 const grassMat = new THREE.MeshStandardMaterial({color: '#ffffff', roughness: 1, side: THREE.DoubleSide});
 grassMat.name = 'ember-ash-grass';
 grassMat.onBeforeCompile = (s) => {
  s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying float vTip;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvTip=uv.y;');
  s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vTip;').replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb*=mix(vec3(.05,.045,.045),vec3(.42,.36,.3),smoothstep(0.,.9,vTip));');
 };
 const fernMat = new THREE.MeshStandardMaterial({color: '#ffffff', roughness: .9, side: THREE.DoubleSide});
 fernMat.name = 'ember-fire-fern';
 fernMat.onBeforeCompile = (s) => {
  s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying float vTip;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvTip=uv.y;');
  s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vTip;')
   .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb*=mix(vec3(.03,.01,.01),vec3(.26,.04,.025),smoothstep(0.,.8,vTip));')
   .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance+=vec3(1.,.2,.04)*smoothstep(.7,1.,vTip)*.35;');
 };
 const shrubMat = new THREE.MeshStandardMaterial({color: '#ffffff', roughness: .95});
 shrubMat.name = 'ember-ash-shrub';
 const grassMesh = make(tuftGeometry(11, .55, .028, .55, 3, false), grassMat, grass, 'ember-ash-grass', () => col.setRGB(.8 + R() * .3, .8 + R() * .25, .8 + R() * .25).clone(), false);
 const fernMesh = make(tuftGeometry(13, .32, .04, 1.4, 6, true), fernMat, ferns, 'ember-fire-ferns', () => col.setRGB(.8 + R() * .4, .8 + R() * .3, .8 + R() * .3).clone(), false);
 const shrubMesh = make(shrubGeometry(), shrubMat, shrubs, 'ember-ash-shrubs', () => new THREE.Color('#3f3b40').multiplyScalar(.8 + R() * .5), true);
 return {meshes: [grassMesh, fernMesh, shrubMesh], stats: {grass: grass.length, ferns: ferns.length, shrubs: shrubs.length}};
}
