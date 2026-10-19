import {SNOW_POINTS} from '../data/quests.ts';
import { createTownsfolk } from '../data/townsfolk.ts';
import { FROST_NPCS, FROST_POIS } from '../world/snowLayout.ts';
import type { AreaDefinition, EnemySpawn, Poi } from '../types.ts';
import { deepFreeze, NPC_ORDER, poi, validateConfig, type WorldDefinitionConfig } from './world1.ts';
/** Frostlight geometry and independent spawn templates from canonical gameplay 60df24f. */
export function createWorld4Definition(config:WorldDefinitionConfig):AreaDefinition {
 validateConfig(config);const p=(id:string,x:number,z:number,radius=1)=>poi(config,id,x,z,radius,Math.PI);
 const pois:Record<string,Poi>={};for(const [id,x,z,r]of [['spawn',-12,90,6],['arrival',0,82,6],['forge',...FROST_POIS.forge,5],['chapel',...FROST_POIS.chapel,5],['tavern',...FROST_POIS.tavern,5],['grove',-55,25,9],['shore',55,25,24],['wreck',48,-15,8],['lighthouse',0,-44,6],['beacon',0,-46,2],['bossArena',0,-78,22],['mira-prison',13,-62,1]]as const)pois[id]=p(id,x,z,r);
 pois.spawn={...pois.spawn,position:{x:-12,y:5,z:90}};pois.bossArena={...pois.bossArena,yaw:0,position:{x:0,y:19,z:-78}};
 // Frostlight's own village plan (snowLayout.ts): each resident where their trade lives, facing their street.
 const npcs=NPC_ORDER.map((id,i)=>{const{x,z,yaw}=FROST_NPCS[i],point=poi(config,`npc:${id}`,x,z,1,yaw);pois[point.id]=point;return{id,position:point.position,yaw:point.yaw,archetype:`npc:${id}`};});
 const enemies:EnemySpawn[]=[];for(const kind of ['scrapling','scavenger']as const)for(let i=0;i<config.population[kind];i++){const index=kind==='scrapling'?i:config.population.scrapling+i,x=(index%2?1:-1)*(44+index%4*7),z=20-Math.floor(index/2)*12;enemies.push({id:`w4:${kind}:${i}`,kind,home:p('',x,z).position,wanderRadius:kind==='scrapling'?6:3,pack:`w4:${kind}:pack:${Math.floor(i/2)}`,fixedLevel:config.fixedLevels[kind],role:'ordinary',legacySlot:`${kind}:${i}`});}
 for(let i=0;i<(config.population.shallowPatrols??0);i++){const index=config.population.scrapling+config.population.scavenger+i,x=(index%2?1:-1)*(44+index%4*7),z=20-Math.floor(index/2)*12;enemies.push({id:`w4:shallow:${i}`,kind:'scrapling',home:p('',x,z).position,wanderRadius:2,pack:`w4:shallow:pack:${i}`,fixedLevel:config.fixedLevels.scrapling,role:'ordinary',legacySlot:`shallow:${i}`});}
 const interactions:AreaDefinition['interactions'][number][]=[{id:'gate:w3',kind:'gate',position:pois.spawn.position,range:3.5,destination:'w3'}];
 interactions.push({id:'gate:w5',kind:'gate',position:p('',14,84).position,range:3.5,destination:'w5'});
 const props=config.personalProps??config.query;
 for(const [id,[x,z]]of Object.entries(SNOW_POINTS)){const out={x:0,y:0,set(x:number,y:number){this.x=x;this.y=y;return this;}};props.resolveCollision(x,z,1,out);const position={x:out.x,y:props.heightAt(out.x,out.y),z:out.y};interactions.push({id,kind:id.includes('-visit-')?'explore':id.includes('-lamp-')?'waystone':'crystal',position,...(id.includes('-lamp-')?{channelTo:{...position,y:position.y+2.2}}:{}),range:id.includes('-visit-')?4:3.5,objective:id});}
 return deepFreeze({world:'w4',townsfolk:createTownsfolk('w4',config.query),spawn:pois.spawn,recall:pois.spawn,pois,enemies,bosses:[{profile:'frost',arena:pois.bossArena,freedNpcId:'mira',freedArchetype:'freed-frost',freedPosition:pois['mira-prison'].position,captiveBeforeVictory:true}],npcs,interactions});
}
