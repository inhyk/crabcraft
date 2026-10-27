import * as THREE from 'three';
import {addPatch} from '../world/materials';

/*
 * Goldsand's contact shade (World III): ambient occlusion where things meet the ground, baked once.
 *
 * The dawn's shade fill is bright on purpose (cool sky plus the gold bounce off the sunlit sand), and without
 * occlusion every shade in the frame came out the same pale blue: house feet, rock feet, souk undersides and dune
 * hollows alike. Here the skylight is taken away where the sky is hidden, so the darkest few percent of the frame
 * sit in the junctions and the open shade keeps its value.
 *
 * Bake (once, when the quarter is built): every solid of the island is drawn from straight above into a height
 * field of how far it stands over the ground (sandGroundTex, the sand's own bake), clamped to the first few metres
 * (a tower counts as tall as a house: what hides the sky low down is the near wall, not its height). Cut-out
 * leaves, glass and glows stay out. A second pass turns the field into ground occlusion: for each texel, eight
 * directions, the highest horizon any solid raises within eight metres (the horizon-based AO of Bavoil and Sainz,
 * 2008, on a height field instead of a depth buffer).
 *
 * Shading: every lit material of the island multiplies its indirect light by the occlusion at its own foot, faded
 * out over the first metres up a wall (walls meet the ground dark, their tops stay clean), and up-facing surfaces
 * of low things (crate tops, steps) lose it sooner. The sand adds its own cavity term (sandSurface.ts).
 */

/** The baked square: the sand's fine bake (sandTerrain.ts NEAR), so both read the same uv. */
export const CONTACT_RECT = {x: -165, z: -160, size: 330};
/** Heights over the ground are clamped to this, metres: roofs, crowns and towers count as a wall this high. */
const CAP = 4.2;
/** Lower than this is paving, kerbs and guide discs: ground, not an occluder. */
const FLOOR = .28;

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
  float g=textureLod(ground,(vCW.xz-rect.xy)*rect.z,0.).x+10.;
  float h=vCW.y-g;
  // Roofs and crowns count as the band's top: a house is a solid block, not the outline of its walls.
  gl_FragColor=vec4(h<${FLOOR.toFixed(2)}?0.:min(h,${CAP.toFixed(2)}),0.,0.,1.);
}`;

const AO_FRAGMENT = /* glsl */ `
uniform sampler2D hTex;
uniform float res;
uniform float metre;
void main(){
  vec2 uv=gl_FragCoord.xy/res;
  float hc=textureLod(hTex,uv,0.).r;
  // Horizon per direction: the steepest rise of any solid within the radii, measured as sin(elevation).
  float occ=0.;
  for(int d=0;d<8;d++){
    float a=float(d)*.785398+.3927;vec2 dir=vec2(cos(a),sin(a));
    float hor=0.;
    for(int k=0;k<6;k++){
      float r=.35*pow(1.85,float(k));
      // A mip wide as a third of the radius: thin posts read as a little occlusion, walls as a lot.
      float lod=max(log2(r*.33*metre),0.);
      float h=textureLod(hTex,uv+dir*r*metre/res,lod).r;
      hor=max(hor,h/sqrt(h*h+r*r));
    }
    occ+=pow(hor,1.3);
  }
  occ/=8.;
  // Under something (a stall's awning, a bench) the ground sees only what slips in from the sides.
  float under=smoothstep(.0,.3,hc);
  float ao=1.-clamp(occ*1.25,0.,.75);
  ao=mix(ao,min(ao,.32),under);
  gl_FragColor=vec4(ao,0.,0.,1.);
}`;

/** Shared by every patched material: the AO texture, the sand's ground bake, the square they cover. */
export interface ContactUniforms {
  dawnAOTex: THREE.IUniform<THREE.Texture | null>;
  dawnAOGround: THREE.IUniform<THREE.Texture | null>;
  dawnAORect: THREE.IUniform<THREE.Vector4>;
  dawnAOOn: THREE.IUniform<number>;
}

/** GLSL for a patched fragment shader: the contact occlusion at world point w with world normal n. */
export const CONTACT_GLSL = /* glsl */ `
uniform sampler2D dawnAOTex;
uniform sampler2D dawnAOGround;
uniform vec4 dawnAORect;
uniform float dawnAOOn;
float dawnContactAO(vec3 w,vec3 n){
  vec2 uv=(w.xz-dawnAORect.xy)*dawnAORect.z;
  if(dawnAOOn<.5||any(lessThan(uv,vec2(.002)))||any(greaterThan(uv,vec2(.998))))return 1.;
  float g=textureLod(dawnAOGround,uv,0.).x+10.;
  float h=max(w.y-g,0.);
  float ga=textureLod(dawnAOTex,uv,0.).r;
  // Up a wall the ground's occlusion thins out over the first metres; a face turned up sees the sky sooner.
  float lift=smoothstep(.05,2.4,h)+smoothstep(.0,.7,h)*max(n.y,0.);
  return mix(ga,1.,clamp(lift,0.,1.));
}
`;

const VERT_HEAD = 'varying vec3 vDawnAO;\n';
const VERT_BODY = /* glsl */ `
{ vec4 aw=vec4(transformed,1.);
  #ifdef USE_BATCHING
  aw=batchingMatrix*aw;
  #endif
  #ifdef USE_INSTANCING
  aw=instanceMatrix*aw;
  #endif
  vDawnAO=(modelMatrix*aw).xyz; }`;

/** Patch one material so its indirect light takes the contact occlusion. `extra` multiplies it (GLSL float). */
export function contactPatch(mat: THREE.Material, u: ContactUniforms, extra = ''): void {
  addPatch(mat, 'goldsand-contact', (shader) => {
    const v = shader.vertexShader, f = shader.fragmentShader;
    if (!v.includes('#include <worldpos_vertex>') || !f.includes('#include <aomap_fragment>')) return;
    Object.assign(shader.uniforms, u);
    shader.vertexShader = v.replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${VERT_BODY}`);
    shader.fragmentShader = f.replace('#include <common>', `#include <common>\n${VERT_HEAD}${CONTACT_GLSL}`)
      .replace('#include <aomap_fragment>', /* glsl */ `#include <aomap_fragment>
      { float dAO=dawnContactAO(vDawnAO,inverseTransformDirection(normal,viewMatrix))${extra ? `*(${extra})` : ''};
        reflectedLight.indirectDiffuse*=dAO;reflectedLight.indirectSpecular*=mix(1.,dAO,.8); }`);
  });
}

export interface DawnContact {
  readonly uniforms: ContactUniforms;
  /** Bake once the ground is baked and the island built; patches every lit material under `root`. */
  bake(renderer: THREE.WebGLRenderer, root: THREE.Object3D, skip: Set<THREE.Object3D>, shared: Set<THREE.Material>): void;
  readonly baked: boolean;
  /** For QA: how many materials took the patch and how many meshes stood in the height field. */
  readonly stats: {materials: number; cloned: number; occluders: number; res: number};
  /** For QA: the occlusion read back at (x, z), or -1 before the bake. */
  sample(renderer: THREE.WebGLRenderer, x: number, z: number): number;
  /** For QA: the whole occlusion map (R channel, rows along +z), or null before the bake. */
  read(renderer: THREE.WebGLRenderer): Uint8Array | null;
  dispose(): void;
}

/** The contact shade for World III, sharing the sand's ground bake uniform. */
export function dawnContact(ground: THREE.IUniform<THREE.Texture | null>): DawnContact {
  const R = CONTACT_RECT, res = 1024;
  const uniforms: ContactUniforms = {
    dawnAOTex: {value: null},
    dawnAOGround: ground,
    dawnAORect: {value: new THREE.Vector4(R.x, R.z, 1 / R.size, 0)},
    dawnAOOn: {value: 0},
  };
  let aoTarget: THREE.WebGLRenderTarget | null = null;
  const stats = {materials: 0, cloned: 0, occluders: 0, res};
  const isLit = (m: THREE.Material) => (m as THREE.MeshStandardMaterial).isMeshStandardMaterial || (m as THREE.MeshLambertMaterial).isMeshLambertMaterial || (m as THREE.MeshPhongMaterial).isMeshPhongMaterial;
  return {
    uniforms,
    stats,
    get baked() { return !!aoTarget; },
    bake(renderer, root, skip, shared) {
      if (aoTarget || !ground.value) return;
      // 1. Heights over the ground, from straight above.
      const hTarget = new THREE.WebGLRenderTarget(res, res, {
        type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: true,
        minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true,
        wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
      });
      const hMat = new THREE.ShaderMaterial({uniforms: {ground, rect: uniforms.dawnAORect}, vertexShader: HEIGHT_VERTEX, fragmentShader: HEIGHT_FRAGMENT, side: THREE.DoubleSide});
      const swapped: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [], hidden: THREE.Object3D[] = [];
      root.traverse((o) => {
        if (skip.has(o)) { if (o.visible) { hidden.push(o); o.visible = false; } return; }
        const m = o as THREE.Mesh;
        if (!m.isMesh || (o as THREE.SkinnedMesh).isSkinnedMesh) { if ((o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite || (o as THREE.Light).isLight) { if (o.visible) { hidden.push(o); o.visible = false; } } return; }
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        // Only solid, lit surfaces stand in the field: no glows, glass, cut-out leaves or grass cards.
        if (mats.some((x) => !isLit(x) || x.transparent || x.alphaTest > 0 || x.blending !== THREE.NormalBlending)) { if (o.visible) { hidden.push(o); o.visible = false; } return; }
        swapped.push([m, m.material]); m.material = hMat; stats.occluders++;
      });
      // Looking straight down, the texture's u along +x and v along +z (as the sand's bake): with +z up the screen,
      // the camera's right is -x, so the frustum runs from -x0 to -(x0 + size), mirrored.
      const cam = new THREE.OrthographicCamera(-R.x, -(R.x + R.size), R.z + R.size, R.z, 0.1, 2000);
      cam.position.set(0, 1000, 0); cam.up.set(0, 0, 1); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
      const scene = new THREE.Scene();
      const parent = root.parent, at = parent ? parent.children.indexOf(root) : -1, wasVisible = root.visible, prevTarget = renderer.getRenderTarget(), prevAuto = renderer.shadowMap.autoUpdate, prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
      root.visible = true; scene.add(root);
      renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(hTarget); renderer.setClearColor(0x000000, 1); renderer.clear(true, true, false);
      renderer.render(scene, cam);
      scene.remove(root);
      if (parent) { parent.children.splice(at, 0, root); root.parent = parent; }
      root.visible = wasVisible;
      for (const [m, mat] of swapped) m.material = mat;
      for (const o of hidden) o.visible = true;
      // 2. Ground occlusion from the height field.
      aoTarget = new THREE.WebGLRenderTarget(res, res, {type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false});
      aoTarget.texture.name = 'goldsand-contact-ao';
      const aoMat = new THREE.ShaderMaterial({uniforms: {hTex: {value: hTarget.texture}, res: {value: res}, metre: {value: res / R.size}}, vertexShader: 'void main(){gl_Position=vec4(position.xy,0.,1.);}', fragmentShader: AO_FRAGMENT});
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), aoMat); quad.frustumCulled = false;
      const qs = new THREE.Scene().add(quad);
      renderer.setRenderTarget(aoTarget);
      renderer.render(qs, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
      renderer.setRenderTarget(prevTarget); renderer.setClearColor(prevClear, prevAlpha); renderer.shadowMap.autoUpdate = prevAuto;
      renderer.shadowMap.needsUpdate = true;
      aoMat.dispose(); quad.geometry.dispose(); hMat.dispose(); hTarget.dispose();
      uniforms.dawnAOTex.value = aoTarget.texture; uniforms.dawnAOOn.value = 1;
      // 3. Every lit material on the island takes the occlusion. Kit materials other worlds share are cloned first.
      const done = new Map<THREE.Material, THREE.Material>();
      const take = (mat: THREE.Material): THREE.Material => {
        let out = done.get(mat);
        if (out) return out;
        out = mat;
        if (isLit(mat) && !mat.userData.noContact) {
          if (shared.has(mat)) { out = mat.clone(); stats.cloned++; }
          if (!out.userData.contactPatched) { contactPatch(out, uniforms); out.userData.contactPatched = true; stats.materials++; }
        }
        done.set(mat, out);
        return out;
      };
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || skip.has(o)) return;
        m.material = Array.isArray(m.material) ? m.material.map(take) : take(m.material);
      });
    },
    sample(renderer, x, z) {
      if (!aoTarget) return -1;
      const px = Math.floor((x - R.x) / R.size * res), pz = Math.floor((z - R.z) / R.size * res), buf = new Uint8Array(4);
      renderer.readRenderTargetPixels(aoTarget, THREE.MathUtils.clamp(px, 0, res - 1), THREE.MathUtils.clamp(pz, 0, res - 1), 1, 1, buf);
      return buf[0] / 255;
    },
    read(renderer) {
      if (!aoTarget) return null;
      const buf = new Uint8Array(res * res * 4);
      renderer.readRenderTargetPixels(aoTarget, 0, 0, res, res, buf);
      return buf;
    },
    dispose() { aoTarget?.dispose(); aoTarget = null; uniforms.dawnAOTex.value = null; uniforms.dawnAOOn.value = 0; },
  };
}
