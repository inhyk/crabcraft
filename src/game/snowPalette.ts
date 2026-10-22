import type {SkyPalette} from './snowSky';

/*
 * Frostlight's palette: the painter's split of a low winter sun. The sky's sun (snowSky.ts) is moved from its
 * reddened orange toward gold, so the crests it rakes read warm cream; the sky's fill is lowered and turned
 * toward blue-violet, so whatever it alone lights (every shadow) stays cool and the two meet with contrast.
 * The snow's own albedo is untouched. SnowSky applies it where it makes its light (SkyPalette): the fill's
 * violet grades the sky itself, so the dome, the fog the far snow fades into, the ranges' haze, the ice's sky and
 * the hemisphere are one colour, and the sun, the spindrift and the far ranges all read the same lights.
 */

/** Gold over the sky's orange beam: more green, less red lost. */
export const FROST_SUN: readonly [number, number, number] = [1.14, 1.06, .8];
/** The sky fill: lowered, its green pulled out toward violet. */
export const FROST_FILL: readonly [number, number, number] = [.73, .63, .72];
/** The snow's bounce from below, lowered with the fill. */
export const FROST_BOUNCE = .72;

export const FROST_PALETTE: SkyPalette = { sun: FROST_SUN, fill: FROST_FILL, bounce: FROST_BOUNCE };
