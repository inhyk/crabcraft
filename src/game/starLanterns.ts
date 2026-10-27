import * as THREE from 'three';
import {StoneBuilder} from './starMasonry';
import {groundGlow} from './starGlow';

/*
 * Starhaven's street lanterns and the town's own materials. A lantern: an octagonal iron post on a stepped foot,
 * collars, a bracket ring, and a four-paned lantern with a hipped roof and finial; its warm glass is the light, and
 * a pool of that light lies on the paving under each one (additive, so it warms whatever stone it falls on). Two
 * instanced draws for the 26 lanterns (iron, glass) and one merged mesh for the pools.
 */

function lanternGeometry() {
  const iron = new StoneBuilder(), glass = new StoneBuilder(), m = new THREE.Matrix4(), I = new THREE.Matrix4();
  // Post: foot, shaft, collars.
  iron.stack([{y: 0, hw: .26, ch: .08}, {y: .14, hw: .26, ch: .08}, {y: .14, hw: .2, ch: .06}, {y: .3, hw: .17, ch: .05}, {y: .3, hw: .1, ch: .03},
    {y: .42, hw: .09, ch: .027}, {y: .42, hw: .075, ch: .022}, {y: 2.7, hw: .058, ch: .017}, {y: 2.7, hw: .1, ch: .03}, {y: 2.78, hw: .1, ch: .03},
    {y: 2.78, hw: .06, ch: .018}, {y: 2.95, hw: .06, ch: .018}, {y: 2.95, hw: .15, ch: .045}, {y: 3.0, hw: .15, ch: .045}], I);
  // Lantern: tray, four corner bars, roof and finial.
  m.makeTranslation(0, 3.0, 0);
  iron.stack([{y: 0, hw: .2, ch: .02}, {y: .05, hw: .22, ch: .02}], m);
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) iron.stack([{y: .05, hw: .022, ch: .004}, {y: .52, hw: .022, ch: .004}], new THREE.Matrix4().makeTranslation(x * .175, 3.0, z * .175));
  m.makeTranslation(0, 3.52, 0);
  iron.stack([{y: 0, hw: .25, ch: .02}, {y: .04, hw: .25, ch: .02}, {y: .04, hw: .22, ch: .02}, {y: .26, hw: .06, ch: .015}, {y: .26, hw: .035, ch: .01}, {y: .38, hw: .02, ch: .006}], m);
  glass.stack([{y: 3.05, hw: .16, ch: .005}, {y: 3.52, hw: .16, ch: .005}], I);
  return {iron: iron.geometry('starhaven-lantern-iron'), glass: glass.geometry('starhaven-lantern-glass')};
}

export function starLanterns(points: {x: number; y: number; z: number}[], height: (x: number, z: number) => number) {
  const {iron, glass} = lanternGeometry();
  const ironMat = new THREE.MeshStandardMaterial({color: '#2a2c38', metalness: .85, roughness: .38, flatShading: true, envMapIntensity: 2});ironMat.name = 'starhaven-lantern-iron';
  const glassMat = new THREE.MeshStandardMaterial({color: '#ffd9a0', emissive: '#ffb55a', emissiveIntensity: 3.2, roughness: .25, flatShading: true});glassMat.name = 'starhaven-lantern-glass';
  const posts = new THREE.InstancedMesh(iron, ironMat, points.length), panes = new THREE.InstancedMesh(glass, glassMat, points.length);
  posts.name = 'starhaven-lantern-posts';panes.name = 'starhaven-lantern-panes';
  // Warm pools on the paving, laid on the ground's own heights (starGlow.ts).
  const pool = groundGlow('starhaven-lamp-pools', height, points.map(p => ({x: p.x, z: p.z, r: 4.6, color: '#ff9e4d', strength: .2, lift: 3.3})));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), s = new THREE.Vector3(1, 1, 1);
  points.forEach((p, i) => {
    m.compose(new THREE.Vector3(p.x, p.y, p.z), q.setFromAxisAngle(up, Math.PI / 4), s);posts.setMatrixAt(i, m);panes.setMatrixAt(i, m);
  });
  posts.castShadow = true;posts.receiveShadow = true;
  const pools = new THREE.Group();pools.name = 'starhaven-lamp-pool-group';pools.add(pool);
  return {posts, panes, pools};
}

/** Starhaven's homes in its own materials: slate-indigo roofs, cool limewash and weathered silver-grey timber. */
export function starhavenMaterial(name: string, m: THREE.Material) {
  if (!(m instanceof THREE.MeshStandardMaterial)) return;
  if (name === 'MI_RoundTiles') {
    // The kit's tiles keep their shape and shading; their red becomes slate blue, with silver on the worn ridges.
    m.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
{
  float l=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
  vec3 slate=mix(vec3(.025,.03,.075),vec3(.16,.2,.36),smoothstep(.02,.32,l));
  slate=mix(slate,vec3(.45,.5,.66),smoothstep(.3,.6,l)*.6);
  diffuseColor.rgb=slate;
}`);
    };
    m.customProgramCacheKey = () => 'starhaven-roof';
    m.roughness = .55;m.envMapIntensity = 1.5;
  } else if (name === 'MI_Plaster') m.color.set('#cfd0e2');
  else if (name === 'MI_WoodTrim') m.color.set('#a8968c');
  else if (name === 'MI_MetalOrnaments') { m.color.set('#c9cfe4');m.metalness = Math.max(m.metalness, .8);m.roughness = .35; }
  else if (name === 'MI_UnevenBrick' || name === 'MI_RockTrim' || name === 'MI_Brick') m.color.set('#c2c3d4');
}
