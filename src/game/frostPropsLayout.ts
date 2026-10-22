// Frostlight's solid quest props and gateways: the guide-lantern posts, the aurora seal stones and the portal piers.
// Shared by the rendered props (frostRequests.ts, frostPortal.ts) and the collision bake (world4Colliders.ts).
import {SNOW_POINTS} from '../sim/data/quests';
import type {Collision} from '../world/collision';
import {FROST_NORTH_ROAD} from '../sim/world/snowLayout';

/**
 * Posts and stones stand this far beyond their quest point, away from the road: the point keeps clear of them (the
 * server resolves it with radius 1) and the player who reaches it is at arm's length from the prop.
 */
export const FROST_SET_BACK=1.9;
const triple=(kind:'lamp'|'seal',dz=0)=>(['a','b','c'] as const).map(k=>{const [x,z]=SNOW_POINTS[`snow-${kind}-${k}`];return [x+Math.sign(x)*FROST_SET_BACK,z+dz] as [number,number];});
/** The nearest point of the north road's centreline to (x, z). */
function roadFoot(x:number,z:number):[number,number]{
 let best=Infinity,fx=x,fz=z;const p=FROST_NORTH_ROAD.points;
 for(let k=1;k<p.length;k++){
  const [ax,az]=p[k-1],[bx,bz]=p[k],dx=bx-ax,dz=bz-az,t=Math.min(1,Math.max(0,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz))),qx=ax+dx*t,qz=az+dz*t,d=Math.hypot(x-qx,z-qz);
  if(d<best){best=d;fx=qx;fz=qz;}
 }
 return [fx,fz];
}
/**
 * Guide-lantern posts along the north road, by quest letter: [x, z, yaw of the lantern, which looks back over the
 * road]. Each stands FROST_SET_BACK beyond its quest point, straight away from the road as it winds.
 */
export const FROST_LAMP_POSTS=(['a','b','c'] as const).map(k=>{
 const [x,z]=SNOW_POINTS[`snow-lamp-${k}`],[fx,fz]=roadFoot(x,z),d=Math.hypot(x-fx,z-fz),nx=(x-fx)/d,nz=(z-fz)/d;
 return [x+nx*FROST_SET_BACK,z+nz*FROST_SET_BACK,Math.atan2(-nx,-nz)] as [number,number,number];
});
/** Aurora seal stones on the approach to the Frozen Throne, by quest letter; each faces the road. */
export const FROST_SEAL_STONES=triple('seal');
/** The gateways: home to Dawnharbor at the spawn, on to Emberreach across the square. */
export const FROST_PORTALS=[{x:-12,z:90},{x:14,z:84}] as const;
/** Pier centres either side of a portal's opening, and their half width. */
export const FROST_PIER_X=3.2,FROST_PIER_R=.62;

export function registerFrostProps(col:Collision,h:(x:number,z:number)=>number):void{
 for(const [x,z] of FROST_LAMP_POSTS)col.addCircle(x,z,.45,h(x,z)-1,h(x,z)+3.1);
 for(const [x,z] of FROST_SEAL_STONES)col.addCircle(x,z,.6,h(x,z)-1,h(x,z)+1.9);
 for(const {x,z} of FROST_PORTALS)for(const s of [-1,1])col.addCircle(x+s*FROST_PIER_X,z,FROST_PIER_R,h(x,z)-1,h(x,z)+6);
}
