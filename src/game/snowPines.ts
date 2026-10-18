import * as THREE from 'three';
import {loadKit,Scatter,trs} from '../world/kit';
import {addPatch,stylise} from '../world/materials';
import {GLSL_NOISE} from '../world/noise';

/*
 * Frostlight's forest: the Stylized Nature MegaKit pines (CC0, see NOTICE.md) on the snowTrees() trunks, one
 * BatchedMesh per kit material for the whole forest. Snow settles in the shader: world-space normals that face
 * up, broken by drift noise and a per-tree load, so every bough carries its own uneven cap and the trunk only
 * a dusting. The kit's summer green is cooled towards the island's ice palette underneath.
 */

const SNOW_PINE_FOREST='frostlight-snow-pines';
const PINES=['Pine_1','Pine_2','Pine_3','Pine_4','Pine_5'];
/** Height at s=1, a little over the cone trees these replace; crowns are widened to keep the forest as full. */
const TREE_HEIGHT=10.2,CROWN_WIDTH=1.12;
const SNOW_COLOR=new THREE.Color('#effaff');

/** Snow on up-facing surfaces. `cover` raises (above 1) or lowers how much of a slope still holds snow. */
function snowLaden(mat:THREE.Material,cover=1){
 addPatch(mat,`snow-laden${cover}`,shader=>{
  shader.uniforms.uSnowColor={value:SNOW_COLOR};
  shader.vertexShader=shader.vertexShader
   .replace('#include <common>','#include <common>\nvarying vec3 vSnowW;\nvarying vec3 vSnowN;\nvarying vec3 vSnowRoot;')
   // View-space normal back to world space: valid for instanced, batched and plain meshes alike.
   .replace('#include <defaultnormal_vertex>','#include <defaultnormal_vertex>\nvSnowN = (vec4(transformedNormal, 0.0) * viewMatrix).xyz;')
   .replace('#include <project_vertex>',`#include <project_vertex>
    vSnowW = (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz + cameraPosition;
    vec4 snowRoot = vec4(0.0, 0.0, 0.0, 1.0);
    #ifdef USE_BATCHING
     snowRoot = batchingMatrix * snowRoot;
    #endif
    #ifdef USE_INSTANCING
     snowRoot = instanceMatrix * snowRoot;
    #endif
    vSnowRoot = (modelMatrix * snowRoot).xyz;`);
  shader.fragmentShader=shader.fragmentShader
   .replace('#include <common>',`#include <common>\nvarying vec3 vSnowW;\nvarying vec3 vSnowN;\nvarying vec3 vSnowRoot;\nuniform vec3 uSnowColor;\n${GLSL_NOISE}\nfloat ccSnow;`)
   .replace('#include <color_fragment>',`#include <color_fragment>
    {
     // Double-sided needle cards: the face we see decides which way is up.
     vec3 sn = normalize(vSnowN) * (gl_FrontFacing ? 1.0 : -1.0);
     float load = cc_hash12(floor(vSnowRoot.xz * 2.0) + 7.3);
     vec2 q = vSnowW.xz + vSnowW.y * vec2(0.61, -0.47);
     float drift = cc_vnoise(q * 1.3) * 0.62 + cc_vnoise(q * 4.7 + 11.0) * 0.38;
     float up = sn.y + (drift - 0.5) * 0.6 + (load - 0.5) * 0.16 + ${(cover-1).toFixed(3)} * 0.4;
     // Bare at the foot, where the drift around the trunk takes over.
     ccSnow = smoothstep(0.62, 0.8, up) * smoothstep(0.5, 1.6, vSnowW.y - vSnowRoot.y);
     #ifdef USE_COLOR
      // Keep the kit's baked occlusion so snow deep inside the crown stays in shade.
      float occ = mix(1.0, dot(vColor.rgb, vec3(0.299, 0.587, 0.114)), 0.5);
     #else
      float occ = 1.0;
     #endif
     // A trace of the needle texture survives under the snow, so caps keep the sprig shapes.
     float grain = 0.86 + 0.14 * smoothstep(0.0, 0.35, dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)));
     diffuseColor.rgb = mix(diffuseColor.rgb, uSnowColor * occ * grain, ccSnow);
    }`)
   .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.84, ccSnow);');
 });
}

/** Small deterministic integer hash: the same species, yaw and lean on every client. */
function mix32(i:number){let h=Math.imul(i+1,0x9e3779b1);h^=h>>>15;h=Math.imul(h,0x85ebca6b);h^=h>>>13;return h>>>0;}

/** Every snowTrees() entry as a kit pine. Resolves to a group of BatchedMeshes, one per kit material. */
export async function snowPines(trees:readonly {x:number;z:number;s:number}[],height:(x:number,z:number)=>number){
 const nature=await loadKit('models/world/nature.glb'),forest=new Scatter(nature,SNOW_PINE_FOREST);
 const names=PINES.filter(n=>nature.has(n));
 trees.forEach(({x,z,s},i)=>{
  const h=mix32(i),name=names[h%names.length],box=nature.get(name).box;
  const scale=TREE_HEIGHT*s/(box.max.y-box.min.y),yaw=(h>>>8&0xffff)/65536*Math.PI*2;
  const pitch=((h>>>4&0xf)/15-.5)*.05,roll=((h>>>24&0xf)/15-.5)*.05;
  forest.add(name,trs(x,height(x,z)-.12*scale,z,yaw,new THREE.Vector3(scale*CROWN_WIDTH,scale,scale*CROWN_WIDTH),pitch,roll));
 });
 // Cooled needles and a darker bark, each with its own snow line; kit materials stay untouched.
 const variants=new Map<THREE.Material,THREE.Material>();
 const group=forest.build({materialFor:m=>{
  let v=variants.get(m);if(v)return v;v=m.clone();
  if(m.name.startsWith('Leaves')){stylise(v,.85,[.9,1.02,1.06],-.55);snowLaden(v,1);}
  else{stylise(v,.45,[.74,.74,.8]);snowLaden(v,.7);}
  variants.set(m,v);return v;
 }});
 group.userData.pines=forest.count;
 for(const piece of nature.pieces.values())for(const part of piece.parts)part.geometry.dispose();
 return group;
}
