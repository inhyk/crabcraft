import * as THREE from 'three';
import {addPatch} from '../world/materials';
import {GLSL_NOISE} from '../world/noise';
import {SNOW_WIND} from '../sim/world/snowGround';

/*
 * Snow that settles in the shader, shared by Frostlight's pines, houses and props: world-space normals that face
 * up, broken by drift noise and a per-instance load. Kit materials keep their textures; only a clone is patched.
 */

export const SNOW_COLOR=new THREE.Color('#effaff');
/** The shared noise once per program, however many patches on one material want it. */
export const GUARDED_NOISE=`#ifndef CC_NOISE\n#define CC_NOISE\n${GLSL_NOISE}\n#endif`;

export interface SnowCoverOptions {
 /** Raises (above 1) or lowers how much of a slope still holds snow. */
 cover?:number;
 /** Bare at the instance's foot (trees, where the drift round the trunk takes over). Instanced or batched only. */
 foot?:boolean;
 /** Bank snow against the piece where it meets the drift: the baked ground (snowTerrain.ts) and the bank's height, metres. */
 skirt?:{ground:{snowGroundTex:{value:THREE.Texture|null};snowGroundRect:{value:THREE.Vector4}};height:number};
}

/** Patch `mat` so up-facing surfaces carry snow. The cache key keeps one program per cover and foot setting. */
export function snowCover(mat:THREE.Material,opts:SnowCoverOptions={}){
 const cover=opts.cover??1,foot=opts.foot??false,skirt=opts.skirt;
 addPatch(mat,`snow-laden${cover}${foot?'':'-flat'}${skirt?`-skirt${skirt.height}`:''}`,shader=>{
  shader.uniforms.uSnowColor={value:SNOW_COLOR};
  if(skirt){shader.uniforms.uSkirtGround=skirt.ground.snowGroundTex;shader.uniforms.uSkirtRect=skirt.ground.snowGroundRect;}
  shader.vertexShader=shader.vertexShader
   .replace('#include <common>','#include <common>\nvarying vec3 vSnowW;\nvarying vec3 vSnowN;\nvarying vec3 vSnowRoot;')
   // View-space normal back to world space: valid for instanced, batched and plain meshes alike.
   .replace('#include <defaultnormal_vertex>','#include <defaultnormal_vertex>\nvSnowN = (vec4(transformedNormal, 0.0) * viewMatrix).xyz;')
   .replace('#include <project_vertex>',`#include <project_vertex>
    vSnowW = (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz + cameraPosition;
    vec4 snowRoot = vec4(0.0, 0.0, 0.0, 1.0);
    #ifdef USE_BATCHING
     snowRoot = batchingMatrix * snowRoot;
    #endif
    #ifdef USE_INSTANCING
     snowRoot = instanceMatrix * snowRoot;
    #endif
    vSnowRoot = (modelMatrix * snowRoot).xyz;`);
  shader.fragmentShader=shader.fragmentShader
   .replace('#include <common>',`#include <common>\nvarying vec3 vSnowW;\nvarying vec3 vSnowN;\nvarying vec3 vSnowRoot;\nuniform vec3 uSnowColor;\n${skirt?'uniform sampler2D uSkirtGround;\nuniform vec4 uSkirtRect;\n':''}${GUARDED_NOISE}\nfloat ccSnow;`)
   .replace('#include <color_fragment>',`#include <color_fragment>
    {
     // Double-sided cards: the face we see decides which way is up.
     vec3 sn = normalize(vSnowN) * (gl_FrontFacing ? 1.0 : -1.0);
     float load = cc_hash12(floor(vSnowRoot.xz * 2.0) + 7.3);
     vec2 q = vSnowW.xz + vSnowW.y * vec2(0.61, -0.47);
     float drift = cc_vnoise(q * 1.3) * 0.62 + cc_vnoise(q * 4.7 + 11.0) * 0.38;
     float up = sn.y + (drift - 0.5) * 0.6 + (load - 0.5) * 0.16 + ${(cover-1).toFixed(3)} * 0.4;
     ccSnow = smoothstep(0.62, 0.8, up)${foot?' * smoothstep(0.5, 1.6, vSnowW.y - vSnowRoot.y)':''};
     ${skirt?`// Drift banked against the piece: snow up to a ragged line a little above the ground.
     float skirtUp = vSnowW.y - textureLod(uSkirtGround, clamp((vSnowW.xz - uSkirtRect.xy) * uSkirtRect.z, 0.0, 1.0), 0.0).x;
     ccSnow = max(ccSnow, 1.0 - smoothstep(${(skirt.height*.35).toFixed(3)}, ${(skirt.height).toFixed(3)} * (0.6 + 0.8 * drift), skirtUp));`:''}
     #ifdef USE_COLOR
      // Keep the kit's baked occlusion so snow deep inside a crown or a recess stays in shade.
      float occ = mix(1.0, dot(vColor.rgb, vec3(0.299, 0.587, 0.114)), 0.5);
     #else
      float occ = 1.0;
     #endif
     // A trace of the texture survives under the snow, so caps keep the shapes beneath.
     float grain = 0.86 + 0.14 * smoothstep(0.0, 0.35, dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)));
     diffuseColor.rgb = mix(diffuseColor.rgb, uSnowColor * occ * grain, ccSnow);
    }`)
   .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.84, ccSnow);');
 });
}

export interface SnowMassOptions {
 /** Scales the wind-moulded lumps. */
 lumps?:number;
 /** Scales the crystal glints. */
 glints?:number;
 /** Wind-carved ripples (crests across SNOW_WIND, a long windward rise and a short lee drop) and broad pillows. */
 carve?:number;
 /** 0..1: how much of a low sun's colour the lit snow sheds, so a slope turned to the sun stays white, not cream. */
 white?:number;
}

/**
 * Patch `mat` as a body of snow (roof caps, wall drifts, snowmen): wind-moulded lumps and fine grain bent into
 * the normal from a world-space field, so any orientation works; crystal glints only looking across the snow
 * into the sun, as on the ground; and a cool cast where the sun does not reach, as packed snow lit only by the
 * sky. Vertex colour, if present, is occlusion, and goes blue where it darkens.
 * The glint is SNOWFLOW's jittered-facet sparkle (MIT, Maksymilian Dendura; see NOTICE.md), as in snowSurface.ts.
 */
export function snowMass(mat:THREE.MeshStandardMaterial,opts:SnowMassOptions={}){
 const lumps=opts.lumps??1,glints=opts.glints??1,carve=opts.carve??0,white=opts.white??0;
 addPatch(mat,`snow-mass${lumps}${glints}${carve?`-carve${carve}`:''}${white?`-white${white}`:''}`,shader=>{
  shader.vertexShader=shader.vertexShader
   .replace('#include <common>','#include <common>\nvarying vec3 vMassW;')
   .replace('#include <project_vertex>','#include <project_vertex>\nvMassW = (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz + cameraPosition;');
  shader.fragmentShader=shader.fragmentShader
   .replace('#include <common>',`#include <common>\nvarying vec3 vMassW;\n${GUARDED_NOISE}
float ccHash13(vec3 p) {
 p = fract(p * 0.1031);
 p += dot(p, p.zyx + 31.32);
 return fract((p.x + p.y) * p.z);
}
float ccVNoise3(vec3 p) {
 vec3 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
 vec2 k = vec2(0.0, 1.0);
 return mix(mix(mix(ccHash13(i), ccHash13(i + k.yxx), u.x), mix(ccHash13(i + k.xyx), ccHash13(i + k.yyx), u.x), u.y),
            mix(mix(ccHash13(i + k.xxy), ccHash13(i + k.yxy), u.x), mix(ccHash13(i + k.xyy), ccHash13(i + k.yyy), u.x), u.y), u.z);
}
// Pillowed lumps, stretched a little across the wind, and grain that fades before it can shimmer.
float ccMassH(vec3 p, float fine) {
 vec3 q = p * vec3(1.0, 1.15, 0.8);
 return ccVNoise3(q * 1.1) * 0.66 + ccVNoise3(q * 2.9 + 5.1) * 0.24 + ccVNoise3(q * 11.0 + 2.7) * 0.1 * fine;
}
${carve?`// Wind ripples, metres: crests across the wind ~0.7 m apart that wander and break into tongues, each rising
// slowly upwind and dropping steeply in its lee; patches scoured smooth between. .y is the trough (0 at a crest).
vec2 ccMassCarve(vec3 p, float fade) {
 const vec2 W = vec2(${SNOW_WIND[0].toFixed(4)}, ${SNOW_WIND[1].toFixed(4)});
 vec2 q = vec2(dot(p.xz, W), dot(p.xz, vec2(-W.y, W.x)));
 float c = q.x * 1.45 + ccVNoise3(vec3(q.y * 0.42, p.y * 0.3, q.x * 0.2)) * 2.2 + ccVNoise3(vec3(q.x * 0.23, q.y * 0.11, p.y * 0.2) + 4.3) * 2.6 + ccVNoise3(p * 1.3 + 3.7) * 0.45;
 float f = fract(c), k = floor(c);
 float prof = pow(1.0 - abs(2.0 * f - 1.0), 1.6);
 float tongue = 0.35 + 0.65 * smoothstep(0.2, 0.7, ccVNoise3(vec3(q.y * 0.8, k * 1.7, 0.5)));
 float scour = 0.1 + 0.9 * smoothstep(0.35, 0.65, ccVNoise3(p * 0.33 + 9.1));
 return vec2(prof * tongue * scour * fade, (1.0 - prof) * tongue * scour * fade);
}`:''}
float ccMassGlint(vec2 p, vec3 N, vec3 H) {
 vec2 id = floor(p / 0.16), r = cc_hash22(id), r2 = cc_hash22(id + vec2(19.73, 7.31));
 if (r2.x > 0.68) return 0.0;
 float d = length(p - (id + 0.5 + (r - 0.5) * 0.7) * 0.16) / 0.035;
 float ang = r.y * 6.2831853;
 vec3 up = abs(N.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
 vec3 T = normalize(cross(up, N)), B = cross(N, T);
 vec3 facet = normalize(N + (T * cos(ang) + B * sin(ang)) * (0.12 + r2.y * 0.25));
 return clamp(1.0 - d * d, 0.0, 1.0) * pow(clamp(dot(facet, H), 0.0, 1.0), 500.0);
}`)
   .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
    vec3 massN;
    vec2 massCarve = vec2(0.0);
    {
     // One evaluation, bumped through its screen-space derivatives (three.js's perturbNormalArb, in world space).
     vec3 n = inverseTransformDirection(normal, viewMatrix);
     vec3 dpx = dFdx(vMassW), dpy = dFdy(vMassW);
     float foot = length(fwidth(vMassW)), fine = 1.0 - smoothstep(0.02, 0.09, foot);
     float hm = ccMassH(vMassW, fine) * ${(0.2*0.55*lumps).toFixed(4)} * (1.0 - smoothstep(0.15, 0.6, foot));
     ${carve?`// Broad pillows a few metres across turn each slope a little toward and away from the sun.
     hm += ccVNoise3(vMassW * vec3(0.34, 0.4, 0.3) + 1.9) * ${(0.3*carve).toFixed(4)} * (1.0 - smoothstep(0.4, 1.6, foot));
     massCarve = ccMassCarve(vMassW, 1.0 - smoothstep(0.1, 0.3, foot));
     hm += massCarve.x * ${(0.1*carve).toFixed(4)};`:''}
     vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
     float det = dot(dpx, r1);
     vec3 grad = sign(det) * (dFdx(hm) * r1 + dFdy(hm) * r2);
     massN = normalize(abs(det) * n - grad);
     normal = normalize((viewMatrix * vec4(massN, 0.0)).xyz);
    }`)
   .replace('#include <opaque_fragment>',`
    #if NUM_DIR_LIGHTS > 0
    {
     // How much of the sun this pixel sees, from what three.js already shadowed.
     vec3 L = directionalLights[0].direction, sunC = directionalLights[0].color;
     float nl = max(dot(normal, L), 0.0);
     float expect = dot(BRDF_Lambert(diffuseColor.rgb) * sunC * nl, vec3(0.333));
     float vis = expect > 1e-4 ? clamp(dot(reflectedLight.directDiffuse, vec3(0.333)) / expect, 0.0, 1.0) : 0.0;
     vec3 V = normalize(vViewPosition);
     vec3 Lw = inverseTransformDirection(L, viewMatrix), Vw = inverseTransformDirection(V, viewMatrix);
     vec2 gp = abs(massN.y) > 0.6 ? vMassW.xz : vec2(vMassW.x + vMassW.z, vMassW.y);
     // Only looking across the snow into the sun; seen from above it stays matte, as the ground does.
     float graze = pow(1.0 - clamp(dot(massN, Vw), 0.0, 1.0), 3.2) * 2.2;
     if (graze > 0.002) outgoingLight += sunC * ccMassGlint(gp, massN, normalize(Vw + Lw)) * ${(7*glints).toFixed(2)} * vis * graze * smoothstep(0.02, 0.2, nl) * (1.0 - smoothstep(0.55, 0.95, nl) * 0.55);
     ${white?`// A low sun is orange; snow turned square to it would go cream. Keep its light, lose part of its hue.
     vec3 sunW = mix(sunC, vec3(dot(sunC, vec3(0.2126, 0.7152, 0.0722))) * vec3(1.02, 1.0, 0.97), ${white.toFixed(3)});
     outgoingLight += BRDF_Lambert(diffuseColor.rgb) * (sunW - sunC) * nl * vis;`:''}
     // Shaded snow takes the sky's blue; packed snow in the sun keeps a warm hint of the low sun.
     outgoingLight *= mix(vec3(0.9, 0.95, 1.06), vec3(1.0), vis);
     ${carve?`// Ripple troughs and the occluded roll under an eave hold a little blue shade, as hollows in snow do.
     #ifdef USE_COLOR
      float massOcc = dot(vColor.rgb, vec3(0.333));
     #else
      float massOcc = 1.0;
     #endif
     float massAo = 1.0 - massCarve.y * massCarve.y * 0.24;
     outgoingLight *= massAo * mix(vec3(1.0), vec3(0.62, 0.77, 1.0), (1.0 - massAo * massOcc) * 0.9);`:''}
    }
    #endif
    #include <opaque_fragment>`);
 });
}
