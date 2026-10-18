/** Explicit legacy identifiers for the same shipped factory rigs. */
export const rigAliases:Readonly<Record<string,string>>=Object.freeze({player:'human',npc:'human',townsfolk:'human',freed:'human',boss:'corrodius',rust:'corrodius','boss-rust':'corrodius','boss-abyss':'abyss','boss-eclipse':'eclipse','boss-dawn':'dawn','boss-frost':'frost','boss-ember':'ember','boss-sky':'sky'});
export function canonicalRigId(id:string):string{return rigAliases[id]??id;}
