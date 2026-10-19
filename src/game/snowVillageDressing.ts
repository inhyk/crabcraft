import * as THREE from 'three';
import {lathe,tube} from '../world/geom';
import {GUARDED_NOISE} from './snowCover';

/*
 * Frostlight's hand-made dressing: snowmen with coal faces, carrot noses, twig arms and knitted scarves, and
 * strings of lights slung across the streets. Snow bodies join the drift mesh (snowMass); everything else is
 * one vertex-coloured trim mesh and one unlit bulb mesh, so the whole lot costs three draw calls.
 */

/** Deterministic 0..1 stream. */
function stream(seed:number){let s=seed>>>0;return()=>(s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296;}

/** Uniform colour for a trim part (the trim material reads vertex colour as albedo). */
function paint(g:THREE.BufferGeometry,c:THREE.Color){
 const n=g.getAttribute('position').count,a=new Float32Array(n*3);
 for(let i=0;i<n;i++)a.set([c.r,c.g,c.b],i*3);
 g.setAttribute('color',new THREE.BufferAttribute(a,3));
 return g;
}
/** Keep only the attributes the merged meshes share. */
function strip(g:THREE.BufferGeometry,keep:string[]){
 for(const k of Object.keys(g.attributes))if(!keep.includes(k))g.deleteAttribute(k);
 return g.index?g:g.setIndex([...Array(g.getAttribute('position').count).keys()]);
}

export interface SnowmanParts {snow:THREE.BufferGeometry[];trim:THREE.BufferGeometry[];hat:THREE.Matrix4}

const COAL=new THREE.Color('#1b1a1c'),CARROT=new THREE.Color('#e0641c'),TWIG=new THREE.Color('#3d2a1d'),WOOL=[new THREE.Color('#a8262a'),new THREE.Color('#1f5f8c'),new THREE.Color('#2f6b3a')];

/**
 * A snowman of three hand-packed balls, each a little out of round and settled into the one below. `yaw`
 * turns the face (local +z). Contact rings between the balls and at the snow are darkened in vertex colour.
 */
export function snowman(x:number,y:number,z:number,yaw:number,s:number,seed:number):SnowmanParts{
 const r=stream(seed),base=new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw),new THREE.Vector3(s,s,s));
 const balls:{c:THREE.Vector3;r:number}[]=[];
 let top=-.1;
 for(const [rad,sink] of [[.52,.0],[.38,.14],[.27,.08]] as const){const rr=rad*(.94+r()*.1);balls.push({c:new THREE.Vector3((r()-.5)*.05,top+rr-sink,(r()-.5)*.05),r:rr});top=balls[balls.length-1].c.y+rr;}
 const snow:THREE.BufferGeometry[]=[],trim:THREE.BufferGeometry[]=[];
 const v=new THREE.Vector3(),k=[r()*9,r()*9,r()*9];
 balls.forEach((b,bi)=>{
  const g=new THREE.SphereGeometry(b.r,30,22),p=g.getAttribute('position'),occ=new Float32Array(p.count*3);
  for(let i=0;i<p.count;i++){
   v.fromBufferAttribute(p,i).normalize();
   // Lumps from packing, a flattened seat where it rests, a slight lean.
   const lump=1+.045*Math.sin(v.x*4.1+k[0]+bi)*Math.sin(v.y*3.7+k[1])+.03*Math.sin(v.z*6.3+v.x*2.2+k[2]);
   const q=v.clone().multiplyScalar(b.r*lump);
   if(q.y<-b.r*.72)q.y=-b.r*.72+(q.y+b.r*.72)*.25;
   q.add(b.c);p.setXYZ(i,q.x,q.y,q.z);
   // Shade where another ball or the ground is close.
   let o=1;
   for(const other of balls)if(other!==b){const d=q.distanceTo(other.c)-other.r;o=Math.min(o,.62+.38*THREE.MathUtils.smoothstep(d,0,.16));}
   o=Math.min(o,.7+.3*THREE.MathUtils.smoothstep(q.y,-.1,.12));
   occ.set([o,o,o],i*3);
  }
  g.setAttribute('color',new THREE.BufferAttribute(occ,3));g.computeVertexNormals();
  snow.push(strip(g,['position','normal','color']).applyMatrix4(base));
 });
 const [body,mid,head]=balls;
 const onBall=(b:{c:THREE.Vector3;r:number},az:number,el:number,out=0)=>new THREE.Vector3(Math.sin(az)*Math.cos(el),Math.sin(el),Math.cos(az)*Math.cos(el)).multiplyScalar(b.r+out).add(b.c);
 const lump=(rad:number,at:THREE.Vector3)=>{const g=new THREE.IcosahedronGeometry(rad,1),p=g.getAttribute('position');for(let i=0;i<p.count;i++)p.setXYZ(i,p.getX(i)*(.85+r()*.3),p.getY(i)*(.85+r()*.3),p.getZ(i)*(.7+r()*.2));g.computeVertexNormals();return paint(strip(g,["position","normal"]),COAL).translate(at.x,at.y,at.z);};
 // Coal eyes, a crooked smile, buttons down the front.
 for(const az of [-.32,.32])trim.push(lump(.034,onBall(head,az+(r()-.5)*.05,.22+(r()-.5)*.04,-.008)));
 for(let i=0;i<5;i++){const t=(i-2)/2;trim.push(lump(.022,onBall(head,t*.42,-.2-.09*(1-t*t)+(r()-.5)*.02,-.006)));}
 for(let i=0;i<3;i++)trim.push(lump(.04,onBall(i<2?mid:body,(r()-.5)*.08,i===0?.32:i===1?-.12:.45,-.01)));
 // A carrot nose, ringed and a touch off true.
 const nose=lathe([[.046,0],[.044,.03],[.037,.09],[.03,.13],[.024,.17],[.014,.22],[.004,.27],[0,.28]],10).rotateX(Math.PI/2).rotateY((r()-.5)*.25).rotateX(.12);
 const np=onBall(head,0,.02,-.03);trim.push(paint(strip(nose,['position','normal']),CARROT).translate(np.x,np.y,np.z));
 // Twig arms out of the middle ball, each with a forked hand.
 for(const side of [-1,1]){
  const root=onBall(mid,side*1.45,.18,-.05),dir=new THREE.Vector3(side*.95,.35+r()*.35,(r()-.5)*.4).normalize(),len=.62+r()*.12;
  const path=[0,.3,.6,1].map(t=>root.clone().addScaledVector(dir,t*len).add(new THREE.Vector3(0,Math.sin(t*3)*.04,(r()-.5)*.03)));
  trim.push(paint(strip(tube(path,t=>.026-.014*t,6),['position','normal']),TWIG));
  const tip=path[3];
  for(const [a,l] of [[.7,.17],[-.6,.14],[0.1,.12]] as const){const d=dir.clone().applyAxisAngle(new THREE.Vector3(0,0,1),side*a).applyAxisAngle(new THREE.Vector3(0,1,0),(r()-.5)*.6);const from=path[2].clone().lerp(tip,.4+.6*Math.abs(a)/.7);trim.push(paint(strip(tube([from,from.clone().addScaledVector(d,l)],t=>.012-.007*t,5),['position','normal']),TWIG));}
 }
 // A knitted scarf at the neck with one tail down the front.
 const wool=WOOL[seed%WOOL.length],nk=new THREE.Vector3(0,mid.c.y+mid.r-.06,0),ring:THREE.Vector3[]=[];
 for(let i=0;i<=24;i++){const a=i/24*Math.PI*2;ring.push(new THREE.Vector3(Math.sin(a)*(head.r*.98),nk.y+.02*Math.sin(a*3),Math.cos(a)*(head.r*.98)));}
 trim.push(paint(strip(tube(ring,()=>.055,8,{squash:()=>1.6}),['position','normal']),wool));
 const tail=[new THREE.Vector3(.1,nk.y,head.r*.9),new THREE.Vector3(.16,nk.y-.12,mid.r*.88+mid.c.z),new THREE.Vector3(.2,nk.y-.3,mid.r*.84),new THREE.Vector3(.23,nk.y-.42,mid.r*.72)];
 trim.push(paint(strip(tube(tail,t=>.05-.012*t,6,{squash:()=>2.2,up:new THREE.Vector3(0,0,1)}),['position','normal']),wool));
 for(const g of trim)g.applyMatrix4(base);
 // A wooden bucket for a hat, tipped back.
 // The kit bucket stands on its base (0.44 m wide, 0.29 m tall); flipped, its rim sits on the crown.
 const hs=head.r*3.3;
 const hat=base.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(0,head.c.y+head.r*.72+.29*hs,-.04),new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI-.24,r()*6,0)),new THREE.Vector3(hs,hs,hs)));
 return {snow,trim,hat};
}

export interface GarlandParts {cable:THREE.BufferGeometry;bulbs:THREE.BufferGeometry;lights:{pos:THREE.Vector3;color:THREE.Color}[]}

const BULBS=[new THREE.Color(3.2,1.7,.55),new THREE.Color(3.4,2.4,1.2),new THREE.Color(3.0,1.2,.45),new THREE.Color(3.2,.6,.45),new THREE.Color(.7,2.2,1.0)];

/** A cable hung from `a` to `b` (a catenary sagging `sag` metres) with a bulb on a short drop every 0.5 m. */
export function garland(a:THREE.Vector3,b:THREE.Vector3,sag:number,seed:number):GarlandParts{
 const r=stream(seed),n=Math.max(8,Math.ceil(a.distanceTo(b)/.25)),path:THREE.Vector3[]=[];
 // cosh-shaped sag normalised to `sag` at mid-span.
 const c=2.2,mid=Math.cosh(c);
 for(let i=0;i<=n;i++){const t=i/n,p=a.clone().lerp(b,t);p.y-=sag*(mid-Math.cosh(c*(2*t-1)))/(mid-1);path.push(p);}
 const cable=paint(strip(tube(path,()=>.016,5),['position','normal']),new THREE.Color('#2a2622'));
 const bulbs:THREE.BufferGeometry[]=[],lights:GarlandParts['lights']=[];
 const len=path.reduce((s,p,i)=>i?s+p.distanceTo(path[i-1]):0,0),step=.5;
 for(let d=step*.5+r()*.1,i=0;d<len-.2;d+=step,i++){
  let acc=0,j=1;while(j<path.length-1&&acc+path[j].distanceTo(path[j-1])<d){acc+=path[j].distanceTo(path[j-1]);j++;}
  const p=path[j-1].clone().lerp(path[j],(d-acc)/path[j].distanceTo(path[j-1]));
  const col=BULBS[(i*7+Math.floor(r()*3))%BULBS.length],drop=.07+r()*.03;
  const g=new THREE.SphereGeometry(.05,8,6).scale(1,1.35,1).translate(p.x,p.y-drop-.05,p.z);
  bulbs.push(paint(strip(g,['position']),col));
  lights.push({pos:new THREE.Vector3(p.x,p.y-drop-.05,p.z),color:col});
 }
 return {cable,bulbs:mergeBulbs(bulbs),lights};
}
/** Glowing embers heaped under a pot: unlit, merged with the bulbs. */
export function embers(x:number,y:number,z:number,seed:number){
 const r=stream(seed),list:THREE.BufferGeometry[]=[];
 for(let i=0;i<14;i++){const a=r()*6.283,d=Math.sqrt(r())*.3,k=.6+r()*.9;list.push(paint(strip(new THREE.IcosahedronGeometry(.045+r()*.04,0),['position']),new THREE.Color(2.6*k,.75*k,.18*k)).translate(x+Math.sin(a)*d,y+r()*.06,z+Math.cos(a)*d));}
 return mergeBulbs(list);
}
/** Position and colour only: the bulbs are unlit. */
export function mergeBulbs(list:THREE.BufferGeometry[]){
 const pos:number[]=[],col:number[]=[],idx:number[]=[];
 for(const g of list){const o=pos.length/3,p=g.getAttribute('position'),c=g.getAttribute('color');for(let i=0;i<p.count;i++){pos.push(p.getX(i),p.getY(i),p.getZ(i));col.push(c.getX(i),c.getY(i),c.getZ(i));}for(const i of g.index!.array)idx.push(i+o);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));g.setIndex(idx);
 return g;
}

/**
 * The fountain's frozen pond: dark clear ice in the middle, cracked in plates, rimed white towards the stone and
 * dusted with blown snow. `radius` is the pond's, in its own xz plane.
 */
export function frozenPond(radius:number){
 const m=new THREE.MeshStandardMaterial({name:'frostlight-pond',color:'#ffffff',roughness:.12,metalness:.05});
 m.onBeforeCompile=shader=>{
  shader.uniforms.uPondR={value:radius};
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vPond;').replace('#include <begin_vertex>','#include <begin_vertex>\nvPond = position.xz;');
  shader.fragmentShader=shader.fragmentShader
   .replace('#include <common>',`#include <common>\nvarying vec2 vPond;\nuniform float uPondR;\n${GUARDED_NOISE}\nfloat pondSnow;`)
   .replace('#include <color_fragment>',`#include <color_fragment>
    {
     float r = length(vPond) / uPondR;
     // Plates: distance to the nearest and second-nearest jittered seed; a crack where they tie.
     vec2 q = vPond * 1.7, iq = floor(q);
     float f1 = 9.0, f2 = 9.0;
     for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 c = iq + vec2(float(i), float(j)), o = c + cc_hash22(c) * 0.85;
      float d = length(q - o);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
     }
     float crack = 1.0 - smoothstep(0.015, 0.06, f2 - f1);
     float depth = cc_fbm(vPond * 0.9 + 3.0);
     vec3 ice = mix(vec3(0.16, 0.36, 0.48), vec3(0.42, 0.66, 0.78), depth * 0.8 + r * 0.35);
     ice = mix(ice, vec3(0.86, 0.94, 1.0), crack * 0.75);
     // Rime grows in from the basin wall; blown snow lies in streaks.
     float rime = smoothstep(0.7, 0.98, r + (cc_fbm(vPond * 3.1) - 0.5) * 0.3);
     pondSnow = max(rime, smoothstep(0.58, 0.72, cc_fbm(vPond * vec2(0.9, 2.2) + 11.0)) * 0.9);
     diffuseColor.rgb = mix(ice, vec3(0.93, 0.96, 1.0), pondSnow);
    }`)
   .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.85, pondSnow);');
 };
 m.customProgramCacheKey=()=>'frostlight-pond';
 return m;
}
