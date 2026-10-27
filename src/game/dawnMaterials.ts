import * as THREE from 'three';
import {FROST_NOISE} from './frostPaving';
import {addPatch} from '../world/materials';

/*
 * Dawnharbor's own surfaces for crafted props (lamps, quay, boats, gate): warm sandstone, black iron, sun-bleached
 * and painted wood, rope, and the lanterns' glass. World-space shading so merged meshes need no UVs; one material
 * per surface, so every prop of the town shares a handful of draws.
 */

const VERT_HEAD = 'varying vec3 vDwW;\nvarying vec3 vDwN;\n';
const VERT_BODY = 'vDwW=(modelMatrix*vec4(transformed,1.)).xyz;vDwN=normalize(mat3(modelMatrix)*objectNormal);';
const FRAG_HEAD = `varying vec3 vDwW;\nvarying vec3 vDwN;\n${FROST_NOISE}
vec3 dwTri(vec3 n){vec3 a=abs(n);return a/(a.x+a.y+a.z);}
float dwN3(vec3 p,vec3 w){return fpNoise(p.zy)*w.x+fpNoise(p.xz+3.1)*w.y+fpNoise(p.xy-7.7)*w.z;}
`;
function worldPatch(mat: THREE.MeshStandardMaterial, key: string, color: string, rough?: string, normal?: string, extraVert = '', extraVertBody = '') {
  addPatch(mat, key, (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}${extraVert}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${VERT_BODY}${extraVertBody}`);
    let f = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_HEAD}${extraVert.replace(/attribute [^;]+;\n?/g, '')}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${color}`);
    if (rough) f = f.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${rough}`);
    if (normal) f = f.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${normal}`);
    shader.fragmentShader = f;
  });
}

/** Bump the shading normal by a world-space height field H(p) (GLSL expression in p), strength k. */
const bump = (h: string, k: string, e = '.02') => `{
  vec3 nW=inverseTransformDirection(normal,viewMatrix);
  #define DW_H(p) (${h})
  float e=${e},h0=DW_H(vDwW);
  vec3 g=vec3(DW_H(vDwW+vec3(e,0.,0.))-h0,DW_H(vDwW+vec3(0.,e,0.))-h0,DW_H(vDwW+vec3(0.,0.,e))-h0)/e;
  g-=dot(g,nW)*nW;
  float fade=1.-smoothstep(12.,40.,length(vViewPosition));
  nW=normalize(nW-g*(${k})*fade);
  normal=normalize((viewMatrix*vec4(nW,0.)).xyz);
  #undef DW_H
}`;

/** Dressed sandstone: honey with cream beds, darker grime at the foot, pitted tooling. Vertex colour tints it. */
export function dawnSandstone(name = 'dawnharbor-sandstone'): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({name, color: '#ffffff', roughness: .9});
  worldPatch(m, 'dw-sandstone', /* glsl */ `
    vec3 sw=dwTri(normalize(vDwN));
    float sn=dwN3(vDwW*2.1,sw)*.5+.5,sb=sin(vDwW.y*9.+dwN3(vDwW*.8,sw)*3.)*.5+.5;
    vec3 sc=mix(vec3(.5,.36,.21),vec3(.62,.51,.36),sb*.6+sn*.4);
    sc*=.86+.24*(dwN3(vDwW*11.,sw)*.5+.5);
    sc=mix(sc,vec3(.62,.58,.5),smoothstep(.62,.8,dwN3(vDwW*1.3+5.,sw)*.5+.5)*.35);
    diffuseColor.rgb*=sc;`, undefined, bump('fpNoise((p).xz*13.)*.5+fpNoise((p).zy*13.+2.)*.5+fpNoise((p).xy*13.-4.)*.5', '.012'));
  m.customProgramCacheKey = () => 'dw-sandstone';
  return m;
}

/** Black wrought iron with a little rust where water stands. */
export function dawnIron(name = 'dawnharbor-iron'): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({name, color: '#ffffff', roughness: .5, metalness: .65});
  worldPatch(m, 'dw-iron', /* glsl */ `
    vec3 iw=dwTri(normalize(vDwN));
    float rust=smoothstep(.55,.85,dwN3(vDwW*6.,iw)*.5+.5+normalize(vDwN).y*.15);
    diffuseColor.rgb*=mix(vec3(.05,.048,.046),vec3(.22,.1,.04),rust*.6);`, 'roughnessFactor=mix(.42,.82,rust);');
  m.customProgramCacheKey = () => 'dw-iron';
  return m;
}

/** Lantern glass: amber, hottest low in the pane where the flame burns. */
export function dawnLanternGlass(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({name: 'dawnharbor-lantern-glass', color: '#3a2410', emissive: '#ffb35a', emissiveIntensity: 2.4, roughness: .15, metalness: 0});
  addPatch(m, 'dw-glass', (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vGl;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvGl=uv;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vGl;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance*=.55+.9*(1.-smoothstep(.1,.95,vGl.y));');
  });
  return m;
}

/**
 * Wood along each part's long axis (attribute aAxis, world direction): sun-bleached grain, or chipped paint
 * over it where vertex colour has a paint (rgb) and the alpha-free paint amount in `aPaint`.
 */
export function dawnWood(name = 'dawnharbor-wood'): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({name, color: '#ffffff', roughness: .85, vertexColors: true});
  worldPatch(m, 'dw-wood', /* glsl */ `
    vec3 wa=normalize(vDwAxis),wp=normalize(cross(wa,abs(wa.y)<.9?vec3(0.,1.,0.):vec3(1.,0.,0.))),wq=cross(wa,wp);
    float along=dot(vDwW,wa),r1=dot(vDwW,wp),r2=dot(vDwW,wq);
    float grain=fpNoise(vec2(along*.7,(r1+r2)*14.))*.5+.5,fine=fpNoise(vec2(along*3.,(r1-r2)*60.))*.5+.5;
    vec3 wood=mix(vec3(.3,.22,.15),vec3(.5,.41,.31),grain*.7+fine*.3);
    wood=mix(wood,vec3(.43,.42,.4),.35);
    float paint=vDwPaint*smoothstep(.3,.5,fpNoise(vec2(along*1.7,(r1+r2)*5.))*.5+.5+vDwPaint*.35);
    vec3 pc=vColor.rgb*(.9+.16*fine);
    diffuseColor.rgb=mix(wood*(.85+.3*fine),pc,paint);`,
  'roughnessFactor=mix(.88,.7,paint);',
  bump('fpNoise(vec2(dot(p,normalize(vDwAxis))*.7,dot(p,vec3(1.))*14.))', '.004'),
  'attribute vec3 aAxis;\nattribute float aPaint;\nvarying vec3 vDwAxis;\nvarying float vDwPaint;\n', 'vDwAxis=normalize(mat3(modelMatrix)*aAxis);vDwPaint=aPaint;');
  m.customProgramCacheKey = () => 'dw-wood';
  return m;
}

/** Hemp rope and netting: a twisted strand pattern along the world. */
export function dawnRope(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({name: 'dawnharbor-rope', color: '#ffffff', roughness: .95, side: THREE.DoubleSide});
  worldPatch(m, 'dw-rope', /* glsl */ `
    float tw=sin((vDwW.x+vDwW.y+vDwW.z)*90.)*.5+.5;
    diffuseColor.rgb*=mix(vec3(.38,.3,.19),vec3(.56,.46,.3),tw)*(.85+.3*(fpNoise(vDwW.xz*4.)*.5+.5));`);
  m.customProgramCacheKey = () => 'dw-rope';
  return m;
}

/** Wood part helper: tag a placed geometry with its long axis and paint for dawnWood(). */
export function woodPart(g: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.ColorRepresentation | null = null, paint = 0, axis = new THREE.Vector3(1, 0, 0)): THREE.BufferGeometry {
  const out = (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(m);
  for (const k of Object.keys(out.attributes)) if (!['position', 'normal'].includes(k)) out.deleteAttribute(k);
  const n = out.getAttribute('position').count, ax = axis.clone().transformDirection(m), c = new THREE.Color(color ?? '#ffffff');
  const a = new Float32Array(n * 3), p = new Float32Array(n), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a.set([ax.x, ax.y, ax.z], i * 3); p[i] = color ? paint : 0; col.set([c.r, c.g, c.b], i * 3); }
  out.setAttribute('aAxis', new THREE.BufferAttribute(a, 3));
  out.setAttribute('aPaint', new THREE.BufferAttribute(p, 1));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

/** Plain geometry helper: non-indexed, position + normal (+ uv when kept) only, placed by m. */
export function solidPart(g: THREE.BufferGeometry, m: THREE.Matrix4, keepUv = false): THREE.BufferGeometry {
  const out = (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(m);
  for (const k of Object.keys(out.attributes)) if (!['position', 'normal', ...(keepUv ? ['uv'] : [])].includes(k)) out.deleteAttribute(k);
  return out;
}

/** Soft additive glows (one draw): world positions, colour and size in metres. */
export function dawnGlows(spots: {pos: THREE.Vector3; size: number}[], color: THREE.ColorRepresentation, name: string): THREE.Points {
  const pos = new Float32Array(spots.length * 3), size = new Float32Array(spots.length), seed = new Float32Array(spots.length);
  spots.forEach((s, i) => { pos.set([s.pos.x, s.pos.y, s.pos.z], i * 3); size[i] = s.size; seed[i] = i * 1.37; });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {uColor: {value: new THREE.Color(color)}, uTime: {value: 0}, uScale: {value: 450}},
    vertexShader: /* glsl */ `attribute float aSize;attribute float aSeed;uniform float uTime;uniform float uScale;varying float vF;
      void main(){vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;
      vF=.88+.08*sin(uTime*7.3+aSeed*5.)+.05*sin(uTime*13.1+aSeed);gl_PointSize=aSize*uScale/max(-mv.z,.5)*vF;}`,
    fragmentShader: /* glsl */ `uniform vec3 uColor;varying float vF;void main(){vec2 d=gl_PointCoord-.5;float r=length(d)*2.;
      float a=exp(-r*r*5.)*.7+exp(-r*r*40.)*.6;if(a<.005)discard;gl_FragColor=vec4(uColor*a*vF,1.);}`,
  });
  const p = new THREE.Points(g, mat);
  p.name = name; p.frustumCulled = false;
  return p;
}
