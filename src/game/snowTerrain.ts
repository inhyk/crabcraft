import * as THREE from 'three';
import { SNOW_DEFORM_READ, type SnowDeform } from './snowDeform';
import { SNOW_ROCKS, SNOW_SEA_ICE, SNOW_WIND } from '../sim/world/snowGround';
import { FROST_PADS, FROST_ROAD_BOX, FROST_ROAD_SHOULDER, FROST_ROAD_WAYS, FROST_WAYS, type FrostWay } from '../sim/world/snowLayout';
import { addPatch } from '../world/materials';

/*
 * Frostlight's snowfield as a nested-ring geometry clipmap. A port of SNOWFLOW's clipmap.wgsl, snow.vertex.wgsl,
 * terrain.wgsl, heightBake.fragment.wgsl and deform.wgsl (MIT, Copyright (c) 2026 Maksymilian Dendura; see
 * NOTICE.md) to WebGL2.
 *
 * The gameplay ground (SNOW_GROUND_GLSL, the GLSL twin of src/sim/world/snowGround.ts) is baked once into a
 * half-float texture: height, slope by central difference, and the sea mask. Every vertex and every pixel reads
 * that texture, so the macro normal is per pixel and the vertex shader runs no landform noise.
 *
 * One static index buffer, one draw. Vertices carry only (grid i, ring level, grid j); the vertex shader places
 * them around the player, morphs each ring onto the next coarser lattice across its outer band (CDLOD), and
 * displaces them by the baked ground, the visual-only sastrugi, and the footprint field band-limited to the
 * ring's spacing. The shadow pass runs the same placement without the sastrugi.
 */

const r3 = (v: number) => v.toFixed(3);
/** A way list as GLSL segments (ax, az, bx, bz) and one radius each, from the half width plus `pad`. */
const segsGlsl = (name: string, ways: readonly FrostWay[], pad: number) => {
  const seg: string[] = [], rad: string[] = [];
  for (const w of ways) for (let k = 1; k < w.points.length; k++) { const a = w.points[k - 1], b = w.points[k]; seg.push(`vec4(${r3(a[0])},${r3(a[1])},${r3(b[0])},${r3(b[1])})`); rad.push(r3(w.width / 2 + pad)); }
  return `const int ${name}_N=${seg.length};\nconst vec4 ${name}[${seg.length}]=vec4[${seg.length}](${seg.join(',')});\nconst float ${name}_R[${seg.length}]=float[${seg.length}](${rad.join(',')});`;
};
/** The paved ways' box, grown by `m`: past it a pixel is at least `m` from every stone. */
const pavedBox = (m: number) => {
  const pts = [...FROST_WAYS.flatMap((w) => w.points), ...FROST_PADS.flatMap((p): [number, number][] => [[p.x - p.r, p.z - p.r], [p.x + p.r, p.z + p.r]])];
  return `vec4(${r3(Math.min(...pts.map((p) => p[0])) - m)},${r3(Math.min(...pts.map((p) => p[1])) - m)},${r3(Math.max(...pts.map((p) => p[0])) + m)},${r3(Math.max(...pts.map((p) => p[1])) + m)})`;
};
/** GLSL twin of snowGround.ts, height only. Keep the two in step: QA compares them on the GPU. */
export const SNOW_GROUND_GLSL = /* glsl */ `
const vec2 SG_WIND=vec2(${SNOW_WIND[0].toFixed(4)},${SNOW_WIND[1].toFixed(4)});
const float SG_SEA=${SNOW_SEA_ICE.toFixed(4)};
const vec4 SG_ROCKS[${SNOW_ROCKS.length}]=vec4[${SNOW_ROCKS.length}](${SNOW_ROCKS.map((k) => `vec4(${r3(k.x)},${r3(k.z)},${r3(k.r)},${r3(k.h)})`).join(',')});
const float SG_GX[16]=float[16](1.,.92388,.70711,.38268,0.,-.38268,-.70711,-.92388,-1.,-.92388,-.70711,-.38268,0.,.38268,.70711,.92388);
const float SG_GZ[16]=float[16](0.,.38268,.70711,.92388,1.,.92388,.70711,.38268,0.,-.38268,-.70711,-.92388,-1.,-.92388,-.70711,-.38268);
int sgGrad(ivec2 i){
  uint h=uint(i.x)*0x27d4eb2du^uint(i.y)*0x165667b1u;
  h=(h^(h>>15u))*0x2c1b3c6du;
  h=(h^(h>>12u))*0x297a2d39u;
  h^=h>>15u;
  return int(h>>28u);
}
// Quintic gradient noise: (value, d/dx, d/dz).
vec3 sgNoised(vec2 p){
  vec2 i=floor(p),f=p-i;
  vec2 u=f*f*f*(f*(f*6.-15.)+10.),du=30.*f*f*(f*(f-2.)+1.);
  ivec2 ii=ivec2(i);
  int a=sgGrad(ii),b=sgGrad(ii+ivec2(1,0)),c=sgGrad(ii+ivec2(0,1)),d=sgGrad(ii+ivec2(1,1));
  vec2 ga=vec2(SG_GX[a],SG_GZ[a]),gb=vec2(SG_GX[b],SG_GZ[b]),gc=vec2(SG_GX[c],SG_GZ[c]),gd=vec2(SG_GX[d],SG_GZ[d]);
  float va=dot(ga,f),vb=dot(gb,f-vec2(1.,0.)),vc=dot(gc,f-vec2(0.,1.)),vd=dot(gd,f-vec2(1.));
  float k1=vb-va,k2=vc-va,k3=va-vb-vc+vd;
  return vec3(va+k1*u.x+k2*u.y+k3*u.x*u.y,
    ga+u.x*(gb-ga)+u.y*(gc-ga)+u.x*u.y*(ga-gb-gc+gd)+du*(u.yx*k3+vec2(k1,k2)));
}
float sg01(float t){t=clamp(t,0.,1.);return t*t*(3.-2.*t);}
// Derivative-damped fBm in noise units; the slope is carried back through the per-octave rotation.
float sgFbm(vec2 q,int octaves,float gain,float damp){
  const float C=.869305913,S=.494274448;
  float sum=0.,amp=.5,freq=1.;vec2 d=vec2(0.);
  mat2 r=mat2(1.);vec2 p=q;
  for(int i=0;i<4;i++){
    if(i>=octaves)break;
    vec3 n=sgNoised(p*freq);
    float w=1./(1.+damp*dot(d,d));
    sum+=amp*w*n.x;
    d+=amp*w*freq*vec2(n.y*r[0][0]+n.z*r[1][0],n.y*r[0][1]+n.z*r[1][1]);
    amp*=gain;freq*=2.03;
    p=vec2(C*p.x-S*p.y,S*p.x+C*p.y);
    r=mat2(C*r[0][0]-S*r[1][0],C*r[0][1]-S*r[1][1],S*r[0][0]+C*r[1][0],S*r[0][1]+C*r[1][1]);
  }
  return sum;
}
// The roads out of the village (snowLayout.ts): segments, each with its half width plus the shoulder.
${segsGlsl('SG_ROAD', FROST_ROAD_WAYS, FROST_ROAD_SHOULDER)}
const vec4 SG_ROAD_BOX=vec4(${FROST_ROAD_BOX.map(r3).join(',')});
float sgSegDist(vec2 p,vec4 s){vec2 d=s.zw-s.xy,q=p-s.xy;float l2=dot(d,d),t=l2>0.?clamp(dot(q,d)/l2,0.,1.):0.;return length(q-d*t);}
// snowLayout.ts frostRoadKeepDist: distance past the roads' shoulder, 1000 well beyond.
float sgRoadKeep(vec2 p){
  if(p.x<SG_ROAD_BOX.x||p.y<SG_ROAD_BOX.y||p.x>SG_ROAD_BOX.z||p.y>SG_ROAD_BOX.w)return 1e3;
  float d=1e3;
  for(int i=0;i<SG_ROAD_N;i++)d=min(d,sgSegDist(p,SG_ROAD[i])-SG_ROAD_R[i]);
  return d;
}
// 0 on the village, road and arena, 1 in the field.
float snowKeep(vec2 p){
  float road=sgRoadKeep(p);
  float qx=abs(p.x)-45.,qz=abs(p.y-60.5)-35.5;
  float village=length(max(vec2(qx,qz),0.))+min(max(qx,qz),0.);
  float arena=length(vec2(p.x,p.y+78.))-34.;
  return sg01(road/12.)*sg01(village/12.)*sg01(arena/12.);
}
float snowRelief(vec2 p){
  float a=dot(p,SG_WIND),c=-p.x*SG_WIND.y+p.y*SG_WIND.x;
  float broad=sgFbm(vec2(a*(1./46.)+3.1,c*(1./105.)-7.7),3,.5,.9);
  float h=broad*13.;
  float shelter=clamp(.55-broad*1.1,.2,1.);
  h+=sgFbm(vec2(a*(1./9.)+broad*2.4+11.3,c*(1./24.)+4.1),2,.45,1.6)*2.6*shelter;
  vec2 la=vec2(a*(1./7.)+2.7,c*(1./19.)-5.2);
  float r0=1.-abs(sgNoised(la).x);
  float r1=1.-abs(sgNoised(vec2(la.x+.3*r0*r0,la.y)).x),lip=r1*r1*(3.-2.*r1);
  float patchy=sg01((sgNoised(vec2(a*(1./55.)+1.3,c*(1./80.)-2.1)).x+.15)/.5);
  return h+(lip-.45)*1.6*patchy;
}
float snowRockDrift(vec2 p){
  float h=0.;
  for(int i=0;i<${SNOW_ROCKS.length};i++){
    vec4 k=SG_ROCKS[i];vec2 d=p-k.xy;
    if(abs(d.x)>k.z*6.||abs(d.y)>k.z*6.)continue;
    float a=dot(d,SG_WIND)/k.z,c=(-d.x*SG_WIND.y+d.y*SG_WIND.x)/k.z,d2=a*a+c*c;
    h+=exp(-d2*1.1)*.22*k.w;
    if(a>0.){float rise=1.-exp(-a*2.2);h+=rise*rise*exp(-a/2.6)*exp(-c*c*1.6)*.36*k.w;}
    else{float m=sqrt(d2)-1.15;h-=exp(-m*m*9.)*sg01(-a*2.)*.05*k.w;}
  }
  return h;
}
// How far the coast has fallen to sea ice here, 0 on land, 1 on the frozen sea.
float snowSea(vec2 p){
  float edge=length(vec2(p.x/128.,(p.y-2.)/155.));
  float start=.83+.035*(sgNoised(vec2(p.x*.021+17.1,p.y*.021-3.3)).x*.7+.5);
  return edge<=start?0.:sg01(min(1.,(edge-start)/.075));
}
float snowGroundH(vec2 p){
  float x=p.x,z=p.y;
  float plateau=5.+14.*smoothstep(5.,55.,-z);
  float hills=sin(x*.052)*sin(z*.037)*2.5*(1.-exp(-x*x/600.));
  float t=smoothstep(22.,32.,length(vec2(x,z+78.)));
  float keep=snowKeep(p);
  float h=(1.-t)*19.+t*(plateau+hills*(1.-keep));
  if(keep>0.)h+=keep*(snowRelief(p)+snowRockDrift(p));
  return h+(SG_SEA-h)*snowSea(p);
}
`;

/**
 * Visual relief under a decimetre: SNOWFLOW's sastrugi (ridged, streaking along a locally veering wind) and wind
 * ripples, plus pressure ridges on the sea ice. Bounded to about +-5 cm on land so feet still meet the ground.
 * `fp` is the world size of a pixel or a vertex spacing; each layer fades as it drops below it.
 */
export const SNOW_FINE_GLSL = /* glsl */ `
mat2 sgWindMat(float ang,float sx,float sy,float scale){float c=cos(ang),s=sin(ang);return mat2(sx/scale*c,sy/scale*-s,sx/scale*s,sy/scale*c);}
// Ridged noise, (value, d/dx, d/dz): hard scalloped crests, soft troughs.
vec3 sgRidged(vec2 p0){
  const float C=.753780497,S=.657126291;
  vec2 p=p0;float sum=0.,amp=.5,freq=1.,prev=1.;vec2 d=vec2(0.);mat2 r=mat2(1.);
  for(int i=0;i<3;i++){
    vec3 n=sgNoised(p*freq);
    float s=sign(n.x),a=1.-abs(n.x),a2=a*a;
    sum+=amp*a2*prev;
    d+=amp*prev*freq*(-2.*a*s)*vec2(n.y*r[0][0]+n.z*r[1][0],n.y*r[0][1]+n.z*r[1][1]);
    prev=mix(1.,a2,.65);
    amp*=.52;freq*=2.11;
    p=vec2(C*p.x-S*p.y,S*p.x+C*p.y);
    r=mat2(C*r[0][0]-S*r[1][0],C*r[0][1]-S*r[1][1],S*r[0][0]+C*r[1][0],S*r[0][1]+C*r[1][1]);
  }
  return vec3(sum,d);
}
// The wind's slow fields, tens of metres across, so the vertex shader evaluates them and the pixels interpolate:
// (local veer of the wind, how far the sastrugi stretch along it, where the wind scoured them, where ripples lie).
vec4 snowWindField(vec2 p){
  return vec4(sgNoised(p*.0083+vec2(31.7,12.3)).x*.42,2.3+2.4*(sgNoised(p*.0126+vec2(7.1,41.9)).x*.5+.5),
    smoothstep(-.32,.42,sgNoised(p*.021+vec2(3.3,-8.1)).x),smoothstep(.05,.45,sgNoised(p*.047+vec2(-6.2,1.7)).x));
}
// (height, d/dx, d/dz). amp scales the land layers, sea the pressure ridges. micro adds the ripples and grain,
// which live only in the shading normal: a shadow map cannot resolve them and the vertex lattice barely can.
vec3 snowFine(vec2 p,float fp,float amp,float sea,float micro,vec4 wf){
  vec3 o=vec3(0.);
  float wind=atan(SG_WIND.y,SG_WIND.x);
  float fs=1.-smoothstep(.35,1.6,fp);
  if(fs>.001&&amp>.001){
    // Sastrugi streak along the wind: the ridged field is compressed across it. Fields of them where the wind
    // scoured, smooth fresh drift between.
    mat2 m=sgWindMat(wind+wf.x,1.,wf.y,2.3);
    vec3 r=sgRidged(m*p);
    float a=.075*amp*wf.z*fs;
    o.x+=(r.x-.35)*a;o.yz+=(r.yz*m)*a;
    float fr=1.-smoothstep(.04,.22,fp);
    #ifdef SNOW_LOW
    fr=0.;
    #endif
    if(micro>0.&&fr>.001&&wf.w>.001){
      // Wind ripples, crests across the wind, only in patches of packed snow.
      mat2 m2=sgWindMat(wind+wf.x*.5,2.9,1.,.42);
      vec3 n=sgNoised(m2*p);
      float a2=.0045*amp*fr*wf.w;
      o.x+=n.x*a2;o.yz+=(n.yz*m2)*a2;
    }
  }
  float fg=1.-smoothstep(.015,.06,fp);
  if(micro>0.&&fg>.001){
    mat2 m=sgWindMat(wind,1.,1.,.115);
    vec3 n=sgNoised(m*p);
    float a=.0012*max(amp,.4)*fg;
    o.x+=n.x*a;o.yz+=(n.yz*m)*a;
  }
  float fsea=1.-smoothstep(1.5,7.,fp);
  if(sea>.001&&fsea>.001){
    // Pressure ridges where floes met, snow drifted between them.
    mat2 m=sgWindMat(wind+1.2,1.,3.2,38.);
    vec3 r=sgRidged(m*p);
    float a=.55*sea*fsea;
    float rr=r.x*r.x;
    o.x+=rr*a;o.yz+=(2.*r.x*r.yz*m)*a;
  }
  return o;
}
`;

/** Reading the baked ground: (height, dh/dx, dh/dz, sea). Off the baked square the island is frozen sea. */
const SNOW_GROUND_READ = /* glsl */ `
uniform sampler2D snowGroundTex;
uniform vec4 snowGroundRect;
vec2 snowGroundUV(vec2 p){return (p-snowGroundRect.xy)*snowGroundRect.z;}
bool snowGroundIn(vec2 uv){return all(greaterThanEqual(uv,vec2(0.)))&&all(lessThanEqual(uv,vec2(1.)));}
vec4 snowGroundAt(vec2 p){vec2 uv=snowGroundUV(p);return snowGroundIn(uv)?textureLod(snowGroundTex,uv,0.):vec4(SG_SEA,0.,0.,1.);}
// Visual fine relief fades to nothing on paving, the squares, the fountain and the arena floor.
${segsGlsl('SG_PAVE', FROST_WAYS, 1.6)}
const vec3 SG_PADS[${FROST_PADS.length}]=vec3[${FROST_PADS.length}](${FROST_PADS.map((p) => `vec3(${r3(p.x)},${r3(p.z)},${r3(p.r + 1.6)})`).join(',')});
const vec4 SG_PAVE_BOX=${pavedBox(5)};
float snowFineKeep(vec2 p){
  float paved=1e3;
  if(p.x>SG_PAVE_BOX.x&&p.y>SG_PAVE_BOX.y&&p.x<SG_PAVE_BOX.z&&p.y<SG_PAVE_BOX.w){
    for(int i=0;i<SG_PAVE_N;i++)paved=min(paved,sgSegDist(p,SG_PAVE[i])-SG_PAVE_R[i]);
    for(int i=0;i<${FROST_PADS.length};i++)paved=min(paved,length(p-SG_PADS[i].xy)-SG_PADS[i].z);
  }
  float arena=length(p-vec2(0.,-78.))-23.5;
  float fountain=length(p-vec2(-13.,65.))-4.;
  float qx=abs(p.x)-44.,qz=abs(p.y-60.5)-34.5;
  float village=length(max(vec2(qx,qz),0.))+min(max(qx,qz),0.);
  return smoothstep(0.,3.,paved)*smoothstep(0.,4.,arena)*smoothstep(0.,2.,fountain)*mix(.35,1.,smoothstep(0.,8.,village));
}
`;

/** Everything the snow fragment shader reads: the footprint field, the baked ground and the fine layers. */
export const SNOW_SURFACE_GLSL = `${SNOW_DEFORM_READ}\n${SNOW_GROUND_GLSL}\n${SNOW_FINE_GLSL}\n${SNOW_GROUND_READ}`;

/** Clipmap placement and displacement, shared by the beauty and shadow passes. */
export const SNOW_PLACE_GLSL = /* glsl */ `
uniform vec2 snowLodCenter;
uniform float snowBaseSpacing;
uniform float snowGridHalf;
uniform float snowDeformScale;
${SNOW_SURFACE_GLSL}
// Footprint field height band-limited to what a lattice of spacing s can carry (SNOWFLOW's deformHeight).
float snowDeformBand(vec2 w,float s){
  float fall=snowDeformFalloff(w);
  if(fall<=0.)return 0.;
  vec2 base=fract(w/snowDeformSize);float r=s/snowDeformSize;float acc=0.;
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
    float wt=float((2-abs(i))*(2-abs(j)))*(1./16.);
    vec4 t=textureLod(snowDeformTex,base+vec2(float(i),float(j))*r,0.);
    acc+=(t.g-t.r)*wt;
  }
  return acc*fall*snowDeformScale;
}
struct SnowVertex{vec3 world;vec2 grad;float spacing;float keep;float sea;float fineKeep;vec4 wind;};
SnowVertex snowPlace(vec3 grid,bool fine){
  float level=grid.y;
  float spacing=snowBaseSpacing*exp2(level);
  vec2 origin=floor(snowLodCenter/(2.*spacing))*2.*spacing;
  vec2 local=grid.xz*spacing;
  // Morph by the continuous distance to the player, not to the snapped origin, so a ring step never pops.
  vec2 rel=origin+local-snowLodCenter;
  float cheb=max(abs(rel.x),abs(rel.y))/(snowGridHalf*spacing);
  float morph=clamp((cheb-.70)/.16,0.,1.);
  local=mix(local,floor(grid.xz*.5)*2.*spacing,morph);
  vec2 xz=origin+local;
  SnowVertex v;
  v.spacing=spacing*(1.+morph);
  vec4 g=snowGroundAt(xz);
  float h=g.x;
  v.grad=g.yz;v.sea=g.w;v.keep=snowKeep(xz);
  v.fineKeep=snowFineKeep(xz)*(1.-g.w)*(1.-smoothstep(.55,1.1,length(g.yz)));
  // Sastrugi only where the ring can carry it, and never in the shadow map, which cannot resolve them.
  v.wind=snowWindField(xz);
  h+=snowFine(xz,v.spacing*2.4,fine?v.fineKeep:0.,g.w,0.,v.wind).x;
  if(v.spacing<1.){h+=snowDeformBand(xz,v.spacing)*(1.-smoothstep(.5,1.,v.spacing));}
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

/** Ring layouts. High: 8 cm inner spacing, ~655 m reach. Low: 16 cm, same reach, a quarter of the vertices. */
const LAYOUTS = { high: { half: 64, levels: 8, spacing: 0.08 }, low: { half: 32, levels: 8, spacing: 0.16 } } as const;
/** The baked square: the whole island and its shore, 320 m; 15.6 cm texels on high, 31 cm on low. */
const GROUND_MIN_X = -160, GROUND_MIN_Z = -158, GROUND_SIZE = 320;

const BAKE_FRAGMENT = /* glsl */ `
uniform vec4 rect;
${SNOW_GROUND_GLSL}
void main(){
  vec2 p=rect.xy+gl_FragCoord.xy*rect.w;
  float e=rect.w*.5;
  float hx=snowGroundH(p+vec2(e,0.))-snowGroundH(p-vec2(e,0.));
  float hz=snowGroundH(p+vec2(0.,e))-snowGroundH(p-vec2(0.,e));
  gl_FragColor=vec4(snowGroundH(p),hx/(2.*e),hz/(2.*e),snowSea(p));
}
`;

export class SnowTerrain {
  readonly mesh: THREE.Mesh;
  readonly uniforms = {
    snowLodCenter: { value: new THREE.Vector2(0, 82) },
    snowBaseSpacing: { value: LAYOUTS.high.spacing as number },
    snowGridHalf: { value: LAYOUTS.high.half as number },
    snowDeformScale: { value: 1 },
    snowGroundTex: { value: null as THREE.Texture | null },
    snowGroundRect: { value: new THREE.Vector4(GROUND_MIN_X, GROUND_MIN_Z, 1 / GROUND_SIZE, 0) },
  };
  quality: 'high' | 'low' = 'high';
  private readonly geometries: Partial<Record<'high' | 'low', THREE.BufferGeometry>> = {};
  private baked: THREE.WebGLRenderTarget | null = null;
  private bakedRes = 0;

  constructor(private readonly material: THREE.MeshStandardMaterial, deform: SnowDeform) {
    const u = { ...deform.uniforms, ...this.uniforms };
    addPatch(material, 'frostlight-clipmap', (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${SNOW_PLACE_GLSL}\nvarying vec3 vSnowWorld;\nvarying vec4 vSnowInfo;\nvarying vec4 vSnowWind;`)
        .replace('#include <beginnormal_vertex>', /* glsl */ `
          SnowVertex sv=snowPlace(position,true);
          vec3 objectNormal=normalize(vec3(-sv.grad.x,1.,-sv.grad.y));
          vSnowWorld=sv.world;vSnowInfo=vec4(sv.spacing,sv.keep,sv.fineKeep,sv.sea);vSnowWind=sv.wind;`)
        .replace('#include <begin_vertex>', 'vec3 transformed=sv.world;');
    });
    // The shadow map has to see the surface the beauty pass draws, carved prints included.
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${SNOW_PLACE_GLSL}`)
        .replace('#include <begin_vertex>', 'SnowVertex sv=snowPlace(position,false);\nvec3 transformed=sv.world;');
    };
    depth.customProgramCacheKey = () => 'frostlight-clipmap-depth';
    this.mesh = new THREE.Mesh(this.geometry('high'), material);
    this.mesh.name = 'frostlight-snow-clipmap';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.customDepthMaterial = depth;
    // Nothing to draw until the ground is baked (prepare()).
    this.mesh.visible = false;
    this.mesh.userData.layout = LAYOUTS.high;
  }

  private geometry(q: 'high' | 'low'): THREE.BufferGeometry {
    const l = LAYOUTS[q];
    return (this.geometries[q] ??= buildClipmap(l.half, l.levels));
  }

  /** Bake the ground once (again if the quality changes its resolution). Call before the first frame draws. */
  prepare(renderer: THREE.WebGLRenderer): void {
    const res = this.quality === 'high' ? 2048 : 1024;
    if (this.baked && this.bakedRes === res) return;
    this.baked?.dispose();
    const target = new THREE.WebGLRenderTarget(res, res, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    });
    target.texture.name = 'frostlight-ground';
    const mat = new THREE.ShaderMaterial({
      uniforms: { rect: { value: new THREE.Vector4(GROUND_MIN_X, GROUND_MIN_Z, 0, GROUND_SIZE / res) } },
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
    this.baked = target;
    this.bakedRes = res;
    this.uniforms.snowGroundTex.value = target.texture;
    this.mesh.visible = true;
    this.mesh.userData.groundRes = res;
  }

  /** Swap ring layouts; low keeps the same reach with a coarser lattice and a coarser bake. */
  setQuality(q: 'high' | 'low'): void {
    if (q === this.quality) return;
    this.quality = q;
    const l = LAYOUTS[q];
    this.mesh.geometry = this.geometry(q);
    this.uniforms.snowBaseSpacing.value = l.spacing;
    this.uniforms.snowGridHalf.value = l.half;
    this.mesh.userData.layout = l;
    // Low also drops the finest grain, the ripples, a glint octave and half the shadow taps (snowSurface.ts).
    const defines = { ...this.material.defines };
    if (q === 'low') defines.SNOW_LOW = ''; else delete defines.SNOW_LOW;
    this.material.defines = defines;
    this.material.needsUpdate = true;
  }

  /** Centre the rings on the player, not the camera, so orbiting never re-samples carved snow. */
  follow(x: number, z: number): void {
    this.uniforms.snowLodCenter.value.set(x, z);
  }

  /**
   * Evaluate the ground at `points` on the GPU and read it back: [analytic height, baked height, baked dh/dx,
   * baked dh/dz] per point. For QA, to hold the shader twin and the bake to snowHeight() and its slope.
   */
  probe(renderer: THREE.WebGLRenderer, points: readonly (readonly [number, number])[]): number[][] {
    const n = points.length, data = new Float32Array(n * 4);
    points.forEach(([x, z], i) => data.set([x, z, 0, 1], i * 4));
    const input = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat, THREE.FloatType);
    input.needsUpdate = true;
    const target = new THREE.WebGLRenderTarget(n, 1, { type: THREE.FloatType, depthBuffer: false });
    const mat = new THREE.ShaderMaterial({
      uniforms: { pts: { value: input }, ...this.uniforms },
      vertexShader: 'void main(){gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader: `uniform sampler2D pts;\n${SNOW_GROUND_GLSL}\n${SNOW_GROUND_READ}\nvoid main(){vec2 p=texelFetch(pts,ivec2(gl_FragCoord.xy),0).xy;vec4 b=snowGroundAt(p);gl_FragColor=vec4(snowGroundH(p),b.xyz);}`,
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
    target.dispose(); input.dispose(); mat.dispose(); quad.geometry.dispose();
    return points.map((_, i) => Array.from(out.subarray(i * 4, i * 4 + 4)));
  }

  dispose(): void {
    for (const g of Object.values(this.geometries)) g?.dispose();
    (this.mesh.customDepthMaterial as THREE.Material | undefined)?.dispose();
    this.baked?.dispose();
    this.baked = null;
  }
}
