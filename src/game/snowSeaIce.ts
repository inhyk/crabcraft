import * as THREE from 'three';
import { SNOW_SEA_ICE, SNOW_WIND } from '../sim/world/snowGround';
import { GLSL_NOISE } from '../world/noise';

/*
 * The frozen sea as a place, seen from above: floes of bare blue-grey ice with snow drifted across them in streaks
 * along the wind, white rubble ridges where floes met, darker refrozen leads between some of them, and shore-fast
 * ice under snow along the coast that frays out into the floes, trailing tongues downwind. The island then reads
 * as land with a coast, not a white ellipse on a white plane.
 *
 * A sheet just over the sea ice that multiplies what the clipmap already lit and shadowed, so the sea keeps its own
 * light, shadows and fog; the land stands above the sheet and hides it. It gives way where the view grazes the ice
 * (glossy ice mirrors the bright sky there, so the low views keep their pale sea and horizon) and into the fog.
 */

const R3 = (v: number) => v.toFixed(4);

const VERTEX = /* glsl */ `
varying vec3 vW;
varying float vDepth;
void main(){
  vec4 w=modelMatrix*vec4(position,1.);
  vW=w.xyz;
  vec4 mv=viewMatrix*w;
  vDepth=-mv.z;
  gl_Position=projectionMatrix*mv;
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D snowGroundTex;
uniform vec4 snowGroundRect;
#ifdef USE_FOG
uniform float fogDensity;
#endif
varying vec3 vW;
varying float vDepth;
${GLSL_NOISE}
const vec2 WIND=vec2(${R3(SNOW_WIND[0])},${R3(SNOW_WIND[1])});
// Floes: distance to the nearest cell edge (metres, cell size s) and the cell's own random value.
vec2 floe(vec2 p,float s){
  vec2 q=p/s,i=floor(q),f=fract(q);
  float d1=8.,d2=8.;vec2 id=vec2(0.);
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
    vec2 g=vec2(float(x),float(y)),o=g+.15+.7*cc_hash22(i+g)-f;
    float d=dot(o,o);
    if(d<d1){d2=d1;d1=d;id=i+g;}else if(d<d2)d2=d;
  }
  return vec2((sqrt(d2)-sqrt(d1))*.5*s,cc_hash12(id+3.7));
}
void main(){
  vec2 p=vW.xz;
  // Out from the coast, metres: the ground bake's sea mask on and near the island, the coast ellipse beyond it.
  vec2 uv=(p-snowGroundRect.xy)*snowGroundRect.z;
  float sea=all(greaterThanEqual(uv,vec2(0.)))&&all(lessThanEqual(uv,vec2(1.)))?textureLod(snowGroundTex,uv,0.).w:1.;
  float e=length(vec2(p.x/128.,(p.y-2.)/155.));
  float out_=(e-.9)*140.;
  vec2 fw=fwidth(p);float px=max(fw.x,fw.y);
  // Wind axes: along (a) and across (c).
  float a=dot(p,WIND),c=dot(p,vec2(-WIND.y,WIND.x));
  // Shore-fast ice under snow, fraying into the floes; downwind it trails long tongues.
  float lee=max(0.,dot(normalize(p-vec2(0.,2.)),WIND));
  float tongue=smoothstep(.55,.85,cc_vnoise(vec2(a/60.,c/9.)))*lee;
  float fray=cc_vnoise(p/23.)*.6+cc_vnoise(p/7.)*.4;
  float shore=1.-smoothstep(4.,26.,out_+(fray-.5)*22.-tongue*40.);
  // Floes ~40 m across, a patchwork of old snow-covered and new bare ice. Some seams are rubble ridges, broken and
  // of uneven width, a few are dark refrozen leads; most show only as the change from one floe's ice to the next.
  vec2 warp=vec2(cc_vnoise(p/31.),cc_vnoise(p/29.+5.))*14.;
  vec2 fl=floe(p+warp,40.);
  float k=fl.y,kind=fract(k*7.3);
  float edgeAA=max(px*1.5,.6);
  float run=smoothstep(.35,.62,cc_vnoise(p/13.+k*9.));
  float wid=.7+1.8*cc_vnoise(p/6.+3.1);
  float ridge=(1.-smoothstep(0.,wid+edgeAA,fl.x))*run*step(.55,kind);
  float lead=(1.-smoothstep(.15,.9+edgeAA,fl.x))*step(kind,.16)*(1.-run*.6);
  // Long leads between the great floes.
  vec2 big=floe(p*vec2(1.,1.6)+warp*2.,150.);
  lead=max(lead,(1.-smoothstep(.4,1.6+edgeAA,big.x))*smoothstep(.3,.6,cc_vnoise(p/40.+big.y*5.))*step(.45,big.y));
  // Drifted snow in streaks along the wind; old floes carry more of it.
  float streak=cc_vnoise(vec2(a/26.,c/3.6))*.65+cc_vnoise(vec2(a/9.,c/1.6)+7.)*.35*(1.-smoothstep(.4,1.5,px));
  // Out from the coast the drifted snow thins and the ice goes darker, so the sea falls off from the island's white.
  float off=smoothstep(10.,170.,out_);
  float snow=smoothstep(.58+.1*off,.8+.1*off,streak+(k-.5)*.7);
  vec3 ice=mix(vec3(.31,.41,.54),vec3(.48,.58,.7),smoothstep(.2,.9,k))*(1.-.12*off);
  vec3 K=mix(ice,vec3(.95,.97,1.),max(snow*.78,ridge*.72));
  K=mix(K,vec3(.2,.28,.4),lead*.9);
  // Off the coast only, and gone well before the sheet's rim.
  float w=smoothstep(.5,1.,sea)*(1.-shore)*(1.-smoothstep(430.,640.,length(p)));
  // Glossy ice mirrors the bright sky at a grazing view; the fog takes the rest.
  vec3 V=normalize(cameraPosition-vW);
  w*=1.-pow(1.-clamp(V.y,0.,1.),3.);
  #ifdef USE_FOG
  float fd=fogDensity*vDepth;w*=exp(-fd*fd);
  #endif
  gl_FragColor=vec4(mix(vec3(1.),K,w),1.);
}`;

/** The sea-ice sheet. `ground` is the clipmap's baked ground (SnowTerrain.uniforms). */
export function snowSeaIce(ground: { snowGroundTex: THREE.IUniform<THREE.Texture | null>; snowGroundRect: THREE.IUniform<THREE.Vector4> }): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    name: 'frostlight-sea-ice',
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
    fog: true,
    transparent: true,
    depthWrite: false,
    // dst * src: a darker albedo over the light the snow already has.
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.ZeroFactor,
    blendDst: THREE.SrcColorFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
  // Shared by reference, so the sheet follows a re-bake.
  mat.uniforms.snowGroundTex = ground.snowGroundTex;
  mat.uniforms.snowGroundRect = ground.snowGroundRect;
  // Over the sea ice's pressure ridges, under anything a player sees standing on the sea.
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400).rotateX(-Math.PI / 2).translate(0, SNOW_SEA_ICE + 0.62, 2), mat);
  mesh.name = 'frostlight-sea-ice';
  mesh.renderOrder = -50;
  mesh.castShadow = mesh.receiveShadow = false;
  return mesh;
}
