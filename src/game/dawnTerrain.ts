import * as THREE from 'three';
import { DAWN_SEA, DAWN_WIND, dawnSurface } from '../sim/world/dawnGround';
import { addPatch } from '../world/materials';

/*
 * Dawnharbor's ground: one mesh sampled vertex by vertex from dawnHeight() (the server's own surface), 1.25 m apart
 * over the island and its shelf, with a surface hint per vertex (sand, volcanic ground, trodden ground) from
 * dawnGround.ts. The material is the standard lit one with the albedo, the normal and the roughness drawn in the
 * shader: rippled dry sand that darkens and shines where the sea wets it, coastal grass in green and gold patches
 * with worn ground along the lanes, basalt and red scree up the volcanic climb, and banded rock on the bluffs, the
 * bands projected on the face's own plane so steep ground does not stretch.
 */

const SURFACE_GLSL = /* glsl */ `
uniform float dawnSea;
uniform vec2 dawnWind;
varying vec3 vDW;
varying vec3 vDN;
varying vec3 vDS;
float dgHash(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
float dgNoise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
  return mix(mix(dgHash(i),dgHash(i+vec2(1.,0.)),u.x),mix(dgHash(i+vec2(0.,1.)),dgHash(i+vec2(1.)),u.x),u.y);}
// Value noise and its gradient.
vec3 dgNoised(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f),du=6.*f*(1.-f);
  float a=dgHash(i),b=dgHash(i+vec2(1.,0.)),c=dgHash(i+vec2(0.,1.)),d=dgHash(i+vec2(1.));
  return vec3(a+(b-a)*u.x+(c-a)*u.y+(a-b-c+d)*u.x*u.y,du*(vec2(b-a,c-a)+(a-b-c+d)*u.yx));}
float dgFbm(vec2 p){float s=0.,a=.5;for(int i=0;i<4;i++){s+=a*dgNoise(p);p=mat2(1.6,1.2,-1.2,1.6)*p+vec2(5.3,-2.1);a*=.5;}return s/.9375;}
vec3 dgLin(vec3 c){return c*c*(c*.3+.7);}
// Output of dawnGroundSurface(): the albedo, the world normal and the roughness.
vec3 dgAlbedo;vec3 dgNormal;float dgRough;
void dawnGroundSurface(){
  vec3 p=vDW;vec3 ng=normalize(vDN);
  float slope=1.-ng.y;
  float px=length(fwidth(p.xz));
  float n1=dgFbm(p.xz*.045),n2=dgFbm(p.xz*.37+3.1),n3=dgNoise(p.xz*2.6);
  float sandW=vDS.x,volcW=vDS.y,wornW=vDS.z;
  // Decimetre and centimetre grain, faded out before a pixel covers it.
  #ifdef DAWN_LOW
  float f4=0.,f5=0.,n4=.5,n5=.5;
  #else
  float f4=1.-smoothstep(.04,.16,px),f5=1.-smoothstep(.015,.06,px);
  float n4=mix(.5,dgNoise(p.xz*8.3),f4),n5=mix(.5,dgNoise(p.xz*23.+7.),f5);
  #endif
  // Wind ripples on the sand: a gentle stoss slope and a short steep lee, crests across the wind.
  vec2 wind=normalize(dawnWind);
  float ph=dot(p.xz,wind)*1.75+dgNoise(p.xz*.35)*1.2+dgNoise(p.xz*1.9)*.25;
  float rf=fract(ph),lee=smoothstep(.7,.82,rf)*(1.-smoothstep(.97,1.,rf));
  float rgrad=mix(.9,-3.6,lee),rfade=(1.-smoothstep(.03,.09,px))*(.25+.75*smoothstep(.3,.7,dgNoise(p.xz*.09+1.3)));
  // Sand: dry and pale above the tide, darker and glossy where the sea wets it.
  float wet=1.-smoothstep(dawnSea+.08,dawnSea+.75+n2*.35,p.y);
  vec3 dry=dgLin(vec3(.88,.77,.6))*(.92+.12*n2)*(.95+.08*n3)*(.92+.16*n5)*(1.+.05*rfade*(rf-.5));
  vec3 damp=dgLin(vec3(.56,.46,.35))*(.9+.15*n2);
  vec3 sand=mix(dry,damp,wet);
  // Coastal grass: green and gold patches, darker lush clumps, a fine grain.
  vec3 grass=mix(dgLin(vec3(.45,.56,.28)),dgLin(vec3(.66,.63,.33)),smoothstep(.36,.7,n1));
  grass=mix(grass,dgLin(vec3(.33,.45,.22)),smoothstep(.55,.82,n2)*.55);
  grass*=(.8+.32*n3)*(.8+.4*n4)*(.86+.28*n5);
  // Sandy patches break through the grass toward the beaches.
  grass=mix(grass,dry*.95,smoothstep(.62,.8,n2+sandW*.5)*.6);
  // Trodden ground beside the lanes: packed earth with grass in the hollows.
  vec3 earth=dgLin(vec3(.74,.62,.46))*(.88+.2*n3)*(.85+.3*n5);
  float worn=wornW*smoothstep(.25,.65,n2*.8+wornW*.45);
  // Volcanic climb: dark basalt, grey scree, rusty ash.
  vec3 volc=mix(dgLin(vec3(.36,.32,.31)),dgLin(vec3(.54,.48,.43)),smoothstep(.35,.7,n2));
  volc=mix(volc,dgLin(vec3(.58,.4,.31)),smoothstep(.55,.85,n1)*.7)*(.85+.25*n3)*(.75+.5*n4)*(.85+.3*n5);
  // Tough grass clings on in the hollows of the lower climb.
  volc=mix(volc,grass*.85,smoothstep(.55,.8,n2)*(1.-smoothstep(9.,14.,p.y))*.6);
  vec3 col=grass;
  col=mix(col,earth,worn);
  col=mix(col,sand,smoothstep(.3,.7,sandW));
  col=mix(col,volc,volcW*smoothstep(.2,.55,volcW+n1*.4-.2));
  // Bluffs: bands of tuff and sandstone, basalt up the volcano; projected on the face so they run level.
  float steep=smoothstep(.3,.55,slope);
  vec2 fp=vec2(dot(p.xz,normalize(vec2(-ng.z,ng.x)+1e-5)),p.y);
  float warp=dgNoise(fp*vec2(.08,.3))*2.2;
  float band=dgNoise(vec2(fp.x*.05,(fp.y+warp)*1.7));
  float crack=smoothstep(.55,.9,dgNoise(fp*vec2(.9,.22)));
  vec3 tuff=mix(dgLin(vec3(.58,.48,.4)),dgLin(vec3(.72,.6,.48)),band)*(.86+.2*n3)*(1.-crack*.35);
  vec3 basalt=mix(dgLin(vec3(.24,.22,.23)),dgLin(vec3(.36,.32,.31)),band)*(1.-crack*.4);
  vec3 rock=mix(tuff,basalt,max(volcW,smoothstep(9.,13.,p.y)));
  col=mix(col,rock,steep);
  // Cavities darken: the foot of the bluffs and the dune troughs hold less sky.
  col*=1.-.18*smoothstep(.15,.4,slope)*(1.-steep);
  dgAlbedo=col;
  // Shading normal: ripples on the sand across the wind, grain in the grass, bands and cracks on the rock.
  vec2 g=vec2(0.);
  float sandy=smoothstep(.3,.7,sandW)*(1.-steep)*(1.-volcW);
  g+=wind*rgrad*.075*sandy*rfade*(1.-wet*.8);
  vec3 gn=dgNoised(p.xz*1.7),gb=f4>0.?dgNoised(p.xz*8.3):vec3(0.);
  g+=(gn.yz*.06+gb.yz*.03*f4)*(1.-sandy)*(1.-steep);
  vec3 bn=dgNoised(fp*vec2(.35,1.4)+vec2(0.,warp));
  vec3 nw=normalize(ng+vec3(-g.x,0.,-g.y));
  vec3 fx=normalize(vec3(-ng.z,0.,ng.x)+1e-5);
  nw=normalize(nw+(fx*bn.y*.12+vec3(0.,1.,0.)*bn.z*.18)*steep);
  dgNormal=nw;
  dgRough=mix(.92,.42,wet*sandy)*(1.-steep*.05);
}
`;

/** Patch a MeshStandardMaterial so its albedo, normal and roughness are Dawnharbor's ground. */
export function applyDawnGround(material: THREE.MeshStandardMaterial): void {
  const uniforms = { dawnSea: { value: DAWN_SEA }, dawnWind: { value: new THREE.Vector2(DAWN_WIND[0], DAWN_WIND[1]) } };
  material.userData.dawnGround = uniforms;
  addPatch(material, 'dawnharbor-ground', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 dawnSurf;\nvarying vec3 vDW;\nvarying vec3 vDN;\nvarying vec3 vDS;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDW=(modelMatrix*vec4(transformed,1.)).xyz;vDN=normalize(mat3(modelMatrix)*objectNormal);vDS=dawnSurf;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${SURFACE_GLSL}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndawnGroundSurface();diffuseColor.rgb*=dgAlbedo;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor=dgRough;')
      .replace('#include <normal_fragment_maps>', 'normal=normalize((viewMatrix*vec4(dgNormal,0.)).xyz);');
  });
}

/** The ground mesh over [minX, maxX] x [minZ, maxZ], `step` metres apart. */
export function dawnTerrain(height: (x: number, z: number) => number, opts: { step?: number; minX?: number; maxX?: number; minZ?: number; maxZ?: number } = {}): THREE.Mesh {
  const step = opts.step ?? 1.25, minX = opts.minX ?? -160, maxX = opts.maxX ?? 160, minZ = opts.minZ ?? -175, maxZ = opts.maxZ ?? 185;
  const nx = Math.round((maxX - minX) / step), nz = Math.round((maxZ - minZ) / step);
  const geo = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ, nx, nz);
  geo.rotateX(-Math.PI / 2);
  geo.translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute, surf = new Float32Array(pos.count * 3), s = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = height(x, z);
    pos.setY(i, y);
    dawnSurface(x, z, y, s);
    surf[i * 3] = s[0]; surf[i * 3 + 1] = s[1]; surf[i * 3 + 2] = s[2];
  }
  geo.setAttribute('dawnSurf', new THREE.BufferAttribute(surf, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.92, metalness: 0 });
  // The scene's environment map belongs to another world; this ground is lit by the dawn alone.
  material.envMapIntensity = 0;
  applyDawnGround(material);
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'dawn-ground';
  mesh.userData.setQuality = (q: 'high' | 'low') => {
    const low = q === 'low', d = (material.defines ??= {});
    if (('DAWN_LOW' in d) === low) return;
    if (low) d.DAWN_LOW = ''; else delete d.DAWN_LOW;
    material.needsUpdate = true;
  };
  mesh.receiveShadow = true;
  // No self-shadowing: at an 11 degree sun the shadow map cannot resolve gentle dunes and would band them with acne.
  mesh.castShadow = false;
  mesh.userData.step = step;
  return mesh;
}
