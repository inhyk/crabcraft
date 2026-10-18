/** Server registrations derived from the same immutable gameplay layout. No runtime ownership here. */
import type { AreaDefinition, BossProfileId, WorldId } from '../types.ts';
import { deepFreeze } from './world1.ts';
const FLAGS = Object.freeze({rust:'rustCleared',abyss:'abyssCleared',eclipse:'trueCleared',dawn:'finalCleared',frost:'frostCleared',ember:'emberCleared',sky:'skyCleared'} as const);
/** Public rescued/captive actors are personal presentation, never a substitute boss victory. */
export function createPublicDefinition(definition:AreaDefinition):AreaDefinition {
 const d=structuredClone(definition),rescued:AreaDefinition['npcs'][number][]=d.bosses.map(b=>({id:b.freedNpcId,archetype:b.freedArchetype,position:b.freedPosition??b.arena.position,yaw:b.arena.yaw,targetable:false,personalVisibility:{flag:FLAGS[b.profile],value:!b.captiveBeforeVictory}}));
 if(rescued.some(n=>!n.archetype||d.npcs.some(p=>p.id===n.id)))throw new Error('invalid-public-rescued-actor');
 return deepFreeze({...d,bosses:[],npcs:[...d.npcs,...rescued]});
}
/** A private instance owns one encounter and its freed actor; admission/return/bootstrap remain host decisions. */
export function createEncounterDefinition(definition:AreaDefinition,profile:BossProfileId):AreaDefinition {
 const d=structuredClone(definition),boss=d.bosses.find(b=>b.profile===profile);if(!boss)throw new Error('encounter-not-in-world');
 const arena=boss.arena,distance=Math.min(9,arena.radius*.85),entry={id:'encounter:entry',position:{x:arena.position.x+Math.sin(arena.yaw)*distance,y:arena.position.y,z:arena.position.z+Math.cos(arena.yaw)*distance},yaw:arena.yaw+Math.PI,radius:1};
 return deepFreeze({...d,pois:{...d.pois,[entry.id]:entry},bosses:[boss],enemies:[],townsfolk:[],npcs:[],interactions:[]});
}
export function createWorldVariants(world:WorldId,definition:AreaDefinition):{publicDefinition:AreaDefinition;encounterDefinitions:ReadonlyMap<BossProfileId,AreaDefinition>} {
 if(world!==definition.world)throw new Error('variant-world-mismatch');
 return {publicDefinition:createPublicDefinition(definition),encounterDefinitions:new Map(definition.bosses.map(b=>[b.profile,createEncounterDefinition(definition,b.profile)]))};
}
/** Apply before AOI selection/pinning; shared actor visibility cannot carry one character's story flag. */
export function personalNpcVisible(definition:AreaDefinition,npcId:string,flags:Readonly<Record<string,boolean>>):boolean {
 const rule=definition.npcs.find(n=>n.id===npcId)?.personalVisibility;return !rule||!!flags[rule.flag]===rule.value;
}
