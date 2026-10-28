import * as THREE from 'three';
import {CardBatch,curveRings,seedLantern,skyRandom,sweep,type Ring} from './skyTreeGeometry';
import {SKY_BUTTRESSES,SKY_COURT,SKY_ROOT_ARCH_FEET,SKY_SPRING,SKY_TREE,SKY_TRUNK} from './skyTreeLayout';
import {SKY_TREE_DETAIL} from './skyTreeMaterials';

/*
 * World VI's world tree, the landmark of the world: a trunk 31 m to the fork on seven buttress flanks (the northern
 * ones grip the island's lip and pour over it as roots), two root arches, and a crown of five cumulus masses sized
 * about 1 : .6 : .6 : .4 : .4 whose top stands about 60 m over the ground, with sky between them. Each mass is a few
 * lobes: an opaque dark core per lobe and alpha-cut leaf cards over the union's shell, normals bent out from the mass
 * centre. Limbs run from the trunk into every mass and its lobes; vines and seed lanterns hang from the low limbs.
 * Bark is one mesh, leaves and vines one card mesh, the cores one mesh, lanterns one mesh (skySanctuary.ts merges
 * them). Positions come from skyTreeLayout.ts, which also gives the server its solids.
 */

/** Geometry the tree and the sanctuary pour into, merged into one mesh per material (skySanctuary.ts). */
export interface SkyParts {bark:THREE.BufferGeometry[];stone:THREE.BufferGeometry[];cards:CardBatch;cores:THREE.BufferGeometry[];lanterns:THREE.BufferGeometry[];lanternCount:number}
export function skyParts():SkyParts{return {bark:[],stone:[],cards:new CardBatch(),cores:[],lanterns:[],lanternCount:0};}

type Height=(x:number,z:number)=>number;
/** The graphics tier the player picked (World VI builds once, before the engine's tier is at hand). */
export function skyTreeQuality():'high'|'low'{try{return localStorage.getItem('cc.quality')==='low'?'low':'high';}catch{return 'high';}}
const UP=new THREE.Vector3(0,1,0);
/** Ground ellipse of the island (realmHeight): beyond .83 the ground falls away. */
const islandEdge=(x:number,z:number)=>Math.hypot(x/128,(z-2)/155);
/** Outward normal of the island's ellipse at (x, z). */
const edgeNormal=(x:number,z:number)=>{const nx=x/(128*128),nz=(z-2)/(155*155),l=Math.hypot(nx,nz);return [nx/l,nz/l] as const;};
/** Back onto the lip (edge .83) along the ellipse's radius. */
const toLip=(x:number,z:number)=>{const e=islandEdge(x,z),k=.8295/e;return [x*k,2+(z-2)*k] as const;};

/**
 * The crown: five masses as [offset from the trunk foot (x, y, z; +z is south, toward the town), radius, limb start
 * height, limb radius]. The big one leans a little west, so from the avenue the tree stands off its own axis.
 */
const MASSES:readonly (readonly [number,number,number,number,number,number])[]=[
 [-6,44,-1,16,SKY_TRUNK.fork-4,3.3],
 [18,38.5,3,10,27,2.3],
 [-25,31,6,9.6,22.5,2.2],
 [27.5,27.5,-8,6.6,20.5,1.6],
 [3,33,-22,6.4,25,1.6],
];
/** Lobe layout per mass (cumulus tops): direction from the mass centre (normalized later), distance and radius in mass radii. */
const LOBES:readonly (readonly [number,number,number,number,number])[]=[
 [0,0,0,0,.74],[.8,.55,.2,.5,.56],[-.7,.6,-.3,.5,.55],[.15,.85,-.6,.52,.5],[-.3,.5,.85,.52,.52],[.6,.1,-.8,.5,.48],[-.75,.05,.55,.48,.46],
];

export function buildSkyTree(height:Height,quality:'high'|'low',parts:SkyParts){
 const rand=skyRandom(6151),high=quality==='high';SKY_TREE_DETAIL.value=high?1:0;
 const X=SKY_TREE.x,Z=SKY_TREE.z,Y=height(X,Z),FORK=SKY_TRUNK.fork;
 const bark=parts.bark;
 // The trunk's axis leans toward the crown's weight (south-west) and sways a little as it rises.
 const axis=(h:number)=>{const k=Math.max(h,0);return new THREE.Vector3(X-.0021*k*k+.5*Math.sin(k*.09),Y+h,Z+.0016*k*k+.4*Math.sin(k*.07+1));};
 const twist=(h:number)=>.03*Math.max(h,0);
 const baseR=(h:number)=>{const k=Math.max(h,0);return (4.3+(SKY_TRUNK.radius-4.3)*Math.exp(-k/4.5)+1.4*THREE.MathUtils.smoothstep(k,FORK-11,FORK))*(1-THREE.MathUtils.smoothstep(k,FORK+.5,FORK+6)*.88);};
 const wrap=(a:number)=>{a=(a+Math.PI)%(Math.PI*2);if(a<0)a+=Math.PI*2;return a-Math.PI;};
 const BH=9.5;// buttress height: 30% of the trunk to the fork
 const flank=(h:number,a:number)=>{// strongest buttress at (h,a), 0..1
  let m=0;for(const [az,,s] of SKY_BUTTRESSES){const d=wrap(a-az-twist(h));m=Math.max(m,Math.min(1,s)*Math.exp(-(d*d)/(.2*.2+.02*Math.max(h,0))));}return m;
 };
 const flankR=(h:number,a:number)=>{
  const k=Math.max(h,0),R0=baseR(0);let r=0;
  for(const [az,reach,s] of SKY_BUTTRESSES){const d=wrap(a-az-twist(h)),w=.16+.015*k,amp=(reach-R0)*Math.pow(Math.max(0,1-k/BH),1.8)+1.4*s*Math.exp(-k/8);r=Math.max(r,amp*Math.exp(-(d*d)/(w*w)));}
  return r;
 };
 {
  // Trunk: rings from below ground to the dome over the fork, where the limbs have taken the wood.
  const J=high?64:40,radial=high?128:80,rings:Ring[]=[],hs:number[]=[];
  for(let j=0;j<=J;j++){const h=-2.5+(FORK+8.5)*Math.pow(j/J,1.5);hs.push(h);rings.push({c:axis(h),n:new THREE.Vector3(1,0,0),b:new THREE.Vector3(0,0,1),along:h,twist:-twist(h)/(Math.PI*2)*40});}
  bark.push(sweep(rings,radial,(j,a)=>{const h=hs[j];return Math.max(.4,baseR(h)+flankR(h,a)+.16*Math.sin(a*13+h*.5)+.1*Math.sin(a*29-h*.9)+.35*Math.sin(a*5+h*.13)*THREE.MathUtils.smoothstep(h,3,12));},
   (j,a)=>{const h=hs[j],f=flank(h,a),low=Math.exp(-Math.max(h,0)/3.5);return [THREE.MathUtils.clamp(.62+.38*f*low+(1-low)*.38,.45,1)*(.8+.2*THREE.MathUtils.smoothstep(h,-1,2.5)),THREE.MathUtils.clamp(1-h/3.2,0,1)];},40));
 }
 // The spring's channel from the trunk's foot to the lip: roots keep off it.
 const sprAz=Math.atan2(SKY_SPRING.z-Z,SKY_SPRING.x-X);
 const nearSpring=(x:number,z:number)=>{const ux=Math.cos(sprAz),uz=Math.sin(sprAz),t=THREE.MathUtils.clamp((x-X)*ux+(z-Z)*uz,0,30);return Math.hypot(x-X-ux*t,z-Z-uz*t);};
 // Surface roots: from each flank's blade out over the ground; they stop at the court's rim, steer round the
 // pillars and the spring and, northwards, grip the island's lip, run down its soil and hang into the air.
 const pillars:[number,number][]=[];for(let i=0;i<10;i++){const a=(i+1)/12*Math.PI*2,x=Math.sin(a)*23,z=SKY_COURT.z+Math.cos(a)*23;if(z<=-56)pillars.push([x,z]);}
 let rootCount=0,spillCount=0;
 const surfaceRoot=(az:number,r0:number,start:number,reach:number,salt:number,hangLen:number)=>{
  const pts:THREE.Vector3[]=[],radii:number[]=[];
  let x=X+Math.cos(az)*start,z=Z+Math.sin(az)*start,dir=az,len=0,spilled=false;const step=1.6;
  pts.push(new THREE.Vector3(X+Math.cos(az)*start*.55,Y+r0*1.1,Z+Math.sin(az)*start*.55));radii.push(r0*1.15);
  while(len<reach){
   const t=len/reach,r=r0*Math.pow(1-t*.85,1.15)+.12;
   if(islandEdge(x,z)>.826){
    // Over the lip: hug the soil band, bow out from the rock and hang, tapering, into the air.
    const [lx,lz]=toLip(x,z),[nx,nz]=edgeNormal(lx,lz),ly=height(lx+0*nx,lz)-.05,side=Math.sin(salt*1.7);
    const prof:[number,number][]=[[.15,.55],[1.1,.75],[2.4,1.05],[4,1.7],[6.5,2.6],[9.5,3.3]];
    for(let k=8.5;k<hangLen;k+=3.2)prof.push([k+4,3.5+.35*Math.sin(k*.4+salt)]);
    let rr=r;
    for(const [d,o] of prof){rr=Math.max(.1,rr*.9);const sw=side*Math.min(1,d/12)*1.5*Math.sin(d*.22+salt);pts.push(new THREE.Vector3(lx+nx*(o+rr*.8)-nz*sw,ly-d,lz+nz*(o+rr*.8)+nx*sw));radii.push(rr);}
    spilled=true;spillCount++;break;
   }
   const g=height(x,z);pts.push(new THREE.Vector3(x,g+r*(.12+.25*Math.sin(len*.55+salt)),z));radii.push(r);
   if(Math.hypot(x-SKY_COURT.x,z-SKY_COURT.z)<SKY_COURT.radius+1.4){
    // At the court's kerb the root thins over its last few metres and sinks under the stone.
    const n=pts.length,k=Math.min(5,n-1);for(let i=1;i<=k;i++){const f=(k-i+1)/(k+1);radii[n-i]*=.25+.75*(1-f);}
    pts[n-1].y=g-radii[n-1]*1.2;break;
   }
   dir+=(Math.sin(len*.37+salt*3.1)*.12+(rand()-.5)*.08);
   for(const [px,pz] of pillars){const d=Math.hypot(x-px,z-pz);if(d<3.2){const away=Math.atan2(z-pz,x-px),diff=wrap(away-dir);dir+=diff*.35;}}
   if(nearSpring(x,z)<3.2){const ux=Math.cos(sprAz),uz=Math.sin(sprAz),s=Math.sign((x-X)*-uz+(z-Z)*ux)||1;dir+=wrap(Math.atan2(s*ux,-s*uz)-dir)*.3;}
   x+=Math.cos(dir)*step;z+=Math.sin(dir)*step;len+=step;
  }
  if(pts.length<3)return;
  // Close the tip: one more point a little on and down, radius to nothing.
  {const a=pts[pts.length-2],b=pts[pts.length-1],d=b.clone().sub(a);if(!spilled)d.setY(0);d.normalize();pts.push(b.clone().addScaledVector(d,.9).setY(b.y-(spilled?1.4:.35)));radii.push(.02);}
  const curve=new THREE.CatmullRomCurve3(pts,false,'centripetal'),segs=Math.max(6,Math.round(pts.length*(high?2.2:1.4)));
  const rings=curveRings(curve,segs),rad=high?14:9,furrows=Math.max(5,Math.round(r0*2*Math.PI/.9));
  bark.push(sweep(rings,rad,(j,a)=>{const u=j/segs,i=Math.min(radii.length-1,u*(radii.length-1)),i0=Math.floor(i),f=i-i0,r=radii[i0]*(1-f)+radii[Math.min(i0+1,radii.length-1)]*f;
   // Roots flatten where they lie on the ground: wide sideways, low on top.
   return r*(1-.2*Math.cos(2*a)+.06*Math.sin(a*5+u*9));},
   (_j,_a,p)=>{const g=height(p.x,p.z),above=islandEdge(p.x,p.z)>.83?1.4:p.y-g;return [THREE.MathUtils.clamp(.6+above*.35,.55,1),THREE.MathUtils.clamp(1-above/1.4,0,1)];},furrows));
  rootCount++;
 };
 for(const [az,reach,s] of SKY_BUTTRESSES){const north=Math.sin(az)<-.3;surfaceRoot(az,1.55*s,reach*.82,north?30:24+s*10,az*7,north?22:0);}
 // Thinner roots between the flanks (none down the spring's channel).
 for(let i=0;i<SKY_BUTTRESSES.length;i++){const a=SKY_BUTTRESSES[i][0],b=SKY_BUTTRESSES[(i+1)%SKY_BUTTRESSES.length][0],mid=a+wrap(b-a)/2;if(Math.abs(wrap(mid-sprAz))<.3)continue;surfaceRoot(mid+(rand()-.5)*.2,.7,7.6,12+rand()*10,i*13+3,14+rand()*8);}
 // Extra roots along the north lip: out of the northern flanks' sides, over the edge and down, either side of the spring.
 for(const [az,r0,salt] of [[3.55,.85,2],[4.1,1.05,5],[4.62,.9,8],[4.95,1.1,11],[5.25,.8,14],[5.85,.75,17]] as const)surfaceRoot(az,r0,9.5,26,salt,12+salt*1.1);
 // Root arches: out of the trunk, up over a crab's head and back into the ground, with a thinner root twined round.
 for(const [fx,fz] of SKY_ROOT_ARCH_FEET){
  const az=Math.atan2(fz-Z,fx-X),D=Math.hypot(fx-X,fz-Z),d=new THREE.Vector3(Math.cos(az),0,Math.sin(az)),at=(r:number,h:number)=>new THREE.Vector3(X,0,Z).addScaledVector(d,r).setY(height(X+d.x*r,Z+d.z*r)+h);
  const curve=new THREE.CatmullRomCurve3([at(4.5,3.6),at(9,9.2),at(14,12),at(D*.78,9.6),at(D-1.2,3.4),at(D,-1.2)],false,'centripetal');
  const segs=high?48:30,rings=curveRings(curve,segs),R=(u:number)=>1.75-.7*u;
  bark.push(sweep(rings,high?18:12,(j,a)=>R(j/segs)*(1+.08*Math.sin(a*3+j*.4)),(_j,_a,p)=>{const g=height(p.x,p.z);return [THREE.MathUtils.clamp(.62+(p.y-g)*.2,.6,1),THREE.MathUtils.clamp(1-(p.y-g)/1.5,0,1)];},9));
  // The twined root: a helix round the arch.
  const tw:THREE.Vector3[]=[],f=curve.computeFrenetFrames(80,false);
  for(let i=0;i<=80;i++){const u=i/80,p=curve.getPointAt(u),ph=u*Math.PI*2*3.2,rr=R(u)+.2;tw.push(p.addScaledVector(f.normals[i],Math.cos(ph)*rr).addScaledVector(f.binormals[i],Math.sin(ph)*rr));}
  const tc=new THREE.CatmullRomCurve3(tw),ts=high?120:70;
  bark.push(sweep(curveRings(tc,ts),high?8:6,j=>.46-.22*j/ts,(_j,_a,p)=>{const g=height(p.x,p.z);return [.85,THREE.MathUtils.clamp(1-(p.y-g)/1.5,0,1)];},3));
  rootCount+=2;
 }
 // The crown: lobes per mass, limbs from the trunk into each mass and branches into its lobes.
 const lobes:{c:THREE.Vector3;r:number;m:number}[]=[],masses:{c:THREE.Vector3;r:number}[]=[],hangs:{p:THREE.Vector3;r:number}[]=[];
 const v=new THREE.Vector3();
 MASSES.forEach(([ox,oy,oz,r],mi)=>{
  const c=new THREE.Vector3(X+ox,Y+oy,Z+oz);masses.push({c,r});
  for(const [dx,dy,dz,dist,lr] of LOBES){v.set(dx,dy,dz);if(v.lengthSq()>0)v.normalize();
   // Lobes sit on the mass's top and flanks; the underside stays one flat, shaded plane.
   lobes.push({c:c.clone().addScaledVector(v,r*dist).add(new THREE.Vector3(0,v.y<0?-v.y*r*dist*.6:0,0)),r:r*lr*(.92+.16*rand()),m:mi});}
 });
 let limbCount=0;
 MASSES.forEach(([,, ,r,h0,lr],mi)=>{
  const m=masses[mi],o=axis(h0),to=m.c.clone().sub(o),flat=to.clone().setY(0),reach=flat.length(),d=reach>.5?flat.normalize():new THREE.Vector3(1,0,0),side=new THREE.Vector3(-d.z,0,d.x);
  // The big mass's limb is the trunk's leader; the others leave it nearly level, then rise into their mass.
  const lead=mi===0,w=(rand()-.5)*3;
  const pts=lead?[o.clone().addScaledVector(UP,-2),o.clone().addScaledVector(UP,4).addScaledVector(d,reach*.15),o.clone().lerp(m.c,.6).addScaledVector(side,w),m.c.clone().addScaledVector(UP,-r*.1)]
   :[o.clone().addScaledVector(d,-1.5),o.clone().addScaledVector(d,reach*.25).addScaledVector(UP,1.6),o.clone().addScaledVector(d,reach*.62).addScaledVector(UP,to.y*.42).addScaledVector(side,w),m.c.clone().addScaledVector(d,-r*.1).addScaledVector(UP,-r*.15)];
  const curve=new THREE.CatmullRomCurve3(pts,false,'centripetal'),segs=high?36:22;
  bark.push(sweep(curveRings(curve,segs),high?24:14,(j,a)=>(lr*Math.pow(1-j/segs,.8)+.35)*(1+.07*Math.sin(a*4+j*.6)),(_j,a)=>[.72+.28*Math.max(0,Math.sin(a)),0],Math.max(6,Math.round(lr*4))));limbCount++;
  // Branches from the limb's upper half into each lobe of the mass.
  lobes.forEach(l=>{if(l.m!==mi||l.c.distanceTo(m.c)<1)return;
   const p=curve.getPointAt(.62+rand()*.25),tip=l.c.clone(),mid=p.clone().lerp(tip,.55).addScaledVector(UP,1.5+rand()*2);
   const bc=new THREE.CatmullRomCurve3([p,mid,tip],false,'centripetal'),bs=high?14:8,br=lr*.42;
   bark.push(sweep(curveRings(bc,bs),high?12:8,j=>br*Math.pow(1-j/bs,.85)+.18,()=>[.85,0],5));
  });
  if(!lead)for(let k=0;k<7;k++){const t=.2+k*.09+rand()*.04;hangs.push({p:curve.getPointAt(Math.min(t,.8)),r:lr*Math.pow(1-t,.8)+.35});}
 });
 // Leaf cards over every lobe's shell, skipping cards buried in another lobe; the underside is pressed flat.
 const cards=parts.cards,col=new THREE.Color(),nrm=new THREE.Vector3(),dir=new THREE.Vector3(),p=new THREE.Vector3(),g=new THREE.Vector3();
 // Three-colour ramp with a floor (shade, mid, lit), picked by the card's lean to the sky; blossom on the tops.
 const JADE=[new THREE.Color('#2f6f6a'),new THREE.Color('#3f8f80'),new THREE.Color('#5fae95'),new THREE.Color('#6fb89a')];
 const BLOSSOM=[new THREE.Color('#f2b8c6'),new THREE.Color('#f7f0ea'),new THREE.Color('#f5cfd8')];
 const cardHalf=high?2.05:2.5,density=high?1:.62;
 const buried=(q:THREE.Vector3,self:number,k:number)=>lobes.some((l,i)=>i!==self&&q.distanceTo(l.c)<l.r*k);
 const floorY=(mi:number)=>masses[mi].c.y-masses[mi].r*.46;
 const blossomAt=(q:THREE.Vector3)=>Math.sin(q.x*.19+q.z*.13)*Math.sin(q.z*.15-q.y*.1+1.7);
 lobes.forEach((l,li)=>{
  const m=masses[l.m],n=Math.round(4*Math.PI*l.r*l.r/(cardHalf*cardHalf*4)*1.25*density);
  for(let i=0;i<n;i++){
   dir.set(rand()*2-1,rand()*2-1,rand()*2-1);if(dir.lengthSq()>1||dir.lengthSq()<.01){i--;continue;}dir.normalize();
   const depth=.86+.14*Math.sqrt(rand());p.copy(dir).multiplyScalar(l.r*depth).add(l.c);
   const fy=floorY(l.m);if(p.y<fy){if(rand()<.55)continue;p.y=fy+rand()*.6;}
   if(buried(p,li,.93))continue;
   g.copy(p).sub(m.c).normalize();nrm.copy(g).multiplyScalar(.6).addScaledVector(dir,.4).addScaledVector(UP,.1).normalize();
   const lit=THREE.MathUtils.clamp(g.y*.55+.48+(rand()-.5)*.3,0,.999);col.copy(JADE[Math.floor(lit*JADE.length)]).multiplyScalar(.9+rand()*.2);
   const bloom=g.y>.05&&blossomAt(p)>.42&&rand()<.5;
   if(bloom)col.copy(BLOSSOM[Math.floor(rand()*BLOSSOM.length)]).multiplyScalar(.95+rand()*.1);
   cards.add(p,cardHalf*(.8+rand()*.45)*(bloom?.8:1),rand()*Math.PI*2,col,nrm,bloom?1:0);
  }
 });
 // Cores: one warped, flat-bottomed ball inside each lobe, so the gaps between cards show deep leaf, not sky.
 {
  const ico=new THREE.IcosahedronGeometry(1,high?3:2),ip=ico.getAttribute('position'),SH=new THREE.Color('#1f4f4b'),MID=new THREE.Color('#2b6660');
  const noise=(x:number,y:number,z:number)=>Math.sin(x*1.7+y*.6)*Math.sin(y*1.9-z*1.1+.5)*Math.sin(z*1.5+x*.8+1.1);
  lobes.forEach(l=>{
   const m=masses[l.m],fy=floorY(l.m)+.8,n=ip.count,pos=new Float32Array(n*3),nor=new Float32Array(n*3),cc=new Float32Array(n*3);
   for(let i=0;i<n;i++){
    dir.set(ip.getX(i),ip.getY(i),ip.getZ(i));const k=l.r*.8*(1+.16*noise(dir.x*2+l.c.x,dir.y*2,dir.z*2+l.c.z));
    p.copy(dir).multiplyScalar(k).add(l.c);p.y=Math.max(p.y,fy);pos.set([p.x,p.y,p.z],i*3);
    g.copy(p).sub(m.c).normalize();nrm.copy(g).multiplyScalar(.7).addScaledVector(dir,.3).normalize();nor.set([nrm.x,nrm.y,nrm.z],i*3);
    col.copy(SH).lerp(MID,THREE.MathUtils.clamp(g.y*.5+.5,0,1));cc.set([col.r,col.g,col.b],i*3);
   }
   const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('normal',new THREE.BufferAttribute(nor,3));geo.setAttribute('color',new THREE.BufferAttribute(cc,3));geo.setIndex(ico.getIndex()!.clone());
   parts.cores.push(geo);
  });
  ico.dispose();
 }
 // Vines: stems hanging from the low limbs' undersides, leaves along them; some end in a seed lantern.
 const lanterns=parts.lanterns;const VINE=new THREE.Color('#3a7a5e');let lanternCount=0;
 hangs.forEach((h,i)=>{
  const start=h.p.clone().addScaledVector(UP,-h.r*.85),ground=height(start.x,start.z),room=start.y-ground;
  if(room<9||islandEdge(start.x,start.z)>.82)return;
  const lantern=i%3===1,len=lantern?Math.min(room-7.5,5+rand()*6):Math.min(room-4,6+rand()*12);
  const sway=rand()*Math.PI*2,pts:THREE.Vector3[]=[];
  for(let k=0;k<=6;k++){const t=k/6;pts.push(start.clone().add(new THREE.Vector3(Math.cos(sway)*Math.sin(t*2.2)*.6,-len*t,Math.sin(sway)*Math.sin(t*2.2)*.6)));}
  const vc=new THREE.CatmullRomCurve3(pts),vs=high?14:8;
  bark.push(sweep(curveRings(vc,vs),5,j=>.1-.045*j/vs,()=>[.9,0],2));
  for(let k=0;k<len/.5;k++){const q=vc.getPointAt(Math.min(1,k*.5/len+rand()*.03));q.x+=(rand()-.5)*.6;q.z+=(rand()-.5)*.6;dir.set(rand()-.5,rand()-.3,rand()-.5).normalize();col.copy(VINE).multiplyScalar(.8+rand()*.5);if(rand()<.12)col.copy(BLOSSOM[1]);cards.add(q,.5+rand()*.22,rand()*6.3,col,dir,rand()<.12?1:0);}
  if(lantern){lanterns.push(seedLantern(vc.getPointAt(1),1.35,rand()));lanternCount++;}
 });
 parts.lanternCount+=lanternCount;
 let top=0;for(const l of lobes)top=Math.max(top,l.c.y+l.r);
 return {masses,cardHalf,stats:{cards:cards.count,lanterns:lanternCount,roots:rootCount,spills:spillCount,limbs:limbCount,lobes:lobes.length,crownTop:+(top-Y).toFixed(1)}};
}
