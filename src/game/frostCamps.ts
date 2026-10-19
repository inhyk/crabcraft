import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {crystalCluster,crystalGeometry,type Crystal} from './iceCrystals';
import {harmonise,loadKit,StaticBatch,trs} from '../world/kit';
import {addPatch,plankMaterial,stylise} from '../world/materials';
import {lathe} from '../world/geom';
import {snowCover,snowMass} from './snowCover';
import {frostFire,type Flame,type Halo} from './frostFire';
import {Masonry,masonryMaterial,ringWarp,type V3,type Warp} from './frostMasonry';
import {arc,bank,Glass,line} from './frostThrone';
import {logGeometry,logMaterial} from './snowVillage';
import {OVERLOOK,PROCESSION,RIDGE,ridgeStones,SHELTER} from './frostThroneLayout';

/*
 * The three places "Charting the Aurora" sends the player, and the way to the throne past the aurora seals:
 * a hunter's lean-to of logs in the Frostpine Woods with its banked fire, woodpile and loaded sled; a carved
 * parapet on the eastern ice ledge with a brass spyglass trained on the frozen sea; a ring of rune-cut standing
 * stones on the northern ridge, with an observer's armillary and telescope; and frozen standards and two gate
 * obelisks along the road's last stretch. Kit props (CC0, see NOTICE.md) under the same snow as the village.
 * Each quest point stays open: nothing solid within 4 m of it (frostThroneLayout.ts holds the colliders).
 */

type Height=(x:number,z:number)=>number;
export interface FrostCamps {group:THREE.Group;update(time:number):void}

function stream(seed:number){let s=seed>>>0;return()=>(s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296;}
const V=(x:number,y:number,z:number)=>new THREE.Vector3(x,y,z);

export async function frostCamps(opts:{height:Height;ice:THREE.Material}):Promise<FrostCamps>{
 const h=opts.height,rand=stream(5151);
 const [props,nature]=await Promise.all([loadKit('models/world/props.glb'),loadKit('models/world/nature.glb')]);
 const group=new THREE.Group();group.name='frostlight-aurora-sites';
 // Kit materials are shared with other worlds: patched clones, snowed like the village's.
 const variants=new Map<string,THREE.Material>();
 const snowy=(m:THREE.Material,night=false)=>{
  const key=m.name+(night?'#night':'');let v=variants.get(key);if(v)return v;v=m.clone();const sm=v as THREE.MeshStandardMaterial;
  if(!/Metal/.test(m.name)){sm.metalness=0;sm.metalnessMap=null;}
  if(!/Cloth|Leaves/.test(m.name))sm.side=THREE.FrontSide;
  stylise(v,m.name==='Rocks'||m.name==='PathRocks'?.4:.98,m.name==='Rocks'||m.name==='PathRocks'?[.74,.78,.86]:[1.0,.99,.98]);
  snowCover(v,{cover:/Cloth/.test(m.name)?1.1:1});
  if(night&&/Cloth/.test(m.name))addPatch(v,'frostlight-night-cloth',sh=>{sh.fragmentShader=sh.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\n{float l=dot(diffuseColor.rgb,vec3(.299,.587,.114));diffuseColor.rgb=pow(vec3(l),vec3(.85))*vec3(.42,.7,1.7);}');});
  variants.set(key,v);return v;
 };
 const po:Record<string,THREE.Material>={},pn:Record<string,THREE.Material>={},no:Record<string,THREE.Material>={};
 for(const [n,m] of props.materials){po[n]=snowy(m);pn[n]=snowy(m,true);}
 for(const [n,m] of nature.materials)no[n]=snowy(m);
 const kit=new StaticBatch(props,'frostlight-sites-props'),rocks=new StaticBatch(nature,'frostlight-sites-rocks');
 const M=new Masonry(rand),glass=new Glass(),ice:Crystal[]=[],drifts:THREE.BufferGeometry[]=[];
 const flames:Flame[]=[],halos:Halo[]=[];
 const logs:THREE.BufferGeometry[]=[],charred:THREE.BufferGeometry[]=[],planks:THREE.BufferGeometry[]=[],iron:THREE.BufferGeometry[]=[],brass:THREE.BufferGeometry[]=[],snowCaps:THREE.BufferGeometry[]=[];
 const LOG=logGeometry(),X=V(1,0,0);
 /** A round log from a to b (the village's bark and sawn rings). */
 const log=(a:THREE.Vector3,b:THREE.Vector3,r:number,out=logs)=>{const d=b.clone().sub(a),l=d.length();const g=LOG.clone().scale(l,r/.15,r/.15);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(X,d.normalize()).multiply(new THREE.Quaternion().setFromAxisAngle(X,rand()*6.28)));g.translate((a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2);out.push(g);};
 const rod=(a:THREE.Vector3,b:THREE.Vector3,r:number,out:THREE.BufferGeometry[])=>{const d=b.clone().sub(a),l=d.length();const g=new THREE.CylinderGeometry(r,r,l,8).rotateZ(-Math.PI/2);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(X,d.normalize()));g.translate((a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2);out.push(g);};
 const lantern=(x:number,y:number,z:number,yaw:number,s=.75)=>{const m=trs(x,y,z,yaw,s);kit.add('Lantern_Wall',m,{override:po,castShadow:false});const c=V(0,.55,1.1).applyMatrix4(m);
  flames.push({x:c.x,y:c.y-.12,z:c.z,size:.32*s/.75,cold:false});halos.push({x:c.x,y:c.y,z:c.z,size:2.2*s/.75,color:'#ffb257',power:.6});};

 // ---- The hunter's lean-to: posts, beams, a roof of logs under a cap of snow, one side walled, open to the fire.
 {
  const S=SHELTER,sy=Math.sin(S.yaw),cy=Math.cos(S.yaw);
  const W=(lx:number,lz:number)=>[S.x+cy*lx+sy*lz,S.z-sy*lx+cy*lz] as const;
  const P=(lx:number,dy:number,lz:number)=>{const [x,z]=W(lx,lz);return V(x,h(x,z)+dy,z);};
  const hw=S.width/2-.1,d=S.depth;
  const posts=[[-hw,0,2.45],[hw,0,2.45],[-hw,-d,1.05],[hw,-d,1.05]] as const;
  for(const [lx,lz,ht] of posts){const b=P(lx,-.3,lz),t=P(lx,ht,lz);log(b,t,.13);}
  const fl=P(-hw-.3,2.35,.05),fr=P(hw+.3,2.35,.05),bl=P(-hw-.3,.95,-d),br=P(hw+.3,.95,-d);
  // Front beam and back beam, a little proud of the posts.
  log(fl,fr,.14);log(bl,br,.12);
  // Roof logs from the front beam down to the back beam, overhanging both.
  const nR=19;
  for(let i=0;i<nR;i++){const t=i/(nR-1),a=fl.clone().lerp(fr,t).add(V(0,.2,0)),b=bl.clone().lerp(br,t).add(V(0,.18,0));const dir=b.clone().sub(a).normalize();log(a.clone().addScaledVector(dir,-.35),b.clone().addScaledVector(dir,.3),.115+rand()*.02);}
  // The windward side: logs laid between the posts up to the roof line.
  for(let k=0;k<7;k++){const y=.18+k*.31,fA=P(-hw-.02,y,.05),bA=P(-hw-.02,Math.min(y,.95),-d);if(y>.95){const t=(y-.95)/(2.35-.95);bA.copy(P(-hw-.02,y,-d*(1-t)));}log(fA,bA,.13);}
  // Snow cap over the roof: thick on the slope, rolled over the front and the open side, thinning at the ends.
  {
   const nu=24,nv=10,pos:number[]=[],idx:number[]=[],occ:number[]=[];
   for(let j=0;j<=nv;j++)for(let i=0;i<=nu;i++){
    // v runs from a lip past the front beam (negative) to the back beam; the lip rolls over and down.
    const u=i/nu,v=-.2+1.2*j/nv,a=fl.clone().lerp(fr,u).lerp(bl.clone().lerp(br,u),Math.max(v,0)),edge=Math.min(u,1-u,1-v)*5,k=Math.min(1,edge);
    const lump=.16+.12*Math.sin(u*17+rand()*.3)*Math.sin(v*9+1.3);
    if(v<0){const f=-v/.2,out=W(0,1);a.x+=(out[0]-S.x)*.38*f;a.z+=(out[1]-S.z)*.38*f;a.y+=.33-.55*f*f;}
    else a.y+=.33+lump*k-(1-k)*.12;
    pos.push(a.x,a.y,a.z);const o=.82+.18*k;occ.push(o,o,o);
   }
   for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){const a=j*(nu+1)+i,b=a+1,c=a+nu+1,dd=c+1;idx.push(a,c,b,b,c,dd);}
   const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(occ,3));g.setIndex(idx);g.computeVertexNormals();
   const n=g.getAttribute('normal');let up=0;for(let i=0;i<n.count;i++)up+=n.getY(i);if(up<0){for(let i=0;i<idx.length;i+=3){const t=idx[i+1];idx[i+1]=idx[i+2];idx[i+2]=t;}g.setIndex(idx);g.computeVertexNormals();}
   snowCaps.push(g);
  }
  // Inside: a bag, a crate, a bucket; a lantern hangs from the front beam.
  const kp=(name:string,lx:number,lz:number,yaw:number,s=1,dy=0)=>{const [x,z]=W(lx,lz);kit.add(name,trs(x,h(x,z)+dy,z,S.yaw+yaw,s),{override:po});};
  kp('Bag',-1.2,-1.5,.4);kp('Crate_Wooden',1.3,-1.7,.2);kp('Bucket_Wooden_1',.6,-.6,1.1);kp('Rope_2',-.3,-1.9,.0);
  {const [x,z]=W(hw-.3,.25);lantern(x,h(x,z)+1.45,z,S.yaw,.7);}
  // Woodpile against the walled side, and a chopping block with the axe in it.
  for(let row=0;row<4;row++)for(let k=0;k<6-row;k++){const lz=-2.15+k*.4+row*.2,lx=-hw-.55+(rand()-.5)*.06;const a=P(lx-.5,.16+row*.27,lz),b=P(lx+.45,.16+row*.27,lz);a.y=b.y=Math.max(a.y,b.y);log(a,b,.14+rand()*.025);}
  {const c=P(-hw-.9,0,1.1);log(c.clone().add(V(0,-.2,0)),c.clone().add(V(0,.42,0)),.3);const [x,z]=[c.x,c.z];kit.add('Axe_Bronze',trs(x+.06,c.y+.62,z,S.yaw+.6,1.2,0,.35),{override:po});}
  // The banked fire: a ring of stones, logs leaning together, a tripod and a pot, and a log to sit on.
  const F=S.fire,fy=h(F.x,F.z);
  const rockNames=[...nature.pieces.keys()].filter(n=>/^Rock_Medium_/.test(n));
  for(let i=0;i<9;i++){const a=i/9*Math.PI*2+rand()*.3,r=.72;rocks.add(rockNames[i%rockNames.length],trs(F.x+Math.sin(a)*r,fy-.06,F.z+Math.cos(a)*r,rand()*6.28,new THREE.Vector3(.16+rand()*.05,.13+rand()*.05,.16+rand()*.05)),{override:no});}
  for(let i=0;i<5;i++){const a=i/5*Math.PI*2+.4;log(V(F.x+Math.sin(a)*.5,fy+.04,F.z+Math.cos(a)*.5),V(F.x+Math.sin(a)*.08,fy+.42,F.z+Math.cos(a)*.08),.07,charred);}
  for(let i=0;i<3;i++){const a=i/3*Math.PI*2+.9;log(V(F.x+Math.sin(a)*1.0,fy-.1,F.z+Math.cos(a)*1.0),V(F.x+Math.sin(a)*.05,fy+1.75,F.z+Math.cos(a)*.05),.04);}
  kit.add('Pot_1',trs(F.x,fy+.7,F.z,0,1.1),{override:po});rod(V(F.x,fy+.92,F.z),V(F.x,fy+1.7,F.z),.008,iron);
  flames.push({x:F.x,y:fy+.12,z:F.z,size:.75,cold:false});halos.push({x:F.x,y:fy+.4,z:F.z,size:3.6,color:'#ff7a2a',power:.75},{x:F.x,y:fy+.1,z:F.z,size:1.4,color:'#ff5a10',power:.9});
  log(P(1.0,.22,1.95),P(2.6,.22,1.4),.21);
  // The sled: two runners curled up at the front, slats across, and a load lashed on.
  {
   const L=S.sled,syl=Math.sin(L.yaw),cyl=Math.cos(L.yaw),gy=h(L.x,L.z);
   const at=(lx:number,dy:number,lz:number)=>V(L.x+cyl*lx+syl*lz,gy+dy,L.z-syl*lx+cyl*lz);
   for(const s of [-1,1]){const pts=[at(-1.15,.06,s*.42),at(.85,.06,s*.42),at(1.15,.16,s*.42),at(1.28,.36,s*.42),at(1.18,.5,s*.42)];for(let i=0;i<pts.length-1;i++)rod(pts[i],pts[i+1],.035,iron);
    for(const lx of [-.9,-.2,.5])rod(at(lx,.06,s*.42),at(lx,.36,s*.42),.03,planks);}
   for(let i=0;i<7;i++){const lx=-1.05+i*.3;const g=new THREE.BoxGeometry(.24,.05,1.0).rotateY(L.yaw).translate(...at(lx,.39,0).toArray());planks.push(g);}
   const k2=(name:string,lx:number,lz:number,dy:number,yaw:number,s=1)=>{const p=at(lx,dy,lz);kit.add(name,trs(p.x,p.y,p.z,L.yaw+yaw,s),{override:po});};
   k2('Crate_Wooden',-.5,0,.42,.1);k2('Bag',.35,-.15,.42,.8);k2('Rope_3',.4,.25,.42,0);
  }
  drifts.push(bank(h,line(...W(-hw-1.0,-d-.1),...W(hw+.3,-d-.1),-sy,-cy),.55,1.6,31));
 }

 // ---- The eastern ice overlook: flagstones at the point, a carved parapet on the lip, the spyglass, a standard.
 {
  const O=OVERLOOK,gy=h(O.x,O.z),top=gy+1.0;
  M.snow=.35;
  // A paved compass at the point: a round centre stone, two rings of curved pavers draped over the ground.
  const drape=(r0:number,a0:number):Warp=>(u,v,t)=>{const a=a0+u/r0,rr=r0-t,x=O.x+Math.sin(a)*rr,z=O.z+Math.cos(a)*rr;return [x,h(x,z)+v,z];};
  M.ground=gy-.2;
  for(const [r1,r0,n] of [[1.6,.62,8],[2.75,1.62,14]] as const){const off=rand()*6.28;for(let i=0;i<n;i++){const L=2*Math.PI*r1/n;M.block(drape(r1,off),i*L+.03,-.14,0,L-.06,.18,r1-r0-.03,{bevel:.04,seg:3,closed:true,tint:M.tint(2.4)});}}
  M.block((u,v,t)=>{const a=u/.6,rr=.6-t,x=O.x+Math.sin(a)*rr,z=O.z+Math.cos(a)*rr;return [x,h(x,z)+v,z];},0,-.14,0,2*Math.PI*.6,.2,.58,{bevel:.04,seg:12,closed:true,tint:M.tint(2.6)});
  // The compass star inlaid in brass, its long point on the sea.
  for(let k=0;k<8;k++){const a=k/8*Math.PI*2+Math.PI/4,len=k%2?.42:.56,w=.09,tip=V(O.x+Math.cos(a)*len,0,O.z+Math.sin(a)*len);
   const l=V(O.x+Math.cos(a+1.57)*w,0,O.z+Math.sin(a+1.57)*w),rr=V(O.x+Math.cos(a-1.57)*w,0,O.z+Math.sin(a-1.57)*w),c=V(O.x,0,O.z);
   for(const p of [tip,l,rr,c])p.y=h(p.x,p.z)+.075;
   const g=new THREE.BufferGeometry().setFromPoints([c,l,tip,c,tip,rr]);g.setIndex([0,1,2,3,4,5]);g.computeVertexNormals();brass.push(g);}
  // The parapet: an arc of courses, its inner face toward the point, outer face toward the sea, a coping on top.
  const a0=Math.PI/2-O.a1,span=(O.a1-O.a0),R=O.r;
  let low=Infinity;for(let i=0;i<=12;i++){const a=O.a0+span*i/12;low=Math.min(low,h(O.x+Math.cos(a)*R,O.z+Math.sin(a)*R));}
  M.ground=low;
  const inner:Warp=(u,v,t)=>{const a=a0+u/R,rr=R+t;return [O.x+Math.sin(a)*rr,v,O.z+Math.cos(a)*rr];};
  M.face(inner,0,span*R,low-.6,top-.25,{len:1.1,course:.42,depth:.4,curve:.5});
  M.face(ringWarp(O.x,O.z,R+.75,a0),0,span*(R+.75),low-.6,top-.25,{len:1.2,course:.48,depth:.4,curve:.5});
  for(let u=-.15;u<span*R+.15;){const w=Math.min(.9+rand()*.4,span*R+.15-u);M.block((uu,vv,tt)=>{const a=a0+uu/R,rr=R-.12+tt;return [O.x+Math.sin(a)*rr,vv,O.z+Math.cos(a)*rr];},u+.02,top-.25,0,w-.04,.24,1.0,{bevel:.05,seg:2,closed:true,tint:M.tint(1.9)});u+=w;}
  // A post at each end of the parapet.
  // A post at each end of the parapet, each carrying a lantern on an iron crook.
  for(const a of [O.a0,O.a1]){const x=O.x+Math.cos(a)*(R+.37),z=O.z+Math.sin(a)*(R+.37);M.ground=h(x,z);M.block((u,v,t)=>[x-.3+u,v,z-.3+t],0,h(x,z)-.4,0,.6,top+.45-h(x,z)+.4,.6,{bevel:.06,closed:true});M.block((u,v,t)=>[x-.38+u,v,z-.38+t],0,top+.45,0,.76,.18,.76,{bevel:.05,closed:true,tint:M.tint(1.9)});
   rod(V(x,top+.6,z),V(x,top+1.9,z),.035,iron);lantern(x,top+1.0,z,Math.atan2(O.x-x,O.z-z),.6);}
  // The spyglass on its brass-shod tripod inside the parapet, trained out over the frozen sea.
  const am=(O.a0+O.a1)/2,sx=O.x+Math.cos(am)*(R-.9),sz=O.z+Math.sin(am)*(R-.9),sgy=h(sx,sz),dir=V(Math.cos(am),.2,Math.sin(am)).normalize();
  const pivot=V(sx,sgy+1.35,sz);
  for(let i=0;i<3;i++){const a=i/3*Math.PI*2+am;rod(V(sx+Math.cos(a)*.55,sgy-.05,sz+Math.sin(a)*.55),pivot,.03,planks);}
  const tube=lathe([[.0,0],[.085,0],[.085,.06],[.075,.07],[.075,.8],[.095,.81],[.095,.9],[.06,.91],[.06,1.5],[.078,1.51],[.078,1.6],[0,1.6]],16);
  tube.rotateZ(-Math.PI/2).translate(-.7,0,0).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(X,dir)).translate(pivot.x,pivot.y+.09,pivot.z);brass.push(tube);
  brass.push(new THREE.SphereGeometry(.07,10,8).translate(pivot.x,pivot.y+.02,pivot.z));
  // The ledge's broken lip: slabs of ice jutting out past the parapet toward the sea.
  for(let i=0;i<9;i++){const a=O.a0-.1+(span+.2)*i/8+(rand()-.5)*.08,r=R+1.6+rand()*1.8,x=O.x+Math.cos(a)*r,z=O.z+Math.sin(a)*r,y=h(x,z);
   ice.push({x,y:y-.4,z,axis:[Math.cos(a),.9+rand()*.4,Math.sin(a)],height:2.4+rand()*2.6,radius:.5+rand()*.3,seed:rand()*97});
   if(i%2===0)crystalCluster(x+Math.cos(a)*.8,y,z+Math.sin(a)*.8,1.2+rand()*1.4,.9,4,rand,ice);}
  drifts.push(bank(h,arc(O.x,O.z,R+.8,Math.PI/2-O.a1,Math.PI/2-O.a0,.4),.6,1.4,41));
  // The standard: an iron pole with a crossbar, Boreas's night-blue pennant, and a lantern for the way back.
  const st=O.standard,sy=h(st.x,st.z);
  iron.push(lathe([[.16,0],[.16,.2],[.09,.32],[.06,5.6],[.1,5.7],[.1,5.8],[0,6.05]],10).translate(st.x,sy-.05,st.z));
  rod(V(st.x-.05,sy+5.35,st.z),V(st.x+1.3,sy+5.35,st.z),.035,iron);
  kit.add('Banner_2',trs(st.x+.05,sy+5.3,st.z+.06,0,1.05),{override:pn});
  lantern(st.x-.05,sy+2.2,st.z+.06,-Math.PI/2+.4,.7);
 }

 // ---- The northern aurora ridge: standing stones cut with runes that light at night, rime at their feet.
 const teal:V3=[.3,1.5,1.4];
 const runeColumn=(x:number,y:number,z:number,nx:number,nz:number,n:number,seed:number)=>{
  // Glyphs stacked down the stone's inner face: a stave and twigs, as the arena rim's runes.
  const tx=-nz,tz=nx,r=stream(seed),P=(a:number,b:number):V3=>[x+nx*.02+tx*a,y+b,z+nz*.02+tz*a];
  const seg=(a0:number,b0:number,a1:number,b1:number,w=.05)=>{const da=a1-a0,db=b1-b0,l=Math.hypot(da,db),ua=-db/l*w/2,ub=da/l*w/2;
   for(const [a,b] of [[a0+ua,b0+ub],[a1+ua,b1+ub],[a1-ua,b1-ub],[a0+ua,b0+ub],[a1-ua,b1-ub],[a0-ua,b0-ub]]){glass.pos.push(...P(a,b));glass.col.push(...teal);}};
  for(let k=0;k<n;k++){const b=-k*.62;seg(0,b-.24,0,b+.24);const s1=r()<.5?1:-1;seg(0,b+.24,.18*s1,b+.06);if(r()<.6)seg(0,b-.02,-.18*s1,b-.2);if(r()<.4)seg(-.17,b+.15,.17,b-.08);}
 };
 for(const st of ridgeStones()){
  const gy=h(st.x,st.z);M.ground=gy;M.snow=.4;
  // Face the ring's centre, lean a little, taper to a rough crown.
  const nx=(RIDGE.x-st.x)/RIDGE.r,nz=(RIDGE.z-st.z)/RIDGE.r,lean=(rand()-.5)*.06;
  const fd=M.menhir(st.x,st.z,gy,st.h,1.35,.85,nx,nz,lean);
  runeColumn(st.x+nx*(fd+lean*st.h*.62),gy+st.h*.68,st.z+nz*(fd+lean*st.h*.62),nx,nz,3,st.a*100);
  crystalCluster(st.x-nx*.55,gy,st.z-nz*.55,.8+rand()*.7,.6,4,rand,ice);
  drifts.push(bank(h,arc(st.x,st.z,.9,Math.atan2(-nx,-nz)-1.6,Math.atan2(-nx,-nz)+1.6,.3),.5,1.2,51+st.a*10));
 }
 // The observer's camp: an armillary on a granite pedestal, a telescope on a tripod, a chest of charts.
 {
  const A=RIDGE.armillary,ay=h(A.x,A.z);M.ground=ay;
  M.block((u,v,t)=>[A.x-.5+u,v,A.z-.5+t],0,ay-.4,0,1.0,.55,1.0,{bevel:.06,closed:true});
  M.block((u,v,t)=>[A.x-.32+u,v,A.z-.32+t],0,ay+.15,0,.64,.95,.64,{bevel:.06,closed:true});
  M.block((u,v,t)=>[A.x-.45+u,v,A.z-.45+t],0,ay+1.1,0,.9,.2,.9,{bevel:.05,closed:true,tint:M.tint(1.2)});
  const c=V(A.x,ay+1.95,A.z);rod(V(A.x,ay+1.3,A.z),V(A.x,ay+1.42,A.z),.12,brass);
  for(const [rx,rz,r] of [[Math.PI/2,0,.62],[Math.PI/2,.55,.6],[0,.41,.56],[Math.PI/2-.41,0,.5]] as const){const g=new THREE.TorusGeometry(r,.022,6,40);g.rotateX(rx);g.rotateZ(rz);g.translate(c.x,c.y,c.z);brass.push(g);}
  rod(c.clone().add(V(0,-.72,-.3)),c.clone().add(V(0,.72,.3)),.018,brass);
  brass.push(new THREE.SphereGeometry(.09,12,8).translate(c.x,c.y,c.z));
  const S=RIDGE.scope,sy=h(S.x,S.z),head=V(S.x,sy+1.35,S.z);
  for(let i=0;i<3;i++){const a=i/3*Math.PI*2+.3;rod(V(S.x+Math.sin(a)*.55,sy-.05,S.z+Math.cos(a)*.55),head,.025,planks);}
  const dir=V(-.12,.62,-1).normalize(),tube=lathe([[0,0],[.08,0],[.08,.06],[.07,.07],[.07,.75],[.09,.76],[.09,.84],[.055,.85],[.055,1.35],[.068,1.36],[.068,1.42],[0,1.42]],14);
  tube.rotateZ(-Math.PI/2).translate(-.6,0,0).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(X,dir)).translate(head.x,head.y+.08,head.z);brass.push(tube);
  const C=RIDGE.chest,cyy=h(C.x,C.z);kit.add('Chest_Wood',trs(C.x,cyy+.36,C.z,C.yaw,1),{override:po});
  kit.add('CandleStick_Triple',trs(C.x,cyy+.72,C.z,C.yaw+.3,1.1),{override:po});
  lantern(A.x+.0,ay+1.3,A.z+.45,0,.55);
 }

 // ---- The way to the throne: frozen standards in pairs, then two obelisks with cold fire at the arena's gate.
 {
  const P=PROCESSION;
  for(const z of P.standards)for(const s of [-1,1]){
   const x=s*P.side,y=h(x,z);
   iron.push(lathe([[.17,0],[.17,.2],[.09,.32],[.065,6.6],[.11,6.7],[.11,6.8],[0,6.95]],10).translate(x,y-.05,z));
   rod(V(x+s*.05,y+6.2,z),V(x-s*1.25,y+6.2,z),.035,iron);
   kit.add('Banner_1',trs(s>0?x-1.25:x+.05,y+6.15,z+.07,0,1.0),{override:pn});
   // A cresset of cold fire on the pole's cap.
   iron.push(new THREE.LatheGeometry([[0,0],[.12,.02],[.24,.18],[.27,.3],[.22,.3],[0,.14]].map(([a,b])=>new THREE.Vector2(a,b)),14).translate(x,y+6.95,z));
   flames.push({x,y:y+7.2,z,size:.75,cold:true});halos.push({x,y:y+7.45,z,size:2.6,color:'#5af0c0',power:.5});
  }
  for(const s of [-1,1]){
   const o=P.obelisk,x=s*o.x,z=o.z,y=h(x,z);M.ground=y;M.snow=.4;
   const sq=(hw:number,k0:number,k1:number,y0:number,y1:number):Warp=>(u,v,t)=>{const f=Math.min(1,Math.max(0,(v-y0)/(y1-y0))),k=k0+(k1-k0)*f;return [x+(u-hw)*k,v,z+(t-hw)*k];};
   M.block(sq(1.15,1,1,y-.5,y+.8),0,y-.5,0,2.3,1.3,2.3,{bevel:.08,closed:true});
   M.block(sq(1.0,1,1,y+.8,y+1.25),0,y+.8,0,2.0,.45,2.0,{bevel:.06,closed:true,tint:M.tint(.85)});
   let yy=y+1.25;const hs=[2.4,2.2,2.0];
   hs.forEach((hh,i)=>{const k0=.72-i*.09,k1=.72-(i+1)*.09;M.block(sq(.75,k0/.72,k1/.72,yy,yy+hh),0,yy+.03,0,1.5,hh-.03,1.5,{bevel:.06,closed:true});yy+=hh;});
   M.block(sq(.62,1,.08,yy,yy+1.0),0,yy+.03,0,1.24,1.0,1.24,{bevel:.04,closed:true,tint:M.tint(.85)});
   // Runes down the face toward the road, and an ice crown cupping cold fire on the point.
   runeColumn(x-s*.56,y+5.2,z,-s,0,4,s*7+3);
   for(let j=0;j<6;j++){const a=j/6*Math.PI*2+rand()*.3,t=.6+rand()*.2;ice.push({x:x+Math.sin(a)*.25,y:yy+.35,z:z+Math.cos(a)*.25,axis:[Math.sin(a)*t,1,Math.cos(a)*t],height:1.1+rand()*.6,radius:.15+rand()*.06,seed:rand()*97});}
   flames.push({x,y:yy+.95,z,size:1.25,cold:true});halos.push({x,y:yy+1.4,z,size:4.2,color:'#55eec4',power:.5});
   crystalCluster(x+s*1.3,y,z+.6,1.4,1.0,4,rand,ice);
   drifts.push(bank(h,arc(x,z,1.3,0,Math.PI*2,.4),.55,1.3,61+s));
  }
 }

 // ---- Meshes.
 const add=(geos:THREE.BufferGeometry[],mat:THREE.Material,name:string,cast=true)=>{if(!geos.length)return;const m=new THREE.Mesh(mergeGeometries(harmonise(geos),false)!,mat);m.name=name;m.castShadow=cast;m.receiveShadow=true;group.add(m);};
 add(logs,logMaterial(),'frostlight-sites-logs');add(charred,logMaterial(true),'frostlight-sites-firelogs');
 // plankMaterial carries the unguarded noise, so it takes no snow patch: the sled's slats are swept.
 const plank=plankMaterial();plank.name='frostlight-sites-planks';add(planks,plank,'frostlight-sites-planks');
 const ironMat=new THREE.MeshStandardMaterial({name:'frostlight-sites-iron',color:'#3a4048',roughness:.5,metalness:.6,envMapIntensity:0});snowCover(ironMat,{cover:1});add(iron,ironMat,'frostlight-sites-iron');
 add(brass,new THREE.MeshStandardMaterial({name:'frostlight-sites-brass',color:'#c49a52',roughness:.32,metalness:.55,envMapIntensity:0}),'frostlight-sites-brass');
 const capMat=new THREE.MeshStandardMaterial({name:'frostlight-sites-snowcap',color:'#e9f1f9',roughness:.84,vertexColors:true});snowMass(capMat);add(snowCaps,capMat,'frostlight-sites-snowcaps',false);
 const driftMat=new THREE.MeshStandardMaterial({name:'frostlight-sites-drift',color:'#e8f2fc',roughness:.9,vertexColors:true});snowMass(driftMat,{lumps:.7});add(drifts,driftMat,'frostlight-sites-drifts');
 const stone=new THREE.Mesh(M.geometry(),masonryMaterial('frostlight-sites-stone'));stone.name='frostlight-sites-stone';stone.castShadow=stone.receiveShadow=true;group.add(stone);
 const iceMesh=new THREE.Mesh(crystalGeometry(ice),opts.ice);iceMesh.name='frostlight-sites-ice';iceMesh.castShadow=true;group.add(iceMesh);
 group.add(glass.mesh('frostlight-sites-runes'),kit.build(),rocks.build());
 const fire=frostFire('frostlight-sites-fire',flames,halos,9091,5);group.add(fire.group);
 group.userData.sites={stones:ridgeStones().length,flames:flames.length,blocks:M.blocks,standards:PROCESSION.standards.length*2};
 return {group,update(time){fire.update(time);}};
}
