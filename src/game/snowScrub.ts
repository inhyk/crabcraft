import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {SNOW_WIND} from '../sim/world/snowGround';
import {addPatch} from '../world/materials';

/*
 * What grows through Frostlight's snow and what the miners left on their trail, built as geometry, one draw for
 * all of it: tufts of dry grass bleached to straw with rime on the tips, dwarf willow and dogwood twigs, red-brown,
 * frosted where the wind left the rime, half buried, and strips of faded cloth tied to the trail's posts. Vertex
 * colour carries the look; aScrub (along 0..1 from the root, kind, seed) drives the sway, the flutter and the frost.
 */

type Height=(x:number,z:number)=>number;
type V=THREE.Vector3;
const V3=(x:number,y:number,z:number)=>new THREE.Vector3(x,y,z);
const UP=V3(0,1,0);
/** The prevailing wind on the ground plane, as a world direction. */
const WIND=V3(SNOW_WIND[0],0,SNOW_WIND[1]).normalize();

export type ScrubKind='grass'|'twig'|'cloth';
export interface ScrubItem {kind:ScrubKind;x:number;z:number;yaw:number;s:number;seed:number;
 /** Cloth only: the knot's height above the ground, and the post it is tied round. */
 knot?:number;post?:number;
 /** Cloth only: 0 faded red, 1 ochre. */
 dye?:number;
 /** Dropped on low quality. */
 fine?:boolean}

function stream(seed:number){let s=seed>>>0;return()=>(s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296;}

/** Collects triangles with position, normal, colour and aScrub. */
class Builder {
 pos:number[]=[];nrm:number[]=[];col:number[]=[];att:number[]=[];idx:number[]=[];
 vert(p:V,n:V,c:readonly number[],along:number,kind:number,seed:number){this.pos.push(p.x,p.y,p.z);this.nrm.push(n.x,n.y,n.z);this.col.push(c[0],c[1],c[2]);this.att.push(along,kind,seed);return this.pos.length/3-1;}
 geometry(){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(this.pos,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(this.nrm,3));g.setAttribute('color',new THREE.Float32BufferAttribute(this.col,3));g.setAttribute('aScrub',new THREE.Float32BufferAttribute(this.att,3));g.setIndex(this.idx);return g;}
}
const mix3=(a:readonly number[],b:readonly number[],t:number)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
const RIME=[.78,.84,.92];

/** A tuft of dry grass: blades fanning out from a buried crown, bowed, a few snapped, rime on the tips. */
function grass(b:Builder,o:V,s:number,seed:number,y0:number){
 const R=stream(seed*7907+3),n=12+Math.floor(R()*12*s);
 // Straw, with now and then a rust blade; the crown is dark with damp.
 const straw=[.42,.29,.12],pale=[.6,.5,.32],rust=[.32,.13,.05],root=[.1,.07,.04];
 for(let i=0;i<n;i++){
  const a=R()*Math.PI*2,out=V3(Math.cos(a),0,Math.sin(a)),side=V3(-out.z,0,out.x);
  const H=(.22+R()*.38)*s*(1-.35*R()),lean=.12+R()*.55,droop=R()*.5,w0=.012+R()*.012;
  const base=o.clone().addScaledVector(out,R()*.07*s).setY(y0-.08);
  const tip=R()<.2?rust:mix3(straw,pale,R()),frost=R()<.6,steps=4,first=b.pos.length/3;
  for(let k=0;k<=steps;k++){
   const t=k/steps,bend=lean*t+droop*t*t;
   const p=base.clone().addScaledVector(UP,H*t*Math.cos(bend)+.08).addScaledVector(out,H*t*Math.sin(bend));
   const w=w0*(1-t*.82),n0=out.clone().multiplyScalar(.35).add(UP).normalize();
   let c=t<.25?mix3(root,tip,t/.25):tip;if(frost&&t>.7)c=mix3(c,RIME,(t-.7)/.3*.8);
   b.vert(p.clone().addScaledVector(side,-w),n0,c,t,0,seed+i*.37);b.vert(p.clone().addScaledVector(side,w),n0,c,t,0,seed+i*.37);
  }
  for(let k=0;k<steps;k++){const a0=first+k*2;b.idx.push(a0,a0+1,a0+2,a0+1,a0+3,a0+2);}
 }
}

/** A tapered tube along a path, `sides`-sided, its colour from root to tip and the rime on top near the tips. */
function tube(b:Builder,path:V[],r0:number,r1:number,c0:readonly number[],c1:readonly number[],along0:number,along1:number,seed:number,frost:number,sides=5){
 const first=b.pos.length/3;
 for(let k=0;k<path.length;k++){
  const t=k/(path.length-1),d=(k<path.length-1?path[k+1].clone().sub(path[k]):path[k].clone().sub(path[k-1])).normalize();
  const u=Math.abs(d.y)<.95?UP.clone().cross(d).normalize():V3(1,0,0),v=d.clone().cross(u);
  const r=r0+(r1-r0)*t,al=along0+(along1-along0)*t;
  for(let j=0;j<sides;j++){
   const a=j/sides*Math.PI*2,n=u.clone().multiplyScalar(Math.cos(a)).addScaledVector(v,Math.sin(a));
   let c=mix3(c0,c1,t);const top=Math.max(0,n.y);if(frost>0)c=mix3(c,RIME,Math.min(1,top*frost*al*1.4));
   b.vert(path[k].clone().addScaledVector(n,r),n,c,al,1,seed);
  }
 }
 for(let k=0;k<path.length-1;k++)for(let j=0;j<sides;j++){const a=first+k*sides+j,bb=first+k*sides+(j+1)%sides,c=a+sides,d=bb+sides;b.idx.push(a,c,bb,bb,c,d);}
}

/** Dwarf willow or dogwood: many fine stems from a buried crown, each bending and forking down to thin twigs,
 * rime on the tips. Red-barked dogwood or olive-brown willow. */
function twigs(b:Builder,o:V,s:number,seed:number,y0:number){
 const R=stream(seed*6263+5),red=R()<.45;
 const bark=red?[.045,.014,.011]:[.04,.028,.016],tipC=red?[.13,.03,.022]:[.1,.062,.03];
 const branch=(start:V,dir:V,len:number,r:number,depth:number,al0:number)=>{
  const segs=4,path=[start.clone()],d=dir.clone();let p=start.clone();
  for(let k=0;k<segs;k++){d.add(V3((R()-.5)*.5,.06,(R()-.5)*.5)).normalize();p=p.clone().addScaledVector(d,len/segs);path.push(p);}
  const al1=Math.min(1,al0+len/(1.1*s));
  tube(b,path,r,r*.3,mix3(bark,tipC,al0),mix3(bark,tipC,al1),al0,al1,seed,depth>=1?1.4:.6,depth?3:4);
  if(depth<2)for(let k=1;k<segs;k++){if(R()>.6)continue;const nd=d.clone().add(V3((R()-.5)*1.6,.35,(R()-.5)*1.6)).normalize();branch(path[k],nd,len*(.38+R()*.2)*(1-k/segs*.4),r*.5,depth+1,al0+(al1-al0)*k/segs);}
 };
 const n=7+Math.floor(R()*6);
 for(let i=0;i<n;i++){
  const a=R()*Math.PI*2,lean=.2+R()*.55,dir=V3(Math.cos(a)*Math.sin(lean),Math.cos(lean),Math.sin(a)*Math.sin(lean));
  branch(o.clone().add(V3(Math.cos(a)*.07*s,0,Math.sin(a)*.07*s)).setY(y0-.12),dir,(.35+R()*.45)*s,.005*s+.003,0,0);
 }
}

/** A strip of cloth knotted round a post: two tails hanging off the post's outer face, lifted downwind, frayed. */
function cloth(b:Builder,o:V,knot:number,post:number,dye:number,seed:number,yaw:number){
 const R=stream(seed*4561+9);
 const c=dye?[.36,.22,.045]:[.33,.045,.03],fade=dye?[.48,.36,.16]:[.42,.15,.1];
 // The knot: a band round the post.
 const sides=7,first=b.pos.length/3;
 for(let j=0;j<=sides;j++){
  const a=j/sides*Math.PI*2,n=V3(Math.cos(a),0,Math.sin(a)),p=V3(o.x,knot,o.z).addScaledVector(n,post+.012);
  b.vert(p.clone().setY(knot+.04),n,c,0,2,seed);b.vert(p.clone().setY(knot-.04),n,c,0,2,seed);
 }
 for(let j=0;j<sides;j++){const a=first+j*2;b.idx.push(a,a+2,a+1,a+1,a+2,a+3);}
 // Off the fence's face (its local z), so the tails hang clear of the rails.
 const face=V3(Math.sin(yaw),0,Math.cos(yaw)).multiplyScalar(R()<.5?1:-1),along=face.clone().cross(UP).normalize();
 const lee=WIND.clone().addScaledVector(face,-WIND.dot(face)).multiplyScalar(.6).addScaledVector(face,.35);
 for(let tail=0;tail<2;tail++){
  const L=(tail?.5:.74)+R()*.15,w=.042+R()*.012,steps=8,f0=b.pos.length/3;
  const start=V3(o.x,knot-.02,o.z).addScaledVector(face,post+.02).addScaledVector(along,(tail-.5)*.05);
  for(let k=0;k<=steps;k++){
   const t=k/steps,p=start.clone().addScaledVector(UP,-L*t*.85).addScaledVector(lee,L*t*t*.7).addScaledVector(along,Math.sin(t*3+seed)*.025);
   const fray=t>.85?1-(t-.85)/.15*.55:1,cc=mix3(c,fade,t*.6);
   b.vert(p.clone().addScaledVector(along,w*fray),face,cc,t,2,seed+tail);b.vert(p.clone().addScaledVector(along,-w*fray),face,cc,t,2,seed+tail);
  }
  for(let k=0;k<steps;k++){const a=f0+k*2;b.idx.push(a,a+1,a+2,a+1,a+3,a+2);}
 }
}

const SCRUB_VERT=/* glsl */`
attribute vec3 aScrub;
uniform float uScrubTime;
uniform vec3 uScrubWind;
`;
/** Vertex-coloured, two-sided, swaying in the wind; cloth flutters. One program for all three kinds. */
function scrubMaterial(){
 const m=new THREE.MeshStandardMaterial({name:'frostlight-field-scrub',color:'#ffffff',roughness:.86,metalness:0,vertexColors:true,side:THREE.DoubleSide});
 const uniforms={uScrubTime:{value:0},uScrubWind:{value:WIND.clone()}};
 addPatch(m,'frostlight-field-scrub',shader=>{
  Object.assign(shader.uniforms,uniforms);
  shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>\n${SCRUB_VERT}`)
   .replace('#include <begin_vertex>',`#include <begin_vertex>
    {
     float t=aScrub.x,kind=aScrub.y,sd=aScrub.z,T=uScrubTime;
     vec3 side=vec3(-uScrubWind.z,0.,uScrubWind.x);
     if(kind>1.5){
      // Cloth: streams and snaps in the gusts, more towards the free end.
      float g=.6+.4*sin(T*1.3+sd*3.);
      transformed+=(uScrubWind*(.03+.04*sin(T*7.+sd*5.-t*6.))*g+side*sin(T*9.3+sd*2.-t*8.)*.035*g+vec3(0.,sin(T*11.+sd-t*9.)*.03,0.))*t*t;
     }else{
      // Grass and twigs bend with the wind and spring back, each on its own phase.
      float g=sin(T*1.7+sd*4.+position.x*.35)*.6+sin(T*3.1+sd*7.)*.25;
      transformed+=(uScrubWind*(.5+g)*.05+side*sin(T*2.3+sd*3.)*.02)*t*t*(kind>.5?.6:1.);
     }
    }`);
  // Two-sided, but lit by the normal as built: the back of a blade is not the dark side of the moon.
  shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_begin>','#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
 });
 return {material:m,uniforms};
}

export interface SnowScrub {mesh:THREE.Mesh;setQuality(q:'high'|'low'):void;update(time:number):void;count:Record<ScrubKind,number>}
/** Build every item into one mesh; items marked fine come last, so low quality draws a prefix. */
export function snowScrub(items:readonly ScrubItem[],h:Height):SnowScrub{
 const order=[...items].sort((a,b)=>Number(!!a.fine)-Number(!!b.fine));
 const parts:THREE.BufferGeometry[]=[];let coarse=0;
 const count:Record<ScrubKind,number>={grass:0,twig:0,cloth:0};
 for(const it of order){
  const b=new Builder(),o=V3(it.x,0,it.z),y0=h(it.x,it.z);
  if(it.kind==='grass')grass(b,o,it.s,it.seed,y0);
  else if(it.kind==='twig')twigs(b,o,it.s,it.seed,y0);
  else cloth(b,o,y0+(it.knot??.75),it.post??.07,it.dye??0,it.seed,it.yaw);
  count[it.kind]++;
  const g=b.geometry();parts.push(g);if(!it.fine)coarse+=g.index!.count;
 }
 const {material,uniforms}=scrubMaterial();
 const geo=mergeGeometries(parts,false)!;for(const p of parts)p.dispose();
 const mesh=new THREE.Mesh(geo,material);mesh.name='frostlight-field-scrub';mesh.castShadow=false;mesh.receiveShadow=true;mesh.matrixAutoUpdate=false;
 // Sway can carry a tip a few centimetres past the rest pose.
 geo.computeBoundingSphere();geo.boundingSphere!.radius+=.3;
 const all=geo.index!.count;
 return {mesh,count,setQuality(q){geo.setDrawRange(0,q==='high'?all:coarse);},update(time){uniforms.uScrubTime.value=time;}};
}
