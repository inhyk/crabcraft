import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {harmonise,type Kit,loadKit,trs} from '../world/kit';
import {addPatch,stylise} from '../world/materials';
import {SNOW_SEA_ICE} from '../sim/world/snowGround';
import {GUARDED_NOISE,snowCover} from './snowCover';
import {boulderGeometry,rockMaterial,snowSkirt,type SnowGroundUniforms} from './snowRocks';
import {frostFire} from './frostFire';
import {fieldStream,WOODCUT_LANTERN,type FieldKit,type FieldLog,type FieldStump,type ShelfSlab,SNOW_PONDS,SNOW_TRACKS,snowBoulders,snowFieldPieces,snowGroves,snowLogs,snowPebbles,snowScours,snowScrubItems,snowShelves,snowStumps} from './snowFieldsLayout';
import {snowScrub} from './snowScrub';
import {lanternFlameAt,noteLantern} from './frostLantern';

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
 /** The sky's colours (snowSky.ts), for what the pond ice reflects. */
 sky:{skyHorizon:THREE.Color;skyZenith:THREE.Color};
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
  // Dead bark wet with melt: a rich warm umber, the darkest warm note against the snow.
 if(/^Bark/.test(n))stylise(v,.95,[.4,.28,.2]);
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
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nvarying vec3 vLog;\n${GUARDED_NOISE}\nfloat ccBarkH = 0.0;`).replace('#include <map_fragment>',`#include <map_fragment>
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
     ccBarkH = n;
    }
    diffuseColor.rgb *= c;
   }`).replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
   {
    // The furrows in relief: a bump from the bark's own pattern, fading before it can shimmer.
    vec3 bp = -vViewPosition, bdx = dFdx(bp), bdy = dFdy(bp);
    float hx = dFdx(ccBarkH), hy = dFdy(ccBarkH);
    vec3 r1 = cross(bdy, normal), r2 = cross(normal, bdx);
    float det = dot(bdx, r1), fade = 1.0 - smoothstep(6.0, 18.0, length(vViewPosition));
    normal = normalize(abs(det) * normal - sign(det) * (hx * r1 + hy * r2) * 0.012 * fade);
    // Snow banked on the wood lies as the drift does.
    normal = normalize(mix(normal, (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz, ccSnow * 0.65));
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
 // Smooth normals on the shared rings first: computed after de-indexing they would be one per facet.
 g.computeVertexNormals();g=g.toNonIndexed();
 // Branch stubs where the limbs broke off.
 const parts=[g];
 for(let k=0;k<l.branches;k++){
  const t=.25+R()*.6,a=R()*Math.PI*1.6-Math.PI*.3,c=centre(t),len=.35+R()*.7,rb=l.r*(.22+R()*.15);
  const b=new THREE.CylinderGeometry(rb*.45,rb,len,7,1).translate(0,len/2,0);
  logAttr(b,rb*6.28,()=>null);
  b.applyMatrix4(new THREE.Matrix4().makeRotationX(a+Math.PI/2)).applyMatrix4(new THREE.Matrix4().makeRotationY((R()-.5)*.9));
  b.translate(c.x,c.y,c.z);b.computeVertexNormals();
  parts.push(b.toNonIndexed());
 }
 const out=mergeGeometries(parts.map(p=>{for(const k of Object.keys(p.attributes))if(!['position','normal','aLog'].includes(k))p.deleteAttribute(k);return p;}),false)!;
 return out;
}

/** A stump: buttress roots flaring into the snow, bark sides, a sawn top a little off level. */
function stumpGeometry(s:FieldStump){
 const R=fieldStream(s.seed*389+3),H=s.h+.45,lobes=4+Math.floor(R()*3),ph=R()*6.283;
 const g=new THREE.CylinderGeometry(s.r,s.r*1.15,H,30,8,false);
 const p=g.getAttribute('position');
 for(let i=0;i<p.count;i++){
  const y=p.getY(i),a=Math.atan2(p.getZ(i),p.getX(i)),foot=THREE.MathUtils.smoothstep(-y,H/2-.42,H/2);
  // Roots: lobes that swell towards the snow; the bark between them stays tight to the trunk.
  const root=Math.max(0,Math.sin(a*lobes+ph))**1.6*(1+.3*Math.sin(a*lobes*2.3+s.seed));
  const k=1+.05*Math.sin(a*7+s.seed)+.03*Math.sin(a*13-s.seed)+foot*foot*(.12+.55*root);
  p.setXYZ(i,p.getX(i)*k,y,p.getZ(i)*k);
 }
 g.translate(0,H/2-.45,0);
 // The saw cut leans a few degrees, so no two tops are level.
 const tilt=(R()-.5)*.12,tiltA=R()*6.283,n=g.getAttribute('normal');
 for(let i=0;i<p.count;i++)if(p.getY(i)>s.h-.01)p.setY(i,p.getY(i)+(Math.cos(tiltA)*p.getX(i)+Math.sin(tiltA)*p.getZ(i))*tilt);
 g.computeVertexNormals();
 // Cap vertices (normal straight up or down) carry the ring radius.
 logAttr(g,s.r*6.28,i=>Math.abs(n.getY(i))>.9?[R()*3,Math.min(1,Math.hypot(p.getX(i),p.getZ(i))/s.r),1]:null);
 return g;
}

// ---------------------------------------------------------------------------------------------------------------
// Frozen ponds: one draped sheet per pond. Flat black ice where the hollow is below the water line, draped over
// the rising shore beyond it, where the drift takes the ice over and the sheet fades into the snowfield, so the
// shore is drawn by the ice, not by where the terrain happens to cross a plane.

/** Pond ice: clear over dark water, paler where shallow, long cracks and bubble streaks, frost feathers and blown
 * snow towards the shore, the sky and the aurora faintly in it by Fresnel. aIce: (shore 0..1 inside, band 0..1 past
 * the shore to the rim, water depth under the ice, metres). */
function pondIce(sky:{skyHorizon:THREE.Color;skyZenith:THREE.Color}){
 const m=new THREE.MeshStandardMaterial({name:'frostlight-field-pond',color:'#ffffff',roughness:.1,metalness:0,envMapIntensity:0,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-4});
 const uniforms={pdSkyH:{value:sky.skyHorizon},pdSkyZ:{value:sky.skyZenith},pdTime:{value:0}};
 addPatch(m,'frostlight-field-pond',shader=>{
  Object.assign(shader.uniforms,uniforms);
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute vec3 aIce;\nvarying vec3 vIce;\nvarying vec3 vPondW;').replace('#include <begin_vertex>','#include <begin_vertex>\nvIce = aIce;\nvPondW = (modelMatrix * vec4(position, 1.0)).xyz;');
  shader.fragmentShader=shader.fragmentShader
   .replace('#include <common>',`#include <common>
uniform vec3 pdSkyH;
uniform vec3 pdSkyZ;
uniform float pdTime;
varying vec3 vIce;
varying vec3 vPondW;
${GUARDED_NOISE}
float pdSnow,pdFrost;
// Distance to the nearest and second-nearest jittered seed of a cell grid.
vec2 pdCells(vec2 q){vec2 iq=floor(q);float f1=9.,f2=9.;
 for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){vec2 c=iq+vec2(float(i),float(j)),o=c+cc_hash22(c)*.9;float d=length(q-o);if(d<f1){f2=f1;f1=d;}else if(d<f2)f2=d;}
 return vec2(f1,f2);}
// The sky in a direction, and the aurora curtain (world4.ts: a 650 x 90 m sheet at z=-270, y 90..180) in it.
vec3 pdEnv(vec3 r){
 vec3 c=mix(pdSkyH,pdSkyZ,smoothstep(0.,.6,r.y));
 if(r.z<-.2&&r.y>0.){
  float t=270./-r.z,px=vPondW.x+r.x*t,py=vPondW.y+r.y*t,u=(px+325.)/650.,v=(py-90.)/90.;
  if(u>0.&&u<1.&&v>0.&&v<1.){
   float rays=.5+.5*sin(u*75.+sin(u*12.+pdTime*.2)*3.);
   float a=sin(v*3.14159)*(.1+.22*rays)*smoothstep(0.,.2,u)*smoothstep(1.,.8,u);
   c+=mix(vec3(.1,.95,.65),vec3(.35,.32,.9),v)*1.7*a;
  }
 }
 return c;
}`)
   .replace('#include <color_fragment>',`#include <color_fragment>
    {
     vec2 w=vPondW.xz;float shore=vIce.x,band=vIce.y,depth=vIce.z;
     // Clear ice: near black over deep water, the snow bed showing through where it is shallow.
     float deep=smoothstep(.0,.14,depth)*(1.-smoothstep(.85,1.,shore))+smoothstep(.0,.5,1.-shore)*.35;deep=min(deep,1.);
     vec3 ice=mix(vec3(.13,.21,.26),vec3(.016,.045,.058),deep);
     ice*=.85+.3*cc_fbm(w*.45+3.);
     // Bubble streaks frozen in, and the aurora's teal deep in the clearest ice.
     float bub=smoothstep(.62,.8,cc_fbm(vec2(w.x*1.7+w.y*.6,w.y*.5)+9.))*smoothstep(.55,.75,cc_vnoise(w*9.));
     ice=mix(ice,vec3(.62,.72,.8),bub*.55);
     ice+=vec3(.0,.045,.04)*deep*(1.-bub);
     // A few long cracks across the sheet and faint hairlines between: no tiling.
     vec2 c1=pdCells(w*.32+7.),c2=pdCells(w*1.15);
     // Only some cell edges crack: a mask along the sheet breaks the net into lines that start and stop.
     float k1=(1.-smoothstep(.004,.022,c1.y-c1.x))*smoothstep(.45,.62,cc_vnoise(w*.42+1.7)),k2=(1.-smoothstep(.004,.016,c2.y-c2.x))*smoothstep(.6,.75,cc_vnoise(w*.7-3.))*.3;
     ice=mix(ice,vec3(.78,.86,.92),max(k1*.75,k2));
     // Frost feathers grown out from the shore, and blown snow lying on the ice in streaks along the wind.
     float fe=cc_fbm(vec2(dot(w,vec2(.8,.6))*3.1,dot(w,vec2(-.6,.8))*.9)+4.);
     pdFrost=smoothstep(.5,.66,fe+shore*.45-.35)*smoothstep(.45,.9,shore);
     float streak=smoothstep(.68,.84,cc_fbm(vec2(w.x*.3,w.y*1.4)+11.))*.5*smoothstep(.3,.8,shore);
     // The drift over the rim: from the shore out it is snow, its edge ragged.
     float lip=smoothstep(.12,.42,band+(cc_fbm(w*1.6)-.5)*.45);
     pdSnow=max(max(lip,streak*(1.-deep*.4)),pdFrost*.55);
     diffuseColor.rgb=mix(ice,vec3(.79,.86,.97),pdSnow);
     // Past the shore the sheet fades into the field's own snow.
     diffuseColor.a=1.-smoothstep(.55,.95,band+(cc_fbm(w*1.3+2.)-.5)*.35);
    }`)
   .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor = mix(.05, .62, pdSnow);')
   .replace('#include <opaque_fragment>',`{
     // Sky and aurora by Fresnel, gone under snow and frost.
     vec3 nW=inverseTransformDirection(normal,viewMatrix),vW=normalize(cameraPosition-vPondW);
     float F=.02+.98*pow(1.-clamp(dot(nW,vW),0.,1.),5.);
     outgoingLight+=pdEnv(reflect(-vW,nW))*F*(1.-pdSnow)*.45;
    }
    #include <opaque_fragment>`);
 });
 return {material:m,uniforms};
}

/** One pond's sheet in world space: flat at the water line, draped over the shore past it, out to a faded rim. */
function pondGeometry(p:{x:number;z:number;r:number;seed:number},h:Height){
 let lo=Infinity,hi=-Infinity;
 for(let a=0;a<24;a++)for(const f of [0,.35,.7,1]){const x=p.x+Math.cos(a/24*6.283)*p.r*f,z=p.z+Math.sin(a/24*6.283)*p.r*f,y=h(x,z);lo=Math.min(lo,y);hi=Math.max(hi,y);}
 // The water line: a little over the hollow's floor, so crabs on the ice barely sink into it.
 const level=lo+Math.min(.24,(hi-lo)*.4)+.03,seg=96,rings=18,shore:number[]=[];
 for(let i=0;i<seg;i++){
  const a=i/seg*Math.PI*2;let d=.5;
  for(;d<p.r*1.4;d+=.06)if(h(p.x+Math.cos(a)*d,p.z+Math.sin(a)*d)>level+.08)break;
  shore.push(Math.max(d,1.2));
 }
 // Smooth the shoreline so it reads as water that froze, not as a contour plot.
 const sm=shore.map((_,i)=>{let s=0;for(let k=-4;k<=4;k++)s+=shore[(i+k+seg)%seg];return s/9;});
 const R=fieldStream(p.seed*31+7),band=1.1+p.r*.12,wob=Array.from({length:5},()=>R()*6.283);
 const pos:number[]=[p.x,level,p.z],ice:number[]=[0,0,Math.max(0,level-h(p.x,p.z))],idx:number[]=[];
 for(let j=1;j<=rings;j++)for(let i=0;i<seg;i++){
  const a=i/seg*Math.PI*2,t=j/rings;
  // Two thirds of the rings inside the shore, the rest over the band.
  const sh=sm[i]*(1+.06*Math.sin(a*3+wob[0])+.04*Math.sin(a*5+wob[1])),d=t<=.66?sh*t/.66:sh+band*(t-.66)/.34;
  const x=p.x+Math.cos(a)*d,z=p.z+Math.sin(a)*d,g=h(x,z);
  pos.push(x,Math.max(level,g+.07),z);ice.push(Math.min(1,d/sh),Math.max(0,(d-sh)/band),Math.max(0,level-g));
 }
 for(let i=0;i<seg;i++)idx.push(0,1+(i+1)%seg,1+i);
 for(let j=1;j<rings;j++)for(let i=0;i<seg;i++){const a=1+(j-1)*seg+i,b=1+(j-1)*seg+(i+1)%seg,c=a+seg,d=b+seg;idx.push(a,b,c,b,d,c);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('aIce',new THREE.Float32BufferAttribute(ice,3));g.setIndex(idx);g.computeVertexNormals();
 return g;
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

/**
 * World-space pieces in one BatchedMesh per layer: one draw (and one shadow draw) for all of them, each piece still
 * culled on its own in every pass, so a merged layer costs no more triangles than its visible pieces.
 */
function cells(name:string,items:readonly {x:number;z:number;geo:THREE.BufferGeometry}[],material:THREE.Material,shadow=true){
 const group=new THREE.Group();group.name=name;
 const list=harmonise(items.map(it=>it.geo));
 let verts=0,index=0;for(const g of list){verts+=g.getAttribute('position').count;index+=g.index?.count??0;}
 const bm=new THREE.BatchedMesh(list.length,verts,index,material);bm.name=name;bm.sortObjects=false;bm.perObjectFrustumCulled=true;
 for(const g of list){bm.addInstance(bm.addGeometry(g));g.dispose();}
 bm.computeBoundingBox();bm.computeBoundingSphere();bm.castShadow=shadow;bm.receiveShadow=true;group.add(bm);
 return group;
}

/** Load the kits and dress the fields. The caller adds `group` to the island root. */
export async function buildSnowFields(opts:SnowFieldsOptions):Promise<SnowFields>{
 const h=opts.height,group=new THREE.Group();group.name='frostlight-fields';
 const [nature,props,village]=await Promise.all([loadKit('models/world/nature.glb'),loadKit('models/world/props.glb'),loadKit('models/world/village.glb')]);
 // Bare variants of the twisted trees.
 for(const n of [...nature.pieces.keys()])if(BARE.test(n)){const p=nature.get(n);nature.pieces.set(`${n}_Bare`,{...p,parts:p.parts.filter(q=>!q.material.name.startsWith('Leaves'))});}
 const kits:Record<FieldKit,Kit>={nature,props,village};
 const mat=fieldMaterials(opts.ground);
 // Kit pieces in one BatchedMesh per material across the whole field: a piece's geometry once, an instance per
 // placement, culled one by one; the fine dressing is the instances low quality hides.
 const byMat=new Map<THREE.Material,{geos:Map<string,THREE.BufferGeometry>;items:{key:string;m:THREE.Matrix4;fine:boolean}[]}>();
 let placed=0;
 for(const p of snowFieldPieces()){
  const piece=BARE.test(p.piece)?`${p.piece}_Bare`:p.piece;
  if(!kits[p.kit].has(piece))continue;
  const m=trs(p.x,h(p.x,p.z)-p.sink,p.z,p.yaw,p.s,p.pitch??0,p.roll??0);
  kits[p.kit].get(piece).parts.forEach((part,k)=>{
   const v=mat(part.material),key=`${p.kit}:${piece}#${k}`;let e=byMat.get(v);if(!e)byMat.set(v,e={geos:new Map(),items:[]});
   if(!e.geos.has(key))e.geos.set(key,part.geometry.clone());e.items.push({key,m,fine:!!p.fine});
  });
  placed++;
 }
 const kit=new THREE.Group();kit.name='frostlight-field-kit';
 const fineIds:{bm:THREE.BatchedMesh;ids:number[]}[]=[];
 for(const [v,e] of byMat){
  const keys=[...e.geos.keys()],list=harmonise(keys.map(k=>e.geos.get(k)!));
  let verts=0,index=0;for(const g of list){verts+=g.getAttribute('position').count;index+=g.index!.count;}
  const bm=new THREE.BatchedMesh(e.items.length,verts,index,v);bm.name=`frostlight-field-kit:${v.name}`;bm.sortObjects=false;bm.perObjectFrustumCulled=true;
  const gid=new Map(keys.map((k,i)=>[k,bm.addGeometry(list[i])]));for(const g of list)g.dispose();
  const ids:number[]=[];
  for(const it of e.items){const id=bm.addInstance(gid.get(it.key)!);bm.setMatrixAt(id,it.m);if(it.fine)ids.push(id);}
  bm.computeBoundingBox();bm.computeBoundingSphere();bm.castShadow=bm.receiveShadow=true;kit.add(bm);
  if(ids.length)fineIds.push({bm,ids});
 }
 group.add(kit);

 // Boulders: the crags' stone at a boulder's size, rounded and worn (snowRocks.ts), banked in snow, one mesh.
 const stones=snowPebbles(),rocks0=snowBoulders().length;
 const rocks=[...snowBoulders(),...stones].map((b,i)=>{
  const pebble=i>=rocks0,g=pebble?boulderGeometry(b,6,2.5):boulderGeometry(b);
  let low=Infinity;for(let a=0;a<12;a++)low=Math.min(low,h(b.x+Math.cos(a*.5236)*b.r*.8,b.z+Math.sin(a*.5236)*b.r*.8));
  // The ground line between the lowest snow round the stone and the snow at its heart: buried uphill, its foot showing downhill.
  g.applyMatrix4(trs(b.x,low*.6+h(b.x,b.z)*.4-(pebble?.05:.04),b.z,b.yaw,1));
  // Pebbles lie on the crust the wind left: no drift banked against them.
  if(pebble){const c=g.getAttribute('color');for(let k=0;k<c.count;k++){c.setX(k,c.getX(k)*.85);c.setZ(k,.08);}return {x:b.x,z:b.z,geo:g};}
  return {x:b.x,z:b.z,geo:snowSkirt(g,b.x,b.z,h,.12+.04*b.r,.05+.05*b.r,b.seed)};
 });
 const rockMat=rockMaterial(opts.ground,.25,.45,.6);rockMat.vertexColors=true;
 const boulders=cells('frostlight-field-boulders',rocks,rockMat);group.add(boulders);

 // Logs and stumps.
 const wood=[
  ...snowLogs().map(l=>{const g=logGeometry(l),y=h(l.x,l.z)+l.r-l.sink;g.applyMatrix4(trs(l.x,y,l.z,l.yaw,1,0,(fieldStream(l.seed)()-.5)*.06));return {x:l.x,z:l.z,geo:g};}),
  ...snowStumps().map(s=>{const g=stumpGeometry(s);g.applyMatrix4(trs(s.x,h(s.x,s.z),s.z,s.seed));return {x:s.x,z:s.z,geo:snowSkirt(g,s.x,s.z,h,.12,.07,s.seed).toNonIndexed()};}),
 ];
 // The woodcutter's stake, driven into a stump, leaning a little; its lantern is a kit piece in snowFieldPieces().
 const L=WOODCUT_LANTERN,ly=h(L.x,L.z),stake=logGeometry({x:0,z:0,yaw:0,len:L.pole+.15,r:.05,seed:77,sink:0,branches:0});
 stake.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.PI/2+.04)).applyMatrix4(trs(L.x,ly+L.stump+L.pole/2-.07,L.z,L.yaw));
 wood.push({x:L.x,z:L.z,geo:stake});
 const logs=cells('frostlight-field-wood',wood,barkMaterial(opts.ground));group.add(logs);
 // Its flame and the warm light round it: the one warm point in the western field.
 const lly=ly+L.stump+L.pole-1.42*L.s-.05,lc=lanternFlameAt(L.x,lly,L.z,L.yaw,L.s);noteLantern(group,trs(L.x,lly,L.z,L.yaw,L.s),lc);
 const fire=frostFire('frostlight-field-lantern',[{x:lc.x,y:lc.y-.12,z:lc.z,size:.3,cold:false}],[{x:lc.x,y:lc.y,z:lc.z,size:2.6,color:'#ffb257',power:.7},{x:lc.x,y:ly+.3,z:lc.z,size:6,color:'#ff9440',power:.22}],7171,4);
 group.add(fire.group);

 // Ponds: both sheets in one draw, after the decals so no track shows through the ice.
 const pond=pondIce(opts.sky);
 const ponds=new THREE.Mesh(mergeGeometries(SNOW_PONDS.map(p=>pondGeometry(p,h)),false)!,pond.material);ponds.name='frostlight-field-ponds';ponds.receiveShadow=true;ponds.renderOrder=2;group.add(ponds);

 // Dry grass, willow twigs and the trail's cloth: one draw, no shadow.
 const scrub=snowScrub(snowScrubItems(h),h);group.add(scrub.mesh);

 // Trails and scours.
 const decalMat=decalMaterial(opts.sunDir);
 const trails=new THREE.Mesh(trailGeometry(h),decalMat);trails.name='frostlight-field-trails';trails.renderOrder=1;group.add(trails);
 const scours=new THREE.Mesh(scourGeometry(h),decalMat);scours.name='frostlight-field-scours';scours.renderOrder=1;group.add(scours);

 // Sea ice.
 const slabs=snowShelves().map(s=>{const g=slabGeometry(s);g.applyMatrix4(trs(s.x,SNOW_SEA_ICE+s.lift-s.t*.3,s.z,s.yaw,1,s.pitch,s.roll));return {x:s.x,z:s.z,geo:g};});
 const shelves=cells('frostlight-ice-shelves',slabs,seaIceMaterial());group.add(shelves);

 group.userData.fields={pieces:placed,scrub:scrub.count,kitMeshes:kit.children.length,groves:snowGroves().length,boulders:snowBoulders().length,pebbles:snowPebbles().length,logs:snowLogs().length,stumps:snowStumps().length,ponds:SNOW_PONDS.length,tracks:SNOW_TRACKS.length,scours:snowScours(h).length,slabs:slabs.length};
 for(const piece of [...nature.pieces.values(),...props.pieces.values(),...village.pieces.values()])for(const part of piece.parts)part.geometry.dispose();
 let quality:'high'|'low'='high';
 return {
  group,
  setQuality(q){if(q===quality)return;quality=q;for(const f of fineIds)for(const id of f.ids)f.bm.setVisibleAt(id,q==='high');trails.visible=q==='high';scrub.setQuality(q);},
  update(time,x,z){decalMat.uniforms.uFocus.value.set(x,0,z);pond.uniforms.pdTime.value=time;scrub.update(time);fire.update(time);},
 };
}
