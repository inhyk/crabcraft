import * as THREE from 'three';
import {realmHeight} from '../sim/world/ground';
import {SKY_CARGO,SKY_CART,SKY_GLASSHOUSE,SKY_MAST,SKY_STALLS} from './skyTownLayout';

/*
 * Skybloom's ground plan, shared by the ground shader (skyGround.ts), the meadow (skyMeadow.ts), the paving
 * (skyPaving.ts), the forest (skyForest.ts) and the W6-only colliders (skyGroundColliders.ts): the ways, what stands
 * where, and per point how grassy, worn, mossy and shaded the ground is and where the wildflowers drift. Numbers only,
 * no meshes, so every module agrees.
 */

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
const clamp01=(v:number)=>Math.max(0,Math.min(1,v));
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

/*
 * The ways. The high street runs straight through town; south of the market the avenue swings east, back west past
 * the lamp, and comes into the root gate (sky-tree's posts at x +-7.4, z -40) square, so the world tree never sits at
 * the end of a ruled line. The old cross streets are garden paths that leave the high street at a slant, pass each
 * townsfolk spot and end at a door; two longer paths lead out to the herb grove and the shore lookout.
 */
/** A way: centreline samples [x, z, half width]; kind 1 the avenue, 0 a garden path. */
export interface SkyWay{name:string;kind:number;pts:[number,number,number][]}
const ease=(t:number)=>(1-Math.cos(Math.PI*clamp01(t)))/2;
/** The avenue's bend: [z, centre x], cosine-eased between knots, straight (x 0) north and south of them. */
export const SKY_AVENUE_KNOTS:readonly (readonly [number,number])[]=[[20,0],[4,4.5],[-21,-6],[-36,0]];
/** The avenue's centre and half width at z (for posts along it: x +- (half + 1.6)). */
export function skyAvenueAt(z:number){
 let x=0;const K=SKY_AVENUE_KNOTS;
 for(let k=1;k<K.length;k++){const [z0,x0]=K[k-1],[z1,x1]=K[k];if(z<=z0&&z>=z1){x=x0+(x1-x0)*ease((z0-z)/(z0-z1));break;}}
 const half=z>14?4:z>6?4-.5*ease((14-z)/8):z>-30?3.5:3.5+.7*ease((-30-z)/6);
 return {x,half};
}
function avenue():SkyWay{
 const pts:[number,number,number][]=[[0,94,4]];
 for(let z=22;z>=-56;z-=2){const a=skyAvenueAt(z);pts.push([a.x,z,a.half]);}
 return {name:'avenue',kind:1,pts};
}
/** A garden path through control points (centripetal Catmull-Rom), half width easing from the first to the last. */
function garden(name:string,ctrl:[number,number][],h0:number,h1:number):SkyWay{
 const c=new THREE.CatmullRomCurve3(ctrl.map(([x,z])=>new THREE.Vector3(x,0,z)),false,'centripetal');
 const n=Math.max(2,Math.ceil(c.getLength()/1.25)),pts:[number,number,number][]=[],p=new THREE.Vector3();
 for(let i=0;i<=n;i++){const u=i/n;c.getPointAt(u,p);pts.push([p.x,p.z,h0+(h1-h0)*smooth(u,0,.45)]);}
 return {name,kind:0,pts};
}
export const SKY_WAYS:SkyWay[]=[
 avenue(),
 // Doors (houses at x +-30, fronts at +-24.7), each path past a townsfolk spot; lantern posts (skyTownLayout) kept clear.
 garden('garden-w38',[[-3,31],[-9,34.4],[-16,38],[-20.5,38.7],[-23.2,38]],2.2,1.6),
 garden('garden-w56',[[-3,69],[-9.5,63.6],[-13,58.4],[-16,56],[-20.5,55.4],[-23.2,56]],2.2,1.6),
 garden('garden-w74',[[-3,75],[-8.5,76.4],[-12.5,76.4],[-16,74],[-20.5,73.5],[-23.2,74]],2.2,1.6),
 garden('garden-e38',[[3,44],[9,41.6],[16,38],[20.5,37.4],[23.2,38]],2.2,1.6),
 garden('garden-e56',[[3,60],[9,58],[16,56],[20.5,55.5],[23.2,56]],2.2,1.6),
 garden('garden-e74',[[3,62],[8,65.5],[12,69.5],[16,71],[20.5,73.4],[23.2,74]],2.2,1.6),
 garden('garden-e80',[[3,88],[9,85],[16,80],[19.5,76.8],[22,74.9]],2.1,1.5),
 // The spawn portal's lane.
 garden('spawn-lane',[[-13,84],[-8,84.9],[-3,84]],2.1,2.3),
 // Out to the herb grove behind the gardener's house, and to the shore lookout past the map maker's.
 garden('herb-path',[[-12,36.2],[-19,32.6],[-27,30],[-37,28.3],[-45,27],[-50,26],[-51.5,25.6]],1.7,1.35),
 garden('shore-path',[[3,9],[10,9.6],[20,12.6],[31,15.4],[42,18.6],[52,21.4],[61,22],[62.5,21.8]],1.8,1.35),
];
/** The ways as plain polylines (IslandPath shape: points, full width at the widest sample) for callers that want them;
 *  skyPathDistance / skyWayField are the exact test (per-sample widths, junction fillets, clearings). */
export const SKY_PATHS:{points:[number,number][];width:number}[]=SKY_WAYS.map(w=>({points:w.pts.map(([x,z])=>[x,z] as [number,number]),width:2*Math.max(...w.pts.map(p=>p[2]))}));
/** Round clearings where the long paths end: paved, ragged, with a ring of stones left in the grass. */
export const SKY_CLEARINGS:{x:number;z:number;r:number}[]=[{x:-50.5,z:25.8,r:3.2},{x:61.5,z:22,r:3.4}];

interface WaySeg{ax:number;az:number;bx:number;bz:number;ha:number;hb:number;kind:number}
const WAY_SEGS:WaySeg[][]=SKY_WAYS.map(w=>w.pts.slice(1).map(([bx,bz,hb],k)=>{const [ax,az,ha]=w.pts[k];return {ax,az,bx,bz,ha,hb,kind:w.kind};}));
const WAY_BOX=SKY_WAYS.map(w=>{let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9,h=0;for(const [x,z,hw] of w.pts){x0=Math.min(x0,x);x1=Math.max(x1,x);z0=Math.min(z0,z);z1=Math.max(z1,z);h=Math.max(h,hw);}return {x0:x0-h,x1:x1+h,z0:z0-h,z1:z1+h};});
/** Smooth-union radius where ways meet: junctions flare a little, like trodden corners. */
const JOIN=1.1;
const smin=(a:number,b:number,k:number)=>{const h=clamp01(.5+.5*(b-a)/k);return b+(a-b)*h-k*h*(1-h);};
const _way={d:0,across:0,kind:0};
/** Signed distance past the nearest paved edge (negative on the stones), the across-ratio (0 middle .. 1 edge) and kind of the nearest way. */
export function skyWayField(x:number,z:number){
 let sd=1e9,best=1e9,across=1,kind=0;
 for(let w=0;w<WAY_SEGS.length;w++){
  const b=WAY_BOX[w],out=Math.hypot(Math.max(b.x0-x,0,x-b.x1),Math.max(b.z0-z,0,z-b.z1));
  if(out>best+JOIN&&out>sd+JOIN)continue;
  let wd=1e9,wa=1;
  for(const s of WAY_SEGS[w]){
   const dx=s.bx-s.ax,dz=s.bz-s.az,l2=dx*dx+dz*dz||1e-6,t=clamp01(((x-s.ax)*dx+(z-s.az)*dz)/l2),c=Math.hypot(s.ax+dx*t-x,s.az+dz*t-z),h=s.ha+(s.hb-s.ha)*t,d=c-h;
   if(d<wd){wd=d;wa=c/h;}
  }
  if(wd<best){best=wd;across=wa;kind=WAY_SEGS[w][0].kind;}
  sd=sd>1e8?wd:smin(sd,wd,JOIN);
 }
 for(const c of SKY_CLEARINGS){const d=Math.hypot(x-c.x,z-c.z)-c.r;if(d<best){best=d;across=Math.min(across,Math.hypot(x-c.x,z-c.z)/c.r);}sd=smin(sd,d,JOIN);}
 _way.d=sd;_way.across=Math.min(1.5,across);_way.kind=kind;return _way;
}
/** How far (x, z) is from every way's paved edge (negative on the paving). */
export function skyPathDistance(x:number,z:number){return skyWayField(x,z).d;}
export const skyOnPath=(x:number,z:number)=>skyPathDistance(x,z)<=0;
/** The ways as a baked field for the shaders, 0.5 m texels over the paved area (+ margin): r signed distance, g across, b kind. */
export const SKY_WAY_FIELD=(()=>{let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;for(const b of WAY_BOX){x0=Math.min(x0,b.x0);x1=Math.max(x1,b.x1);z0=Math.min(z0,b.z0);z1=Math.max(z1,b.z1);}
 const m=8,cell=.5,minX=Math.floor(x0-m),minZ=Math.floor(z0-m);return {minX,minZ,cell,w:Math.ceil((x1+m-minX)/cell),h:Math.ceil((z1+m-minZ)/cell)};})();
let fieldCache:Float32Array|null=null;
export function skyWayFieldData():Float32Array{
 if(fieldCache)return fieldCache;
 const {minX,minZ,cell,w,h}=SKY_WAY_FIELD,out=new Float32Array(w*h*4);
 for(let j=0;j<h;j++)for(let i=0;i<w;i++){const f=skyWayField(minX+(i+.5)*cell,minZ+(j+.5)*cell),o=(j*w+i)*4;out[o]=Math.min(f.d,60);out[o+1]=f.across;out[o+2]=f.kind;out[o+3]=1;}
 fieldCache=out;return out;
}

/** House footprints (realmLayout's 5.3 x 5.8 boxes): nothing grows inside, contact shade round them. */
export const SKY_HOUSES:[number,number][]=[];for(const side of [-1,1])for(let i=0;i<3;i++)SKY_HOUSES.push([side*30,38+i*18]);
const rectDist=(x:number,z:number,cx:number,cz:number,hx:number,hz:number)=>Math.hypot(Math.max(Math.abs(x-cx)-hx,0),Math.max(Math.abs(z-cz)-hz,0));
/** Distance from the town's solids (houses, stalls, cart, cargo, the mast, the glasshouse). */
function townSolidDist(x:number,z:number){
 let d=1e9;
 for(const [hx,hz] of SKY_HOUSES)d=Math.min(d,rectDist(x,z,hx,hz,5.3,5.8));
 for(const s of SKY_STALLS)d=Math.min(d,Math.hypot(x-s.x,z-s.z)-2.7);
 d=Math.min(d,Math.hypot(x-SKY_CART.x,z-SKY_CART.z)-1.4,Math.hypot(x-SKY_MAST.x,z-SKY_MAST.z)-2.3,rectDist(x,z,SKY_GLASSHOUSE.x,SKY_GLASSHOUSE.z,SKY_GLASSHOUSE.hx,SKY_GLASSHOUSE.hz));
 for(const c of SKY_CARGO)d=Math.min(d,rectDist(x,z,c.x,c.z,c.hx,c.hz));
 return d;
}

/** Every quest, NPC and enemy point in World VI (FRONTIER_POINTS[6] and the sim's POIs): solids keep away. */
const KEEP_CLEAR:[number,number,number][]=[
 [-12,78,3],[12,72,3],[-12,56,3],[-47,40,4],[-52,28,4],[-44,14,4],[-7,26,3],[7,4,3],[-7,-22,3],[-50,26,9],[61,22,6],[0,-34,4],
 [36,8,4],[44,-6,8],[34,-22,4],[62,34,4],[68,20,4],[60,4,4],[-17,-34,4],[17,-42,4],[-16,-54,4],[16,68,5],[16,56,5],[-16,74,5],[0,-44,6],[-12,84,4],
 [-16,56,3],[-16,38,3],[16,38,3],[16,80,3],[-7.4,-40,2.5],[7.4,-40,2.5],
];
/** Enemy homes (createFrontierDefinition, up to 16 + 16): x +-(44..65), z 20 down in 12 m rows; solids keep off their wander discs. */
for(let index=0;index<32;index++){const x=(index%2?1:-1)*(44+index%4*7),z=20-Math.floor(index/2)*12;KEEP_CLEAR.push([x,z,6.5]);}
export function skyClearOfPoints(x:number,z:number,margin=0){for(const [px,pz,r] of KEEP_CLEAR)if(Math.hypot(x-px,z-pz)<r+margin)return false;return true;}

/*
 * The forest, in groups with open meadow between them (the frontier's evenly strewn spots are gone in W6; its
 * colliders are this lane's). Each standard view gets one focal group: east of town a blossom grove round a mossy
 * outcrop, west a silver twisted elder dell. Smaller copses frame the town, the harbour and the sanctuary's flanks.
 */
export type SkyTreeSpecies='jade'|'blossom'|'white'|'silver';
export interface SkyTreeSpot{/** stable id within the forest */i:number;x:number;z:number;s:number;species:SkyTreeSpecies;yaw:number;/** visual size over the collider's scale */grand:number}
export interface SkyGrove{name:string;x:number;z:number;r:number;species:SkyTreeSpecies[];/** boulders in its outcrop (0 for none) */rocks:number;log:boolean}
export const SKY_GROVES:SkyGrove[]=[
 {name:'east-blossom-grove',x:81,z:-13,r:9,species:['blossom','white','blossom','jade','blossom','jade'],rocks:4,log:true},
 {name:'west-elder-dell',x:-79,z:-12,r:9,species:['silver','silver','jade','white','silver'],rocks:4,log:true},
 {name:'town-west-garden',x:-45,z:63,r:6,species:['blossom','jade','white'],rocks:0,log:false},
 {name:'town-east-garden',x:43,z:42,r:4.5,species:['jade','blossom'],rocks:0,log:false},
 {name:'harbour-west',x:-37,z:95,r:7,species:['jade','white','jade','blossom'],rocks:2,log:false},
 {name:'harbour-east',x:33,z:99,r:6,species:['silver','jade','blossom'],rocks:0,log:true},
 {name:'sanctuary-west',x:-33,z:-60,r:7,species:['jade','silver','white','jade'],rocks:3,log:false},
 {name:'sanctuary-east',x:37,z:-62,r:7,species:['blossom','jade','silver','jade'],rocks:0,log:true},
 {name:'north-east-copse',x:79,z:-52,r:6,species:['silver','white','jade'],rocks:2,log:false},
 {name:'north-west-copse',x:-76,z:-50,r:6,species:['jade','blossom','jade'],rocks:0,log:true},
 {name:'herb-grove',x:-63,z:40,r:6,species:['blossom','white','jade'],rocks:2,log:false},
 {name:'shore-pair',x:79,z:31,r:4,species:['white','blossom'],rocks:0,log:false},
 {name:'south-west-pair',x:-59,z:77,r:4.5,species:['jade','silver'],rocks:2,log:false},
 {name:'south-east-copse',x:56,z:82,r:5,species:['blossom','jade','white'],rocks:0,log:false},
];
/** Rock groups out in the open fields (3-5 stones, sizes 4 : 1), so each field has a secondary accent. */
export const SKY_ROCK_GROUPS=[{name:'east-field-stones',x:77,z:5,r:4,n:5},{name:'west-field-stones',x:-71,z:1,r:4,n:4}];

/**
 * Planted drifts (Jekyll): long soft-edged swathes along the wind (x .8, z .6), one colour each with a stray of
 * another, cool beside warm. Each field view gets them on the near slope between the camera and the crab (the
 * ground beyond falls away to the rim); the approach gets two.
 * hue: 0 pink .. 1 butter (skyBloomHue's scale).
 */
export const SKY_DRIFTS=[
 {x:45,z:-10,len:17,wid:6,hue:.08},{x:52,z:5,len:13,wid:4.2,hue:.62},{x:57,z:-21,len:10,wid:3.4,hue:.92},
 {x:-45,z:-2,len:19,wid:7,hue:.62},{x:-52,z:-17,len:13,wid:4.4,hue:.08},{x:-56,z:9,len:10,wid:3.4,hue:.92},
 {x:13,z:-19,len:11,wid:3,hue:.92},{x:-16,z:-30,len:10,wid:2.8,hue:.62},{x:-14,z:2,len:9,wid:2.6,hue:.08},
];
/** Whether a tree of scale s may stand at (x, z). */
function freeForTree(x:number,z:number,s:number){
 if(skyEdge(x,z)>.755||skyPathDistance(x,z)<3+1.2*s||!skyClearOfPoints(x,z,1.6))return false;
 if(Math.hypot(x-SKY_ARENA.x,z-SKY_ARENA.z)<SKY_ARENA.r+8||(z<-84&&Math.abs(x)<36))return false;
 return townSolidDist(x,z)>3.2;
}
let treeCache:SkyTreeSpot[]|null=null;
export function skyTrees():SkyTreeSpot[]{
 if(treeCache)return treeCache;
 const out:SkyTreeSpot[]=[];
 SKY_GROVES.forEach((g,gi)=>{
  let placed=0;
  for(let k=0;k<80&&placed<g.species.length;k++){
   // The first tree near the group's heart, the rest round it; sizes vary so the group reads as one mass.
   const a=skyHash(gi,k,91)*Math.PI*2,d=placed===0?skyHash(gi,k,92)*g.r*.3:(.35+.65*Math.sqrt(skyHash(gi,k,92)))*g.r;
   const x=g.x+Math.cos(a)*d,z=g.z+Math.sin(a)*d,s=placed===0?1.18+.12*skyHash(gi,k,93):.8+.35*skyHash(gi,k,93);
   if(!freeForTree(x,z,s)||out.some(t=>Math.hypot(t.x-x,t.z-z)<2.4*(t.s+s)+.6))continue;
   out.push({i:gi*10+placed,x,z,s,species:g.species[placed],yaw:skyHash(gi,k,94)*Math.PI*2,grand:gi<2?(placed===0?1.32:1.14):1.04});placed++;
  }
 });
 treeCache=out;return out;
}

/** Shrubs, ferns, boulders and logs: placed once here, clear of the ways, quest points and solids. */
export interface SkyProp{kind:'shrub'|'bloomshrub'|'fern'|'boulder'|'stone'|'log'|'flowers'|'mushroom';x:number;z:number;s:number;yaw:number}
/** Whether a solid (boulder, log) of radius r may stand at (x, z). */
function freeForSolid(x:number,z:number,r:number){
 if(skyEdge(x,z)>.75||skyPathDistance(x,z)<r+2.2||!skyClearOfPoints(x,z,r+.4))return false;
 if(Math.hypot(x-SKY_ARENA.x,z-SKY_ARENA.z)<SKY_ARENA.r+6+r||(z<-84&&Math.abs(x)<36))return false;
 if(skyTown(x,z)>.01||townSolidDist(x,z)<r+2)return false;
 for(const t of skyTrees())if(Math.hypot(x-t.x,z-t.z)<r+1.6*t.s)return false;
 return true;
}
let propCache:SkyProp[]|null=null;
export function skyProps():SkyProp[]{
 if(propCache)return propCache;
 const out:SkyProp[]=[];
 const solids:{x:number;z:number;r:number}[]=[];
 const free=(x:number,z:number,r:number)=>freeForSolid(x,z,r)&&solids.every(s=>Math.hypot(s.x-x,s.z-z)>s.r+r+.25);
 // An outcrop: a big stone and smaller ones leaning on it (sizes 4 : 1), packed tight, on one side of the group.
 const outcrop=(gx:number,gz:number,spread:number,n:number,big:number,seed:number)=>{
  const side=skyHash(seed,0,10)*Math.PI*2,mine:{x:number;z:number;r:number}[]=[];let cx=gx,cz=gz;
  for(let k=0;k<n*12&&mine.length<n;k++){
   const first=mine.length===0,s=big*(first?1:.25+.5*skyHash(seed,k,13)),a=first?side+(skyHash(seed,k,11)-.5)*1.5:side+(skyHash(seed,k,11)-.5)*3.4;
   const d=first?spread*(.35+.4*skyHash(seed,k,12)):(big+s)*(.8+.3*skyHash(seed,k,12)),x=(first?gx:cx)+Math.cos(a)*d,z=(first?gz:cz)+Math.sin(a)*d,r=s*1.2;
   // Stones of one outcrop lean on each other; they keep clear of everything else.
   if(!freeForSolid(x,z,r)||solids.some(q=>!mine.includes(q)&&Math.hypot(q.x-x,q.z-z)<q.r+r+.25))continue;
   if(first){cx=x;cz=z;}
   const q={x,z,r};mine.push(q);solids.push(q);out.push({kind:s>1.2?'boulder':'stone',x,z,s,yaw:skyHash(seed,k,14)*6.28});
  }
 };
 SKY_GROVES.forEach((g,gi)=>{
  if(g.rocks)outcrop(g.x,g.z,g.r,g.rocks,gi<2?2.1:1.4,gi*7+3);
  if(g.log)for(let k=0;k<14;k++){
   const a=skyHash(gi,k,21)*Math.PI*2,d=(.45+.6*skyHash(gi,k,22))*g.r,x=g.x+Math.cos(a)*d,z=g.z+Math.sin(a)*d,yaw=skyHash(gi,k,23)*Math.PI,len=gi<2?5.5:4.2;
   // A log's footprint: its two ends and middle.
   if(![-.45,0,.45].every(f=>free(x+Math.cos(yaw)*len*f,z+Math.sin(yaw)*len*f,.7)))continue;
   for(const f of [-.45,0,.45])solids.push({x:x+Math.cos(yaw)*len*f,z:z+Math.sin(yaw)*len*f,r:.7});
   out.push({kind:'log',x,z,s:len,yaw});break;
  }
  // Undergrowth gathers inside the group: ferns and shrubs at the feet, flowering shrubs and a clump of blooms at its sunny rim.
  const n=gi<2?34:Math.round(g.species.length*5);
  for(let k=0;k<n;k++){
   const a=skyHash(gi,k,31)*Math.PI*2,d=Math.pow(skyHash(gi,k,32),.7)*g.r*1.15,x=g.x+Math.cos(a)*d,z=g.z+Math.sin(a)*d;
   if(skyEdge(x,z)>.77||skyPathDistance(x,z)<1.6||!skyClearOfPoints(x,z,-1.5)||townSolidDist(x,z)<.8||solids.some(s=>Math.hypot(s.x-x,s.z-z)<s.r+.3))continue;
   const r=skyHash(gi,k,33),rim=d/(g.r*1.15),kind=r<.36?'fern':r<.62?'shrub':r<.8?'bloomshrub':r<.94&&rim>.5?'flowers':r<.94?'fern':'mushroom';
   out.push({kind,x,z,s:(kind==='fern'?1.1:kind==='mushroom'?.9:1)*(.75+.5*skyHash(gi,k,34)),yaw:skyHash(gi,k,35)*6.28});
  }
 });
 SKY_ROCK_GROUPS.forEach((g,k)=>outcrop(g.x,g.z,g.r,g.n,1.5,90+k));
 // Round the foot of every tree: a shrub or a few ferns.
 for(const t of skyTrees()){
  const n=1+Math.floor(skyHash(t.i,1,41)*2);
  for(let k=0;k<n;k++){
   const a=t.yaw+k*2.4+skyHash(t.i,k,42),d=(1.5+1.4*skyHash(t.i,k,43))*t.s,x=t.x+Math.cos(a)*d,z=t.z+Math.sin(a)*d;
   if(skyEdge(x,z)>.77||skyPathDistance(x,z)<1.4||townSolidDist(x,z)<.8)continue;
   const r=skyHash(t.i,k,44),kind=r<.5?'fern':r<.8?'shrub':(t.species==='blossom'||t.species==='white')?'bloomshrub':'fern';
   out.push({kind,x,z,s:.7+.45*skyHash(t.i,k,45),yaw:skyHash(t.i,k,46)*6.28});
  }
 }
 // The path clearings: a few stones left round their rim.
 SKY_CLEARINGS.forEach((c,ci)=>{for(let k=0,placed=0;k<12&&placed<3;k++){const a=skyHash(ci,k,61)*6.28,x=c.x+Math.cos(a)*(c.r+1.9),z=c.z+Math.sin(a)*(c.r+1.9),s=.35+.25*skyHash(ci,k,62);if(!free(x,z,s*1.2)||skyPathDistance(x,z)<s*1.2+.6)continue;solids.push({x,z,r:s*1.2});out.push({kind:'stone',x,z,s,yaw:skyHash(ci,k,63)*6.28});placed++;}});
 propCache=out;return out;
}
/** Colliders for the trees and the solid props (boulders, stones, logs): x, z, radius, height above the ground. */
export function skySolids():{x:number;z:number;r:number;h:number}[]{
 const out:{x:number;z:number;r:number;h:number}[]=[];
 for(const t of skyTrees())out.push({x:t.x,z:t.z,r:.7*t.s,h:12*t.s});
 for(const p of skyProps()){
  if(p.kind==='boulder')out.push({x:p.x,z:p.z,r:p.s*1.15,h:p.s*1.6});
  else if(p.kind==='stone')out.push({x:p.x,z:p.z,r:p.s*1.05,h:p.s*1.1});
  else if(p.kind==='log')for(const f of [-.4,0,.4])out.push({x:p.x+Math.cos(p.yaw)*p.s*f,z:p.z+Math.sin(p.yaw)*p.s*f,r:.62,h:1.1});
 }
 return out;
}

/*
 * The ground map: the island at 1 m, three RGBA8 layers.
 *  soil:  r grass, g worn, b patch (.5 plain, under .5 moss, over .5 bare soil), a wildflowers;
 *  aux:   r contact shade, g blossom colour of the drift (0 pink .. 1 butter), b bare (nothing grows), a blade height;
 *  extra: r clover, g pebbles (path margins, doors, clearings), b path fringe (1 at the paved edge .. 0 by 3 m), a mown lawn.
 * Trees, props and houses are splatted into it (cheap at load); everything else is a few noises per texel.
 */
export interface SkyGroundMap{soil:Uint8Array;aux:Uint8Array;extra:Uint8Array;w:number;h:number}
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
  const r=(t.species==='silver'?4.2:3.6)*t.s*t.grand;splat(t.x,t.z,r,(d,i)=>{shade[i]=Math.max(shade[i],.55*(1-smooth(d,r*.2,r)));});
  splat(t.x,t.z,8*t.s,(d,i)=>{edge[i]=Math.max(edge[i],1-smooth(d/t.s,3.5,8));});
 }
 for(const p of skyProps()){
  if(p.kind==='flowers')continue;
  const solid=p.kind==='boulder'||p.kind==='log',r=p.kind==='boulder'?p.s*2.1:p.kind==='log'?p.s*.55:p.kind==='stone'?p.s*1.6:p.s*1.1,k=solid?.6:.35;
  if(p.kind==='log'){for(const f of [-.4,-.2,0,.2,.4])splat(p.x+Math.cos(p.yaw)*p.s*f,p.z+Math.sin(p.yaw)*p.s*f,1.4,(d,i)=>{shade[i]=Math.max(shade[i],.55*(1-smooth(d,.3,1.4)));});}
  else splat(p.x,p.z,r,(d,i)=>{shade[i]=Math.max(shade[i],k*(1-smooth(d,r*.2,r)));});
  if(p.kind==='boulder'||p.kind==='stone')splat(p.x,p.z,p.s*.9,(_d,i)=>{bare[i]=1;});
  splat(p.x,p.z,3,(d,i)=>{edge[i]=Math.max(edge[i],(1-smooth(d,1,3))*.6);});
 }
 const soil=new Uint8Array(n*4),aux=new Uint8Array(n*4),extra=new Uint8Array(n*4),u8=(v:number)=>Math.max(0,Math.min(255,Math.round(v*255)));
 // Doors face the high street (x +-24.7); the market stalls and the cart stand on worn ground.
 const doors=SKY_HOUSES.map(([hx,hz])=>[hx-Math.sign(hx)*6.1,hz] as const);
 for(let j=0;j<h;j++)for(let i=0;i<w;i++){
  const x=minX+i+.5,z=minZ+j+.5,k=j*w+i,o=k*4;
  const town=skyTown(x,z),pd=skyPathDistance(x,z),rag=fbm(x/3,z/3,5),edgeR=skyEdge(x,z);
  let ao=shade[k];
  for(const [hx,hz] of SKY_HOUSES){const d=rectDist(x,z,hx,hz,5.2,5.7);if(d<3)ao=Math.max(ao,.5*(1-smooth(d,0,3)));}
  const wt=Math.hypot(x-SKY_TREE.x,z-SKY_TREE.z);ao=Math.max(ao,.45*(1-smooth(wt,6,22)));
  // Worn: a ragged trodden lip along the ways, bare earth fanned out at each door, round the stalls and the cart.
  let worn=(1-smooth(pd,0,.7+rag*.8))*.5*smooth(fbm(x/2.5,z/2.5,6),-.25,.3);
  let doorWear=0;
  for(const [dx,dz] of doors){const e=Math.hypot((x-dx)/1.7,(z-dz)/2.7);doorWear=Math.max(doorWear,(1-smooth(e+rag*.3,.35,1.25)));}
  worn=Math.max(worn,doorWear*.9);
  for(const s of [...SKY_STALLS,SKY_CART]){const d=Math.hypot(x-s.x,z-s.z);worn=Math.max(worn,(1-smooth(d+rag*1.2,2,4.2))*.7);}
  const ra=Math.hypot(x-SKY_ARENA.x,z-SKY_ARENA.z);worn=Math.max(worn,(1-smooth(ra+rag*1.5,SKY_ARENA.r,SKY_ARENA.r+4))*.75);
  worn=Math.max(worn,(1-smooth(wt+rag*2,7,12))*.6);
  // Moss in the shade and in damp hollows, bare soil in a few open patches.
  const patch=fbm(x/11,z/11,13),moss=Math.max(ao*1.2,smooth(patch,.42,.65)*.5)*(1-town*.7),dirt=smooth(-patch,.68,.8)*smooth(fbm(x/3.5,z/3.5,14),-.1,.3)*(1-town)*.85;
  const grass=Math.max(0,1-worn*1.05)*(1-.35*dirt);
  // Wildflowers in drifts (style sheet: 8-15% of the ground): long swathes combed along the wind (3 : 1), thickest at
  // the forest's edge, none on worn ground or within 1.5 m of a way, few in the mown town.
  const wx=x*.8+z*.6,wz=-x*.6+z*.8,drift=fbm(wx/24,wz/8,17)+.3*fbm(x/4,z/4,19);
  let flowers=smooth(drift+edge[k]*.4-.45*town,.33,.56),hue=skyBloomHue(x,z);
  for(const d of SKY_DRIFTS){const u=((x-d.x)*.8+(z-d.z)*.6)/d.len,v=(-(x-d.x)*.6+(z-d.z)*.8)/d.wid,e=Math.hypot(u,v)+rag*.18,f=1-smooth(e,.55,1);if(f>flowers*.7){hue=d.hue;}flowers=Math.max(flowers,f);}
  flowers*=(1-worn)*(1-dirt*.6)*(1-smooth(edgeR,.74,.8));
  flowers*=smooth(pd,1.5,2.4);
  let isBare=bare[k]===1;
  if(!isBare){
   for(const [hx,hz] of SKY_HOUSES)if(rectDist(x,z,hx,hz,5.4,5.9)<.6){isBare=true;break;}
   if(townSolidDist(x,z)<.3)isBare=true;
   if(Math.hypot(x+12,z-84)<3.2||ra<SKY_ARENA.r+.6||wt<7)isBare=true;
   for(let q=0;q<10&&!isBare;q++){const a=(q+1)/12*Math.PI*2,px=Math.sin(a)*23,pz=-72+Math.cos(a)*23;if(pz<=-56&&Math.hypot(x-px,z-pz)<2)isBare=true;}
  }
  // Blade height: short mown turf in town, tall at the forest's edge and the field margins.
  const tall=Math.min(1,.55+.3*edge[k]+.25*smooth(fbm(x/14,z/14,29),0,.5))*(1-.5*town);
  // Clover: soft rounded patches in the mown lawns and along the ways' fringes, a few out in the meadow.
  const fringe=1-smooth(pd,0,3);
  const clover=smooth(fbm(x/5.5+11,z/5.5,41)+.35*fbm(x/1.7,z/1.7,43),.18,.42)*clamp01(.25+.75*Math.max(town,fringe*.8))*(1-worn*.8)*(1-dirt);
  // Pebbles: kicked to the ways' margins, at the doors and round the clearings.
  const pebbles=clamp01((1-smooth(pd,-.1,1.4))*.75*smooth(fbm(x/1.6,z/1.6,47),-.3,.25)+doorWear*.5);
  soil[o]=u8(grass);soil[o+1]=u8(worn);soil[o+2]=u8(.5+.5*(dirt-moss));soil[o+3]=u8(flowers);
  aux[o]=u8(ao);aux[o+1]=u8(hue);aux[o+2]=isBare?255:0;aux[o+3]=u8(tall);
  extra[o]=u8(clover);extra[o+1]=u8(pebbles);extra[o+2]=u8(fringe);extra[o+3]=u8(town);
 }
 mapCache={soil,aux,extra,w,h};return mapCache;
}
/** Which of the four blossom colours a drift at (x, z) carries: 0 pink .. 1 butter (pink, white, lilac, butter). */
export function skyBloomHue(x:number,z:number){const v=fbm(x/26+40,z/26,23)*.5+.5;return Math.max(0,Math.min(.999,v*1.35-.18));}
/** The ground map at (x, z), nearest texel: [grass, worn, patch, flowers, shade, hue, bare, tall, clover, pebbles, fringe, lawn], each 0..1. */
export function skyGroundAt(x:number,z:number):number[]{
 const m=skyGroundMap(),i=Math.max(0,Math.min(m.w-1,Math.floor(x-SKY_MAP.minX))),j=Math.max(0,Math.min(m.h-1,Math.floor(z-SKY_MAP.minZ))),o=(j*m.w+i)*4;
 return [m.soil[o]/255,m.soil[o+1]/255,m.soil[o+2]/255,m.soil[o+3]/255,m.aux[o]/255,m.aux[o+1]/255,m.aux[o+2]/255,m.aux[o+3]/255,m.extra[o]/255,m.extra[o+1]/255,m.extra[o+2]/255,m.extra[o+3]/255];
}
