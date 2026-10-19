import * as THREE from 'three';
import { SNOW_WIND } from '../sim/world/snowGround';

/*
 * Snow deformation field for Frostlight. A port of SNOWFLOW's terrain state buffer (deformSim.fragment.wgsl
 * and snowContact.js, MIT, Copyright (c) 2026 Maksymilian Dendura; see NOTICE.md) from WebGPU to WebGL2.
 *
 * Two RGBA16F targets ping-pong once per frame. Channels: R depression, G displaced mass (the berm that
 * separates a trail from a flat decal), B compression, A ice. Addressing is toroidal (uv = fract(xz/size)),
 * so the window follows the player without copying, and texels that just wrapped in are zeroed.
 */

const MAX_BRUSHES = 64;
/** Relaxation is banked and spent in steps this long: a half-float target cannot hold a per-frame decay. */
const RELAX_STEP = 0.4;

export interface SnowBrush {
  x: number;
  z: number;
  /** Short-axis radius, world units. */
  radius: number;
  depth: number;
  berm: number;
  /** Long axis over short axis; 1 is round. */
  elongation?: number;
  /** Long axis heading, radians, three.js yaw (0 faces +Z). */
  yaw?: number;
  compression?: number;
  ice?: number;
  /** Rim wobble 0..1. */
  roughness?: number;
  seed?: number;
}

const SIM_VERTEX = /* glsl */ `
varying vec2 vUv;
void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}
`;

const NOISE = /* glsl */ `
vec2 sdHash22(vec2 p){vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));p3+=dot(p3,p3.yzx+33.33);return fract((p3.xx+p3.yz)*p3.zy);}
float sdNoise2(vec2 p){
  vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
  float a=dot(sdHash22(i)*2.-1.,f),b=dot(sdHash22(i+vec2(1.,0.))*2.-1.,f-vec2(1.,0.));
  float c=dot(sdHash22(i+vec2(0.,1.))*2.-1.,f-vec2(0.,1.)),d=dot(sdHash22(i+vec2(1.))*2.-1.,f-vec2(1.));
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y)*1.4;
}
`;

const SIM_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D prevTex;
uniform sampler2D brushTex;
uniform vec2 center;
uniform vec2 prevCenter;
uniform float size;
uniform float res;
uniform float dt;
uniform float brushCount;
uniform float refillRate;
uniform float maxDepth;
uniform float maxBerm;
uniform float windAngle;
varying vec2 vUv;
${NOISE}
// The world position a texel stands for: uv*size pins it modulo the window, the right copy is nearest the centre.
vec2 texelWorld(vec2 uv){vec2 base=uv*size;return base+size*floor((center-base)/size+.5);}
void main(){
  vec2 uv=vUv;
  vec2 world=texelWorld(uv);
  float dep=0.,berm=0.,comp=0.,ice=0.;
  // Scroll: a texel outside last frame's window just wrapped in from the far side and holds stale state.
  if(all(lessThanEqual(abs(world-prevCenter),vec2(size*.5)))){
    float t=1./res;
    vec4 c=texture2D(prevTex,uv);
    vec4 xl=texture2D(prevTex,uv-vec2(t,0.)),xr=texture2D(prevTex,uv+vec2(t,0.));
    vec4 zd=texture2D(prevTex,uv-vec2(0.,t)),zu=texture2D(prevTex,uv+vec2(0.,t));
    dep=c.r;berm=c.g;comp=c.b;ice=c.a;
    // Diffusion per second; loose berms slump three times faster than a packed trench floor.
    float k=clamp(refillRate*dt,0.,1.);
    dep+=((xl.r+xr.r+zd.r+zu.r)-4.*dep)*min(.22,.004*k);
    berm+=((xl.g+xr.g+zd.g+zu.g)-4.*berm)*min(.22,.012*k);
    // Wind infill from upwind, so a trail fills from one side like weather instead of blurring.
    vec2 wdir=vec2(sin(windAngle),cos(windAngle));
    vec4 uw=texture2D(prevTex,uv-wdir*(t*1.6));
    float kAdv=min(.2,.002*k);
    dep=mix(dep,uw.r,kAdv*.6);
    berm=mix(berm,uw.g,kAdv);
    // Piled mass falls back into the hole it came out of.
    float slump=min(berm,dep)*min(.6,.002*refillRate*dt);
    dep-=slump;berm-=slump;
    dep*=exp(-dt*refillRate/400.);
    berm*=exp(-dt*refillRate/250.);
    comp*=exp(-dt*refillRate/300.);
    ice*=exp(-dt*refillRate/900.);
  }
  int n=int(brushCount);
  for(int i=0;i<${MAX_BRUSHES};i++){
    if(i>=n)break;
    vec4 a=texelFetch(brushTex,ivec2(i,0),0);
    vec4 b=texelFetch(brushTex,ivec2(i,1),0);
    vec4 cc=texelFetch(brushTex,ivec2(i,2),0);
    float radius=a.z;
    if(radius<=0.)continue;
    vec2 p=world-a.xy;
    p-=size*floor(p/size+.5);
    float reach=radius*max(a.w,1.)*1.6;
    if(abs(p.x)>reach||abs(p.y)>reach)continue;
    vec2 q=vec2((p.x*b.x+p.y*b.y)/(radius*a.w),(-p.x*b.y+p.y*b.x)/radius);
    float d=length(q);
    if(d>1.55)continue;
    // Break the rim with angular noise and granulate the berm: a clean bevel is what reads as a decal.
    float ang=atan(q.y,q.x);
    float dn=d/(1.+cc.z*.22*sdNoise2(vec2(cos(ang),sin(ang))*2.7+cc.w));
    float core=1.-smoothstep(.42,1.,dn);
    float ringD=(dn-1.04)*3.4;
    float ring=exp(-ringD*ringD);
    float grain=.72+.56*(sdNoise2(q*7.5+cc.w*3.1)*.5+.5);
    dep+=b.z*core;
    berm+=b.w*ring*grain;
    comp+=cc.x*core;
    ice=max(ice,cc.y*core);
  }
  gl_FragColor=vec4(clamp(dep,0.,maxDepth),clamp(berm,0.,maxBerm),clamp(comp,0.,1.),clamp(ice,0.,1.));
}
`;

/** GLSL the snow surface uses to read the field. The uniforms are `SnowDeform.uniforms`. */
export const SNOW_DEFORM_READ = /* glsl */ `
uniform sampler2D snowDeformTex;
uniform vec2 snowDeformCenter;
uniform float snowDeformSize;
uniform float snowDeformRes;
${NOISE}
// Faded before the window edge so neither the moving edge nor the toroidal seam is ever visible.
float snowDeformFalloff(vec2 w){vec2 d=abs(w-snowDeformCenter)/(snowDeformSize*.5);return 1.-smoothstep(.80,.96,max(d.x,d.y));}
vec4 snowDeformAt(vec2 w){return texture2D(snowDeformTex,fract(w/snowDeformSize));}
float snowDeformHeight(vec2 w){vec4 s=snowDeformAt(w);return s.g-s.r;}
`;

export class SnowDeform {
  /** Window coverage in world units and texels across. */
  readonly size: number;
  res = 0;
  readonly maxDepth = 0.24;
  readonly maxBerm = 0.12;
  readonly uniforms = {
    snowDeformTex: { value: null as THREE.Texture | null },
    snowDeformCenter: { value: new THREE.Vector2(0, 0) },
    snowDeformSize: { value: 40 },
    snowDeformRes: { value: 1024 },
  };
  readonly stats = { stamps: 0, steps: 0 };
  /** False when the GPU cannot render to half-float targets; the surface then reads an empty field. */
  supported = true;
  private targets: THREE.WebGLRenderTarget[] = [];
  private read = 0;
  private readonly brushData = new Float32Array(MAX_BRUSHES * 3 * 4);
  private readonly brushTex = new THREE.DataTexture(this.brushData, MAX_BRUSHES, 3, THREE.RGBAFormat, THREE.FloatType);
  private count = 0;
  private readonly mat: THREE.ShaderMaterial;
  private readonly scene = new THREE.Scene();
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly center = new THREE.Vector2();
  private readonly prevCenter = new THREE.Vector2();
  private bank = 0;
  private primed = false;
  private readonly empty = new THREE.DataTexture(new Uint8Array(4), 1, 1);

  constructor(size = 40) {
    this.size = size;
    this.uniforms.snowDeformSize.value = size;
    this.empty.needsUpdate = true;
    this.uniforms.snowDeformTex.value = this.empty;
    this.brushTex.minFilter = this.brushTex.magFilter = THREE.NearestFilter;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: SIM_VERTEX,
      fragmentShader: SIM_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        prevTex: { value: null },
        brushTex: { value: this.brushTex },
        center: { value: this.center },
        prevCenter: { value: this.prevCenter },
        size: { value: size },
        res: { value: 1024 },
        dt: { value: 0 },
        brushCount: { value: 0 },
        refillRate: { value: 1 },
        maxDepth: { value: this.maxDepth },
        maxBerm: { value: this.maxBerm },
        // Infill comes from upwind of Frostlight's prevailing wind.
        windAngle: { value: Math.atan2(SNOW_WIND[0], SNOW_WIND[1]) },
      },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  /** Queue one brush for the next step. Brushes outside the window are dropped, never wrapped in. */
  brush(b: SnowBrush): void {
    if (this.count >= MAX_BRUSHES || !this.supported) return;
    const half = this.size * 0.45;
    if (Math.abs(b.x - this.center.x) > half || Math.abs(b.z - this.center.y) > half) return;
    const yaw = b.yaw ?? 0;
    // The long axis runs along the heading: three.js yaw 0 faces +Z, so the axis is (sin, cos).
    const ax = Math.sin(yaw), az = Math.cos(yaw);
    const i = this.count++, w = MAX_BRUSHES * 4, o = i * 4;
    this.brushData.set([b.x, b.z, b.radius, Math.max(1, b.elongation ?? 1)], o);
    this.brushData.set([ax, az, b.depth, b.berm], w + o);
    this.brushData.set([b.compression ?? 0.5, b.ice ?? 0, b.roughness ?? 0.6, b.seed ?? i * 1.618], w * 2 + o);
    this.stats.stamps++;
  }

  /** Recentre on (x, z), relax and splat this frame's brushes. */
  step(renderer: THREE.WebGLRenderer, dt: number, x: number, z: number, quality: 'high' | 'low' = 'high'): void {
    if (!this.supported) return;
    if (!this.targets.length && !this.create(renderer, quality === 'low' ? 512 : 1024)) return;
    const texel = this.size / this.res;
    this.center.set(Math.round(x / texel) * texel, Math.round(z / texel) * texel);
    // First step: pretend the window came from far away so every texel starts at zero.
    if (!this.primed) { this.prevCenter.set(this.center.x + this.size * 8, this.center.y); this.primed = true; }
    this.bank += Math.min(dt, 0.25);
    const relax = this.bank >= RELAX_STEP ? this.bank : 0;
    if (relax) this.bank = 0;
    const u = this.mat.uniforms;
    u.dt.value = relax;
    u.brushCount.value = this.count;
    u.prevTex.value = this.targets[this.read].texture;
    this.brushTex.needsUpdate = true;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.targets[1 - this.read]);
    renderer.render(this.scene, this.cam);
    renderer.setRenderTarget(prev);
    this.read = 1 - this.read;
    this.uniforms.snowDeformTex.value = this.targets[this.read].texture;
    this.uniforms.snowDeformCenter.value.copy(this.center);
    this.prevCenter.copy(this.center);
    this.brushData.fill(0, 0, this.count * 4);
    this.count = 0;
    this.stats.steps++;
  }

  /** The field under (x, z): [depression, berm, compression, ice]. For tests; reads back from the GPU. */
  sample(renderer: THREE.WebGLRenderer, x: number, z: number): number[] {
    if (!this.targets.length) return [0, 0, 0, 0];
    const fx = ((x / this.size) % 1 + 1) % 1, fz = ((z / this.size) % 1 + 1) % 1;
    const px = Math.min(this.res - 1, Math.floor(fx * this.res)), pz = Math.min(this.res - 1, Math.floor(fz * this.res));
    const out = new Uint16Array(4);
    renderer.readRenderTargetPixels(this.targets[this.read], px, pz, 1, 1, out);
    return Array.from(out, THREE.DataUtils.fromHalfFloat);
  }

  dispose(): void {
    for (const t of this.targets) t.dispose();
    this.targets = [];
    this.mat.dispose();
    this.brushTex.dispose();
    this.empty.dispose();
    (this.scene.children[0] as THREE.Mesh).geometry.dispose();
  }

  private create(renderer: THREE.WebGLRenderer, res: number): boolean {
    if (!renderer.extensions.has('EXT_color_buffer_float') && !renderer.extensions.has('EXT_color_buffer_half_float')) {
      this.supported = false;
      return false;
    }
    this.res = res;
    this.mat.uniforms.res.value = res;
    this.uniforms.snowDeformRes.value = res;
    for (let i = 0; i < 2; i++) {
      const t = new THREE.WebGLRenderTarget(res, res, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.RepeatWrapping,
        wrapT: THREE.RepeatWrapping,
        depthBuffer: false,
        generateMipmaps: false,
      });
      t.texture.name = `snow-deform-${i}`;
      this.targets.push(t);
    }
    return true;
  }
}
