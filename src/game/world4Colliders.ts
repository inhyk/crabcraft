// Frostlight registrations used by the rendered island and the offline collision bake.
import { snowHeight } from '../sim/world/ground';
import { SNOW_ROCKS } from '../sim/world/snowGround';
import { Collision } from '../world/collision';
import { arenaPillars, registerFrostThrone } from './frostThroneLayout';
import { CLIFF_R, iceCliffs } from './frostCliffsLayout';
import { registerSnowVillage } from './snowVillageLayout';
import { registerFrostProps } from './frostPropsLayout';
import { registerSnowFields } from './snowFieldsLayout';
import { registerWayCairns } from './frostCairnsLayout';

// Between the west-side lanes, clear of the road, homes and resident positions.
export const SNOW_FOUNTAIN = {x:-13,z:65,radius:3.1} as const;

export function snowTrees() {
  const trees: {x:number;z:number;s:number}[] = [];
  for(let i=0;i<120;i++){
    const a=i*2.399963,r=55+i%7*6,x=Math.sin(a)*r,z=10+Math.cos(a)*108;
    if(Math.hypot(x/128,(z-2)/155)>.78||Math.abs(x)<19||Math.abs(x)<42&&z>23&&z<91||Math.hypot(x,z+78)<30)continue;
    trees.push({x,z,s:.8+i%5*.13});
  }
  return trees;
}

export function layoutFrostlight(): Collision {
  const h = snowHeight;
  const col = new Collision({minX:-150,minZ:-175,step:2,nx:151,nz:176,h:new Float32Array(151*176),heightAt:h});
  // The village: kit houses, lamp posts and solid props (snowVillageLayout.ts).
  registerSnowVillage(col,h);
  // Guide-lantern posts, aurora seal stones and the gateways' piers (frostPropsLayout.ts).
  registerFrostProps(col,h);
  const {x:fx,z:fz,radius}=SNOW_FOUNTAIN,fy=h(fx,fz);col.addCircle(fx,fz,radius,fy,fy+5);
  for(const {x,z,s} of snowTrees()){const y=h(x,z);col.addCircle(x,z,.6*s,y,y+10*s);}
  // The ice cliffs ringing the north, each off the server's monster start points (frostCliffsLayout.ts).
  for(const c of iceCliffs()){const y=h(c.x,c.z);col.addCircle(c.x,c.z,CLIFF_R,y,y+c.h);}
  // The arena's crystal pillars on their granite collars, the throne and the citadel (frostThroneLayout.ts).
  for(const {x,z} of arenaPillars()){const y=h(x,z);col.addCircle(x,z,1.9,y,y+10);}
  registerFrostThrone(col,h);
  // Rock outcrops (snowRocks.ts): a box for the crag's body and a circle at each rounded end of its long axis.
  for(const k of SNOW_ROCKS){
    const y=h(k.x,k.z),top=y+1.3*k.h;
    col.addBox(k.x,k.z,.62*k.r,.5*k.r,k.yaw,y-1,top);
    for(const f of [-.6,.6])col.addCircle(k.x+Math.cos(k.yaw)*f*k.r,k.z-Math.sin(k.yaw)*f*k.r,.32*k.r,y-1,top);
  }
  // The open fields: groves, boulders, dead trees, logs, stumps and the abandoned props (snowFieldsLayout.ts).
  registerSnowFields(col,h);
  // The way-cairns by the north road and out on the fields (frostCairnsLayout.ts).
  registerWayCairns(col,h);
  return col;
}
