import * as THREE from 'three';
import {realmHeight} from '../sim/world/ground';
import {frontierTrees} from './realmLayout';
import {onIslandPath,type IslandPath} from './islandPaths';
import {skyTownBare,skyTownMarketGround} from './skyTownLayout';

/*
 * Skybloom's ground plan, shared by the ground shader (skyGround.ts), the meadow (skyMeadow.ts), the paving
 * (skyPaving.ts) and the forest (skyForest.ts): the ways, what stands where, and per point how grassy, worn, mossy
 * and shaded the ground is and where the wildflowers drift. Numbers only, no meshes, so every module agrees.
 */

/** The island's ways: the avenue to the sanctuary, three cross streets and the harbour spur (same footprint as before). */
export const SKY_PATHS:IslandPath[]=[
 {points:[[0,94],[0,28],[0,-72]],width:8,trim:true},
 ...[38,56,74].map(z=>({points:[[-23,z],[23,z]] as [number,number][],width:4,trim:true})),
 {points:[[-12,84],[0,84]],width:4,trim:true},
];
/** The gameplay height grid the terrain mesh is built on (layoutFrontier's Collision grid). */
export const SKY_GRID={minX:-150,minZ:-175,step:2,nx:151,nz:176};
/** The ground map (skyGroundMap) covers the island at 1 m. */
export const SKY_MAP={minX:-150,minZ:-175,w:300,h:350};
export const SKY_ARENA={x:0,z:-72,r:20};
export const SKY_TREE={x:0,z:-112};

export const skyHeight=(x:number,z:number)=>realmHeight(6,x,z);
/** The rendered terrain's surface (the 2 m PlaneGeometry's own triangles), never under the gameplay surface. */
export function skyRenderedHeight(x:number,z:number){
 const {minX,minZ,step}=SKY_GRID,ax=minX+Math.floor((x-minX)/step)*step,az=minZ+Math.floor((z-minZ)/step)*step,u=(x-ax)/step,v=(z-az)/step;
 const a=skyHeight(ax,az),b=skyHeight(ax+step,az),c=skyHeight(ax,az+step),d=skyHeight(ax+step,az+step);
 return u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v);
}

const smooth=THREE.MathUtils.smoothstep;
/** Deterministic 0..1 hash of integers. */
export function skyHash(i:number,j=0,s=0){let h=Math.imul(i|0,0x27d4eb2d)^Math.imul(j|0,0x165667b1)^Math.imul(s|0,0x9e3779b1);h=Math.imul(h^(h>>>15),0x2c1b3c6d);h=Math.imul(h^(h>>>12),0x297a2d39);return ((h^(h>>>15))>>>0)/4294967296;}
/** Smooth value noise, -1..1 roughly, unit cells. */
export function skyNoise(x:number,z:number,s=0){
 const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz,u=fx*fx*(3-2*fx),v=fz*fz*(3-2*fz);
 const a=skyHash(ix,iz,s),b=skyHash(ix+1,iz,s),c=skyHash(ix,iz+1,s),d=skyHash(ix+1,iz+1,s);
 return (a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v)*2-1;
}
const fbm=(x:number,z:number,s:number)=>skyNoise(x,z,s)*.6+skyNoise(x*2.13,z*2.13,s+1)*.3+skyNoise(x*4.7,z*4.7,s+2)*.1;

/** Island rim: 0 in the middle, 1 at the gameplay edge (FRONTIER_BOUNDS), the cliff beyond .83. */
export const skyEdge=(x:number,z:number)=>Math.hypot(x/128,(z-2)/155);
export const skyTown=(x:number,z:number)=>{const d=Math.hypot(Math.max(Math.abs(x)-42,0),Math.max(24-z,0,z-94));return 1-smooth(d,0,5);};

/** Solid footprints other lanes own (houses, stalls, the sanctuary): nothing grows inside, contact shade round them. */
export const SKY_HOUSES:[number,number][]=[];for(const side of [-1,1])for(let i=0;i<3;i++)SKY_HOUSES.push([side*30,38+i*18]);
const rectDist=(x:number,z:number,cx:number,cz:number,hx:number,hz:number)=>Math.hypot(Math.max(Math.abs(x-cx)-hx,0),Math.max(Math.abs(z-cz)-hz,0));

/*
 * The forest: the frontier's 50 tree spots (their colliders stay), each given a species. A few spots are the focal
 * group of a view: east of town a blossom grove round a mossy outcrop, west a silver twisted elder over a fern dell.
 */
export type SkyTreeSpecies='jade'|'blossom'|'white'|'silver';
export interface SkyTreeSpot{/** frontierTrees' generator index; 100 and up for the groves' own trees (W6-only colliders). */i:number;x:number;z:number;s:number;species:SkyTreeSpecies;yaw:number;/** Visual size over the spot's scale (focal groups stand taller; the collider stays). */grand:number}
/** Focal groups (east and west views): where the shrubs, rocks and a fallen log gather. */
export const SKY_GROVES=[
 {name:'east-blossom-grove',x:76,z:-6,r:12},
 {name:'west-elder-dell',x:-70,z:-6,r:12},
 {name:'south-east-copse',x:58,z:62,r:9},
 {name:'south-west-copse',x:-52,z:62,r:9},
 {name:'north-east-copse',x:52,z:-52,r:9},
 {name:'north-west-copse',x:-46,z:-48,r:9},
] as const;
let treeCache:SkyTreeSpot[]|null=null;
export function skyTrees():SkyTreeSpot[]{
 if(treeCache)return treeCache;
 const hero:Record<number,SkyTreeSpecies>={40:'blossom',53:'white',19:'blossom',70:'silver',15:'silver',28:'jade',58:'white',3:'blossom',52:'silver',31:'white'};
 treeCache=frontierTrees(6).map(t=>({...t,i:-1,species:'jade' as SkyTreeSpecies,yaw:0,grand:1}));
 // Each spot's generator index (frontierTrees keeps its order), so species stay put if the list ever changes.
 let k=0;for(let i=0;i<72&&k<treeCache.length;i++){const a=i*2.399963,r=48+i%6*7,x=Math.sin(a)*r,z=5+Math.cos(a)*100;if(Math.abs(x-treeCache[k].x)<1e-6&&Math.abs(z-treeCache[k].z)<1e-6){treeCache[k].i=i;k++;}}
 for(const t of treeCache){
  const h=skyHash(t.i,7,61);
  t.species=hero[t.i]??(h<.18?'blossom':h<.28?'white':h<.5?'silver':'jade');
  t.yaw=skyHash(t.i,3,9)*Math.PI*2;
  for(const [gi,g] of SKY_GROVES.entries())if(gi<2&&Math.hypot(t.x-g.x,t.z-g.z)<g.r*1.3)t.grand=1.3;
 }
 // The two focal groves get three trees of their own, close together, so each view has a massed group.
 const groveSpecies:SkyTreeSpecies[][]=[['blossom','white','blossom'],['silver','silver','jade']];
 for(let gi=0;gi<2;gi++){
  const g=SKY_GROVES[gi];let placed=0;
  for(let k=0;k<40&&placed<3;k++){
   const a=skyHash(gi,k,91)*Math.PI*2,d=(.3+.55*skyHash(gi,k,92))*g.r,x=g.x+Math.cos(a)*d,z=g.z+Math.sin(a)*d,s=1+.25*skyHash(gi,k,93);
   // Never between the east/west views' camera and the crab (the views stand at x ±34..60, z -5).
   const line=Math.abs(z+5)<6&&Math.abs(x)<64;
   if(line||skyEdge(x,z)>.74||skyPathDistance(x,z)<4||!skyClearOfPoints(x,z,1.5)||treeCache.some(t=>Math.hypot(t.x-x,t.z-z)<4.5+2*(t.s+s)))continue;
   treeCache.push({i:100+gi*10+placed,x,z,s,species:groveSpecies[gi][placed],yaw:skyHash(gi,k,94)*Math.PI*2,grand:1.15});placed++;
  }
 }
 return treeCache;
}

/** Shrubs, ferns, boulders and logs: placed once here, clear of the ways, quest points and solids. */
export interface SkyProp{kind:'shrub'|'bloomshrub'|'fern'|'boulder'|'stone'|'log'|'flowers'|'mushroom';x:number;z:number;s:number;yaw:number}
/** Every quest, NPC and enemy point in World VI (FRONTIER_POINTS[6] and the sim's POIs): solids keep 4 m away. */
const KEEP_CLEAR:[number,number,number][]=[
 [-12,78,3],[12,72,3],[-12,56,3],[-47,40,4],[-52,28,4],[-44,14,4],[-7,26,3],[7,4,3],[-7,-22,3],[-50,26,9],[61,22,6],[0,-34,4],
 [36,8,4],[44,-6,8],[34,-22,4],[62,34,4],[68,20,4],[60,4,4],[-17,-34,4],[17,-42,4],[-16,-54,4],[16,68,5],[16,56,5],[-16,74,5],[0,-44,6],[-12,84,4],
];
/** Enemy homes (createFrontierDefinition, up to 16 + 16): x ±(44..65), z 20 down in 12 m rows; solids keep off their wander discs. */
for(let index=0;index<32;index++){const x=(index%2?1:-1)*(44+index%4*7),z=20-Math.floor(index/2)*12;KEEP_CLEAR.push([x,z,6.5]);}
export function skyClearOfPoints(x:number,z:number,margin=0){for(const [px,pz,r] of KEEP_CLEAR)if(Math.hypot(x-px,z-pz)<r+margin)return false;return true;}
/** How far (x, z) is from every way's paved edge (negative on the paving). */
export function skyPathDistance(x:number,z:number){
 let best=1e9;
 for(const p of SKY_PATHS)for(let k=1;k<p.points.length;k++){
  const [ax,az]=p.points[k-1],[bx,bz]=p.points[k],dx=bx-ax,dz=bz-az,l2=dx*dx+dz*dz,t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/l2));
  best=Math.min(best,Math.hypot(ax+dx*t-x,az+dz*t-z)-p.width/2);
 }
 return best;
}
/** Whether a solid (boulder, log) of radius r may stand at (x, z). */
function freeForSolid(x:number,z:number,r:number){
 if(skyEdge(x,z)>.74||skyPathDistance(x,z)<r+2.2||!skyClearOfPoints(x,z,r))return false;
 if(Math.hypot(x-SKY_ARENA.x,z-SKY_ARENA.z)<SKY_ARENA.r+6+r||Math.hypot(x-SKY_TREE.x,z-SKY_TREE.z)<16+r)return false;
 if(skyTown(x,z)>.01)return false;
 for(const t of skyTrees())if(Math.hypot(x-t.x,z-t.z)<r+1.6*t.s)return false;
 return true;
}
let propCache:SkyProp[]|null=null;
export function skyProps():SkyProp[]{
 if(propCache)return propCache;
 const out:SkyProp[]=[];
 const solids:{x:number;z:number;r:number}[]=[];
 const free=(x:number,z:number,r:number)=>freeForSolid(x,z,r)&&solids.every(s=>Math.hypot(s.x-x,s.z-z)>s.r+r+.6);
 // Focal groups: an outcrop of two or three mossy boulders, a fallen log, shrubs and ferns round them.
 SKY_GROVES.forEach((g,gi)=>{
  const big=gi<2,nb=big?3:2;
  for(let k=0,placed=0;k<nb*6&&placed<nb;k++){
   const a=skyHash(gi,k,11)*Math.PI*2,d=(.15+.5*skyHash(gi,k,12))*g.r,x=g.x+Math.cos(a)*d,z=g.z+Math.sin(a)*d,s=(big?2:1.15)*(1-.35*Math.min(placed,2)/2)*(.85+.3*skyHash(gi,k,13)),r=s*1.25;
   if(!free(x,z,r))continue;solids.push({x,z,r});out.push({kind:'boulder',x,z,s,yaw:skyHash(gi,k,14)*6.28});placed++;
  }
  for(let k=0;k<10;k++){
   const a=skyHash(gi,k,21)*Math.PI*2,d=(.35+.55*skyHash(gi,k,22))*g.r,x=g.x+Math.cos(a)*d,z=g.z+Math.sin(a)*d,yaw=skyHash(gi,k,23)*Math.PI,len=big?5.5:4.2;
   // A log's footprint: its two ends and middle.
   const ok=[-.45,0,.45].every(f=>free(x+Math.cos(yaw)*len*f,z+Math.sin(yaw)*len*f,.7));
   if(!ok)continue;for(const f of [-.45,0,.45])solids.push({x:x+Math.cos(yaw)*len*f,z:z+Math.sin(yaw)*len*f,r:.7});
   out.push({kind:'log',x,z,s:len,yaw});break;
  }
  const n=big?38:14;
  for(let k=0;k<n;k++){
   const a=skyHash(gi,k,31)*Math.PI*2,d=Math.sqrt(skyHash(gi,k,32))*g.r*1.25,x=g.x+Math.cos(a)*d,z=g.z+Math.sin(a)*d;
   if(skyEdge(x,z)>.76||skyPathDistance(x,z)<1.5||!skyClearOfPoints(x,z,-1.5)||solids.some(s=>Math.hypot(s.x-x,s.z-z)<s.r+.3))continue;
   const r=skyHash(gi,k,33),kind=r<.34?'fern':r<.6?'shrub':r<.78?'bloomshrub':r<.93?'flowers':'mushroom';
   out.push({kind,x,z,s:(kind==='fern'?1.1:kind==='mushroom'?.9:1)*(.75+.5*skyHash(gi,k,34)),yaw:skyHash(gi,k,35)*6.28});
  }
 });
 // Round the foot of every tree: a shrub or a few ferns; a mossy stone at some.
 for(const t of skyTrees()){
  const n=1+Math.floor(skyHash(t.i,1,41)*3);
  for(let k=0;k<n;k++){
   const a=t.yaw+k*2.2+skyHash(t.i,k,42),d=(1.6+1.8*skyHash(t.i,k,43))*t.s,x=t.x+Math.cos(a)*d,z=t.z+Math.sin(a)*d;
   if(skyEdge(x,z)>.77||skyPathDistance(x,z)<1.2||skyTown(x,z)>.2)continue;
   const r=skyHash(t.i,k,44),kind=r<.45?'fern':r<.75?'shrub':r<.85&&(t.species==='blossom'||t.species==='white')?'bloomshrub':'flowers';
   out.push({kind,x,z,s:.7+.45*skyHash(t.i,k,45),yaw:skyHash(t.i,k,46)*6.28});
  }
  if(skyHash(t.i,2,47)<.35){const a=t.yaw+1.1,d=2.4*t.s,x=t.x+Math.cos(a)*d,z=t.z+Math.sin(a)*d,s=.55+.3*skyHash(t.i,2,48);if(free(x,z,s*1.2)){solids.push({x,z,r:s*1.2});out.push({kind:'stone',x,z,s,yaw:skyHash(t.i,2,49)*6.28});}}
 }
 // Lone stones out in the open meadow, a few, half sunk; small enough to step round.
 for(let k=0;k<40;k++){
  const x=(skyHash(k,0,51)*2-1)*96,z=-60+skyHash(k,0,52)*150,s=.4+.35*skyHash(k,0,53);
  if(Math.abs(x)<26||!free(x,z,s*1.2))continue;solids.push({x,z,r:s*1.2});out.push({kind:'stone',x,z,s,yaw:skyHash(k,0,54)*6.28});
 }
 propCache=out;return out;
}
/** Colliders for the solid props (boulders, stones, logs): x, z, radius, height above the ground. */
export function skySolids():{x:number;z:number;r:number;h:number}[]{
 const out:{x:number;z:number;r:number;h:number}[]=[];
 // The groves' own trees (the frontier's spots already have theirs in layoutFrontier).
 for(const t of skyTrees())if(t.i>=100)out.push({x:t.x,z:t.z,r:.7*t.s,h:12*t.s});
 for(const p of skyProps()){
  if(p.kind==='boulder')out.push({x:p.x,z:p.z,r:p.s*1.15,h:p.s*1.6});
  else if(p.kind==='stone')out.push({x:p.x,z:p.z,r:p.s*1.05,h:p.s*1.1});
  else if(p.kind==='log')for(const f of [-.4,0,.4])out.push({x:p.x+Math.cos(p.yaw)*p.s*f,z:p.z+Math.sin(p.yaw)*p.s*f,r:.62,h:1.1});
 }
 return out;
}

/*
 * The ground map: the island at 1 m, two RGBA8 layers.
 *  soil: r grass, g worn, b patch (.5 plain, under .5 moss, over .5 bare soil), a wildflowers;
 *  aux:  r contact shade, g blossom colour of the drift (0 pink .. 1 butter), b bare (nothing grows), a blade height.
 * Trees, props and houses are splatted into it (cheap at load); everything else is a few noises per texel.
 */
export interface SkyGroundMap{soil:Uint8Array;aux:Uint8Array;w:number;h:number}
let mapCache:SkyGroundMap|null=null;
export function skyGroundMap():SkyGroundMap{
 if(mapCache)return mapCache;
 const {minX,minZ,w,h}=SKY_MAP,n=w*h;
 const shade=new Float32Array(n),edge=new Float32Array(n),bare=new Uint8Array(n);
 const splat=(cx:number,cz:number,r:number,f:(d:number,i:number)=>void)=>{
  const i0=Math.max(0,Math.floor(cx-r-minX)),i1=Math.min(w-1,Math.ceil(cx+r-minX)),j0=Math.max(0,Math.floor(cz-r-minZ)),j1=Math.min(h-1,Math.ceil(cz+r-minZ));
  for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){const d=Math.hypot(minX+i+.5-cx,minZ+j+.5-cz);if(d<=r)f(d,j*w+i);}
 };
 for(const t of skyTrees()){
  const r=(t.species==='silver'?4.2:3.6)*t.s;splat(t.x,t.z,r,(d,i)=>{shade[i]=Math.max(shade[i],.55*(1-smooth(d,r*.2,r)));});
  splat(t.x,t.z,9*t.s,(d,i)=>{edge[i]=Math.max(edge[i],1-smooth(d/t.s,3.5,9));});
 }
 for(const g of SKY_GROVES)splat(g.x,g.z,g.r*1.7,(d,i)=>{edge[i]=Math.max(edge[i],(1-smooth(d,g.r*.6,g.r*1.7))*.9);});
 for(const p of skyProps()){
  if(p.kind==='flowers')continue;
  const solid=p.kind==='boulder'||p.kind==='log',r=p.kind==='boulder'?p.s*2.1:p.kind==='log'?p.s*.55:p.kind==='stone'?p.s*1.6:p.s*1.1,k=solid?.6:.35;
  if(p.kind==='log'){for(const f of [-.4,-.2,0,.2,.4])splat(p.x+Math.cos(p.yaw)*p.s*f,p.z+Math.sin(p.yaw)*p.s*f,1.4,(d,i)=>{shade[i]=Math.max(shade[i],.55*(1-smooth(d,.3,1.4)));});}
  else splat(p.x,p.z,r,(d,i)=>{shade[i]=Math.max(shade[i],k*(1-smooth(d,r*.2,r)));});
  if(p.kind==='boulder'||p.kind==='stone')splat(p.x,p.z,p.s*.9,(_d,i)=>{bare[i]=1;});
  splat(p.x,p.z,4,(d,i)=>{edge[i]=Math.max(edge[i],(1-smooth(d,1,4))*.7);});
 }
 // The market's trodden ground follows the town's stalls (skyTownLayout.ts).
 const market=skyTownMarketGround();
 const soil=new Uint8Array(n*4),aux=new Uint8Array(n*4),u8=(v:number)=>Math.max(0,Math.min(255,Math.round(v*255)));
 for(let j=0;j<h;j++)for(let i=0;i<w;i++){
  const x=minX+i+.5,z=minZ+j+.5,k=j*w+i,o=k*4;
  const town=skyTown(x,z),pd=skyPathDistance(x,z),rag=fbm(x/3,z/3,5);
  let ao=shade[k];
  for(const [hx,hz] of SKY_HOUSES){const d=rectDist(x,z,hx,hz,5.2,5.7);if(d<3)ao=Math.max(ao,.5*(1-smooth(d,0,3)));}
  const wt=Math.hypot(x-SKY_TREE.x,z-SKY_TREE.z);ao=Math.max(ao,.45*(1-smooth(wt,6,22)));
  // Worn: trodden earth along the ways' edges, at the doors and round the market, the sanctuary's approach.
  // Beside the ways only a ragged trodden lip: the turf laps up to the stones.
  let worn=(1-smooth(pd,.0,.9+rag*.9))*.55*smooth(fbm(x/2.5,z/2.5,6),-.2,.35);
  for(const [hx,hz] of SKY_HOUSES){const door=Math.hypot((x-hx)/2.6,(z-hz-7.2)/1.8);worn=Math.max(worn,(1-smooth(door+rag*.25,.5,1.4))*.9);}
  for(const m of market){const d=rectDist(x,z,m.x,m.z,m.hx,m.hz);worn=Math.max(worn,(1-smooth(d+rag,0,2.5))*.8);}
  worn=Math.max(worn,town*smooth(fbm(x/9,z/9,8),.35,.5)*.35);
  const ra=Math.hypot(x-SKY_ARENA.x,z-SKY_ARENA.z);worn=Math.max(worn,(1-smooth(ra+rag*1.5,SKY_ARENA.r,SKY_ARENA.r+4))*.75);
  worn=Math.max(worn,(1-smooth(wt+rag*2,7,12))*.6);
  // Moss in the shade and in damp hollows, bare soil in a few open patches.
  const patch=fbm(x/11,z/11,13),moss=Math.max(ao*1.2,smooth(patch,.42,.65)*.5)*(1-town*.7),dirt=smooth(-patch,.6,.75)*smooth(fbm(x/3.5,z/3.5,14),-.1,.3)*(1-town)*.85;
  const grass=Math.max(0,1-worn*1.05)*(1-.35*dirt);
  // Wildflowers in drifts: long swathes combed by the wind, thick at the forest's edge, none on worn ground.
  const wx=x*.8+z*.6,wz=-x*.6+z*.8,drift=fbm(wx/22,wz/7,17)+.35*fbm(x/4,z/4,19);
  let flowers=smooth(drift+edge[k]*.45-.25*town,.32,.62)*(1-worn)*(1-dirt*.6)*(1-smooth(skyEdge(x,z),.74,.8));
  if(pd<1.2)flowers*=smooth(pd,.4,1.2);
  let isBare=bare[k]===1;
  if(!isBare){
   for(const [hx,hz] of SKY_HOUSES)if(rectDist(x,z,hx,hz,5.4,5.9)<.6){isBare=true;break;}
   if(Math.hypot(x+12,z-84)<3.2||ra<SKY_ARENA.r+.6||wt<7)isBare=true;
   if(skyTownBare(x,z))isBare=true;// the town's boardwalk, sheds, cargo and stalls (skyTownLayout.ts)
   for(let q=0;q<10&&!isBare;q++){const a=(q+1)/12*Math.PI*2,px=Math.sin(a)*23,pz=-72+Math.cos(a)*23;if(pz<=-56&&Math.hypot(x-px,z-pz)<2)isBare=true;}
  }
  // Blade height: short mown turf in town, tall at the forest's edge and the field margins.
  const tall=Math.min(1,.55+.3*edge[k]+.25*smooth(fbm(x/14,z/14,29),0,.5))*(1-.5*town);
  soil[o]=u8(grass);soil[o+1]=u8(worn);soil[o+2]=u8(.5+.5*(dirt-moss));soil[o+3]=u8(flowers);
  aux[o]=u8(ao);aux[o+1]=u8(skyBloomHue(x,z));aux[o+2]=isBare?255:0;aux[o+3]=u8(tall);
 }
 mapCache={soil,aux,w,h};return mapCache;
}
/** Which of the four blossom colours a drift at (x, z) carries: 0 pink .. 1 butter (pink, white, lilac, butter). */
export function skyBloomHue(x:number,z:number){const v=fbm(x/26+40,z/26,23)*.5+.5;return Math.max(0,Math.min(.999,v*1.35-.18));}
/** The ground map at (x, z), nearest texel: [grass, worn, patch, flowers, shade, hue, bare, tall], each 0..1. */
export function skyGroundAt(x:number,z:number):number[]{
 const m=skyGroundMap(),i=Math.max(0,Math.min(m.w-1,Math.floor(x-SKY_MAP.minX))),j=Math.max(0,Math.min(m.h-1,Math.floor(z-SKY_MAP.minZ))),o=(j*m.w+i)*4;
 return [m.soil[o]/255,m.soil[o+1]/255,m.soil[o+2]/255,m.soil[o+3]/255,m.aux[o]/255,m.aux[o+1]/255,m.aux[o+2]/255,m.aux[o+3]/255];
}
export const skyOnPath=(x:number,z:number)=>onIslandPath(SKY_PATHS,x,z);
