import type {Collision} from '../world/collision';
import {skyHeight,skySolids} from './skyGroundLayout';

/** World VI only: its grouped forest's trees, the boulders, stones and fallen logs (skyGroundLayout.skySolids). */
export function layoutSkyGround(col:Collision){
 for(const {x,z,r,h} of skySolids()){const y=skyHeight(x,z);col.addCircle(x,z,r,y,y+h);}
}
