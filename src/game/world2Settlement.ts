import * as THREE from 'three';
import { loadKit, StaticBatch, Scatter, trs } from '../world/kit';
import { TownBuilder } from '../world/buildings';
import { Collision, type CollisionTerrain } from '../world/collision';
import type { Lot } from '../world/layout';
import type { NpcId, ObjectiveKind } from './quests';

export const STAR_TOWN: Record<NpcId, [number,number]> = {
  brinebeard:[0,67], hoofclaw:[-20,58], pip:[-25,36], coralline:[20,35],
  silvermoon:[25,55], grukk:[0,20], rattlebolt:[18,76],
};
export const STAR_OBJECTIVES: Partial<Record<ObjectiveKind,[number,number]>> = {
  'crystal-a':[-65,22], 'crystal-b':[-80,-10], 'crystal-c':[65,12], 'crystal-d':[80,-20],
  'lamp-a':[0,15], 'lamp-b':[25,-15], 'lamp-c':[0,-45],
  'explore-west':[-75,-35], 'explore-east':[80,-40], 'explore-north':[0,-48],
};
// Forking pilgrim trails connect the village to each exploration destination.
export const STAR_TRAILS: [number,number][][] = [
  [[0,24],[-16,24],[-38,8],[-65,22],[-80,-10],[-75,-35]],
  [[0,24],[18,20],[40,6],[65,12],[80,-20],[80,-40]],
  [[0,15],[0,0],[25,-15],[14,-31],[0,-45],[0,-48]],
];
export function starTrailDistance(x:number,z:number){
  let best=Infinity;
  for(const trail of STAR_TRAILS)for(let i=1;i<trail.length;i++){
    const [ax,az]=trail[i-1],[bx,bz]=trail[i],dx=bx-ax,dz=bz-az;
    const u=THREE.MathUtils.clamp(((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz),0,1);
    best=Math.min(best,Math.hypot(x-ax-u*dx,z-az-u*dz));
  }
  return best;
}
export function nearStarObjective(x:number,z:number,padding=0){
  return Object.entries(STAR_OBJECTIVES).some(([kind,p])=>Math.hypot(x-p[0],z-p[1])<(kind.startsWith('explore-')?13:4)+padding);
}
export const STAR_WALKS = [[-15,62],[0,61],[15,62],[-15,44],[0,36],[15,44],[0,72],[0,24]];

/** Deterministic, batched geometry; shared asset textures remain owned by the base world. */
export async function buildStarSettlement(height:(x:number,z:number)=>number) {
  const root=new THREE.Group();root.name='starhaven-settlement';
  const terrain:CollisionTerrain={minX:-140,minZ:-150,step:2,nx:141,nz:161,heightAt:height,h:new Float32Array(141*161)};
  for(let j=0;j<terrain.nz;j++)for(let i=0;i<terrain.nx;i++)terrain.h[j*terrain.nx+i]=height(terrain.minX+i*2,terrain.minZ+j*2);
  const collision=new Collision(terrain);
  const village=await loadKit('models/world/village.glb');
  const nature=await loadKit('models/world/nature.glb');
  const props=await loadKit('models/world/props.glb');
  // Clone materials so lighting the new village never recolours the old one.
  for(const kit of [village,nature,props]) {
    const copies=new Map<THREE.Material,THREE.Material>();
    for(const [name,m] of kit.materials){const c=m.clone();copies.set(m,c);kit.materials.set(name,c);}
    for(const piece of kit.pieces.values())for(const part of piece.parts)part.material=copies.get(part.material)!;
  }
  const batch=new StaticBatch(village,'starhaven-homes');
  const builder=new TownBuilder(village,batch,collision,{});
  const lots:Lot[]=[
    {id:'star-forge',kind:'forge',x:-34,z:29,yaw:0,sx:4,sz:3,floors:1,style:0,h:3},
    {id:'star-chapel',kind:'chapel',x:29,z:24,yaw:0,sx:4,sz:6,floors:2,style:0,h:3},
    {id:'star-tavern',kind:'tavern',x:-30,z:63,yaw:Math.PI/2,sx:4,sz:5,floors:2,style:0,h:3},
  ];
  for(const [i,x,z] of [[0,-28,82],[1,30,84],[2,-43,47],[3,44,48],[4,-20,14],[5,19,9],[6,-43,73],[7,44,70]]) {
    lots.push({id:`star-home-${i}`,kind:'house',x,z,yaw:Math.atan2(-x,55-z),sx:3,sz:3,floors:i%3?2:1,style:i%4,h:3});
  }
  for(const lot of lots)builder.build(lot);
  root.add(batch.build());
  const dressing=new StaticBatch(props,'starhaven-market');
  const villageProps=new StaticBatch(village,'starhaven-gardens');
  const put=(name:string,x:number,z:number,yaw=0,scale=1,dy=0)=>{if(props.has(name))dressing.add(name,trs(x,height(x,z)+dy,z,yaw,scale));};
  for(const [i,x,z] of [[0,-12,48],[1,12,48],[2,-12,70],[3,12,70]]) {
    put('Stall_Empty',x,z,i%2?Math.PI:0);put('Barrel_Apples',x+2,z+1);put('FarmCrate_Apple',x-.5,z,0,1,.82);put('FarmCrate_Carrot',x+.5,z,0,1,.82);put('Crate_Wooden',x-2,z+1);
  }
  // Asset names vary between kit versions: select actual named pieces, not invisible placeholders.
  const names=[...props.pieces.keys()];
  const barrel=names.find(n=>/barrel/i.test(n)),crate=names.find(n=>/crate/i.test(n)),bench=names.find(n=>/bench/i.test(n));
  for(let i=0;i<18;i++){const x=(i%2?1:-1)*(19+i%3*3),z=30+Math.floor(i/2)*6;if(barrel)put(barrel,x,z,i*.7,.85);if(crate&&i%3===0)put(crate,x+1.4,z+.7,0,.8);}
  if(bench)for(const [x,z] of [[-8,55],[8,55],[-8,61],[8,61]])put(bench,x,z,x<0?Math.PI/2:-Math.PI/2);
  if(village.has('Prop_Wagon'))for(const x of [-15,15])villageProps.add('Prop_Wagon',trs(x,3,88,x>0?.4:-.4));
  for(const lot of lots)for(let j=-2;j<=2;j++)if(village.has('Prop_WoodenFence_Single'))villageProps.add('Prop_WoodenFence_Single',trs(lot.x+j*2,3,lot.z-7,0));
  const lampMat=new THREE.MeshStandardMaterial({color:'#ffd295',emissive:'#ffae4d',emissiveIntensity:2.8,roughness:.4});
  const poleMat=new THREE.MeshStandardMaterial({color:'#343442',metalness:.7,roughness:.45});
  const poles=new THREE.InstancedMesh(new THREE.CylinderGeometry(.09,.18,3.4,6),poleMat,26);
  const bulbs=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.26),lampMat,26);
  for(let i=0;i<26;i++) {
    const side=i%2?1:-1, z=86-Math.floor(i/2)*6, x=side*(z>20?8:6);
    poles.setMatrixAt(i,trs(x,height(x,z)+1.7,z));bulbs.setMatrixAt(i,trs(x,height(x,z)+3.5,z));
    if(props.has('Lantern_Wall'))put('Lantern_Wall',x,z,side>0?-Math.PI/2:Math.PI/2,.8,2.5);
  }
  root.add(poles,bulbs);
  for(const [x,z] of [[0,57],[-25,36],[20,35],[0,76]]){const light=new THREE.PointLight('#ffc78b',18,30,1.5);light.position.set(x,7,z);root.add(light);}
  // Warm stained windows contrast with the cold moonlit wilderness.
  const windowGlows=new THREE.InstancedMesh(new THREE.SphereGeometry(.12,5,4),lampMat,builder.lights.length);
  builder.lights.forEach((spot,i)=>windowGlows.setMatrixAt(i,trs(spot.pos.x,spot.pos.y,spot.pos.z)));root.add(windowGlows);
  root.add(dressing.build(),villageProps.build());
  const scatter=new Scatter(nature,'star-island-forests');
  const rand=(i:number)=>{const a=Math.sin(i*127.1+23.7)*43758.5453;return a-Math.floor(a);};
  const treeNames=[...nature.pieces.keys()].filter(n=>/^CommonTree_[1-5]$/.test(n));
  const rockNames=[...nature.pieces.keys()].filter(n=>/^Rock_Medium_/.test(n));
  const flowerNames=[...nature.pieces.keys()].filter(n=>/Flower_[34]_Group|Bush_Common_Flowers/.test(n));
  for(let i=0;i<340;i++) {
    const x=(rand(i+100)-.5)*215,z=(rand(i+900)-.5)*255+10;
    if(Math.hypot(x/110,(z-10)/130)>.88 || Math.abs(x)<11 || Math.hypot(x,z+75)<27)continue;
    if(Math.abs(x)<53&&z>3&&z<98)continue;
    if(starTrailDistance(x,z)<3)continue;
    if(nearStarObjective(x,z))continue;
    const list=i%5===0?rockNames:treeNames;if(!list.length)continue;
    const scale=i%5===0?1.2+rand(i+88):.6+rand(i+55)*.65;
    scatter.add(list[i%list.length],trs(x,height(x,z),z,rand(i+40)*6.28,scale));
    if(i%5!==0)collision.addCircle(x,z,.5*scale,height(x,z),height(x,z)+8);
  }
  for(let i=0;i<240;i++) {
    const x=(rand(i+1800)-.5)*105,z=10+rand(i+2500)*86;
    if(Math.abs(x)<12||lots.some(l=>Math.abs(x-l.x)<l.sx+3&&Math.abs(z-l.z)<l.sz+4))continue;
    if(flowerNames.length)scatter.add(flowerNames[i%flowerNames.length],trs(x,height(x,z),z,rand(i+3000)*6.28,.7));
  }
  root.add(scatter.build());
  const roadMat=new THREE.MeshStandardMaterial({color:'#797886',roughness:.95});
  const roads=new StaticBatch(village,'starhaven-roads');
  const slab=new THREE.BoxGeometry(1.8,.12,1.8);
  for(let z=-72;z<=92;z+=2)for(let x=-4;x<=4;x+=2)if(Math.hypot(x,z-55)>3.7)roads.addGeometry(slab,roadMat,trs(x,height(x,z)+.015,z,0,1),false);
  for(let x=-26;x<=26;x+=2)for(let z=52;z<=58;z+=2)roads.addGeometry(slab,roadMat,trs(x,height(x,z)+.02,z),false);
  const trailMat=new THREE.MeshStandardMaterial({color:'#676979',roughness:.95});
  const trailSlab=new THREE.BoxGeometry(1.65,.1,1.55);
  for(const trail of STAR_TRAILS)for(let i=1;i<trail.length;i++){
    const [ax,az]=trail[i-1],[bx,bz]=trail[i],distance=Math.hypot(bx-ax,bz-az),steps=Math.ceil(distance/1.9),yaw=Math.atan2(bx-ax,bz-az);
    for(let j=0;j<steps;j++){
      const u=j/steps,x=ax+(bx-ax)*u,z=az+(bz-az)*u;
      // Keep the broad, paved village road clear of a second layer.
      if(Math.abs(x)<6)continue;
      roads.addGeometry(trailSlab,trailMat,trs(x,height(x,z)+.075,z,yaw),false);
    }
  }
  root.add(roads.build());slab.dispose();trailSlab.dispose();
  for(const kit of [village,nature,props])for(const piece of kit.pieces.values())for(const part of piece.parts)part.geometry.dispose();
  return {root,collision,lots};
}
