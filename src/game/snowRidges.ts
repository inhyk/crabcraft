import * as THREE from 'three';
import type { SnowSky } from './snowSky';
import { SNOW_GROUND_GLSL } from './snowTerrain';

/*
 * The ranges around Frostlight's frozen sea: a ring of real relief 0.8 to 1.9 km out, so ridges occlude ridges
 * and faces turn toward and away from the low sun. After SNOWFLOW's far-field ridge (ridge.wgsl, MIT,
 * Copyright (c) 2026 Maksymilian Dendura; see NOTICE.md), but as geometry: an eroded ridged multifractal is baked
 * once on the GPU into a polar height map, a second pass derives the normal and marches the fixed sun across the
 * map for its shadow, and a polar mesh reads both. The normal comes from the map per pixel, so the faces carry
 * gullies and arêtes far finer than the mesh.
 *
 * Aerial perspective is integrated over the view ray through a haze that thins with height, toward the dome's
 * own colour in that direction (the sky LUT, its night grade and the haze band), so the feet of a range dissolve
 * into the ground haze, the back range goes pale and blue, and the near peaks keep their contrast.
 */

const R0 = 780, R1 = 1900;
/** Polar map: angle across, radius (warped toward the near edge) down. ~1.5 m by ~3 m texels at 1 km. */
const MAP_W = 4096, MAP_H = 320;
/** Mesh: vertices around and out. */
const NA = 1280, NR = 96;
const WARP = 1.35;

const POLAR = /* glsl */ `
const float RG_R0=${R0.toFixed(1)},RG_R1=${R1.toFixed(1)},RG_WARP=${WARP.toFixed(3)};
vec2 rgWorld(vec2 uv){float a=uv.x*6.2831853,r=RG_R0+(RG_R1-RG_R0)*pow(uv.y,RG_WARP);return vec2(cos(a),sin(a))*r;}
vec2 rgUV(vec2 p){float a=atan(p.y,p.x)/6.2831853;return vec2(fract(a),pow(clamp((length(p)-RG_R0)/(RG_R1-RG_R0),0.,1.),1./RG_WARP));}
`;

const HEIGHT_BAKE = /* glsl */ `
${SNOW_GROUND_GLSL}
${POLAR}
uniform vec2 size;
// Height of the ranges, metres: massifs and saddles around the ring, eroded ridged crests, a lower front range.
float rgHeight(vec2 p){
  float r=length(p);vec2 dir=p/r;
  float m=sgNoised(dir*1.9+vec2(4.1,-2.3)).x+.55*sgNoised(dir*4.6+vec2(-1.7,6.1)).x;
  float massif=smoothstep(-.4,.5,m);
  // Ridged multifractal; each octave is damped by the slope gathered so far, so valleys stay smooth and the
  // detail climbs the crests, which is what erosion leaves.
  vec2 q=p/620.;float h=0.,amp=.5,w=1.;vec2 d=vec2(0.);
  const mat2 ROT=mat2(.8,-.6,.6,.8);
  for(int i=0;i<9;i++){
    vec3 n=sgNoised(q);
    float rg=max(0.,1.-abs(n.x)*1.55);rg*=rg;
    d+=n.yz*amp*(1.-abs(n.x));
    h+=amp*rg*w/(1.+dot(d,d)*.9);
    w=clamp(rg*1.4,.25,1.);
    q=ROT*q*2.04+vec2(1.7,9.2);amp*=.49;
  }
  float back=smoothstep(RG_R0+110.,1180.,r)*(1.-smoothstep(1700.,RG_R1,r)*.45);
  float front=smoothstep(RG_R0,RG_R0+110.,r)*(1.-smoothstep(940.,1120.,r));
  float tall=back*(.18+.82*massif)*h*560.;
  float low=front*(.45+.55*(sgNoised(dir*7.+vec2(9.1,0.)).x*.5+.5))*h*150.;
  return max(tall,low)-6.;
}
void main(){gl_FragColor=vec4(rgHeight(rgWorld(gl_FragCoord.xy/size)),0.,0.,1.);}
`;

const SHADE_BAKE = /* glsl */ `
${POLAR}
uniform sampler2D heights;
uniform vec2 size;
uniform vec3 sunDir;
float H(vec2 p){return texture2D(heights,rgUV(p)).r;}
void main(){
  vec2 uv=gl_FragCoord.xy/size,p=rgWorld(uv);
  float h=texture2D(heights,uv).r,e=2.5;
  vec3 n=normalize(vec3(H(p-vec2(e,0.))-H(p+vec2(e,0.)),2.*e,H(p-vec2(0.,e))-H(p+vec2(0.,e))));
  // The sun is fixed, so its shadow is baked: march toward it and keep the steepest blocker, softened.
  vec2 s=normalize(sunDir.xz);float rise=sunDir.y/length(sunDir.xz),worst=1.;
  for(float t=12.;t<900.;t*=1.12){worst=min(worst,(h+rise*t-H(p+s*t))/t);}
  gl_FragColor=vec4(h,n.x,n.z,smoothstep(-.025,.035,worst));
}
`;

const RIDGE_VERTEX = /* glsl */ `
uniform sampler2D ridgeMap;
varying vec3 vWorld;
varying vec2 vUv;
void main(){
  vUv=uv;
  vec3 p=position;p.y=textureLod(ridgeMap,uv,0.).r;
  vec4 w=modelMatrix*vec4(p,1.);
  vWorld=w.xyz;
  gl_Position=projectionMatrix*viewMatrix*w;
}
`;

const RIDGE_FRAGMENT = /* glsl */ `
uniform sampler2D skyLUT;
uniform sampler2D ridgeMap;
uniform vec3 sunDir;
uniform float night;
uniform vec3 hazeColor;
uniform vec3 sunLight;
uniform vec3 hemiSky;
uniform vec3 hemiGround;
uniform float hazeHigh;
uniform float hazeLow;
uniform float hazeScale;
uniform vec3 sunColor;
uniform float sunScale;
uniform float exposure;
varying vec3 vWorld;
varying vec2 vUv;
#include <common>
vec2 rgHash(vec2 p){vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));p3+=dot(p3,p3.yzx+33.33);return fract((p3.xx+p3.yz)*p3.zy);}
float rgNoise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
  float a=dot(rgHash(i)*2.-1.,f),b=dot(rgHash(i+vec2(1.,0.))*2.-1.,f-vec2(1.,0.));
  float c=dot(rgHash(i+vec2(0.,1.))*2.-1.,f-vec2(0.,1.)),d=dot(rgHash(i+vec2(1.))*2.-1.,f-vec2(1.));
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y)*1.4;}
// The dome's colour looking along d, the same lookup and grade the sky shader runs, without disc, cloud or stars.
vec3 skyAlong(vec3 d){
  vec2 h=d.xz;float l=length(h);vec2 s=normalize(sunDir.xz);
  float u=acos(clamp(l>1e-5?dot(h/l,s):1.,-1.,1.))/PI;
  float e=asin(clamp(d.y,-1.,1.))/PI_HALF;
  float v=.5+.5*sign(e)*sqrt(abs(e));
  vec3 col=texture2D(skyLUT,vec2(u,v)*(1.-1./vec2(64.,96.))+.5/vec2(64.,96.)).rgb;
  col*=mix(vec3(1.),vec3(.25,.38,.65),night);
  return mix(col,hazeColor,1.-smoothstep(-.01,.05,d.y));
}
void main(){
  vec3 V=vWorld-cameraPosition;float dist=length(V);vec3 d=V/dist;
  vec4 m=texture2D(ridgeMap,vUv);
  vec3 N=vec3(m.y,sqrt(max(0.,1.-m.y*m.y-m.z*m.z)),m.z);
  // Couloirs and ribs below the map's resolution, running down the fall line.
  vec2 fall=normalize(N.xz+1e-4);
  vec2 q=vec2(dot(vWorld.xz,vec2(-fall.y,fall.x))*.09,dot(vWorld.xz,fall)*.018);
  float rib=rgNoise(q)+.5*rgNoise(q*2.3+3.1);
  N=normalize(N+vec3(-fall.y,0.,fall.x)*rib*.22*(1.-N.y));
  // Snow holds where the slope lets it; the snow line wanders with the rock underneath, and wind strips the crests.
  float wander=rgNoise(vWorld.xz*.0045)*.1+rgNoise(vWorld.xz*.021)*.06+rib*.05;
  float snow=smoothstep(.6,.72,N.y+wander-smoothstep(260.,420.,vWorld.y)*.06);
  vec3 rock=mix(vec3(.035,.038,.046),vec3(.09,.09,.095),rgNoise(vec2(vWorld.y*.03,dot(vWorld.xz,vec2(.004))))*.5+.5);
  vec3 alb=mix(rock,vec3(.8,.86,.95),snow);
  float nl=dot(N,sunDir),w=mix(.08,.4,snow);
  float lit=clamp((nl+w)/(1.+w),0.,1.)*m.w;
  vec3 col=alb*RECIPROCAL_PI*(sunLight*lit+mix(hemiGround,hemiSky,N.y*.5+.5)*mix(.75,1.,snow));
  // Haze: thin aloft, thick near the ground, integrated along the ray.
  float y0=cameraPosition.y,y1=vWorld.y,H=hazeScale,dy=y1-y0;
  float low=abs(dy)>1.?H/dy*(exp(-max(y0,0.)/H)-exp(-max(y1,0.)/H)):exp(-max(y0,0.)/H);
  // The lowest few tens of metres sit inside the ground haze the fogged sea ice already dissolves into.
  float T=exp(-dist*(hazeHigh+hazeLow*low))*smoothstep(-4.,45.,y1);
  // The aureole the dome adds round the sun is forward scatter in this same haze: the air in front of a range
  // carries most of it, so the glow wraps the silhouette instead of stopping at it.
  float mu=max(0.,dot(d,sunDir));
  vec3 glow=sunColor*sunScale*(pow(mu,1400.)*5.5+pow(mu,64.)*.28)*.5*exposure*(1.-night);
  gl_FragColor=vec4(col*T+skyAlong(d)*(1.-T)+glow*(1.-T*T),1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function bakePass(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, mat: THREE.ShaderMaterial): void {
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene().add(quad), prev = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
  renderer.setRenderTarget(prev);
  quad.geometry.dispose();
  mat.dispose();
}

/** The far ranges. Bake once with prepare() before the first frame they draw; until then they stay hidden. */
export class SnowRidges {
  readonly mesh: THREE.Mesh;
  private readonly map: THREE.WebGLRenderTarget;
  private baked = false;
  constructor(private readonly sky: SnowSky) {
    const cols = NA + 1, count = cols * NR;
    const pos = new Float32Array(count * 3), uvs = new Float32Array(count * 2);
    for (let j = 0; j < NR; j++) for (let i = 0; i < cols; i++) {
      const u = i / NA, v = j / (NR - 1), a = u * Math.PI * 2, r = R0 + (R1 - R0) * Math.pow(v, WARP), k = j * cols + i;
      pos.set([Math.cos(a) * r, 0, Math.sin(a) * r], k * 3);
      uvs.set([u, v], k * 2);
    }
    const idx = new Uint32Array((NR - 1) * NA * 6);
    let o = 0;
    for (let j = 0; j < NR - 1; j++) for (let i = 0; i < NA; i++) {
      const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      idx.set([a, b, c, b, d, c], o);
      o += 6;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R1 + 600);
    this.map = new THREE.WebGLRenderTarget(MAP_W, MAP_H, {
      type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping,
    });
    this.map.texture.name = 'frostlight-ridge-map';
    const su = sky.material.uniforms;
    const mat = new THREE.ShaderMaterial({
      name: 'frostlight-ridges',
      vertexShader: RIDGE_VERTEX,
      fragmentShader: RIDGE_FRAGMENT,
      uniforms: {
        ridgeMap: { value: this.map.texture },
        skyLUT: su.skyLUT, sunDir: su.sunDir, night: su.night, hazeColor: su.hazeColor,
        sunColor: su.sunColor, sunScale: su.sunScale, exposure: su.exposure,
        sunLight: { value: sky.sunLight }, hemiSky: { value: sky.hemiSky }, hemiGround: { value: sky.hemiGround },
        hazeHigh: { value: 0.00034 }, hazeLow: { value: 0.0024 }, hazeScale: { value: 70 },
      },
    });
    mat.addEventListener('dispose', () => this.map.dispose());
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.name = 'frostlight-far-ridges';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.userData.vertices = count;
  }

  prepare(renderer: THREE.WebGLRenderer): void {
    if (this.baked) return;
    this.baked = true;
    const opts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping } as const;
    const raw = new THREE.WebGLRenderTarget(MAP_W, MAP_H, opts);
    const size = { value: new THREE.Vector2(MAP_W, MAP_H) }, vertexShader = 'void main(){gl_Position=vec4(position.xy,0.,1.);}';
    bakePass(renderer, raw, new THREE.ShaderMaterial({ uniforms: { size }, vertexShader, fragmentShader: HEIGHT_BAKE }));
    bakePass(renderer, this.map, new THREE.ShaderMaterial({ uniforms: { size, heights: { value: raw.texture }, sunDir: { value: this.sky.sunDir } }, vertexShader, fragmentShader: SHADE_BAKE }));
    raw.dispose();
    this.mesh.visible = true;
  }
}
