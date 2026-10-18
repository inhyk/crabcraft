/** Fixed tiers: entering a dungeon never changes the player's level. */
export const DUNGEONS = [
 {level:35,chapter:3,name:['황혼의 지하 감옥','Twilight Catacombs'],subtitle:['잠든 파수병과 붉은 충격파','Sleeping sentinels and scarlet shockwaves'],color:0xf0855b,coins:1800,xp:18000},
 {level:50,chapter:3,name:['별빛 금고','Starlight Vault'],subtitle:['교차하는 별빛 사이로','Between crossing starlight'],color:0xb795ff,coins:3000,xp:30000},
 {level:75,chapter:3,name:['태양의 용광로','Solar Crucible'],subtitle:['쏟아지는 태양의 불씨','A rain of solar embers'],color:0xffce64,coins:5000,xp:60000},
 {level:150,chapter:4,name:['서리 거울 회랑','Frostmirror Hall'],subtitle:['번갈아 얼어붙는 회랑','Alternating frozen corridors'],color:0x77e8ff,coins:11000,xp:220000},
 {level:200,chapter:4,name:['폭풍의 심장','Heart of the Storm'],subtitle:['회전하는 번개의 칼날','Rotating blades of lightning'],color:0x8ba6ff,coins:16000,xp:400000},
 {level:250,chapter:4,name:['영원의 빙하 심연','Eternal Glacier'],subtitle:['안전지대가 바뀌는 최후의 시험','The final trial of shifting safe ground'],color:0x9cffe3,coins:23000,xp:650000},
] as const;
export type DungeonConfig=typeof DUNGEONS[number];
export type DungeonState={level:number;run:string;stage:number;phase:'wave'|'rest'|'clear'|'failed';left:number;clock:number;hazard:number;members:string[]};
export function dungeonFor(level:number){return DUNGEONS.find(d=>d.level===level);}
export type DungeonHazard={x:number;z:number;shape:'circle'|'ring';radius:number;inner?:number}|{x:number;z:number;shape:'rect';width:number;depth:number;yaw:number};
/** One source for both warning geometry and authoritative damage, in metres. */
export function dungeonHazards(index:number,serial:number):DungeonHazard[]{
 switch(index){
 case 0:return [{shape:'circle',x:0,z:0,radius:6}];
 case 1:return [{shape:'rect',x:0,z:0,width:5.2,depth:34,yaw:0},{shape:'rect',x:0,z:0,width:34,depth:5.2,yaw:0}];
 case 2:return [[-8,-6],[7,-3],[0,8]].map(([x,z])=>({shape:'circle',x,z,radius:4.2}));
 case 3:{const x=serial%2?7:-7;return [{shape:'rect',x,z:0,width:9,depth:34,yaw:0},{shape:'rect',x:-x,z:0,width:3.6,depth:34,yaw:0}];}
 case 4:return [{shape:'rect',x:0,z:0,width:34,depth:5,yaw:(serial%8)*Math.PI/4}];
 default:return [{shape:serial%2===0?'ring':'circle',x:0,z:0,radius:serial%2===0?18:10,inner:7}];
 }
}
export function dungeonDanger(index:number,serial:number,x:number,z:number):boolean {
 return dungeonHazards(index,serial).some(h=>{
  const dx=x-h.x,dz=z-h.z;
  if(h.shape==='rect'){const c=Math.cos(h.yaw),s=Math.sin(h.yaw);return Math.abs(dx*c+dz*s)<h.width/2&&Math.abs(-dx*s+dz*c)<h.depth/2;}
  const r=Math.hypot(dx,dz);return r<h.radius&&(h.shape!=='ring'||r>(h.inner??0));
 });
}
