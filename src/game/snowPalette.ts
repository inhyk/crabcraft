import type {SnowSky} from './snowSky';

/*
 * Frostlight's palette: the painter's split of a low winter sun. The sky's sun (snowSky.ts) is moved from its
 * reddened orange toward gold, so the crests it rakes read warm cream; the sky's fill is lowered and turned
 * toward blue-violet, so whatever it alone lights (every shadow) stays cool and the two meet with contrast.
 * The snow's own albedo is untouched. Applied once to the sky's light colours before anything copies them, so
 * the sun, the hemisphere, the spindrift and the far ranges all agree.
 */

/** Gold over the sky's orange beam: more green, less red lost. */
export const FROST_SUN: readonly [number, number, number] = [1.14, 1.06, .8];
/** The sky fill: lowered, its green pulled out toward violet. */
export const FROST_FILL: readonly [number, number, number] = [.73, .63, .72];
/** The snow's bounce from below, lowered with the fill. */
export const FROST_BOUNCE = .72;

export function frostPalette(sky: SnowSky): void {
  sky.sunLight.setRGB(sky.sunLight.r * FROST_SUN[0], sky.sunLight.g * FROST_SUN[1], sky.sunLight.b * FROST_SUN[2]);
  sky.hemiSky.setRGB(sky.hemiSky.r * FROST_FILL[0], sky.hemiSky.g * FROST_FILL[1], sky.hemiSky.b * FROST_FILL[2]);
  sky.hemiGround.multiplyScalar(FROST_BOUNCE);
}
