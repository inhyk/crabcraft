/** Fixed tiers: entering a dungeon never changes the player's level. */
export const DUNGEONS = [
 {level:35,chapter:3,name:['황혼의 지하 감옥','Twilight Catacombs'],subtitle:['잠든 파수병과 붉은 충격파','Sleeping sentinels and scarlet shockwaves'],color:0xf0855b,coins:1800,xp:1800},
 {level:50,chapter:3,name:['별빛 금고','Starlight Vault'],subtitle:['교차하는 별빛 사이로','Between crossing starlight'],color:0xb795ff,coins:3000,xp:3000},
 {level:75,chapter:3,name:['태양의 용광로','Solar Crucible'],subtitle:['쏟아지는 태양의 불씨','A rain of solar embers'],color:0xffce64,coins:5000,xp:6000},
 {level:150,chapter:4,name:['서리 거울 회랑','Frostmirror Hall'],subtitle:['번갈아 얼어붙는 회랑','Alternating frozen corridors'],color:0x77e8ff,coins:11000,xp:22000},
 {level:200,chapter:4,name:['폭풍의 심장','Heart of the Storm'],subtitle:['회전하는 번개의 칼날','Rotating blades of lightning'],color:0x8ba6ff,coins:16000,xp:40000},
 {level:250,chapter:4,name:['영원의 빙하 심연','Eternal Glacier'],subtitle:['안전지대가 바뀌는 최후의 시험','The final trial of shifting safe ground'],color:0x9cffe3,coins:23000,xp:65000},
 {level:350,chapter:5,name:['잿불 광산','Ember Mines'],subtitle:['용암 웅덩이 사이의 세 갈래 길','Three paths between molten pools'],color:0xff8e4c,coins:32000,xp:100000},
 {level:450,chapter:5,name:['검은 모루 요새','Black Anvil Keep'],subtitle:['엇갈리는 용광로의 칼날','Staggered furnace blades'],color:0xffba62,coins:43000,xp:150000},
 {level:550,chapter:6,name:['바람뿌리 회랑','Windroot Passage'],subtitle:['바람의 틈을 찾아 건너세요','Find a gap in the wind'],color:0x85e7bc,coins:70000,xp:280000},
 {level:650,chapter:6,name:['구름 위의 정원','Cloudtop Garden'],subtitle:['피어나는 별꽃의 포위망','A constellation of blooming flowers'],color:0xb7e69c,coins:90000,xp:380000},
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
 case 6:return [-9,0,9].map((x,i)=>({shape:'circle',x,z:serial%2?i*5-5:5-i*5,radius:4}));
 case 7:return [-9,0,9].map((x,i)=>({shape:'rect',x,z:0,width:3.8,depth:32,yaw:(serial+i)%2?Math.PI/2:0}));
 case 8:return [-10,0,10].map(z=>({shape:'rect',x:serial%2?6:-6,z,width:24,depth:3.2,yaw:0}));
 case 9:return Array.from({length:5},(_,i)=>{const a=i*Math.PI*2/5+serial*.4;return {shape:'circle',x:Math.sin(a)*9,z:Math.cos(a)*9,radius:4};});
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

export type DungeonTier = DungeonConfig['level'];
export const DUNGEON_CHAMBER = Object.freeze({x:0,y:80,z:125,radius:18,footprint:26,containment:24,spawnOffset:11,yaw:Math.PI});
export const DUNGEON_CAPTAIN_SCALE = 1.65;
export const DUNGEON_POOL_SIZE = 6;
export const DUNGEON_WAVES = Object.freeze([3,5,3] as const);
