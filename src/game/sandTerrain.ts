import * as THREE from 'three';
import { SNOW_DEFORM_READ, SnowDeform } from './snowDeform';
import { DAWN_WIND } from '../sim/world/dawnGround';
import { SAND_GROUND_GLSL } from './sandGround';
import { addPatch } from '../world/materials';

/*
 * Goldsand's desert as a nested-ring geometry clipmap, Frostlight's snowfield (snowTerrain.ts) rebuilt for sand.
 *
 * The ground (SAND_GROUND_GLSL, the GLSL twin of dawnHeight()) is baked once on the GPU into two half-float
 * squares: a fine one over the island and its shore (16 cm texels on high) and a coarse one out to the dune sea's
 * horizon (2.7 m). Each texel holds the height, its slope and how open the ground is (0 where gameplay keeps the
 * old ground). Vertices and pixels read the bake, so the macro normal is per pixel and no vertex runs landform noise.
 *
 * One static index buffer, one draw, nine rings: 8 cm vertices round the player out to 1.3 km. The vertex shader
 * places each ring round the player, morphs it onto the next coarser lattice across its outer band, and displaces
 * it by the bake, the wind ripples (only on the finest ring, which can carry them) and the footprint field
 * band-limited to the ring's spacing.
 */

/** The sand's footprint field (SnowDeform), with the wind's infill from Goldsand's WNW and sand's quicker refill. */
export function sandDeform(size = 40): SnowDeform {
  const d = new SnowDeform(size);
  // SnowDeform keeps its pass material private; sand only changes two of its numbers.
  const u = (d as unknown as { mat: THREE.ShaderMaterial }).mat.uniforms;
  u.windAngle.value = Math.atan2(DAWN_WIND[0], DAWN_WIND[1]);
  // Dry sand runs back into a print within a minute, not Frostlight's several.
  u.refillRate.value = 10;
  return d;
}

/**
 * Wind ripples and the decimetre grain the shader adds on top of the bake: (height, d/dx, d/dz). Ripples run across
 * the wind with a gentle stoss and a short steep lee, wander and fork (two noise warps), and fade on slip faces and
 * paving. `fp` is the world size of a pixel or a vertex spacing; each layer fades as it drops below it. Bounded to a
 * centimetre and a half, so feet still meet the ground.
 */
export const SAND_FINE_GLSL = /* glsl */ `
float snHash(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
// Value noise 0..1 with its gradient: (value, d/dx, d/dy).
vec3 snNoised(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f),du=6.*f*(1.-f);
  float a=snHash(i),b=snHash(i+vec2(1.,0.)),c=snHash(i+vec2(0.,1.)),d=snHash(i+vec2(1.));
  return vec3(a+(b-a)*u.x+(c-a)*u.y+(a-b-c+d)*u.x*u.y,du*(vec2(b-a,c-a)+(a-b-c+d)*u.yx));}
float snNoise(vec2 p){return snNoised(p).x;}
// Ripple profile over one period t in 0..1: rises over 0..0.78, drops over the rest. (height -.5..5, d/dt).
vec2 snRipple(float t){
  if(t<.78){float u=t/.78;return vec2(u*u*(3.-2.*u)-.5,6.*u*(1.-u)/.78);}
  float u=(t-.78)/.22;return vec2(.5-u*u*(3.-2.*u),-6.*u*(1.-u)/.22);
}
// amp scales the ripples (0 on slip faces and paving), micro adds the finest grain (shading only).
vec3 sandFine(vec2 p,float fp,float amp,float micro){
  vec3 o=vec3(0.);
  if(amp<=.001)return o;
  vec2 w=SG_WIND,cw=vec2(-w.y,w.x);
  // Megaripples a metre apart where the wind sorts coarse grains, faint and broad.
  float fm=1.-smoothstep(.08,.3,fp);
  if(fm>.001){
    vec3 n=snNoised(p*.21+vec2(3.1,-7.7));
    float ph=dot(p,w)/1.15+n.x*2.4;vec2 gp=w/1.15+n.yz*.21*2.4;
    vec2 r=snRipple(fract(ph));
    float a=.014*amp*fm*smoothstep(.55,.8,snNoise(p*.045+vec2(-2.2,8.3)));
    o+=vec3(r.x*a,r.y*a*gp);
  }
  // Wind ripples, a hand's breadth apart; their crests wander and fork.
  // Gone by the time a pixel spans a quarter of a ripple, or they alias into moire.
  float fr=1.-smoothstep(.022,.055,fp);
  if(fr>.001){
    vec3 n1=snNoised(p*.85+vec2(7.1,1.9)),n2=snNoised(p*3.3+vec2(-4.4,2.6));
    float ph=dot(p,w)/.21+n1.x*1.9+n2.x*.45+dot(p,cw)*.06;
    vec2 gp=w/.21+n1.yz*.85*1.9+n2.yz*3.3*.45+cw*.06;
    vec2 r=snRipple(fract(ph));
    float a=.011*amp*fr*(.65+.35*snNoise(p*.31));
    o+=vec3(r.x*a,r.y*a*gp);
  }
  float fg=1.-smoothstep(.012,.05,fp);
  if(micro>0.&&fg>.001){
    vec3 n=snNoised(p*21.+vec2(1.3,5.7));
    float a=.0011*fg;
    o.x+=(n.x-.5)*a;o.yz+=n.yz*21.*a;
  }
  return o;
}
`;

/** Reading the bakes: (height, dh/dx, dh/dz, open). Past the coarse square the desert has fallen to the sea floor. */
export const SAND_GROUND_READ = /* glsl */ `
// Heights are baked less this, so the walkable ground (4 to 19 m) sits where a half float is finest.
const float SAND_H0=10.;
uniform sampler2D sandGroundTex;
uniform vec4 sandGroundRect;
uniform sampler2D sandFarTex;
uniform vec4 sandFarRect;
vec2 sandGroundUV(vec2 p){return (p-sandGroundRect.xy)*sandGroundRect.z;}
vec2 sandFarUV(vec2 p){return (p-sandFarRect.xy)*sandFarRect.z;}
bool sandIn(vec2 uv){return all(greaterThanEqual(uv,vec2(0.)))&&all(lessThanEqual(uv,vec2(1.)));}
// How much of the fine bake to use: all of it inside, fading to the coarse one over its outer 8 m.
float sandNearW(vec2 p){vec2 uv=sandGroundUV(p),e=min(uv,1.-uv)/(8.*sandGroundRect.z);return clamp(min(e.x,e.y),0.,1.);}
vec4 sandGroundAt(vec2 p){
  float w=sandNearW(p);
  vec4 near=w>0.?textureLod(sandGroundTex,sandGroundUV(p),0.)+vec4(SAND_H0,0.,0.,0.):vec4(0.);
  if(w>=1.)return near;
  vec2 fu=sandFarUV(p);
  vec4 far=sandIn(fu)?textureLod(sandFarTex,fu,0.)+vec4(SAND_H0,0.,0.,0.):vec4(-16.,0.,0.,1.);
  return mix(far,near,w);
}
`;

/** Everything the sand fragment shader reads: the footprint field, the ground twin, the fine layers and the bakes. */
export const SAND_SURFACE_GLSL = `${SNOW_DEFORM_READ}\n${SAND_GROUND_GLSL}\n${SAND_FINE_GLSL}\n${SAND_GROUND_READ}`;

/** Clipmap placement and displacement, shared by the beauty and depth passes. */
export const SAND_PLACE_GLSL = /* glsl */ `
uniform vec2 sandLodCenter;
uniform float sandBaseSpacing;
uniform float sandGridHalf;
uniform float sandDeformScale;
${SAND_SURFACE_GLSL}
// Footprint field height band-limited to what a lattice of spacing s can carry (snowTerrain.ts snowDeformBand).
float sandDeformBand(vec2 w,float s){
  float fall=snowDeformFalloff(w);
  if(fall<=0.)return 0.;
  vec2 base=fract(w/snowDeformSize);float r=s/snowDeformSize;float acc=0.;
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
    float wt=float((2-abs(i))*(2-abs(j)))*(1./16.);
    vec4 t=textureLod(snowDeformTex,base+vec2(float(i),float(j))*r,0.);
    acc+=(t.g-t.r)*wt;
  }
  return acc*fall*sandDeformScale;
}
// How rippled the sand is here: not on slip faces (an avalanche face is smooth), the sea floor or gameplay ground.
float sandRippleAmp(vec4 g){
  vec2 grad=g.yz;float s=length(grad);
  float lee=smoothstep(.28,.45,s)*smoothstep(.1,.5,-dot(grad,SG_WIND)/max(s,1e-4));
  return (1.-lee)*smoothstep(-.2,.4,g.x-SG_SEA)*mix(.35,1.,g.w);
}
struct SandVertex{vec3 world;vec2 grad;float spacing;float open;float ripple;};
SandVertex sandPlace(vec3 grid,bool fine){
  float level=grid.y;
  float spacing=sandBaseSpacing*exp2(level);
  vec2 origin=floor(sandLodCenter/(2.*spacing))*2.*spacing;
  vec2 local=grid.xz*spacing;
  // Morph by the continuous distance to the player, not to the snapped origin, so a ring step never pops.
  vec2 rel=origin+local-sandLodCenter;
  float cheb=max(abs(rel.x),abs(rel.y))/(sandGridHalf*spacing);
  float morph=clamp((cheb-.70)/.16,0.,1.);
  local=mix(local,floor(grid.xz*.5)*2.*spacing,morph);
  vec2 xz=origin+local;
  SandVertex v;
  v.spacing=spacing*(1.+morph);
  vec4 g=sandGroundAt(xz);
  float h=g.x;
  v.grad=g.yz;v.open=g.w;v.ripple=sandRippleAmp(g);
  // Ripples only where the ring can carry them, and never in the depth pass.
  if(fine)h+=sandFine(xz,v.spacing*2.4,v.ripple,0.).x;
  if(v.spacing<1.)h+=sandDeformBand(xz,v.spacing)*(1.-smoothstep(.5,1.,v.spacing));
  v.world=vec3(xz.x,h,xz.y);
  return v;
}
`;

/** One level's ring: the full square for level 0, the square minus the next-finer ring's footprint above it. */
function buildClipmap(half: number, levels: number): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  // Overlap the finer ring by a cell so ring origins that snap differently never leave a gap.
  const hole = half / 2 - 1;
  for (let level = 0; level < levels; level++) {
    const map = new Map<number, number>();
    const vert = (i: number, j: number) => {
      const key = (i + half) * (2 * half + 1) + (j + half);
      let v = map.get(key);
      if (v === undefined) { v = pos.length / 3; pos.push(i, level, j); map.set(key, v); }
      return v;
    };
    for (let j = -half; j < half; j++) for (let i = -half; i < half; i++) {
      if (level > 0 && i >= -hole && i + 1 <= hole && j >= -hole && j + 1 <= hole) continue;
      const a = vert(i, j), b = vert(i + 1, j), c = vert(i, j + 1), d = vert(i + 1, j + 1);
      // Same diagonal everywhere, so a fully morphed fine quad lands exactly on the coarse one.
      idx.push(a, c, d, a, d, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  // Placement happens on the GPU; the bounds only have to contain everything it can reach.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4000);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-2000, -50, -2000), new THREE.Vector3(2000, 200, 2000));
  return g;
}

/** Ring layouts. High: 8 cm inner spacing, 1.3 km reach. Low: 16 cm, same reach, a quarter of the vertices. */
const LAYOUTS = { high: { half: 64, levels: 9, spacing: 0.08 }, low: { half: 32, levels: 9, spacing: 0.16 } } as const;
/** The fine bake: the island, its shore and the first dunes, 330 m. 16 cm texels on high, 32 cm on low. */
const NEAR = { x: -165, z: -160, size: 330 };
/** The coarse bake: the dune sea out to the horizon, 2.8 km. */
const FAR = { x: -1400, z: -1400, size: 2800 };

const BAKE_FRAGMENT = /* glsl */ `
uniform vec4 rect;
const float SAND_H0=10.;
${SAND_GROUND_GLSL}
void main(){
  vec2 p=rect.xy+gl_FragCoord.xy*rect.w;
  float e=rect.w*.5;
  float hx=sandGroundH(p+vec2(e,0.))-sandGroundH(p-vec2(e,0.));
  float hz=sandGroundH(p+vec2(0.,e))-sandGroundH(p-vec2(0.,e));
  gl_FragColor=vec4(sandGroundH(p)-SAND_H0,hx/(2.*e),hz/(2.*e),sandOpen(p));
}
`;

export class SandTerrain {
  readonly mesh: THREE.Mesh;
  readonly uniforms = {
    sandLodCenter: { value: new THREE.Vector2(-12, 84) },
    sandBaseSpacing: { value: LAYOUTS.high.spacing as number },
    sandGridHalf: { value: LAYOUTS.high.half as number },
    sandDeformScale: { value: 1 },
    sandGroundTex: { value: null as THREE.Texture | null },
    sandGroundRect: { value: new THREE.Vector4(NEAR.x, NEAR.z, 1 / NEAR.size, 0) },
    sandFarTex: { value: null as THREE.Texture | null },
    sandFarRect: { value: new THREE.Vector4(FAR.x, FAR.z, 1 / FAR.size, 0) },
  };
  quality: 'high' | 'low' = 'high';
  private readonly geometries: Partial<Record<'high' | 'low', THREE.BufferGeometry>> = {};
  private near: THREE.WebGLRenderTarget | null = null;
  private far: THREE.WebGLRenderTarget | null = null;
  private bakedRes = 0;

  constructor(private readonly material: THREE.MeshStandardMaterial, deform: SnowDeform) {
    const u = { ...deform.uniforms, ...this.uniforms };
    addPatch(material, 'goldsand-clipmap', (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${SAND_PLACE_GLSL}\nvarying vec3 vSandWorld;\nvarying vec4 vSandInfo;`)
        .replace('#include <beginnormal_vertex>', /* glsl */ `
          SandVertex sv=sandPlace(position,true);
          vec3 objectNormal=normalize(vec3(-sv.grad.x,1.,-sv.grad.y));
          vSandWorld=sv.world;vSandInfo=vec4(sv.spacing,sv.open,sv.ripple,0.);`)
        .replace('#include <begin_vertex>', 'vec3 transformed=sv.world;');
    });
    // Shadows the town and the crabs cast still land on the sand; the desert casts none of its own (see castShadow).
    this.mesh = new THREE.Mesh(this.geometry('high'), material);
    this.mesh.name = 'goldsand-clipmap';
    this.mesh.frustumCulled = false;
    // At an 11 degree sun the shadow map cannot resolve gentle dunes without acne, and their own slopes already
    // turn away from the sun where a crest would shade them.
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    // Nothing to draw until the ground is baked (prepare()).
    this.mesh.visible = false;
    this.mesh.userData.layout = LAYOUTS.high;
  }

  private geometry(q: 'high' | 'low'): THREE.BufferGeometry {
    const l = LAYOUTS[q];
    return (this.geometries[q] ??= buildClipmap(l.half, l.levels));
  }

  private bake(renderer: THREE.WebGLRenderer, box: { x: number; z: number; size: number }, res: number, name: string): THREE.WebGLRenderTarget {
    const target = new THREE.WebGLRenderTarget(res, res, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    });
    target.texture.name = name;
    const mat = new THREE.ShaderMaterial({
      uniforms: { rect: { value: new THREE.Vector4(box.x, box.z, 0, box.size / res) } },
      vertexShader: 'void main(){gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader: BAKE_FRAGMENT,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    const scene = new THREE.Scene().add(quad), prev = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(scene, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
    renderer.setRenderTarget(prev);
    mat.dispose(); quad.geometry.dispose();
    return target;
  }

  /** Bake the ground once (again if the quality changes its resolution). Call before the first frame draws. */
  prepare(renderer: THREE.WebGLRenderer): void {
    const res = this.quality === 'high' ? 2048 : 1024;
    if (this.near && this.bakedRes === res) return;
    this.near?.dispose(); this.far?.dispose();
    this.near = this.bake(renderer, NEAR, res, 'goldsand-ground');
    this.far = this.bake(renderer, FAR, res / 2, 'goldsand-dune-sea');
    this.bakedRes = res;
    this.uniforms.sandGroundTex.value = this.near.texture;
    this.uniforms.sandFarTex.value = this.far.texture;
    this.mesh.visible = true;
    this.mesh.userData.groundRes = res;
  }

  get baked(): boolean { return !!this.near; }

  /** Swap ring layouts; low keeps the same reach with a coarser lattice and coarser bakes. */
  setQuality(q: 'high' | 'low'): void {
    if (q === this.quality) return;
    this.quality = q;
    const l = LAYOUTS[q];
    this.mesh.geometry = this.geometry(q);
    this.uniforms.sandBaseSpacing.value = l.spacing;
    this.uniforms.sandGridHalf.value = l.half;
    this.mesh.userData.layout = l;
    const defines = { ...this.material.defines };
    if (q === 'low') defines.SAND_LOW = ''; else delete defines.SAND_LOW;
    this.material.defines = defines;
    this.material.needsUpdate = true;
  }

  /** Centre the rings on the player, not the camera, so orbiting never re-samples printed sand. */
  follow(x: number, z: number): void {
    this.uniforms.sandLodCenter.value.set(x, z);
  }

  /**
   * Evaluate the ground at `points` on the GPU and read it back: [twin height, baked height, baked dh/dx, baked
   * dh/dz, twin open, baked open] per point. For QA, to hold the twin and the bake to dawnHeight().
   */
  probe(renderer: THREE.WebGLRenderer, points: readonly (readonly [number, number])[]): number[][] {
    const n = points.length, data = new Float32Array(n * 4);
    points.forEach(([x, z], i) => data.set([x, z, 0, 1], i * 4));
    const input = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat, THREE.FloatType);
    input.needsUpdate = true;
    const run = (body: string) => {
      const target = new THREE.WebGLRenderTarget(n, 1, { type: THREE.FloatType, depthBuffer: false });
      const mat = new THREE.ShaderMaterial({
        uniforms: { pts: { value: input }, ...this.uniforms },
        vertexShader: 'void main(){gl_Position=vec4(position.xy,0.,1.);}',
        fragmentShader: `uniform sampler2D pts;\n${SAND_GROUND_GLSL}\n${SAND_GROUND_READ}\nvoid main(){vec2 p=texelFetch(pts,ivec2(gl_FragCoord.xy),0).xy;${body}}`,
      });
      const scene = new THREE.Scene(), quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
      quad.frustumCulled = false;
      scene.add(quad);
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.render(scene, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
      renderer.setRenderTarget(prev);
      const out = new Float32Array(n * 4);
      renderer.readRenderTargetPixels(target, 0, 0, n, 1, out);
      target.dispose(); mat.dispose(); quad.geometry.dispose();
      return out;
    };
    const a = run('vec4 b=sandGroundAt(p);gl_FragColor=vec4(sandGroundH(p),b.xyz);');
    const b = run('gl_FragColor=vec4(sandOpen(p),sandGroundAt(p).w,0.,1.);');
    input.dispose();
    return points.map((_, i) => [...a.subarray(i * 4, i * 4 + 4), b[i * 4], b[i * 4 + 1]]);
  }

  dispose(): void {
    for (const g of Object.values(this.geometries)) g?.dispose();
    this.near?.dispose(); this.far?.dispose();
    this.near = this.far = null;
  }
}
