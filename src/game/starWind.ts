import * as THREE from 'three';

/** One shared clock bends the licensed island plants and their depth-map silhouettes. */
export class StarWind {
  readonly time={value:0};
  constructor(forest:THREE.Object3D){
    forest.traverse(object=>{
      if(!(object instanceof THREE.BatchedMesh))return;
      const material=object.material as THREE.MeshStandardMaterial;
      const tree=/^(Bark_NormalTree|Leaves_NormalTree)$/.test(material.name);
      if(!tree&&!/^(Leaves|Flowers|Grass)$/.test(material.name))return;
      const reach={value:tree?8:1.5},strength={value:tree?1:.45},leaves=material.name.startsWith('Leaves');
      const patch=(target:THREE.Material)=>{
        target.onBeforeCompile=shader=>{
          shader.uniforms.uStarWindTime=this.time;
          shader.uniforms.uStarWindReach=reach;
          shader.uniforms.uStarWindStrength=strength;
          shader.vertexShader=/* glsl */`
uniform float uStarWindTime;
uniform float uStarWindReach;
uniform float uStarWindStrength;
vec2 starWind(vec2 anchor){
  float phase=anchor.x*.083+anchor.y*.067;
  return vec2(sin(uStarWindTime*.9+phase)*.16,
              cos(uStarWindTime*.73+phase*.91)*.1)*uStarWindStrength;
}
`+shader.vertexShader;
          // Batched kit parts share local coordinates, so bark and leaves stay joined.
          shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',/* glsl */`
#include <begin_vertex>
vec2 starAnchor=vec2(0.);
#ifdef USE_BATCHING
  starAnchor=batchingMatrix[3].xz;
#endif
transformed.xz+=starWind(starAnchor)*smoothstep(0.,uStarWindReach,position.y);
`);
          shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>',/* glsl */`
#include <beginnormal_vertex>
vec2 starNormalAnchor=vec2(0.);
#ifdef USE_BATCHING
  starNormalAnchor=batchingMatrix[3].xz;
#endif
float starBend=clamp(position.y/uStarWindReach,0.,1.);
float starSlope=6.*starBend*(1.-starBend)/uStarWindReach;
objectNormal.y-=dot(objectNormal.xz,starWind(starNormalAnchor))*starSlope;
`);
          // Leaves keep to the night's teal-green (#3f6f63): the kit's grass-green, about a third less saturated, turned
          // toward blue. Bark and flowers keep their own colour.
          if(leaves&&target===material)shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
{float l=dot(diffuseColor.rgb,vec3(.299,.587,.114));diffuseColor.rgb=mix(vec3(l),diffuseColor.rgb,.68)*vec3(.8,.98,1.08);}`);
        };
        target.customProgramCacheKey=()=>leaves&&target===material?'star-wind-v1-leaves':'star-wind-v1';
      };
      patch(material);
      const depth=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,
        map:material.map,alphaMap:material.alphaMap,alphaTest:material.alphaTest,side:material.side});
      depth.name='star-wind-shadow';patch(depth);object.customDepthMaterial=depth;
    });
  }
  update(time:number){this.time.value=time;}
}
