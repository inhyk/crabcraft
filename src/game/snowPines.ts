import * as THREE from 'three';
import {loadKit,Scatter,trs} from '../world/kit';
import {stylise} from '../world/materials';
import {snowCover} from './snowCover';

/*
 * Frostlight's forest: the Stylized Nature MegaKit pines (CC0, see NOTICE.md) on the snowTrees() trunks, one
 * BatchedMesh per kit material for the whole forest. Snow settles in the shader (snowCover.ts): world-space
 * normals that face up, broken by drift noise and a per-tree load, so every bough carries its own uneven cap and
 * the trunk only a dusting. The kit's summer green is cooled towards the island's ice palette underneath.
 */

const SNOW_PINE_FOREST='frostlight-snow-pines';
const PINES=['Pine_1','Pine_2','Pine_3','Pine_4','Pine_5'];
/** Height at s=1, a little over the cone trees these replace; crowns are widened to keep the forest as full. */
const TREE_HEIGHT=10.2,CROWN_WIDTH=1.12;

/** Small deterministic integer hash: the same species, yaw and lean on every client. */
function mix32(i:number){let h=Math.imul(i+1,0x9e3779b1);h^=h>>>15;h=Math.imul(h,0x85ebca6b);h^=h>>>13;return h>>>0;}

/** Every snowTrees() entry as a kit pine. Resolves to a group of BatchedMeshes, one per kit material. `name` names the group. */
export async function snowPines(trees:readonly {x:number;z:number;s:number}[],height:(x:number,z:number)=>number,name=SNOW_PINE_FOREST){
 const nature=await loadKit('models/world/nature.glb'),forest=new Scatter(nature,name);
 const names=PINES.filter(n=>nature.has(n));
 trees.forEach(({x,z,s},i)=>{
  const h=mix32(i),piece=names[h%names.length],box=nature.get(piece).box;
  const scale=TREE_HEIGHT*s/(box.max.y-box.min.y),yaw=(h>>>8&0xffff)/65536*Math.PI*2;
  const pitch=((h>>>4&0xf)/15-.5)*.05,roll=((h>>>24&0xf)/15-.5)*.05;
  forest.add(piece,trs(x,height(x,z)-.12*scale,z,yaw,new THREE.Vector3(scale*CROWN_WIDTH,scale,scale*CROWN_WIDTH),pitch,roll));
 });
 // Cooled needles and a darker bark, each with its own snow line; kit materials stay untouched.
 const variants=new Map<THREE.Material,THREE.Material>();
 const group=forest.build({materialFor:m=>{
  let v=variants.get(m);if(v)return v;v=m.clone();
  if(m.name.startsWith('Leaves')){stylise(v,.85,[.9,1.02,1.06],-.55);snowCover(v,{cover:1,foot:true});}
  else{stylise(v,.45,[.74,.74,.8]);snowCover(v,{cover:.7,foot:true});}
  variants.set(m,v);return v;
 }});
 group.userData.pines=forest.count;
 for(const piece of nature.pieces.values())for(const part of piece.parts)part.geometry.dispose();
 return group;
}
