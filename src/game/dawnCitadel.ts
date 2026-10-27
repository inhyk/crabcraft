import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {loadKit,StaticBatch,trs} from '../world/kit';
import {addPatch,stylise} from '../world/materials';
import {lathe} from '../world/geom';
import {FROST_NOISE} from './frostPaving';
import {planeWarp,ringWarp,type V3,type Warp} from './frostMasonry';
import {Glass,windowAt} from './frostThrone';
import {frostFire,type Flame,type Halo} from './frostFire';
import {DawnMason,dawnMasonryMaterial} from './dawnMasonry';
import {dawnArena} from './dawnArena';
import {CITADEL_APPROACH,CITADEL_ARENA,CITADEL_BRAZIERS,CITADEL_GATE,CITADEL_KEEP,CITADEL_TOWERS,CITADEL_WALL,SOUTH_RUN,citadelObelisks,type CitadelTower} from './dawnCitadelLayout';

/*
 * Solarkan's Twilight Citadel: the old sun temple-fortress on Dawnharbor's north plateau, taken in the stolen dawn.
 * Banded masonry (dawnMasonry.ts: black basalt coursed with honey limestone, gilded string courses), laid block by
 * block: a gatehouse astride the avenue with an ablaq pointed arch, its raised bronze portcullis and the eclipsed sun
 * over it; battered round towers with machicolated parapets, gilded scale spires crowned with sun discs, or open
 * fire platforms; curtain walls round a paved temple court; the keep at the north end of the court with the great
 * eclipse on its face and the tallest spire on the island, the landmark from the harbour. Round the sun-dial floor
 * (dawnArena.ts) stand eight basalt sun pillars carrying fire bowls; obelisks with gilded pyramidions line the
 * ascent. Solarkan's banners (the props kit, dyed) hang from the gate, the towers and the keep.
 */

type Height=(x:number,z:number)=>number;
export interface DawnCitadel {
 root:THREE.Group;
 /** The sun-dial material for the boss platform (`dawn-boss-platform`). */
 floor:THREE.Material;
 update(time:number,quality:'high'|'low'):void;
 /** Solarkan's banners from the props kit (CC0, see NOTICE.md); call from buildSettlement(). */
 dress():Promise<void>;
}

function stream(seed:number){let s=seed>>>0;return()=>(s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296;}
const clamp01=(v:number)=>Math.min(1,Math.max(0,v));
const EMBER:V3=[2.6,1.05,.3];

/** A three.js geometry recast for the masonry mesh: one tint, gilt or not, no uvs. */
function asStone(g:THREE.BufferGeometry,tint:V3,gilt:boolean|number,ground:number):THREE.BufferGeometry{
 const n=g.getAttribute('position').count;
 const out=new THREE.BufferGeometry();
 out.setAttribute('position',g.getAttribute('position').clone());
 if(!g.getAttribute('normal'))g.computeVertexNormals();
 out.setAttribute('normal',g.getAttribute('normal').clone());
 const col=new Float32Array(n*3);for(let i=0;i<n;i++)col.set(tint,i*3);
 out.setAttribute('color',new THREE.BufferAttribute(col,3));
 out.setAttribute('aGround',new THREE.BufferAttribute(new Float32Array(n).fill(ground),1));
 out.setAttribute('aSnow',new THREE.BufferAttribute(new Float32Array(n).fill(typeof gilt==='number'?gilt:gilt?1:0),1));
 out.setAttribute('aCourse',new THREE.BufferAttribute(new Float32Array(n),1));
 if(g.getIndex())out.setIndex(g.getIndex()!.clone());
 else{const idx=new Uint32Array(n);for(let i=0;i<n;i++)idx[i]=i;out.setIndex(new THREE.BufferAttribute(idx,1));}
 return out;
}

/** Gilded copper scales for the spires: a canvas of overlapping scales, worn darker in patches by the shader. */
function scaleMaterial():THREE.MeshStandardMaterial{
 const S=128,c=document.createElement('canvas');c.width=c.height=S;const x=c.getContext('2d')!;
 const b=document.createElement('canvas');b.width=b.height=S;const y=b.getContext('2d')!;
 x.fillStyle='#6b4a1f';x.fillRect(0,0,S,S);y.fillStyle='#000';y.fillRect(0,0,S,S);
 let s=7;const r=()=>(s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296;
 // Rows of round-bottomed scales, each overlapping the row below (drawn top row first, so lower rows sit over).
 const rows=4,cols=4,w=S/cols,h=S/rows;
 for(let j=-1;j<=rows;j++)for(let i=-1;i<=cols;i++){
  const cx=(i+(j%2?.5:0))*w+w/2,cy=j*h;
  const v=.78+r()*.3,g=x.createRadialGradient(cx,cy+h*.2,1,cx,cy+h*.4,w*.62);
  g.addColorStop(0,`rgb(${255*v|0},${205*v|0},${110*v|0})`);g.addColorStop(.8,`rgb(${228*v|0},${160*v|0},${64*v|0})`);g.addColorStop(1,'#5a3b14');
  x.fillStyle=g;x.beginPath();x.moveTo(cx-w/2,cy);x.lineTo(cx-w/2,cy+h*.45);x.arc(cx,cy+h*.45,w/2,Math.PI,0,true);x.lineTo(cx+w/2,cy);x.closePath();x.fill();
  const bg=y.createRadialGradient(cx,cy+h*.1,1,cx,cy+h*.45,w*.55);bg.addColorStop(0,'#fff');bg.addColorStop(.85,'#aaa');bg.addColorStop(1,'#000');
  y.fillStyle=bg;y.beginPath();y.moveTo(cx-w/2,cy);y.lineTo(cx-w/2,cy+h*.45);y.arc(cx,cy+h*.45,w/2,Math.PI,0,true);y.lineTo(cx+w/2,cy);y.closePath();y.fill();
 }
 const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;map.wrapS=map.wrapT=THREE.RepeatWrapping;map.anisotropy=4;
 const bump=new THREE.CanvasTexture(b);bump.wrapS=bump.wrapT=THREE.RepeatWrapping;
 const m=new THREE.MeshStandardMaterial({name:'dawn-citadel-spire-scales',map,bumpMap:bump,bumpScale:2.2,metalness:.82,roughness:.36,envMapIntensity:.7,color:'#ffe2b0'});
 m.onBeforeCompile=sh=>{
  sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vSpW;').replace('#include <fog_vertex>','#include <fog_vertex>\nvSpW=(modelMatrix*vec4(transformed,1.)).xyz;');
  sh.fragmentShader=sh.fragmentShader.replace('#include <common>',`#include <common>\n${FROST_NOISE}\nvarying vec3 vSpW;\nfloat spWorn;`)
   .replace('#include <map_fragment>','#include <map_fragment>\nspWorn=smoothstep(.3,.8,fpNoise(vSpW.xz*.5+vSpW.y*.21)*.5+.5+fpNoise(vec2(vSpW.x+vSpW.z,vSpW.y)*1.7)*.2);\n// Soot and age streak the gold down the cone; the tarnish is bronze-dark, not grey.\ndiffuseColor.rgb*=mix(vec3(1.),vec3(.42,.3,.2),spWorn*.75);')
   .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(.32,.6,spWorn);')
   .replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance+=diffuseColor.rgb*vec3(.09,.06,.03)*(1.-spWorn);');
 };
 m.customProgramCacheKey=()=>'dawn-citadel-spire-scales';
 return m;
}

export function dawnCitadel(height:Height):DawnCitadel {
 const h=height,root=new THREE.Group();root.name='dawn-twilight-citadel';
 const rand=stream(30117),M=new DawnMason(rand,3),glass=new Glass();
 // The far mason lays the same citadel as plain slabs, its joints and bands drawn in the shader, past ~110 m.
 const F=new DawnMason(stream(30118),4);F.course=1;M.far=F;
 const flames:Flame[]=[],halos:Halo[]=[],extra:THREE.BufferGeometry[]=[],roofs:THREE.BufferGeometry[]=[];
 const banners:{x:number;y:number;z:number;yaw:number;s:number}[]=[];
 const G=CITADEL_GATE,W=CITADEL_WALL,K=CITADEL_KEEP,A=CITADEL_ARENA;
 const groundMin=(x0:number,z0:number,x1:number,z1:number)=>{let m=Infinity;for(let i=0;i<=8;i++){const k=i/8;m=Math.min(m,h(x0+(x1-x0)*k,z0+(z1-z0)*k));}return m;};
 /** A straight face from a to b; outward is to the right of travel seen from above (planeWarp). */
 const wallFace=(ax:number,az:number,bx:number,bz:number,v0:number,v1:number,o:Parameters<DawnMason['face']>[5]={})=>{
  const L=Math.hypot(bx-ax,bz-az),w=planeWarp(ax,az,(bx-ax)/L,(bz-az)/L);M.face(w,0,L,v0,v1,{len:2.1,course:1.05,depth:.6,...o});return {w,L};
 };
 const front=(zf:number)=>planeWarp(0,zf,-1,0);
 const box=(x0:number,x1:number,y0:number,y1:number,zf:number,d:number,bevel=.07,tint?:V3)=>M.block(front(zf),-x1,y0,0,x1-x0,y1-y0,d,{bevel,tint,closed:true,far:true});
 /** A gilded piece from a three.js geometry. */
 const gild=(g:THREE.BufferGeometry,ground=0)=>extra.push(asStone(g,[1,1,1],true,ground));
 const basalt=(g:THREE.BufferGeometry,k=.5)=>extra.push(asStone(g,[.03*k*2,.028*k*2,.027*k*2],false,-99));

 /** Machicolated parapet along a face: corbels, the projecting walk, merlons with pale caps, a gilt string below. */
 const parapet=(w:Warp,u0:number,u1:number,v:number,o:{out?:number;merlon?:number;corbels?:boolean}={})=>{
  const out=o.out??.55;
  M.gilt=true;for(let u=u0;u<u1-.05;){const ww=Math.min(2.2,u1-u);M.block(w,u,v-1.02,-.08,ww,.14,.3,{bevel:.03});u+=ww;}M.gilt=false;
  if(o.corbels!==false){M.stone='pale';for(let u=u0+.3;u<u1-.5;u+=1.2){M.block(w,u,v-.85,-out,.46,.42,out+.4,{bevel:.04});M.block(w,u+.04,v-.43,-out,.38,.43,out+.4,{bevel:.04});}M.stone=null;}
  for(let u=u0-.1;u<u1+.1-.05;){const ww=Math.min(1.7+rand()*.7,u1+.1-u);M.block(w,u+.02,v,-out,ww-.04,.55,out+.5,{bevel:.05,far:true});u+=ww;}
  const mw=o.merlon??1.15;
  for(let u=u0+.2;u+mw<=u1-.1;u+=mw+.8){
   M.stone='basalt';M.block(w,u,v+.55,-out+.05,mw,1.25,.7,{bevel:.06,closed:true,far:true});
   M.stone='pale';M.block(w,u-.06,v+1.8,-out-.01,mw+.12,.22,.82,{bevel:.05,closed:true});M.stone=null;
  }
 };

 /** A round machicolated crown at radius r: pale corbels, the parapet wall over them with a gilt string, merlons, the floor. */
 const crown=(x:number,z:number,r:number,top:number)=>{
  const C=2*Math.PI,ring=ringWarp(x,z,r);
  M.stone='pale';for(let u=.3;u<C*r-.4;u+=1.2){M.block(ring,u,top-1.9,-.66,.46,.44,1.1,{bevel:.04});M.block(ring,u+.04,top-1.46,-.66,.38,.42,1.1,{bevel:.04});}M.stone=null;
  M.face(ringWarp(x,z,r+.66),0,C*(r+.66),top-1.04,top,{len:1.9,course:1.04,depth:.75,curve:.7,core:0});
  M.gilt=true;for(let u=0;u<C*(r+.74)-.05;){const ww=Math.min(1.6,C*(r+.74)-u);M.block(ringWarp(x,z,r+.74),u,top-1.12,0,ww,.12,.12,{bevel:.02,seg:2});u+=ww;}M.gilt=false;
  const mr=r+.66,mC=C*mr;
  for(let u=.1,k=0;u<mC-1.1;u+=1.95,k++){M.stone='basalt';M.block(ringWarp(x,z,mr),u,top,0,1.1,1.25,.7,{bevel:.06,seg:2,closed:true,far:true});M.stone='pale';M.block(ringWarp(x,z,mr+.06),u-.06,top+1.25,0,1.22,.22,.82,{bevel:.05,seg:2,closed:true});M.stone=null;}
  M.disc(x,top-.25,z,r-.05,28);
 };
 /** A battered round tower: flared plinth, banded courses, slits and lancets, machicolations, and its crown. */
 const tower=(t:CitadelTower,faces:number[])=>{
  const {x,z,r,top}=t,g0=h(x,z),C=2*Math.PI;M.ground=groundMin(x-r,z,x+r,z);
  const base=M.ground-1.5,plinth=M.ground+3.2;
  // Batter: the plinth flares a metre out at the foot.
  const batter:Warp=(u,v,tt)=>{const k=clamp01((plinth-v)/(plinth-base)),rr=r+.95*k-tt,a=u/(r+.95);return [x+Math.sin(a)*rr,v,z+Math.cos(a)*rr];};
  M.face(batter,0,C*(r+.95),base,plinth,{len:2.2,course:.9,depth:.8,curve:.7});
  M.stone='pale';M.face(ringWarp(x,z,r+.12),0,C*(r+.12),plinth,plinth+.5,{len:1.6,course:.5,depth:.5,curve:.6,core:0});M.stone=null;
  M.face(ringWarp(x,z,r),0,C*r,plinth+.5,top-1.9,{len:2.1,course:1.05,depth:.6,curve:.75});
  crown(x,z,r,top);
  // Windows: a lancet high on each face asked for, slits below, all lit from within.
  for(const a of faces){const u=a*r;windowAt(M,glass,ringWarp(x,z,r),u,top-8.5,top-6.6,.55,EMBER);windowAt(M,glass,ringWarp(x,z,r),u+(rand()<.5?.7:-.7),top-15,top-13.8,.22,EMBER);}
  if(t.crown==='spire'){
   // Gilded scale spire, a concave cone over a drum, the finial a small sun.
   const H=r*2.9,R=r+.25,yb=top+.35;
   M.face(ringWarp(x,z,r-.15),0,C*(r-.15),top,top+1.35,{len:1.6,course:.68,depth:.4,curve:.6,core:0});
   const prof:[number,number][]=[[R+.28,0],[R+.1,.18],[R,.5],[R*.8,H*.22],[R*.56,H*.45],[R*.32,H*.68],[R*.14,H*.87],[R*.05,H*.97],[.04,H]];
   roofs.push(lathe(prof,28,.9).translate(x,yb+1,z));
   finial(x,yb+1+H,z,.9+r*.08);
  }else{
   // Open fire platform: a great gilt bowl on a pale drum, the fire seen from the town.
   M.stone='pale';M.face(ringWarp(x,z,1.25),0,C*1.25,top,top+1.1,{len:1.3,course:.55,depth:.5,curve:.5,core:0});M.stone=null;M.disc(x,top+1.08,z,1.25,16);
   gild(new THREE.LatheGeometry([[0,0],[.5,.02],[.95,.2],[1.55,.55],[1.85,.88],[1.9,.98],[1.75,1.0],[.5,.7],[0,.7]].map(([a,b])=>new THREE.Vector2(a,b)),24).translate(x,top+1.08,z),g0);
   flames.push({x,y:top+2.2,z,size:3.4,cold:false},{x:x+.7,y:top+1.9,z:z+.4,size:2.2,cold:false},{x:x-.6,y:top+1.9,z:z-.5,size:2.4,cold:false});
   halos.push({x,y:top+3.2,z,size:11,color:'#ff9a3c',power:.5});
  }
  banners.push({x:x+Math.sin(faces[0])*(r+.3),y:top-2.4,z:z+Math.cos(faces[0])*(r+.3),yaw:faces[0],s:1.6});
 };

 /** A sun on a stem: gilt ball, a ring of sixteen rays and a dark moon across its face (the stolen dawn). */
 function finial(x:number,y:number,z:number,s:number){
  gild(new THREE.CylinderGeometry(.05*s,.09*s,1.2*s,8).translate(x,y+.4*s,z));
  gild(new THREE.SphereGeometry(.22*s,14,10).translate(x,y+.55*s,z));
  const cy=y+1.75*s;
  gild(new THREE.TorusGeometry(.62*s,.07*s,8,32).translate(x,cy,z));
  for(let k=0;k<16;k++){const a=k/16*Math.PI*2,len=(k%2?.45:.75)*s;gild(new THREE.ConeGeometry(.08*s,len,4).translate(0,.62*s+len/2,0).rotateZ(-a).translate(x,cy,z));}
  gild(new THREE.CylinderGeometry(.6*s,.6*s,.06*s,24).rotateX(Math.PI/2).translate(x,cy,z));
  // The moon stands proud on both faces, eclipsing three quarters of the disc.
  for(const sz of [-1,1])basalt(new THREE.CylinderGeometry(.5*s,.5*s,.05*s,24).rotateX(Math.PI/2).translate(x+.16*s,cy+.1*s,z+sz*.05*s),.6);
  halos.push({x,y:cy,z,size:3.4*s,color:'#ffb35a',power:.35});
 }

 /** The eclipsed sun as a relief on a south face at zf: gilt disc, sixteen rays (alternately flame-waved), rim and the basalt moon. */
 const emblem=(cx:number,cy:number,zf:number,R:number)=>{
  const rot=(g:THREE.BufferGeometry)=>g.rotateX(Math.PI/2);
  gild(rot(new THREE.CylinderGeometry(R,R,.18,48)).translate(cx,cy,zf+.09));
  gild(new THREE.TorusGeometry(R*1.04,.08*R,8,56).translate(cx,cy,zf+.18));
  for(let k=0;k<16;k++){
   const a=k/16*Math.PI*2,len=(k%2?.42:.7)*R,wide=(k%2?.1:.14)*R,sh=new THREE.Shape();
   // A wavy flame ray or a straight one, as a flat gilt blade.
   if(k%2){sh.moveTo(-wide,0);sh.bezierCurveTo(-wide*.2,len*.3,-wide*1.2,len*.6,0,len);sh.bezierCurveTo(wide*.4,len*.6,wide*1.1,len*.35,wide,0);}
   else{sh.moveTo(-wide,0);sh.lineTo(0,len);sh.lineTo(wide,0);}
   sh.closePath();
   const g=new THREE.ExtrudeGeometry(sh,{depth:.12,bevelEnabled:true,bevelThickness:.03,bevelSize:.025,bevelSegments:1,curveSegments:6});
   gild(g.translate(0,R*1.06,0).rotateZ(-a).translate(cx,cy,zf+.02));
  }
  basalt(rot(new THREE.CylinderGeometry(R*.9,R*.9,.24,48)).translate(cx+R*.26,cy+R*.16,zf+.3),.45);
  // The corona where the moon lets the sun through.
  halos.push({x:cx-R*.55,y:cy-R*.32,z:zf+.9,size:R*3.4,color:'#ffae4a',power:.42},{x:cx,y:cy,z:zf+.6,size:R*5,color:'#ff8a3a',power:.16});
 };

 // ---- Gatehouse.
 {
  const g0=h(0,G.front),b=groundMin(-G.half,G.front,G.half,G.front)-1.2,spring=g0+G.spring,apex=g0+G.apex,top=G.top;
  M.ground=g0;
  const R=(apex-spring)**2/(2*G.open)+G.open/2,xc=G.open-R,margin=1.0;
  const archTop=(x:number)=>{const ax=Math.abs(x);return ax>G.open?-1:spring+Math.sqrt(Math.max(0,R*R-(ax-xc)**2));};
  const opening=(x:number,v:number)=>Math.abs(x)<G.open+margin&&v<archTop(Math.min(Math.abs(x),G.open))+margin;
  for(const zf of [G.front,G.back]){
   const south=zf===G.front;
   const {w}=wallFace(south?G.half:-G.half,zf,south?-G.half:G.half,zf,b,top,{quoins:1.3,skip:(u,v)=>opening(south?G.half-u:u-G.half,v)});
   parapet(w,.2,2*G.half-.2,top,{merlon:1.05});
   // Ablaq voussoirs round the pointed arch, basalt and limestone in turn, a gilt keystone.
   const sgn=south?1:-1,zz=zf+sgn*.12;
   for(const s of [-1,1]){
    const a1=Math.acos(clamp01((R-G.open)/R)),n=7;
    for(let i=0;i<n;i++){
     const aa=a1*i/n,ab=a1*(i+1)/n;
     const vw:Warp=(u,v,t)=>{const a=aa+(ab-aa)*clamp01(u/(R*(ab-aa))),rr=R+v;return [s*(xc+rr*Math.cos(a)),spring+rr*Math.sin(a),zz-sgn*t];};
     M.stone=(i+(s>0?1:0))%2?'pale':'basalt';M.block(vw,.03,0,0,R*(ab-aa)-.06,margin,.9,{bevel:.07,seg:2});M.stone=null;
    }
    for(let v=b+1.2,k=0;v<spring-.05;k++){const hh=Math.min(.9+rand()*.3,spring-v);M.stone=k%2?'pale':'basalt';const x0=s>0?G.open:-G.open-margin;M.block(front(zz),-(x0+margin),v,0,margin,hh-.04,.9,{bevel:.06,closed:true});M.stone=null;v+=hh;}
   }
   M.gilt=true;M.block(front(zz),-.55,apex-.3,south?0:-.9,1.1,1.25,.9,{bevel:.06,closed:true});M.gilt=false;
  }
  // The passage: limestone reveals and a basalt vault, the portcullis raised into it, bronze and gilt.
  for(const s of [-1,1])M.face(planeWarp(s*G.open,s>0?G.front:G.back,0,s>0?-1:1),0,G.front-G.back,b,apex,{len:1.6,course:.9,depth:.4});
  M.slab(front(G.front),-G.half,top-.6,0,2*G.half,.6,G.front-G.back,M.tint(.8),1,4);
  M.slab((u,v,t)=>[-G.open+u,v,G.back+t],0,apex-.1,0,2*G.open,.4,G.front-G.back,M.tint(.6),1,8);
  for(let i=0;i<=8;i++){const x=-G.open+.2+(2*G.open-.4)*i/8;extra.push(asStone(new THREE.BoxGeometry(.11,2.6,.11).translate(x,apex-1.45,(G.front+G.back)/2+.6),[1,1,1],.7,g0));}
  for(let j=0;j<3;j++)extra.push(asStone(new THREE.BoxGeometry(2*G.open-.2,.1,.13).translate(0,apex-2.5+j*.9,(G.front+G.back)/2+.6),[1,1,1],.7,g0));
  for(let i=0;i<=8;i++){const x=-G.open+.2+(2*G.open-.4)*i/8;gild(new THREE.ConeGeometry(.09,.32,4).rotateX(Math.PI).translate(x,apex-2.92,(G.front+G.back)/2+.6),g0);}
  // The eclipsed sun over the arch, banners either side.
  emblem(0,apex+4.4,G.front,2.05);
  for(const s of [-1,1])banners.push({x:s*5.6,y:top-1.6,z:G.front+.25,yaw:0,s:1.45});
 }
 // ---- Towers: gate pair, corners, the mid towers of the side walls.
 CITADEL_TOWERS.forEach(t=>{
  const faces=t.z>-60?(t.x<0?[0,-.9]:[0,.9]):t.z<-90?(t.x<0?[-2.2,Math.PI]:[2.2,Math.PI]):[t.x<0?-Math.PI/2:Math.PI/2];
  tower(t,faces);
 });
 // ---- Curtain walls: banded outer and inner faces, the walk between, the machicolated parapet outside.
 {
  const run=(ax:number,az:number,bx:number,bz:number)=>{
   const L=Math.hypot(bx-ax,bz-az),ux=(bx-ax)/L,uz=(bz-az)/L,nx=uz,nz=-ux;
   const b=groundMin(ax,az,bx,bz)-1.2;M.ground=b+1.2;
   const {w}=wallFace(ax,az,bx,bz,b,W.top);
   // The inner face, the court side, three metres in.
   const ix=ax-nx*W.thick,iz=az-nz*W.thick,jx=bx-nx*W.thick,jz=bz-nz*W.thick;
   const bi=groundMin(ix,iz,jx,jz)-1.2;M.ground=bi+1.2;
   wallFace(jx,jz,ix,iz,bi,W.top-.05,{len:2.4,course:1.12});
   M.slab(w,0,W.top-.6,.55,L,.6,W.thick-1.05,M.tint(.8),1,4);
   parapet(w,.4,L-.4,W.top);
   // A low pale parapet on the court side of the walk.
   M.stone='pale';M.face(planeWarp(jx,jz,-ux,-uz),.3,L-.3,W.top,W.top+.9,{len:1.8,course:.9,depth:.45,core:0});M.stone=null;
   // Arrow slits, lit.
   for(let u=3.2;u<L-3;u+=6.4)windowAt(M,glass,w,u,W.top-5.4,W.top-4.3,.2,EMBER);
  };
  for(const s of [-1,1]){
   // South: the low terrace wall from the gate tower to the corner tower, stepped down the slope in level runs,
   // basalt with a pale coping, the court open over it.
   {
    const n=6,tops:number[]=[],bases:number[]=[],ax=s>0?SOUTH_RUN[1]:-SOUTH_RUN[1],bx=s>0?SOUTH_RUN[0]:-SOUTH_RUN[0],L=Math.abs(bx-ax),ux=Math.sign(bx-ax),w=planeWarp(ax,W.south,ux,0);
    for(let k=0;k<n;k++){
     const u0=L*k/n-(k?.02:0),u1=L*(k+1)/n,xa=ax+ux*u0,xb=ax+ux*u1;
     let gmax=-Infinity;for(let i=0;i<=6;i++)gmax=Math.max(gmax,h(xa+(xb-xa)*i/6,W.south),h(xa+(xb-xa)*i/6,W.south-1));
     const b=groundMin(xa,W.south,xb,W.south)-1,top=gmax+W.low;M.ground=b+1;
     M.face(w,u0,u1,b,top,{len:1.9,course:.85,depth:.45});
     M.face(planeWarp(xb,W.south-1,-ux,0),L-u1,L-u0,b,top,{len:1.9,course:.85,depth:.45});
     M.slab(w,u0,b,.4,u1-u0,top-b,.2,M.tint(.7),1,16|32);
     M.stone='pale';for(let u=u0;u<u1-.05;){const ww=Math.min(1.5+rand()*.6,u1-u);M.block(w,u+.02,top,-.12,ww-.04,.32,1.24,{bevel:.05,closed:true,far:true});u+=ww;}M.stone=null;
     tops.push(top);bases.push(b);
    }
    // Pale piers where the runs step, rising over both, so the coping never ends in the air.
    for(let k=0;k<=n;k++){
     const u=Math.min(L-.6,Math.max(.6,L*k/n)),t=Math.max(tops[Math.max(0,k-1)],tops[Math.min(n-1,k)])+.45,bb=Math.min(bases[Math.max(0,k-1)],bases[Math.min(n-1,k)]);
     M.stone='pale';M.block(w,u-.6,bb,-.2,1.2,t-bb,1.4,{bevel:.06,closed:true,far:true});M.block(w,u-.7,t,-.3,1.4,.24,1.6,{bevel:.05,closed:true});M.stone=null;
    }
   }
   // Sides: corner to mid tower to corner.
   for(const [za,zb] of [[-50-3.6,-76+2.8],[-76-2.8,-102+3.6]] as const){
    if(s>0)run(W.side,zb,W.side,za);else run(-W.side,za,-W.side,zb);
   }
  }
  // Back: corner to keep, keep to corner (outer face north).
  run(-34+3.6,W.back,-K.hx-.2,W.back);run(K.hx+.2,W.back,34-3.6,W.back);
 }
 // ---- The keep.
 {
  const x0=K.x-K.hx,x1=K.x+K.hx,zs=K.z+K.hz,zn=K.z-K.hz;
  const faces:[number,number,number,number][]=[[x1,zs,x0,zs],[x0,zn,x1,zn],[x1,zn,x1,zs],[x0,zs,x0,zn]];
  const g0=h(K.x,zs),door={half:2.1,spring:g0+4.4,apex:g0+6.4};
  const doorR=(door.apex-door.spring)**2/(2*door.half)+door.half/2,dxc=door.half-doorR;
  const doorTop=(x:number)=>{const ax=Math.abs(x);return ax>door.half?-1:door.spring+Math.sqrt(Math.max(0,doorR*doorR-(ax-dxc)**2));};
  faces.forEach(([ax,az,bx,bz],i)=>{
   const b=groundMin(ax,az,bx,bz)-1.4;M.ground=b+1.4;
   const skip=i===0?(u:number,v:number)=>{const x=K.hx-u;return Math.abs(x)<door.half+.9&&v<doorTop(Math.min(Math.abs(x),door.half))+.9;}:undefined;
   const {w,L}=wallFace(ax,az,bx,bz,b,K.top,{quoins:1.4,skip});
   parapet(w,1.6,L-1.6,K.top);
  });
  M.slab((u,v,t)=>[x0+u,v,zn+t],0,K.top-.6,0,2*K.hx,.4,2*K.hz,M.tint(.9),1,4);
  // The door: ablaq voussoirs, a bronze-gilt door in its dark recess, two steps up to it.
  const zz=zs+.12;
  for(const s of [-1,1]){
   const a1=Math.acos(clamp01((doorR-door.half)/doorR)),n=5;
   for(let i=0;i<n;i++){const aa=a1*i/n,ab=a1*(i+1)/n;const vw:Warp=(u,v,t)=>{const a=aa+(ab-aa)*clamp01(u/(doorR*(ab-aa))),rr=doorR+v;return [s*(dxc+rr*Math.cos(a)),door.spring+rr*Math.sin(a),zz-t];};M.stone=(i+(s>0?1:0))%2?'pale':'basalt';M.block(vw,.03,0,0,doorR*(ab-aa)-.06,.9,.8,{bevel:.06,seg:2});M.stone=null;}
   for(let v=g0-.4,k=0;v<door.spring-.05;k++){const hh=Math.min(.85,door.spring-v);M.stone=k%2?'pale':'basalt';M.block(front(zz),-(s>0?door.half+.9:-door.half),v,0,.9,hh-.04,.8,{bevel:.05,closed:true});M.stone=null;v+=hh;}
  }
  M.slab(front(zs-1.4),-door.half,g0-.5,0,2*door.half,door.apex-g0+.5,.2,M.tint(.35),1,1);
  for(const s of [-1,1]){
   const lh=door.spring-g0+.6,lx=s*(door.half/2),lz=zs-1.25;
   extra.push(asStone(new THREE.BoxGeometry(door.half-.06,lh,.14).translate(lx,g0+lh/2-.1,lz),[1,1,1],.7,g0));
   // Gilt bands across the leaf and a grid of studs.
   for(const f of [.18,.5,.82])gild(new THREE.BoxGeometry(door.half-.16,.12,.05).translate(lx,g0-.1+lh*f,lz+.09),g0);
   for(let i=0;i<3;i++)for(let j=0;j<5;j++)gild(new THREE.SphereGeometry(.055,6,4).translate(lx+(i-1)*door.half*.28,g0-.1+lh*(.3+j*.1)+(j>1?lh*.06:0),lz+.1),g0);
  }
  M.stone='pale';for(let k=0;k<2;k++)box(-door.half-1.4+k*.5,door.half+1.4-k*.5,g0-.6,g0+.18+k*.2,zs+1.6-k*.7,1.6,.05);M.stone=null;
  // Lancets either side, the great eclipse above the door, turrets at the corners, the great spire on top.
  const fw=planeWarp(x1,zs,-1,0);
  for(const s of [-1,1]){windowAt(M,glass,fw,K.hx+s*5.9,g0+8.4,g0+11.4,.7,EMBER);windowAt(M,glass,fw,K.hx+s*5.9,K.top-6.2,K.top-4.4,.5,EMBER);}
  emblem(0,K.top-11,zs,2.9);
  for(const s of [-1,1])M.slab(planeWarp(s*door.half,s>0?zs:zs-1.4,0,s>0?-1:1),0,g0-.5,0,1.4,door.apex-g0+.5,.3,M.tint(.55),1,1);
  M.slab(front(zs),-door.half,door.apex-.05,0,2*door.half,.3,1.4,M.tint(.5),1,8);
  for(const [tx,tz] of [[x0,zs],[x1,zs],[x0,zn],[x1,zn]]){
   const b=h(tx,tz)-1.5;M.ground=b+1.5;const top=K.top+4.6,ring=ringWarp(tx,tz,K.turret),C=2*Math.PI*K.turret;
   M.face(ring,0,C,b,top,{len:1.7,course:1.05,depth:.55,curve:.7});
   M.stone='pale';for(let u=0;u<C-.3;u+=.95)M.block(ring,u,top-.7,-.5,.36,.7,.9,{bevel:.04});M.stone=null;
   M.face(ringWarp(tx,tz,K.turret+.45),0,2*Math.PI*(K.turret+.45),top,top+1.0,{len:1.6,course:1.0,depth:.6,curve:.7,core:0});
   M.disc(tx,top+.98,tz,K.turret+.45,16);
   const Hs=6.5,R=K.turret+.55;roofs.push(lathe([[R+.2,0],[R,.3],[R*.66,Hs*.3],[R*.34,Hs*.62],[R*.12,Hs*.9],[.04,Hs]],20,.9).translate(tx,top+1,tz));
   finial(tx,top+1+Hs,tz,.8);
  }
  // The great spire: an octagonal drum with lancets, then the gilded cone, the eclipsed sun at its tip.
  const dr=5.4,dTop=K.top+5;M.ground=K.top;
  M.face(ringWarp(K.x,K.z,dr),0,2*Math.PI*dr,K.top-.6,dTop-1.9,{len:1.9,course:1.0,depth:.55,curve:.8});
  for(let k=0;k<8;k++)windowAt(M,glass,ringWarp(K.x,K.z,dr),(k+.5)/8*2*Math.PI*dr,K.top+.9,K.top+2.6,.42,EMBER);
  crown(K.x,K.z,dr,dTop);
  const Hs=K.spire,R=dr+.1;
  roofs.push(lathe([[R+.35,0],[R+.1,.25],[R,.7],[R*.78,Hs*.16],[R*.55,Hs*.36],[R*.34,Hs*.58],[R*.17,Hs*.8],[R*.06,Hs*.95],[.05,Hs]],40,.9).translate(K.x,dTop+.2,K.z));
  finial(K.x,dTop+.2+Hs,K.z,2.6);
  halos.push({x:K.x,y:dTop+Hs+5,z:K.z,size:22,color:'#ffb060',power:.22});
 }
 // ---- The arena: the carved curb round the dial, the sun pillars with their fire bowls.
 {
  M.ground=A.y;const ring=ringWarp(A.x,A.z,A.curb),C=2*Math.PI*A.curb;
  M.stone='pale';
  for(let u=0;u<C-.1;){
   const w=1.6+rand()*.9,a=(u+w/2)/A.curb,cx=A.x+Math.sin(a)*A.curb,cz=A.z+Math.cos(a)*A.curb;
   // Under the gatehouse the curb gives way to the passage.
   if(!(Math.abs(cx)<G.half+.6&&cz>G.back-1.2))M.block(ring,u+.02,A.y-.5,0,Math.min(w,C-u)-.04,.6,A.curb-A.r+.05,{bevel:.06,seg:3,closed:true});
   u+=w;
  }
  M.stone=null;
  const bowl=[[0,0],[.3,.02],[.6,.14],[.95,.42],[1.12,.66],[1.15,.74],[1.02,.76],[.3,.5],[0,.5]].map(([a,b])=>new THREE.Vector2(a,b));
  /** A dressed monolith: a square block tapering from w0 to w1, flat-faced, its own tint. */
  const mono=(x:number,z:number,y0:number,hgt:number,w0:number,w1:number,yaw:number,tint:V3,ground:number)=>{
   const g=new THREE.CylinderGeometry(w1/Math.SQRT2,w0/Math.SQRT2,hgt,4,1).rotateY(Math.PI/4+yaw).translate(x,y0+hgt/2,z).toNonIndexed();g.computeVertexNormals();
   extra.push(asStone(g,tint,false,ground));
  };
  const plinth=(x:number,z:number,y:number,w:number,yaw:number)=>{mono(x,z,y-.6,1.02,w+.7,w+.62,yaw,M.paleTint(),y);mono(x,z,y+.42,.5,w+.26,w+.2,yaw,M.paleTint(1.05),y);};
  for(const o of citadelObelisks()){
   const y=h(o.x,o.z);M.ground=y;const yaw=-o.a;
   plinth(o.x,o.z,y,1.5,yaw);
   // Three basalt drums, polished, a fine joint between each.
   for(let k=0;k<3;k++)mono(o.x,o.z,y+.92+k*2.14,2.11,1.5-k*.1,1.4-k*.1,yaw,M.tint(1.1),y);
   // Capital: a pale collar and a gilt band, then the fire bowl.
   mono(o.x,o.z,y+7.34,.56,1.5,1.8,yaw,M.paleTint(),y);
   gild(new THREE.CylinderGeometry(1.86/Math.SQRT2,1.86/Math.SQRT2,.22,4,1).rotateY(Math.PI/4+yaw).translate(o.x,y+8.01,o.z).toNonIndexed(),y);
   gild(new THREE.LatheGeometry(bowl,20).translate(o.x,y+8.1,o.z),y);
   flames.push({x:o.x,y:y+8.85,z:o.z,size:1.9,cold:false},{x:o.x+.3,y:y+8.7,z:o.z-.2,size:1.2,cold:false});
   halos.push({x:o.x,y:y+9.4,z:o.z,size:5.2,color:'#ff9c40',power:.5});
  }
  // Obelisks on the ascent: gilt pyramidion, a sun disc on the face toward the avenue.
  for(const s of [-1,1])for(const z of CITADEL_APPROACH.z){
   const x=s*CITADEL_APPROACH.x,y=h(x,z);M.ground=y;
   plinth(x,z,y,1.15,0);
   mono(x,z,y+.92,7.24,1.15,.72,0,M.tint(1.15),y);
   gild(new THREE.ConeGeometry(.36*Math.SQRT2,1.1,4).rotateY(Math.PI/4).translate(x,y+8.7,z),y);
   const fx=x-s*(1.15+(.72-1.15)*.35)/2-s*.05;
   gild(new THREE.CylinderGeometry(.32,.32,.06,20).rotateZ(Math.PI/2).translate(fx,y+6.3,z),y);
   gild(new THREE.TorusGeometry(.42,.035,6,28).rotateY(Math.PI/2).translate(fx,y+6.3,z),y);
  }
  // Fire bowls on pedestals before the gate and at the keep's door.
  for(const br of CITADEL_BRAZIERS){
   const y=h(br.x,br.z);M.ground=y;
   mono(br.x,br.z,y-.5,.8,1.3,1.24,0,M.paleTint(),y);mono(br.x,br.z,y+.3,1.1,.82,.7,0,M.tint(1.1),y);
   gild(new THREE.LatheGeometry(bowl,20).scale(.8,.8,.8).translate(br.x,y+1.4,br.z),y);
   flames.push({x:br.x,y:y+2.05,z:br.z,size:1.6,cold:false});halos.push({x:br.x,y:y+2.5,z:br.z,size:4.4,color:'#ff9c40',power:.55});
  }
 }

 // ---- Meshes: one stone (near and far by LOD), one gilded scale, one window glass, the fire; the dial and the court.
 const stoneMat=dawnMasonryMaterial('dawn-citadel-stone');
 const nearGeo=mergeGeometries([M.geometry(),...extra],false)!;nearGeo.computeBoundingSphere();
 const farGeo=mergeGeometries([F.geometry(),...extra],false)!;farGeo.computeBoundingSphere();
 const lodAt=new THREE.Vector3(0,26,-78),lod=new THREE.LOD();lod.name='dawn-citadel-lod';lod.position.copy(lodAt);
 const near=new THREE.Mesh(nearGeo,stoneMat);near.name='dawn-citadel-stone';near.castShadow=near.receiveShadow=true;near.position.copy(lodAt).negate();
 const far=new THREE.Mesh(farGeo,stoneMat);far.name='dawn-citadel-stone-far';far.castShadow=far.receiveShadow=true;far.position.copy(lodAt).negate();
 lod.addLevel(near,0);lod.addLevel(far,112);
 const spires=new THREE.Mesh(mergeGeometries(roofs,false)!,scaleMaterial());spires.name='dawn-citadel-spires';spires.castShadow=spires.receiveShadow=true;
 const glassMesh=glass.mesh('dawn-citadel-ember-glass');
 const fire=frostFire('dawn-citadel-fire',flames,halos,9137,6);
 const arena=dawnArena(h);
 root.add(lod,spires,glassMesh,arena.court,fire.group);
 root.userData.citadel={blocks:M.blocks,nearTriangles:nearGeo.index!.count/3,farTriangles:farGeo.index!.count/3,gilt:extra.length,spires:roofs.length,flames:flames.length,obelisks:citadelObelisks().length,windows:glass.pos.length/3};
 return {root,floor:arena.floor,update(time,quality){fire.update(time);arena.update(time,quality);},async dress(){
  const props=await loadKit('models/world/props.glb');
  // Kit materials are shared with other worlds: patched clones only. Solarkan's cloth is crimson, its fittings gold.
  const variants=new Map<string,THREE.Material>();
  const dye=(m:THREE.Material)=>{
   let v=variants.get(m.name);if(v)return v;v=m.clone();const sm=v as THREE.MeshStandardMaterial;
   if(/Cloth/.test(m.name))addPatch(v,'dawn-solarkan-cloth',sh=>{sh.fragmentShader=sh.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\n{float l=dot(diffuseColor.rgb,vec3(.299,.587,.114));diffuseColor.rgb=pow(vec3(l),vec3(.8))*vec3(1.35,.2,.12);}');});
   else{sm.side=THREE.FrontSide;stylise(v,.9,[1.08,.92,.7]);}
   variants.set(m.name,v);return v;
  };
  const po:Record<string,THREE.Material>={};for(const [n,m] of props.materials)po[n]=dye(m);
  const flags=new StaticBatch(props,'dawn-citadel-banners');
  const B=props.get('Banner_1').box;
  for(const b of banners){const w=(B.max.x-B.min.x)*b.s;flags.add('Banner_1',trs(b.x-Math.cos(b.yaw)*w/2,b.y-B.max.y*b.s,b.z+Math.sin(b.yaw)*w/2,b.yaw,b.s),{override:po});}
  const g=flags.build();root.add(g);root.userData.citadel.banners=banners.length;
 }};
}
