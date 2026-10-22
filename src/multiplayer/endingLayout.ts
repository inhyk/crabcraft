/** Courtyard layout shared by the scenery and the camera cuts, in stage space: +z is the hero's facing. */
/** Chapel lot behind the hero; its bell tower stands at the back-right corner (TownBuilder chapel). */
export const ENDING_CHAPEL={x:0,z:-31,sx:4,sz:5} as const;
/** Top of the bell tower roof: four 3 m storeys and the round tiled cap above the chapel lot. */
export const ENDING_BELL_TOWER={x:ENDING_CHAPEL.x+ENDING_CHAPEL.sx+2,y:16.4,z:ENDING_CHAPEL.z+ENDING_CHAPEL.sz-2} as const;
