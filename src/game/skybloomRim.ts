import * as THREE from 'three';

/*
 * Skybloom's silver sun-side rim (refs-w6-sky 2.3) for canopies: where a crown's surface turns edge-on to the camera on
 * the side facing the low sun, it catches a warm-white line of light, strongest when the camera looks into the sun.
 * One shared pair of uniforms (SkybloomAir sets the sun once); each foliage material splices RIM_FRAGMENT in after
 * <emissivemap_fragment>, where `normal` and `vViewPosition` are in view space.
 */
export const SKY_RIM = {skRimSun: {value: new THREE.Vector3(0, 1, 0)}, skRimColor: {value: new THREE.Color(0, 0, 0)}};

export const RIM_HEAD = /* glsl */ `uniform vec3 skRimSun;uniform vec3 skRimColor;`;

/** `k` scales the rim; `tint` mixes it from silver toward the surface's own colour (0 silver, 1 albedo). */
export const rimFragment = (k: number, tint: number) => /* glsl */ `
{vec3 rV=normalize(vViewPosition),rL=normalize((viewMatrix*vec4(skRimSun,0.)).xyz);
 float rF=pow(1.-clamp(abs(dot(normal,rV)),0.,1.),2.5);
 float rSide=smoothstep(-.15,.55,dot(normal,rL));
 float rInto=.55+.9*pow(max(dot(-rV,rL),0.),2.);
 totalEmissiveRadiance+=skRimColor*mix(vec3(1.),diffuseColor.rgb*2.2,${tint.toFixed(2)})*rF*rSide*rInto*${k.toFixed(2)};}`;

export function useRim(shader: {uniforms: Record<string, THREE.IUniform>; fragmentShader: string}, k: number, tint: number): void {
  Object.assign(shader.uniforms, SKY_RIM);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${RIM_HEAD}`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${rimFragment(k, tint)}`);
}
