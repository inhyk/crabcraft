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
  /** Split toning: display values times `shadow` in the darks, easing to times `highlight` in the lights. */
  split?: { shadow: [number, number, number]; highlight: [number, number, number] };
  /**
   * Tonal contrast about a pivot (perceptual luminance, 0..1): values under it are pushed down by `darks` (1 keeps
   * them), values over it opened up by `lights` with a shoulder that still ends at white, so nothing clips. Hue is
   * kept (the colour is scaled, not the channels). Views without it skip the step.
   */
  contrast?: { pivot: number; darks: number; lights: number };
}

const frag = /* glsl */ `
uniform vec3 gradeLift;
uniform float gradeWarm;
uniform float gradeWhite;
uniform vec3 gradeShadow;
uniform vec3 gradeHigh;
uniform vec3 gradeContrast;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  float l = sqrt(max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.0));
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), chroma = (mx - mn) / max(mx, 1e-3);
  // Cool lift: strongest in the darkest quarter, gone by mid grey.
  float dark = 1.0 - smoothstep(0.0, 0.55, l);
  c += gradeLift * dark * dark;
  c *= mix(gradeShadow, gradeHigh, smoothstep(0.2, 0.8, l));
  if (gradeContrast.x > 0.0) {
    float p = gradeContrast.x, lc = sqrt(max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.0));
    // Under the pivot a toe lets the push fade out toward black, so deep colours (navy, iron) keep their detail.
    float ln = lc < p ? lc - (gradeContrast.y - 1.0) * (p - lc) * smoothstep(0.04, 0.3, lc) : lc + (gradeContrast.z - 1.0) * (lc - p) * (1.0 - lc) / (1.0 - p) * 2.0;
    float f = (ln * ln) / max(lc * lc, 1e-6), m = max(c.r, max(c.g, c.b));
    // Opening a bright gold must not push its red channel past white.
    c *= f > 1.0 ? min(f, max(0.985 / max(m, 1e-6), 1.0)) : f;
  }
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
        ['gradeShadow', new THREE.Uniform(new THREE.Vector3(...(opts.split?.shadow ?? [1, 1, 1])))],
        ['gradeHigh', new THREE.Uniform(new THREE.Vector3(...(opts.split?.highlight ?? [1, 1, 1])))],
        ['gradeContrast', new THREE.Uniform(new THREE.Vector3(opts.contrast?.pivot ?? 0, opts.contrast?.darks ?? 1, opts.contrast?.lights ?? 1))],
      ]),
    });
  }
}
