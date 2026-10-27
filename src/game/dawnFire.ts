import * as THREE from 'three';

/*
 * The arena's two fire bowls as light, drawn only by the citadel's own materials (the sun-dial floor, the court and
 * the masonry: dawnArena.ts, dawnMasonry.ts). The court lies in the citadel's shadow at Goldsand's low sun and the
 * fire is what warms its stone; as real PointLights they would make every lit pixel in the world (the whole desert,
 * the town) pay for two more lights, so the same falloff three.js gives a point light (cutoff, decay) is added here,
 * in the two materials that can see it.
 */

/** Linear colour times candela, and the falloff of each fire. */
const COLOR = new THREE.Color('#ffa957'), CANDELA = 150, CUTOFF = 36, DECAY = 1.5;

export const DAWN_FIRE = {
  dawnFirePos: { value: [new THREE.Vector3(), new THREE.Vector3()] },
  dawnFireCol: { value: [new THREE.Color(), new THREE.Color()] },
};

/** Place the two fires (world space). */
export function setDawnFires(a: THREE.Vector3, b: THREE.Vector3): void {
  DAWN_FIRE.dawnFirePos.value[0].copy(a);
  DAWN_FIRE.dawnFirePos.value[1].copy(b);
}

/** Flicker; `on` false (low quality) puts them out. No allocation. */
export function updateDawnFires(time: number, on: boolean): void {
  for (let i = 0; i < 2; i++) {
    const k = on ? CANDELA * (1 + 0.07 * Math.sin(time * 7.3 + i * 2.1) + 0.05 * Math.sin(time * 12.9 + i)) : 0;
    DAWN_FIRE.dawnFireCol.value[i].copy(COLOR).multiplyScalar(k);
  }
}

/** Uniform declarations, for the fragment shader's head. */
export const DAWN_FIRE_HEAD = /* glsl */ `
uniform vec3 dawnFirePos[2];
uniform vec3 dawnFireCol[2];
`;

/** After lights_fragment_end: the fires' diffuse, as a three.js point light would add it. */
export const DAWN_FIRE_LIGHT = /* glsl */ `
for(int i=0;i<2;i++){
  vec3 fv=(viewMatrix*vec4(dawnFirePos[i],1.)).xyz-geometryPosition;float fd=max(length(fv),.05);
  float fa=pow(clamp(1.-pow(fd/${CUTOFF.toFixed(1)},4.),0.,1.),2.)/max(pow(fd,${DECAY.toFixed(1)}),.01);
  vec3 fl=fv/fd;float fn=max(dot(geometryNormal,fl),0.);
  reflectedLight.directDiffuse+=dawnFireCol[i]*fa*fn*BRDF_Lambert(material.diffuseColor);
  // Its glint on gilt and polished stone: normalised Blinn-Phong at the material's roughness.
  float fs=clamp(2./max(pow(material.roughness,4.),.002)-2.,1.,1000.);
  reflectedLight.directSpecular+=dawnFireCol[i]*fa*fn*material.specularColor*pow(max(dot(geometryNormal,normalize(fl+geometryViewDir+vec3(0.,1e-4,0.))),1e-4),fs)*(fs+8.)*.0398;
}
`;
