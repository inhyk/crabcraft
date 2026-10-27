import * as THREE from 'three';
import { DAWN_SEA } from '../sim/world/dawnGround';
import { DAWN_SKY_GLSL, type DawnSky } from './dawnSky';

/*
 * Dawnharbor's sea. One plane, one draw: the water's depth comes from the island's ground baked once into a small
 * height texture, so the colour runs from wet sand through shallow turquoise to the deep blue offshore, foam laps
 * the shore where the water thins, and the edge melts into the sand instead of cutting it. Long swells and fine
 * ripples tilt the surface; it reflects the dawn sky's own LUT, and the low sun lays a glitter path across it.
 */

const SEA_VERTEX = /* glsl */ `
varying vec3 vWorld;
#include <fog_pars_vertex>
void main(){
  vec4 w=modelMatrix*vec4(position,1.);
  vWorld=w.xyz;
  vec4 mvPosition=viewMatrix*w;
  gl_Position=projectionMatrix*mvPosition;
  #include <fog_vertex>
}
`;

const SEA_FRAGMENT = /* glsl */ `
#include <common>
${DAWN_SKY_GLSL}
uniform sampler2D seaGround;
uniform vec4 seaBox;
uniform float seaLevel;
uniform float time;
uniform vec3 sunLight;
uniform vec3 skyLight;
uniform vec2 swellDir;
varying vec3 vWorld;
#include <fog_pars_fragment>
float swHash(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
// Value noise with its gradient: (value, d/dx, d/dy).
vec3 swNoised(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f),du=6.*f*(1.-f);
  float a=swHash(i),b=swHash(i+vec2(1.,0.)),c=swHash(i+vec2(0.,1.)),d=swHash(i+vec2(1.));
  return vec3(a+(b-a)*u.x+(c-a)*u.y+(a-b-c+d)*u.x*u.y,du*(vec2(b-a,c-a)+(a-b-c+d)*u.yx));}
float groundAt(vec2 p){vec2 uv=(p-seaBox.xy)/seaBox.zw;if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return -30.;return texture2D(seaGround,uv).r;}
void main(){
  vec2 p=vWorld.xz;
  vec3 toEye=cameraPosition-vWorld;float dist=length(toEye);vec3 v=toEye/dist;
  float depth=seaLevel-groundAt(p);
  // Swells: a few long Gerstner-like trains off the open sea, slowed and steepened in the shallows.
  vec2 g=vec2(0.);
  float shoal=1.-smoothstep(.5,6.,depth)*.6;
  for(int i=0;i<5;i++){
    float fi=float(i);
    float ang=(fi-2.)*.35+sin(fi*1.7)*.2;
    vec2 dir=vec2(cos(ang)*swellDir.x-sin(ang)*swellDir.y,sin(ang)*swellDir.x+cos(ang)*swellDir.y);
    float k=6.2832/(14.-fi*2.3),w=sqrt(9.8*k);
    float a=.11/(1.+fi*.7)*shoal;
    g+=dir*a*k*cos(dot(dir,p)*k-w*time+fi*1.3);
  }
  // Fine ripples for the glitter, faded with distance before they alias.
  float fade=1.-smoothstep(40.,320.,dist);
  #ifndef DAWN_LOW
  vec3 r1=swNoised(p*1.3+vec2(time*.31,time*.17)),r2=swNoised(p*2.7-vec2(time*.23,-time*.29));
  g+=(r1.yz*1.3+r2.yz*2.7)*.035*fade;
  #else
  g+=swNoised(p*1.3+vec2(time*.31,time*.17)).yz*.05*fade;
  #endif
  g+=swNoised(p*.18+vec2(time*.05,0.)).yz*.18*.18;
  vec3 n=normalize(vec3(-g.x,1.,-g.y));
  vec3 r=reflect(-v,n);r.y=abs(r.y)+.004;
  vec3 sky=dawnSky(r);
  float ndv=max(dot(n,v),0.);
  float fres=.02+.98*pow(1.-ndv,5.);
  // Water body: sand under a hand of water, turquoise over the shelf, deep blue offshore; lit by the dawn.
  vec3 shallow=vec3(.035,.26,.25),deep=vec3(.006,.04,.075),sand=vec3(.33,.25,.16);
  vec3 body=mix(shallow,deep,1.-exp(-max(depth,0.)*.22));
  body=mix(sand,body,smoothstep(.0,1.6,depth));
  vec3 light=skyLight*.85+sunLight*max(dawnSunDir.y,0.)*1.4;
  vec3 col=body*light;
  // Forward scatter: the swells' thin crests glow green-gold with the low sun behind them.
  float back=pow(max(dot(-v,dawnSunDir),0.),4.)*smoothstep(.0,.3,g.x*dawnSunDir.x+g.y*dawnSunDir.z+.15);
  col+=vec3(.05,.2,.16)*sunLight*back*.25*smoothstep(1.,4.,depth);
  col=mix(col,sky,fres);
  // The sun's glitter path: a tight lobe on the rippled facets, wider far out where the ripples blur together.
  vec3 hv=normalize(dawnSunDir+v);
  float shin=mix(260.,1400.,fade);
  float spec=pow(max(dot(n,hv),0.),shin)*(shin+2.)/8.;
  col+=sunLight*spec*.09*fres*5.;
  // Foam: lines of surf running up the shelf, a lacy wash at the very edge, broken by noise.
  float lace=swNoised(p*.9+vec2(time*.08,-time*.05)).x;
  float run=fract(depth*.85-time*.16+lace*.35);
  float surf=smoothstep(.0,.06,run)*(1.-smoothstep(.06,.28,run))*(1.-smoothstep(.15,1.9,depth));
  float wash=(1.-smoothstep(.03,.32,depth))*smoothstep(.35,.62,lace+.18);
  float foam=clamp(surf*smoothstep(.3,.7,lace)+wash,0.,1.)*smoothstep(-.05,.04,depth);
  col=mix(col,vec3(.9,.86,.8)*light*.9,foam*.85);
  // The water thins to nothing over the sand, so the shore has no hard line.
  float alpha=smoothstep(-.02,.22,depth);
  gl_FragColor=vec4(col,alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** The island's ground sampled for the sea's depth: x, z bounds and a texture of heights. */
function groundTexture(height: (x: number, z: number) => number, box: THREE.Vector4, res: number): THREE.DataTexture {
  const data = new Uint16Array(res * res);
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const x = box.x + ((i + 0.5) / res) * box.z, z = box.y + ((j + 0.5) / res) * box.w;
    data[j * res + i] = THREE.DataUtils.toHalfFloat(Math.max(-30, Math.min(40, height(x, z))));
  }
  const t = new THREE.DataTexture(data, res, res, THREE.RedFormat, THREE.HalfFloatType);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

export interface DawnSea { mesh: THREE.Mesh; update(time: number): void; setQuality(q: 'high' | 'low'): void }

export function dawnSea(sky: DawnSky, height: (x: number, z: number) => number, low = false): DawnSea {
  const box = new THREE.Vector4(-180, -195, 360, 400);
  const ground = groundTexture(height, box, low ? 192 : 320);
  const sunLight = sky.sunColor.clone().multiplyScalar(sky.sunIntensity);
  const material = new THREE.ShaderMaterial({
    name: 'dawn-sea',
    vertexShader: SEA_VERTEX,
    fragmentShader: SEA_FRAGMENT,
    transparent: true,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      seaGround: { value: null },
      seaBox: { value: box },
      seaLevel: { value: DAWN_SEA },
      time: { value: 0 },
      sunLight: { value: sunLight },
      skyLight: { value: sky.hemiSky.clone() },
      swellDir: { value: new THREE.Vector2(-0.34, 0.94).normalize() },
    }]),
  });
  // merge() clones textures; hand the shared ones in after it.
  material.uniforms.seaGround.value = ground;
  material.uniforms.dawnSkyLUT = sky.uniforms.dawnSkyLUT;
  material.uniforms.dawnSunDir = sky.uniforms.dawnSunDir;
  material.addEventListener('dispose', () => ground.dispose());
  const geo = new THREE.PlaneGeometry(2400, 2400, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'dawn-sea';
  mesh.position.y = DAWN_SEA;
  mesh.renderOrder = 1;
  return {
    mesh,
    update(time) { material.uniforms.time.value = time; },
    setQuality(q) { const low = q === 'low'; if (('DAWN_LOW' in material.defines) === low) return; material.defines = low ? { DAWN_LOW: '' } : {}; material.needsUpdate = true; },
  };
}
