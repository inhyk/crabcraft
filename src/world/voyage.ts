/** A separate island inside the existing terrain/water grid, reachable across open sea. */
export const CORAL_ISLAND={x:230,z:-22,radius:19} as const;
export function islandDistance(x:number,z:number){const dx=(x-CORAL_ISLAND.x),dz=(z-CORAL_ISLAND.z)/.86;return CORAL_ISLAND.radius-Math.hypot(dx,dz);}
export function islandHeight(x:number,z:number):number|null{
 const d=islandDistance(x,z);if(d< -8)return null;
 if(d<0)return d*.45;
 return Math.min(3.6,d*.31)+Math.sin(x*.32)*Math.sin(z*.23)*.18*Math.min(1,d/8);
}
