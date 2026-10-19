import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {type Kit,StaticBatch,trs} from '../world/kit';
import {addPatch} from '../world/materials';
import type {RequestLook,RequestSite,RequestState} from './dawnRequests';
import {chipStone,driftBank,driftMaterial,frostStone,kitOnce,runeMaterial,runeQuad,runestone,snowyKit,stream} from './frostCraft';
import {FROST_LAMP_POSTS,FROST_SEAL_STONES} from './frostPropsLayout';
import {type Crystal,crystalGeometry} from './iceCrystals';
import {snowCover} from './snowCover';
import {frozenPond} from './snowVillageDressing';

/*
 * Frostlight's quest props, each a finished thing where its quest says it is: relief crates and sacks with snow
 * on their lids, frost blossoms in a snow mound, guide lanterns on timber posts set in cairns by the northern
 * road, frostiron crystals breaking out of a rock, an ice pearl in a half-open shell set in clear ice, and carved
 * rune stones whose seal glows with the aurora. What the player takes goes when it is taken; what stays (posts,
 * rocks, shells, stones) changes state: lanterns light, seals go dark. While an objective waits, gold glints rise
 * round it over a soft glow on the snow, so it is found by eye.
 */

export interface FrostRequestOptions {
 height:(x:number,z:number)=>number;
 /** The island's grown ice (iceCrystals.ts). */
 ice:THREE.Material;
}

const UP=new THREE.Vector3(0,1,0);
/** Glints and glow per kind: spread radius, lowest and highest glint, glow radius. */
const CUE:Record<string,[number,number,number,number]>={crate:[1.0,.2,1.6,1.7],herb:[.65,.15,1.0,1.2],lamp:[.5,1.6,2.8,1.3],ore:[.9,.2,1.3,1.5],pearl:[.55,.1,.8,1.2],seal:[.7,.4,1.9,1.5],visit:[2.4,.1,2.2,2.6]};

/** A site's own yaw and seed, from its position, so every client turns it the same way. */
function siteHash(p:THREE.Vector3){const s=Math.sin(p.x*12.9898+p.z*78.233)*43758.5453;return s-Math.floor(s);}

const SPARK_VERT=/* glsl */`
attribute vec4 aSpark; // x node, y seed, z rate, w size
uniform float uTime;
uniform float uOn[24];
uniform float uPx;
varying float vA;
#include <fog_pars_vertex>
void main(){
 float on=uOn[int(aSpark.x+.5)];
 float t=uTime*aSpark.z+aSpark.y*17.,rise=fract(uTime*.09+aSpark.y);
 vec3 p=position;p.y+=rise*.55;p.x+=sin(t*.37)*.07;p.z+=cos(t*.31)*.07;
 vec4 mvPosition=modelViewMatrix*vec4(p,1.);
 // Motes drift up and shimmer, each with a star-flash now and then: glints, not a swarm.
 float tw=pow(max(0.,sin(t)),4.);
 vA=on*(.32+.68*tw)*smoothstep(0.,.15,rise)*(1.-smoothstep(.7,1.,rise))*smoothstep(1.5,4.,-mvPosition.z);
 gl_PointSize=clamp(aSpark.w*(.6+.8*tw)*uPx*projectionMatrix[1][1]/max(1.,-mvPosition.z),1.,30.);
 gl_Position=on<.5?vec4(2.,2.,2.,1.):projectionMatrix*mvPosition;
 #include <fog_vertex>
}`;
const SPARK_FRAG=/* glsl */`
uniform vec3 uColor;
varying float vA;
#include <fog_pars_fragment>
void main(){
 vec2 c=gl_PointCoord-.5;float r=length(c);
 float a=(exp(-r*r*70.)*1.3+(exp(-abs(c.x)*38.)*exp(-abs(c.y)*7.)+exp(-abs(c.y)*38.)*exp(-abs(c.x)*7.))*.55)*vA;
 if(a<.004)discard;
 gl_FragColor=vec4(uColor*a,1.);
 #ifdef USE_FOG
  #ifdef FOG_EXP2
   gl_FragColor.rgb*=exp(-fogDensity*fogDensity*vFogDepth*vFogDepth);
  #endif
 #endif
}`;
const POOL_VERT=/* glsl */`
attribute vec2 aPool; // x node, y radius 0..1
varying vec2 vPool;
#include <fog_pars_vertex>
void main(){vPool=aPool;vec4 mvPosition=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mvPosition;
 #include <fog_vertex>
}`;
const POOL_FRAG=/* glsl */`
uniform float uTime;
uniform float uOn[24];
uniform vec3 uColor;
uniform float uPulse;
varying vec2 vPool;
#include <fog_pars_fragment>
void main(){
 float on=uOn[int(vPool.x+.5)];
 if(on<.01)discard;
 float r=vPool.y,a=pow(1.-smoothstep(0.,1.,r),2.2)*on*(1.-uPulse+uPulse*(.75+.25*sin(uTime*2.1+vPool.x*1.7)));
 gl_FragColor=vec4(uColor*a,1.);
 #ifdef USE_FOG
  #ifdef FOG_EXP2
   gl_FragColor.rgb*=exp(-fogDensity*fogDensity*vFogDepth*vFogDepth);
  #endif
 #endif
}`;
const HALO_VERT=/* glsl */`
attribute vec2 aHalo; // x node, y size
attribute vec3 aTint;
uniform float uTime;
uniform float uOn[24];
uniform float uPx;
varying float vA;
varying vec3 vTint;
#include <fog_pars_vertex>
void main(){
 float on=uOn[int(aHalo.x+.5)];vTint=aTint;vA=on*(.92+.08*sin(uTime*7.3+position.x*3.1)*sin(uTime*4.1+position.z));
 vec4 mvPosition=modelViewMatrix*vec4(position,1.);
 gl_PointSize=clamp(aHalo.y*uPx*projectionMatrix[1][1]/max(1.,-mvPosition.z),1.,320.);
 gl_Position=on<.01?vec4(2.,2.,2.,1.):projectionMatrix*mvPosition;
 #include <fog_vertex>
}`;
const HALO_FRAG=/* glsl */`
varying float vA;
varying vec3 vTint;
#include <fog_pars_fragment>
void main(){
 float r=length(gl_PointCoord-.5)*2.,a=(exp(-r*r*4.5)*.85+exp(-r*r*40.)*.6)*vA;
 if(a<.003)discard;
 gl_FragColor=vec4(vTint*a,1.);
 #ifdef USE_FOG
  #ifdef FOG_EXP2
   gl_FragColor.rgb*=exp(-fogDensity*fogDensity*vFogDepth*vFogDepth);
  #endif
 #endif
}`;
const additive=(name:string,vertexShader:string,fragmentShader:string,uniforms:Record<string,THREE.IUniform>)=>new THREE.ShaderMaterial({name,vertexShader,fragmentShader,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,fog:true,uniforms:THREE.UniformsUtils.merge([THREE.UniformsLib.fog,uniforms])});

/** A disc of `radius` laid on the ground round (x, z), for a glow that hugs the drift. */
function groundDisc(x:number,z:number,radius:number,node:number,h:(x:number,z:number)=>number,lift:(x:number,z:number)=>number=()=>0){
 const nR=7,nA=28,pos:number[]=[],attr:number[]=[],idx:number[]=[];
 for(let i=0;i<=nR;i++)for(let j=0;j<(i?nA:1);j++){
  const r=radius*i/nR,a=j/nA*Math.PI*2,px=x+Math.cos(a)*r,pz=z+Math.sin(a)*r;
  pos.push(px,h(px,pz)+lift(px,pz)+.05,pz);attr.push(node,i/nR);
 }
 const ring=(i:number)=>i?1+(i-1)*nA:0;
 for(let j=0;j<nA;j++)idx.push(0,ring(1)+(j+1)%nA,ring(1)+j);
 for(let i=1;i<nR;i++)for(let j=0;j<nA;j++){const a=ring(i)+j,b=ring(i)+(j+1)%nA,c=ring(i+1)+j,d=ring(i+1)+(j+1)%nA;idx.push(a,b,c,b,d,c);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('aPool',new THREE.Float32BufferAttribute(attr,2));g.setIndex(idx);
 return g;
}

/** One valve of a scallop shell, hinge at the origin, opening along +z. Front faces are the inside. */
function shellValve(len:number,depth:number,ribs:number,top:boolean){
 const nU=14,nV=26,pos:number[]=[],uv:number[]=[],idx:number[]=[];
 for(let i=0;i<=nU;i++)for(let j=0;j<=nV;j++){
  const u=i/nU,v=j/nV*2-1,th=v*1.12,edge=1+.035*Math.cos(v*Math.PI*ribs)*u*u;
  const r=len*(.05+.95*u)*(1-.08*v*v)*edge;
  const cup=depth*Math.pow(Math.max(0,4*u*(1-u*.82)),.7)*Math.sqrt(Math.max(0,1-v*v*.85));
  const rib=depth*.12*Math.abs(Math.cos(v*Math.PI*ribs*.5))*u;
  const y=-(cup+rib)*(top?-1:1);
  pos.push(Math.sin(th)*r,y,Math.cos(th)*r);uv.push(u,v*.5+.5);
 }
 for(let i=0;i<nU;i++)for(let j=0;j<nV;j++){const a=i*(nV+1)+j,b=a+1,c=a+nV+1,d=c+1;if(top)idx.push(a,b,c,b,d,c);else idx.push(a,c,b,b,c,d);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();
 return g;
}

/** Shell: ribbed grey-blue outside with growth lines, nacre inside whose colours turn with the view. */
function shellMaterial(){
 const m=new THREE.MeshStandardMaterial({name:'frostlight-shell',color:'#ffffff',roughness:.5,side:THREE.DoubleSide});
 addPatch(m,'frostlight-shell',shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vShell;').replace('#include <begin_vertex>','#include <begin_vertex>\nvShell = uv;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 vShell;')
   .replace('#include <color_fragment>',`#include <color_fragment>
    {
     float growth = 0.5 + 0.5 * sin(vShell.x * 46.0 + sin(vShell.y * 9.0) * 1.5);
     vec3 outside = mix(vec3(0.34, 0.4, 0.5), vec3(0.62, 0.68, 0.76), vShell.x) * (0.82 + 0.18 * growth);
     vec3 V = normalize(vViewPosition);
     float f = 1.0 - abs(dot(normalize(vNormal), V));
     vec3 nacre = vec3(0.8, 0.84, 0.94) + vec3(0.06, 0.07, 0.05) * cos(6.2832 * (vec3(0.0, 0.25, 0.5) + f * 1.3 + vShell.x * 0.8));
     diffuseColor.rgb = gl_FrontFacing ? nacre : outside;
    }`)
   .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor = gl_FrontFacing ? 0.22 : 0.62;');
 });
 return m;
}

/** An ice pearl: milky, iridescent at the rim, lit softly from within. */
function pearlMaterial(){
 const m=new THREE.MeshStandardMaterial({name:'frostlight-pearl',color:'#f2f6ff',roughness:.16,metalness:.05,emissive:'#7fb8ff',emissiveIntensity:.55});
 addPatch(m,'frostlight-pearl',shader=>{
  shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
   {
    float f = 1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition)));
    vec3 film = 0.5 + 0.5 * cos(6.2832 * (vec3(0.0, 0.33, 0.67) + f * 1.6));
    totalEmissiveRadiance = totalEmissiveRadiance * (0.6 + 0.6 * (1.0 - f)) + film * pow(f, 2.0) * 0.5;
   }`);
 });
 return m;
}

/** Frostiron: near-black blue metal that grew as crystal, lit from inside toward the root. */
function frostironMaterial(){
 const m=new THREE.MeshStandardMaterial({name:'frostlight-frostiron',color:'#33476a',metalness:.75,roughness:.3,emissive:'#3fb6ff',emissiveIntensity:1});
 addPatch(m,'frostlight-frostiron',shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float aH01;\nattribute float aSeed;\nvarying float vIronH;\nvarying float vIronSeed;').replace('#include <begin_vertex>','#include <begin_vertex>\nvIronH = aH01;vIronSeed = aSeed;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float vIronH;\nvarying float vIronSeed;')
   .replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
    totalEmissiveRadiance *= pow(1.0 - vIronH, 2.2) * 1.4 + 0.25 * smoothstep(0.85, 1.0, vIronH) + 0.06;`);
 });
 return m;
}

/** Petals recoloured to frost: pale ice-blue, deeper at the base, a cold glow from the heart of each flower. */
function blossomMaterial(src:THREE.Material){
 const m=src.clone() as THREE.MeshStandardMaterial;m.name='frostlight-frost-blossom';m.metalness=0;
 m.emissive=new THREE.Color('#6fc8ff');m.emissiveIntensity=1;
 addPatch(m,'frostlight-frost-blossom',shader=>{
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nfloat ccHeart;')
   .replace('#include <map_fragment>',`#include <map_fragment>
    {
     vec3 c = diffuseColor.rgb;
     // The kit's warm heart (yellow, orange) is where the glow sits; the petal is re-tinted by its value.
     ccHeart = smoothstep(0.18, 0.42, (c.r + c.g) * 0.5 - c.b);
     float l = dot(c, vec3(0.299, 0.587, 0.114));
     diffuseColor.rgb = mix(mix(vec3(0.16, 0.34, 0.78), vec3(0.5, 0.72, 0.98), smoothstep(0.2, 0.8, l)), vec3(0.7, 0.95, 1.0), ccHeart);
    }`)
   .replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 0.06 + 1.3 * ccHeart;');
 });
 return m;
}

/** Kit leaves frozen: re-tinted by value to a dark frosted teal, then the shared snow cover on what faces up. */
function frostLeaves(src:THREE.Material){
 const m=src.clone() as THREE.MeshStandardMaterial;m.name='frostlight-frost-leaves';m.metalness=0;
 addPatch(m,'frostlight-frost-leaves',shader=>{
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
   {
    float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
    diffuseColor.rgb = mix(vec3(0.03, 0.09, 0.1), vec3(0.2, 0.4, 0.42), smoothstep(0.1, 0.6, l));
   }`);
 });
 snowCover(m,{cover:.9});
 return m;
}

/** Points on a mesh's surface: a ray from outside toward `toward` along each direction, first hit. */
function surfacePoints(geo:THREE.BufferGeometry,dirs:THREE.Vector3[],toward:THREE.Vector3){
 const mesh=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({side:THREE.DoubleSide})),ray=new THREE.Raycaster();
 const out:{p:THREE.Vector3;n:THREE.Vector3}[]=[];
 for(const d of dirs){
  ray.set(toward.clone().addScaledVector(d,6),d.clone().negate());
  const hit=ray.intersectObject(mesh)[0];
  if(hit)out.push({p:hit.point,n:hit.face!.normal.clone()});
 }
 return out;
}

/** Frostlight's dressing for DawnRequests: anchors at once, kit pieces as soon as the kits are parsed. */
export function frostRequestLook(opts:FrostRequestOptions):RequestLook{
 const h=opts.height;
 const items:(THREE.Object3D|null)[]=[],pend=new Float32Array(24),lit=new Float32Array(24),seal=new Float32Array(24),halo=new Float32Array(24);
 let cueGlow:THREE.ShaderMaterial,cueSpark:THREE.ShaderMaterial,pools:THREE.ShaderMaterial,halos:THREE.ShaderMaterial,runes:THREE.ShaderMaterial;
 const flames:(THREE.Object3D|null)[]=[];
 let sites:readonly RequestSite[]=[];
 return {
  build(root,list){
   if(list.length>24)throw new Error('frostRequestLook: 24 sites at most');
   sites=list;
   const stone=frostStone(),drift=driftMaterial(),ice=opts.ice,iron=frostironMaterial(),shellMat=shellMaterial(),pearlMat=pearlMaterial();
   runes=runeMaterial();
   const stones:THREE.BufferGeometry[]=[],drifts:THREE.BufferGeometry[]=[],iceList:Crystal[]=[],shells:THREE.BufferGeometry[]=[],runeGeos:THREE.BufferGeometry[]=[];
   const glowDiscs:THREE.BufferGeometry[]=[],poolDiscs:THREE.BufferGeometry[]=[],sparkPos:number[]=[],sparkAttr:number[]=[],haloPos:number[]=[],haloAttr:number[]=[],haloTint:number[]=[];
   const anchors:THREE.Object3D[]=[];
   // Kit pieces wait for the parse; their snowy materials are cloned once for every site.
   const kitJobs:((k:{props:Kit;nature:Kit;village:Kit;over:Record<string,THREE.Material>;vo:Record<string,THREE.Material>})=>void)[]=[];
   list.forEach((site,i)=>{
    const P=site.position,hs=siteHash(P),R=stream(Math.floor(hs*1e6)+i*97),yaw=hs*Math.PI*2,letter=site.kind.slice(-1);
    const anchor=new THREE.Object3D();anchor.name=site.kind;anchor.position.copy(P).y+=.8;anchors.push(anchor);
    let item:THREE.Object3D|null=null;
    // Local frame of the site: yaw about its point, on its ground.
    const local=(x:number,z:number)=>{const c=Math.cos(yaw),s=Math.sin(yaw),wx=P.x+c*x+s*z,wz=P.z-s*x+c*z;return new THREE.Vector3(wx,h(wx,wz),wz);};
    const at=(x:number,y:number,z:number,ry=0,s:number|THREE.Vector3=1,pitch=0,roll=0)=>{const w=local(x,z);return trs(w.x,w.y+y,w.z,yaw+ry,s,pitch,roll);};
    let cueAt=P.clone();
    const banks:((x:number,z:number)=>number)[]=[];
    const bank=(b:{geometry:THREE.BufferGeometry;lift:(x:number,z:number)=>number})=>{drifts.push(b.geometry);banks.push(b.lift);};
    const lift=(x:number,z:number)=>{let m=0;for(const f of banks)m=Math.max(m,f(x,z));return m;};
    const W=(f:(x:number,z:number)=>THREE.Vector3,list:{x:number;z:number;r:number}[])=>list.map(b=>{const w=f(b.x,b.z);return {x:w.x,z:w.z,r:b.r};});
    if(site.style==='crate'){
     const group=new THREE.Group();group.name=`frostlight-relief-${letter}`;root.add(group);item=group;anchor.position.copy(P).y+=.7;
     bank(driftBank(W(local,[{x:0,z:0,r:.5},{x:.05,z:-.95,r:.4},{x:.85,z:.25,r:.35}]),h,{reach:.45,height:.2,seed:i+3}));
     kitJobs.push(({props,over})=>{
      const b=new StaticBatch(props,`frostlight-relief-${letter}`);
      b.add('Crate_Wooden',at(0,-.06,0,.1,1.05),{override:over});
      b.add('Crate_Wooden',at(.05,.86,-.03,.62,.7),{override:over});
      b.add('Barrel',at(.05,-.08,-.95,R()*3,.95),{override:over});
      b.add('Bag',at(.86,-.05,.28,-.9,1.05,0,.12),{override:over});
      b.add('Rope_2',at(-.72,.0,.42,R()*3,.95),{override:over});
      group.add(b.build());
     });
    }else if(site.style==='herb'){
     anchor.position.copy(P).y+=.55;
     bank(driftBank(W(local,[{x:0,z:0,r:.3}]),h,{reach:.8,height:.2,seed:i+5}));
     const group=new THREE.Group();group.name=`frostlight-frost-blossom-${letter}`;root.add(group);item=group;
     kitJobs.push(({nature})=>{
      const leaves=frostLeaves(nature.material('Leaves')!);
      const petals=blossomMaterial(nature.material('Flowers')!);
      const stems=new StaticBatch(nature,`frostlight-herb-${letter}`),heads=new StaticBatch(nature,`frostlight-blossoms-${letter}`);
      const place=(piece:string,m:THREE.Matrix4)=>{for(const part of nature.get(piece).parts)(part.material.name==='Flowers'?heads:stems).addGeometry(part.geometry,part.material.name==='Flowers'?petals:leaves,m,part.material.name!=='Flowers');};
      place('Flower_3_Group',at(0,.16,0,R()*6,.56));
      place('Flower_4_Single',at(.36,.08,.2,R()*6,.42,.12,.1));
      place('Flower_3_Single',at(-.34,.1,-.14,R()*6,.46,-.1,.08));
      place('Flower_4_Single',at(-.12,.08,.38,R()*6,.36,.08,-.1));
      place('Fern_1',at(.05,.1,.02,R()*6,.42));
      root.add(stems.build());group.add(heads.build());
     });
    }else if(site.style==='lamp'){
     const [qx,qz]=FROST_LAMP_POSTS['abc'.indexOf(letter)],road=-Math.sign(qx),gy=h(qx,qz),s=.85;
     const lyaw=road*Math.PI/2,toRoad=new THREE.Vector3(road,0,0);
     const plate=new THREE.Vector3(qx,gy+1.72,qz).addScaledVector(toRoad,.16),core=new THREE.Vector3(0,.55,1.1).multiplyScalar(s).applyAxisAngle(UP,lyaw).add(plate);
     anchor.position.copy(core);cueAt=core.clone();
     // A cairn of field stones round the post's foot.
     const rr=stream(i*31+7);
     for(let k=0;k<5;k++){const a=k/5*Math.PI*2+rr()*.5,d=.3+rr()*.08,sz=.2+rr()*.07;stones.push(chipStone(i*11+k,[sz*1.25,sz*.8,sz],{detail:3,planes:7}).applyMatrix4(trs(qx+Math.cos(a)*d,gy-.12,qz+Math.sin(a)*d,a,1)));}
     for(let k=0;k<3;k++){const a=k/3*Math.PI*2+1,sz=.16+rr()*.05;stones.push(chipStone(i*11+7+k,[sz*1.2,sz*.8,sz],{detail:3,planes:7}).applyMatrix4(trs(qx+Math.cos(a)*.17,gy+.2,qz+Math.sin(a)*.17,a+.4,1,.15,.1)));}
     bank(driftBank([{x:qx,z:qz,r:.45}],h,{reach:.45,height:.26,seed:i+9}));
     const flame=new THREE.Mesh(new THREE.LatheGeometry([[0,-.1],[.05,-.08],[.078,-.03],[.072,.04],[.046,.1],[.02,.15],[0,.19]].map(([r,y])=>new THREE.Vector2(r*s,y*s)),12),new THREE.MeshStandardMaterial({name:'frostlight-guide-flame',color:'#ffe2a8',emissive:'#ffb04c',emissiveIntensity:5}));
     flame.position.copy(core);flame.name=`frostlight-guide-flame-${letter}`;flame.visible=false;root.add(flame);flames[i]=flame;
     haloPos.push(core.x,core.y,core.z);haloAttr.push(i,s*3.1);haloTint.push(1.0,.6,.24);
     poolDiscs.push(groundDisc(core.x,core.z,4.2,i,h,lift).translate(0,.01,0));
     kitJobs.push(({props,village,over,vo})=>{
      const b=new StaticBatch(props,`frostlight-guide-lantern-${letter}`),post=new StaticBatch(village,`frostlight-guide-post-${letter}`);
      b.add('Lantern_Wall',trs(plate.x,plate.y,plate.z,lyaw,s),{override:over,castShadow:false});
      post.add('Corner_ExteriorWide_Wood',trs(qx,gy-.2,qz,lyaw,1.05),{override:vo});
      root.add(b.build(),post.build());
     });
    }else if(site.style==='ore'){
     anchor.position.copy(P).y+=.75;
     const rock=chipStone(i*13+1,[.74,.56,.62],{detail:4,planes:12,flare:.3,taper:.25});
     const rockM=trs(P.x,h(P.x,P.z)-.16,P.z,yaw,1,(R()-.5)*.1,(R()-.5)*.1);
     // Darker field rock: the occlusion colour scales its tone.
     const col=rock.getAttribute('color') as THREE.BufferAttribute;for(let k=0;k<col.count;k++)col.setXYZ(k,col.getX(k)*.62,col.getY(k)*.64,col.getZ(k)*.7);
     stones.push(rock.clone().applyMatrix4(rockM));
     for(let k=0;k<4;k++){const a=R()*Math.PI*2,d=1.0+R()*.5,sz=.12+R()*.1,w=local(Math.cos(a)*d,Math.sin(a)*d);stones.push(chipStone(i*13+3+k,[sz*1.2,sz*.85,sz],{detail:3,planes:7}).applyMatrix4(trs(w.x,w.y-.06,w.z,R()*6,1)));}
     bank(driftBank(W(local,[{x:0,z:0,r:.62}]),h,{reach:.45,height:.22,seed:i+11}));
     // Veins break out of the rock's upper faces as clusters of frostiron.
     const centre=new THREE.Vector3(0,.5,0),dirs=[0,1,2].map(k=>{const a=k/3*Math.PI*2+R()*.8,el=.45+R()*.5;return new THREE.Vector3(Math.cos(a)*Math.cos(el),Math.sin(el),Math.sin(a)*Math.cos(el));});
     const veins:Crystal[]=[];
     for(const {p,n} of surfacePoints(rock,dirs,centre)){
      const ax=n.clone().multiplyScalar(.65).addScaledVector(UP,.5).normalize(),hgt=.42+R()*.3;
      veins.push({x:p.x,y:p.y-.06,z:p.z,axis:[ax.x,ax.y,ax.z],height:hgt,radius:.09+R()*.04,seed:R()*97});
      for(let k=0;k<4;k++){const a=R()*Math.PI*2,t=new THREE.Vector3(Math.cos(a),0,Math.sin(a)).projectOnPlane(ax).normalize();const b=ax.clone().addScaledVector(t,.5+R()*.4).normalize();
       veins.push({x:p.x+t.x*.08,y:p.y-.05+t.y*.08,z:p.z+t.z*.08,axis:[b.x,b.y,b.z],height:hgt*(.35+R()*.4),radius:.04+R()*.03,seed:R()*97});}
     }
     const vg=crystalGeometry(veins).applyMatrix4(rockM);
     const m=new THREE.Mesh(vg,iron);m.name=`frostlight-frostiron-${letter}`;m.castShadow=true;root.add(m);item=m;
    }else if(site.style==='pearl'){
     anchor.position.copy(P).y+=.35;
     const gy=h(P.x,P.z),open=Math.atan2(0-P.x,60-P.z)+(R()-.5)*.5,bed=trs(P.x,gy+.06,P.z,open,1,-.12,0);
     const lo=(x:number,z:number)=>{const c=Math.cos(open),sn=Math.sin(open),wx=P.x+c*x+sn*z,wz=P.z-sn*x+c*z;return new THREE.Vector3(wx,h(wx,wz),wz);};
     const lower=shellValve(.64,.16,9,false),upper=shellValve(.64,.16,9,true).applyMatrix4(new THREE.Matrix4().makeRotationX(-1.15));
     shells.push(lower.applyMatrix4(bed),upper.applyMatrix4(bed));
     const pearl=new THREE.Mesh(new THREE.LatheGeometry(Array.from({length:13},(_,k)=>{const a=-Math.PI/2+k/12*Math.PI;return new THREE.Vector2(Math.cos(a)*.19,Math.sin(a)*.19);}),24),pearlMat);
     pearl.position.set(0,.02,.33).applyMatrix4(bed);pearl.name=`frostlight-ice-pearl-${letter}`;pearl.castShadow=true;root.add(pearl);item=pearl;
     cueAt=pearl.position.clone();haloPos.push(cueAt.x,cueAt.y,cueAt.z);haloAttr.push(i,1.3);haloTint.push(.32,.55,.9);
     // Clear ice grown round the shell, leaning out, the tallest behind the hinge.
     for(let k=0;k<8;k++){const a=k/8*Math.PI*2+R()*.3,d=.5+R()*.18,w=lo(Math.sin(a)*d,Math.cos(a)*d+.2),tilt=.35+R()*.4;
      iceList.push({x:w.x,y:w.y-.08,z:w.z,axis:[Math.sin(a+open)*tilt,1,Math.cos(a+open)*tilt],height:(.22+R()*.3)*(Math.cos(a)<-.3?1.6:1),radius:.07+R()*.05,seed:R()*97});}
     // A frozen pool that follows the drift under it; its rime runs out into the snow at the rim.
     const pc=lo(0,.22),pg=new THREE.RingGeometry(0,.95,40,7).rotateX(-Math.PI/2),pp=pg.getAttribute('position');
     for(let k=0;k<pp.count;k++)pp.setY(k,h(pc.x+pp.getX(k),pc.z+pp.getZ(k))-pc.y+.014);
     pg.computeVertexNormals();
     const pond=new THREE.Mesh(pg,frozenPond(.95));pond.position.copy(pc);pond.name=`frostlight-pearl-ice-${letter}`;pond.receiveShadow=true;root.add(pond);
    }else if(site.style==='seal'){
     const [sx,sz]=FROST_SEAL_STONES['abc'.indexOf(letter)],road=-Math.sign(sx),gy=h(sx,sz),syaw=road*Math.PI/2+(R()-.5)*.2;
     const stoneM=trs(sx,gy-.22,sz,syaw,1,(R()-.5)*.06,(R()-.5)*.07),D=.4;
     stones.push(runestone(i*17+5,1.05,2.05,D).applyMatrix4(stoneM));
     for(let k=0;k<3;k++){const a=R()*Math.PI*2,d=.75+R()*.3,sz2=.14+R()*.08;stones.push(chipStone(i*17+9+k,[sz2*1.2,sz2*.85,sz2],{detail:3,planes:7}).applyMatrix4(trs(sx+Math.cos(a)*d,gy-.05,sz+Math.sin(a)*d,R()*6,1)));}
     const toWorld=(x:number,z:number)=>{const w=new THREE.Vector3(x,0,z).applyAxisAngle(UP,syaw);w.x+=sx;w.z+=sz;w.y=h(w.x,w.z);return w;};
     bank(driftBank(W(toWorld,[{x:-.3,z:0,r:.22},{x:0,z:0,r:.22},{x:.3,z:0,r:.22}]),h,{reach:.45,height:.28,seed:i+17}));
     const face=new THREE.Matrix4().multiplyMatrices(stoneM,trs(0,1.22,D/2+.003,0,1));
     runeGeos.push(runeQuad(face,.8,.8,0,R()*9,i));
     const back=new THREE.Matrix4().multiplyMatrices(stoneM,trs(0,1.2,-D/2-.003,Math.PI,1));
     runeGeos.push(runeQuad(back,.5,.8,1+Math.floor(R()*6),R()*9,i));
     const c=new THREE.Vector3(0,1.22,.45).applyMatrix4(stoneM);anchor.position.copy(c);cueAt=c.clone();cueAt.y=gy;
     const glowAt=new THREE.Vector3(0,1.22,.3).applyMatrix4(stoneM);haloPos.push(glowAt.x,glowAt.y,glowAt.z);haloAttr.push(i,1.9);haloTint.push(.12,.55,.42);
    }else{
     anchor.position.copy(P).y+=1;
    }
    items[i]=item;
    // The cue: glints round the prop, a glow on the snow under it.
    const [spread,lo,hi,glowR]=CUE[site.style]??CUE.visit;
    const base=site.style==='lamp'?new THREE.Vector3(cueAt.x,h(cueAt.x,cueAt.z),cueAt.z):site.style==='seal'?cueAt:P;
    const n=site.style==='visit'?24:16;
    for(let k=0;k<n;k++){const a=k/n*Math.PI*2+R(),d=spread*(site.style==='visit'?.75+R()*.25:.3+R()*.7);
     sparkPos.push(base.x+Math.cos(a)*d,base.y+lo+R()*(hi-lo),base.z+Math.sin(a)*d);sparkAttr.push(i,R(),1.2+R()*1.6,.12+R()*.06);}
    glowDiscs.push(groundDisc(base.x,base.z,glowR,i,h,lift));
   });
   const add=(mesh:THREE.Mesh|THREE.Points,name:string,shadow=false)=>{mesh.name=name;mesh.castShadow=shadow;mesh.receiveShadow=mesh instanceof THREE.Mesh;root.add(mesh);return mesh;};
   if(stones.length)add(new THREE.Mesh(mergeGeometries(stones,false)!,stone),'frostlight-quest-stones',true);
   if(drifts.length)add(new THREE.Mesh(mergeGeometries(drifts,false)!,drift),'frostlight-quest-drifts',true);
   if(iceList.length)add(new THREE.Mesh(crystalGeometry(iceList),ice),'frostlight-pearl-ice-crystals',true);
   if(shells.length)add(new THREE.Mesh(mergeGeometries(shells,false)!,shellMat),'frostlight-pearl-shells',true);
   if(runeGeos.length){const m=add(new THREE.Mesh(mergeGeometries(runeGeos,false)!,runes),'frostlight-seal-runes');m.renderOrder=1;}
   const uPx={value:450},buffer=new THREE.Vector2();
   cueGlow=additive('frostlight-quest-glow',POOL_VERT,POOL_FRAG,{uTime:{value:0},uOn:{value:Array.from(pend)},uColor:{value:new THREE.Color(.75,.52,.16)},uPulse:{value:1}});
   const glow=add(new THREE.Mesh(mergeGeometries(glowDiscs,false)!,cueGlow),'frostlight-quest-cue-glow');glow.renderOrder=2;glow.frustumCulled=false;
   pools=additive('frostlight-lantern-pools',POOL_VERT,POOL_FRAG,{uTime:{value:0},uOn:{value:Array.from(lit)},uColor:{value:new THREE.Color(1.0,.5,.14)},uPulse:{value:.15}});
   if(poolDiscs.length){const m=add(new THREE.Mesh(mergeGeometries(poolDiscs,false)!,pools),'frostlight-lantern-pools');m.renderOrder=2;m.frustumCulled=false;}
   cueSpark=additive('frostlight-quest-glints',SPARK_VERT,SPARK_FRAG,{uTime:{value:0},uOn:{value:Array.from(pend)},uPx,uColor:{value:new THREE.Color(2.4,1.85,.95)}});
   const sg=new THREE.BufferGeometry();sg.setAttribute('position',new THREE.Float32BufferAttribute(sparkPos,3));sg.setAttribute('aSpark',new THREE.Float32BufferAttribute(sparkAttr,4));
   const sparks=add(new THREE.Points(sg,cueSpark),'frostlight-quest-glints');sparks.frustumCulled=false;sparks.renderOrder=3;
   halos=additive('frostlight-quest-halos',HALO_VERT,HALO_FRAG,{uTime:{value:0},uOn:{value:Array.from(halo)},uPx});
   if(haloPos.length){const hg=new THREE.BufferGeometry();hg.setAttribute('position',new THREE.Float32BufferAttribute(haloPos,3));hg.setAttribute('aHalo',new THREE.Float32BufferAttribute(haloAttr,2));hg.setAttribute('aTint',new THREE.Float32BufferAttribute(haloTint,3));const m=add(new THREE.Points(hg,halos),'frostlight-quest-halos');m.frustumCulled=false;m.renderOrder=3;}
   // Point sizes are in world units: half the drawing buffer's height scales them, at any pixel ratio.
   sparks.onBeforeRender=r=>{r.getDrawingBufferSize(buffer);uPx.value=buffer.y/2;};
   Promise.all([kitOnce('models/world/props.glb'),kitOnce('models/world/nature.glb'),kitOnce('models/world/village.glb')]).then(([props,nature,village])=>{
    const over:Record<string,THREE.Material>={},vo:Record<string,THREE.Material>={};
    for(const [n,m] of props.materials)over[n]=snowyKit(m);
    vo.MI_WoodTrim=snowyKit(village.materials.get('MI_WoodTrim')!);
    for(const job of kitJobs)job({props,nature,village,over,vo});root.userData.frostDressed=true;
   });
   root.userData.frostSites=list.length;
   return anchors;
  },
  update(time,states:readonly RequestState[]){
   if(!cueSpark)return;
   states.forEach((s,i)=>{
    const item=items[i];if(item)item.visible=!s.done;
    const flame=flames[i];if(flame)flame.visible=s.done;
    const style=sites[i].style;
    pend[i]=s.pending?1:0;lit[i]=flame&&s.done?1:0;
    // Seals keep their light until recovered, then only the cut remains; pearls glow until taken.
    seal[i]=style==='seal'&&!s.done?1:0;
    halo[i]=style==='lamp'?lit[i]:(style==='seal'||style==='pearl')&&!s.done?1:0;
   });
   const put=(dst:number[],src:Float32Array)=>{for(let k=0;k<24;k++)dst[k]=src[k];};
   put(cueGlow.uniforms.uOn.value,pend);put(cueSpark.uniforms.uOn.value,pend);put(pools.uniforms.uOn.value,lit);put(halos.uniforms.uOn.value,halo);put(runes.uniforms.uGlow.value,seal);
   for(const m of [cueGlow,cueSpark,pools,halos,runes])m.uniforms.uTime.value=time;
  },
 };
}
