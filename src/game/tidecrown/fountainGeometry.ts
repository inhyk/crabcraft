import {Vector3} from 'three';
/** From the authored spout to the lower pool, with a single smooth ballistic arc. */
export function fountainJetPoints(x:number,z:number){
 const length=Math.hypot(x,z);
 return Array.from({length:17},(_,i)=>{const t=i/16,d=3.1*t;return new Vector3(x+x/length*d,1.55+(.85-1.55)*t+3.6*t*(1-t),z+z/length*d);});
}
/** Narrow individual overflow streams leave the statue and its pedestal visible. */
export function fountainSpillPoints(angle:number){
 return Array.from({length:9},(_,i)=>{const t=i/8,r=3.12+.22*t;return new Vector3(Math.cos(angle)*r,2.66-1.81*t*t,Math.sin(angle)*r);});
}
