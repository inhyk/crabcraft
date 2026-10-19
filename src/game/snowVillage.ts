import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {TownBuilder} from '../world/buildings';
import {lathe,worldBox} from '../world/geom';
import {type Kit,loadKit,type PlaceOptions,StaticBatch,trs} from '../world/kit';
import {addPatch,stylise} from '../world/materials';
import {GLSL_NOISE} from '../world/noise';
import {type Crystal,crystalGeometry} from './iceCrystals';
import {GUARDED_NOISE,snowCover,snowMass} from './snowCover';
import {embers,garland,snowman} from './snowVillageDressing';
import {atLot,raiseFrostlight,type RoofFrame,SNOW_CAULDRON,snowGarlands,SNOW_LOTS,SNOW_SNOWMEN,SNOW_WOODPILES,snowLamps,snowProps,snowSteps,type VillageFrames,woodpileAt} from './snowVillageLayout';

/*
 * Frostlight's village, built from the Medieval Village MegaKit and its props (CC0, see NOTICE.md) on the lots in
 * snowVillageLayout.ts. Snow lies in three layers: a pillowed cap over every roof (fitted to the kit roof's own
 * profile, rolled over the eaves), the shader cover on every ledge and sill (snowCover.ts), and drifts banked
 * against the walls. Windows glow per pane-set, chimneys smoke, lanterns light the snow around them, and the
 * eaves grow icicles in the island's crystal ice.
 */

type Height=(x:number,z:number)=>number;
export interface SnowVillageOptions {
 height:Height;
 /** The island's crystal ice (iceCrystals.ts), for icicles. */
 ice:THREE.Material;
}

/** Deterministic 0..1 stream: the village dresses the same for every player. */
function stream(seed:number){let s=seed>>>0;return()=>(s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296;}
const hash=(x:number,y=0)=>{const s=Math.sin(x*127.1+y*311.7)*43758.5453;return s-Math.floor(s);};
/** Smooth 1D value noise, 0..1. */
function noise1(x:number,k=0){const i=Math.floor(x),f=x-i,u=f*f*(3-2*f);return hash(i,k)*(1-u)+hash(i+1,k)*u;}

/** Pieces set into a wall: their shadow falls inside the wall's own, so they skip the shadow pass. */
const FLUSH=/^(Window_|Door_|DoorFrame_)/;
/** Kit batch that tints chosen materials per placement through vertex colour (window brightness per window). */
class TintBatch extends StaticBatch {
 constructor(kit:Kit,name:string,private tint:Map<THREE.Material,()=>number>){super(kit,name);}
 override add(piece:string,m:THREE.Matrix4,opts:PlaceOptions={}){super.add(piece,m,FLUSH.test(piece)?{...opts,castShadow:false}:opts);}
 override addGeometry(geo:THREE.BufferGeometry,mat:THREE.Material,m:THREE.Matrix4|null,castShadow=true){
  const f=this.tint.get(mat);
  if(f){geo=geo.clone();const n=geo.getAttribute('position').count,v=f(),c=new Float32Array(n*4);for(let i=0;i<n;i++)c.set([v,v,v,1],i*4);geo.setAttribute('color',new THREE.BufferAttribute(c,4));castShadow=false;}
  super.addGeometry(geo,mat,m,castShadow);
 }
}

/** Top envelope of a kit roof across its span (piece space), smoothed over the tile crests. */
function roofProfile(kit:Kit,name:string){
 const piece=kit.get(name),step=.06;
 const xmin=piece.box.min.x,xmax=piece.box.max.x,n=Math.ceil((xmax-xmin)/step)+1,top=new Float32Array(n).fill(-Infinity);
 for(const part of piece.parts){const p=part.geometry.getAttribute('position');for(let i=0;i<p.count;i++){const b=Math.round((p.getX(i)-xmin)/step);top[b]=Math.max(top[b],p.getY(i));}}
 for(let i=0;i<n;i++)if(!Number.isFinite(top[i]))top[i]=i?top[i-1]:piece.box.min.y;
 // Running max bridges the grooves between tiles; a box filter rounds what is left.
 const mx=Float32Array.from(top,(_,i)=>{let m=-Infinity;for(let k=-4;k<=4;k++)m=Math.max(m,top[Math.min(n-1,Math.max(0,i+k))]);return m;});
 const sm=Float32Array.from(mx,(_,i)=>{let s=0;for(let k=-3;k<=3;k++)s+=mx[Math.min(n-1,Math.max(0,i+k))];return s/7;});
 const at=(x:number)=>{const f=THREE.MathUtils.clamp((x-xmin)/step,0,n-1),i=Math.floor(f),t=f-i;return sm[i]*(1-t)+sm[Math.min(n-1,i+1)]*t;};
 return {xmin,xmax,zmin:piece.box.min.z,zmax:piece.box.max.z,at};
}
type Profile=ReturnType<typeof roofProfile>;

/** Lip of the cap past an eave, as (out, down) offsets from the eave point; it curls over and tucks under. */
const LIP:[number,number][]=[[.05,.88],[.12,.62],[.17,.28],[.18,-.05],[.13,-.32],[.04,-.45],[-.1,-.42]];

/**
 * A pillowed snow cap for one roof: a grid over the roof's top envelope, thick along the slopes, rounded over the
 * ridge, rolled over both eaves and thinned to nothing at the gable ends so it sinks into the tiles there.
 */
function roofCap(prof:Profile,frame:RoofFrame,seed:number,eaves:THREE.Vector3[][]){
 const T=.3,xe=Math.min(-prof.xmin,prof.xmax)-.04,z0=prof.zmin+.06,z1=prof.zmax-.06;
 const nU=30,nZ=Math.max(8,Math.ceil((z1-z0)*new THREE.Vector3().setFromMatrixColumn(frame.m,2).length()/.32));
 const cols:{x:number;edge:number}[]=[];
 for(let k=LIP.length-1;k>=0;k--)cols.push({x:-xe,edge:-(k+1)});
 for(let i=0;i<=nU;i++)cols.push({x:-xe+2*xe*i/nU,edge:0});
 for(let k=0;k<LIP.length;k++)cols.push({x:xe,edge:k+1});
 const pos:number[]=[],occ:number[]=[],idx:number[]=[],w=cols.length;
 const left:THREE.Vector3[]=[],right:THREE.Vector3[]=[];
 for(let j=0;j<=nZ;j++){
  const z=z0+(z1-z0)*j/nZ,d=Math.min(z-z0,z1-z)/.45,end=Math.sqrt(THREE.MathUtils.clamp(d,0,1));
  for(const {x,edge} of cols){
   const side=Math.sign(x)||1,load=.75+.5*noise1(z*.55+x*.25,seed)+.12*noise1(z*2.1,seed+3);
   let t=(T*load+.06*Math.max(0,1-Math.abs(x)/.6))*end-.05*(1-end),px=x,py=prof.at(x);
   if(edge){const [o,dn]=LIP[Math.abs(edge)-1],droop=(.85+.5*noise1(z*.9,seed+side*7))*end;px=x+side*o*droop;py=prof.at(xe*side)+(dn*T*load*droop)-(1-end)*.05;t=0;}
   pos.push(px,py+t,z);
   // Occlusion: the roll tucks into shade under the eave, and the cap thins into the tiles at the gables.
   const o=(edge?1-.45*THREE.MathUtils.smoothstep(Math.abs(edge),3,6):1)*(.88+.12*end);occ.push(o,o,o);
  }
  // Icicles hang from the lowest point of the roll.
  const lo=(s:number)=>new THREE.Vector3(s*(xe+.1),prof.at(xe*s)-.4*T,z).applyMatrix4(frame.m);
  if(end>.6){left.push(lo(-1));right.push(lo(1));}
 }
 for(let j=0;j<nZ;j++)for(let i=0;i<w-1;i++){const a=j*w+i,b=a+1,c=a+w,d=c+1;idx.push(a,c,b,b,c,d);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(occ,3));g.setIndex(idx);
 g.applyMatrix4(frame.m);g.computeVertexNormals();
 eaves.push(left,right);
 return g;
}

/** Banked snow against each wall, highest at the wall, cleared in front of doors, following the ground. */
function drifts(frames:VillageFrames,h:Height){
 const geos:THREE.BufferGeometry[]=[];
 for(const {lot,hx,hz,doors} of frames.footprints){
  const sides:[number,number,number,number,number][]=[[0,hz,1,0,hx],[0,-hz,-1,0,hx],[hx,0,0,-1,hz],[-hx,0,0,1,hz]];
  sides.forEach(([cx,cz,tx,tz,half],si)=>{
   const nx=-tz,nz=tx,front=si===0,ext=.9,nT=Math.ceil((half+ext)*2/.4),nS=6,width=1.25;
   const pos:number[]=[],occ:number[]=[],idx:number[]=[];
   for(let i=0;i<=nT;i++){
    const t=-half-ext+(2*(half+ext))*i/nT;
    let H=(.32+.42*noise1(t*.45+si*3.1,lot.x))*(1-THREE.MathUtils.smoothstep(Math.abs(t),half,half+ext));
    if(front){if(lot.kind==='forge')H*=.15;for(const [dx,dz] of doors){const [lx]=localOf(lot,dx,dz);H*=.12+.88*THREE.MathUtils.smoothstep(Math.abs(t-lx),.75,1.5);}}
    for(let k=0;k<=nS;k++){
     const u=k/nS,s=u*width*(.8+.4*noise1(t*.7,si)),lx=cx+tx*t+nx*(s+.12),lz=cz+tz*t+nz*(s+.12);
     const [wx,wz]=atLot(lot,lx,lz);
     pos.push(wx,h(wx,wz)+H*Math.pow(1-Math.pow(u,1.4),1.5)-.07,wz);
     // Contact shade where the bank meets the wall.
     const o=1-.2*Math.pow(1-u,4);occ.push(o,o,o);
    }
   }
   for(let i=0;i<nT;i++)for(let k=0;k<nS;k++){const a=i*(nS+1)+k,b=a+1,c=a+nS+1,d=c+1;idx.push(a,b,c,b,d,c);}
   const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(occ,3));g.setIndex(idx);g.computeVertexNormals();geos.push(g);
  });
 }
 return mergeGeometries(geos,false)!;
}
/** Lot-local coordinates of a world point. */
function localOf(lot:{x:number;z:number;yaw:number},x:number,z:number):[number,number]{const c=Math.cos(lot.yaw),s=Math.sin(lot.yaw),dx=x-lot.x,dz=z-lot.z;return [c*dx-s*dz,s*dx+c*dz];}

const SMOKE_VERT=/* glsl */`
attribute vec4 aSmoke; // x seed, y rate, z height, w size
uniform float uTime;
uniform vec2 uWind;
uniform float uPx;
varying float vAlpha;
varying float vSeed;
varying float vAge;
#include <fog_pars_vertex>
float h1(float n){return fract(sin(n*127.1)*43758.5453);}
void main(){
 float seed=aSmoke.x,age=fract(uTime*aSmoke.y+h1(seed));
 vec3 p=position;
 float rise=aSmoke.z*age;
 // Buoyant at the flue, then bent over by the wind and spread by slow eddies.
 p.y+=rise;
 p.xz+=uWind*pow(age,1.6)*aSmoke.z*.75;
 p.x+=sin(uTime*.6+seed*6.)*age*.9;p.z+=cos(uTime*.5+seed*4.)*age*.9;
 vec4 mvPosition=modelViewMatrix*vec4(p,1.);
 float size=aSmoke.w*(.35+age*1.4);
 gl_PointSize=clamp(size*uPx*projectionMatrix[1][1]/max(1.,-mvPosition.z),1.,256.);
 gl_Position=projectionMatrix*mvPosition;
 vAlpha=smoothstep(0.,.08,age)*pow(1.-age,1.4);vSeed=seed;vAge=age;
 #include <fog_vertex>
}`;
const SMOKE_FRAG=/* glsl */`
uniform vec3 uLit;
uniform vec3 uShade;
uniform float uOpacity;
varying float vAlpha;
varying float vSeed;
varying float vAge;
#include <fog_pars_fragment>
${GLSL_NOISE}
void main(){
 vec2 c=gl_PointCoord-.5;
 float n=cc_vnoise(c*3.2+vSeed*7.)*.55+cc_vnoise(c*7.+vSeed*3.)*.45;
 float a=smoothstep(.5,.12,length(c)+(n-.5)*.28)*vAlpha*uOpacity;
 if(a<.004)discard;
 // Lit from the low sun on the upper side, cool in the lee.
 vec3 col=mix(uShade,uLit,clamp(.55-c.y*1.2+n*.25-vAge*.15,0.,1.));
 gl_FragColor=vec4(col,a);
 #include <fog_fragment>
}`;
const GLOW_VERT=/* glsl */`
attribute vec4 aGlow; // rgb colour, w size
uniform float uTime;
uniform float uPx;
varying vec3 vColor;
#include <fog_pars_vertex>
void main(){
 vec4 mvPosition=modelViewMatrix*vec4(position,1.);
 float f=.92+.08*sin(uTime*7.3+position.x*3.1)*sin(uTime*4.1+position.z);
 gl_PointSize=clamp(aGlow.w*uPx*projectionMatrix[1][1]/max(1.,-mvPosition.z),1.,320.);
 gl_Position=projectionMatrix*mvPosition;vColor=aGlow.rgb*f;
 #include <fog_vertex>
}`;
const GLOW_FRAG=/* glsl */`
varying vec3 vColor;
#include <fog_pars_fragment>
void main(){
 float r=length(gl_PointCoord-.5)*2.;
 float a=exp(-r*r*4.5)*.85+exp(-r*r*40.)*.6;
 if(a<.003)discard;
 gl_FragColor=vec4(vColor*a,1.);
 // Additive: fog only dims the halo, it must not add the fog colour.
 #ifdef USE_FOG
  #ifdef FOG_EXP2
   gl_FragColor.rgb*=exp(-fogDensity*fogDensity*vFogDepth*vFogDepth);
  #else
   gl_FragColor.rgb*=1.-smoothstep(fogNear,fogFar,vFogDepth);
  #endif
 #endif
}`;

const FLAME_VERT=/* glsl */`
attribute vec2 aFlame; // x seed, y height
uniform float uTime;
uniform float uPx;
varying float vSeed;
#include <fog_pars_vertex>
void main(){
 float seed=aFlame.x,f=.82+.18*sin(uTime*11.+seed*7.)*sin(uTime*6.7+seed*3.);
 float size=aFlame.y*f;
 // The point is centred on the tongue, so lift it to stand on its base.
 vec4 mvPosition=modelViewMatrix*vec4(position+vec3(0.,size*.42,0.),1.);
 gl_PointSize=clamp(size*uPx*projectionMatrix[1][1]/max(1.,-mvPosition.z),1.,256.);
 gl_Position=projectionMatrix*mvPosition;vSeed=seed;
 #include <fog_vertex>
}`;
const FLAME_FRAG=/* glsl */`
uniform float uTime;
varying float vSeed;
#include <fog_pars_fragment>
void main(){
 vec2 c=gl_PointCoord;float y=1.-c.y,x=c.x-.5;
 // A licking teardrop: wide and round at the root, a wavering tip.
 x+=sin(y*7.+uTime*9.+vSeed*5.)*.07*y+sin(y*13.-uTime*14.+vSeed)*.025*y;
 float w=.3*pow(max(1.-y,0.),.7)*smoothstep(0.,.22,y)+.02;
 float a=smoothstep(w,w*.35,abs(x))*smoothstep(1.,.75,y);
 if(a<.01)discard;
 vec3 col=mix(vec3(2.6,2.1,1.2),vec3(2.2,.55,.1),clamp(y*1.25+abs(x)/w*.4,0.,1.));
 gl_FragColor=vec4(col*a,1.);
 #ifdef USE_FOG
  #ifdef FOG_EXP2
   gl_FragColor.rgb*=exp(-fogDensity*fogDensity*vFogDepth*vFogDepth);
  #else
   gl_FragColor.rgb*=1.-smoothstep(fogNear,fogFar,vFogDepth);
  #endif
 #endif
}`;

/** One split log along x, 1 m long: aLog = (around, along, end) on the bark, (0, radius, 1) on the sawn ends. */
function logGeometry(){
 const g=new THREE.CylinderGeometry(.15,.15,1,9,1).rotateZ(Math.PI/2);
 const uv=g.getAttribute('uv'),n=g.getAttribute('normal'),a=new Float32Array(uv.count*3);
 for(let i=0;i<uv.count;i++){const end=Math.abs(n.getX(i))>.5;a.set(end?[0,Math.hypot(uv.getX(i)-.5,uv.getY(i)-.5)*2,1]:[uv.getX(i),uv.getY(i),0],i*3);}
 g.setAttribute('aLog',new THREE.BufferAttribute(a,3));g.deleteAttribute('uv');
 return g;
}
/** Dark furrowed bark and pale sawn rings, under the same snow cover as everything else; `charred` for a fire. */
function logMaterial(charred=false){
 const m=new THREE.MeshStandardMaterial({name:charred?'frostlight-firelogs':'frostlight-logs',color:charred?'#6b625a':'#ffffff',roughness:.92});
 addPatch(m,'frostlight-logs',shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute vec3 aLog;\nvarying vec3 vLog;').replace('#include <begin_vertex>','#include <begin_vertex>\nvLog = aLog;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nvarying vec3 vLog;\n${GUARDED_NOISE}`).replace('#include <map_fragment>',`#include <map_fragment>
   {
    vec3 c;
    if (vLog.z > 0.5) {
     float r = vLog.y, ring = 0.5 + 0.5 * sin(r * 30.0 + cc_vnoise(vec2(r * 6.0, 1.7)) * 4.0);
     c = mix(vec3(0.56, 0.4, 0.24), vec3(0.76, 0.58, 0.36), ring) * mix(1.0, 0.4, smoothstep(0.84, 0.97, r));
    } else {
     float n = cc_vnoise(vec2(vLog.x * 16.0, vLog.y * 2.2)) * 0.6 + cc_vnoise(vec2(vLog.x * 42.0, vLog.y * 7.0)) * 0.4;
     c = mix(vec3(0.13, 0.09, 0.07), vec3(0.34, 0.25, 0.17), n);
    }
    diffuseColor.rgb *= c;
   }`);
 });
 if(!charred)snowCover(m,{cover:1});
 return m;
}

export interface SnowVillage {
 group:THREE.Group;
 /** The kit's uneven stone with its snow cover, for the fountain basin. */
 stone:THREE.Material;
 update(time:number,x:number,z:number):void;
 setQuality(q:'high'|'low'):void;
}

/** Load the kits and raise the village. The caller adds `group` to the island root. */
export async function buildSnowVillage(opts:SnowVillageOptions):Promise<SnowVillage>{
 const h=opts.height;
 const [village,props]=await Promise.all([loadKit('models/world/village.glb'),loadKit('models/world/props.glb')]);
 const group=new THREE.Group();group.name='frostlight-village';
 // Kit materials are shared with other worlds: every one used here is a patched clone.
 const variants=new Map<THREE.Material,THREE.Material>();
 const snowy=(m:THREE.Material)=>{
  let v=variants.get(m);if(v)return v;v=m.clone();const sm=v as THREE.MeshStandardMaterial;
  if(!/Metal/.test(m.name)){sm.metalness=0;sm.metalnessMap=null;}
  // The kit ships double-sided; its walls, roofs and props are closed shells, so only cloth needs both faces.
  // Culling the inner faces halves the shading the houses cost.
  if(!/Cloth|Vine/.test(m.name))sm.side=THREE.FrontSide;
  stylise(v,m.name==='MI_RoundTiles'?1.05:.98,[1.0,.99,.98]);
  snowCover(v,{cover:m.name==='MI_RoundTiles'?1.3:m.name.startsWith('MI_Trim_Cloth')?1.15:1});
  variants.set(m,v);return v;
 };
 const windowGlass=new THREE.MeshStandardMaterial({name:'frostlight-window',color:'#2a1a0c',emissive:'#ff9a3c',emissiveIntensity:2.6,roughness:.3,side:THREE.DoubleSide,vertexColors:true});
 // Vertex colour carries the window's brightness; the glow is warmest low in the pane, like a hearth inside.
 addPatch(windowGlass,'frostlight-window',shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying float vPaneY;').replace('#include <project_vertex>','#include <project_vertex>\nvPaneY = fract((modelMatrix * vec4(transformed, 1.0)).y / 3.0);');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float vPaneY;').replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vColor.r * (1.25 - 0.45 * smoothstep(0.3, 0.9, vPaneY));');
 });
 const chapelGlass=new THREE.MeshStandardMaterial({name:'frostlight-stained-glass',color:'#1a1020',emissive:'#ffffff',emissiveIntensity:2.2,roughness:.3,side:THREE.DoubleSide});
 // Leaded panes of amber, rose and sea-green, candle-lit from inside.
 addPatch(chapelGlass,'frostlight-stained-glass',shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vGlassW;').replace('#include <project_vertex>','#include <project_vertex>\nvGlassW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nvarying vec3 vGlassW;\n${GLSL_NOISE}`).replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
   {
    vec2 q = vec2(vGlassW.x + vGlassW.z, vGlassW.y) * 3.2;
    vec2 cell = floor(q), f = fract(q);
    float lead = smoothstep(0.0, 0.09, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
    float k = cc_hash12(cell);
    vec3 pane = k < 0.4 ? vec3(1.0, 0.62, 0.22) : k < 0.65 ? vec3(0.95, 0.32, 0.38) : k < 0.85 ? vec3(0.35, 0.8, 0.62) : vec3(0.45, 0.55, 1.0);
    totalEmissiveRadiance *= pane * lead;
   }`);
 });
 const vOver:Record<string,THREE.Material>={},cOver:Record<string,THREE.Material>={},pOver:Record<string,THREE.Material>={};
 for(const [name,m] of village.materials){vOver[name]=cOver[name]=snowy(m);}
 for(const [name,m] of props.materials)pOver[name]=snowy(m);
 vOver.MI_WindowGlass=windowGlass;cOver.MI_WindowGlass=chapelGlass;
 // Most windows are lit, some dim, a few dark: people are home, not every room is in use.
 const pick=stream(4404);
 const lit=()=>{const r=pick();return r<.1?.07:r<.28?.35+pick()*.2:.75+pick()*.45;};
 const homes=new TintBatch(village,'frostlight-homes',new Map([[windowGlass,lit]]));
 const builder=new TownBuilder(village,homes,null,vOver),chapel=new TownBuilder(village,homes,null,cOver);
 const frames=raiseFrostlight(builder,(piece,m)=>homes.add(piece,m,{override:vOver}),chapel,h);
 // Stone plinths fill under floors where the ground falls away.
 const stone=snowy(village.materials.get('MI_UnevenBrick')!);
 // Under a roof nothing settles: the smithy's floor and hearth keep bare stone.
 const bareStone=village.materials.get('MI_UnevenBrick')!.clone();stylise(bareStone,.98,[1.0,.99,.98]);(bareStone as THREE.MeshStandardMaterial).metalness=0;bareStone.side=THREE.FrontSide;
 for(const {lot,h:y,hx,hz} of frames.footprints){
  const g=worldBox(hx*2+.24,3,hz*2+.24,.5).translate(0,y-1.48,0).applyMatrix4(trs(lot.x,0,lot.z,lot.yaw));
  homes.addGeometry(g,stone,null,false);
 }
 for(const st of snowSteps(h)){
  const lot=st.lot,y=st.y+st.rise;
  if(st.rise>=.6){homes.add('Stairs_Exterior_Straight',new THREE.Matrix4().multiplyMatrices(trs(lot.x,y,lot.z,lot.yaw),trs(st.dx,-st.rise,lot.sz+1.05,0,new THREE.Vector3(.85,st.rise,1))),{override:vOver});continue;}
  // A low rise: stone treads a hand high, stepping out from the door (the kit flight squashes flat here).
  const n=Math.ceil(st.rise/.24),base=trs(lot.x,0,lot.z,lot.yaw);
  for(let i=0;i<n;i++){
   const top=y-i*st.rise/n,tall=top-st.y+.35,d=.42*(i+1)+.06;
   homes.addGeometry(worldBox(1.9+.12*i,tall,d,.5).translate(st.dx,top-tall/2,lot.sz+d/2).applyMatrix4(base),stone,null,true);
  }
 }
 // Wall lanterns beside every door, as in Clawhaven.
 const lanterns:{pos:THREE.Vector3;yaw:number;s:number}[]=[];
 for(const d of [...builder.doorLamps,...chapel.doorLamps])lanterns.push({pos:d.pos,yaw:d.yaw,s:.75});
 group.add(homes.build());

 // Roof caps and the icicles under their eaves.
 const capGeos:THREE.BufferGeometry[]=[],eaves:THREE.Vector3[][]=[],profiles=new Map<string,Profile>();
 frames.roofs.forEach((r,i)=>{let p=profiles.get(r.piece);if(!p)profiles.set(r.piece,p=roofProfile(village,r.piece));capGeos.push(roofCap(p,r,i*7+3,eaves));});
 const snowMat=new THREE.MeshStandardMaterial({name:'frostlight-snow',color:'#e9f1f9',roughness:.84,vertexColors:true});snowMass(snowMat);
 const caps=new THREE.Mesh(mergeGeometries(capGeos,false)!,snowMat);caps.name='frostlight-roof-snow';caps.receiveShadow=true;caps.castShadow=false;group.add(caps);
 const driftMat=new THREE.MeshStandardMaterial({name:'frostlight-drift',color:'#e8f2fc',roughness:.9,vertexColors:true});snowMass(driftMat,{lumps:.7});
 // Snowmen: their packed bodies share the drift mesh, the faces, arms, scarves and light cables one trim mesh.
 const men=SNOW_SNOWMEN.map((sm,i)=>snowman(sm.x,h(sm.x,sm.z)-.04,sm.z,sm.yaw,sm.s,i*13+5));
 const banks=new THREE.Mesh(mergeGeometries([drifts(frames,h),...men.flatMap(m=>m.snow)],false)!,driftMat);banks.name='frostlight-wall-drifts';banks.receiveShadow=banks.castShadow=true;group.add(banks);
 const strings=snowGarlands(h).map((g,i)=>garland(g.a,g.b,g.sag,i*31+7));
 const trimMat=new THREE.MeshStandardMaterial({name:'frostlight-trim',vertexColors:true,roughness:.82});snowCover(trimMat,{cover:.8});
 const trim=new THREE.Mesh(mergeGeometries([...men.flatMap(m=>m.trim),...strings.map(g=>g.cable)],false)!,trimMat);trim.name='frostlight-snowmen-and-cables';trim.castShadow=trim.receiveShadow=true;group.add(trim);
 const {x:cx,z:cz}=SNOW_CAULDRON,cy=h(cx,cz);
 const bulbs=new THREE.Mesh(mergeGeometries([...strings.map(g=>g.bulbs),embers(cx,cy+.06,cz,61)],false)!,new THREE.MeshBasicMaterial({name:'frostlight-bulbs',vertexColors:true}));bulbs.name='frostlight-string-lights';group.add(bulbs);
 const icicles:Crystal[]=[],ir=stream(91);
 for(const line of eaves)for(let i=0;i<line.length-1;i++){
  const a=line[i],b=line[i+1],len=a.distanceTo(b);
  for(let t=ir()*.3;t<len;t+=.16+ir()*.42){
   if(ir()<.22)continue;
   const p=a.clone().lerp(b,t/len),r=ir();
   icicles.push({x:p.x,y:p.y+.06,z:p.z,axis:[(ir()-.5)*.08,-1,(ir()-.5)*.08],height:.14+r*r*.85,radius:.03+ir()*.035,seed:ir()*97});
  }
 }
 const ice=new THREE.Mesh(crystalGeometry(icicles),opts.ice);ice.name='frostlight-icicles';group.add(ice);

 // Lamp posts: a turned iron pole and a kit bracket lantern, as in Clawhaven, capped with snow.
 const iron=new THREE.MeshStandardMaterial({name:'frostlight-iron',color:'#2b2622',roughness:.5,metalness:.75});snowCover(iron,{cover:1});
 const poles:THREE.BufferGeometry[]=[],lamps=snowLamps();
 const pole=lathe([[.3,0],[.3,.22],[.16,.38],[.1,.5],[.085,3.3],[.13,3.4],[.13,3.48],[0,3.6]],10);
 for(const l of lamps){const y=h(l.x,l.z);poles.push(pole.clone().translate(l.x,y-.12,l.z));lanterns.push({pos:new THREE.Vector3(l.x,y+2.2,l.z),yaw:l.yaw,s:.9});}
 const poleMesh=new THREE.Mesh(mergeGeometries(poles,false)!,iron);poleMesh.name='frostlight-lamp-posts';poleMesh.castShadow=poleMesh.receiveShadow=true;group.add(poleMesh);
 const kitProps=new StaticBatch(props,'frostlight-props'),kitVillage=new StaticBatch(village,'frostlight-yard');
 const flames:THREE.BufferGeometry[]=[],flame=new THREE.SphereGeometry(.085,10,8).scale(1,1.7,1);
 const glows:{pos:THREE.Vector3;color:THREE.Color;size:number}[]=[],spots:{pos:THREE.Vector3;color:THREE.Color;power:number;flicker:number}[]=[];
 const warm=new THREE.Color('#ffb257');
 for(const l of lanterns){
  const m=trs(l.pos.x,l.pos.y,l.pos.z,l.yaw,l.s);
  // Lanterns are small and lit: their shadows would not read, so they skip the shadow pass.
  kitProps.add('Lantern_Wall',m,{override:pOver,castShadow:false});
  const core=new THREE.Vector3(0,.55,1.1).applyMatrix4(m);
  flames.push(flame.clone().scale(l.s,l.s,l.s).translate(core.x,core.y,core.z));
  glows.push({pos:core,color:warm,size:l.s*2.1});spots.push({pos:core,color:warm,power:1,flicker:0});
 }
 const flameMat=new THREE.MeshStandardMaterial({name:'frostlight-lantern-flame',color:'#ffe2a8',emissive:'#ffb04c',emissiveIntensity:5});
 const flameMesh=new THREE.Mesh(mergeGeometries(flames,false)!,flameMat);flameMesh.name='frostlight-lantern-flames';group.add(flameMesh);

 // Market, terrace, forge yard, carts, fences.
 for(const p of snowProps()){
  const m=trs(p.x,h(p.x,p.z)+p.dy,p.z,p.yaw,p.s);
  if(p.kit==='props')kitProps.add(p.piece,m,{override:pOver});else kitVillage.add(p.piece,m,{override:vOver});
 }
 // Woodpiles: round logs, bark on the sides and sawn rings on the ends, stacked against side walls.
 const logs=stream(77),logGeos:THREE.BufferGeometry[]=[],log=logGeometry();
 for(const [id,side,lz] of SNOW_WOODPILES){
  const lot=SNOW_LOTS.find(l=>l.id===id)!,[cx,cz]=woodpileAt(lot,side,lz),gy=h(...atLot(lot,cx,cz))-.04,base=trs(lot.x,gy,lot.z,lot.yaw);
  for(let row=0;row<4;row++)for(let k=0;k<5-row;k++){
   const lx=cx-side*.06*row+(logs()-.5)*.08,lzz=cz-(4-row)*.155+k*.31+(logs()-.5)*.03,s=.9+logs()*.22;
   logGeos.push(log.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(base,trs(lx,.15+row*.27,lzz,(logs()-.5)*.12,new THREE.Vector3(s,.92+logs()*.16,.92+logs()*.16),(logs()-.5)*.2))));
  }
 }
 for(const m of men)kitProps.add('Bucket_Wooden_1',m.hat,{override:pOver});
 // The market cauldron sits on a ring of logs over embers; its steam joins the smoke below.
 kitProps.add('Cauldron',trs(cx,cy+.34,cz,.4,.8),{override:pOver});
 const fireLogs:THREE.BufferGeometry[]=[];
 for(let i=0;i<5;i++){const a=i/5*Math.PI*2+.3;fireLogs.push(log.clone().applyMatrix4(trs(cx+Math.sin(a)*.42,cy+.1,cz+Math.cos(a)*.42,a+Math.PI/2,new THREE.Vector3(.85,.8,.8),0,.18)));}
 const campfire=new THREE.Mesh(mergeGeometries(fireLogs,false)!,logMaterial(true));campfire.name='frostlight-cauldron-fire';campfire.castShadow=campfire.receiveShadow=true;group.add(campfire);
 const woodpiles=new THREE.Mesh(mergeGeometries(logGeos,false)!,logMaterial());woodpiles.name='frostlight-woodpiles';woodpiles.castShadow=woodpiles.receiveShadow=true;group.add(woodpiles);
 group.add(kitProps.build(),kitVillage.build());

 // The forge hearth: a brick bed of coals under the smithy chimney.
 const forge=SNOW_LOTS.find(l=>l.kind==='forge')!,hp=frames.forgeHearth,hy=frames.footprints.find(f=>f.lot===forge)!.h;
 const hearth=new THREE.Mesh(mergeGeometries([
  worldBox(2.6,1,1.9,.5).rotateY(forge.yaw).translate(hp.x,hy+.5,hp.z),
  // A paved floor over the plinth, inside the walls and under the roof.
  worldBox(forge.sx*2-.3,.06,forge.sz*2-.3,.5).translate(0,hy+.04,0).applyMatrix4(trs(forge.x,0,forge.z,forge.yaw)),
 ],false)!,bareStone);hearth.name='frostlight-forge-floor';hearth.castShadow=hearth.receiveShadow=true;group.add(hearth);
 const coals=new THREE.Mesh(new THREE.PlaneGeometry(2.1,1.4).rotateX(-Math.PI/2).rotateY(forge.yaw).translate(hp.x,hy+1.02,hp.z),new THREE.MeshStandardMaterial({name:'frostlight-coals',color:'#1a0802',emissive:'#ff5a10',emissiveIntensity:3.4,roughness:1}));
 coals.name='frostlight-forge-coals';group.add(coals);
 const fire=new THREE.Color('#ff6a1a'),hearthGlow=new THREE.Vector3(hp.x,hy+1.5,hp.z);
 glows.push({pos:hearthGlow,color:fire,size:3.4});spots.push({pos:hearthGlow,color:new THREE.Color('#ff7a2a'),power:2.2,flicker:1});
 const emberAt=new THREE.Vector3(cx,cy+.25,cz);
 glows.push({pos:emberAt,color:fire,size:1.6});spots.push({pos:emberAt.clone().setY(cy+.6),color:new THREE.Color('#ff8a3a'),power:1.2,flicker:1});
 for(const g of strings)for(const l of g.lights)glows.push({pos:l.pos,color:l.color.clone().multiplyScalar(.32),size:.62});

 // Glow halos around every flame.
 // Flames lick up between the campfire logs and along the forge's coal bed.
 const tongues:number[]=[],tongueAttr:number[]=[],fr=stream(808);
 for(let i=0;i<6;i++){const a=fr()*6.283,d=fr()*.16;tongues.push(cx+Math.sin(a)*d,cy+.08,cz+Math.cos(a)*d);tongueAttr.push(fr()*50,.34+fr()*.2);}
 for(let i=0;i<8;i++){const along=(i/7-.5)*1.7,[lx,lz]=[Math.cos(forge.yaw)*along,-Math.sin(forge.yaw)*along];tongues.push(hp.x+lx+(fr()-.5)*.25,hy+1.0,hp.z+lz+(fr()-.5)*.25);tongueAttr.push(fr()*50,.45+fr()*.3);}
 const fg=new THREE.BufferGeometry();fg.setAttribute('position',new THREE.Float32BufferAttribute(tongues,3));fg.setAttribute('aFlame',new THREE.Float32BufferAttribute(tongueAttr,2));
 const flameMatPts=new THREE.ShaderMaterial({name:'frostlight-fire',vertexShader:FLAME_VERT,fragmentShader:FLAME_FRAG,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,fog:true,uniforms:THREE.UniformsUtils.merge([THREE.UniformsLib.fog,{uTime:{value:0},uPx:{value:450}}])});
 const flamePts=new THREE.Points(fg,flameMatPts);flamePts.name='frostlight-fire-tongues';flamePts.frustumCulled=false;flamePts.renderOrder=2;group.add(flamePts);
 const gg=new THREE.BufferGeometry();
 gg.setAttribute('position',new THREE.Float32BufferAttribute(glows.flatMap(g=>[g.pos.x,g.pos.y,g.pos.z]),3));
 gg.setAttribute('aGlow',new THREE.Float32BufferAttribute(glows.flatMap(g=>[g.color.r*.55,g.color.g*.55,g.color.b*.55,g.size]),4));
 const glowMat=new THREE.ShaderMaterial({name:'frostlight-glow',vertexShader:GLOW_VERT,fragmentShader:GLOW_FRAG,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,fog:true,uniforms:THREE.UniformsUtils.merge([THREE.UniformsLib.fog,{uTime:{value:0},uPx:{value:450}}])});
 const glowPts=new THREE.Points(gg,glowMat);glowPts.name='frostlight-lantern-glow';glowPts.frustumCulled=false;glowPts.renderOrder=2;group.add(glowPts);

 // Chimney smoke, lit warm on the sun side.
 const smokeAttr:number[]=[],smokePos:number[]=[],sr=stream(5150);
 const perChimney=(big:boolean)=>big?28:18;
 for(const c of frames.chimneys)for(let i=0;i<perChimney(c.big);i++){smokePos.push(c.top.x,c.top.y,c.top.z);smokeAttr.push(sr()*100,(c.big?.09:.06)*(.85+sr()*.3),c.big?12:9,c.big?2.6:2.0);}
 // Steam off the cauldron: quick, low and small.
 for(let i=0;i<14;i++){smokePos.push(cx,cy+1.05,cz);smokeAttr.push(sr()*100,.22*(.85+sr()*.3),2.6,.75);}
 const sg=new THREE.BufferGeometry();sg.setAttribute('position',new THREE.Float32BufferAttribute(smokePos,3));sg.setAttribute('aSmoke',new THREE.Float32BufferAttribute(smokeAttr,4));
 const smokeMat=new THREE.ShaderMaterial({name:'frostlight-smoke',vertexShader:SMOKE_VERT,fragmentShader:SMOKE_FRAG,transparent:true,depthWrite:false,fog:true,uniforms:THREE.UniformsUtils.merge([THREE.UniformsLib.fog,{uTime:{value:0},uWind:{value:new THREE.Vector2(-.55,-.35)},uLit:{value:new THREE.Color('#e9dccd')},uShade:{value:new THREE.Color('#8c97a8')},uOpacity:{value:.55},uPx:{value:450}}])});
 const smoke=new THREE.Points(sg,smokeMat);smoke.name='frostlight-chimney-smoke';smoke.frustumCulled=false;smoke.renderOrder=3;group.add(smoke);
 // Point sizes are in world units: half the drawing buffer's height in pixels scales them, at any pixel ratio.
 const buffer=new THREE.Vector2();
 for(const [pts,mat] of [[glowPts,glowMat],[smoke,smokeMat],[flamePts,flameMatPts]] as const)pts.onBeforeRender=r=>{r.getDrawingBufferSize(buffer);mat.uniforms.uPx.value=buffer.y/2;};

 // Real light from the lanterns nearest the player, from a fixed pool so no shader recompiles while walking.
 const pool=Array.from({length:2},()=>{const l=new THREE.PointLight('#ffb257',0,13,1.7);l.name='frostlight-lamp-light';group.add(l);return l;});
 const order:typeof spots=[];
 group.userData.village={lots:SNOW_LOTS.length,roofs:frames.roofs.length,chimneys:frames.chimneys.length,lamps:lamps.length,lanterns:lanterns.length,props:snowProps().length,icicles:icicles.length,woodpiles:SNOW_WOODPILES.length,snowmen:men.length,garlands:strings.length,bulbs:strings.reduce((n,g)=>n+g.lights.length,0)};
 let quality:'high'|'low'='high';
 return {
  group,stone,
  setQuality(q){if(q===quality)return;quality=q;pool.forEach((l,i)=>{l.visible=q==='high'||i===0;});sg.setDrawRange(0,q==='high'?Infinity:Math.floor(smokePos.length/3/2));},
  update(time,x,z){
   glowMat.uniforms.uTime.value=time;smokeMat.uniforms.uTime.value=time;flameMatPts.uniforms.uTime.value=time;
   (coals.material as THREE.MeshStandardMaterial).emissiveIntensity=3.4*(.85+.15*Math.sin(time*9.1)*Math.sin(time*5.3));
   order.length=0;for(const s of spots)order.push(s);
   order.sort((a,b)=>Math.hypot(a.pos.x-x,a.pos.z-z)-Math.hypot(b.pos.x-x,b.pos.z-z));
   pool.forEach((l,i)=>{const s=order[i],d=Math.hypot(s.pos.x-x,s.pos.z-z);l.position.copy(s.pos);l.color.copy(s.color);
    const f=s.flicker?.8+.2*Math.sin(time*13+i)*Math.sin(time*7.1):.95+.05*Math.sin(time*6.3+i*2.1);
    l.intensity=9*s.power*f*(1-THREE.MathUtils.smoothstep(d,28,40));});
  },
 };
}
