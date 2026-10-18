export type MusicMood='explore'|'combat'|'boss';
/** All realms share the original score, with separate exploration and battle moods. */
export function worldMusic(_chapter:1|2|3|4,mood:MusicMood){
 return `music-${mood==='explore'?'town':mood}`;
}
