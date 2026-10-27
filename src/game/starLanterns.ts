import * as THREE from 'three';
import {StoneBuilder} from './starMasonry';
import {injectStarLight} from './starLight';

/*
 * Starhaven's street lanterns and the town's own materials. A lantern: an octagonal iron post on a stepped foot,
 * collars, a bracket ring, and a four-paned lantern with a hipped roof and finial; its warm glass is the light. The
 * pool each one throws on the paving, the grass and the house fronts is lighting in those materials (starLight.ts).
 * Two instanced draws for the 26 lanterns (iron, glass).
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

/** A crook post: a timber post with an iron crook at the top, the same lantern hung under the arm (glass ~3.1 m). */
function crookGeometry() {
  const wood = new StoneBuilder(), iron = new StoneBuilder(), glass = new StoneBuilder(), I = new THREE.Matrix4(), m = new THREE.Matrix4();
  wood.stack([{y: -.1, hw: .13, ch: .05}, {y: .25, hw: .12, ch: .045}, {y: 3.75, hw: .085, ch: .03}, {y: 3.82, hw: .07, ch: .025}], I);
  // The arm: a short beam out to +X with a brace under it.
  m.makeRotationZ(-Math.PI / 2).setPosition(0, 3.62, 0);
  iron.stack([{y: 0, hw: .035, ch: .01}, {y: .62, hw: .03, ch: .01}], m);
  m.makeRotationZ(-Math.PI / 4).setPosition(0, 3.2, 0);
  iron.stack([{y: 0, hw: .02, ch: .006}, {y: .5, hw: .02, ch: .006}], m);
  // Chain and the hung lantern under the arm's end.
  m.makeTranslation(.55, 3.3, 0);
  iron.stack([{y: 0, hw: .012, ch: .003}, {y: .32, hw: .012, ch: .003}], m);
  m.makeTranslation(.55, 2.82, 0);
  iron.stack([{y: 0, hw: .15, ch: .03}, {y: .04, hw: .16, ch: .03}], m);
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) iron.stack([{y: .04, hw: .016, ch: .003}, {y: .42, hw: .016, ch: .003}], new THREE.Matrix4().makeTranslation(.55 + x * .12, 2.82, z * .12));
  m.makeTranslation(.55, 3.24, 0);
  iron.stack([{y: 0, hw: .19, ch: .03}, {y: .03, hw: .19, ch: .03}, {y: .03, hw: .05, ch: .012}, {y: .1, hw: .02, ch: .006}], m);
  glass.stack([{y: 2.86, hw: .115, ch: .004}, {y: 3.24, hw: .115, ch: .004}], new THREE.Matrix4().makeTranslation(.55, 0, 0));
  const g = wood.geometry('starhaven-crook-wood');
  return {wood: g, iron: iron.geometry('starhaven-crook-iron'), glass: glass.geometry('starhaven-crook-glass')};
}

/**
 * The high street's lamp places dressed by kind (STAR_LAMP_KIND): iron posts at three heights, crook posts with a
 * hung lantern, crystal lamps on octagonal moonstone pedestals, and gaps. One instanced draw per part.
 */
export function starLanterns(points: {x: number; y: number; z: number}[], kinds: readonly string[], crystal: {geometry: THREE.BufferGeometry; material: THREE.Material; plinth: THREE.Material}) {
  const {iron, glass} = lanternGeometry(), crook = crookGeometry();
  const ironMat = new THREE.MeshStandardMaterial({color: '#2a2c38', metalness: .85, roughness: .38, flatShading: true, envMapIntensity: 2});ironMat.name = 'starhaven-lantern-iron';
  const glassMat = new THREE.MeshStandardMaterial({color: '#ffd9a0', emissive: '#ffb55a', emissiveIntensity: 3.2, roughness: .25, flatShading: true});glassMat.name = 'starhaven-lantern-glass';
  const woodMat = new THREE.MeshStandardMaterial({color: '#4a3a32', roughness: .85, flatShading: true});woodMat.name = 'starhaven-crook-wood';
  const at = (k: string[]) => points.map((p, i) => ({p, i})).filter(({i}) => k.includes(kinds[i]));
  const postList = at(['post', 'tall', 'short']), crookList = at(['crook']), crystalList = at(['crystal']);
  const posts = new THREE.InstancedMesh(iron, ironMat, postList.length), panes = new THREE.InstancedMesh(glass, glassMat, postList.length);
  posts.name = 'starhaven-lantern-posts';panes.name = 'starhaven-lantern-panes';
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), s = new THREE.Vector3(), v = new THREE.Vector3();
  postList.forEach(({p, i}, n) => {
    const h = kinds[i] === 'tall' ? 1.14 : kinds[i] === 'short' ? .84 : 1;
    m.compose(v.set(p.x, p.y, p.z), q.setFromAxisAngle(up, Math.PI / 4), s.set(1, h, 1));posts.setMatrixAt(n, m);panes.setMatrixAt(n, m);
  });
  // Crooks lean their lanterns over the paving (the arm points from the kerb toward the street's middle).
  const cWood = new THREE.InstancedMesh(crook.wood, woodMat, crookList.length), cIron = new THREE.InstancedMesh(crook.iron, ironMat, crookList.length), cGlass = new THREE.InstancedMesh(crook.glass, glassMat, crookList.length);
  cWood.name = 'starhaven-crook-posts';cIron.name = 'starhaven-crook-iron';cGlass.name = 'starhaven-crook-panes';
  crookList.forEach(({p}, n) => { m.compose(v.set(p.x + Math.sign(p.x) * .45, p.y, p.z), q.setFromAxisAngle(up, p.x > 0 ? Math.PI : 0), s.set(1, 1, 1));cWood.setMatrixAt(n, m);cIron.setMatrixAt(n, m);cGlass.setMatrixAt(n, m); });
  // Crystal lamps: a waist-high moonstone pedestal, a regular octagon in plan (chamfer .586 of the half width): a
  // stepped foot, a slender tapering shaft with a collar, and a flared cap cradling a crown of pale crystal.
  const pl = new StoneBuilder(), o8 = (y: number, hw: number) => ({y, hw, ch: hw * .586});
  for (const {p, i} of crystalList) pl.stack([o8(-.2, .38), o8(.06, .38), o8(.06, .31), o8(.16, .31), o8(.16, .2), o8(.24, .18), o8(.78, .15),
    o8(.78, .19), o8(.84, .19), o8(.84, .15), o8(.9, .16), o8(.9, .2), o8(1., .29), o8(1.08, .29)], new THREE.Matrix4().makeRotationY(i * .4).setPosition(p.x, p.y, p.z));
  const plinths = new THREE.Mesh(pl.geometry('starhaven-crystal-lamp-plinths'), crystal.plinth);plinths.name = 'starhaven-crystal-lamp-plinths';
  const gems = new THREE.InstancedMesh(crystal.geometry, crystal.material, crystalList.length);gems.name = 'starhaven-crystal-lamps';
  crystalList.forEach(({p, i}, n) => { m.compose(v.set(p.x, p.y + 1.08 + .55, p.z), q.setFromAxisAngle(up, i * 1.7), s.set(.55, 1.1, .55));gems.setMatrixAt(n, m); });
  for (const o of [posts, cWood, cIron, plinths, gems]) { o.castShadow = true; o.receiveShadow = true; }
  const group = new THREE.Group();group.name = 'starhaven-street-lamps-varied';group.add(cWood, cIron, cGlass, plinths, gems);
  return {posts, panes, others: group};
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
    return;
  } else if (name === 'MI_Plaster') m.color.set('#cfd0e2');
  else if (name === 'MI_WoodTrim') m.color.set('#a8968c');
  else if (name === 'MI_MetalOrnaments') { m.color.set('#c9cfe4');m.metalness = Math.max(m.metalness, .8);m.roughness = .35; }
  else if (name === 'MI_UnevenBrick' || name === 'MI_RockTrim' || name === 'MI_Brick') m.color.set('#c2c3d4');
  else return;
  // House fronts near the street catch the lanterns' light.
  m.onBeforeCompile = shader => injectStarLight(shader, null, {baked: false, lamps: true});
  m.customProgramCacheKey = () => 'starhaven-lamplit';
}
