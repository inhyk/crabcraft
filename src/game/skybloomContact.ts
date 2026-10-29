import * as THREE from 'three';
import {CONTACT_RECT, contactPatch, type ContactUniforms} from './dawnContact';
import {skyHeight} from './skyGroundLayout';

/*
 * Skybloom's contact shade (World VI): the sky taken away where something hides it, baked once. Goldsand's method
 * (dawnContact.ts: a height field drawn from straight above, then horizon-based occlusion over it, multiplied into
 * each lit material's indirect light) with two changes for a garden under a high sun:
 * - leaf cards and crowns stand in the field as solids, so the ground under a canopy, under eaves and inside the root
 *   arches loses most of its sky (the darkest tenth of the frame sits there, at L 55 to 70), while open shade keeps
 *   its value and the frame's middle does not move;
 * - only Skybloom's own materials (named sky...) take the patch: kit materials other worlds share stay untouched.
 */

/** Heights over the ground are clamped to this, metres. */
const CAP = 4.5;
/** Lower than this is paving and kerbs: ground, not an occluder. */
const FLOOR = 0.3;
/** Under a canopy or an eave the ground keeps at most this much of its sky. */
const UNDER = 0.36;

const HEIGHT_VERTEX = /* glsl */ `
#include <common>
#include <batching_pars_vertex>
varying vec3 vCW;
void main(){
  #include <batching_vertex>
  #include <begin_vertex>
  vec4 w=vec4(transformed,1.);
  #ifdef USE_BATCHING
  w=batchingMatrix*w;
  #endif
  #ifdef USE_INSTANCING
  w=instanceMatrix*w;
  #endif
  w=modelMatrix*w;vCW=w.xyz;
  gl_Position=projectionMatrix*viewMatrix*w;
}`;

const HEIGHT_FRAGMENT = /* glsl */ `
uniform sampler2D ground;
uniform vec4 rect;
varying vec3 vCW;
void main(){
  float h=vCW.y-(textureLod(ground,(vCW.xz-rect.xy)*rect.z,0.).x+10.);
  gl_FragColor=vec4(h<${FLOOR.toFixed(2)}?0.:min(h,${CAP.toFixed(2)}),0.,0.,1.);
}`;

const AO_FRAGMENT = /* glsl */ `
uniform sampler2D hTex;
uniform float res;
uniform float metre;
void main(){
  vec2 uv=gl_FragCoord.xy/res;
  float hc=textureLod(hTex,uv,0.).r;
  float occ=0.;
  for(int d=0;d<8;d++){
    float a=float(d)*.785398+.3927;vec2 dir=vec2(cos(a),sin(a));
    float hor=0.;
    for(int k=0;k<6;k++){
      float r=.35*pow(1.85,float(k));
      float lod=max(log2(r*.33*metre),0.);
      float h=textureLod(hTex,uv+dir*r*metre/res,lod).r;
      hor=max(hor,h/sqrt(h*h+r*r));
    }
    occ+=pow(hor,1.3);
  }
  occ/=8.;
  // Open ground beside a wall keeps at least 0.4 of its sky: with the long morning shadows a deeper floor turned a
  // house's shadow next to its wall into a black slab (r4, village view).
  float ao=1.-clamp(occ*1.1,0.,.6);
  ao=mix(ao,min(ao,${UNDER.toFixed(2)}),smoothstep(.0,.3,hc));
  gl_FragColor=vec4(ao,0.,0.,1.);
}`;

export interface SkybloomContact {
  readonly uniforms: ContactUniforms;
  readonly baked: boolean;
  readonly stats: {materials: number; occluders: number; res: number};
  /** Once, with the island built: occluders are every solid or cut-out lit mesh under `root` but `skip`. */
  bake(renderer: THREE.WebGLRenderer, root: THREE.Object3D, skip: Set<THREE.Object3D>): void;
  /** For QA: the occlusion at (x, z), or -1 before the bake. */
  sample(renderer: THREE.WebGLRenderer, x: number, z: number): number;
}

export function skybloomContact(): SkybloomContact {
  const R = CONTACT_RECT, res = 1024, G = 384;
  // The play surface under the square, as Goldsand's ground bake stores it (height - 10 in R).
  const g = new Uint16Array(G * G * 4);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const x = R.x + ((i + 0.5) / G) * R.size, z = R.z + ((j + 0.5) / G) * R.size, o = (j * G + i) * 4;
    g[o] = THREE.DataUtils.toHalfFloat(Math.max(skyHeight(x, z), -60) - 10); g[o + 3] = THREE.DataUtils.toHalfFloat(1);
  }
  const groundTex = new THREE.DataTexture(g, G, G, THREE.RGBAFormat, THREE.HalfFloatType);
  groundTex.minFilter = groundTex.magFilter = THREE.LinearFilter; groundTex.colorSpace = THREE.NoColorSpace; groundTex.needsUpdate = true;
  const uniforms: ContactUniforms = {
    dawnAOTex: {value: null}, dawnAOGround: {value: groundTex},
    dawnAORect: {value: new THREE.Vector4(R.x, R.z, 1 / R.size, 0)}, dawnAOOn: {value: 0},
  };
  let aoTarget: THREE.WebGLRenderTarget | null = null;
  const stats = {materials: 0, occluders: 0, res};
  const isLit = (m: THREE.Material) => (m as THREE.MeshStandardMaterial).isMeshStandardMaterial || (m as THREE.MeshLambertMaterial).isMeshLambertMaterial || (m as THREE.MeshPhongMaterial).isMeshPhongMaterial;
  return {
    uniforms, stats,
    get baked() { return !!aoTarget; },
    bake(renderer, root, skip) {
      if (aoTarget) return;
      const hTarget = new THREE.WebGLRenderTarget(res, res, {
        type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: true,
        minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true,
      });
      const hMat = new THREE.ShaderMaterial({uniforms: {ground: uniforms.dawnAOGround, rect: uniforms.dawnAORect}, vertexShader: HEIGHT_VERTEX, fragmentShader: HEIGHT_FRAGMENT, side: THREE.DoubleSide});
      const swapped: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [], hidden: THREE.Object3D[] = [];
      const hide = (o: THREE.Object3D) => { if (o.visible) { hidden.push(o); o.visible = false; } };
      root.traverse((o) => {
        if (skip.has(o)) { hide(o); return; }
        const m = o as THREE.Mesh;
        if (!m.isMesh || (o as THREE.SkinnedMesh).isSkinnedMesh) { if ((o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite) hide(o); return; }
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        // Leaves and crowns count (a canopy hides the sky); glows, glass and blended things do not.
        if (mats.some((x) => !isLit(x) || x.transparent || x.blending !== THREE.NormalBlending)) { hide(o); return; }
        swapped.push([m, m.material]); m.material = hMat; stats.occluders++;
      });
      // Straight down, u along +x and v along +z (dawnContact.ts: the camera's right is -x, so the frustum is mirrored).
      const cam = new THREE.OrthographicCamera(-R.x, -(R.x + R.size), R.z + R.size, R.z, 0.1, 2000);
      cam.position.set(0, 1000, 0); cam.up.set(0, 0, 1); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
      const scene = new THREE.Scene(), parent = root.parent, at = parent ? parent.children.indexOf(root) : -1, wasVisible = root.visible;
      const prevTarget = renderer.getRenderTarget(), prevAuto = renderer.shadowMap.autoUpdate, prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
      root.visible = true; scene.add(root);
      renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(hTarget); renderer.setClearColor(0x000000, 1); renderer.clear(true, true, false);
      renderer.render(scene, cam);
      scene.remove(root);
      if (parent) { parent.children.splice(at, 0, root); root.parent = parent; }
      root.visible = wasVisible;
      for (const [m, mat] of swapped) m.material = mat;
      for (const o of hidden) o.visible = true;
      aoTarget = new THREE.WebGLRenderTarget(res, res, {type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false});
      aoTarget.texture.name = 'skybloom-contact-ao';
      const aoMat = new THREE.ShaderMaterial({uniforms: {hTex: {value: hTarget.texture}, res: {value: res}, metre: {value: res / R.size}}, vertexShader: 'void main(){gl_Position=vec4(position.xy,0.,1.);}', fragmentShader: AO_FRAGMENT});
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), aoMat); quad.frustumCulled = false;
      renderer.setRenderTarget(aoTarget);
      renderer.render(new THREE.Scene().add(quad), new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
      renderer.setRenderTarget(prevTarget); renderer.setClearColor(prevClear, prevAlpha); renderer.shadowMap.autoUpdate = prevAuto;
      renderer.shadowMap.needsUpdate = true;
      aoMat.dispose(); quad.geometry.dispose(); hMat.dispose(); hTarget.dispose();
      uniforms.dawnAOTex.value = aoTarget.texture; uniforms.dawnAOOn.value = 1;
      // Receivers: Skybloom's own lit materials (the meadow, the grass, houses, the tree, the sanctuary).
      const done = new Set<THREE.Material>();
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          if (done.has(mat)) continue;
          done.add(mat);
          if (!isLit(mat) || !/^sky/.test(mat.name) || mat.name === 'skybloom-land' || mat.userData.contactPatched) continue;
          // Pin the program key to the material's own shader hook first: addPatch wraps onBeforeCompile, and the
          // default key (the hook's source text) would then read the same for every wrapped material and hand one
          // material another's program.
          if (mat.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey) { const key = mat.onBeforeCompile.toString(); mat.customProgramCacheKey = () => key; }
          contactPatch(mat, uniforms); mat.userData.contactPatched = true; stats.materials++;
        }
      });
    },
    sample(renderer, x, z) {
      if (!aoTarget) return -1;
      const px = Math.floor((x - R.x) / R.size * res), pz = Math.floor((z - R.z) / R.size * res), buf = new Uint8Array(4);
      renderer.readRenderTargetPixels(aoTarget, THREE.MathUtils.clamp(px, 0, res - 1), THREE.MathUtils.clamp(pz, 0, res - 1), 1, 1, buf);
      return buf[0] / 255;
    },
  };
}
