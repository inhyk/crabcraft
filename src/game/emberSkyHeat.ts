import * as THREE from 'three';
import type {LavaZone} from './emberLava';

/*
 * The lava's light on the island. One baked map over the island holds how hot the air is (R: the lava sea round the
 * shore, G: the crater and the flows) and which way the heat comes from (B, A: horizontal direction toward the lava).
 * Every lit World V material reads it in one texture fetch: an orange light from the lava's side and from below, strong
 * on faces turned to the lava, a little on everything near it, the shore's part fading with height above the sea.
 * It is added as albedo-weighted radiance, so dark basalt glows dark red and pale stone warm orange.
 * Materials are patched in place (chained onBeforeCompile); the uniforms are shared and gated by `uHeatOn`, so a kit
 * material another world also draws stays unlit there.
 */

const BOX = {minX: -160, minZ: -182, sizeX: 320, sizeZ: 368};
const RES = 256;
/** Where the island's ground meets the lava sea, in units of the island ellipse (realmHeight: 6 - (e - .83) * 85 = .15). */
const SHORE_E = .899;
const SEA_Y = .15;

const VERT_HEAD = /* glsl */ `
varying vec3 vHeatW;
varying vec3 vHeatN;
`;
const VERT_TAIL = /* glsl */ `
{
  vec4 hw=vec4(transformed,1.);
  #ifdef USE_BATCHING
  hw=batchingMatrix*hw;
  #endif
  #ifdef USE_INSTANCING
  hw=instanceMatrix*hw;
  #endif
  vHeatW=(modelMatrix*hw).xyz;
  vHeatN=(vec4(transformedNormal,0.)*viewMatrix).xyz;
}
`;
const FRAG_HEAD = /* glsl */ `
uniform sampler2D uHeatMap;
uniform vec4 uHeatBox;
uniform vec3 uHeatColor;
uniform float uHeatTime;
uniform float uHeatOn;
varying vec3 vHeatW;
varying vec3 vHeatN;
`;
const FRAG_TAIL = /* glsl */ `
if(uHeatOn>0.){
  vec4 hm=texture2D(uHeatMap,(vHeatW.xz-uHeatBox.xy)*uHeatBox.zw);
  float shore=hm.r*exp(-max(0.,vHeatW.y-${SEA_Y.toFixed(2)})*.1);
  vec3 L=normalize(vec3(hm.b,-.55,hm.a));
  float facing=max(0.,dot(normalize(vHeatN),L));
  float heat=(shore+hm.g)*(.45+1.7*facing);
  heat*=1.+.09*sin(uHeatTime*1.3+vHeatW.x*.21+vHeatW.z*.17)+.05*sin(uHeatTime*3.1+vHeatW.z*.5);
  totalEmissiveRadiance+=diffuseColor.rgb*uHeatColor*heat*uHeatOn*EMBER_HEAT_SCALE;
}
`;

export interface HeatSample {shore:number;flow:number;dx:number;dz:number}

/** The heat reaches 8 m from the lava's edge at full strength and is gone by 15 m: beyond that the island is cool basalt. */
const reach=(d:number)=>{const t=Math.min(1,Math.max(0,(d-8)/7));return 1-t*t*(3-2*t);};

/** Pure bake of the heat map (RGBA float, RES x RES over BOX). */
export function bakeEmberHeat(zones:readonly LavaZone[]):Float32Array {
 const data=new Float32Array(RES*RES*4),total=new Float32Array(RES*RES);
 for(let j=0;j<RES;j++)for(let i=0;i<RES;i++){
  const x=BOX.minX+(i+.5)/RES*BOX.sizeX,z=BOX.minZ+(j+.5)/RES*BOX.sizeZ;
  const e=Math.hypot(x/128,(z-2)/155);
  let shore=1;
  if(e<SHORE_E){const r=Math.hypot(x,z-2),d=(SHORE_E-e)*(e>.02?r/e:140);shore=Math.exp(-d/10)*reach(d);}
  let flow=0;
  for(const zn of zones){const w=zn.kind==='crater'?.75:zn.kind==='toe'?1:.8,c=Math.hypot(x-zn.x,z-zn.z);flow+=w*Math.exp(-Math.max(0,c-zn.radius*.75)/4.5)*reach(Math.max(0,c-zn.radius));}
  flow=Math.min(1.4,flow);
  const k=(j*RES+i)*4;data[k]=shore;data[k+1]=flow;total[j*RES+i]=shore+flow;
 }
 // Direction toward the heat: the gradient of the total, normalised where it is meaningful.
 for(let j=0;j<RES;j++)for(let i=0;i<RES;i++){
  const t=(a:number,b:number)=>total[Math.min(RES-1,Math.max(0,b))*RES+Math.min(RES-1,Math.max(0,a))];
  const gx=(t(i+1,j)-t(i-1,j))/(2*BOX.sizeX/RES),gz=(t(i,j+1)-t(i,j-1))/(2*BOX.sizeZ/RES);
  const g=Math.hypot(gx,gz),k=(j*RES+i)*4,s=g>1e-5?Math.min(1,g*40)/g:0;
  data[k+2]=gx*s;data[k+3]=gz*s;
 }
 return data;
}

export class EmberHeat {
 readonly texture:THREE.DataTexture;
 readonly uniforms={
  uHeatMap:{value:null as THREE.Texture|null},
  uHeatBox:{value:new THREE.Vector4(BOX.minX,BOX.minZ,1/BOX.sizeX,1/BOX.sizeZ)},
  uHeatColor:{value:new THREE.Color('#ff5a1e').multiplyScalar(1.4)},
  uHeatTime:{value:0},
  uHeatOn:{value:0},
 };
 private readonly data:Float32Array;
 private readonly seen=new WeakSet<THREE.Material>();
 constructor(zones:readonly LavaZone[]){
  this.data=bakeEmberHeat(zones);
  const half=new Uint16Array(this.data.length);for(let i=0;i<half.length;i++)half[i]=THREE.DataUtils.toHalfFloat(this.data[i]);
  this.texture=new THREE.DataTexture(half,RES,RES,THREE.RGBAFormat,THREE.HalfFloatType);
  this.texture.minFilter=this.texture.magFilter=THREE.LinearFilter;this.texture.wrapS=this.texture.wrapT=THREE.ClampToEdgeWrapping;
  this.texture.colorSpace=THREE.NoColorSpace;this.texture.needsUpdate=true;
  this.uniforms.uHeatMap.value=this.texture;
 }
 /** CPU read of the map (bilinear), for placing things or for QA. */
 sample(x:number,z:number,out:HeatSample={shore:0,flow:0,dx:0,dz:0}):HeatSample{
  const fx=Math.min(RES-1.001,Math.max(0,(x-BOX.minX)/BOX.sizeX*RES-.5)),fz=Math.min(RES-1.001,Math.max(0,(z-BOX.minZ)/BOX.sizeZ*RES-.5));
  const i=Math.floor(fx),j=Math.floor(fz),tx=fx-i,tz=fz-j,d=this.data;
  const at=(c:number)=>{const a=d[(j*RES+i)*4+c],b=d[(j*RES+i+1)*4+c],e=d[((j+1)*RES+i)*4+c],f=d[((j+1)*RES+i+1)*4+c];return (a*(1-tx)+b*tx)*(1-tz)+(e*(1-tx)+f*tx)*tz;};
  out.shore=at(0);out.flow=at(1);out.dx=at(2);out.dz=at(3);return out;
 }
 /** Adds the heat light to one lit material (standard, physical, lambert, phong); others are left alone. */
 patch(m:THREE.Material):boolean{
  if(this.seen.has(m))return false;this.seen.add(m);
  if(!(m instanceof THREE.MeshStandardMaterial||m instanceof THREE.MeshLambertMaterial||m instanceof THREE.MeshPhongMaterial))return false;
  if(m.userData.noEmberHeat)return false;
  // userData.emberHeatScale: a surface that should take less of it (the volcano's cone stands in its own flows).
  const prev=m.onBeforeCompile,prevKey=m.customProgramCacheKey,u=this.uniforms,scale=(+m.userData.emberHeatScale||1).toFixed(3);
  m.onBeforeCompile=function(this:THREE.Material,shader,renderer){
   prev.call(this,shader,renderer);
   if(!shader.vertexShader.includes('#include <project_vertex>')||!shader.fragmentShader.includes('#include <emissivemap_fragment>'))return;
   Object.assign(shader.uniforms,u);
   shader.vertexShader=VERT_HEAD+shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\n'+VERT_TAIL);
   shader.fragmentShader=`#define EMBER_HEAT_SCALE ${scale}\n`+FRAG_HEAD+shader.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\n'+FRAG_TAIL);
  };
  m.customProgramCacheKey=function(this:THREE.Material){return prevKey.call(this)+'|ember-heat'+(scale==='1.000'?'':scale);};
  m.needsUpdate=true;
  return true;
 }
 /** Patches every lit material under `root` not seen before, skipping the given subtrees. Returns how many were new. */
 patchTree(root:THREE.Object3D,skip:readonly THREE.Object3D[]):number{
  let n=0;
  const walk=(o:THREE.Object3D)=>{
   if(skip.includes(o))return;
   const mat=(o as THREE.Mesh).material;
   if(mat&&(o as THREE.Mesh).isMesh)for(const m of Array.isArray(mat)?mat:[mat])if(this.patch(m))n++;
   for(const c of o.children)walk(c);
  };
  walk(root);return n;
 }
}
