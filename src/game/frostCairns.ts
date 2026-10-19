import * as THREE from 'three';
import {SNOW_WIND} from '../sim/world/snowGround';
import {addPatch} from '../world/materials';
import {boulderGeometry,snowSkirt} from './snowRocks';
import type {WayCairn} from './frostCairnsLayout';

/*
 * The way-cairns' parts (placed by frostCairnsLayout.ts, assembled by frostCamps.ts with its logs, lanterns and
 * fire): stones of the field boulders' rock stacked into a cairn; wool streamers dyed madder, red ochre, saffron
 * and woad, tied to the pole and streaming downwind, bleached toward the tail, frayed, fluttering on the GPU and
 * glowing through when the low sun is behind them; and warm pools of fire and lantern light on the snow.
 */

type Height=(x:number,z:number)=>number;

/** Cloth dyes, sRGB: red ochre, madder, saffron, woad, undyed wool. */
export const DYES=['#a63c1c','#8e2420','#cf8f22','#33508a','#d4c8ae'] as const;

const UP=new THREE.Vector3(0,1,0);
const WIND=new THREE.Vector3(SNOW_WIND[0],0,SNOW_WIND[1]).normalize();
/** Across the wind, level: the way a streamer flutters. */
const LAT=new THREE.Vector3().crossVectors(WIND,UP).normalize();

function stream(seed:number){let s=seed>>>0;return()=>(s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296;}

/**
 * A cairn round (c.x, c.z): flat stones in five courses, each smaller and set in from the one below, a capstone on
 * top; the bottom course banks into the drift. Returns the stones in world space and the height of its top.
 */
export function cairnStones(c:WayCairn,h:Height):{stones:THREE.BufferGeometry[];top:number}{
 const R=stream(c.seed*977+3),s=c.r,gy=h(c.x,c.z),stones:THREE.BufferGeometry[]=[],q=new THREE.Quaternion(),e=new THREE.Euler(),one=new THREE.Vector3(1,1,1);
 let seed=c.seed*100;
 const put=(r:number,ht:number,x:number,y:number,z:number,yaw:number,detail:number,skirt:boolean,tilt:number)=>{
  q.setFromEuler(e.set((R()-.5)*tilt,yaw,(R()-.5)*tilt,'YXZ'));
  let g=boulderGeometry({r,h:ht,seed:seed++},detail,1.4).applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),q,one));
  if(skirt)g=snowSkirt(g,x,z,h,.1+.06*r,.05+.05*r,seed);
  stones.push(g);
 };
 // [stones in the course, ring radius, stone radius, stone height, course height], all in units of the base radius.
 const courses=[[6,.62,.42,.25,0],[4,.4,.36,.22,.25],[3,.24,.31,.2,.47],[2,.1,.26,.17,.67]];
 courses.forEach(([n,ring,r,ht,y],k)=>{
  const off=R()*6.28;
  for(let i=0;i<n;i++){
   const a=off+i/n*Math.PI*2+(R()-.5)*.4,d=s*ring*(.92+R()*.16),x=c.x+Math.cos(a)*d,z=c.z+Math.sin(a)*d;
   // Each stone laid long side round the course, tipped a little in toward the heart.
   put(s*r*(.9+R()*.2),s*ht*(.85+R()*.3),x,(k?gy:h(x,z))+s*y-(k?0:.04),z,-a+Math.PI/2+(R()-.5)*.5,k?5:6,!k,.22);
  }
  if(!k)put(s*.48,s*.3,c.x,gy+.02,c.z,R()*6.28,6,true,.1);
 });
 put(s*.22,s*.15,c.x+(R()-.5)*.05,gy+s*.85,c.z+(R()-.5)*.05,R()*6.28,5,false,.3);
 return {stones,top:gy+s*.98};
}

/**
 * One streamer tied to a pole at `at` (its axis; the knot is on the downwind face): `len` long, `width` deep at the hoist, narrowing to the tail, drooping more
 * along its length as a wind-held cloth does. World space; aCloth is (along 0..1, across 0..1, seed, length).
 */
export function streamerGeometry(at:THREE.Vector3,len:number,width:number,dye:number,seed:number,droop=.3,pole=.07):THREE.BufferGeometry{
 const nU=22,nV=3,pos:number[]=[],cloth:number[]=[],col:number[]=[],nrm:number[]=[],idx:number[]=[];
 const c=new THREE.Color(DYES[dye]),p=at.clone().addScaledVector(WIND,pole),t=new THREE.Vector3(),b=new THREE.Vector3();
 const R=stream(seed*613+11),bend=(R()-.5)*.3;
 for(let i=0;i<=nU;i++){
  const u=i/nU,th=droop+.55*u*u,w=width*(1-.38*u);
  // The cloth's plane stands vertical along the wind; it sags, and swings a little off the wind along its length.
  t.copy(WIND).multiplyScalar(Math.cos(th)).addScaledVector(UP,-Math.sin(th)).addScaledVector(LAT,bend*u).normalize();
  b.crossVectors(LAT,t).normalize();
  if(b.y<0)b.negate();
  for(let j=0;j<=nV;j++){const v=j/nV,q=p.clone().addScaledVector(b,-w*v);pos.push(q.x,q.y,q.z);cloth.push(u,v,seed,len);col.push(c.r,c.g,c.b);nrm.push(LAT.x,LAT.y,LAT.z);}
  p.addScaledVector(t,len/nU);
 }
 for(let i=0;i<nU;i++)for(let j=0;j<nV;j++){const a=i*(nV+1)+j,bb=a+1,cc=a+nV+1,d=cc+1;idx.push(a,cc,bb,bb,cc,d);}
 const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(nrm,3));
 g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));g.setAttribute('aCloth',new THREE.Float32BufferAttribute(cloth,4));
 g.setIndex(idx);
 return g;
}

/** Dyed wool in the wind. `sun` lights it through from behind. Call update(time) each frame. */
export function clothMaterial(sun:{dir:THREE.Vector3;color:THREE.Color}){
 const m=new THREE.MeshStandardMaterial({name:'frostlight-cairn-cloth',color:'#ffffff',roughness:.92,metalness:0,side:THREE.DoubleSide,vertexColors:true});
 const uniforms={uTime:{value:0},uLat:{value:LAT.clone()},uWind:{value:WIND.clone()},uSunDir:{value:sun.dir},uSunCol:{value:sun.color}};
 addPatch(m,'frostlight-cairn-cloth',shader=>{
  Object.assign(shader.uniforms,uniforms);
  shader.vertexShader=shader.vertexShader
   .replace('#include <common>','#include <common>\nattribute vec4 aCloth;\nuniform float uTime;\nuniform vec3 uLat;\nuniform vec3 uWind;\nvarying vec4 vCloth;')
   .replace('#include <beginnormal_vertex>',/* glsl */`
    // A travelling wave down the streamer, growing toward the free end; a second, shorter one breaks it up.
    float clU=aCloth.x,clS=aCloth.x*aCloth.w,clPh=aCloth.z*2.39,clK=6.2832/1.15;
    float clAmp=.17*pow(clU,1.15)*(.75+.25*sin(uTime*.6+clPh));
    float clA=clK*clS-uTime*7.2+clPh,clB=2.3*clK*clS-uTime*10.5+clPh*1.7;
    float clWave=sin(clA)+.35*sin(clB),clSlope=clAmp*(clK*cos(clA)+.35*2.3*clK*cos(clB));
    vec3 clOff=uLat*clAmp*clWave+vec3(0.,.05*clU*clU*sin(clK*clS*.5-uTime*4.6+clPh),0.);
    vec3 objectNormal=normalize(uLat-uWind*clSlope);
    vCloth=aCloth;`)
   .replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed+=clOff;');
  shader.fragmentShader=shader.fragmentShader
   .replace('#include <common>',/* glsl */`#include <common>
uniform vec3 uSunDir;
uniform vec3 uSunCol;
varying vec4 vCloth;
float clH(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float clN(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(clH(i),clH(i+vec2(1.,0.)),f.x),mix(clH(i+vec2(0.,1.)),clH(i+vec2(1.)),f.x),f.y);}`)
   .replace('#include <alphatest_fragment>',/* glsl */`#include <alphatest_fragment>
    {
     float u=vCloth.x,v=vCloth.y,L=vCloth.w;vec2 q=vec2(u*L,v*.3);
     // Frayed: threads hang loose at the tail and the edges; the long streamers end in a swallow tail.
     float fray=clN(q*vec2(9.,60.)+vCloth.z)*.7+clN(q*vec2(31.,140.))*.3;
     if(u>.86&&fray<(u-.86)*5.5)discard;
     if(min(v,1.-v)<.06&&fray<.18*(1.-min(v,1.-v)/.06))discard;
     if(L>2.&&u>1.-.16*(1.-abs(2.*v-1.)))discard;
    }`)
   .replace('#include <color_fragment>',/* glsl */`#include <color_fragment>
    {
     float u=vCloth.x,v=vCloth.y,L=vCloth.w;vec2 q=vec2(u*L,v*.3);
     // Slubbed wool, sun-bleached toward the tail and along the top edge, grimed at the knot.
     float slub=.9+.1*clN(q*vec2(14.,90.))+.06*(clN(q*vec2(70.,9.))-.5);
     vec3 bleach=mix(diffuseColor.rgb,vec3(.62,.55,.45)*dot(diffuseColor.rgb,vec3(.6,.3,.1))*2.2,.5);
     diffuseColor.rgb=mix(diffuseColor.rgb,bleach,clamp(u*.55+(1.-v)*.15,0.,.75))*slub*mix(.62,1.,smoothstep(0.,.07,u));
    }`)
   .replace('#include <emissivemap_fragment>',/* glsl */`#include <emissivemap_fragment>
    {
     // Thin wool lets the low sun through: lit from behind it glows in its own dye.
     vec3 sv=normalize((viewMatrix*vec4(uSunDir,0.)).xyz);
     float back=max(0.,-dot(normal,sv));
     totalEmissiveRadiance+=diffuseColor.rgb*uSunCol*back*.32;
    }`);
 });
 return {material:m,update(time:number){uniforms.uTime.value=time;}};
}

const POOL_VERT=/* glsl */`
attribute vec4 aPool; // r 0..1, power, seed, unused
uniform float uTime;
varying float vA;
varying vec3 vColor;
#include <fog_pars_vertex>
void main(){
 float f=.86+.14*sin(uTime*6.3+aPool.z*7.)*sin(uTime*3.9+aPool.z*3.);
 vA=aPool.y*pow(1.-aPool.x,2.2)*f;vColor=color;
 vec4 mvPosition=modelViewMatrix*vec4(position,1.);
 gl_Position=projectionMatrix*mvPosition;
 #include <fog_vertex>
}`;
const POOL_FRAG=/* glsl */`
varying float vA;
varying vec3 vColor;
#include <fog_pars_fragment>
void main(){
 gl_FragColor=vec4(vColor*vA,1.);
 #ifdef USE_FOG
  #ifdef FOG_EXP2
   gl_FragColor.rgb*=exp(-fogDensity*fogDensity*vFogDepth*vFogDepth);
  #else
   gl_FragColor.rgb*=1.-smoothstep(fogNear,fogFar,vFogDepth);
  #endif
 #endif
}`;

export interface Pool {x:number;z:number;r:number;color:THREE.ColorRepresentation;power:number}
/** Fire and lantern light on the snow: additive discs draped over the ground, flickering with their flames. */
export function lightPools(pools:readonly Pool[],h:Height){
 const geos:THREE.BufferGeometry[]=[],c=new THREE.Color();
 pools.forEach((p,k)=>{
  const nR=7,nA=28,pos:number[]=[],attr:number[]=[],col:number[]=[],idx:number[]=[];
  c.set(p.color);
  for(let i=0;i<=nR;i++)for(let j=0;j<(i?nA:1);j++){const r=p.r*i/nR,a=j/nA*Math.PI*2,x=p.x+Math.cos(a)*r,z=p.z+Math.sin(a)*r;pos.push(x,h(x,z)+.05,z);attr.push(i/nR,p.power,k,0);col.push(c.r,c.g,c.b);}
  const ring=(i:number)=>i?1+(i-1)*nA:0;
  for(let j=0;j<nA;j++)idx.push(0,1+(j+1)%nA,1+j);
  for(let i=1;i<nR;i++)for(let j=0;j<nA;j++){const a=ring(i)+j,b=ring(i)+(j+1)%nA,cc=ring(i+1)+j,d=ring(i+1)+(j+1)%nA;idx.push(a,b,cc,b,d,cc);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('aPool',new THREE.Float32BufferAttribute(attr,4));g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));g.setIndex(idx);
  geos.push(g);
 });
 const uniforms=THREE.UniformsUtils.merge([THREE.UniformsLib.fog,{uTime:{value:0}}]);
 const material=new THREE.ShaderMaterial({name:'frostlight-light-pools',vertexShader:POOL_VERT,fragmentShader:POOL_FRAG,uniforms,vertexColors:true,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,fog:true,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-4});
 return {geos,material,update(time:number){uniforms.uTime.value=time;}};
}
