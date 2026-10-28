import * as THREE from 'three';
import {CardBatch,curveRings,seedLantern,skyRandom,sweep,type Ring} from './skyTreeGeometry';
import {SKY_BUTTRESSES,SKY_COURT,SKY_ROOT_ARCH_FEET,SKY_TREE} from './skyTreeLayout';
import {SKY_TREE_DETAIL} from './skyTreeMaterials';

/*
 * World VI's world tree: a pale silver trunk on seven buttress flanks that twist as they rise and run out into
 * surface roots (to the court's rim, round the island and over its north edge), two root arches that leave the trunk
 * and dive back into the ground, seven great limbs with their branches, and a crown of jade leaf masses with blossom
 * in it, vines and seed lanterns hanging from the limbs. Bark is one mesh, leaves and vines one card mesh, lanterns
 * one mesh (skySanctuary.ts merges them). Positions come from skyTreeLayout.ts, which also gives the server its solids.
 */

/** Geometry the tree and the sanctuary pour into, merged into one mesh per material (skySanctuary.ts). */
export interface SkyParts {bark:THREE.BufferGeometry[];stone:THREE.BufferGeometry[];cards:CardBatch;lanterns:THREE.BufferGeometry[];lanternCount:number}
export function skyParts():SkyParts{return {bark:[],stone:[],cards:new CardBatch(),lanterns:[],lanternCount:0};}

type Height=(x:number,z:number)=>number;
/** The graphics tier the player picked (World VI builds once, before the engine's tier is at hand). */
export function skyTreeQuality():'high'|'low'{try{return localStorage.getItem('cc.quality')==='low'?'low':'high';}catch{return 'high';}}
const UP=new THREE.Vector3(0,1,0);
/** Ground ellipse of the island (realmHeight): beyond .83 the ground falls away. */
const islandEdge=(x:number,z:number)=>Math.hypot(x/128,(z-2)/155);

export function buildSkyTree(height:Height,quality:'high'|'low',parts:SkyParts){
 const rand=skyRandom(6151),high=quality==='high';SKY_TREE_DETAIL.value=high?1:0;
 const X=SKY_TREE.x,Z=SKY_TREE.z,Y=height(X,Z);
 const bark=parts.bark;
 // The trunk's axis sways a little as it rises.
 const axis=(h:number)=>new THREE.Vector3(X+.7*Math.sin(h*.075),Y+h,Z+.5*Math.sin(h*.06+1));
 const twist=(h:number)=>.034*Math.max(h,0);
 const baseR=(h:number)=>{const k=Math.max(h,0);return (4.2+2.3*Math.exp(-k/3.2)+1.2*THREE.MathUtils.smoothstep(k,12,23))*(1-THREE.MathUtils.smoothstep(k,25,31)*.9);};
 const wrap=(a:number)=>{a=(a+Math.PI)%(Math.PI*2);if(a<0)a+=Math.PI*2;return a-Math.PI;};
 const flank=(h:number,a:number)=>{// strongest buttress at (h,a), 0..1
  let m=0;for(const [az,,s] of SKY_BUTTRESSES){const d=wrap(a-az-twist(h));m=Math.max(m,s*Math.exp(-(d*d)/(.2*.2+.02*Math.max(h,0))));}return m;
 };
 const flankR=(h:number,a:number)=>{
  const k=Math.max(h,0),R0=baseR(0);let r=0;
  for(const [az,reach,s] of SKY_BUTTRESSES){const d=wrap(a-az-twist(h)),w=.17+.016*k,amp=(reach-R0)*s*Math.pow(Math.max(0,1-k/10.5),1.9)+1.2*s*Math.exp(-k/9);r=Math.max(r,amp*Math.exp(-(d*d)/(w*w)));}
  return r;
 };
 {
  // Trunk: rings from below ground to the dome where the limbs have taken the wood.
  const J=high?52:36,radial=high?112:72,rings:Ring[]=[],hs:number[]=[];
  for(let j=0;j<=J;j++){const h=-2.5+33.5*Math.pow(j/J,1.55);hs.push(h);rings.push({c:axis(h),n:new THREE.Vector3(1,0,0),b:new THREE.Vector3(0,0,1),along:h,twist:-twist(h)/(Math.PI*2)*36});}
  bark.push(sweep(rings,radial,(j,a)=>{const h=hs[j];return Math.max(.4,baseR(h)+flankR(h,a)+.14*Math.sin(a*13+h*.5)+.09*Math.sin(a*29-h*.9));},
   (j,a)=>{const h=hs[j],f=flank(h,a),low=Math.exp(-Math.max(h,0)/3.5);return [THREE.MathUtils.clamp(.62+.38*f*low+(1-low)*.38,.45,1)*(.8+.2*THREE.MathUtils.smoothstep(h,-1,2.5)),THREE.MathUtils.clamp(1-h/3.2,0,1)];},36));
 }
 // Surface roots: from each flank's blade out over the ground; they stop at the court's rim, steer round the
 // pillars and, northwards, spill over the island's edge and hang into the clouds.
 const pillars:[number,number][]=[];for(let i=0;i<10;i++){const a=(i+1)/12*Math.PI*2,x=Math.sin(a)*23,z=SKY_COURT.z+Math.cos(a)*23;if(z<=-56)pillars.push([x,z]);}
 let rootCount=0;
 const surfaceRoot=(az:number,r0:number,start:number,reach:number,salt:number)=>{
  const pts:THREE.Vector3[]=[],radii:number[]=[];
  let x=X+Math.cos(az)*start,z=Z+Math.sin(az)*start,dir=az,spill=0,len=0;const step=1.6;
  pts.push(new THREE.Vector3(X+Math.cos(az)*start*.55,Y+r0*1.1,Z+Math.sin(az)*start*.55));radii.push(r0*1.15);
  while(len<reach){
   const t=len/reach,r=r0*Math.pow(1-t,1.15)+.12;
   if(spill>0){pts.push(new THREE.Vector3(x,pts[pts.length-1].y-step*1.3,z));radii.push(r);x+=Math.cos(dir)*.5;z+=Math.sin(dir)*.5;len+=step;continue;}
   const g=height(x,z);pts.push(new THREE.Vector3(x,g+r*(.12+.25*Math.sin(len*.55+salt)),z));radii.push(r);
   if(Math.hypot(x-SKY_COURT.x,z-SKY_COURT.z)<SKY_COURT.radius+1.1){pts[pts.length-1].y=g-r*.8;break;}
   if(islandEdge(x,z)>.835){spill=1;}
   dir+=(Math.sin(len*.37+salt*3.1)*.12+(rand()-.5)*.08);
   for(const [px,pz] of pillars){const d=Math.hypot(x-px,z-pz);if(d<3.2){const away=Math.atan2(z-pz,x-px),diff=wrap(away-dir);dir+=diff*.35;}}
   x+=Math.cos(dir)*step;z+=Math.sin(dir)*step;len+=step;
  }
  if(pts.length<3)return;
  const curve=new THREE.CatmullRomCurve3(pts,false,'centripetal'),segs=Math.max(6,Math.round(pts.length*(high?2.2:1.4)));
  const rings=curveRings(curve,segs),rad=high?14:9,furrows=Math.max(5,Math.round(r0*2*Math.PI/.9));
  bark.push(sweep(rings,rad,(j,a)=>{const u=j/segs,i=Math.min(radii.length-1,u*(radii.length-1)),i0=Math.floor(i),f=i-i0,r=radii[i0]*(1-f)+radii[Math.min(i0+1,radii.length-1)]*f;
   // Roots flatten where they lie on the ground: wide sideways, low on top.
   return r*(1+.22*Math.cos(2*a)+.06*Math.sin(a*5+u*9));},
   (_j,_a,p)=>{const g=height(p.x,p.z),above=p.y-g;return [THREE.MathUtils.clamp(.6+above*.35,.55,1),THREE.MathUtils.clamp(1-above/1.4,0,1)];},furrows));
  rootCount++;
 };
 for(const [az,reach,s] of SKY_BUTTRESSES)surfaceRoot(az,1.45*s,reach*.82,(az>3.5&&az<6)?30:24+s*10,az*7);
 // Thinner roots between the flanks.
 for(let i=0;i<SKY_BUTTRESSES.length;i++){const a=SKY_BUTTRESSES[i][0],b=SKY_BUTTRESSES[(i+1)%SKY_BUTTRESSES.length][0],mid=a+wrap(b-a)/2;surfaceRoot(mid+(rand()-.5)*.2,.62,7.2,12+rand()*10,i*13+3);}
 // Root arches: out of the trunk, up over a crab's head and back into the ground, with a thinner root twined round.
 for(const [fx,fz] of SKY_ROOT_ARCH_FEET){
  const az=Math.atan2(fz-Z,fx-X),D=Math.hypot(fx-X,fz-Z),d=new THREE.Vector3(Math.cos(az),0,Math.sin(az)),at=(r:number,h:number)=>new THREE.Vector3(X,0,Z).addScaledVector(d,r).setY(height(X+d.x*r,Z+d.z*r)+h);
  const curve=new THREE.CatmullRomCurve3([at(3.5,3.2),at(8,8.2),at(13,10.6),at(D*.78,8.6),at(D-1.2,3.2),at(D,-1.2)],false,'centripetal');
  const segs=high?48:30,rings=curveRings(curve,segs),R=(u:number)=>1.55-.65*u;
  bark.push(sweep(rings,high?18:12,(j,a)=>R(j/segs)*(1+.08*Math.sin(a*3+j*.4)),(_j,_a,p)=>{const g=height(p.x,p.z);return [THREE.MathUtils.clamp(.62+(p.y-g)*.2,.6,1),THREE.MathUtils.clamp(1-(p.y-g)/1.5,0,1)];},9));
  // The twined root: a helix round the arch.
  const tw:THREE.Vector3[]=[],f=curve.computeFrenetFrames(80,false);
  for(let i=0;i<=80;i++){const u=i/80,p=curve.getPointAt(u),ph=u*Math.PI*2*3.2,rr=R(u)+.18;tw.push(p.addScaledVector(f.normals[i],Math.cos(ph)*rr).addScaledVector(f.binormals[i],Math.sin(ph)*rr));}
  const tc=new THREE.CatmullRomCurve3(tw),ts=high?120:70;
  bark.push(sweep(curveRings(tc,ts),high?8:6,j=>.42-.2*j/ts,(_j,_a,p)=>{const g=height(p.x,p.z);return [.85,THREE.MathUtils.clamp(1-(p.y-g)/1.5,0,1)];},3));
  rootCount+=2;
 }
 // Limbs: seven great limbs from the fork, each with two branches; the crown's leaf masses sit on their ends.
 const masses:{c:THREE.Vector3;r:number}[]=[],hangs:{p:THREE.Vector3;r:number}[]=[];
 const LIMBS:[number,number,number,number,number][]=[// azimuth, height on the trunk, reach, rise, scale
  [1.3,16,27,10,1],[2.2,18,25,11,.95],[3.15,15,28,9,1],[4.05,19,24,12,.9],[4.95,17,26,10,.95],[5.8,15.5,27,9.5,1],[.45,18.5,25,11.5,.92],
 ];
 const limbCurves:THREE.CatmullRomCurve3[]=[];
 for(const [az,h0,reach,rise,sc] of LIMBS){
  const d=new THREE.Vector3(Math.cos(az),0,Math.sin(az)),side=new THREE.Vector3(-d.z,0,d.x),o=axis(h0),w=(rand()-.5)*4;
  const curve=new THREE.CatmullRomCurve3([o.clone().addScaledVector(d,-1),o.clone().addScaledVector(d,4).addScaledVector(UP,3.4),o.clone().addScaledVector(d,reach*.42).addScaledVector(UP,rise*.78).addScaledVector(side,w),
   o.clone().addScaledVector(d,reach*.76).addScaledVector(UP,rise).addScaledVector(side,-w*.6),o.clone().addScaledVector(d,reach).addScaledVector(UP,rise-2.5)],false,'centripetal');
  limbCurves.push(curve);
  const segs=high?34:22;
  bark.push(sweep(curveRings(curve,segs),high?22:14,(j,a)=>(2.5*sc*Math.pow(1-j/segs,.9)+.32)*(1+.07*Math.sin(a*4+j*.6)),(_j,a)=>[.75+.25*Math.max(0,Math.sin(a)),0],13));
  masses.push({c:curve.getPointAt(1).addScaledVector(UP,1.5),r:9.2*sc},{c:curve.getPointAt(.66).addScaledVector(UP,4),r:8*sc});
  for(const [t,turn] of [[.48,.75],[.7,-.8]] as const){
   const p=curve.getPointAt(t),bd=d.clone().applyAxisAngle(UP,turn+(rand()-.5)*.3),len=10+rand()*4;
   const bc=new THREE.CatmullRomCurve3([p.clone().addScaledVector(bd,-.5),p.clone().addScaledVector(bd,len*.45).addScaledVector(UP,3.5),p.clone().addScaledVector(bd,len).addScaledVector(UP,4.5)],false,'centripetal');
   const bs=high?16:10;
   bark.push(sweep(curveRings(bc,bs),high?12:8,j=>.95*sc*Math.pow(1-j/bs,.9)+.18,()=>[.85,0],6));
   masses.push({c:bc.getPointAt(1).addScaledVector(UP,1.2),r:7*sc});
  }
  for(let k=0;k<6;k++){const t=.28+k*.12+rand()*.05;hangs.push({p:curve.getPointAt(Math.min(t,.95)),r:(2.5*sc*Math.pow(1-t,.9)+.32)});}
 }
 // The crown over the fork.
 for(let i=0;i<5;i++){const a=i/5*Math.PI*2+.4,c=axis(30).add(new THREE.Vector3(Math.cos(a)*7,7+i%2*3,Math.sin(a)*7));masses.push({c,r:10.5});}
 masses.push({c:axis(30).add(new THREE.Vector3(0,12,0)),r:9.5});
 // Leaf cards over every mass's shell, skipping cards buried in a neighbour; a darker inner layer fills the gaps.
 const cards=parts.cards,centroid=new THREE.Vector3();masses.forEach(m=>centroid.add(m.c));centroid.divideScalar(masses.length);
 const col=new THREE.Color(),nrm=new THREE.Vector3(),dir=new THREE.Vector3(),p=new THREE.Vector3(),g=new THREE.Vector3();
 const JADE=[new THREE.Color('#2f7a6c'),new THREE.Color('#3f8f80'),new THREE.Color('#5fae95'),new THREE.Color('#86c39a')];
 const BLOSSOM=[new THREE.Color('#f2b8c6'),new THREE.Color('#f7f0ea'),new THREE.Color('#f5cfd8')];
 const SQ=.78,cardHalf=high?1.55:1.85,density=high?1:.6;
 const buried=(q:THREE.Vector3,self:number,k:number)=>masses.some((m,i)=>i!==self&&Math.hypot(q.x-m.c.x,(q.y-m.c.y)/SQ,q.z-m.c.z)<m.r*k);
 const blossomAt=(q:THREE.Vector3)=>Math.sin(q.x*.21+q.z*.13)*Math.sin(q.z*.17-q.y*.11+1.7);
 masses.forEach((m,mi)=>{
  const n=Math.round(4*Math.PI*m.r*m.r/(cardHalf*cardHalf*4)*1.15*density);
  for(let i=0;i<n;i++){
   dir.set(rand()*2-1,rand()*2-1,rand()*2-1);if(dir.lengthSq()>1||dir.lengthSq()<.01){i--;continue;}dir.normalize();
   if(dir.y<-.55&&rand()<.5)continue;
   const depth=.84+.16*Math.sqrt(rand());p.copy(dir).multiplyScalar(m.r*depth);p.y*=SQ;p.add(m.c);
   if(buried(p,mi,.9))continue;
   g.copy(p).sub(centroid).normalize();nrm.copy(dir).multiplyScalar(.62).addScaledVector(g,.38).addScaledVector(UP,.12).normalize();
   const lit=THREE.MathUtils.clamp(dir.y*.6+.5+(rand()-.5)*.35,0,.999);col.copy(JADE[Math.floor(lit*JADE.length)]).multiplyScalar(.9+rand()*.2);
   const bloom=dir.y>-.1&&blossomAt(p)>.45&&rand()<.55;
   if(bloom)col.copy(BLOSSOM[Math.floor(rand()*BLOSSOM.length)]).multiplyScalar(.95+rand()*.1);
   cards.add(p,cardHalf*(.8+rand()*.45)*(bloom?.8:1),rand()*Math.PI*2,col,nrm,bloom?1:0);
  }
  // Inner layer: dark leaves half way in, so gaps show depth, not sky.
  for(let i=0;i<n*.22;i++){
   dir.set(rand()*2-1,rand()*2-1,rand()*2-1);if(dir.lengthSq()>1||dir.lengthSq()<.01){i--;continue;}dir.normalize();
   p.copy(dir).multiplyScalar(m.r*.6);p.y*=SQ;p.add(m.c);if(buried(p,mi,.6))continue;
   nrm.copy(dir).multiplyScalar(.5).addScaledVector(UP,.2).normalize();col.copy(JADE[0]).multiplyScalar(.55+rand()*.15);
   cards.add(p,cardHalf*1.2,rand()*Math.PI*2,col,nrm,0);
  }
 });
 // Vines: stems hanging from the limbs' undersides, leaves along them; some end in a seed lantern.
 const lanterns=parts.lanterns;const VINE=new THREE.Color('#3a7a5e');let lanternCount=0;
 hangs.forEach((h,i)=>{
  const start=h.p.clone().addScaledVector(UP,-h.r*.85),ground=height(start.x,start.z),room=start.y-ground;
  if(room<9)return;
  const lantern=i%3===1,len=lantern?Math.min(room-7.5,4+rand()*4):Math.min(room-3,5+rand()*8);
  const sway=rand()*Math.PI*2,pts:THREE.Vector3[]=[];
  for(let k=0;k<=6;k++){const t=k/6;pts.push(start.clone().add(new THREE.Vector3(Math.cos(sway)*Math.sin(t*2.2)*.6,-len*t,Math.sin(sway)*Math.sin(t*2.2)*.6)));}
  const vc=new THREE.CatmullRomCurve3(pts),vs=high?14:8;
  bark.push(sweep(curveRings(vc,vs),5,j=>.09-.04*j/vs,()=>[.9,0],2));
  for(let k=0;k<len/.42;k++){const q=vc.getPointAt(Math.min(1,k*.42/len+rand()*.03));q.x+=(rand()-.5)*.5;q.z+=(rand()-.5)*.5;dir.set(rand()-.5,rand()-.3,rand()-.5).normalize();col.copy(VINE).multiplyScalar(.8+rand()*.5);if(rand()<.12)col.copy(BLOSSOM[1]);cards.add(q,.42+rand()*.2,rand()*6.3,col,dir,rand()<.12?1:0);}
  if(lantern){lanterns.push(seedLantern(vc.getPointAt(1),1.25,rand()));lanternCount++;}
 });
 parts.lanternCount+=lanternCount;
 return {masses,cardHalf,stats:{cards:cards.count,lanterns:lanternCount,roots:rootCount,limbs:LIMBS.length}};
}

