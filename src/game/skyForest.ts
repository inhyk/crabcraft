import * as THREE from 'three';
import {useRim} from './skybloomRim';
import {loadKit,harmonise,type Kit} from '../world/kit';
import {WORLD_UNIFORMS} from '../world/materials';
import {boulderGeometry} from './snowRocks';
import {skyHash,skyHeight,skyProps,skyTrees,type SkyTreeSpecies} from './skyGroundLayout';

/*
 * Skybloom's forest and undergrowth from the Stylized Nature MegaKit (CC0, NOTICE.md), recoloured for the sky island
 * so it never reads as World I's woods: jade and teal crowns, blossom trees in pink and white, silver twisted elders,
 * all on pale silver-grey bark with moss on the up-facing side and at the foot; mossy cream boulders, fallen silver
 * logs, shrubs, ferns, flower clumps and a few mushrooms in clusters round the views' focal groups. One BatchedMesh per
 * kit material; each instance carries its own tint (BatchedMesh colours), so a whole species mix is one draw.
 */

const COMMON=['CommonTree_1','CommonTree_2','CommonTree_3','CommonTree_4','CommonTree_5'];
const TWISTED=['TwistedTree_1','TwistedTree_2','TwistedTree_3'];
const srgb=(hex:string)=>new THREE.Color(hex);
/** Crown tints per species (linear), picked per tree. */
const CROWNS:Record<SkyTreeSpecies,THREE.Color[]>={
 jade:[srgb('#3f8f80'),srgb('#5fae95'),srgb('#4c9c86'),srgb('#57a48a')],
 silver:[srgb('#6fb3a6'),srgb('#7cc0ad'),srgb('#62a59f')],
 blossom:[srgb('#ec9cc4'),srgb('#e48cba'),srgb('#f2b2d2')],
 // The 'white' blossom species: pale pink, so the crowns read as foliage masses rather than white blobs (r3).
 white:[srgb('#f2d6de'),srgb('#f0d0da'),srgb('#f4dbe2')],
};
const BARK=[srgb('#b9b6b2'),srgb('#c4c2bf'),srgb('#adaaa8')];
/** Tree height (m) at spot scale 1; the colliders stay the spots' own (layoutFrontier). */
const TREE_H={common:11.5,twisted:10.5};

const LEAF_HEAD=/* glsl */`
varying vec3 vSfTint;
varying float vSfAo;
varying vec3 vSfW;
varying float vSfY;
`;
/** Leaves: the kit's alpha cut-out and baked shading (vertex colour), the instance's tint, a little hue drift. */
function leafMaterial(src:THREE.Material,name:string,blossomRim:boolean):THREE.Material{
 const m=src.clone() as THREE.MeshStandardMaterial;m.name=name;m.vertexColors=true;m.roughness=.78;m.metalness=0;
 m.onBeforeCompile=shader=>{
  shader.uniforms.uTime=WORLD_UNIFORMS.uTime;shader.uniforms.uWind=WORLD_UNIFORMS.uWind;
  shader.vertexShader=shader.vertexShader
   .replace('#include <common>',`#include <common>\n${LEAF_HEAD}\nuniform float uTime;\nuniform vec2 uWind;`)
   .replace('#include <color_vertex>',`#include <color_vertex>
    vSfAo=dot(color.rgb,vec3(.333));vSfY=position.y;
    #ifdef USE_BATCHING_COLOR
    vSfTint=getBatchingColor(getIndirectIndex(gl_DrawID)).rgb;
    #else
    vSfTint=vec3(1.);
    #endif`)
   .replace('#include <begin_vertex>',`#include <begin_vertex>
    {
      vec3 o=vec3(0.);
      #ifdef USE_BATCHING
      o=getBatchingMatrix(getIndirectIndex(gl_DrawID))[3].xyz;
      #endif
      float h=max(position.y,0.)/6.;float ph=dot(o.xz,vec2(.11,.07));
      float gust=sin(uTime*.8+ph)*.6+sin(uTime*1.9+ph*1.7)*.3+.35;
      transformed.xz+=uWind*gust*.05*h*h;
      transformed+=normal*sin(uTime*5.+dot(position,vec3(3.1,2.3,1.7))+ph)*.012*h;
    }`)
   .replace('#include <fog_vertex>','#include <fog_vertex>\nvSfW=(modelMatrix*vec4(transformed,1.)).xyz;');
  shader.fragmentShader=shader.fragmentShader
   .replace('#include <common>',`#include <common>\n${LEAF_HEAD}\nfloat sfH(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}`)
   .replace('#include <color_fragment>',`
    // The kit's baked shading: deep inside the crown, bright on its outer shell; tint from the instance.
    float sfL=smoothstep(.05,.95,vSfAo);
    vec3 sfC=vSfTint*mix(.55,1.15,sfL);
    // Pale pink blossom crowns (#f2d6de): a dusky mauve shade inside and under the crown, the tint only on the sunlit
    // outer shell, so each crown reads as masses with form instead of a flat white blob (advisor #21 a, r3).
    if(vSfTint.r>.8&&min(vSfTint.g,vSfTint.b)>.6){
      // Kit crowns span about y 2.4..9 (metres before the instance scale): the lower half sits in its own shade.
      float sfUp=smoothstep(3.,8.,vSfY);
      sfC=mix(vec3(.34,.19,.28),vSfTint*1.04,smoothstep(.12,1.,sfL*.75+sfUp*.45));}
    // Patches across a crown drift a little in hue and value, so a canopy reads as masses, not one colour.
    float sfN=sfH(floor(vSfW*.7));
    sfC*=.9+.2*sfN;
    ${blossomRim?'sfC=mix(sfC,sfC*vec3(.78,.62,.74),(1.-sfL)*.55);':'sfC=mix(sfC,sfC*vec3(.7,.86,1.),(1.-sfL)*.45);'}
    diffuseColor.rgb=sfC;`);
  useRim(shader,.8,.45);
 };
 m.customProgramCacheKey=()=>name;
 return m;
}
/** Bark: the kit's grain as value only, pale silver-grey, moss on the up-facing side and round the foot. */
function barkMaterial(src:THREE.Material,name:string):THREE.Material{
 const m=src.clone() as THREE.MeshStandardMaterial;m.name=name;m.vertexColors=true;m.roughness=.9;m.metalness=0;
 m.onBeforeCompile=shader=>{
  shader.vertexShader=shader.vertexShader
   .replace('#include <common>','#include <common>\nvarying vec3 vSfTint;\nvarying float vSfY;\nvarying vec3 vSfWN;\nvarying vec3 vSfW;')
   .replace('#include <color_vertex>',`#include <color_vertex>
    #ifdef USE_BATCHING_COLOR
    vSfTint=getBatchingColor(getIndirectIndex(gl_DrawID)).rgb;
    #else
    vSfTint=vec3(1.);
    #endif
    vSfY=position.y;`)
   .replace('#include <fog_vertex>','#include <fog_vertex>\nvSfW=(modelMatrix*vec4(transformed,1.)).xyz;vSfWN=normalize(mat3(modelMatrix)*objectNormal);');
  shader.fragmentShader=shader.fragmentShader
   .replace('#include <common>','#include <common>\nvarying vec3 vSfTint;\nvarying float vSfY;\nvarying vec3 vSfWN;\nvarying vec3 vSfW;\nfloat sfH(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}\nfloat sfN(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(sfH(i),sfH(i+vec3(1,0,0)),f.x),mix(sfH(i+vec3(0,1,0)),sfH(i+vec3(1,1,0)),f.x),f.y),mix(mix(sfH(i+vec3(0,0,1)),sfH(i+vec3(1,0,1)),f.x),mix(sfH(i+vec3(0,1,1)),sfH(i+vec3(1,1,1)),f.x),f.y),f.z);}')
   .replace('#include <color_fragment>',`
    float sfG=dot(diffuseColor.rgb,vec3(.299,.587,.114));
    // Grain: the kit's furrows deepened, the ridges silvered.
    vec3 sfC=vSfTint*mix(.6,1.2,smoothstep(.08,.45,sfG));
    // Moss: on the side that faces up and the sky-wet north, thickest at the foot; lichen flecks higher up.
    float sfM=smoothstep(.15,.65,vSfWN.y*.7+(-vSfWN.z)*.25+sfN(vSfW*1.7)*.5-.25)+(1.-smoothstep(.0,1.6,vSfY))*.75;
    sfM=clamp(sfM*smoothstep(.35,.6,sfN(vSfW*3.1+7.)),0.,1.);
    sfC=mix(sfC,mix(vec3(.07,.13,.05),vec3(.17,.26,.08),sfN(vSfW*6.)),sfM*.85);
    sfC=mix(sfC,vec3(.62,.66,.5),smoothstep(.78,.86,sfN(vSfW*4.3+2.))*.35*(1.-sfM));
    diffuseColor.rgb=sfC;`);
 };
 m.customProgramCacheKey=()=>name;
 return m;
}
/** Boulders: sculpted limestone (snowRocks.boulderGeometry), cream in its beds, moss cushions on what faces up. */
function limestoneMaterial():THREE.Material{
 const m=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.9,metalness:0,vertexColors:true});m.name='skybloom-mossy-limestone';
 m.onBeforeCompile=shader=>{
  shader.vertexShader=shader.vertexShader
   .replace('#include <common>','#include <common>\nvarying vec3 vSfWN;\nvarying vec3 vSfTint;\nvarying vec3 vSfVc;\nvarying vec3 vSfW;')
   .replace('#include <color_vertex>',`#include <color_vertex>
    vSfVc=color.rgb;
    #ifdef USE_BATCHING_COLOR
    vSfTint=getBatchingColor(getIndirectIndex(gl_DrawID)).rgb;
    #else
    vSfTint=vec3(1.);
    #endif`)
   .replace('#include <fog_vertex>','#include <fog_vertex>\nvSfWN=normalize(mat3(modelMatrix)*objectNormal);vSfW=(modelMatrix*vec4(transformed,1.)).xyz;');
  shader.fragmentShader=shader.fragmentShader
   .replace('#include <common>','#include <common>\nvarying vec3 vSfWN;\nvarying vec3 vSfTint;\nvarying vec3 vSfVc;\nvarying vec3 vSfW;\nfloat sfH(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}\nfloat sfN(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(sfH(i),sfH(i+vec3(1,0,0)),f.x),mix(sfH(i+vec3(0,1,0)),sfH(i+vec3(1,1,0)),f.x),f.y),mix(mix(sfH(i+vec3(0,0,1)),sfH(i+vec3(1,0,1)),f.x),mix(sfH(i+vec3(0,1,1)),sfH(i+vec3(1,1,1)),f.x),f.y),f.z);}')
   .replace('#include <color_fragment>',`
    // Stone: the bed's own tone, grooves and partings darker, a weathered speckle.
    float sfS=sfN(vSfW*3.7)*.6+sfN(vSfW*11.)*.4;
    vec3 sfStone=vSfTint*vSfVc.g*mix(.82,1.08,sfS)*mix(.55,1.,vSfVc.r);
    // Rain streaks down the faces, darker grey-green.
    sfStone*=mix(1.,.78,smoothstep(.55,.8,sfN(vec3(vSfW.x*6.,vSfW.y*.6,vSfW.z*6.)))*(1.-abs(vSfWN.y)));
    // Moss cushions on what faces up and spills a little down the north side; yellow-green crowns, deep at the edge.
    float sfMoss=smoothstep(.35,.75,vSfWN.y+(-vSfWN.z)*.2+(sfN(vSfW*1.6)-.5)*.7);
    vec3 sfMossC=mix(vec3(.07,.15,.05),vec3(.2,.32,.08),smoothstep(.3,.8,sfN(vSfW*5.)));
    vec3 sfC=mix(sfStone,sfMossC,sfMoss);
    // Pale lichen rosettes on the bare faces.
    sfC=mix(sfC,vec3(.72,.74,.6),smoothstep(.8,.86,sfN(vSfW*7.3+3.))*(1.-sfMoss)*.6);
    diffuseColor.rgb=sfC;`);
 };
 m.customProgramCacheKey=()=>'skybloom-mossy-limestone';
 return m;
}
/** Ferns, shrubs' leaves and flower clumps: luminance of the kit atlas times the instance's tint. */
function tintMaterial(src:THREE.Material,name:string,keep:number):THREE.Material{
 const m=src.clone() as THREE.MeshStandardMaterial;m.name=name;m.vertexColors=true;m.roughness=.8;m.metalness=0;
 m.onBeforeCompile=shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vSfTint;\nvarying float vSfAo;')
   .replace('#include <color_vertex>',`#include <color_vertex>
    vSfAo=dot(color.rgb,vec3(.333));
    #ifdef USE_BATCHING_COLOR
    vSfTint=getBatchingColor(getIndirectIndex(gl_DrawID)).rgb;
    #else
    vSfTint=vec3(1.);
    #endif`);
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vSfTint;\nvarying float vSfAo;')
   .replace('#include <color_fragment>',`
    float sfL=dot(diffuseColor.rgb,vec3(.299,.587,.114));
    vec3 sfC=mix(vSfTint*mix(.7,1.25,smoothstep(.05,.5,sfL)),diffuseColor.rgb,${keep.toFixed(2)});
    diffuseColor.rgb=sfC*mix(.75,1.,smoothstep(.0,.8,vSfAo));`);
 };
 m.customProgramCacheKey=()=>name;
 return m;
}

/** A fallen log along +x, `len` long: a bent tapering trunk with broken ends, a stub branch and root plate. */
function logGeometry(len:number,seed:number):THREE.BufferGeometry{
 const pts:THREE.Vector3[]=[];for(let k=0;k<=5;k++){const u=k/5;pts.push(new THREE.Vector3((u-.5)*len,Math.sin(u*3+seed)*.06,Math.sin(u*2.3+seed*2)*.25));}
 const curve=new THREE.CatmullRomCurve3(pts),segs=14,radial=12,frames=curve.computeFrenetFrames(segs,false);
 const pos:number[]=[],uv:number[]=[],idx:number[]=[],p=new THREE.Vector3();
 const r0=.5+.08*skyHash(seed,1,3);
 for(let j=0;j<=segs;j++){
  const u=j/segs;curve.getPointAt(u,p);const N=frames.normals[j],B=frames.binormals[j];
  // Root end flares, the top end thins; bark folds wind along the log.
  const rad=r0*(1-.32*u)*(1+.45*Math.exp(-u*14));
  for(let k=0;k<=radial;k++){
   const a=k/radial*Math.PI*2,fold=1+.1*Math.sin(a*6+u*4+seed)+.05*Math.sin(a*13-u*9),broken=(j===0||j===segs)?(.85+.3*skyHash(seed*31+k,j,5)):1;
   const c=Math.cos(a)*rad*fold*broken,s=Math.sin(a)*rad*fold*broken;
   pos.push(p.x+N.x*c+B.x*s,p.y+N.y*c+B.y*s,p.z+N.z*c+B.z*s);uv.push(k/radial*2,u*len*.5);
  }
 }
 for(let j=0;j<segs;j++)for(let k=0;k<radial;k++){const a=j*(radial+1)+k,b=a+radial+1;idx.push(a,b,a+1,a+1,b,b+1);}
 // Splintered end caps.
 for(const j of [0,segs]){curve.getPointAt(j/segs,p);const c=pos.length/3;pos.push(p.x+(j?.12:-.12),p.y,p.z);uv.push(.5,.5);for(let k=0;k<radial;k++){const a=j*(radial+1)+k;if(j)idx.push(a,c,a+1);else idx.push(a,a+1,c);}}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();
 const n=pos.length/3,col=new Float32Array(n*4).fill(1);g.setAttribute('color',new THREE.BufferAttribute(col,4));
 return g;
}

interface Entry{geo:THREE.BufferGeometry;items:{m:THREE.Matrix4;c:THREE.Color}[]}
/** Collects kit pieces and extra geometries per kit material, each instance with its own tint. */
class TintBatch{
 readonly byMat=new Map<THREE.Material,Map<THREE.BufferGeometry,Entry>>();
 constructor(readonly kit:Kit){}
 addGeo(mat:THREE.Material,geo:THREE.BufferGeometry,m:THREE.Matrix4,c:THREE.Color){
  let geos=this.byMat.get(mat);if(!geos)this.byMat.set(mat,geos=new Map());
  let e=geos.get(geo);if(!e)geos.set(geo,e={geo,items:[]});e.items.push({m:m.clone(),c:c.clone()});
 }
 add(piece:string,m:THREE.Matrix4,tint:(material:string)=>THREE.Color){for(const part of this.kit.get(piece).parts)this.addGeo(part.material,part.geometry,m,tint(part.material.name));}
 build(name:string,materialFor:(m:THREE.Material)=>{material:THREE.Material;shadow:boolean}):THREE.Group{
  const group=new THREE.Group();group.name=name;
  for(const [mat,geos] of this.byMat){
   const entries=[...geos.values()],clones=entries.map(e=>e.geo.clone());harmonise(clones);
   for(const g of clones){const c=g.getAttribute('color');if(!c){g.setAttribute('color',new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count*4).fill(1),4));}}
   let inst=0,verts=0,idx=0;entries.forEach((e,i)=>{inst+=e.items.length;verts+=clones[i].getAttribute('position').count;idx+=clones[i].getIndex()!.count;});
   const {material,shadow}=materialFor(mat);
   const bm=new THREE.BatchedMesh(inst,verts,idx,material);bm.sortObjects=false;bm.perObjectFrustumCulled=true;
   entries.forEach((e,i)=>{
    const g=clones[i];g.computeBoundingBox();g.boundingBox!.expandByScalar(.4);g.computeBoundingSphere();g.boundingSphere!.radius+=.4;
    const gid=bm.addGeometry(g);for(const it of e.items){const id=bm.addInstance(gid);bm.setMatrixAt(id,it.m);bm.setColorAt(id,it.c);}
   });
   bm.computeBoundingBox();bm.computeBoundingSphere();bm.castShadow=shadow;bm.receiveShadow=true;bm.name=`${name}:${material.name}`;group.add(bm);
  }
  return group;
 }
}

const _q=new THREE.Quaternion(),_e=new THREE.Euler(),_p=new THREE.Vector3(),_s=new THREE.Vector3();
const trs=(x:number,y:number,z:number,yaw:number,sx:number,sy=sx,sz=sx,pitch=0,roll=0)=>new THREE.Matrix4().compose(_p.set(x,y,z),_q.setFromEuler(_e.set(pitch,yaw,roll,'YXZ')),_s.set(sx,sy,sz));
const pick=<T,>(list:readonly T[],h:number)=>list[Math.min(list.length-1,Math.floor(h*list.length))];

/** The forest and undergrowth (async: the kit loads once and is shared with the other worlds' builds). */
export async function skyForest():Promise<THREE.Group>{
 const kit=await loadKit('models/world/nature.glb');
 const batch=new TintBatch(kit),white=new THREE.Color(1,1,1);
 const stats={trees:0,species:{} as Record<string,number>,shrubs:0,ferns:0,boulders:0,stones:0,logs:0,flowers:0,mushrooms:0};
 for(const t of skyTrees()){
  const twisted=t.species==='silver',names=twisted?TWISTED:COMMON,piece=pick(names,skyHash(t.i,5,71)),box=kit.get(piece).box;
  // Blossom and white trees are a little smaller and rounder; the silver elders broad and low.
  const H=(twisted?TREE_H.twisted:TREE_H.common)*t.s*t.grand*(t.species==='blossom'||t.species==='white'?.88:1)*(.92+.16*skyHash(t.i,6,72));
  const sc=H/(box.max.y-box.min.y),wide=twisted?1.2:t.species==='jade'?1.05:1.12;
  const m=trs(t.x,skyHeight(t.x,t.z)-.25*sc,t.z,t.yaw,sc*wide,sc,sc*wide,(skyHash(t.i,8,73)-.5)*.05,(skyHash(t.i,9,74)-.5)*.05);
  const crown=pick(CROWNS[t.species],skyHash(t.i,10,75)),bark=pick(BARK,skyHash(t.i,11,76));
  batch.add(piece,m,mat=>mat.startsWith('Bark')?bark:crown);
  stats.trees++;stats.species[t.species]=(stats.species[t.species]??0)+1;
 }
 const logGeo=new Map<number,THREE.BufferGeometry>(),rockGeo=new Map<number,THREE.BufferGeometry>(),limestone=limestoneMaterial();
 const barkTwisted=kit.get('TwistedTree_1').parts.find(p=>p.material.name.startsWith('Bark'))!.material;
 for(const [k,p] of skyProps().entries()){
  const y=skyHeight(p.x,p.z),h=skyHash(k,1,81);
  if(p.kind==='boulder'||p.kind==='stone'){
   // A few sculpted shapes, each placed many times turned and scaled; sunk a little into the turf.
   const big=p.kind==='boulder',key=(big?0:10)+Math.floor(h*4);let g=rockGeo.get(key);
   if(!g)rockGeo.set(key,g=boulderGeometry({r:big?1.3:.6,h:big?1.05:.45,seed:907+key},big?12:8));
   const sc=p.s/(big?1.3:.6)*(big?1.05:1.1);
   batch.addGeo(limestone,g,trs(p.x,y-.12*sc,p.z,p.yaw,sc,sc*(.85+.3*skyHash(k,2,82)),sc*(.9+.2*skyHash(k,3,83)),(skyHash(k,3,83)-.5)*.12,(skyHash(k,4,84)-.5)*.12),pick([srgb('#e6dcc4'),srgb('#ddd2b8'),srgb('#d4c8ac')],skyHash(k,5,85)));
   big?stats.boulders++:stats.stones++;
  }else if(p.kind==='log'){
   const key=Math.floor(h*3);let g=logGeo.get(key);if(!g)logGeo.set(key,g=logGeometry(5,key+1));
   batch.addGeo(barkTwisted,g,trs(p.x,y+.28,p.z,-p.yaw,p.s/5,1,1,0,(skyHash(k,6,86)-.5)*.08),pick(BARK,h));stats.logs++;
  }else if(p.kind==='shrub'){
   const box=kit.get('Bush_Common').box,sc=(1.5+.8*h)*p.s/(box.max.y-box.min.y);
   batch.add('Bush_Common',trs(p.x,y-.1,p.z,p.yaw,sc*1.15,sc,sc*1.15),()=>pick([srgb('#3f8f80'),srgb('#4f8f63'),srgb('#5fae95'),srgb('#3d6f66')],skyHash(k,7,87)));stats.shrubs++;
  }else if(p.kind==='bloomshrub'){
   const box=kit.get('Bush_Common_Flowers').box,sc=(1.4+.6*h)*p.s/(box.max.y-box.min.y),bloom=pick([srgb('#f2b8c6'),srgb('#f7f3ea'),srgb('#b8a6e8')],skyHash(k,8,88));
   batch.add('Bush_Common_Flowers',trs(p.x,y-.1,p.z,p.yaw,sc*1.1,sc,sc*1.1),mat=>mat==='Flowers'?bloom:srgb('#4c9c86'));stats.shrubs++;
  }else if(p.kind==='fern'){
   const piece=pick(['Fern_1','Fern_1','Fern_1','Plant_1_Big'],h),box=kit.get(piece).box,sc=(.9+.6*skyHash(k,9,89))*p.s/(box.max.y-box.min.y);
   batch.add(piece,trs(p.x,y-.05,p.z,p.yaw,sc*1.2,sc,sc*1.2),()=>pick([srgb('#6fa86a'),srgb('#7fb27a'),srgb('#5fae95')],skyHash(k,10,90)));stats.ferns++;
  }else if(p.kind==='flowers'){
   const piece=pick(['Flower_3_Group','Flower_4_Group'],h),box=kit.get(piece).box,sc=(.55+.25*skyHash(k,11,91))*p.s/(box.max.y-box.min.y),bloom=pick([srgb('#f2b8c6'),srgb('#f7f3ea'),srgb('#b8a6e8'),srgb('#f3dc8a')],skyHash(k,12,92));
   batch.add(piece,trs(p.x,y-.03,p.z,p.yaw,sc*1.4,sc,sc*1.4),mat=>mat==='Flowers'?bloom:srgb('#5f9e5e'));stats.flowers++;
  }else if(p.kind==='mushroom'){
   const box=kit.get('Mushroom_Common').box,sc=(.3+.15*h)*p.s/(box.max.y-box.min.y);
   batch.add('Mushroom_Common',trs(p.x,y-.02,p.z,p.yaw,sc),()=>white);stats.mushrooms++;
  }
 }
 const variants=new Map<THREE.Material,{material:THREE.Material;shadow:boolean}>();
 const group=batch.build('skybloom-forest',src=>{
  let v=variants.get(src);if(v)return v;const n=src.name;
  if(n==='Leaves_NormalTree')v={material:leafMaterial(src,'skybloom-crowns',true),shadow:true};
  else if(n==='Leaves_TwistedTree')v={material:leafMaterial(src,'skybloom-elder-crowns',false),shadow:true};
  else if(n.startsWith('Bark'))v={material:barkMaterial(src,`skybloom-silver-bark-${n}`),shadow:true};
  else if(n==='skybloom-mossy-limestone')v={material:src,shadow:true};
  else if(n==='Flowers')v={material:tintMaterial(src,'skybloom-blooms',.35),shadow:false};
  else if(n==='Leaves')v={material:tintMaterial(src,'skybloom-ferns',0),shadow:false};
  else v={material:src.clone(),shadow:false};
  variants.set(src,v);return v;
 });
 group.userData.stats=stats;
 for(const piece of kit.pieces.values())for(const part of piece.parts)part.geometry.dispose();
 for(const g of [...logGeo.values(),...rockGeo.values()])g.dispose();
 return group;
}
