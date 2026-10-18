import { motionData, type NumericArchetype } from './pose.ts';
/** Aliases identify the actual factory spec/root scale used by shipped Game.init. */
const aliases:Readonly<Record<string,string>>=Object.freeze({player:'human',npc:'human',townsfolk:'human',freed:'human',boss:'corrodius',rust:'corrodius','boss-rust':'corrodius','boss-abyss':'abyss','boss-eclipse':'eclipse','boss-dawn':'dawn','boss-frost':'frost'});
export function numericArchetype(id:string):NumericArchetype{const a=motionData.archetypes[aliases[id]??id];if(!a)throw new Error(`Unknown shipped archetype ${id}`);return a;}
