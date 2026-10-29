import {realmHeight} from '../sim/world/ground';
import {Collision} from '../world/collision';
import {layoutEmberGround} from './emberGroundLayout';
import {layoutEmberTown} from './emberTownLayout';
import {layoutSkyGround} from './skyGroundColliders';
import {layoutSkyTree} from './skyTreeLayout';
import {layoutSkyTown} from './skyTownLayout';
export type FrontierChapter=5|6;
export const FRONTIER_TOWN:[number,number][]=[[-16,56],[16,56],[-16,38],[16,38],[-16,74],[16,80],[16,68]];
export const FRONTIER_BOUNDS={cz:2,rx:128,rz:155,max:.8};
export function frontierTrees(chapter:FrontierChapter){
 const trees:{x:number;z:number;s:number}[]=[];
 for(let i=0;i<(chapter===5?42:72);i++){const a=i*2.399963,r=48+i%6*7,x=Math.sin(a)*r,z=5+Math.cos(a)*100;if(Math.hypot(x/128,(z-2)/155)>.77||Math.abs(x)<23||Math.abs(x)<42&&z>24&&z<94||Math.hypot(x,z+72)<25)continue;trees.push({x,z,s:.8+i%5*.13});}
 return trees;
}
export function layoutFrontier(chapter:FrontierChapter){
 const heightAt=(x:number,z:number)=>realmHeight(chapter,x,z);
 const col=new Collision({minX:-150,minZ:-175,step:2,nx:151,nz:176,h:new Float32Array(151*176),heightAt});
 // World V rings its houses round the furnace yard (emberTownLayout.ts); World VI lays its own houses, yards and harbour (skyTownLayout.ts).
 if(chapter===6)layoutSkyTown(col,heightAt);
 // World V's rocks, crystals and camps come from layoutEmberGround; World VI plants its own grouped forest (layoutSkyGround).
 if(chapter===5)layoutEmberGround(col,heightAt);
 if(chapter===6)layoutSkyTree(col,heightAt);else col.addCircle(0,-128,24,heightAt(0,-128),heightAt(0,-128)+36);
 if(chapter===5)layoutEmberTown(col,heightAt);
 // Landmark columns leave the southern approach and all quest paths open.
 for(let i=0;i<10;i++){const a=(i+1)/12*Math.PI*2,x=Math.sin(a)*23,z=-72+Math.cos(a)*23;if(z>-56)continue;const y=heightAt(x,z);col.addCircle(x,z,1.5,y,y+12);}
 if(chapter===6)layoutSkyGround(col);
 return col;
}
