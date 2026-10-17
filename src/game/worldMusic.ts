export type MusicMood='explore'|'combat'|'boss';
/** World I keeps its familiar score; the other realms have distinct full arrangements. */
export function worldMusic(chapter:1|2|3,mood:MusicMood){
 return chapter===1?`music-${mood==='explore'?'town':mood}`:`music-world${chapter}-${mood}`;
}
