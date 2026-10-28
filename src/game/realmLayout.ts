import {realmHeight} from '../sim/world/ground';
import {Collision} from '../world/collision';
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
 // World VI's town lays its own exact house footprints, yards, market and harbour (skyTownLayout.ts).
 if(chapter===5)for(const side of [-1,1])for(let i=0;i<3;i++){const x=side*30,z=38+i*18,y=heightAt(x,z);col.addBox(x,z,5.3,5.8,0,y,y+10);}
 else layoutSkyTown(col,heightAt);
 for(const {x,z,s}of frontierTrees(chapter)){const y=heightAt(x,z);col.addCircle(x,z,(chapter===5?1.3:.7)*s,y,y+12*s);}
 if(chapter===6)layoutSkyTree(col,heightAt);else col.addCircle(0,-128,24,heightAt(0,-128),heightAt(0,-128)+36);
 // Landmark columns leave the southern approach and all quest paths open.
 for(let i=0;i<10;i++){const a=(i+1)/12*Math.PI*2,x=Math.sin(a)*23,z=-72+Math.cos(a)*23;if(z>-56)continue;const y=heightAt(x,z);col.addCircle(x,z,1.5,y,y+12);}
 if(chapter===6)layoutSkyGround(col);
 return col;
}
