import {STAR_MOON_DIR,STAR_SKY_GLSL} from './starNight';

/** Shared sky radiance for the dome and its inexpensive water reflection (starNight.ts holds the one night). */
export const STAR_MOON_POSITION=[STAR_MOON_DIR.x*600,STAR_MOON_DIR.y*600,STAR_MOON_DIR.z*600] as const;
export const STAR_ATMOSPHERE=STAR_SKY_GLSL;
