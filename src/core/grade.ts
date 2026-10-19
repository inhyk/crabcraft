// A per-world colour grade on display values, after tone mapping. Only views that ask for it carry it.
import * as THREE from 'three';
import { Effect } from 'postprocessing';

export interface GradeOptions {
  /** Added to the darkest values, fading out by mid grey (linear display units). A cool lift reads as cold air. */
  lift?: [number, number, number];
  /** 0..1: pixels that are already warm and bright (lamp glass, windows, flames) get warmer and richer. */
  warm?: number;
  /** 0..1: bright, nearly neutral pixels open toward white with a soft shoulder (snow that reads white, not grey). */
  white?: number;
}

const frag = /* glsl */ `
uniform vec3 gradeLift;
uniform float gradeWarm;
uniform float gradeWhite;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  float l = sqrt(max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.0));
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), chroma = (mx - mn) / max(mx, 1e-3);
  // Cool lift: strongest in the darkest quarter, gone by mid grey.
  float dark = 1.0 - smoothstep(0.0, 0.55, l);
  c += gradeLift * dark * dark;
  // Warm lights: only what is already warm, saturated and bright, so neutral snow keeps its colour.
  float warm = smoothstep(0.04, 0.22, c.r - c.b) * smoothstep(0.2, 0.65, mx) * smoothstep(0.2, 0.45, chroma);
  c = mix(c, c * vec3(1.07, 0.98, 0.84), warm * gradeWarm);
  // Snow white: a screen-like shoulder on bright, low-chroma pixels; it lifts toward white and never clips.
  float paper = smoothstep(0.5, 0.86, l) * (1.0 - smoothstep(0.08, 0.24, chroma));
  c = mix(c, 1.0 - (1.0 - c) * (1.0 - gradeWhite), paper);
  outputColor = vec4(c, inputColor.a);
}
`;

export class GradeEffect extends Effect {
  constructor(opts: GradeOptions) {
    super('GradeEffect', frag, {
      uniforms: new Map<string, THREE.Uniform>([
        ['gradeLift', new THREE.Uniform(new THREE.Vector3(...(opts.lift ?? [0, 0, 0])))],
        ['gradeWarm', new THREE.Uniform(opts.warm ?? 0)],
        ['gradeWhite', new THREE.Uniform(opts.white ?? 0)],
      ]),
    });
  }
}
