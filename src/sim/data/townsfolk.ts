import type { AmbientSpawn, ClassId, WorldId, WorldQuery } from '../types.ts';
import { immutable } from '../events.ts';
import { FROST_TOWN_POINTS } from '../world/snowLayout.ts';
/** Exact Game.init appearance stream: mulberry32(1337), four draws per resident. */
export const TOWNSFOLK_SPECS:readonly {readonly race:string;readonly sex:'male'|'female';readonly classId:ClassId;readonly shell:number;readonly crest:number;readonly led:number;readonly name:string}[]=immutable([
 {race:'human',sex:'male',classId:'warrior',shell:0,crest:3,led:1,name:'Clawdia'},
 {race:'orc',sex:'female',classId:'mage',shell:1,crest:2,led:1,name:'Shelldon'},
 {race:'dwarf',sex:'male',classId:'mage',shell:2,crest:2,led:0,name:'Pinchy'},
 {race:'undead',sex:'female',classId:'mage',shell:1,crest:0,led:2,name:'Barnaby'},
 {race:'nightelf',sex:'male',classId:'mage',shell:3,crest:2,led:0,name:'Coral'},
 {race:'tauren',sex:'female',classId:'warrior',shell:0,crest:1,led:0,name:'Sandy'},
 {race:'nightelf',sex:'male',classId:'mage',shell:2,crest:2,led:0,name:'Scuttles'},
 {race:'undead',sex:'female',classId:'warrior',shell:2,crest:0,led:2,name:'Nippy'},
]);
export const TOWNSFOLK_POINTS:readonly(readonly[number,number])[]=immutable([[8,-6],[-7,7],[26,2],[44,2],[-22,-3],[0,-24],[-1,20],[56,1]]);
export const STAR_RESIDENT_POINTS:readonly(readonly[number,number])[]=immutable([[-15,62],[0,61],[15,62],[-15,44],[0,36],[15,44],[0,72],[0,24]]);
export const DAWN_TOWN_POINTS:readonly(readonly[number,number])[]=immutable([[-16,48],[16,48],[-26,38],[26,38],[-20,64],[20,80],[20,64]]);
/** World V and VI's frontier town (Frostlight's former grid); Frostlight's townsfolk follow its own plan, FROST_TOWN_POINTS. */
export const SNOW_TOWN_POINTS:readonly(readonly[number,number])[]=immutable([[-16,56],[16,56],[-16,38],[16,38],[-16,74],[16,80],[16,68]]);
/** Next 24 draws after the 32 appearance draws, before actor-radius collision resolution.
 * These are immutable world-layout values, not draws from the mutable gameplay RNG.
 */
export const TOWNSFOLK_INITIAL:readonly {readonly x:number;readonly z:number;readonly yaw:number}[]=immutable([
 {x:9.217360439426747,z:-2.1757076679731218,yaw:.2150747386575834},
 {x:-9.004733276317475,z:6.143617668129671,yaw:2.431218798524499},
 {x:25.992374285034288,z:2.052233147898348,yaw:.8953385592676553},
 {x:43.9739517539306,z:3.626698645303147,yaw:3.5799168205793115},
 {x:-22.75898958337677,z:-.2472799588675043,yaw:2.7891487325658058},
 {x:-4.228573142138239,z:-23.23868312974004,yaw:6.0149532076988415},
 {x:-1.0861213573572974,z:19.799131927830683,yaw:1.0029904611843319},
 {x:55.96339404465156,z:1.6309415616717833,yaw:.8185579943746518},
]);
/** Stable ambient slots are distinct from hostile enemy eN/wire identities. */
export function createTownsfolk(world:WorldId,query:WorldQuery):readonly AmbientSpawn[] {
 const coordinates=world==='w1'?TOWNSFOLK_POINTS:world==='w2'?STAR_RESIDENT_POINTS:world==='w3'?DAWN_TOWN_POINTS:world==='w4'?FROST_TOWN_POINTS:SNOW_TOWN_POINTS;
 const at=(x:number,z:number)=>({x,y:query.heightAt(x,z),z}),points=coordinates.map(([x,z])=>at(x,z));
 const wanderRadius=world==='w1'?5:world==='w2'?2.5:world==='w3'?1.8:1.5;
 const route=world==='w2'?{points:[...points,...[[-6,49],[-6,61],[6,49],[6,61]].map(([x,z])=>at(x,z))],radiusPadding:.15,step:.5}:undefined;
 return immutable(TOWNSFOLK_SPECS.map((_,i)=>{
  const base=points[i%points.length],initial=TOWNSFOLK_INITIAL[i];
  const position=world==='w1'?at(initial.x,initial.z):world==='w2'?at(base.x+(i%3-1)*2,base.z):at(base.x,base.z+(world==='w3'?3:2));
  const yaw=world==='w1'?initial.yaw:world==='w2'?i*.8:undefined;
  return {id:`${world}:townsfolk:${i}`,ambientSlot:`townsfolk:${i}`,archetype:`townsfolk:${i}`,position,...(yaw===undefined?{}:{yaw}),points,wanderRadius,...(route?{route}:{})};
 }));
}
