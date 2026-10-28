import * as THREE from 'three';
import {STAR_MOON_DIR} from './starNight';

/**
 * World II's night on its trees (star r5), by species (material.userData.starVariant, starTrees.ts): every crown a
 * sheen on its moon side and a pale rim where it turns from the eye; silver crowns pale and bleached, crystal crowns
 * violet with a few lit crystal buds; bark a cool brown-grey (silver paler, crystal veined with light).
 */
const MOON=`vec3(${STAR_MOON_DIR.x.toFixed(4)},${STAR_MOON_DIR.y.toFixed(4)},${STAR_MOON_DIR.z.toFixed(4)})`;
function nightLeaves(variant:string){
  const tint=variant==='silver'?'diffuseColor.rgb=mix(vec3(l),diffuseColor.rgb,.22)*vec3(1.02,1.12,1.3)*1.55;':variant==='crystal'?'diffuseColor.rgb=mix(vec3(l),diffuseColor.rgb,.3)*vec3(1.05,.82,1.45)*1.2;':'diffuseColor.rgb=mix(vec3(l),diffuseColor.rgb,.68)*vec3(.8,.98,1.08)*1.18;';
  const rim=variant==='silver'?'vec3(.16,.19,.25)':variant==='crystal'?'vec3(.17,.12,.3)':'vec3(.09,.13,.15)';
  const buds=variant==='crystal'?`{vec3 c=floor(vSwW*2.6);float h=fract(sin(dot(c,vec3(12.9898,78.233,37.719)))*43758.5453);vec3 f=fract(vSwW*2.6)-.5;
    totalEmissiveRadiance+=vec3(.55,.3,1.)*step(.93,h)*(1.-smoothstep(.12,.3,length(f)))*(1.6+.8*sin(uStarWindTime*1.3+h*40.));}`:'';
  return {tint:`{float l=dot(diffuseColor.rgb,vec3(.299,.587,.114));${tint}}`,emissive:`#include <emissivemap_fragment>
{vec3 wN=inverseTransformDirection(normal,viewMatrix);float ndv=abs(dot(normal,normalize(vViewPosition)));
  float moon=max(dot(wN,${MOON}),0.),rim=pow(1.-ndv,2.5);
  totalEmissiveRadiance+=diffuseColor.rgb*moon*.22+${rim}*rim*(.35+.65*moon);}
${buds}`};
}
function nightBark(variant:string){
  const tone=variant==='silver'?'vec3(1.,1.04,1.12)*1.35':variant==='crystal'?'vec3(.92,.88,1.08)*.95':'vec3(.95,.97,1.06)*1.05';
  const veins=variant==='crystal'?`
{float v=abs(sin(vSwW.y*2.3+sin(vSwW.x*5.+vSwW.z*4.)*2.1+sin(vSwW.x*13.-vSwW.z*11.)*.4));totalEmissiveRadiance+=vec3(.42,.18,1.)*(1.-smoothstep(.02,.07,v))*step(.35,fract(vSwW.y*.37+vSwW.x*.11))*(.9+.4*sin(uStarWindTime*.9+vSwW.y));}`:'';
  return {tint:`{float l=dot(diffuseColor.rgb,vec3(.299,.587,.114));diffuseColor.rgb=mix(vec3(l),diffuseColor.rgb,.3)*${tone};}`,emissive:`#include <emissivemap_fragment>${veins}`};
}

/** One shared clock bends the licensed island plants and their depth-map silhouettes. */
export class StarWind {
  readonly time={value:0};
  /** `tealLeaves`: World II's night teal canopies (World III keeps the kit's green). */
  constructor(forest:THREE.Object3D,opts:{tealLeaves?:boolean}={}){
    forest.traverse(object=>{
      if(!(object instanceof THREE.BatchedMesh))return;
      const material=object.material as THREE.MeshStandardMaterial;
      const tree=/^(Bark_NormalTree|Leaves_NormalTree)$/.test(material.name);
      if(!tree&&!/^(Leaves|Flowers|Grass)$/.test(material.name))return;
      const reach={value:tree?8:1.5},strength={value:tree?1:.45},leaves=!!opts.tealLeaves&&material.name.startsWith('Leaves');
      // World II only: the night trees by species.
      const variant=(material.userData.starVariant as string|undefined)??'teal',night=opts.tealLeaves&&tree?(material.name.startsWith('Leaves')?nightLeaves(variant):nightBark(variant)):null;
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
          if(night&&target===material){
            shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vSwW;').replace('#include <fog_vertex>',`#include <fog_vertex>
vec4 swW=vec4(transformed,1.);
#ifdef USE_BATCHING
swW=batchingMatrix*swW;
#endif
vSwW=(modelMatrix*swW).xyz;`);
            shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform float uStarWindTime;\nvarying vec3 vSwW;')
              .replace('#include <map_fragment>',`#include <map_fragment>\n${night.tint}`).replace('#include <emissivemap_fragment>',night.emissive);
          }else if(leaves&&target===material)shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
{float l=dot(diffuseColor.rgb,vec3(.299,.587,.114));diffuseColor.rgb=mix(vec3(l),diffuseColor.rgb,.68)*vec3(.8,.98,1.08);}`);
        };
        target.customProgramCacheKey=()=>night&&target===material?`star-wind-v2-night-${material.name}-${variant}`:leaves&&target===material?'star-wind-v1-leaves':'star-wind-v1';
      };
      patch(material);
      const depth=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,
        map:material.map,alphaMap:material.alphaMap,alphaTest:material.alphaTest,side:material.side});
      depth.name='star-wind-shadow';patch(depth);object.customDepthMaterial=depth;
    });
  }
  update(time:number){this.time.value=time;}
}
