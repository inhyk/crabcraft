import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {crystalCluster,crystalGeometry,type Crystal} from './iceCrystals';
import {harmonise,loadKit,StaticBatch,trs} from '../world/kit';
import {addPatch,stylise} from '../world/materials';
import {lathe} from '../world/geom';
import {snowCover,snowMass} from './snowCover';
import {frostFire,type Flame,type Halo} from './frostFire';
import {Masonry,masonryMaterial,planeWarp,ringWarp,type V3,type Warp} from './frostMasonry';
import {ARENA,arenaPillars,CITADEL,THRONE,throneFloor,type Tower} from './frostThroneLayout';

/*
 * Boreas's Frozen Throne and the glacial citadel behind it, on the vista at the end of the main road. Dressed granite
 * (frostMasonry.ts, the arena rim's stone) in courses: the throne on a stepped dais at the arena's north edge, a
 * curtain wall whose gate the ice has sealed, four round towers and a keep, all crowned with grown ice
 * (iceCrystals.ts) and the great spire on the keep; cold aurora light in every window, icicles under the parapets,
 * a glacier swallowing the west flank. The arena's crystal pillars carry crowns of ice round Boreas's cold fire.
 */

type Height=(x:number,z:number)=>number;
export interface FrostThroneOptions {
 height:Height;
 /** The island's grown ice (iceCrystals.ts iceMaterial). */
 ice:THREE.Material;
}
export interface FrostThrone {
 root:THREE.Group;
 update(time:number):void;
 /** Slate roofs and frozen banners from the kits (CC0, see NOTICE.md); call from buildSettlement(). */
 dress():Promise<void>;
}

function stream(seed:number){let s=seed>>>0;return()=>(s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296;}
const clamp01=(v:number)=>Math.min(1,Math.max(0,v));

/** Aurora window glass: emissive teal, brightest low in the pane, a few violet. HDR, so the bloom picks it up. */
export class Glass {
 pos:number[]=[];col:number[]=[];
 /** A lancet (rectangle and pointed head) on a face, `w` wide, sill at v0, springing at v1. */
 lancet(warp:Warp,u:number,v0:number,v1:number,w:number,tint:V3,t=-.02){
  const head=w*.85,steps=6;
  const L=(uu:number,vv:number)=>warp(uu,vv,t);
  const colAt=(vv:number):V3=>{const k=1.25-.55*clamp01((vv-v0)/(v1+head-v0));return [tint[0]*k,tint[1]*k,tint[2]*k];};
  const push=(p:V3,c:V3)=>{this.pos.push(...p);this.col.push(...c);};
  const tri=(a:[number,number],b:[number,number],c:[number,number])=>{for(const [uu,vv] of [a,b,c])push(L(uu,vv),colAt(vv));};
  const n=3;
  for(let i=0;i<n;i++){const ua=u-w/2+w*i/n,ub=u-w/2+w*(i+1)/n;tri([ua,v0],[ub,v0],[ub,v1]);tri([ua,v0],[ub,v1],[ua,v1]);}
  // Pointed head: two arcs meeting at the apex, as a fan from the springing line's middle.
  const arc=(s:number)=>{const out:[number,number][]=[];for(let i=0;i<=steps;i++){const k=i/steps;const x=s*(w/2)*(1-k),y=v1+head*Math.sin(k*Math.PI/2)**.8;out.push([u+x,y]);}return out;};
  for(const s of [-1,1]){const a=arc(s);for(let i=0;i<steps;i++)tri([u,v1],a[i],a[i+1]);}
 }
 mesh(name:string){
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(this.pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(this.col,3));
  const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({name,vertexColors:true,side:THREE.DoubleSide,fog:true}));m.name=name;return m;
 }
}

/** Glass a few centimetres proud of the face, framed by a proud stone surround: jambs, sill and hood. */
export function windowAt(M:Masonry,glass:Glass,warp:Warp,u:number,v0:number,v1:number,w:number,tint:V3){
 const head=w*.85,j=Math.max(.18,w*.32);
 glass.lancet(warp,u,v0,v1,w,tint,-.08);
 for(const s of [-1,1])M.block(warp,s<0?u-w/2-j:u+w/2,v0-.04,-.2,j,v1+head*.55-v0+.04,.32,{bevel:.04,closed:true});
 M.block(warp,u-w/2-j-.12,v0-.24,-.24,w+2*j+.24,.22,.36,{bevel:.04,closed:true});
 M.block(warp,u-w/2-j*.6,v1+head+.04,-.22,w+j*1.2,.26,.34,{bevel:.04,closed:true});
}

/** Smooth 1D value noise, 0..1. */
function noise1(x:number,k=0){const hh=(v:number)=>{const q=Math.sin(v*127.1+k*311.7)*43758.5453;return q-Math.floor(q);};const i=Math.floor(x),f=x-i,u=f*f*(3-2*f);return hh(i)*(1-u)+hh(i+1)*u;}

/**
 * Snow banked against a wall foot: highest at the stone, feathering out over `width`, following the ground.
 * `path` runs along the foot with the outward normal at each point; `open` is 0..1 along it where it thins (a gate).
 */
export function bank(h:Height,path:{x:number;z:number;nx:number;nz:number}[],height:number,width:number,seed:number,thin=(_t:number)=>1){
 const pos:number[]=[],occ:number[]=[],idx:number[]=[],nS=6;
 let along=0;
 path.forEach((p,i)=>{
  if(i)along+=Math.hypot(p.x-path[i-1].x,p.z-path[i-1].z);
  const end=Math.min(1,Math.min(i,path.length-1-i)/3),H=height*(.55+.7*noise1(along*.35,seed))*thin(i/(path.length-1))*(.3+.7*end);
  for(let k=0;k<=nS;k++){
   const u=k/nS,d=u*width*(.75+.5*noise1(along*.6+3,seed))-.18,x=p.x+p.nx*d,z=p.z+p.nz*d;
   pos.push(x,h(x,z)+H*Math.pow(1-Math.pow(u,1.4),1.5)-.06,z);
   const o=1-.22*Math.pow(1-u,4);occ.push(o,o,o);
  }
 });
 for(let i=0;i<path.length-1;i++)for(let k=0;k<nS;k++){const a=i*(nS+1)+k,b=a+1,c=a+nS+1,d=c+1;idx.push(a,b,c,b,d,c);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(occ,3));g.setIndex(idx);g.computeVertexNormals();
 // Wind the strip upward whichever way the path runs.
 const n=g.getAttribute('normal');let up=0;for(let i=0;i<n.count;i++)up+=n.getY(i);
 if(up<0){for(let i=0;i<idx.length;i+=3){const t=idx[i+1];idx[i+1]=idx[i+2];idx[i+2]=t;}g.setIndex(idx);g.computeVertexNormals();}
 return g;
}
export const line=(ax:number,az:number,bx:number,bz:number,nx:number,nz:number,step=.5)=>{const L=Math.hypot(bx-ax,bz-az),n=Math.max(2,Math.ceil(L/step));return Array.from({length:n+1},(_,i)=>({x:ax+(bx-ax)*i/n,z:az+(bz-az)*i/n,nx,nz}));};
export const arc=(cx:number,cz:number,r:number,a0:number,a1:number,step=.5)=>{const n=Math.max(3,Math.ceil(Math.abs(a1-a0)*r/step));return Array.from({length:n+1},(_,i)=>{const a=a0+(a1-a0)*i/n;return {x:cx+Math.sin(a)*r,z:cz+Math.cos(a)*r,nx:Math.sin(a),nz:Math.cos(a)};});};

export function frostThrone(opts:FrostThroneOptions):FrostThrone {
 const h=opts.height,root=new THREE.Group();root.name='frostlight-throne-citadel';
 const rand=stream(77019),M=new Masonry(rand),glass=new Glass(),ice:Crystal[]=[],icicles:Crystal[]=[];
 const flames:Flame[]=[],halos:Halo[]=[];
 /** Slate cones for the roofed towers and turrets, and frozen banners, laid by dress() once the kits load. */
 const drifts:THREE.BufferGeometry[]=[];
 const roofs:{x:number;y:number;z:number;r:number}[]=[],banners:{x:number;y:number;z:number;yaw:number;s:number}[]=[];
 const teal:V3=[.32,1.55,1.45],violet:V3=[.95,.55,1.7];
 const Y=ARENA.y,yP=throneFloor();

 // Block helpers in a frame facing +z (the arena): x0..x1 across, y0..y1 up, front face at z = zf, `d` deep.
 const front=(zf:number)=>planeWarp(0,zf,-1,0);
 const box=(x0:number,x1:number,y0:number,y1:number,zf:number,d:number,bevel=.08,tint?:V3)=>M.block(front(zf),-x1,y0,0,x1-x0,y1-y0,d,{bevel,tint,closed:true});
 /** A block narrowing upward to `top` of its width: the gable caps of the throne. */
 const taper=(x0:number,x1:number,y0:number,y1:number,zf:number,d:number,top:number,tint?:V3)=>{
  const cx=(x0+x1)/2,half=(x1-x0)/2;
  const w:Warp=(u,v,t)=>{const k=1-(1-top)*clamp01((v-y0)/(y1-y0));return [cx+(half-u)*k,v,zf-t];};
  M.block(w,0,y0,0,2*half,y1-y0,d,{bevel:.06,tint,closed:true});
 };

 // ---- The dais: three straight tiers of long stones, each a riser and a tread, the top one the throne's floor.
 M.ground=Y;M.snow=.22;
 THRONE.tiers.forEach((half,k)=>{
  const zf=THRONE.front-k*THRONE.tread,top=Y+THRONE.rise*(k+1);
  let x=-half;
  while(x<half-.01){let w=1.2+rand()*1.1;if(half-(x+w)<.7)w=half-x;box(x+.03,x+w-.03,Y-.4,top+(rand()-.5)*.02,zf-(rand()-.5)*.03,zf-THRONE.back,.06);x+=w;}
 });
 // ---- The throne: plinth, seat, arms, a tapering back with a gable and two lower wings, all one dark granite.
 const tz=THRONE.z,dark=()=>M.tint(.82);
 M.ground=yP;M.snow=.3;
 box(-3.5,3.5,yP-.05,yP+.62,tz+3.1,6.2,.1);
 box(-2.35,2.35,yP+.62,yP+2.2,tz+1.7,3.1,.1,dark());
 for(const s of [-1,1]){
  box(Math.min(2.35*s,3.35*s),Math.max(2.35*s,3.35*s),yP+.62,yP+3.15,tz+1.95,3.5,.1);
  box(Math.min(2.25*s,3.5*s),Math.max(2.25*s,3.5*s),yP+3.15,yP+3.6,tz+2.15,3.85,.08,dark());
  // Wings beside the back, each pointed.
  box(Math.min(2.6*s,3.55*s),Math.max(2.6*s,3.55*s),yP+.62,yP+6.4,tz-1.0,1.15,.08);
  taper(Math.min(2.6*s,3.55*s),Math.max(2.6*s,3.55*s),yP+6.4,yP+7.9,tz-1.0,1.15,.12,dark());
 }
 // The back: four courses narrowing upward, a moulded band, and the gable.
 let by=yP+2.2;
 for(let i=0;i<4;i++){const hw=2.55-i*.12,ht=1.65+rand()*.2;box(-hw,hw,by,by+ht,tz-1.25,1.45,.09,i%2?dark():undefined);by+=ht;}
 box(-2.25,2.25,by,by+.38,tz-1.1,1.75,.06,dark());by+=.38;
 taper(-2.1,2.1,by,by+2.8,tz-1.25,1.45,.06);
 const runeY=yP+5.7,runeZ=tz-1.25+.035;
 // The snowflake sigil of the arena's centre, cut into the back and lit from within.
 {
  const r=1.05,seg=(x0:number,y0:number,x1:number,y1:number,w:number)=>{const dx=x1-x0,dy=y1-y0,l=Math.hypot(dx,dy),nx=-dy/l*w/2,ny=dx/l*w/2;
   const c:V3=[teal[0]*1.4,teal[1]*1.25,teal[2]*1.3],P=(x:number,y:number):V3=>[x,y,runeZ];
   for(const p of [P(x0+nx,y0+ny),P(x1+nx,y1+ny),P(x1-nx,y1-ny),P(x0+nx,y0+ny),P(x1-nx,y1-ny),P(x0-nx,y0-ny)]){glass.pos.push(...p);glass.col.push(...c);}};
  for(let k=0;k<6;k++){const a=k*Math.PI/3,ca=Math.cos(a),sa=Math.sin(a);seg(ca*.18,runeY+sa*.18,ca*r,runeY+sa*r,.09);
   for(const f of [.5,.75]){const bx=ca*r*f,byy=runeY+sa*r*f;for(const s of [-1,1]){const b=a+s*.75;seg(bx,byy,bx+Math.cos(b)*.32*(1.2-f),byy+Math.sin(b)*.32*(1.2-f),.07);}}}
  for(let k=0;k<24;k++){const a0=k/24*Math.PI*2,a1=(k+1)/24*Math.PI*2;seg(Math.cos(a0)*1.32,runeY+Math.sin(a0)*1.32,Math.cos(a1)*1.32,runeY+Math.sin(a1)*1.32,.06);}
  halos.push({x:0,y:runeY,z:runeZ+.3,size:3.4,color:'#5fe8d4',power:.35});
 }
 // The crown: ice fanning out behind the back like a frozen sunburst, the longest straight up.
 const cO=new THREE.Vector3(0,yP+5.4,tz-2.0);
 for(let k=-6;k<=6;k++){
  const phi=k*.215+(rand()-.5)*.05,c=Math.cos(phi),len=3.6+7.6*Math.pow(c,1.6)+rand()*1.1;
  const ax=Math.sin(phi),ay=c,az=-.12-rand()*.1;
  ice.push({x:cO.x+ax*.6,y:cO.y+ay*.6,z:cO.z,axis:[ax,ay,az],height:len,radius:.38+.32*c,seed:rand()*97});
  if(Math.abs(k)<6){const p2=phi+.107;ice.push({x:cO.x+Math.sin(p2)*.8,y:cO.y+Math.cos(p2)*.8,z:cO.z-.35,axis:[Math.sin(p2),Math.cos(p2),-.25],height:len*.55,radius:.26,seed:rand()*97});}
 }
 // Rime grown on the arms and at the plinth's corners.
 for(const s of [-1,1]){crystalCluster(3.0*s,yP+3.55,tz+1.2,1.3,.7,3,rand,ice);crystalCluster(3.4*s,yP-.05,tz+2.9,1.8,1.0,4,rand,ice);crystalCluster(7.2*s,Y,THRONE.front-.6,1.5,1.2,4,rand,ice);}
 // Cold braziers either side of the throne: a granite pedestal and an iron bowl of Boreas's fire.
 const bowls:THREE.BufferGeometry[]=[];
 const bowl=new THREE.LatheGeometry([[0,0],[.42,.02],[.5,.16],[.62,.36],[.78,.5],[.8,.56],[.7,.58],[.2,.5],[0,.5]].map(([x,y])=>new THREE.Vector2(x,y)),18);
 const pedestal=(x:number,y:number,z:number,ht:number)=>{
  box(x-.62,x+.62,y-.1,y+.32,z+.62,1.24,.06,M.tint(.8));
  box(x-.42,x+.42,y+.32,y+ht-.3,z+.42,.84,.08);
  box(x-.56,x+.56,y+ht-.3,y+ht,z+.56,1.12,.06,M.tint(.8));
  bowls.push(bowl.clone().translate(x,y+ht,z));
  flames.push({x,y:y+ht+.42,z,size:1.5,cold:true});halos.push({x,y:y+ht+.95,z,size:4.2,color:'#5af0c0',power:.55});
 };
 for(const s of [-1,1])pedestal(5.1*s,yP,THRONE.front-2*THRONE.tread-1.0,1.55);
 // Iron standards at the platform's back corners, each flying Boreas's frozen banner.
 const poles:THREE.BufferGeometry[]=[],pole=lathe([[.2,0],[.2,.25],[.11,.4],[.075,7.6],[.13,7.7],[.13,7.82],[0,8.15]],10);
 for(const s of [-1,1]){const x=6.3*s,z=THRONE.back+1.1;poles.push(pole.clone().translate(x,yP-.05,z),new THREE.CylinderGeometry(.05,.05,2.2,6).rotateZ(Math.PI/2).translate(x-s*.9,yP+7.35,z+.12));banners.push({x:x-s*.9,y:yP+7.25,z:z+.2,yaw:0,s:1.25});}

 // ---- The glacial citadel.
 M.snow=.45;
 const wl=CITADEL.wall,gt=CITADEL.gate;
 const groundMin=(x0:number,z0:number,x1:number,z1:number)=>{let m=Infinity;for(let i=0;i<=8;i++){const k=i/8;m=Math.min(m,h(x0+(x1-x0)*k,z0+(z1-z0)*k));}return m;};
 /** A straight face from (ax,az) to (bx,bz), outward to the right of travel... as planeWarp: n = (dz, -dx). */
 const wallFace=(ax:number,az:number,bx:number,bz:number,v0:number,v1:number,o:Parameters<Masonry["face"]>[5]={})=>{
  const L=Math.hypot(bx-ax,bz-az),w=planeWarp(ax,az,(bx-ax)/L,(bz-az)/L);M.face(w,0,L,v0,v1,{len:2.1,course:1.12,depth:.6,...o});return {w,L};
 };
 /** Merlons along a face (warp frame), standing on a corbelled string course. */
 const parapet=(w:Warp,u0:number,u1:number,v:number,o:{out?:number;corbels?:boolean;merlon?:number}={})=>{
  const out=o.out??.35;
  if(o.corbels!==false)for(let u=u0+.35;u<u1-.5;u+=1.15)M.block(w,u,v-.72,-out,.42,.72,out+.4,{bevel:.04});
  for(let u=u0-.2;u<u1+.2-.05;){const ww=Math.min(1.6+rand()*.8,u1+.2-u);M.block(w,u+.02,v,-out,ww-.04,.5,out+.5,{bevel:.05});u+=ww;}
  const mw=o.merlon??1.2;let k=0;
  for(let u=u0+.15;u+mw<=u1-.1;u+=mw+.85,k++)M.block(w,u,v+.5,-out+.06,mw,1.45+(k%3===1?.1:0),.75,{bevel:.06,closed:true});
 };
 /** A round tower: plinth, courses, corbels, parapet, merlons, and an ice crown. */
 const tower=(tw:Tower,base:number,windows:number[])=>{
  const {x,z,r,top}=tw;
  M.ground=h(x,z);
  const plinth=M.ground+1.6;
  const ring=(rr:number)=>ringWarp(x,z,rr,0),C=2*Math.PI;
  M.face(ring(r+.45),0,C*(r+.45),base,plinth,{len:2,course:.9,depth:.7,curve:.8});
  M.face(ring(r),0,C*r,plinth,top-1.6,{len:2.1,course:1.1,depth:.6,curve:.8});
  const pr=ring(r+.55);
  for(let u=0;u<C*r-.4;u+=1.05)M.block(ring(r),u,top-2.3,-.62,.42,.75,1.0,{bevel:.04});
  M.face(pr,0,C*(r+.55),top-1.6,top,{len:1.8,course:.8,depth:.7,curve:.8,core:.0});
  if(tw.crown>0){
   for(let u=0,k=0;u<C*(r+.55)-1.6;u+=1.95,k++)M.block(pr,u,top,0,1.1,1.4+(k%2)*.12,.7,{bevel:.06,seg:2,closed:true});
   // Floor inside the parapet, snow-covered, and the ice crown growing out of it.
   M.disc(x,top-.02,z,r,28);
   crystalCluster(x,top-.4,z,tw.crown,r*.9,7,rand,ice);
  }else{M.disc(x,top-.02,z,r+.5,28);roofs.push({x,y:top,z,r:r+.75});}
  if(tw.z>-125)banners.push({x,y:top-3.4,z:z+r+.28,yaw:0,s:1.7});
  for(const a of windows){const u=a*r;windowAt(M,glass,ring(r),u,top-11-rand()*3,top-9,.42,teal);windowAt(M,glass,ring(r),u+(rand()<.5?.6:-.6)*r*.4,top-20,top-18.6,.3,teal);}
  for(let u=0;u<C*(r+.55);u+=.38+rand()*.5)if(rand()<.7){const [ix,iy,iz]=pr(u,top-.02,-.05-rand()*.25);icicles.push({x:ix,y:iy,z:iz,axis:[(rand()-.5)*.1,-1,(rand()-.5)*.1],height:.25+rand()**2*1.6,radius:.05+rand()*.06,seed:rand()*97});}
 };
 // Curtain wall, the gatehouse in front of its middle, and the corbelled parapet along the top.
 {
  const b=groundMin(-wl.half,wl.z,wl.half,wl.z)-1.2;M.ground=h(0,wl.z);
  const {w}=wallFace(wl.half+.6,wl.z,-wl.half-.6,wl.z,b,wl.top,{skip:(u)=>Math.abs(wl.half+.6-u)<gt.half-.2});
  // Mortar core behind, top walkway and back face in one slab.
  M.slab(w,0,b,.5,2*wl.half+1.2,wl.top-b-.02,wl.thick-.5,M.tint(.85),1,2|4);
  parapet(w,.4,2*wl.half+.8,wl.top);
  // Arrow slits along the wall, aurora-lit.
  for(let x=-wl.half+3.2;x<wl.half-2;x+=5.6)if(Math.abs(x)>gt.half+1.5)windowAt(M,glass,w,wl.half+.6-x,wl.top-5.2,wl.top-4,.26,teal);
  for(let u=.3;u<2*wl.half+1;u+=.32+rand()*.45)if(rand()<.65){const [ix,iy,iz]=w(u,wl.top-.05,-.38-rand()*.2);icicles.push({x:ix,y:iy,z:iz,axis:[(rand()-.5)*.1,-1,(rand()-.5)*.1],height:.2+rand()**2*1.5,radius:.04+rand()*.06,seed:rand()*97});}
 }
 {
  // Gatehouse: three faces, the frozen gate, two lancets, bartizans at its front corners.
  const b=groundMin(-gt.half,gt.z,gt.half,gt.z)-1.2;M.ground=h(0,gt.z);
  const R=(gt.apex-gt.spring)**2/(2*gt.open)+gt.open/2,xc=gt.open-R,margin=.95;
  const archTop=(x:number)=>{const ax=Math.abs(x);return ax>gt.open?-1:gt.spring+Math.sqrt(Math.max(0,R*R-(ax-xc)**2));};
  const {w}=wallFace(gt.half,gt.z,-gt.half,gt.z,b,gt.top,{skip:(u,v)=>{const x=gt.half-u;return Math.abs(x)<gt.open+margin&&v<archTop(Math.min(Math.abs(x),gt.open))+margin;}});
  for(const s of [-1,1])wallFace(s*gt.half,s>0?wl.z:gt.z,s*gt.half,s>0?gt.z:wl.z,b,gt.top,{len:1.9});
  M.slab(w,0,b,.5,2*gt.half,gt.top-b-.02,gt.z-wl.z+.6,M.tint(.85),1,4);
  parapet(w,.2,2*gt.half-.2,gt.top,{merlon:1.05});
  // Voussoirs round the pointed arch, a little proud of the face, one stone at the apex.
  for(const s of [-1,1]){
   const a1=Math.acos(clamp01((R-gt.open)/R)),n=6;
   for(let i=0;i<n;i++){
    const aa=a1*i/n,ab=a1*(i+1)/n;
    const vw:Warp=(u,v,t)=>{const a=aa+(ab-aa)*clamp01(u/(R*(ab-aa))),rr=R+v;return [s*(xc+rr*Math.cos(a)),gt.spring+rr*Math.sin(a),gt.z+.12-t];};
    M.block(vw,.03,0,0,R*(ab-aa)-.06,margin,.9,{bevel:.06,seg:2});
   }
   // Jambs below the springing.
   for(let v=b+1.2;v<gt.spring-.05;){const hh=Math.min(.9+rand()*.3,gt.spring-v);box(s>0?gt.open:-gt.open-margin,s>0?gt.open+margin:-gt.open,v,v+hh-.04,gt.z+.12,.9,.06);v+=hh;}
   // The reveal: the passage walls, in shadow.
   M.slab(planeWarp(s*gt.open,gt.z,0,-s),0,b,0,3.2,gt.apex-b,.3,M.tint(.5),1,1);
  }
  box(-.5,.5,gt.apex-.25,gt.apex+.95,gt.z+.2,1.0,.06,M.tint(.85));
  M.slab(front(gt.z-3.1),-gt.open,b,0,2*gt.open,gt.apex-b,.3,M.tint(.35),1,1);
  // Boreas's ice has sealed the gate: spears grown up from the threshold, the tallest under the apex.
  for(let i=0;i<11;i++){const x=-gt.open+.25+(2*gt.open-.5)*i/10,top=archTop(x)-.25-rand()*.6,y0=h(x,gt.z-.6)-.2;ice.push({x,y:y0,z:gt.z-.7-rand()*.5,axis:[(rand()-.5)*.08,1,(rand()-.5)*.08],height:top-y0,radius:.42+rand()*.18,seed:rand()*97});}
  crystalCluster(0,h(0,gt.z+.8),gt.z+.6,2.6,2.2,6,rand,ice);
  for(const s of [-1,1])windowAt(M,glass,w,gt.half-s*2.6,gt.top-6.4,gt.top-4.4,.5,teal);
  for(const s of [-1,1])banners.push({x:s*5.05,y:gt.top-1.6,z:gt.z+.2,yaw:0,s:1.55});
  // Bartizans: corbelled out of the corners, each with an ice point.
  for(const s of [-1,1]){
   const bx=s*(gt.half-.3),bz=gt.z+.3,br=1.25,ring=ringWarp(bx,bz,br,0),C=2*Math.PI*br;
   for(let i=0;i<3;i++){const rr=.45+i*.38;M.face(ringWarp(bx,bz,rr,0),0,2*Math.PI*rr,gt.top-6.2+i*.55,gt.top-5.65+i*.55,{len:1.1,course:.55,depth:.5,curve:.5,core:0});}
   M.face(ring,0,C,gt.top-4.6,gt.top+2.6,{len:1.3,course:.8,depth:.5,curve:.5});
   M.disc(bx,gt.top+2.58,bz,br,14);roofs.push({x:bx,y:gt.top+2.6,z:bz,r:br+.3});
  }
 }
 // Towers: the front pair flank the wall; the rear pair stand on the sea ice below the cliff.
 CITADEL.towers.forEach((tw,i)=>{const b=h(tw.x,tw.z)-1.6;tower(tw,b,i<2?[-.62,.62,i?-1.2:1.2]:[2.6,3.7]);});
 // Side walls from the front towers down the cliff to the rear towers, and the sea wall between the rear pair.
 for(const s of [-1,1]){
  const [f,r]=[CITADEL.towers[s<0?0:1],CITADEL.towers[s<0?2:3]];
  // planeWarp faces left of travel: the west side runs front to rear, the east side rear to front.
  const a=s<0?f:r,e=s<0?r:f;
  const L=Math.hypot(e.x-a.x,e.z-a.z),ux=(e.x-a.x)/L,uz=(e.z-a.z)/L;
  // In three runs, each down to its own ground, so the courses step with the cliff.
  for(let k=0;k<3;k++){
   const u0=L*k/3,u1=L*(k+1)/3,b=groundMin(a.x+ux*u0,a.z+uz*u0,a.x+ux*u1,a.z+uz*u1)-1.4;M.ground=b+1.4;
   const w=planeWarp(a.x,a.z,ux,uz);
   M.face(w,u0,u1,b,29,{len:2.1,course:1.12,depth:.6});
   M.slab(w,u0,b,.5,u1-u0,29-b,2.6,M.tint(.85),1,2|4);
  }
  parapet(planeWarp(a.x,a.z,ux,uz),.4,L-.4,29);
 }
 {
  const [w0,e0]=[CITADEL.towers[2],CITADEL.towers[3]],b=groundMin(w0.x,w0.z-1,e0.x,e0.z-1)-1.2,zz=w0.z-1.2;M.ground=b+1.2;
  const {w}=wallFace(w0.x,zz,e0.x,zz,b,27);M.slab(w,0,b,.5,e0.x-w0.x,27-b,2.6,M.tint(.85),1,2|4);parapet(w,.4,e0.x-w0.x-.4,27);
 }
 // The keep: four walls, a turret at each corner, parapets, three tall lancets toward the throne, the great spire.
 {
  const k=CITADEL.keep,x0=k.x-k.hx,x1=k.x+k.hx,z0=k.z+k.hz,z1=k.z-k.hz;
  const faces:[number,number,number,number][]=[[x1,z0,x0,z0],[x0,z1,x1,z1],[x1,z1,x1,z0],[x0,z0,x0,z1]];
  for(const [ax,az,bx,bz] of faces){
   const b=groundMin(ax,az,bx,bz)-1.4;M.ground=b+1.4;
   const {w,L}=wallFace(ax,az,bx,bz,b,k.top);
   M.slab(w,0,b,.5,L,k.top-b-.02,1.2,M.tint(.85),1,4);
   parapet(w,1.6,L-1.6,k.top);
  }
  M.slab((u,v,t)=>[x0+u,v,z1+t],0,k.top-.6,0,2*k.hx,.4,2*k.hz,M.tint(.9),1,4);
  const fw=planeWarp(x1,z0,-1,0);
  windowAt(M,glass,fw,k.hx,k.top-9.5,k.top-6.2,.9,teal);
  for(const s of [-1,1]){windowAt(M,glass,fw,k.hx+s*4.6,k.top-8.4,k.top-6.4,.6,teal);windowAt(M,glass,fw,k.hx+s*4.6,k.top-17,k.top-15.4,.45,violet);}
  halos.push({x:k.x,y:k.top-6,z:z0+.5,size:7,color:'#4fd8c8',power:.22});
  for(const [tx,tz] of [[x0,z0],[x1,z0],[x0,z1],[x1,z1]]){
   const b=h(tx,tz)-1.5;M.ground=b+1.5;const top=k.top+4.4,ring=ringWarp(tx,tz,k.turret,0),C=2*Math.PI*k.turret;
   M.face(ring,0,C,b,top,{len:1.7,course:1.05,depth:.55,curve:.7});
   for(let u=0;u<C-.3;u+=.95)M.block(ring,u,top-.7,-.5,.36,.7,.9,{bevel:.04});
   M.face(ringWarp(tx,tz,k.turret+.45,0),0,2*Math.PI*(k.turret+.45),top,top+1.1,{len:1.6,course:1.1,depth:.6,curve:.7,core:0});
   M.disc(tx,top+1.08,tz,k.turret+.45,16);roofs.push({x:tx,y:top+1.1,z:tz,r:k.turret+.7});
  }
  // The great spire: the citadel's crown and the landmark at the end of the main road.
  crystalCluster(k.x,k.top-.8,k.z,k.spire,8.5,11,rand,ice);
  // Aurora light caught inside the spire, so it glows from the village at the far end of the road.
  for(const [f,sz] of [[.18,16],[.42,13],[.66,9]] as const)halos.push({x:k.x,y:k.top+k.spire*f,z:k.z,size:sz,color:'#46e0c4',power:.3});
 }
 // A glacier has swallowed the west flank: great leaning slabs against the tower and down the cliff.
 for(let i=0;i<9;i++){
  const a=i/8,x=-31-rand()*4-a*2,z=-109-a*22,y=h(x,z);
  ice.push({x,y:y-.5,z,axis:[.35+rand()*.3,1,(rand()-.5)*.4],height:9+rand()*11*(1-a*.4),radius:2.2+rand()*1.4,seed:rand()*97});
  crystalCluster(x+3,y,z+(rand()-.5)*3,4+rand()*5,2.6,4,rand,ice);
 }
 for(let i=0;i<5;i++){const x=31+rand()*3,z=-122-i*4.5,y=h(x,z);crystalCluster(x,y,z,5+rand()*6,2.4,5,rand,ice);}

 // ---- Arena pillars: grown crystal columns on carved granite collars, each crowned round a cold fire.
 for(const p of arenaPillars()){
  const y=h(p.x,p.z);M.ground=y;M.snow=.35;
  const ring=ringWarp(p.x,p.z,1.75,p.a);
  M.face(ring,0,2*Math.PI*1.75,y-.5,y+.95,{len:1.4,course:.72,depth:.5,curve:.6});
  M.disc(p.x,y+.93,p.z,1.3,16,M.tint(.8));
  // The column: one tall prism and two flanking ones, the crown flaring out of its top.
  const top=y+7.2;
  ice.push({x:p.x,y:y+.6,z:p.z,axis:[(rand()-.5)*.04,1,(rand()-.5)*.04],height:top-y-.4,radius:1.0,seed:rand()*97});
  for(let j=0;j<3;j++){const a=p.a+j*2.1+rand()*.4,d=.9+rand()*.3;ice.push({x:p.x+Math.sin(a)*d,y:y+.6,z:p.z+Math.cos(a)*d,axis:[Math.sin(a)*.18,1,Math.cos(a)*.18],height:2.4+rand()*2.6,radius:.42+rand()*.2,seed:rand()*97});}
  for(let j=0;j<7;j++){const a=j/7*Math.PI*2+rand()*.3,tilt=.55+rand()*.25;ice.push({x:p.x+Math.sin(a)*.35,y:top-1.0,z:p.z+Math.cos(a)*.35,axis:[Math.sin(a)*tilt,1,Math.cos(a)*tilt],height:1.6+rand()*.9,radius:.2+rand()*.08,seed:rand()*97});}
  flames.push({x:p.x,y:top-.25,z:p.z,size:1.65,cold:true});halos.push({x:p.x,y:top+.5,z:p.z,size:5,color:'#55eec4',power:.5});
 }

 // ---- Snow banked at the feet of the walls, towers, dais and collars, so the stone stands in the drift.
 {
  const T=CITADEL.towers;
  drifts.push(bank(h,line(-wl.half+4.4,wl.z+.05,-gt.half,wl.z+.05,0,1),1.25,2.6,3),bank(h,line(gt.half,wl.z+.05,wl.half-4.4,wl.z+.05,0,1),1.2,2.6,4));
  drifts.push(bank(h,line(-gt.half,gt.z+.15,gt.half,gt.z+.15,0,1),.9,2.2,5,t=>Math.abs(t-.5)<.3?.25:1));
  for(const s of [-1,1])drifts.push(bank(h,line(s*gt.half+s*.15,gt.z,s*gt.half+s*.15,wl.z,s,0),.8,1.6,6+s));
  for(const tw of T.slice(0,2))drifts.push(bank(h,arc(tw.x,tw.z,tw.r+.5,-2.2,2.2),1.3,2.8,7+tw.x));
  for(const s of [-1,1]){const half=THRONE.tiers[0];drifts.push(bank(h,line(s*(half+.05),THRONE.front-.3,s*(half+.05),THRONE.back+.2,s,0),.55,1.6,9+s));}
  drifts.push(bank(h,line(-THRONE.tiers[0],THRONE.back-.05,THRONE.tiers[0],THRONE.back-.05,0,-1),.6,1.8,12));
  for(const p of arenaPillars())drifts.push(bank(h,arc(p.x,p.z,1.8,p.a-1.9,p.a+1.9),.5,1.4,13+p.i));
 }
 const driftMat=new THREE.MeshStandardMaterial({name:'frostlight-citadel-drift',color:'#e8f2fc',roughness:.9,vertexColors:true});snowMass(driftMat,{lumps:.7});
 const driftMesh=new THREE.Mesh(mergeGeometries(harmonise(drifts),false)!,driftMat);driftMesh.name='frostlight-citadel-drifts';driftMesh.receiveShadow=driftMesh.castShadow=true;

 // ---- Meshes: one granite, one ice, one icicle, one glass, one iron, the fire.
 const granite=new THREE.Mesh(M.geometry(),masonryMaterial('frostlight-citadel-granite'));granite.name='frostlight-citadel-granite';granite.castShadow=granite.receiveShadow=true;
 const iceMesh=new THREE.Mesh(crystalGeometry(ice),opts.ice);iceMesh.name='frostlight-citadel-ice';iceMesh.castShadow=true;
 const icicleMesh=new THREE.Mesh(crystalGeometry(icicles),opts.ice);icicleMesh.name='frostlight-citadel-icicles';
 const glassMesh=glass.mesh('frostlight-aurora-glass');
 const iron=new THREE.MeshStandardMaterial({name:'frostlight-brazier-iron',color:'#3a4048',roughness:.5,metalness:.6,envMapIntensity:0});
 const ironMesh=new THREE.Mesh(mergeGeometries(harmonise([...bowls,...poles]),false)!,iron);ironMesh.name='frostlight-braziers';ironMesh.castShadow=ironMesh.receiveShadow=true;
 const fire=frostFire('frostlight-cold-fire',flames,halos,4417,6);
 root.add(granite,iceMesh,icicleMesh,glassMesh,ironMesh,driftMesh,fire.group);
 root.userData.throne={blocks:M.blocks,crystals:ice.length,icicles:icicles.length,flames:flames.length,pillars:arenaPillars().length,windows:glass.pos.length/3};
 return {root,update(time){fire.update(time);},async dress(){
  const [village,props]=await Promise.all([loadKit('models/world/village.glb'),loadKit('models/world/props.glb')]);
  // Kit materials are shared with other worlds: patched clones only. Boreas's tiles are slate, his cloth night-blue.
  const variants=new Map<string,THREE.Material>();
  /** `night` recolours the banners' cloth and frame to Boreas's night blue. */
  const cold=(m:THREE.Material,night=false)=>{
   const key=m.name+(night?'#night':'');let v=variants.get(key);if(v)return v;v=m.clone();const sm=v as THREE.MeshStandardMaterial;
   if(!/Metal/.test(m.name)){sm.metalness=0;sm.metalnessMap=null;}
   if(!/Cloth/.test(m.name))sm.side=THREE.FrontSide;
   if(m.name==='MI_RoundTiles')stylise(v,.15,[.36,.43,.6]);
   else stylise(v,.5,[.78,.84,.95]);
   snowCover(v,{cover:m.name==='MI_RoundTiles'?1.2:/Cloth/.test(m.name)?1.05:1});
   // The kit's cloth is red in its vertex colour: keep the weave's light and dark, dyed night blue.
   if(night&&/Cloth/.test(m.name))addPatch(v,'frostlight-night-cloth',sh=>{sh.fragmentShader=sh.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\n{float l=dot(diffuseColor.rgb,vec3(.299,.587,.114));diffuseColor.rgb=pow(vec3(l),vec3(.85))*vec3(.3,.52,1.3);}');});
   variants.set(key,v);return v;
  };
  const vo:Record<string,THREE.Material>={},po:Record<string,THREE.Material>={};
  for(const [n,m] of village.materials)vo[n]=cold(m);
  for(const [n,m] of props.materials)po[n]=cold(m,true);
  const roofBatch=new StaticBatch(village,'frostlight-citadel-roofs'),flags=new StaticBatch(props,'frostlight-citadel-banners');
  const R=village.get('Roof_Tower_RoundTiles').box,rb=Math.max(R.max.x-R.min.x,R.max.z-R.min.z)/2;
  roofs.forEach((r,i)=>roofBatch.add('Roof_Tower_RoundTiles',trs(r.x,r.y,r.z,i*1.3,r.r/rb),{override:vo}));
  const B=props.get('Banner_1').box;
  for(const b of banners){const w=(B.max.x-B.min.x)*b.s;flags.add('Banner_1',trs(b.x-Math.cos(b.yaw)*w/2,b.y,b.z+Math.sin(b.yaw)*w/2,b.yaw,b.s),{override:po});}
  const g=new THREE.Group();g.name='frostlight-citadel-kit';g.add(roofBatch.build(),flags.build());
  root.add(g);root.userData.throne.roofs=roofs.length;root.userData.throne.banners=banners.length;
 }};
}
