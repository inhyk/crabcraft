import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {loadKit,StaticBatch,trs} from '../world/kit';
import {addPatch,stylise} from '../world/materials';
import {planeWarp,ringWarp,type V3,type Warp} from './frostMasonry';
import {Glass} from './frostThrone';
import {frostFire,type Flame,type Halo} from './frostFire';
import {DawnMason,dawnMasonryMaterial} from './dawnMasonry';
import {dawnArena} from './dawnArena';
import {CITADEL_APPROACH,CITADEL_ARENA,CITADEL_BRAZIERS,CITADEL_COLONNADE,CITADEL_GATE,CITADEL_KEEP,CITADEL_TOWERS,CITADEL_WALL,SOUTH_RUN,citadelObelisks,colonnadeColumns} from './dawnCitadelLayout';

/*
 * Solarkan's Twilight Citadel: the desert sun temple on Goldsand Harbor's north plateau, taken in the stolen dawn,
 * built in the Egyptian manner. Banded masonry (dawnMasonry.ts: warm sandstone coursed with cream limestone, basalt
 * for accents, gilt strings and emblems), laid block by block: a twin-pylon gateway on the ascent, its battered wings
 * crowned with cavetto cornices, the lintelled portal between them under a winged sun, flagstaffs flying Solarkan's
 * banners and the eclipse carved high on each wing; square battered towers with fire bowls or gilt suns; battered
 * curtain walls with cavetto cornices round a paved temple court; porticoes of papyrus columns inside the side
 * walls; the sanctuary at the north end of the court with the eclipse carved over its portal and the great eclipsed
 * sun on its roof, the landmark from the harbour. Round the sun-dial floor (dawnArena.ts) stand eight basalt sun
 * pillars carrying fire bowls; basalt obelisks with gilt pyramidions line the ascent.
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
/** Candela of each arena fire light. */
const ARENA_FIRE=150;

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

export function dawnCitadel(height:Height):DawnCitadel {
 const h=height,root=new THREE.Group();root.name='dawn-twilight-citadel';
 const rand=stream(30117),M=new DawnMason(rand,3),glass=new Glass();
 // The far mason lays the same citadel as plain slabs, its joints and bands drawn in the shader, past ~110 m.
 const F=new DawnMason(stream(30118),4);F.course=1;M.far=F;
 const flames:Flame[]=[],halos:Halo[]=[],extra:THREE.BufferGeometry[]=[];
 const banners:{x:number;y:number;z:number;yaw:number;s:number}[]=[];
 const G=CITADEL_GATE,W=CITADEL_WALL,K=CITADEL_KEEP,A=CITADEL_ARENA;
 const groundMin=(x0:number,z0:number,x1:number,z1:number)=>{let m=Infinity;for(let i=0;i<=8;i++){const k=i/8;m=Math.min(m,h(x0+(x1-x0)*k,z0+(z1-z0)*k));}return m;};
 /** A straight face from a to b; outward is to the right of travel seen from above (planeWarp). */
 const wallFace=(ax:number,az:number,bx:number,bz:number,v0:number,v1:number,o:Parameters<DawnMason['face']>[5]={})=>{
  const L=Math.hypot(bx-ax,bz-az),w=planeWarp(ax,az,(bx-ax)/L,(bz-az)/L);M.face(w,0,L,v0,v1,{len:2.1,course:1.05,depth:.6,...o});return {w,L};
 };
 const front=(zf:number)=>planeWarp(0,zf,-1,0);
 /**
  * A face with an opening centred at u = mid, `half` wide, `head` high: the near mason lays it block by block round
  * the opening; the far slabs (which know nothing of openings) are laid here in three pieces round it.
  */
 const openFace=(ax:number,az:number,bx:number,bz:number,v0:number,v1:number,mid:number,half:number,head:number,o:Parameters<DawnMason['face']>[5])=>{
  const far=M.far;M.far=null;const r=wallFace(ax,az,bx,bz,v0,v1,o);M.far=far;
  if(far){far.ground=M.ground;far.snow=0;const t=far.tint(1.05),d=.6;
   far.slab(r.w,0,v0,0,mid-half,v1-v0,d,t,1,1|4|32);far.slab(r.w,mid+half,v0,0,r.L-mid-half,v1-v0,d,t,1,1|4|16);far.slab(r.w,mid-half,head,0,2*half,v1-head,d,t,1,1|4|8);}
  return r;
 };
 const box=(x0:number,x1:number,y0:number,y1:number,zf:number,d:number,bevel=.07,tint?:V3)=>M.block(front(zf),-x1,y0,0,x1-x0,y1-y0,d,{bevel,tint,closed:true,far:true});
 /** A gilded piece from a three.js geometry. */
 const gild=(g:THREE.BufferGeometry,ground=0)=>extra.push(asStone(g,[1,1,1],true,ground));
 const basalt=(g:THREE.BufferGeometry,k=.5)=>extra.push(asStone(g,[.03*k*2,.028*k*2,.027*k*2],false,-99));

 /** A dressed monolith: a square block tapering from w0 to w1, flat-faced, its own tint. */
 const mono=(x:number,z:number,y0:number,hgt:number,w0:number,w1:number,yaw:number,tint:V3,ground:number)=>{
  const g=new THREE.CylinderGeometry(w1/Math.SQRT2,w0/Math.SQRT2,hgt,4,1).rotateY(Math.PI/4+yaw).translate(x,y0+hgt/2,z).toNonIndexed();g.computeVertexNormals();
  extra.push(asStone(g,tint,false,ground));
 };
 /** A face of a battered mass: foot a-b at v = v0, top c-d at v = v1, outward (nx, nz). */
 const quad=(ax:number,az:number,bx:number,bz:number,cx:number,cz:number,dx:number,dz:number,nx:number,nz:number,v0:number,v1:number)=>{
  const L=Math.hypot(bx-ax,bz-az),Hh=v1-v0;
  const w:Warp=(u,v,t)=>{const k=clamp01((v-v0)/Hh),f=u/L,px=ax+(bx-ax)*f,pz=az+(bz-az)*f,qx=cx+(dx-cx)*f,qz=cz+(dz-cz)*f;return [px+(qx-px)*k-nx*t,v,pz+(qz-pz)*k-nz*t];};
  return {w,L};
 };
 /** Courses round a rectangle (x xa..xb, z za..zz) grown by p: one step of a cornice. Sides: front +z, right +x, back -z, left -x. */
 const ring=(xa:number,xb:number,za:number,zz:number,v0:number,v1:number,p:number,sides=[1,1,1,1])=>{
  const o={len:1.8,course:v1-v0,depth:.6+p,core:0};
  if(sides[0])wallFace(xb+p,zz+p,xa-p,zz+p,v0,v1,o);
  if(sides[1])wallFace(xb+p,za-p,xb+p,zz+p,v0,v1,o);
  if(sides[2])wallFace(xa-p,za-p,xb+p,za-p,v0,v1,o);
  if(sides[3])wallFace(xa-p,zz+p,xa-p,za-p,v0,v1,o);
 };
 /** The cavetto cornice: three courses flaring out (the top one limestone) and the flat roof over them. */
 const cornice=(xa:number,xb:number,za:number,zz:number,v:number)=>{
  ring(xa,xb,za,zz,v,v+.42,.18);ring(xa,xb,za,zz,v+.42,v+.84,.45);M.stone='pale';ring(xa,xb,za,zz,v+.84,v+1.4,.78);M.stone=null;
  M.slab((u,vv,t)=>[xa-.78+u,vv,za-.78+t],0,v+1.1,0,xb-xa+1.56,.28,zz-za+1.56,M.paleTint(.95),1,4);
 };
 /** A limestone roll moulding from p to q (the corner tori and the band under each cornice). */
 const roll=(px:number,py:number,pz:number,qx:number,qy:number,qz:number,r=.2)=>{
  const d=new THREE.Vector3(qx-px,qy-py,qz-pz),len=d.length(),g=new THREE.CylinderGeometry(r,r,len,10,1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize())).translate((px+qx)/2,(py+qy)/2,(pz+qz)/2);
  extra.push(asStone(g,M.paleTint(1.05),false,py));
 };
 /**
  * A battered block in the Egyptian manner: its top the rectangle xa..xb, za..zz at `top`, each side (front +z,
  * right +x, back -z, left -x) leaning out by bat[i] to the foot at b and laid from from[i] up; the roof, the
  * cavetto cornice, tori up the corners and round the top. Returns the four faces.
  */
 const battered=(xa:number,xb:number,za:number,zz:number,b:number,top:number,bat:readonly number[],from:readonly number[])=>{
  const fx0=xa-bat[3],fx1=xb+bat[1],fz0=za-bat[2],fz1=zz+bat[0];
  const faces=[quad(fx0,fz1,fx1,fz1,xa,zz,xb,zz,0,1,b,top),quad(fx1,fz1,fx1,fz0,xb,zz,xb,za,1,0,b,top),quad(fx1,fz0,fx0,fz0,xb,za,xa,za,0,-1,b,top),quad(fx0,fz0,fx0,fz1,xa,za,xa,zz,-1,0,b,top)];
  faces.forEach(({w,L},i)=>{if(from[i]<top-.5)M.face(w,0,L,from[i],top,{len:2.9,course:1.2,depth:.75,quoins:1.5});});
  M.slab((u,v,t)=>[xa+u,v,za+t],0,top-.5,0,xb-xa,.5,zz-za,M.tint(.85),1,4);
  cornice(xa,xb,za,zz,top);
  const k=1.2/(top-b),corner:[number,number,number,number,number,number][]=[[fx1,fz1,xb,zz,0,1],[fx1,fz0,xb,za,1,2],[fx0,fz0,xa,za,2,3],[fx0,fz1,xa,zz,3,0]];
  for(const [px,pz,qx,qz,i,j] of corner)if(from[i]<=b+.01&&from[j]<=b+.01)roll(px+(qx-px)*k,b+1.2,pz+(qz-pz)*k,qx,top,qz);
  roll(xa-.1,top-.12,zz+.06,xb+.1,top-.12,zz+.06);roll(xb+.06,top-.12,za-.1,xb+.06,top-.12,zz+.1);roll(xa-.1,top-.12,za-.06,xb+.1,top-.12,za-.06);roll(xa-.06,top-.12,za-.1,xa-.06,top-.12,zz+.1);
  return faces;
 };
 /** A small deep window: an ember-lit pane in a proud limestone frame (jambs, lintel, sill). */
 const slot=(w:Warp,u:number,v0:number,v1:number,wd:number)=>{
  const P=(uu:number,vv:number)=>w(uu,vv,-.07),c=(vv:number):V3=>{const k=1.25-.5*clamp01((vv-v0)/(v1-v0));return [EMBER[0]*k,EMBER[1]*k,EMBER[2]*k];};
  for(const [a,bq,cq] of [[[u-wd/2,v0],[u+wd/2,v0],[u+wd/2,v1]],[[u-wd/2,v0],[u+wd/2,v1],[u-wd/2,v1]]] as [number,number][][])for(const [uu,vv] of [a,bq,cq]){glass.pos.push(...P(uu,vv));glass.col.push(...c(vv));}
  M.stone='pale';
  for(const sx of [-1,1])M.block(w,sx<0?u-wd/2-.3:u+wd/2,v0-.05,-.16,.3,v1-v0+.1,.46,{bevel:.04,closed:true});
  M.block(w,u-wd/2-.42,v1+.05,-.2,wd+.84,.34,.5,{bevel:.04,closed:true});M.block(w,u-wd/2-.36,v0-.32,-.2,wd+.72,.27,.5,{bevel:.04,closed:true});
  M.stone=null;
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

 /** Geometries built round the origin, then leaned by `tilt` (about x), turned by `yaw` and placed at (cx, cy, cz). */
 const place=(geos:{g:THREE.BufferGeometry;gilt:boolean;k?:number}[],cx:number,cy:number,cz:number,tilt=0,yaw=0)=>{
  const m=new THREE.Matrix4().makeTranslation(cx,cy,cz).multiply(new THREE.Matrix4().makeRotationY(yaw)).multiply(new THREE.Matrix4().makeRotationX(tilt));
  for(const {g,gilt,k} of geos){g.applyMatrix4(m);if(gilt)gild(g,cy-10);else basalt(g,k);}
 };
 /** The eclipsed sun as a relief on a south face at zf: gilt disc, sixteen rays (alternately flame-waved), rim and the basalt moon. */
 const emblem=(cx:number,cy:number,zf:number,R:number,tilt=0,yaw=0)=>{
  const rot=(g:THREE.BufferGeometry)=>g.rotateX(Math.PI/2),out:{g:THREE.BufferGeometry;gilt:boolean;k?:number}[]=[];
  out.push({g:rot(new THREE.CylinderGeometry(R,R,.18,48)).translate(0,0,.09),gilt:true});
  out.push({g:new THREE.TorusGeometry(R*1.04,.08*R,8,56).translate(0,0,.18),gilt:true});
  for(let k=0;k<16;k++){
   const a=k/16*Math.PI*2,len=(k%2?.42:.7)*R,wide=(k%2?.1:.14)*R,sh=new THREE.Shape();
   // A wavy flame ray or a straight one, as a flat gilt blade.
   if(k%2){sh.moveTo(-wide,0);sh.bezierCurveTo(-wide*.2,len*.3,-wide*1.2,len*.6,0,len);sh.bezierCurveTo(wide*.4,len*.6,wide*1.1,len*.35,wide,0);}
   else{sh.moveTo(-wide,0);sh.lineTo(0,len);sh.lineTo(wide,0);}
   sh.closePath();
   const g=new THREE.ExtrudeGeometry(sh,{depth:.12,bevelEnabled:true,bevelThickness:.03,bevelSize:.025,bevelSegments:1,curveSegments:6});
   out.push({g:g.translate(0,R*1.06,0).rotateZ(-a).translate(0,0,.02),gilt:true});
  }
  out.push({g:rot(new THREE.CylinderGeometry(R*.9,R*.9,.24,48)).translate(R*.26,R*.16,.3),gilt:false,k:.45});
  place(out,cx,cy,zf,tilt,yaw);
  // The corona where the moon lets the sun through.
  const sz=Math.cos(yaw);
  halos.push({x:cx-R*.55*sz,y:cy-R*.32,z:zf+.9*sz,size:R*3.4,color:'#ffae4a',power:.42},{x:cx,y:cy,z:zf+.6*sz,size:R*5,color:'#ff8a3a',power:.16});
 };
 /** The winged sun over a portal: the eclipsed disc between two great spread wings of layered gilt feathers. */
 const wingedSun=(cx:number,cy:number,zf:number,R:number,yaw=0)=>{
  const out:{g:THREE.BufferGeometry;gilt:boolean;k?:number}[]=[];
  out.push({g:new THREE.CylinderGeometry(R,R,.2,40).rotateX(Math.PI/2).translate(0,0,.1),gilt:true});
  out.push({g:new THREE.CylinderGeometry(R*.84,R*.84,.26,40).rotateX(Math.PI/2).translate(R*.22,R*.14,.22),gilt:false,k:.45});
  for(const s of [-1,1])for(let layer=0;layer<3;layer++){
   // Each layer a row of feathers, shorter toward the front, so the wing reads in three tiers.
   const sh=new THREE.Shape(),span=R*(4.3-layer*.9),y0=R*(.42-layer*.28),n=7-layer*2,x=(v:number)=>s*v;
   sh.moveTo(x(R*.95),y0);sh.quadraticCurveTo(x(span*.6),y0+R*.32,x(span),y0+R*.12);
   for(let i=0;i<=n;i++){const t=1-i/n,fx=R*.95+(span-R*.95)*t,fy=y0-R*(.34+.22*(1-t));sh.lineTo(x(fx+R*.12),fy+R*.1);sh.lineTo(x(fx),fy);}
   sh.lineTo(x(R*.95),y0-R*.36);sh.closePath();
   const g=new THREE.ExtrudeGeometry(sh,{depth:.08,bevelEnabled:true,bevelThickness:.02,bevelSize:.02,bevelSegments:1,curveSegments:5});
   out.push({g:g.translate(0,0,.04+layer*.07),gilt:true});
  }
  place(out,cx,cy,zf,0,yaw);
  halos.push({x:cx,y:cy,z:zf+.7*Math.cos(yaw),size:R*4.2,color:'#ffae4a',power:.3});
 };

 // ---- The pylon gateway: two battered wings with cavetto cornices, a lower portal between them under a winged sun,
 // flagstaffs with Solarkan's banners before the wings and the eclipse carved high on each.
 {
  const g0=h(0,G.front),bat=G.batter,top=G.top,apex=g0+G.apex,ptop=g0+G.portal,x0=G.open+1.1,zf=G.front,zb=G.back;
  const b=groundMin(-G.half-bat,zf+bat,G.half+bat,zf+bat)-1.2,H=top-b;
  M.ground=g0;
  M.ground=g0;
  for(const s of [-1,1]){
   const xi=s*x0,xo=s*G.half,lo=Math.min(xi,xo),hi=Math.max(xi,xo);
   battered(lo,hi,zb,zf,b,top,s>0?[bat,bat,bat,0]:[bat,0,bat,bat],s>0?[b,b,b,ptop-.4]:[b,ptop-.4,b,b]);
   // The eclipse carved high on the wing, leaning with the batter.
   const ey=top-6.4,eo=bat*(1-(ey-b)/H);
   emblem(s*(x0+G.half)/2,ey,zf+eo,1.9,-Math.atan(bat/H));
   // Flagstaffs before the wing, gilt, each flying a long banner.
   for(const px of [s*(x0+1.15),s*(G.half-.9)]){
    const pz=zf+bat+.45,py=h(px,pz)-.3;
    extra.push(asStone(new THREE.CylinderGeometry(.1,.15,top+4.2-py,8).translate(px,(py+top+4.2)/2,pz),[1,1,1],.7,py));
    gild(new THREE.SphereGeometry(.24,10,8).translate(px,top+4.35,pz),py);
    extra.push(asStone(new THREE.CylinderGeometry(.05,.05,1.9,6).rotateZ(Math.PI/2).translate(px,top+3.35,pz+.12),[1,1,1],.7,py));
    banners.push({x:px,y:top+3.3,z:pz+.18,yaw:0,s:2.3});
   }
  }
  // The portal: jambs and lintel between the wings, limestone above the opening, its own cornice and the winged sun.
  for(const zz of [zf,zb]){
   const south=zz===zf,ax=south?x0:-x0,bx=-ax;
   openFace(ax,zz,bx,zz,b,apex,x0,G.open,apex,{len:1.6,course:.95,depth:.7,quoins:.9,skip:(u,v)=>Math.abs(u-x0)<G.open&&v<apex});
   M.stone='pale';wallFace(ax,zz,bx,zz,apex,ptop,{len:2.2,course:(ptop-apex)/3,depth:.7});M.stone=null;
   wingedSun(0,(apex+ptop)/2+.1,zz+(south?.08:-.08),.95,south?0:Math.PI);
  }
  M.slab((u,v,t)=>[-x0+u,v,zb+t],0,ptop-.5,0,2*x0,.5,zf-zb,M.tint(.85),1,4);
  cornice(-x0,x0,zb,zf,ptop);
  // The passage: limestone reveals, a stone ceiling, the bronze portcullis raised into it.
  for(const s of [-1,1]){M.stone='pale';M.face(planeWarp(s*G.open,s>0?zf:zb,0,s>0?-1:1),0,zf-zb,b,apex,{len:1.6,course:.9,depth:.4});M.stone=null;}
  M.slab((u,v,t)=>[-G.open+u,v,zb+t],0,apex-.1,0,2*G.open,.4,zf-zb,M.tint(.6),1,8);
  for(let i=0;i<=8;i++){const x=-G.open+.2+(2*G.open-.4)*i/8;extra.push(asStone(new THREE.BoxGeometry(.11,2.6,.11).translate(x,apex-1.45,(zf+zb)/2+.6),[1,1,1],.7,g0));}
  for(let j=0;j<3;j++)extra.push(asStone(new THREE.BoxGeometry(2*G.open-.2,.1,.13).translate(0,apex-2.5+j*.9,(zf+zb)/2+.6),[1,1,1],.7,g0));
  for(let i=0;i<=8;i++){const x=-G.open+.2+(2*G.open-.4)*i/8;gild(new THREE.ConeGeometry(.09,.32,4).rotateX(Math.PI).translate(x,apex-2.92,(zf+zb)/2+.6),g0);}
 }
 // ---- Towers: square and battered, the corners crowned with fire, the mid towers with a sun on a stem.
 CITADEL_TOWERS.forEach(t=>{
  const {x,z,r:a,top}=t,bat=.9,b=groundMin(x-a-bat,z,x+a+bat,z)-1.4;M.ground=b+1.4;
  const faces=battered(x-a,x+a,z-a,z+a,b,top,[bat,bat,bat,bat],[b,b,b,b]);
  const out=[x>0?1:3,...(z>-60?[0]:z<-90?[2]:[])];
  for(const i of out){const {w,L}=faces[i];slot(w,L/2,top-6.4,top-4.6,.5);slot(w,L/2,top-13,top-11.6,.34);
   const nx=i===1?1:i===3?-1:0,nz=i===0?1:i===2?-1:0;banners.push({x:x+nx*(a+.3),y:top-.5,z:z+nz*(a+.3),yaw:Math.atan2(nx,nz),s:1.7});}
  const y=top+1.4;
  if(t.crown==='fire'){
   // A great gilt fire bowl on a limestone drum, the fire seen from the town.
   mono(x,z,y,.9,2.6,2.3,0,M.paleTint(),y);
   gild(new THREE.LatheGeometry([[0,0],[.5,.02],[.95,.2],[1.55,.55],[1.85,.88],[1.9,.98],[1.75,1.0],[.5,.7],[0,.7]].map(([p,q])=>new THREE.Vector2(p,q)),24).translate(x,y+.9,z),y);
   flames.push({x,y:y+2,z,size:3.4,cold:false},{x:x+.7,y:y+1.7,z:z+.4,size:2.2,cold:false},{x:x-.6,y:y+1.7,z:z-.5,size:2.4,cold:false});
   halos.push({x,y:y+3,z,size:11,color:'#ff9a3c',power:.5});
  }else{mono(x,z,y,1.1,2.2,1.8,0,M.paleTint(),y);finial(x,y+1.1,z,1.25);}
 });
 // ---- Curtain walls: a battered banded outer face, the inner face, the walk between, the cavetto cornice outside.
 {
  const run=(ax:number,az:number,bx:number,bz:number)=>{
   const L=Math.hypot(bx-ax,bz-az),ux=(bx-ax)/L,uz=(bz-az)/L,nx=uz,nz=-ux;
   const b=groundMin(ax,az,bx,bz)-1.2;M.ground=b+1.2;
   // The outer face leans out to its foot (a metre of batter), the walk and parapet stand plumb above.
   const w=planeWarp(ax,az,ux,uz),wb:Warp=(u,v,t)=>w(u,v,t-.95*clamp01((W.top-2.2-v)/(W.top-2.2-b)));
   M.face(wb,0,L,b,W.top,{len:2.1,course:1.05,depth:.6});
   // The inner face, the court side, three metres in.
   const ix=ax-nx*W.thick,iz=az-nz*W.thick,jx=bx-nx*W.thick,jz=bz-nz*W.thick;
   const bi=groundMin(ix,iz,jx,jz)-1.2;M.ground=bi+1.2;
   wallFace(jx,jz,ix,iz,bi,W.top+1.4,{len:2.4,course:1.12});
   // The cavetto cornice along the outer face, a torus under it, and the flat walk over the whole thickness.
   for(const [p,v0,v1] of [[.18,W.top,W.top+.42],[.45,W.top+.42,W.top+.84],[.78,W.top+.84,W.top+1.4]] as const){if(p>.7)M.stone='pale';M.face((u,v,t)=>w(u,v,t-p),0,L,v0,v1,{len:1.8,course:v1-v0,depth:.6+p,core:0});M.stone=null;}
   M.slab(w,0,W.top+1.1,-.78,L,.3,W.thick+.78,M.paleTint(.95),1,4);
   {const [px,,pz]=w(0,0,-.06),[qx,,qz]=w(L,0,-.06);roll(px,W.top-.12,pz,qx,W.top-.12,qz);}
   // Small deep windows, lit.
   for(let u=3.2;u<L-3;u+=6.4)slot(wb,u,W.top-5.6,W.top-4.4,.32);
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
 // ---- Porticoes along the inside of the side walls: sandstone columns with gilt-necked papyrus capitals carrying
 // a limestone architrave that roofs the walk back to the wall, a shaded colonnade either side of the court.
 {
  const C=CITADEL_COLONNADE,cols=colonnadeColumns();
  for(const s of [-1,1]){
   const run=cols.filter(c=>Math.sign(c.x)===s),top=Math.max(...run.map(c=>h(c.x,c.z)))+C.h;
   for(const c of run){
    const y=h(c.x,c.z)-.3,ht=top-y;M.ground=y+.3;
    const prof=[[0,0],[.78,0],[.78,.22],[.66,.3],[.6,.4],[.56,.62],[.55,ht*.5],[.48,ht-1.25],[.5,ht-1.18],[.5,ht-1.06],[.47,ht-1.0],[.66,ht-.62],[.8,ht-.36],[.84,ht-.28],[.55,ht-.24],[0,ht-.24]].map(([a,b])=>new THREE.Vector2(a,b));
    extra.push(asStone(new THREE.LatheGeometry(prof,16).translate(c.x,y,c.z),M.tint(1.05),false,y+.3));
    gild(new THREE.TorusGeometry(.5,.06,6,20).rotateX(Math.PI/2).translate(c.x,y+ht-1.12,c.z),y);
    mono(c.x,c.z,top-.26,.3,1.2,1.2,0,M.paleTint(),y+.3);
   }
   // The architrave over the columns, deep enough to roof the walk to the wall, and a cornice along its face.
   const xf=s*(C.x-.62),depth=W.side-W.thick-C.x+.62+.2,za=C.z0+1.4,zb=C.z1-1.4,M0=planeWarp(xf,s>0?za:zb,0,s>0?-1:1);
   M.ground=top-C.h;M.stone='pale';
   M.face(M0,0,za-zb,top+.04,top+.86,{len:C.step,course:.82,depth,core:0});
   M.gilt=true;M.block(M0,.1,top+.86,-.05,za-zb-.2,.12,.2,{bevel:.02,seg:6});M.gilt=false;
   M.face(planeWarp(xf-s*.3,s>0?za+.3:zb-.3,0,s>0?-1:1),0,za-zb+.6,top+.98,top+1.38,{len:2.2,course:.4,depth:depth+.3,core:0});
   M.stone=null;
  }
 }
 // ---- The keep: Solarkan's sanctuary, battered on three sides, its plumb front toward the arena with a lintelled
 // portal under a winged sun, the eclipse carved above, and on its roof the great eclipsed sun the harbour sees.
 {
  const x0=K.x-K.hx,x1=K.x+K.hx,zs=K.z+K.hz,zn=K.z-K.hz,bat=.8;
  const g0=h(K.x,zs),b=groundMin(x0-bat,zn-bat,x1+bat,zs)-1.4,door={half:2.1,top:g0+6.6};
  M.ground=b+1.4;
  battered(x0,x1,zn,zs,b,K.top,[0,bat,bat,bat],[K.top,b,b,b]);
  M.ground=g0;
  const {w:fw}=openFace(x1,zs,x0,zs,b,K.top,K.hx,door.half+.5,door.top+.6,{quoins:1.4,skip:(u,v)=>Math.abs(K.hx-u)<door.half+.5&&v<door.top+.6});
  // The portal: limestone jambs and lintel proud of the face, a small cornice, the winged sun over it.
  const zz=zs+.1;M.stone='pale';
  for(const s of [-1,1])for(let v=g0-.4,k=0;v<door.top-.05;k++){const hh=Math.min(.95,door.top-v);M.block(front(zz),-(s>0?door.half+.9:-door.half),v,-.1,.9,hh-.04,.8,{bevel:.05,closed:true});v+=hh;}
  M.block(front(zz),-(door.half+1.1),door.top,-.12,2*door.half+2.2,1.0,.9,{bevel:.06,closed:true,far:true});
  M.block(front(zz),-(door.half+1.3),door.top+1.0,-.3,2*door.half+2.6,.3,1.1,{bevel:.04,closed:true});
  M.block(front(zz),-(door.half+1.45),door.top+1.3,-.45,2*door.half+2.9,.32,1.25,{bevel:.04,closed:true});
  M.stone=null;
  wingedSun(0,door.top+.5,zz+.12,.42);
  M.slab(front(zs-1.4),-door.half,g0-.5,0,2*door.half,door.top-g0+.5,.2,M.tint(.35),1,1);
  for(const s of [-1,1])M.slab(planeWarp(s*door.half,s>0?zs:zs-1.4,0,s>0?-1:1),0,g0-.5,0,1.4,door.top-g0+.5,.3,M.tint(.55),1,1);
  M.slab(front(zs),-door.half,door.top-.05,0,2*door.half,.3,1.4,M.tint(.5),1,8);
  for(const s of [-1,1]){
   const lh=door.top-g0+.1,lx=s*(door.half/2),lz=zs-1.25;
   extra.push(asStone(new THREE.BoxGeometry(door.half-.06,lh,.14).translate(lx,g0+lh/2-.1,lz),[1,1,1],.7,g0));
   // Gilt bands across the leaf and a grid of studs.
   for(const f of [.18,.5,.82])gild(new THREE.BoxGeometry(door.half-.16,.12,.05).translate(lx,g0-.1+lh*f,lz+.09),g0);
   for(let i=0;i<3;i++)for(let j=0;j<5;j++)gild(new THREE.SphereGeometry(.055,6,4).translate(lx+(i-1)*door.half*.28,g0-.1+lh*(.3+j*.1)+(j>1?lh*.06:0),lz+.1),g0);
  }
  M.stone='pale';for(let k=0;k<2;k++)box(-door.half-1.4+k*.5,door.half+1.4-k*.5,g0-.6,g0+.18+k*.2,zs+1.6-k*.7,1.6,.05);M.stone=null;
  // Windows either side, the eclipse carved above the portal.
  for(const s of [-1,1]){slot(fw,K.hx+s*6,g0+9,g0+11.6,.55);slot(fw,K.hx+s*6,K.top-6.4,K.top-4.6,.42);}
  emblem(0,K.top-11,zs,2.9);
  // The great sun on the roof: a stepped limestone base, a cradle, the eclipsed disc carved on both faces.
  const y=K.top+1.4,R=4.4;M.ground=y;
  mono(K.x,K.z,y,1.1,9,8.4,0,M.paleTint(),y);mono(K.x,K.z,y+1.1,.9,6.4,6,0,M.paleTint(1.05),y);mono(K.x,K.z,y+2,1.2,2.6,1.9,0,M.tint(),y);
  const cy=y+3.2+R*.98;
  emblem(K.x,cy,K.z+.2,R);emblem(K.x,cy,K.z-.2,R,0,Math.PI);
  halos.push({x:K.x,y:cy,z:K.z,size:30,color:'#ffb060',power:.2});
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
  const plinth=(x:number,z:number,y:number,w:number,yaw:number)=>{mono(x,z,y-.6,1.02,w+.7,w+.62,yaw,M.paleTint(),y);mono(x,z,y+.42,.5,w+.26,w+.2,yaw,M.paleTint(1.05),y);};
  for(const o of citadelObelisks()){
   const y=h(o.x,o.z);M.ground=y;const yaw=-o.a;
   plinth(o.x,o.z,y,1.5,yaw);
   // Three basalt drums, polished, a fine joint between each.
   for(let k=0;k<3;k++)mono(o.x,o.z,y+.92+k*2.14,2.11,1.5-k*.1,1.4-k*.1,yaw,M.basaltTint(1.1),y);
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
   mono(x,z,y+.92,7.24,1.15,.72,0,M.basaltTint(1.2),y);
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

 // ---- Meshes: one stone (near and far by LOD), one window glass, the fire; the dial and the court.
 const stoneMat=dawnMasonryMaterial('dawn-citadel-stone');
 const nearGeo=mergeGeometries([M.geometry(),...extra],false)!;nearGeo.computeBoundingSphere();
 const farGeo=mergeGeometries([F.geometry(),...extra],false)!;farGeo.computeBoundingSphere();
 const lodAt=new THREE.Vector3(0,26,-78),lod=new THREE.LOD();lod.name='dawn-citadel-lod';lod.position.copy(lodAt);
 const near=new THREE.Mesh(nearGeo,stoneMat);near.name='dawn-citadel-stone';near.castShadow=near.receiveShadow=true;near.position.copy(lodAt).negate();
 const far=new THREE.Mesh(farGeo,stoneMat);far.name='dawn-citadel-stone-far';far.castShadow=far.receiveShadow=true;far.position.copy(lodAt).negate();
 lod.addLevel(near,0);lod.addLevel(far,112);
 const glassMesh=glass.mesh('dawn-citadel-ember-glass');
 const fire=frostFire('dawn-citadel-fire',flames,halos,9137,6);
 const arena=dawnArena(h);
 root.add(lod,glassMesh,arena.court,fire.group);
 // Two of the sun pillars' fire bowls (the pair across the dial's middle) as real lights: the court lies in the
 // citadel's shadow at this low sun, and the fire is what warms its stone, half the floor each, flickering.
 const fireLights=citadelObelisks().filter(o=>o.i===4||o.i===5).map(o=>{
  const l=new THREE.PointLight('#ffa957',ARENA_FIRE,36,1.5);l.name='dawn-arena-fire';l.position.set(o.x*.93,h(o.x,o.z)+9.4,o.z);root.add(l);return l;
 });
 root.userData.citadel={blocks:M.blocks,nearTriangles:nearGeo.index!.count/3,farTriangles:farGeo.index!.count/3,gilt:extra.length,towers:CITADEL_TOWERS.length,columns:colonnadeColumns().length,flames:flames.length,obelisks:citadelObelisks().length,windows:glass.pos.length/3};
 return {root,floor:arena.floor,update(time,quality){fire.update(time);arena.update(time,quality);
  // Low quality drops the two fire lights (every lit pixel in the world would pay for them).
  for(let i=0;i<fireLights.length;i++){const l=fireLights[i];l.visible=quality==='high';l.intensity=ARENA_FIRE*(1+.07*Math.sin(time*7.3+i*2.1)+.05*Math.sin(time*12.9+i));}
  // Low quality swaps to the far slabs (joints drawn, a seventh of the triangles) at half the distance.
  lod.levels[1].distance=quality==='low'?56:112;},async dress(){
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
