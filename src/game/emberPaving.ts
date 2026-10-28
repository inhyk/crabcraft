import * as THREE from 'three';
import {onIslandPath,type IslandPath} from './islandPaths';
import {EMBER_DETAIL,EMBER_NOISE} from './emberNoise';

/*
 * Emberreach's roads: cut basalt flags in running courses, laid across each way, with long kerbstones along the
 * trimmed edges. The joints are filled with ash in the town and, more and more toward the forge court and the
 * volcano, glow where the heat comes up through them. One mesh hugs the terrain under the whole network (the
 * gameplay grid's own triangles, a few centimetres up) and its shader lays the stones, so nothing tiles and nothing
 * is a grid. Same footprint and `covers` contract as islandPaths; the court's floor (r 20) is left open.
 */

const MAX_SEG = 12;
const CELL = .5;
const LIFT = .03;
/** Visible paving ends this far past a path's edge: inside onIslandPath's trim margin (.3). */
const REACH = .26;
/** The forge court's floor: emberCourt.ts paves it. */
const COURT = {x: 0, z: -72, r: 20};

interface Seg { ax: number; az: number; bx: number; bz: number; half: number; trim: boolean; first: boolean; last: boolean; along0: number }

/** The rendered terrain's own triangle at (x, z) (2 m grid from (-150, -175)), never below the true height. */
export function emberSurface(height: (x: number, z: number) => number, x: number, z: number) {
 const step = 2, ax = -150 + Math.floor((x + 150) / step) * step, az = -175 + Math.floor((z + 175) / step) * step, u = (x - ax) / step, v = (z - az) / step;
 const a = height(ax, az), b = height(ax + step, az), c = height(ax, az + step), d = height(ax + step, az + step);
 return Math.max(height(x, z), u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v));
}

function segBox(s: Seg, x: number, z: number): number {
 const dx = s.bx - s.ax, dz = s.bz - s.az, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, px = x - s.ax, pz = z - s.az;
 const t = px * ux + pz * uz, across = Math.abs(px * uz - pz * ux), ovJ = Math.max(s.first ? 0 : -t, s.last ? 0 : t - L, 0);
 if (ovJ > 0) return Math.hypot(ovJ, across) - s.half;
 const bx = across - s.half, by = Math.max(s.first ? -t : -1e3, s.last ? t - L : -1e3);
 return Math.hypot(Math.max(bx, 0), Math.max(by, 0)) + Math.min(Math.max(bx, by), 0);
}

const HEAD = /* glsl */ `
#define EP_MAX_SEG ${MAX_SEG}
uniform vec4 epA[EP_MAX_SEG];
uniform vec4 epB[EP_MAX_SEG];
uniform int epCount;
uniform vec3 epCourt;
uniform float egDetail;
uniform float epTime;
varying vec3 vEpW;
${EMBER_NOISE}
float epSmin(float a,float b,float k){float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}
float epEdgeAt(float k,float salt,float jit){return k+jit*(egHash12(vec2(k,salt))-.5);}
// Running courses of cut flags: rows of varying depth along the way, flags of varying width across it, each a
// hair skew, with a crisp chamfer. Signed distance to the flag's outline, its id, offset from centre, half size.
float epFlag(vec2 q,float rh,vec2 len,out float id,out vec2 local,out vec2 halfSz){
  float k=floor(q.y/rh),b0=epEdgeAt(k,3.1,.3)*rh,b1=epEdgeAt(k+1.,3.1,.3)*rh,row=k;
  if(q.y<b0){row=k-1.;b1=b0;b0=epEdgeAt(k-1.,3.1,.3)*rh;}
  else if(q.y>=b1){row=k+1.;b0=b1;b1=epEdgeAt(k+2.,3.1,.3)*rh;}
  float SL=mix(len.x,len.y,egHash12(vec2(row,7.7))),off=egHash12(vec2(row,1.3))*SL,xs=q.x-off,salt=row*1.618+.5;
  float j=floor(xs/SL),e0=epEdgeAt(j,salt,.5)*SL,e1=epEdgeAt(j+1.,salt,.5)*SL,col=j;
  if(xs<e0){col=j-1.;e1=e0;e0=epEdgeAt(j-1.,salt,.5)*SL;}
  else if(xs>=e1){col=j+1.;e0=e1;e1=epEdgeAt(j+2.,salt,.5)*SL;}
  id=egHash12(vec2(col+row*57.31,row-col*.731));
  halfSz=vec2(e1-e0,b1-b0)*.5;
  local=vec2(xs-(e0+e1)*.5,q.y-(b0+b1)*.5);
  float a=(egHash12(vec2(id*71.3,col-row))-.5)*.035,ca=cos(a),sa=sin(a);
  local=vec2(ca*local.x-sa*local.y,sa*local.x+ca*local.y);
  float jw=.018+.012*fract(id*3.17),rc=.025;
  vec2 dq=abs(local)-(halfSz-jw-rc);
  return length(max(dq,0.))+min(max(dq.x,dq.y),0.)-rc;
}
`;

const COLOR = /* glsl */ `
vec2 epP=vEpW.xz;
vec2 epDpx=dFdx(epP),epDpy=dFdy(epP);
float epFoot=length(abs(epDpx)+abs(epDpy));
float epSd=1e3,epBest=1e3,epTrim=0.,epAlong=0.,epAcross=0.,epHalf=1.;
for(int i=0;i<EP_MAX_SEG;i++){
  if(i>=epCount)break;
  vec4 s=epA[i],info=epB[i];
  vec2 jn=vec2(mod(info.z,2.),floor(info.z*.5));
  vec2 ab=s.zw-s.xy;float L=length(ab);vec2 dir=ab/L,ap=epP-s.xy;
  float t=dot(ap,dir),across=dot(ap,vec2(dir.y,-dir.x));
  float ovA=-t,ovB=t-L,ovJ=max(max(ovA*jn.x,ovB*jn.y),0.);
  vec2 bd=vec2(abs(across)-info.x,max(mix(ovA,-1e3,jn.x),mix(ovB,-1e3,jn.y)));
  float d=ovJ>0.?length(vec2(ovJ,across))-info.x:length(max(bd,0.))+min(max(bd.x,bd.y),0.);
  epSd=epSmin(epSd,d,.2);
  float rank=d-info.x*.08;
  if(rank<epBest){epBest=rank;epTrim=info.y;epAlong=t+info.w;epAcross=across;epHalf=info.x;}
}
float epCourtD=length(epP-epCourt.xy)-epCourt.z;
if(epCourtD<0.)discard;
float epRag=egNoise(epP*1.3+2.)*.6+egNoise(epP*4.1)*.4;
float epAlpha=1.-smoothstep(-.02,${REACH.toFixed(2)},epSd+epRag*.05);
if(epAlpha<.004)discard;
// Kerbs in the outer band of trimmed ways: long stones along the way. Elsewhere flags in courses across it.
float epKerbW=.36;
float epKerb=epTrim>.5?1.-step(epKerbW,-epSd):0.;
float epId;vec2 epLoc,epHs;float epOut;
if(epKerb>.5){
  float k=floor(epAlong/1.3),u=epAlong-(k+.5)*1.3;
  epId=egHash12(vec2(k,sign(epAcross)*3.1+epHalf));
  float w=epKerbW*.5;epLoc=vec2(u,-epSd-w);epHs=vec2(.65,w);
  vec2 dq=abs(epLoc)-(epHs-vec2(.02+.012*fract(epId*3.3),.012)-.025);epOut=length(max(dq,0.))+min(max(dq.x,dq.y),0.)-.025;
}else{
  vec2 q=vec2(epAcross,epAlong)+vec2(egNoise(epP*1.7),egNoise(epP*1.7+7.))*.025;
  epOut=epFlag(q,.72,vec2(.62,1.15),epId,epLoc,epHs);
}
epOut+=egNoise(epP*9.+epId*9.)*.012;
float epFw=max(epFoot*.5,1e-4);
float epBlur=smoothstep(.06,.25,epFoot);
float epJ=(1.-smoothstep(-epFw,epFw,-epOut))*min(1.,.03/epFw)*(1.-epBlur*.6);
// Heat rises toward the court and the volcano; a few joints glow even in the town.
float epHeatBase=smoothstep(10.,-60.,epP.y);
float epN1=egNoise(epP*.12+4.),epN2=egNoise(epP*.45-2.);
float epHot=clamp(epHeatBase*.7+smoothstep(.45,.85,epN1*.5+.5)*.4-.1,0.,1.)*(1.-epKerb*.8);
// Hot seams: short meandering runs along the joints where the heat comes through, thicker toward the court.
float epSeam=egNoise(epP*1.15+vec2(3.,9.))*.6+egNoise(epP*3.3)*.4;
float epGlowJ=smoothstep(.42,.62,epSeam*.5+.5+epHot*.32-.28)*smoothstep(.15,.5,epHot);
// Ash fills the rest of the joints and blows over the edges and the low stones.
float epMid=1.-smoothstep(.3,.95,abs(epAcross)/max(epHalf,.5));
float epAshy=smoothstep(-.7,.15,epSd+epRag*.4)*.7+smoothstep(.55,.85,egNoise(epP*.6+11.)*.5+.5)*.45*(1.-epMid);
// Stone: lighter cut basalt, a few darker and a few warm-scorched; kerbs darker and longer.
float epV=fract(epId*17.13);
vec3 epStone=mix(vec3(.4,.4,.42),vec3(.5,.495,.5),fract(epId*3.7));
epStone=mix(epStone,vec3(.33,.335,.36),step(epV,.14)*.85);
epStone=mix(epStone,vec3(.47,.42,.4),step(.94,epV)*.5);
// Kerbs: long dressed blocks, the palest stone on the way, so the edge reads against the ground.
epStone=mix(epStone,vec3(.5,.495,.5)*(.94+.12*fract(epId*5.)),epKerb);
epStone*=.86+.28*(egNoise(epP*4.3+epId*13.)*.5+.5);
float epNear=1.-smoothstep(.006,.035,epFoot);
// Tooling: fine parallel dressing marks across each flag, only up close.
if(epNear>0.)epStone*=1.+(sin((epLoc.x*.6+epLoc.y)*90.+epId*20.)*.035+egNoise(epP*40.)*.06)*epNear;
epStone=mix(epStone,vec3(.44,.44,.455)*(.9+.2*(epN1*.5+.5)),epBlur*.7);
// The trodden middle is polished a little darker; the heat browns the stones by the court.
epStone*=mix(1.,.88,epMid*.6);
epStone=mix(epStone,epStone*vec3(.86,.8,.78),epHeatBase*.35);
vec3 epAshC=vec3(.52,.5,.51)*(.9+.2*epN2);
vec3 epJoint=mix(vec3(.08,.075,.08),epAshC,clamp(.35+epAshy,0.,1.));
epJoint=mix(epJoint,vec3(.12,.05,.03),epGlowJ);
vec3 epCol=mix(epStone,epJoint,epJ);
// Ash drifts in from the edges, thicker in the hollows of the stones.
float epH=clamp(1.-(1.-smoothstep(0.,.05,-epOut)),0.,1.)*(.85+.15*fract(epId*5.3));
float epDrift=smoothstep(.62,.95,epAshy+egNoise(epP*1.1+3.)*.25-epH*.15);
epCol=mix(epCol,epAshC,epDrift*.85);
// The outer lip of the kerb sinks under the ash.
epCol=mix(epCol,epAshC*.85,smoothstep(-.1,.0,epSd+epRag*.04)*.7);
diffuseColor.rgb=egSrgb(epCol);
diffuseColor.a*=epAlpha;
`;

const ROUGH = /* glsl */ `
roughnessFactor=mix(.78-epMid*.12,.95,max(epJ,epDrift));
`;

const NORMAL = /* glsl */ `
if(egDetail>.5){
  float h=(epH*(1.-epDrift*.8)*.04+egNoise(epP*7.)*.004*epNear)*(1.-epBlur);
  normal=egBump(normal,h,epDpx,epDpy);
}
`;

const EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
{
  float core=(1.-smoothstep(-epFw,epFw*2.,-epOut+.006))*epGlowJ*(1.-epDrift)*(1.-epBlur*.5);
  float flick=.8+.2*sin(epTime*1.1+epId*30.);
  totalEmissiveRadiance+=mix(vec3(1.,.2,.03),vec3(1.,.42,.1),epHot)*core*(1.+1.4*epHot)*flick;
  // A faint warm breath on the flags round a glowing joint.
  totalEmissiveRadiance+=vec3(1.,.3,.08)*epGlowJ*.03*(1.-epJ)*epHot;
}
`;

export interface EmberPaving { root: THREE.Group; update(time: number): void }

/** Emberreach's ways (same `covers` contract as islandPaths). */
export function emberPaving(height: (x: number, z: number) => number, paths: IslandPath[]): EmberPaving {
 const root = new THREE.Group(); root.name = 'world5-ember-paving';
 const segs: Seg[] = [];
 for (const path of paths) {
  let along = 0;
  for (let k = 1; k < path.points.length; k++) {
   const [ax, az] = path.points[k - 1], [bx, bz] = path.points[k], len = Math.hypot(bx - ax, bz - az);
   if (len < .001) continue;
   segs.push({ax, az, bx, bz, half: path.width / 2, trim: !!path.trim, first: k === 1, last: k === path.points.length - 1, along0: along});
   along += len;
  }
 }
 if (segs.length > MAX_SEG) throw new Error(`emberPaving: ${segs.length} segments, max ${MAX_SEG}`);
 let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
 for (const s of segs) {
  minX = Math.min(minX, s.ax - s.half - 1, s.bx - s.half - 1); maxX = Math.max(maxX, s.ax + s.half + 1, s.bx + s.half + 1);
  minZ = Math.min(minZ, s.az - s.half - 1, s.bz - s.half - 1); maxZ = Math.max(maxZ, s.az + s.half + 1, s.bz + s.half + 1);
 }
 minX = Math.floor(minX / CELL) * CELL; minZ = Math.floor(minZ / CELL) * CELL;
 const sdNet = (x: number, z: number) => segs.reduce((d, s) => Math.min(d, segBox(s, x, z)), Infinity);
 const nx = Math.ceil((maxX - minX) / CELL), nz = Math.ceil((maxZ - minZ) / CELL);
 const vid = new Int32Array((nx + 1) * (nz + 1)).fill(-1), pos: number[] = [], index: number[] = [];
 const vert = (i: number, j: number) => {
  const k = j * (nx + 1) + i;
  if (vid[k] < 0) { const x = minX + i * CELL, z = minZ + j * CELL; vid[k] = pos.length / 3; pos.push(x, emberSurface(height, x, z) + LIFT, z); }
  return vid[k];
 };
 for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
  const cx = minX + (i + .5) * CELL, cz = minZ + (j + .5) * CELL;
  if (sdNet(cx, cz) > REACH + CELL * .72 || Math.hypot(cx - COURT.x, cz - COURT.z) < COURT.r - CELL) continue;
  const a = vert(i, j), b = vert(i + 1, j), c = vert(i, j + 1), d = vert(i + 1, j + 1);
  index.push(a, c, b, b, c, d);
 }
 const geo = new THREE.BufferGeometry();
 geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
 geo.setIndex(index); geo.computeVertexNormals(); geo.computeBoundingSphere();
 const uniforms = {
  epA: {value: Array.from({length: MAX_SEG}, (_, i) => segs[i] ? new THREE.Vector4(segs[i].ax, segs[i].az, segs[i].bx, segs[i].bz) : new THREE.Vector4())},
  epB: {value: Array.from({length: MAX_SEG}, (_, i) => segs[i] ? new THREE.Vector4(segs[i].half, segs[i].trim ? 1 : 0, (segs[i].first ? 0 : 1) + (segs[i].last ? 0 : 2), segs[i].along0) : new THREE.Vector4())},
  epCount: {value: segs.length},
  epCourt: {value: new THREE.Vector3(COURT.x, COURT.z, COURT.r)},
  egDetail: EMBER_DETAIL,
  epTime: {value: 0},
 };
 const material = new THREE.MeshStandardMaterial({color: '#ffffff', roughness: .8, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2});
 material.name = 'ember-cut-basalt-paving';
 material.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
   .replace('#include <common>', '#include <common>\nvarying vec3 vEpW;')
   .replace('#include <fog_vertex>', '#include <fog_vertex>\nvEpW=(modelMatrix*vec4(transformed,1.)).xyz;');
  shader.fragmentShader = shader.fragmentShader
   .replace('#include <common>', `#include <common>\n${HEAD}`)
   .replace('#include <color_fragment>', `#include <color_fragment>\n${COLOR}`)
   .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${ROUGH}`)
   .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${NORMAL}`)
   .replace('#include <emissivemap_fragment>', EMISSIVE);
 };
 material.customProgramCacheKey = () => 'ember-cut-basalt-paving';
 const surface = new THREE.Mesh(geo, material);
 surface.name = 'ember-paving-surface'; surface.receiveShadow = true; surface.renderOrder = -1;
 root.add(surface);
 root.userData.covers = (x: number, z: number) => onIslandPath(paths, x, z) && Math.hypot(x - COURT.x, z - COURT.z) >= COURT.r;
 root.userData.stats = {segments: segs.length, cells: index.length / 6, vertices: pos.length / 3};
 return {root, update(time: number) { uniforms.epTime.value = time; }};
}
