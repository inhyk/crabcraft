import * as THREE from 'three';
import {starTrailDistance} from './world2Settlement';

// Moonlit albedos of the island's regions. starGround.ts paints grass, sand, earth and stone over them; the monitor's
// scenery uses them as they are.
const beachGrass=new THREE.Color('#5d7560');
const meadow=new THREE.Color('#4c7354');
const moonshade=new THREE.Color('#3d7470');
const ruinDust=new THREE.Color('#77708a');
const pilgrimHeather=new THREE.Color('#665a7c');
const townEarth=new THREE.Color('#566a52');
const pathDust=new THREE.Color('#8d8678');
const arenaSlate=new THREE.Color('#42485e');
const smooth=THREE.MathUtils.smoothstep;
const patch=(x:number,z:number,cx:number,cz:number,inner:number,outer:number)=>1-smooth(Math.hypot(x-cx,z-cz),inner,outer);

/** Continuous, deterministic region tints. Only presentation changes; collision remains the height grid. */
export function starGroundColor(x:number,z:number,height:number,out:THREE.Color):THREE.Color {
  const coast=Math.hypot(x/115,(z-10)/140);
  out.copy(beachGrass).lerp(meadow,1-smooth(coast,.66,.86));
  out.lerp(moonshade,patch(x,z,-75,-35,19,56)*.8);
  out.lerp(ruinDust,patch(x,z,80,-40,22,58)*.7);
  out.lerp(pilgrimHeather,patch(x,z,0,-42,12,43)*.55);
  const townEdge=Math.max(Math.abs(x)-43,Math.abs(z-53)-45);
  out.lerp(townEarth,(1-smooth(townEdge,-4,12))*.5);
  // A worn strip along the trails blends smoothly back into each local region.
  const trail=(1-smooth(starTrailDistance(x,z),1,4.2))*(1-smooth(coast,.82,1));
  out.lerp(pathDust,trail*.3);
  out.lerp(arenaSlate,patch(x,z,0,-75,20,29)*.9);
  // Broad lush and dry swathes; higher ground a touch paler.
  const variation=Math.sin(x*.17+Math.sin(z*.11)*2)*Math.cos(z*.13-x*.045);
  const elevation=THREE.MathUtils.clamp((height-3)*.012,-.06,.06);
  return out.multiplyScalar(1+variation*.06+elevation);
}
