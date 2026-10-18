import {FRONTIER_POINTS} from '../data/quests.ts';
import {createTownsfolk,SNOW_TOWN_POINTS} from '../data/townsfolk.ts';
import type {AreaDefinition,EnemySpawn,Poi} from '../types.ts';
import {deepFreeze,NPC_ORDER,poi,validateConfig,type WorldDefinitionConfig} from './world1.ts';
/** Browser and host share frontier homes, personal props and gate destinations. */
export function createFrontierDefinition(config:WorldDefinitionConfig,chapter:5|6):AreaDefinition {
 validateConfig(config);const world=chapter===5?'w5':'w6',p=(id:string,x:number,z:number,radius=1)=>poi(config,id,x,z,radius,Math.PI);
 const pois:Record<string,Poi>={};for(const[id,x,z,r]of [['spawn',0,82,6],['forge',16,68,5],['chapel',16,56,5],['tavern',-16,74,5],['grove',-50,26,9],['shore',61,22,24],['wreck',44,-6,8],['lighthouse',0,-44,6],['beacon',0,-46,2],['bossArena',0,-72,20]]as const)pois[id]=p(id,x,z,r);
 const npcs=NPC_ORDER.map((id,i)=>{const[x,z]=SNOW_TOWN_POINTS[i],point=p(`npc:${id}`,x,z);pois[point.id]=point;return{id,position:point.position,yaw:Math.PI,archetype:`npc:${id}`};});
 const enemies:EnemySpawn[]=[];for(const kind of ['scrapling','scavenger']as const)for(let i=0;i<config.population[kind];i++){const index=kind==='scrapling'?i:config.population.scrapling+i,x=(index%2?1:-1)*(44+index%4*7),z=20-Math.floor(index/2)*12;enemies.push({id:`${world}:${kind}:${i}`,kind,home:p('',x,z).position,wanderRadius:kind==='scrapling'?6:3,pack:`${world}:${kind}:${Math.floor(i/2)}`,fixedLevel:config.fixedLevels[kind],role:'ordinary',legacySlot:`${kind}:${i}`});}
 for(let i=0;i<(config.population.shallowPatrols??0);i++){const index=config.population.scrapling+config.population.scavenger+i,x=(index%2?1:-1)*(44+index%4*7),z=20-Math.floor(index/2)*12;enemies.push({id:`${world}:shallow:${i}`,kind:'scrapling',home:p('',x,z).position,wanderRadius:2,pack:`${world}:shallow:pack:${i}`,fixedLevel:config.fixedLevels.scrapling,role:'ordinary',legacySlot:`shallow:${i}`});}
 const interactions:AreaDefinition['interactions'][number][]=[{id:`gate:w${chapter-1}`,kind:'gate',position:p('',-12,84).position,range:3.5,destination:chapter===5?'w4':'w5'}];
 if(chapter===5)interactions.push({id:'gate:w6',kind:'gate',position:p('',0,-72).position,range:3.5,destination:'w6'});
 const props=config.personalProps??config.query;
 for(const[id,[x,z]]of Object.entries(FRONTIER_POINTS[chapter])){const out={x:0,y:0,set(x:number,y:number){this.x=x;this.y=y;return this;}};props.resolveCollision(x,z,1,out);const position={x:out.x,y:props.heightAt(out.x,out.y),z:out.y};interactions.push({id,kind:id.includes('-visit-')?'explore':id.includes('-lamp-')?'waystone':'crystal',position,...(id.includes('-lamp-')?{channelTo:{...position,y:position.y+2.2}}:{}),range:id.includes('-visit-')?4:3.5,objective:id});}
 return deepFreeze({world,spawn:pois.spawn,recall:pois.spawn,pois,npcs,townsfolk:createTownsfolk(world,config.query),enemies,bosses:[],interactions});
}
export const createWorld5Definition=(config:WorldDefinitionConfig)=>createFrontierDefinition(config,5);
export const createWorld6Definition=(config:WorldDefinitionConfig)=>createFrontierDefinition(config,6);
