import type {AreaDefinition,EnemySpawn,WorldQuery} from '../types.ts';
import {immutable} from '../events.ts';
import {DUNGEON_CHAMBER as C,DUNGEON_POOL_SIZE,dungeonFor,type DungeonTier} from '../data/dungeons.ts';
const queries=new WeakSet<object>();
/** Explicit parent fallback preserves the legacy chamber's R+8 footprint and outside terrain/rays. */
export function createDungeonQuery(parent:WorldQuery):WorldQuery {
 if(!parent||!['heightAt','resolveCollision','raycastSolid'].every(k=>typeof parent[k as keyof WorldQuery]==='function'))throw new Error('Dungeon parent query required');
 const query:WorldQuery=Object.freeze<WorldQuery>({
  heightAt:(x,z)=>Math.hypot(x-C.x,z-C.z)<C.footprint?C.y:parent.heightAt(x,z),
  resolveCollision:(x,z,r,out)=>{const dx=x-C.x,dz=z-C.z,d=Math.hypot(dx,dz);if(d<C.footprint){const k=Math.min(1,(C.radius-r-.25)/Math.max(.001,d));return out.set(C.x+dx*k,C.z+dz*k);}return parent.resolveCollision(x,z,r,out);},
  raycastSolid:(from,to)=>from.y>C.y-2&&Math.hypot(from.x-C.x,from.z-C.z)<C.footprint?null:parent.raycastSolid(from,to),
 });queries.add(query);return query;
}
export function isDungeonQuery(value:WorldQuery):boolean{return queries.has(value);}
export function createDungeonDefinition(tier:DungeonTier):AreaDefinition {
 const d=dungeonFor(tier);if(!d)throw new Error('Unknown dungeon tier');
 const spawn={id:'spawn',position:{x:C.x,y:C.y,z:C.z+C.spawnOffset},yaw:C.yaw,radius:3};
 const enemies:EnemySpawn[]=Array.from({length:DUNGEON_POOL_SIZE},(_,slot)=>({id:`dungeon:${slot}`,kind:'scavenger',role:'dungeon',dungeonTier:tier,dungeonSlot:slot,home:{x:C.x,y:C.y,z:C.z},wanderRadius:0,pack:'dungeon',fixedLevel:tier}));
 return immutable({world:`w${d.chapter}` as AreaDefinition['world'],spawn,recall:spawn,pois:{spawn},enemies,bosses:[],npcs:[],townsfolk:[],interactions:[]});
}
