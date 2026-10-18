import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {RoundedBoxGeometry} from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {onIslandPath,type IslandPath} from './islandPaths';
import {pavingGround} from './pavingLayout';

/*
 * Frostlight's streets: irregular hand-laid flagstones half buried in packed, trodden snow. One mesh hugs the
 * terrain under the whole network and its shader lays the stones (Voronoi cells, so no grid and no tiling),
 * packs snow into the joints, scrapes a cart's ruts down the main road and a beaten line along each street,
 * and drifts snow over the edges before fading into the snowfield. Kerb stones are geometry, missing where a
 * drift buries them. `frostDrift` is shared by both, so a drift always swallows its kerb.
 */

const MAX_SEG = 8;
/** Grid step of the surface mesh, metres. */
const CELL = .5;
/** Above the rendered terrain, so the snowfield never pokes through. */
const LIFT = .03;
/** The surface fades into the snowfield over this band past a path's edge: onIslandPath's trim margin. */
const FADE = .3;

const fract = (v: number) => v - Math.floor(v);
const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash = (x: number, z: number) => fract(Math.sin(x * 127.1 + z * 311.7) * 43758.5453);
function vnoise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), u = smooth(0, 1, x - ix), v = smooth(0, 1, z - iz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** 0 clear, 1 a drift has buried the edge: no kerb, and snow reaches well into the road. */
export function frostDrift(x: number, z: number): number {
  return smooth(.5, .74, vnoise(x * .15 + 3.1, z * .15 - 7.3) * .65 + vnoise(x * .41 - 1.7, z * .41 + 5.2) * .35);
}

interface Seg { ax: number; az: number; bx: number; bz: number; half: number; main: boolean; along0: number; seed: number; path: number; first: boolean; last: boolean }

/** Hash, gradient noise and fbm shared by Frostlight's ground shaders. */
export const FROST_NOISE = /* glsl */ `
vec2 fpHash22(vec2 p){vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));p3+=dot(p3,p3.yzx+33.33);return fract((p3.xx+p3.yz)*p3.zy);}
float fpHash12(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
float fpNoise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
  float a=dot(fpHash22(i)*2.-1.,f),b=dot(fpHash22(i+vec2(1.,0.))*2.-1.,f-vec2(1.,0.));
  float c=dot(fpHash22(i+vec2(0.,1.))*2.-1.,f-vec2(0.,1.)),d=dot(fpHash22(i+vec2(1.))*2.-1.,f-vec2(1.));
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y)*1.4;}
float fpFbm(vec2 p){return fpNoise(p)*.55+fpNoise(p*2.03+7.1)*.3+fpNoise(p*4.11-3.7)*.15;}
`;

const PAVING_HEAD = /* glsl */ `
#define FP_MAX_SEG ${MAX_SEG}
uniform vec4 fpSeg[FP_MAX_SEG];
uniform vec4 fpSegInfo[FP_MAX_SEG];
uniform int fpSegCount;
uniform float fpDetail;
varying float vFpDrift;
varying vec3 vFpWorld;
${FROST_NOISE}
float fpSmin(float a,float b,float k){float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}
// Flagstones (two-pass Voronoi): distance to the nearest joint, the stone's id, the joint's outward normal and
// the offset from here to the stone's centre, all in cell units.
float fpStones(vec2 x,out float id,out vec2 edgeN,out vec2 toSeed){
  vec2 n=floor(x),f=fract(x),mg=vec2(0.),mr=vec2(0.);float md=8.;
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){vec2 g=vec2(float(i),float(j)),r=g+.12+.76*fpHash22(n+g)-f;float d=dot(r,r);if(d<md){md=d;mr=r;mg=g;}}
  md=8.;edgeN=vec2(1.,0.);
  for(int j=-2;j<=2;j++)for(int i=-2;i<=2;i++){vec2 g=mg+vec2(float(i),float(j)),r=g+.12+.76*fpHash22(n+g)-f,dr=r-mr;
    if(dot(dr,dr)>1e-5){vec2 nn=normalize(dr);float d=dot(.5*(mr+r),nn);if(d<md){md=d;edgeN=nn;}}}
  id=fpHash12(n+mg);toSeed=mr;return md;
}
`;

const PAVING_COLOR = /* glsl */ `
vec2 fpP=vFpWorld.xz;
// The network: a rounded union of the paths, the cart's ruts and the beaten street lines.
float fpSd=1e3,fpTrod=0.,fpBerm=0.,fpZone=0.;
for(int i=0;i<FP_MAX_SEG;i++){
  if(i>=fpSegCount)break;
  vec4 s=fpSeg[i],info=fpSegInfo[i];
  vec2 ab=s.zw-s.xy;float L=length(ab);vec2 dir=ab/L,ap=fpP-s.xy;
  float t=dot(ap,dir),across=dot(ap,vec2(dir.y,-dir.x));
  float d=length(ap-dir*clamp(t,0.,L))-info.x;
  fpSd=fpSmin(fpSd,d,1.2);
  float along=t+info.z,inside=1.-smoothstep(-.6,.9,max(-t,t-L));
  float w=fpNoise(vec2(along*.045,info.w))*.9+fpNoise(vec2(along*.17,info.w+3.))*.16;
  if(info.y>.5){
    float r=abs(abs(across-w*.5)-1.05);
    fpTrod=max(fpTrod,(1.-smoothstep(.12,.3,r))*inside);
    fpBerm=max(fpBerm,smoothstep(.2,.32,r)*(1.-smoothstep(.32,.58,r))*inside);
    float c=abs(across-w*.5);
    fpZone=max(fpZone,((1.-smoothstep(.45,.8,c))*.14+smoothstep(1.5,3.4,c)*.22)*inside);
  }else{
    float x=abs(across-w*.6);
    fpTrod=max(fpTrod,(1.-smoothstep(.28,.8,x))*inside*.85);
    fpZone=max(fpZone,smoothstep(.9,1.8,x)*.16*inside);
  }
}
float fpN1=fpFbm(fpP*.55);
// Positive under the drift that buries the edge; without a drift the stones run up to the kerb.
float fpEdge=fpSd+.04+smoothstep(.3,1.,vFpDrift)*1.9+fpN1*.16+fpNoise(fpP*2.7)*.06;
float fpCover=smoothstep(-.32,-.02,fpEdge);
fpTrod*=1.-fpCover;
// Stones: narrow joints of varying width, a short bevel, a per-stone tilt; some stones are split in two.
vec2 fpQ=fpP*1.45;fpQ+=vec2(fpNoise(fpQ*2.3),fpNoise(fpQ*2.3+9.))*.05;
float fpId;vec2 fpEN,fpTS;
float fpJ=fpStones(fpQ,fpId,fpEN,fpTS)/1.45;
vec2 fpLocal=-fpTS/1.45;
float fpId2=fpId;
{
  vec2 sp=fpHash22(vec2(fpId*31.7,8.3));
  if(sp.x>.6){float a=sp.y*3.1415927;vec2 nn=vec2(-sin(a),cos(a));float l=dot(fpLocal-(fpHash22(vec2(fpId*7.,2.))-.5)*.16,nn);
    if(abs(l)<fpJ){fpJ=abs(l);fpEN=-sign(l)*nn;}fpId2=fract(fpId*13.7+step(0.,l)*.37);}
}
float fpJw=.006+.009*(fpNoise(fpP*3.7)*.5+.5);
float fpBt=clamp((fpJ-fpJw)/.035,0.,1.),fpBev=fpBt*fpBt*(3.-2.*fpBt);
vec2 fpTilt=(fpHash22(vec2(fpId2*91.7,3.1))-.5)*.9;
float fpHn=clamp(fpBev*(.72+.28*fpId2+dot(fpLocal,fpTilt)*.35),0.,1.);
vec2 fpGStone=(-fpEN*(6.*fpBt*(1.-fpBt)/.035)*.03+fpTilt*.035*fpBev);
// Packed snow lying on the stones: patchy, scraped off where wheels and feet go, drifted at the edges.
float fpFilm=clamp(.47+fpZone+fpN1*.6+fpNoise(fpP*1.9+4.)*.28,0.,1.);
fpFilm=max(mix(fpFilm,-.05,fpTrod),fpCover*1.2);
float fpShow=fpHn*.72+(fpNoise(fpP*6.3)*.5+.5)*.28;
float fpStoneMask=smoothstep(.0,.3,fpBev);
float fpVis=fpStoneMask*smoothstep(fpFilm-.05,fpFilm+.05,fpShow);
// Snow height for the normal: the film, berms beside the ruts, the drifts.
float fpS=clamp(fpFilm,0.,1.)*.03+fpBerm*.02*(1.-fpCover)+fpCover*.08;
vec3 fpStone=mix(vec3(.14,.145,.155),vec3(.29,.285,.28),fpId2);
fpStone=mix(fpStone,vec3(.25,.205,.165),step(.8,fract(fpId2*7.13))*.75);
fpStone*=.84+.32*(fpNoise(fpP*13.+fpId2*17.)*.5+.5);
fpStone*=1.+(fpNoise(fpP*47.)*.16+fpNoise(fpP*103.)*.1)*(1.-smoothstep(.006,.025,length(fwidth(fpP))));
{
  vec2 cr=fpHash22(vec2(fpId2*53.1,1.7));
  if(cr.x>.55){float a=cr.y*6.2831853;vec2 cd=vec2(cos(a),sin(a));float cl=abs(dot(fpLocal+(cr-.5)*.12,vec2(-cd.y,cd.x)))+fpNoise(fpP*21.)*.004;fpStone*=mix(.55,1.,smoothstep(.0015,.005,cl));}
}
fpStone*=mix(.7,1.,fpBev);
fpStone*=mix(1.,.74,fpTrod);
float fpIce=smoothstep(.5,.8,fpTrod*(fpNoise(fpP*.7+2.)*.5+.5)*1.7);
float fpFill=smoothstep(-.3,.3,fpNoise(fpP*1.7+11.)+.35-fpTrod*.45);
vec3 fpJoint=mix(vec3(.075,.085,.1),mix(vec3(.6,.67,.77),vec3(.42,.47,.55),fpTrod*.6),fpFill);
vec3 fpSnow=mix(mix(vec3(.62,.68,.77),vec3(.8,.86,.94),smoothstep(.2,.9,fpFilm)),vec3(.84,.92,.99),fpCover);
vec3 fpCol=mix(mix(fpJoint,fpSnow,max(fpStoneMask*(1.-fpTrod*.5),smoothstep(.35,.75,fpFilm)*.93)),fpStone,fpVis);
fpCol=mix(fpCol,vec3(.1,.135,.19),fpIce*.45*fpVis);
diffuseColor.rgb*=fpCol;
diffuseColor.a*=1.-smoothstep(-.05,${FADE.toFixed(2)},fpSd+fpNoise(fpP*1.3)*.08);
`;

const PAVING_ROUGH = /* glsl */ `
roughnessFactor=mix(mix(.74,.9,fpCover),mix(.8,.52,fpTrod),fpVis);
roughnessFactor=mix(roughnessFactor,.3,fpIce*fpVis);
`;

const PAVING_NORMAL = /* glsl */ `
{
  vec2 dpx=dFdx(fpP),dpy=dFdy(fpP);float dsx=dFdx(fpS),dsy=dFdy(fpS),det=dpx.x*dpy.y-dpx.y*dpy.x;
  vec2 gS=abs(det)>1e-12?vec2(dsx*dpy.y-dsy*dpx.y,dpx.x*dsy-dpy.x*dsx)/det:vec2(0.);
  gS=clamp(gS,-.5,.5);
  vec2 gSt=fpGStone;
  if(fpDetail>.5){float e=.02,n0=fpNoise(fpP*9.),nx=fpNoise((fpP+vec2(e,0.))*9.),nz=fpNoise((fpP+vec2(0.,e))*9.);gSt+=vec2(nx-n0,nz-n0)/e*.004;}
  vec2 g=mix(gS,gSt,fpVis);
  vec3 nW=inverseTransformDirection(normal,viewMatrix);
  nW=normalize(nW+vec3(-g.x,0.,-g.y));
  normal=normalize((viewMatrix*vec4(nW,0.)).xyz);
}
`;

/** A low sun skimming wet stone and ice must not bloom out. */
const SPEC_CLAMP = /* glsl */ `#include <lights_fragment_end>
reflectedLight.directSpecular=min(reflectedLight.directSpecular,vec3(.35));`;

/**
 * Rough-cut granite with snow caps and frost where it meets the drift. Geometry needs vertex colours (the
 * stone's tint), `aGround`, the snow line under each stone, and `aSnow`, how readily its top holds snow (0..1).
 */
export function graniteMaterial(name: string): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({color: '#ffffff', vertexColors: true, roughness: .86});
  material.name = name;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGround;\nattribute float aSnow;\nvarying float vKG;\nvarying float vKS;\nvarying vec3 vKW;\nvarying vec3 vKN;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvKG=aGround;vKS=aSnow;vKW=(modelMatrix*vec4(transformed,1.)).xyz;vKN=normalize(mat3(modelMatrix)*objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FROST_NOISE}\nvarying float vKG;\nvarying float vKS;\nvarying vec3 vKW;\nvarying vec3 vKN;`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        vec3 kNW=normalize(vKN),kA=abs(kNW)/(abs(kNW.x)+abs(kNW.y)+abs(kNW.z));
        #define K3(f,o) (fpNoise(vKW.zy*f+o)*kA.x+fpNoise(vKW.xz*f+o)*kA.y+fpNoise(vKW.xy*f+o)*kA.z)
        float kN=K3(3.1,0.);
        float kSnow=smoothstep(.7,.8,kNW.y+kN*.3)*smoothstep(-.08,.08,fpNoise(vKW.xz*1.3+7.)+vKS*.8-.3);
        float kFrost=1.-smoothstep(.0,.05+kN*.02,vKW.y-vKG);
        // Broad mottling, dark and light grains.
        float kGrain=K3(38.,5.)*.5+.5,kGrain2=K3(91.,9.)*.5+.5,kNear=1.-smoothstep(.004,.02,length(fwidth(vKW)));
        diffuseColor.rgb*=.72+.36*(K3(6.,2.)*.5+.5);
        diffuseColor.rgb*=mix(1.,mix(1.,.55,smoothstep(.62,.8,kGrain))*mix(1.,1.35,smoothstep(.66,.84,kGrain2)),kNear);
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.84,.92,.99),max(kSnow,kFrost*.9));
        float kWhite=max(kSnow,kFrost);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=mix(.82,.9,kWhite);')
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        {
          // Chisel marks: a small world-space bump, weaker under snow.
          #define KF(q) (fpNoise((q).zy*14.+1.)*kA.x+fpNoise((q).xz*14.+1.)*kA.y+fpNoise((q).xy*14.+1.)*kA.z)
          float e=.012,f0=KF(vKW);
          vec3 g=vec3(KF(vKW+vec3(e,0.,0.))-f0,KF(vKW+vec3(0.,e,0.))-f0,KF(vKW+vec3(0.,0.,e))-f0)/e;
          vec3 nW=inverseTransformDirection(normal,viewMatrix);
          g=(g-dot(g,nW)*nW)*.01*(1.-kWhite*.7);
          nW=normalize(nW-g);
          normal=normalize((viewMatrix*vec4(nW,0.)).xyz);
        }`);
  };
  material.customProgramCacheKey = () => 'frostlight-granite';
  return material;
}

export interface FrostPaving {
  root: THREE.Group;
  /** 'low' drops the stones' micro relief. */
  setQuality(q: 'high' | 'low'): void;
}

/** Frostlight's paths (same layout and `covers` contract as islandPaths), dressed as a snowed-in village street. */
export function frostPaving(height: (x: number, z: number) => number, paths: IslandPath[]): FrostPaving {
  const root = new THREE.Group(); root.name = 'world4-snow-paving';
  const segs: Seg[] = [];
  paths.forEach((path, pi) => {
    let along = 0;
    for (let k = 1; k < path.points.length; k++) {
      const [ax, az] = path.points[k - 1], [bx, bz] = path.points[k], len = Math.hypot(bx - ax, bz - az);
      if (len < .001) continue;
      segs.push({ax, az, bx, bz, half: path.width / 2, main: path.width >= 6, along0: along, seed: pi * 7.31 + 1.3, path: pi, first: k === 1, last: k === path.points.length - 1});
      along += len;
    }
  });
  if (segs.length > MAX_SEG) throw new Error(`frostPaving: ${segs.length} segments, max ${MAX_SEG}`);
  const segDist = (s: Seg, x: number, z: number) => {
    const dx = s.bx - s.ax, dz = s.bz - s.az, l2 = dx * dx + dz * dz, t = Math.min(1, Math.max(0, ((x - s.ax) * dx + (z - s.az) * dz) / l2));
    return Math.hypot(s.ax + dx * t - x, s.az + dz * t - z);
  };
  const sdNet = (x: number, z: number) => segs.reduce((d, s) => Math.min(d, segDist(s, x, z) - s.half), Infinity);
  const ground = (x: number, z: number) => pavingGround(height, x, z, 4);

  // Surface: grid cells near the network, one vertex per grid point, so overlapping paths never double up.
  const reach = FADE + .2 + CELL;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of segs) {
    minX = Math.min(minX, s.ax - s.half - reach, s.bx - s.half - reach); maxX = Math.max(maxX, s.ax + s.half + reach, s.bx + s.half + reach);
    minZ = Math.min(minZ, s.az - s.half - reach, s.bz - s.half - reach); maxZ = Math.max(maxZ, s.az + s.half + reach, s.bz + s.half + reach);
  }
  minX = Math.floor(minX / CELL) * CELL; minZ = Math.floor(minZ / CELL) * CELL;
  const nx = Math.ceil((maxX - minX) / CELL), nz = Math.ceil((maxZ - minZ) / CELL);
  const vid = new Int32Array((nx + 1) * (nz + 1)).fill(-1), pos: number[] = [], drift: number[] = [], index: number[] = [];
  const vert = (i: number, j: number) => {
    const k = j * (nx + 1) + i;
    if (vid[k] < 0) { const x = minX + i * CELL, z = minZ + j * CELL; vid[k] = pos.length / 3; pos.push(x, ground(x, z) + LIFT, z); drift.push(frostDrift(x, z)); }
    return vid[k];
  };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    if (sdNet(minX + (i + .5) * CELL, minZ + (j + .5) * CELL) > FADE + .15 + CELL * .75) continue;
    const a = vert(i, j), b = vert(i + 1, j), c = vert(i, j + 1), d = vert(i + 1, j + 1);
    index.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aDrift', new THREE.Float32BufferAttribute(drift, 1));
  geo.setIndex(index); geo.computeVertexNormals(); geo.computeBoundingSphere();

  const uniforms = {
    fpSeg: {value: Array.from({length: MAX_SEG}, (_, i) => segs[i] ? new THREE.Vector4(segs[i].ax, segs[i].az, segs[i].bx, segs[i].bz) : new THREE.Vector4())},
    fpSegInfo: {value: Array.from({length: MAX_SEG}, (_, i) => segs[i] ? new THREE.Vector4(segs[i].half, segs[i].main ? 1 : 0, segs[i].along0, segs[i].seed) : new THREE.Vector4())},
    fpSegCount: {value: segs.length},
    fpDetail: {value: 1},
  };
  const material = new THREE.MeshStandardMaterial({color: '#ffffff', roughness: .85, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2});
  material.name = 'frostlight-snow-paving';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aDrift;\nvarying float vFpDrift;\nvarying vec3 vFpWorld;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvFpDrift=aDrift;vFpWorld=(modelMatrix*vec4(transformed,1.)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PAVING_HEAD}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${PAVING_COLOR}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${PAVING_ROUGH}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${PAVING_NORMAL}`)
      .replace('#include <lights_fragment_end>', SPEC_CLAMP);
  };
  material.customProgramCacheKey = () => 'frostlight-snow-paving';
  const surface = new THREE.Mesh(geo, material);
  surface.name = 'frostlight-paving-surface'; surface.receiveShadow = true; surface.renderOrder = -1;
  root.add(surface);

  // Kerbs: rough-cut granite along both edges, broken where a drift or a crossing street takes the edge.
  let seed = 4127;
  const rand = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const kerbs: THREE.BufferGeometry[] = [];
  let buried = 0, junction = 0;
  const spots: [number, number][] = [];
  const tint = new THREE.Color();
  for (const s of segs) {
    const dx = s.bx - s.ax, dz = s.bz - s.az, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, yaw = Math.atan2(ux, uz);
    for (const side of [-1, 1]) {
      // The paving's rounded end runs out before the kerb would, so kerbs stop short of a path's ends.
      let t = (s.first ? 1.1 : .3) + rand() * .3;
      while (t < L - (s.last ? 1.4 : .3)) {
        const len = (s.main ? .5 : .42) + rand() * .34, tc = t + len / 2, off = side * (s.half + .17 + (rand() - .5) * .06);
        t += len + .025 + rand() * .06;
        const x = s.ax + ux * tc + uz * off, z = s.az + uz * tc - ux * off;
        if (segs.some(o => o !== s && o.path !== s.path && segDist(o, x, z) < o.half + 1.1)) { junction++; continue; }
        if (frostDrift(x, z) > .35 || rand() < .1) { buried++; continue; }
        const w = .28 + rand() * .12, h = .26, y0 = ground(x, z), top = .03 + rand() * .085;
        const slope = (ground(x + ux * .3, z + uz * .3) - ground(x - ux * .3, z - uz * .3)) / .6;
        const g = new RoundedBoxGeometry(w, h, len, 2, .06);
        g.rotateZ((rand() - .5) * .22); g.rotateX(-Math.atan(slope) + (rand() - .5) * .05);
        g.rotateY(yaw + (rand() - .5) * .16); g.translate(x, y0 + top - h / 2, z);
        const p = g.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < p.count; i++) {
          const px = p.getX(i), py = p.getY(i), pz = p.getZ(i), n = vnoise(px * 6 + py * 4, pz * 6) - .5, m = vnoise(pz * 6 + 3, px * 6 - py * 4) - .5;
          p.setXYZ(i, px + n * .045, py + (vnoise(pz * 5, px * 5) - .5) * .03, pz + m * .045);
        }
        g.computeVertexNormals();
        tint.setRGB(.2 + rand() * .08, .2 + rand() * .07, .205 + rand() * .06);
        const col = new Float32Array(p.count * 3), base = new Float32Array(p.count);
        for (let i = 0; i < p.count; i++) { col.set([tint.r, tint.g, tint.b], i * 3); base[i] = y0; }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.setAttribute('aGround', new THREE.BufferAttribute(base, 1));
        g.setAttribute('aSnow', new THREE.BufferAttribute(new Float32Array(p.count).fill(.5), 1));
        g.deleteAttribute('uv');
        kerbs.push(g); spots.push([+x.toFixed(2), +z.toFixed(2)]);
      }
    }
  }
  if (kerbs.length) {
    const kerbGeo = mergeGeometries(kerbs, false)!;
    kerbs.forEach(g => g.dispose());
    const kerbMat = graniteMaterial('frostlight-kerb-granite');
    const kerbMesh = new THREE.Mesh(kerbGeo, kerbMat);
    kerbMesh.name = 'frostlight-kerb-stones'; kerbMesh.castShadow = true; kerbMesh.receiveShadow = true;
    root.add(kerbMesh);
  }
  root.userData.covers = (x: number, z: number) => onIslandPath(paths, x, z);
  root.userData.stats = {segments: segs.length, cells: index.length / 6, vertices: pos.length / 3, kerbs: kerbs.length, buriedKerbs: buried, junctionGaps: junction};
  root.userData.kerbSpots = spots;
  return {root, setQuality(q) { uniforms.fpDetail.value = q === 'low' ? 0 : 1; }};
}
