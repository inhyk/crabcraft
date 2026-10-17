/** Offshore islands share the real terrain, collision, coastline foam and map. */
export const CORAL_ISLAND={id:'island',name:'Coralwind Isle',ko:'산호바람 섬',x:230,z:-22,radius:19,color:'#8bffe0'} as const;
export const VOYAGE_ISLANDS=[CORAL_ISLAND,
 {id:'moon',name:'Moonshard Isle',ko:'달조각 섬',x:231,z:-61,radius:12,color:'#c5b0ff'},
 {id:'sunset',name:'Amberwreck Isle',ko:'노을 난파선 섬',x:222,z:65,radius:18,color:'#ffc784'},
] as const;
export type VoyageIslandSite=typeof VOYAGE_ISLANDS[number];
export function islandDistance(x:number,z:number,island:VoyageIslandSite=CORAL_ISLAND){return island.radius-Math.hypot(x-island.x,(z-island.z)/.86);}
export function voyageDistance(x:number,z:number){let nearest=-Infinity;for(const i of VOYAGE_ISLANDS)nearest=Math.max(nearest,islandDistance(x,z,i));return nearest;}
export function islandHeight(x:number,z:number):number|null{
 const d=voyageDistance(x,z);if(d< -8)return null;
 if(d<0)return d*.45;
 return Math.min(3.6,d*.31)+Math.sin(x*.32)*Math.sin(z*.23)*.18*Math.min(1,d/8);
}
