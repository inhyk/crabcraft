import { createExplorationInteractions } from '../features/exploration.ts';
import { createTownsfolk } from '../data/townsfolk.ts';
import type { AreaDefinition, EnemySpawn, Poi, WorldQuery } from '../types.ts';
export interface WorldDefinitionConfig {
 readonly query:WorldQuery;
 /** Dawn prop anchors use raw collision, without the actor island-boundary wrapper. */
 readonly personalProps?:Pick<WorldQuery,'heightAt'|'resolveCollision'>;
 /** Explicit host balance configuration; no production level/density defaults. */
 readonly fixedLevels:Readonly<Record<'scrapling'|'scavenger'|'jellyfish'|'echo',number>>;
 readonly population:Readonly<Record<'scrapling'|'scavenger'|'jellyfish',number>>&{readonly shallowPatrols?:number};
}
export function deepFreeze<T>(value:T):T {if(value&&typeof value==='object'){Object.freeze(value);for(const item of Object.values(value))deepFreeze(item);}return value;}
export function validateConfig(config:WorldDefinitionConfig):void {for(const n of Object.values(config.fixedLevels))if(!Number.isSafeInteger(n)||n<1)throw new Error('invalid-fixed-level');for(const n of Object.values(config.population))if(!Number.isSafeInteger(n)||n<0||n>10000)throw new Error('invalid-population');}
export function poi(config:WorldDefinitionConfig,id:string,x:number,z:number,radius=1,yaw=0,y?:number):Poi{return {id,position:{x,y:y??config.query.heightAt(x,z),z},radius,yaw};}
export const NPC_ORDER:readonly string[]=Object.freeze(['brinebeard','silvermoon','coralline','grukk','hoofclaw','rattlebolt','pip']);
function spawn(config:WorldDefinitionConfig,kind:EnemySpawn['kind'],i:number,x:number,z:number,pack:string,wanderRadius:number):EnemySpawn{return {id:`w1:${kind}:${i}`,kind,home:{x,y:config.query.heightAt(x,z),z},wanderRadius,pack,fixedLevel:config.fixedLevels[kind],role:'ordinary',legacySlot:`${kind}:${i}`};}
/** Shore homes and landmark geometry extracted from S1 layout.ts/game.ts 28816e2. */
export function createWorld1Definition(config:WorldDefinitionConfig):AreaDefinition {
 validateConfig(config);const p=(id:string,x:number,z:number,radius=1,yaw=0,y?:number)=>poi(config,id,x,z,radius,yaw,y);
 const face=(x:number,z:number,tx:number,tz:number)=>Math.atan2(tx-x,tz-z);
 const beaconDirection={x:-15.5/Math.hypot(15.5,6),z:6/Math.hypot(15.5,6)};
 const pois:Record<string,Poi>={spawn:p('spawn',-.5,12.5,6,face(-.5,12.5,4.2,10.2)),forge:p('forge',-28,-10,5,Math.PI),chapel:p('chapel',0,-35,5,Math.PI),tavern:p('tavern',-1,30,5),grove:p('grove',-73,46,9,face(-73,46,-80,50)),shore:p('shore',115,36,24,Math.PI/2),lighthouse:p('lighthouse',166,-119,6,face(166,-119,190,-132)),beacon:p('beacon',190+beaconDirection.x*3.5,-132+beaconDirection.z*3.5,2,Math.atan2(-beaconDirection.x,-beaconDirection.z),28.5),wreck:p('wreck',128,99,8,face(128,99,154,117)),bossArena:p('bossArena',154,117,12,face(154,117,128,109),3.4)};
 const npcCoords:readonly (readonly [number,number])[]=[[4.2,10.2],[-75.5,43.5],[2.5,-37.5],[62,4.2],[3.2,31.5],[160,-118],[-25,-12.5]];
 const npcYaws=[face(4.2,10.2,0,13),face(-75.5,43.5,-68,46),0,-Math.PI/2,face(3.2,31.5,0,20),face(160,-118,140,-112),face(-25,-12.5,-20,-4)];
 const npcs=NPC_ORDER.map((id,i)=>{const [x,z]=npcCoords[i],point=p(`npc:${id}`,x,z,1,npcYaws[i]);pois[point.id]=point;return{id,position:point.position,yaw:point.yaw,archetype:`npc:${id}`};});
 const scrapHomes:readonly (readonly [number,number])[]=[[113,-8],[114,8],[109,44],[114,62],[119,80],[111,-24]],scavHomes:readonly (readonly [number,number])[]=[[108,-54],[114,-74],[121,-93],[142,-112]];
 const enemies:EnemySpawn[]=[];for(const kind of ['scrapling','scavenger'] as const){const homes=kind==='scrapling'?scrapHomes:scavHomes;for(let i=0;i<config.population[kind];i++){const packEnds=[3,5,7,10,12,14];const group=kind==='scrapling'?Math.max(0,packEnds.findIndex(end=>i%14<end))%homes.length:i%homes.length;const [x,z]=homes[group];enemies.push(spawn(config,kind,i,x,z,`w1:${kind}:pack:${group}`,kind==='scrapling'?6:3));}}
 // Optional host count selects the actual shallow patrol templates from Game.init.
 // Omitting this group disables it; no final production density is chosen here.
 for(let i=0;i<(config.population.shallowPatrols??0);i++){let best={...pois.shore.position},delta=Infinity;for(let dx=-22;dx<=22;dx+=2)for(let dz=-22;dz<=22;dz+=2){const x=pois.shore.position.x+dx+i*4,z=pois.shore.position.z+dz,y=config.query.heightAt(x,z),d=Math.abs(y-.4),out={x:0,y:0,set(x:number,y:number){this.x=x;this.y=y;return this;}};if(d>=delta||Math.hypot(dx,dz)<=6)continue;config.query.resolveCollision(x,z,.8,out);if(Math.hypot(out.x-x,out.y-z)<.2){delta=d;best={x,y,z};}}enemies.push({id:`w1:shallow:${i}`,kind:'scrapling',home:best,wanderRadius:2,pack:`w1:shallow:pack:${i}`,fixedLevel:config.fixedLevels.scrapling,role:'ordinary',legacySlot:`shallow:${i}`});}
 // Jelly homes are selected using actual terrain/collision, retaining the shallow-water eligibility.
 const anchors:readonly (readonly [number,number])[]=[[118,24],[130,43],[130,65],[142,84],[156,102],[174,83]];
 for(let i=0;i<config.population.jellyfish;i++){const [ax,az]=anchors[i%anchors.length];let best:{x:number;z:number;score:number}|null=null;for(let dx=-28;dx<=28;dx+=2)for(let dz=-24;dz<=24;dz+=2){const x=ax+dx,z=az+dz,y=config.query.heightAt(x,z),out={x:0,y:0,set(x:number,y:number){this.x=x;this.y=y;return this;}};if(y>-.15||y<-.9||enemies.some(e=>e.kind==='jellyfish'&&Math.hypot(e.home.x-x,e.home.z-z)<10))continue;config.query.resolveCollision(x,z,1.3,out);if(Math.hypot(out.x-x,out.y-z)>.15)continue;const score=Math.abs(y+.55)+Math.hypot(dx,dz)*.008;if(!best||score<best.score)best={x,z,score};}if(best)enemies.push(spawn(config,'jellyfish',i,best.x,best.z,`w1:jelly:${i}`,3));}
 const beacon=pois.beacon.position,ground=config.query.heightAt(beacon.x,beacon.z),channelTo={x:beacon.x,y:Math.max(beacon.y,ground)+(beacon.y>ground+1?0:3),z:beacon.z};
 const gate=p('gate:w2',pois.wreck.position.x-7,pois.wreck.position.z+7,3.5);
 return deepFreeze({world:'w1',townsfolk:createTownsfolk('w1',config.query),spawn:pois.spawn,recall:pois.spawn,pois,enemies,bosses:[{profile:'rust',arena:pois.bossArena,freedNpcId:'corrodius',freedArchetype:'freed-rust'},{profile:'abyss',arena:pois.bossArena,freedNpcId:'pearl',freedArchetype:'freed-abyss'}],npcs,interactions:[...createExplorationInteractions(config.query),{id:'beacon',kind:'beacon',position:pois.beacon.position,channelTo,range:3.5,objective:'beacon'},{id:'gate:w2',kind:'gate',position:gate.position,range:3.5,destination:'w2'}]});
}
