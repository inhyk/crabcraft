import type { AreaDefinition, EnemySpawn, Poi } from '../types.ts';
import { deepFreeze, NPC_ORDER, poi, validateConfig, type WorldDefinitionConfig } from './world1.ts';
/** Independent Dawnreach population, extracted from S1 DawnIsland and enterThird. */
export function createWorld3Definition(config:WorldDefinitionConfig):AreaDefinition {
 validateConfig(config);const p=(id:string,x:number,z:number,radius=1)=>poi(config,id,x,z,radius,Math.PI);
 const pois:Record<string,Poi>={};for(const [id,x,z,r] of [['spawn',-12,84,6],['arrival',0,82,6],['forge',20,64,5],['chapel',16,48,5],['tavern',-20,64,5],['grove',-55,36,9],['shore',55,36,24],['wreck',55,-25,8],['lighthouse',0,-40,6],['beacon',0,-44,2],['bossArena',0,-72,20]] as const)pois[id]=p(id,x,z,r);
 pois.bossArena={...pois.bossArena,yaw:0};
 const coords:readonly (readonly [number,number])[]=[[-16,48],[16,48],[-26,38],[26,38],[-20,64],[20,80],[20,64]],npcs=NPC_ORDER.map((id,i)=>{const[x,z]=coords[i],point=p(`npc:${id}`,x,z);pois[point.id]=point;return{id,position:point.position,yaw:point.yaw};});
 const enemies:EnemySpawn[]=[];for(const kind of ['scrapling','scavenger'] as const)for(let i=0;i<config.population[kind];i++){const index=kind==='scrapling'?i:config.population.scrapling+i,x=(index%2?1:-1)*(43+index%4*8),z=16-Math.floor(index/2)*10;enemies.push({id:`w3:${kind}:${i}`,kind,home:p('',x,z).position,wanderRadius:kind==='scrapling'?6:3,pack:`w3:${kind}:pack:${Math.floor(i/2)}`,fixedLevel:config.fixedLevels[kind],role:'ordinary'});}
 return deepFreeze({world:'w3',spawn:pois.spawn,recall:pois.spawn,pois,enemies,bosses:[{profile:'dawn',arena:pois.bossArena,freedNpcId:'mira'}],npcs,interactions:[{id:'gate:w2',kind:'gate',position:p('',-12,84).position,range:3.5,destination:'w2'}]});
}
