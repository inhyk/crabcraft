import { createTownsfolk } from '../data/townsfolk.ts';
import type { AreaDefinition, EnemySpawn, Poi } from '../types.ts';
import { deepFreeze, NPC_ORDER, poi, validateConfig, type WorldDefinitionConfig } from './world1.ts';
/** Independent Starhaven population, extracted homes/landmarks from S1 world2.ts. */
export function createWorld2Definition(config:WorldDefinitionConfig):AreaDefinition {
 validateConfig(config);const p=(id:string,x:number,z:number,radius=1)=>poi(config,id,x,z,radius,Math.PI);
 const pois:Record<string,Poi>={};for(const [id,x,z,r] of [['spawn',0,86,6],['shore',-70,5,24],['wreck',70,-15,8],['grove',25,55,9],['forge',-25,36,5],['tavern',-20,58,5],['chapel',20,35,5],['lighthouse',0,-48,6],['beacon',0,-45,2],['bossArena',0,-75,17]] as const)pois[id]=p(id,x,z,r);
 pois.bossArena={...pois.bossArena,yaw:0};
 const coords:readonly (readonly [number,number])[]=[[0,67],[25,55],[20,35],[0,20],[-20,58],[18,76],[-25,36]];
 const npcs=NPC_ORDER.map((id,i)=>{const[x,z]=coords[i],point=p(`npc:${id}`,x,z);pois[point.id]=point;return{id,position:point.position,yaw:point.yaw,archetype:`npc:${id}`};});
 const enemies:EnemySpawn[]=[];for(const kind of ['scrapling','scavenger'] as const)for(let i=0;i<config.population[kind];i++){const index=kind==='scrapling'?i:config.population.scrapling+i,side=kind==='scrapling'?-1:1,x=index<3?[19,30,20][index]:side*(60+index%4*7),z=index<3?[-8,-22,-34][index]:28-Math.floor(index/4)*16-index%3*3;enemies.push({id:`w2:${kind}:${i}`,kind,home:p('',x,z).position,wanderRadius:kind==='scrapling'?6:3,pack:`w2:${kind}:pack:${Math.floor(i/2)}`,fixedLevel:config.fixedLevels[kind],role:'ordinary',legacySlot:`${kind}:${i}`});}
 for(let i=0;i<(config.population.shallowPatrols??0);i++){const index=config.population.scrapling+config.population.scavenger+i,x=-(60+index%4*7),z=28-Math.floor(index/4)*16-index%3*3;enemies.push({id:`w2:shallow:${i}`,kind:'scrapling',home:p('',x,z).position,wanderRadius:2,pack:`w2:shallow:pack:${i}`,fixedLevel:config.fixedLevels.scrapling,role:'ordinary',legacySlot:`shallow:${i}`});}
 enemies.push({id:'w2:echo',kind:'scavenger',home:p('',0,-22).position,wanderRadius:4,pack:'w2:echo',fixedLevel:config.fixedLevels.echo,role:'echo',legacySlot:'echo'});
 const objectives:readonly (readonly [string,number,number])[]=[['crystal-a',-65,26],['crystal-b',-84,-10],['crystal-c',65,16],['crystal-d',84,-20],['lamp-a',-7.4,15],['lamp-b',29,-15],['lamp-c',-7.4,-41],['explore-west',-75,-35],['explore-east',80,-40],['explore-north',0,-48]];
 const interactions:AreaDefinition['interactions'][number][]=objectives.map(([id,x,z])=>{const position=p('',x,z).position;return {id,kind:id.startsWith('explore')?'explore':id.startsWith('lamp')?'waystone':'crystal',position,...(id.startsWith('lamp')?{channelTo:{...position,y:position.y+1.46}}:{}),range:id.startsWith('explore')?5:3.5,objective:id};});
 interactions.push({id:'gate:w1',kind:'gate',position:pois.spawn.position,range:3.5,destination:'w1'},{id:'gate:w3',kind:'gate',position:p('',0,-41).position,range:3.5,destination:'w3'});
 return deepFreeze({world:'w2',townsfolk:createTownsfolk('w2',config.query),spawn:pois.spawn,recall:pois.spawn,pois,enemies,bosses:[{profile:'eclipse',arena:pois.bossArena,freedNpcId:'star',freedArchetype:'freed-eclipse'}],npcs,interactions});
}
