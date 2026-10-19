import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {type Kit,loadKit,Scatter,trs} from '../world/kit';
import {addPatch,stylise} from '../world/materials';
import {SNOW_SEA_ICE} from '../sim/world/snowGround';
import {GUARDED_NOISE,snowCover} from './snowCover';
import {cragGeometry,rockMaterial,type SnowGroundUniforms} from './snowRocks';
import {snowPines} from './snowPines';
import {fieldStream,type FieldKit,type FieldLog,type FieldStump,type ShelfSlab,SNOW_PONDS,SNOW_TRACKS,snowBoulders,snowFieldPieces,snowGroves,snowLogs,snowScours,snowShelves,snowStumps} from './snowFieldsLayout';

/*
 * Frostlight's open snowfields (layout in snowFieldsLayout.ts): the western Frostpine Woods and a few copses east,
 * boulders in the crags' own stone, bare dead and twisted trees, bushes, ferns and dry grass through the snow,
 * windfall and a woodcutter's clearing, the abandoned ore wagon at the end of the miners' trail, frozen ponds in the
 * hollows, animal trails, wind-scoured crests and, on the frozen sea, broken shelf plates and pressure ridges.
 * Kit pieces (Quaternius CC0, see NOTICE.md) are batched per material and dressed in snow by snowCover.ts, with a
 * drift banked where they meet the ground. Trails and scours are multiply decals over the terrain, so they keep
 * its light, shadow and sparkle.
 */

type Height=(x:number,z:number)=>number;
export interface SnowFieldsOptions {
 height:Height;
 /** The baked ground (snowTerrain.ts uniforms), for skirts and rock snow. */
 ground:SnowGroundUniforms;
 /** Sun direction (towards the sun), for the trails' shading. */
 sunDir:THREE.Vector3;
}
export interface SnowFields {
 group:THREE.Group;
 setQuality(q:'high'|'low'):void;
 update(time:number,x:number,z:number):void;
}

/** Kit pieces that stand bare: the twisted trees lose their crowns for the winter. */
const BARE=/^TwistedTree_/;

/** Kit materials as Frostlight wears them: cooled, wind-dried and snowed on. One clone per kit material. */
function fieldMaterials(ground:SnowGroundUniforms){
 const variants=new Map<THREE.Material,THREE.Material>();
 return (m:THREE.Material)=>{
  let v=variants.get(m);if(v)return v;v=m.clone();const sm=v as THREE.MeshStandardMaterial,n=m.name;
  if(!/Metal/.test(n)){sm.metalness=0;sm.metalnessMap=null;}
  const card=/^(Leaves|Grass)/.test(n);
  if(!card&&!/Cloth/.test(n))sm.side=THREE.FrontSide;
  if(/^Bark/.test(n))stylise(v,.35,[.3,.3,.33]);
  // Evergreen scrub (the kit's leaf atlas turned juniper): a dark, cold green that anchors the white.
  else if(n==='Leaves_TwistedTree')stylise(v,.42,[.36,.46,.45],-1.9);
  // Bracken and grass dried to rust and straw: the one warm note in the field.
  else if(n==='Leaves')stylise(v,.22,[1.15,.78,.5]);
  else if(n==='Grass')stylise(v,.12,[1.3,1.1,.78]);
  // Wood left out for winters goes silver-grey.
  else if(/Wood|Furniture/.test(n))stylise(v,.35,[.34,.34,.37]);
  else stylise(v,.85,[.98,.97,.97]);
  const skirt={ground,height:card?.05:/^Bark/.test(n)?.16:.14};
  snowCover(v,{cover:n==='Leaves_TwistedTree'?1.1:n==='Leaves'?-.3:card?.6:/^Bark/.test(n)?.85:1,skirt});
  variants.set(m,v);return v;
 };
}

// ---------------------------------------------------------------------------------------------------------------
// Logs and stumps.

/** Bark and sawn rings (as the village woodpiles, snowVillage.ts), banked in snow at the foot. aLog: (around m, along m, end). */
function barkMaterial(ground:SnowGroundUniforms){
 const m=new THREE.MeshStandardMaterial({name:'frostlight-field-bark',color:'#ffffff',roughness:.92});
 addPatch(m,'frostlight-field-bark',shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute vec3 aLog;\nvarying vec3 vLog;').replace('#include <begin_vertex>','#include <begin_vertex>\nvLog = aLog;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nvarying vec3 vLog;\n${GUARDED_NOISE}`).replace('#include <map_fragment>',`#include <map_fragment>
   {
    vec3 c;
    if (vLog.z > 0.5) {
     // Sawn face: growth rings, a darker heart, weathered grey towards the bark.
     float r = vLog.y, ring = 0.5 + 0.5 * sin(r * 34.0 + cc_vnoise(vec2(r * 6.0, vLog.x * 3.0)) * 4.0);
     c = mix(vec3(0.085, 0.06, 0.036), vec3(0.15, 0.11, 0.068), ring) * mix(0.8, 1.0, smoothstep(0.0, 0.25, r)) * mix(1.0, 0.35, smoothstep(0.86, 0.98, r));
     c = mix(c, vec3(0.09, 0.09, 0.095), 0.35 * cc_vnoise(vec2(vLog.x * 9.0, r * 7.0)));
    } else {
     // Furrowed bark: ridges along the trunk, grey lichen on the ridges.
     float n = cc_vnoise(vec2(vLog.x * 17.0, vLog.y * 2.2)) * 0.6 + cc_vnoise(vec2(vLog.x * 44.0, vLog.y * 7.0)) * 0.4;
     c = mix(vec3(0.01, 0.008, 0.007), vec3(0.036, 0.028, 0.022), n);
     c = mix(c, vec3(0.065, 0.07, 0.066), smoothstep(0.66, 0.86, cc_vnoise(vec2(vLog.x * 5.0, vLog.y * 1.6) + 5.0)) * 0.5);
    }
    diffuseColor.rgb *= c;
   }`);
 });
 snowCover(m,{cover:1,skirt:{ground,height:.1}});
 return m;
}

/** Attach aLog (around, along, end) and drop uv so logs and stumps merge. */
function logAttr(g:THREE.BufferGeometry,around:number,end:(i:number)=>number[]|null){
 const uv=g.getAttribute('uv'),a=new Float32Array(uv.count*3);
 for(let i=0;i<uv.count;i++){const e=end(i);a.set(e??[uv.getX(i)*around,uv.getY(i),0],i*3);}
 g.setAttribute('aLog',new THREE.BufferAttribute(a,3));g.deleteAttribute('uv');
 return g;
}

/** A fallen trunk along +x, centred: a little bent and out of round, one end sawn or broken, branch stubs. */
function logGeometry(l:FieldLog){
 const R=fieldStream(l.seed*613+1),seg=16,rings=Math.max(6,Math.round(l.len/.35));
 const bend=(R()-.5)*.3,taper=.75+R()*.15,broken=l.branches>0;
 const pos:number[]=[],aLog:number[]=[],idx:number[]=[];
 const radius=(t:number,a:number)=>l.r*(1-(1-taper)*t)*(1+.06*Math.sin(a*3+l.seed)+.04*Math.sin(a*7+t*9));
 const centre=(t:number)=>new THREE.Vector3((t-.5)*l.len,Math.sin(t*Math.PI)*bend*.5,Math.sin(t*Math.PI*.8)*bend);
 for(let j=0;j<=rings;j++){
  const t=j/rings,c=centre(t);
  for(let i=0;i<=seg;i++){const a=i/seg*Math.PI*2,r=radius(t,a);pos.push(c.x,c.y+Math.cos(a)*r,c.z+Math.sin(a)*r);aLog.push(i/seg*Math.PI*2*l.r,t*l.len,0);}
 }
 for(let j=0;j<rings;j++)for(let i=0;i<seg;i++){const a=j*(seg+1)+i,b=a+seg+1;idx.push(a,b,a+1,a+1,b,b+1);}
 // Ends: sawn flat at t=0; at t=1 sawn too, or snapped into splinters on windfall.
 for(const t of [0,1]){
  const c=centre(t),base=pos.length/3,dir=t?1:-1;
  pos.push(c.x,c.y,c.z);aLog.push(0,0,1);
  for(let i=0;i<=seg;i++){
   const a=i/seg*Math.PI*2,r=radius(t,a),splinter=broken&&t?(.15+.6*Math.abs(Math.sin(a*2.5+l.seed)))*l.r*(R()*.8+.2):0;
   pos.push(c.x+dir*splinter,c.y+Math.cos(a)*r,c.z+Math.sin(a)*r);aLog.push(0,broken&&t?.95:1,1);
  }
  if(broken&&t){pos[base*3]+=l.r*.5;aLog[base*3+1]=.9;}
  for(let i=0;i<seg;i++)idx.push(...(t?[base,base+1+i,base+2+i]:[base,base+2+i,base+1+i]));
 }
 let g:THREE.BufferGeometry=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('aLog',new THREE.Float32BufferAttribute(aLog,3));g.setIndex(idx);
 g=g.toNonIndexed();g.computeVertexNormals();
 // Branch stubs where the limbs broke off.
 const parts=[g];
 for(let k=0;k<l.branches;k++){
  const t=.25+R()*.6,a=R()*Math.PI*1.6-Math.PI*.3,c=centre(t),len=.35+R()*.7,rb=l.r*(.22+R()*.15);
  const b=new THREE.CylinderGeometry(rb*.45,rb,len,7,1).translate(0,len/2,0);
  logAttr(b,rb*6.28,()=>null);
  b.applyMatrix4(new THREE.Matrix4().makeRotationX(a+Math.PI/2)).applyMatrix4(new THREE.Matrix4().makeRotationY((R()-.5)*.9));
  b.translate(c.x,c.y+Math.cos(a+Math.PI)*0,c.z);
  parts.push(b.toNonIndexed());
 }
 const out=mergeGeometries(parts.map(p=>{for(const k of Object.keys(p.attributes))if(!['position','normal','aLog'].includes(k))p.deleteAttribute(k);if(!p.getAttribute('normal'))p.computeVertexNormals();return p;}),false)!;
 return out;
}

/** A stump: flared roots into the snow, bark sides, a sawn top. */
function stumpGeometry(s:FieldStump){
 const R=fieldStream(s.seed*389+3);
 const g=new THREE.CylinderGeometry(s.r,s.r*1.25,s.h+.4,14,3,false);
 const p=g.getAttribute('position');
 for(let i=0;i<p.count;i++){
  const y=p.getY(i),a=Math.atan2(p.getZ(i),p.getX(i)),foot=THREE.MathUtils.smoothstep(-y,(s.h+.4)/2-.25,(s.h+.4)/2);
  const k=1+.08*Math.sin(a*5+s.seed)+foot*(.35*Math.max(0,Math.sin(a*4+R()*.2+s.seed)));
  p.setXYZ(i,p.getX(i)*k,y,p.getZ(i)*k);
 }
 g.translate(0,(s.h+.4)/2-.4,0);
 // Cap vertices (normal straight up or down) carry the ring radius.
 const n=g.getAttribute('normal');
 logAttr(g,s.r*6.28,i=>Math.abs(n.getY(i))>.9?[R()*3,Math.min(1,Math.hypot(p.getX(i),p.getZ(i))/s.r),1]:null);
 const out=g.toNonIndexed();out.computeVertexNormals();
 return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Frozen ponds: ice at the hollow's floor, so the shore follows the drift; rime grows in from the shore.

/** Clear black ice in plates, white cracks, rime and blown snow towards the shore. aShore: 0 centre, 1 shore. */
function pondIce(){
 const m=new THREE.MeshStandardMaterial({name:'frostlight-field-pond',color:'#ffffff',roughness:.1,metalness:.05});
 addPatch(m,'frostlight-field-pond',shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float aShore;\nvarying float vShore;\nvarying vec2 vPondW;').replace('#include <begin_vertex>','#include <begin_vertex>\nvShore = aShore;\nvPondW = (modelMatrix * vec4(position, 1.0)).xz;');
  shader.fragmentShader=shader.fragmentShader
   .replace('#include <common>',`#include <common>\nvarying float vShore;\nvarying vec2 vPondW;\n${GUARDED_NOISE}\nfloat pondSnow;`)
   .replace('#include <color_fragment>',`#include <color_fragment>
    {
     // Plates: distance to the nearest and second-nearest jittered seed; a crack where they tie.
     vec2 q = vPondW * 1.3, iq = floor(q);
     float f1 = 9.0, f2 = 9.0;
     for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 c = iq + vec2(float(i), float(j)), o = c + cc_hash22(c) * 0.85;
      float d = length(q - o);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
     }
     float crack = 1.0 - smoothstep(0.012, 0.05, f2 - f1);
     float depth = cc_fbm(vPondW * 0.6 + 3.0);
     // Deep clear ice reads near black under the sky; bubbles and frost cloud it in places.
     vec3 ice = mix(vec3(0.04, 0.1, 0.15), vec3(0.2, 0.38, 0.48), depth * 0.9);
     ice = mix(ice, vec3(0.5, 0.66, 0.76), smoothstep(0.6, 0.85, cc_fbm(vPondW * 2.4 + 9.0)) * 0.45);
     ice = mix(ice, vec3(0.86, 0.94, 1.0), crack * 0.8);
     float rime = smoothstep(0.55, 0.95, vShore + (cc_fbm(vPondW * 1.7) - 0.5) * 0.5);
     float streak = smoothstep(0.6, 0.75, cc_fbm(vec2(vPondW.x * 0.35, vPondW.y * 1.6) + 11.0)) * 0.85;
     pondSnow = max(rime, streak);
     diffuseColor.rgb = mix(ice, vec3(0.93, 0.96, 1.0), pondSnow);
    }`)
   .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.85, pondSnow);');
 });
 return m;
}

function pondGeometry(p:{x:number;z:number;r:number;seed:number},h:Height){
 // The ice settles a little above the hollow's lowest snow.
 let lo=Infinity,hi=-Infinity;
 for(let a=0;a<24;a++)for(const f of [0,.35,.7,1]){const x=p.x+Math.cos(a/24*6.283)*p.r*f,z=p.z+Math.sin(a/24*6.283)*p.r*f,y=h(x,z);lo=Math.min(lo,y);hi=Math.max(hi,y);}
 const level=lo+Math.min(.3,(hi-lo)*.4)+.04,seg=72,shore:number[]=[];
 for(let i=0;i<seg;i++){
  const a=i/seg*Math.PI*2;let d=.5;
  for(;d<p.r*1.4;d+=.08)if(h(p.x+Math.cos(a)*d,p.z+Math.sin(a)*d)>level+.06)break;
  shore.push(d);
 }
 // Smooth the shoreline so it reads as water that froze, not as a contour plot.
 const sm=shore.map((_,i)=>{let s=0;for(let k=-3;k<=3;k++)s+=shore[(i+k+seg)%seg];return s/7;});
 const pos:number[]=[0,0,0],sh:number[]=[0],idx:number[]=[],rings=7;
 for(let j=1;j<=rings;j++)for(let i=0;i<seg;i++){const a=i/seg*Math.PI*2,d=sm[i]*j/rings+.25*(j===rings?1:0);pos.push(Math.cos(a)*d,0,Math.sin(a)*d);sh.push(j/rings);}
 // A skirt down from the shore, so no gap shows where the drift dips below the ice.
 for(let i=0;i<seg;i++){const a=i/seg*Math.PI*2,d=sm[i]+.4;pos.push(Math.cos(a)*d,-.45,Math.sin(a)*d);sh.push(1);}
 for(let i=0;i<seg;i++)idx.push(0,1+(i+1)%seg,1+i);
 for(let j=1;j<=rings;j++)for(let i=0;i<seg;i++){const a=1+(j-1)*seg+i,b=1+(j-1)*seg+(i+1)%seg,c=a+seg,d=b+seg;idx.push(a,b,c,b,d,c);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('aShore',new THREE.Float32BufferAttribute(sh,1));g.setIndex(idx);g.computeVertexNormals();
 // The skirt's normals face up too: it only shows as a sliver of rime at the shore.
 const n=g.getAttribute('normal');for(let i=0;i<n.count;i++)n.setXYZ(i,0,1,0);
 return {geo:g,level};
}

// ---------------------------------------------------------------------------------------------------------------
// Decals over the terrain: trails and scoured crests multiply what the snow shader already lit.

const DECAL_VERT=/* glsl */`
attribute vec4 aDecal; // x,y local (-1..1), z kind, w seed
varying vec4 vDecal;
varying vec3 vDecalW;
varying float vDecalFade;
uniform vec3 uFocus;
void main(){
 vDecal=aDecal;
 vec4 w=modelMatrix*vec4(position,1.);
 vDecalW=w.xyz;
 vDecalFade=1.-smoothstep(55.,85.,distance(w.xz,uFocus.xz));
 gl_Position=projectionMatrix*viewMatrix*w;
}`;
const DECAL_FRAG=/* glsl */`
precision highp float;
varying vec4 vDecal;
varying vec3 vDecalW;
varying float vDecalFade;
uniform vec3 uSun;
${GUARDED_NOISE}
// Depth of one print, 0 outside, 1 at its floor. kind 0 fox (oval pad), 1 hare (long), 2 deer (split hoof), 3 trough.
float printDepth(vec2 p,float kind){
 if(kind<.5)return smoothstep(1.,.45,length(p*vec2(1.,1.25)));
 if(kind<1.5)return smoothstep(1.,.5,length(p*vec2(1.6,1.)));
 if(kind<2.5){vec2 q=vec2(abs(p.x)-.32,p.y);return smoothstep(.75,.3,length(q*vec2(1.5,1.)))*smoothstep(-1.,-.4,p.y);}
 return smoothstep(1.,.2,abs(p.x));
}
void main(){
 float kind=vDecal.z;
 vec3 f=vec3(1.);
 if(kind<3.5){
  // A dimple: its floor and the wall away from the sun sit in blue shade, the wall facing it stays lit.
  vec2 p=vDecal.xy;float e=.06;
  float d=printDepth(p,kind),dx=printDepth(p+vec2(e,0.),kind)-d,dy=printDepth(p+vec2(0.,e),kind)-d;
  vec3 n=normalize(vec3(-dx/e*.35,1.,-dy/e*.35));
  float lit=clamp(dot(n,normalize(vec3(uSun.x,max(uSun.y,.25),uSun.z)))*1.2,0.,1.);
  float deep=kind>2.5?.42:.9;
  f=mix(vec3(1.),mix(vec3(.48,.6,.84),vec3(.95,.97,1.),lit),d*deep);
 }else{
  // Scoured crest: the crust broken into plates with frozen ground and gravel between, drift tails downwind (+x).
  vec2 p=vDecal.xy,w=vDecalW.xz;
  float body=1.-smoothstep(.45,1.,length(p)+(cc_fbm(w*.35+vDecal.w)-.5)*.6);
  float plates=cc_fbm(w*vec2(1.1,.7)+vDecal.w*5.)+(cc_vnoise(w*5.)-.5)*.16;
  float tail=smoothstep(.4,.8,cc_vnoise(vec2(w.x*.35,w.y*3.2)+vDecal.w*3.));
  float bare=smoothstep(-.025,.025,body*.78-plates-tail*.22);
  vec3 soil=mix(vec3(.13,.11,.1),vec3(.3,.26,.21),cc_vnoise(w*7.));
  soil=mix(soil,vec3(.42,.36,.25),smoothstep(.55,.8,cc_vnoise(w*2.3+3.))*.7);
  // Gravel: fine grain that fades out before it can alias.
  float fw=length(fwidth(w));
  soil*=1.+(cc_vnoise(w*13.)-.5)*.5*(1.-smoothstep(.02,.08,fw));
  // A glazed rim of wind crust round each bare plate.
  float rim=bare*(1.-bare)*4.;
  f=mix(vec3(1.),soil/.9,bare);
  f*=mix(vec3(1.),vec3(.8,.86,.95),rim*.6*body);
 }
 f=mix(vec3(1.),f,vDecalFade);
 gl_FragColor=vec4(f,1.);
}`;

function decalMaterial(sunDir:THREE.Vector3){
 const m=new THREE.ShaderMaterial({name:'frostlight-field-decal',vertexShader:DECAL_VERT,fragmentShader:DECAL_FRAG,uniforms:{uSun:{value:sunDir},uFocus:{value:new THREE.Vector3()}},
  transparent:true,depthWrite:false,blending:THREE.CustomBlending,blendSrc:THREE.ZeroFactor,blendDst:THREE.SrcColorFactor,blendEquation:THREE.AddEquation,premultipliedAlpha:true,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-4});
 return m;
}

/** One quad per print (and a faint trough along each trail), lifted over the drift to clear the sastrugi. */
function trailGeometry(h:Height){
 const pos:number[]=[],dec:number[]=[],idx:number[]=[];
 const quad=(x:number,z:number,yaw:number,hw:number,hl:number,kind:number,seed:number,lift=.07)=>{
  const c=Math.cos(yaw),s=Math.sin(yaw),b=pos.length/3;
  for(const [u,v] of [[-1,-1],[1,-1],[1,1],[-1,1]]){
   const lx=u*hw,lz=v*hl,wx=x+c*lx+s*lz,wz=z-s*lx+c*lz;
   pos.push(wx,h(wx,wz)+lift,wz);dec.push(u,v,kind,seed);
  }
  idx.push(b,b+2,b+1,b,b+3,b+2);
 };
 for(const t of SNOW_TRACKS){
  const R=fieldStream(t.seed*53),kind=t.kind==='fox'?0:t.kind==='hare'?1:2;
  const step=t.kind==='fox'?.62:t.kind==='hare'?1.25:.95;
  let side=1;
  for(let i=0;i<t.points.length-1;i++){
   const [ax,az]=t.points[i],[bx,bz]=t.points[i+1],len=Math.hypot(bx-ax,bz-az),dx=(bx-ax)/len,dz=(bz-az)/len;
   const yaw=Math.atan2(dx,dz);
   for(let d=R()*step;d<len;d+=step*(.9+R()*.2)){
    // A meander on top of the polyline, so no trail runs ruler-straight.
    const wob=Math.sin((i*len+d)*.35+t.seed)*.35,x=ax+dx*d+dz*wob,z=az+dz*d-dx*wob;
    if(t.kind==='hare'){
     // Hind feet side by side ahead of the fore feet in line.
     for(const o of [-.13,.13])quad(x+dz*o,z-dx*o,yaw,.09,.2,1,R());
     quad(x-dx*.36,z-dz*.36,yaw,.08,.1,0,R());quad(x-dx*.55+dz*.04,z-dz*.55-dx*.04,yaw,.08,.1,0,R());
    }else{
     const o=side*(t.kind==='fox'?.04:.11);side=-side;
     quad(x+dz*o,z-dx*o,yaw+(R()-.5)*.2,t.kind==='fox'?.12:.14,t.kind==='fox'?.15:.18,kind,R());
    }
   }
   // The trough the animal pushed through the powder.
   const n=Math.max(1,Math.round(len/1.5));
   for(let k=0;k<n;k++){const d0=(k+.5)*len/n,wob=Math.sin((i*len+d0)*.35+t.seed)*.35;quad(ax+dx*d0+dz*wob,az+dz*d0-dx*wob,yaw,.32,len/n/2+.1,3,0,.06);}
  }
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('aDecal',new THREE.Float32BufferAttribute(dec,4));g.setIndex(idx);
 return g;
}

/** Scoured crests as draped grids. */
function scourGeometry(h:Height){
 const pos:number[]=[],dec:number[]=[],idx:number[]=[],n=22;
 for(const s of snowScours(h)){
  const c=Math.cos(s.yaw),sn=Math.sin(s.yaw),b=pos.length/3;
  for(let j=0;j<=n;j++)for(let i=0;i<=n;i++){
   const u=i/n*2-1,v=j/n*2-1,lx=u*s.rx*1.25,lz=v*s.rz*1.25,x=s.x+c*lx+sn*lz,z=s.z-sn*lx+c*lz;
   pos.push(x,h(x,z)+.09,z);dec.push(u*1.25,v*1.25,4,s.seed*1.7);
  }
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){const a=b+j*(n+1)+i,bb=a+1,cc=a+n+1,d=cc+1;idx.push(a,cc,bb,bb,cc,d);}
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('aDecal',new THREE.Float32BufferAttribute(dec,4));g.setIndex(idx);
 return g;
}

// ---------------------------------------------------------------------------------------------------------------
// Sea ice: shelf plates and ridge rubble, snow on top, banded blue ice on the broken faces.

/** One broken plate: few corners and long straight breaks, a snow pillow on top, a bevel of crust, jagged faces. */
function slabGeometry(s:ShelfSlab){
 const R=fieldStream(s.seed*7331+11),n=4+Math.floor(R()*3),ring:[number,number][]=[];
 const angs=Array.from({length:n},(_,i)=>(i+(R()-.5)*.55)/n*Math.PI*2).sort((a,b)=>a-b);
 for(const a of angs){const c=Math.cos(a)/(s.w*.5),d=Math.sin(a)/(s.d*.5),r=(.88+R()*.24)/Math.sqrt(c*c+d*d);ring.push([Math.cos(a)*r,Math.sin(a)*r]);}
 const h=s.t*.5,bev=Math.min(.08,s.t*.18);
 const T=ring.map(([x,z])=>[x*.93,h+(R()-.5)*.02,z*.93]);
 const U=ring.map(([x,z])=>[x,h-bev,z]);
 const M=ring.map(([x,z])=>{const k=1+(R()-.3)*.05;return [x*k,h*(R()*.5-.3),z*k];});
 const B=ring.map(([x,z])=>[x*.95,-h,z*.95]);
 const pos:number[]=[],band:number[]=[];
 const tri=(a:number[],b:number[],c:number[],ba:number,bb:number,bc:number)=>{pos.push(...a,...b,...c);band.push(ba,bb,bc);};
 // Snow pillowed over the plate.
 const ct=[0,h+Math.min(.18,s.t*.2),0];
 for(let i=0;i<n;i++){const j=(i+1)%n;
  // Long edges get a mid vertex so the break is not one flat facet.
  const tm=[(T[i][0]+T[j][0])/2*1.0,h+(R()-.3)*.03,(T[i][2]+T[j][2])/2];
  tri(ct,tm,T[i],2,2,2);tri(ct,T[j],tm,2,2,2);
  tri(T[i],tm,U[i],2,2,1);tri(tm,T[j],U[j],2,2,1);tri(U[i],tm,U[j],1,2,1);
  tri(U[i],U[j],M[i],1,1,.5);tri(M[i],U[j],M[j],.5,1,.5);
  tri(M[i],M[j],B[i],.5,.5,0);tri(B[i],M[j],B[j],.0,.5,0);
  tri([0,-h,0],B[j],B[i],0,0,0);
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('aBand',new THREE.Float32BufferAttribute(band,1));
 g.computeVertexNormals();
 return g;
}

function seaIceMaterial(){
 const m=new THREE.MeshStandardMaterial({name:'frostlight-sea-ice',color:'#ffffff',roughness:.35,metalness:0});
 addPatch(m,'frostlight-sea-ice',shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float aBand;\nvarying float vBand;\nvarying vec3 vIceW;\nvarying vec3 vIceN;')
   .replace('#include <begin_vertex>','#include <begin_vertex>\nvBand = aBand;')
   .replace('#include <project_vertex>','#include <project_vertex>\nvIceW = (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz + cameraPosition;\nvIceN = (vec4(transformedNormal, 0.0) * viewMatrix).xyz;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nvarying float vBand;\nvarying vec3 vIceW;\nvarying vec3 vIceN;\n${GUARDED_NOISE}\nfloat iceSnow;`)
   .replace('#include <color_fragment>',`#include <color_fragment>
    {
     vec3 n = normalize(vIceN);
     // Broken faces: glassy blue-green, deepest at the waterline, paling up into the old snow layers of the floe.
     float layer = cc_vnoise(vec2(vIceW.y * 9.0, (vIceW.x + vIceW.z) * 0.6));
     vec3 ice = mix(vec3(0.07, 0.33, 0.42), vec3(0.5, 0.8, 0.88), smoothstep(0.0, 0.95, vBand));
     ice = mix(ice, vec3(0.72, 0.88, 0.93), smoothstep(0.62, 0.9, layer) * 0.35 * vBand);
     ice *= 0.92 + 0.16 * cc_vnoise(vIceW.xz * 2.3 + vIceW.y * 3.0);
     float top = smoothstep(1.2, 1.9, vBand);
     iceSnow = max(top, smoothstep(0.62, 0.85, n.y + (cc_vnoise(vIceW.xz * 1.4) - 0.5) * 0.3));
     diffuseColor.rgb = mix(ice, vec3(0.93, 0.96, 1.0), iceSnow);
    }`)
   .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor = mix(0.2, 0.85, iceSnow);')
   .replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.015, 0.08, 0.1) * (1.0 - iceSnow) * smoothstep(0.1, 1.0, vBand);');
 });
 return m;
}

// ---------------------------------------------------------------------------------------------------------------

/** World-space pieces merged per 40 m cell, so each cell is frustum-culled (and shadow-culled) on its own. */
function cells(name:string,items:readonly {x:number;z:number;geo:THREE.BufferGeometry}[],material:THREE.Material,shadow=true){
 const by=new Map<string,THREE.BufferGeometry[]>();
 for(const it of items){const k=`${Math.floor(it.x/40)},${Math.floor(it.z/40)}`;let l=by.get(k);if(!l)by.set(k,l=[]);l.push(it.geo);}
 const group=new THREE.Group();group.name=name;
 for(const [k,geos] of by){const m=new THREE.Mesh(mergeGeometries(geos,false)!,material);m.name=`${name}:${k}`;m.castShadow=shadow;m.receiveShadow=true;m.matrixAutoUpdate=false;group.add(m);}
 return group;
}

/** Load the kits and dress the fields. The caller adds `group` to the island root. */
export async function buildSnowFields(opts:SnowFieldsOptions):Promise<SnowFields>{
 const h=opts.height,group=new THREE.Group();group.name='frostlight-fields';
 const [nature,props,village,groves]=await Promise.all([loadKit('models/world/nature.glb'),loadKit('models/world/props.glb'),loadKit('models/world/village.glb'),snowPines(snowGroves(),h,'frostlight-groves')]);
 groves.userData.groves=snowGroves().length;group.add(groves);
 // Bare variants of the twisted trees.
 for(const n of [...nature.pieces.keys()])if(BARE.test(n)){const p=nature.get(n);nature.pieces.set(`${n}_Bare`,{...p,parts:p.parts.filter(q=>!q.material.name.startsWith('Leaves'))});}
 const kits:Record<FieldKit,Kit>={nature,props,village};
 const mat=fieldMaterials(opts.ground);
 // Solids and anything big cast shadows; ferns and grass do not.
 const scatters=new Map<string,Scatter>(),fine=new Map<string,Scatter>();
 const scatterFor=(kit:FieldKit,shadow:boolean,isFine:boolean)=>{const key=`${kit}:${shadow}`,map=isFine?fine:scatters;let s=map.get(key);if(!s)map.set(key,s=new Scatter(kits[kit],`frostlight-field-${kit}${shadow?'':'-flat'}${isFine?'-fine':''}`));return s;};
 let placed=0;
 for(const p of snowFieldPieces()){
  const piece=BARE.test(p.piece)?`${p.piece}_Bare`:p.piece;
  if(!kits[p.kit].has(piece))continue;
  const shadow=!/^(Fern|Grass|Bush)/.test(piece);
  scatterFor(p.kit,shadow,!!p.fine).add(piece,trs(p.x,h(p.x,p.z)-p.sink,p.z,p.yaw,p.s,p.pitch??0,p.roll??0));placed++;
 }
 const fineGroup=new THREE.Group();fineGroup.name='frostlight-field-fine';
 for(const [key,s] of scatters)group.add(s.build({castShadow:!key.endsWith(':false'),materialFor:mat}));
 for(const [key,s] of fine)fineGroup.add(s.build({castShadow:!key.endsWith(':false'),materialFor:mat}));
 group.add(fineGroup);

 // Boulders: the crags' generator at a boulder's detail, in the crags' stone, merged per cell.
 const rocks=snowBoulders().map(b=>{
  const g=cragGeometry({x:b.x,z:b.z,r:b.r,h:b.h,yaw:b.yaw,seed:b.seed},b.r>1.2?7:5);
  let low=Infinity;for(let a=0;a<8;a++)low=Math.min(low,h(b.x+Math.cos(a*.785)*b.r,b.z+Math.sin(a*.785)*b.r));
  g.applyMatrix4(trs(b.x,low-.3*b.h,b.z,b.yaw,b.r));
  for(const k of Object.keys(g.attributes))if(k!=='position'&&k!=='normal')g.deleteAttribute(k);
  return {x:b.x,z:b.z,geo:g};
 });
 const boulders=cells('frostlight-field-boulders',rocks,rockMaterial(opts.ground,.3,.8));group.add(boulders);

 // Logs and stumps.
 const wood=[
  ...snowLogs().map(l=>{const g=logGeometry(l),y=h(l.x,l.z)+l.r-l.sink;g.applyMatrix4(trs(l.x,y,l.z,l.yaw,1,0,(fieldStream(l.seed)()-.5)*.06));return {x:l.x,z:l.z,geo:g};}),
  ...snowStumps().map(s=>{const g=stumpGeometry(s);g.applyMatrix4(trs(s.x,h(s.x,s.z),s.z,s.seed));return {x:s.x,z:s.z,geo:g};}),
 ];
 const logs=cells('frostlight-field-wood',wood,barkMaterial(opts.ground));group.add(logs);

 // Ponds.
 const iceMat=pondIce();
 SNOW_PONDS.forEach((p,i)=>{
  const {geo,level}=pondGeometry(p,h);
  const ice=new THREE.Mesh(geo,iceMat);ice.name=`frostlight-field-pond-${i}`;ice.position.set(p.x,level,p.z);ice.receiveShadow=true;group.add(ice);
 });

 // Trails and scours.
 const decalMat=decalMaterial(opts.sunDir);
 const trails=new THREE.Mesh(trailGeometry(h),decalMat);trails.name='frostlight-field-trails';trails.renderOrder=1;group.add(trails);
 const scours=new THREE.Mesh(scourGeometry(h),decalMat);scours.name='frostlight-field-scours';scours.renderOrder=1;group.add(scours);

 // Sea ice.
 const slabs=snowShelves().map(s=>{const g=slabGeometry(s);g.applyMatrix4(trs(s.x,SNOW_SEA_ICE+s.lift-s.t*.3,s.z,s.yaw,1,s.pitch,s.roll));return {x:s.x,z:s.z,geo:g};});
 const shelves=cells('frostlight-ice-shelves',slabs,seaIceMaterial());group.add(shelves);

 group.userData.fields={pieces:placed,groves:snowGroves().length,boulders:snowBoulders().length,logs:snowLogs().length,stumps:snowStumps().length,ponds:SNOW_PONDS.length,tracks:SNOW_TRACKS.length,scours:snowScours(h).length,slabs:slabs.length};
 for(const piece of [...nature.pieces.values(),...props.pieces.values(),...village.pieces.values()])for(const part of piece.parts)part.geometry.dispose();
 let quality:'high'|'low'='high';
 return {
  group,
  setQuality(q){if(q===quality)return;quality=q;fineGroup.visible=q==='high';trails.visible=q==='high';},
  update(_time,x,z){decalMat.uniforms.uFocus.value.set(x,0,z);},
 };
}
