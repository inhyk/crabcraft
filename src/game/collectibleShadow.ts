import * as THREE from 'three';

/** PCF depth maps otherwise treat a faded standard material as fully opaque.
 * Ordered shadow-texel coverage fades the silhouette evenly under the PCF filter.
 */
export function collectibleShadow(visibility:THREE.IUniform<number>):THREE.MeshDepthMaterial {
  const material=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});
  material.name='collectible-fading-shadow';
  material.onBeforeCompile=shader=>{
    shader.uniforms.uCollectibleVisibility=visibility;
    shader.fragmentShader=/* glsl */`
uniform float uCollectibleVisibility;
float shadowBayer2(vec2 p){return 2.0*p.x+3.0*p.y-4.0*p.x*p.y;}
`+shader.fragmentShader.replace('#include <alphahash_fragment>',/* glsl */`
vec2 shadowCell=mod(floor(gl_FragCoord.xy),4.0);
float shadowThreshold=(4.0*shadowBayer2(mod(shadowCell,2.0))+shadowBayer2(floor(shadowCell/2.0))+.5)/16.0;
if(uCollectibleVisibility<shadowThreshold)discard;
`);
  };
  material.customProgramCacheKey=()=> 'collectible-fading-shadow-v1';
  return material;
}
