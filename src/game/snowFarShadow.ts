import * as THREE from 'three';
import { addPatch } from '../world/materials';

/*
 * The sun's shadow past the live shadow box. The live map (snowSky.ts) covers 140 m across the sun and fades out at
 * its edge; beyond it hills, pines, houses, crags and ice cast nothing. The sun is fixed, and so is everything that
 * casts on the far snow, so one island-wide depth map from the sun is rendered once and the snow shader reads it
 * wherever the live map has faded out.
 *
 * The bake draws every shadow caster under the world root depth-only (one override material), and the ground itself
 * as a height-field grid read from the baked ground texture, since the clipmap's own placement runs in its shader.
 */

/** The island and its shore, metres (snowTerrain.ts's baked square), and how high anything stands. */
const BOX = { minX: -170, maxX: 170, minZ: -168, maxZ: 172, minY: -8, maxY: 60 };
/** Height-field cells across the baked square for the ground pass. */
const GRID = 320;

const GROUND_VERTEX = /* glsl */ `
uniform sampler2D snowGroundTex;
uniform vec4 snowGroundRect;
void main(){
  vec2 xz=snowGroundRect.xy+position.xz/snowGroundRect.z;
  float h=textureLod(snowGroundTex,position.xz,0.).r;
  gl_Position=projectionMatrix*viewMatrix*vec4(xz.x,h,xz.y,1.);
}
`;

/** Reads the far map. `snowFarShadowAt(world, normal)` is 1 lit, 0 shadowed, and 1 off the map. */
export const SNOW_FAR_SHADOW_GLSL = /* glsl */ `
uniform sampler2DShadow snowFarMap;
uniform mat4 snowFarMatrix;
uniform vec4 snowFarInfo;
float snowFarShadowAt(vec3 w,vec3 n){
  if(snowFarInfo.x<.5)return 1.;
  // Pushed off the surface along its normal, then a depth bias: a 20 cm texel at a 13 degree sun.
  vec4 c=snowFarMatrix*vec4(w+n*snowFarInfo.w,1.);
  if(c.x<0.||c.x>1.||c.y<0.||c.y>1.)return 1.;
  c.z-=snowFarInfo.z;
  float phi=interleavedGradientNoise(gl_FragCoord.xy)*PI2,s=0.;
  vec2 r=snowFarInfo.y*vec2(1.,2.);
  #ifdef SNOW_LOW
  const int TAPS=4;
  #else
  const int TAPS=8;
  #endif
  for(int i=0;i<TAPS;i++)s+=texture(snowFarMap,vec3(c.xy+vogelDiskSample(i,TAPS,phi)*r,c.z));
  return s/float(TAPS);
}
`;

/**
 * Give a lit floor material (paving, the arena ice) the same handover as the snow: the live sun shadow inside its
 * box, the far map toward and past its edge. Floors face up, so the far map is read along world up.
 */
export function applyFarShadow(material: THREE.Material, far: SnowFarShadow): void {
  addPatch(material, 'frostlight-far-shadow', (shader) => {
    Object.assign(shader.uniforms, far.uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <shadowmap_pars_fragment>', /* glsl */ `#include <shadowmap_pars_fragment>
        #if defined( USE_SHADOWMAP ) && defined( SHADOWMAP_TYPE_PCF ) && NUM_DIR_LIGHT_SHADOWS > 0
        ${SNOW_FAR_SHADOW_GLSL}
        float farGetShadow(sampler2DShadow shadowMap,vec2 shadowMapSize,float shadowIntensity,float shadowBias,float shadowRadius,vec4 shadowCoord){
          vec3 c=shadowCoord.xyz/shadowCoord.w;vec2 sb=min(c.xy,1.-c.xy);
          float live=c.z>1.?0.:smoothstep(0.,.08,min(sb.x,sb.y));
          float s=live>0.?getShadow(shadowMap,shadowMapSize,1.,shadowBias,shadowRadius,shadowCoord):1.;
          if(live<1.)s=mix(snowFarShadowAt(cameraPosition+(vec4(-vViewPosition,0.)*viewMatrix).xyz,vec3(0.,1.,0.)),s,live);
          return mix(1.,s,shadowIntensity);
        }
        #else
        #define farGetShadow getShadow
        #endif`)
      .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(/getShadow\( directionalShadowMap/g, 'farGetShadow( directionalShadowMap'));
  });
}

export class SnowFarShadow {
  readonly uniforms = {
    snowFarMap: { value: null as THREE.DepthTexture | null },
    snowFarMatrix: { value: new THREE.Matrix4() },
    /** x on, y filter radius (uv), z depth bias, w normal offset (m). */
    snowFarInfo: { value: new THREE.Vector4(0, 0, 0, 0) },
  };
  baked = false;
  private target: THREE.WebGLRenderTarget | null = null;
  private readonly camera = new THREE.OrthographicCamera();
  private readonly scene = new THREE.Scene();
  private readonly override = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
  private ground: THREE.Mesh | null = null;

  constructor(private readonly sunDir: THREE.Vector3) {
    this.override.name = 'frostlight-far-shadow-depth';
    this.scene.matrixWorldAutoUpdate = true;
  }

  /**
   * Render the far map once. `root` is the world; `hide` are casters that come and go or place themselves in their shader (the clipmap);
   * the ground comes from the baked ground texture and its rect. 'low' bakes at half the resolution.
   */
  bake(renderer: THREE.WebGLRenderer, root: THREE.Object3D, ground: { tex: THREE.Texture; rect: THREE.Vector4 }, hide: THREE.Object3D[], quality: 'high' | 'low'): void {
    const w = quality === 'high' ? 2048 : 1024, h = w / 2;
    this.target?.dispose();
    const depth = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    depth.format = THREE.DepthFormat;
    depth.compareFunction = THREE.LessEqualCompare;
    depth.minFilter = depth.magFilter = THREE.LinearFilter;
    const target = this.target = new THREE.WebGLRenderTarget(w, h, { depthTexture: depth, depthBuffer: true, format: THREE.RedFormat, type: THREE.UnsignedByteType });
    target.texture.name = 'frostlight-far-shadow';

    // An orthographic sun camera fitted to the island box, its up axis as close to world up as the sun allows.
    const cam = this.camera, centre = new THREE.Vector3((BOX.minX + BOX.maxX) / 2, (BOX.minY + BOX.maxY) / 2, (BOX.minZ + BOX.maxZ) / 2);
    cam.position.copy(centre).addScaledVector(this.sunDir, 600);
    cam.up.set(0, 1, 0);
    cam.lookAt(centre);
    cam.updateMatrixWorld();
    const inv = cam.matrixWorldInverse, p = new THREE.Vector3(), lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (const x of [BOX.minX, BOX.maxX]) for (const y of [BOX.minY, BOX.maxY]) for (const z of [BOX.minZ, BOX.maxZ]) { p.set(x, y, z).applyMatrix4(inv); lo.min(p); hi.max(p); }
    Object.assign(cam, { left: lo.x, right: hi.x, bottom: lo.y, top: hi.y, near: -hi.z - 5, far: -lo.z + 5 });
    cam.updateProjectionMatrix();
    const bias = new THREE.Matrix4().set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1);
    this.uniforms.snowFarMatrix.value.copy(bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    const range = cam.far - cam.near, texel = (cam.right - cam.left) / w;
    // 1.2 texels of filter, 0.5 m of depth bias (the grid's 1 m facets), a texel of normal offset.
    this.uniforms.snowFarInfo.value.set(1, 1.2 / w, .5 / range, texel * 1.5);
    this.uniforms.snowFarMap.value = depth;

    // Only shadow casters, drawn depth-only; everything else (sky, ranges, paving, flames, snowfall) is hidden.
    const hidden: THREE.Object3D[] = [];
    const off = (o: THREE.Object3D) => { if (o.visible) { o.visible = false; hidden.push(o); } };
    root.traverse((o) => { const m = o as THREE.Mesh; if ((m.isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine) && !o.castShadow) off(o); });
    hide.forEach(off);
    const prevTarget = renderer.getRenderTarget(), prevAuto = renderer.autoClear, prevShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.autoClear = false;
    renderer.setRenderTarget(target);
    renderer.clear(true, true, false);
    // The world root stays where it is; the bake scene only borrows it as a child for this one draw.
    const scene = this.scene;
    scene.overrideMaterial = this.override;
    scene.children.push(root);
    try {
      renderer.render(scene, cam);
    } finally {
      scene.children.length = 0;
      scene.overrideMaterial = null;
    }
    // The ground as a height field.
    this.ground ??= this.groundMesh(ground);
    scene.children.push(this.ground);
    renderer.render(scene, cam);
    scene.children.length = 0;
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAuto;
    renderer.shadowMap.autoUpdate = prevShadow;
    for (const o of hidden) o.visible = true;
    this.baked = true;
  }

  private groundMesh(ground: { tex: THREE.Texture; rect: THREE.Vector4 }): THREE.Mesh {
    const n = GRID + 1, pos = new Float32Array(n * n * 3), idx: number[] = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pos.set([i / GRID, 0, j / GRID], (j * n + i) * 3);
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) { const a = j * n + i; idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      name: 'frostlight-far-shadow-ground', vertexShader: GROUND_VERTEX, fragmentShader: 'void main(){gl_FragColor=vec4(1.);}',
      uniforms: { snowGroundTex: { value: ground.tex }, snowGroundRect: { value: ground.rect } }, colorWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    return mesh;
  }

  dispose(): void {
    this.target?.dispose();
    this.target = null;
    this.uniforms.snowFarMap.value = null;
    this.uniforms.snowFarInfo.value.x = 0;
    this.ground?.geometry.dispose();
    (this.ground?.material as THREE.Material | undefined)?.dispose();
    this.override.dispose();
    this.baked = false;
  }
}
