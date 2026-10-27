import * as THREE from 'three';

/*
 * Light thrown on the ground: warm pools under the lanterns, teal and violet glows round the crystals. Each spot is
 * a small grid laid on the island's height function (so it follows slopes and never floats or cuts in as a flat
 * quad), added over whatever is beneath with an inverse-square falloff from a source `lift` metres up. All spots
 * of one call are one merged mesh and one draw; nothing moves, so nothing is computed per frame.
 */

export interface GlowSpot { x: number; z: number; r: number; color: THREE.ColorRepresentation; strength: number; lift: number }

const GLOW_VERT = /* glsl */ `
attribute vec3 aGlow;attribute vec3 aSpot;
varying vec3 vGlow;varying vec3 vSpot;
#include <fog_pars_vertex>
void main(){vGlow=aGlow;vSpot=aSpot;vec4 mvPosition=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mvPosition;
#include <fog_vertex>
}`;
const GLOW_FRAG = /* glsl */ `
varying vec3 vGlow;varying vec3 vSpot;
#include <fog_pars_fragment>
void main(){
  // vSpot: distance from the source's foot (m), the spot's radius, the source height.
  float d=vSpot.x,R=vSpot.y,h=vSpot.z;
  float i=h*h*h/pow(h*h+d*d,1.5);
  i*=1.-smoothstep(R*.6,R,d);
  gl_FragColor=vec4(vGlow*i,1.);
  #ifdef USE_FOG
  #ifdef FOG_EXP2
  float fogFactor=1.-exp(-fogDensity*fogDensity*vFogDepth*vFogDepth);
  #else
  float fogFactor=smoothstep(fogNear,fogFar,vFogDepth);
  #endif
  gl_FragColor.rgb*=1.-fogFactor;
  #endif
}`;

export function groundGlow(name: string, height: (x: number, z: number) => number, spots: GlowSpot[], segments = 8): THREE.Mesh {
  const pos: number[] = [], glow: number[] = [], spot: number[] = [], idx: number[] = [], c = new THREE.Color();
  const n = segments + 1;
  for (const s of spots) {
    c.set(s.color).multiplyScalar(s.strength);
    const base = pos.length / 3;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const u = i / segments * 2 - 1, v = j / segments * 2 - 1, x = s.x + u * s.r, z = s.z + v * s.r;
      pos.push(x, height(x, z) + .05, z);glow.push(c.r, c.g, c.b);spot.push(Math.hypot(u, v) * s.r, s.r, s.lift);
    }
    for (let j = 0; j < segments; j++) for (let i = 0; i < segments; i++) {
      const a = base + j * n + i, b = a + 1, d = a + n, e = d + 1;idx.push(a, d, b, b, d, e);
    }
  }
  const g = new THREE.BufferGeometry();g.name = name;
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aGlow', new THREE.Float32BufferAttribute(glow, 3));
  g.setAttribute('aSpot', new THREE.Float32BufferAttribute(spot, 3));
  g.setIndex(idx);g.computeBoundingSphere();
  const m = new THREE.ShaderMaterial({name, vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: true, uniforms: THREE.UniformsUtils.clone(THREE.UniformsLib.fog)});
  const mesh = new THREE.Mesh(g, m);mesh.name = name;mesh.renderOrder = 1;
  return mesh;
}
