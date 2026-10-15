import * as THREE from 'three';
import {starTrailDistance} from './world2Settlement';

const coastalSlate=new THREE.Color('#304650');
const islandMoss=new THREE.Color('#69755b');
const moonshade=new THREE.Color('#477c76');
const ruinDust=new THREE.Color('#8a7d8b');
const pilgrimHeather=new THREE.Color('#706c88');
const townEarth=new THREE.Color('#8b8369');
const pathDust=new THREE.Color('#aaa28b');
const arenaSlate=new THREE.Color('#42485e');
const smooth=THREE.MathUtils.smoothstep;
const patch=(x:number,z:number,cx:number,cz:number,inner:number,outer:number)=>1-smooth(Math.hypot(x-cx,z-cz),inner,outer);

/** Continuous, deterministic biome colours. Only presentation changes; collision remains the height grid. */
export function starGroundColor(x:number,z:number,height:number,out:THREE.Color):THREE.Color {
  const coast=Math.hypot(x/115,(z-10)/140);
  out.copy(coastalSlate).lerp(islandMoss,(1-smooth(coast,.78,1.02))*.85);
  out.lerp(moonshade,patch(x,z,-75,-35,19,56)*.82);
  out.lerp(ruinDust,patch(x,z,80,-40,22,58)*.8);
  out.lerp(pilgrimHeather,patch(x,z,0,-42,12,43)*.6);
  const townEdge=Math.max(Math.abs(x)-43,Math.abs(z-53)-45);
  out.lerp(townEarth,(1-smooth(townEdge,-4,12))*.72);
  // A worn strip beneath stepping stones blends smoothly back into each local biome.
  const trail=(1-smooth(starTrailDistance(x,z),1,4.2))*(1-smooth(coast,.82,1));
  out.lerp(pathDust,trail*.3);
  out.lerp(arenaSlate,patch(x,z,0,-75,20,29)*.9);
  // Broad mineral and moss patches avoid a flat tint without noisy combat-floor detail.
  const variation=Math.sin(x*.17+Math.sin(z*.11)*2)*Math.cos(z*.13-x*.045);
  const elevation=THREE.MathUtils.clamp((height-3)*.012,-.06,.06);
  return out.multiplyScalar(1+variation*.075+elevation);
}
