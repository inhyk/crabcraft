// The cinema shot: everything tools/cinema/capture.mjs hands the cinema stage for one shot, as plain
// JSON. Times are shot seconds (0 = the shot's first frame); positions are world units of the world
// the shot travels to. The stage evaluates actors' paths, the camera and the screen effects as
// functions of the shot clock, so a shot renders the same however it is reached.
import type { CrabSpec, Expression } from '../../crab/types';
import type { ClipId } from '../../motion/library';

export type V3 = [number, number, number];
export type Ease = 'linear' | 'in' | 'out' | 'inout' | 'smooth' | 'sine';

/**
 * A point in the world.
 * - [x, y, z]: world coordinates.
 * - { g: [x, h, z] }: h units above the ground at x, z.
 * - { a: id, o: [x, y, z] }: in an actor's frame (x to its left, y up from its feet, z ahead of it),
 *   following the actor; `y0: true` measures y from where the actor stood at t = 0 instead (a camera
 *   that should not bob with a jump).
 */
export type Pt = V3 | { g: V3 } | { a: string; o?: V3; y0?: boolean };

export interface CamKey {
  t: number;
  p: Pt;
  /** Look point. */
  l: Pt;
  fov?: number;
  roll?: number;
}

export interface CamSpec {
  keys: CamKey[];
  /** One easing over the whole move (default 'inout'). */
  ease?: Ease;
  /** Catmull-Rom through the keys (default true). */
  spline?: boolean;
  /** Hand-held wobble amplitude, units. */
  shake?: number;
  /** Depth of field focus: the look point, an actor id, or a distance in units. Needs view.dof. */
  focus?: 'look' | string | number;
  /** Depth of field range, units (default 6). */
  range?: number;
}

export interface ActorSpec {
  id: string;
  /** A dressed crab of a race and class... */
  spec?: CrabSpec;
  /** ...or one of the game's robot monsters. */
  enemy?: 'scrapling' | 'scavenger' | 'corrodius';
  /** Gear extras (npc-extras.glb names), as the named NPCs wear. */
  extras?: string[];
  scale?: number;
  /** Start position: [x, z] on the ground, or [x, y, z]. */
  at: [number, number] | V3;
  yaw?: number;
  /** LED tint. */
  tint?: string;
}

export interface PathKey {
  t: number;
  x: number;
  z: number;
  /** Facing (radians, 0 = +Z); default: the direction of travel, else the previous facing. */
  yaw?: number;
  /** Height above the ground (a leap). */
  lift?: number;
}

export interface ActCue {
  t: number;
  clip: ClipId;
  loop?: boolean;
  speed?: number;
  from?: number;
  to?: number;
  /** Claws only, the legs keep walking. */
  upper?: boolean;
  fade?: number;
  /** For skill clips: which part of the recorded rollout ('move', 'channel'). */
  part?: 'move' | 'channel';
}

export interface FaceCue {
  t: number;
  expr: Expression;
  hold?: number;
}

export interface Track {
  path?: PathKey[];
  /** Easing over the whole path (default 'linear': steady speed through the keys). */
  ease?: Ease;
  /** Added to the travel direction when facing follows the path (PI/2: sideways, a crab's strafe). */
  faceOffset?: number;
  acts?: ActCue[];
  faces?: FaceCue[];
  /** [t, visible] switches. */
  show?: [number, boolean][];
}

/** Screen and world effects on the shot clock; see fx.ts for each kind's parameters. */
export interface FxCue {
  t: number;
  kind: string;
  [k: string]: unknown;
}

export interface ViewSpec {
  exposure?: number;
  saturation?: number;
  contrast?: number;
  bloom?: { intensity?: number; threshold?: number; radius?: number };
  vignette?: { offset?: number; darkness?: number } | null;
  /** Depth of field on (focus and range come from the camera). */
  dof?: boolean;
  bokeh?: number;
}

export interface FogSpec {
  color: string;
  /** Exponential fog density, or linear near/far. */
  density?: number;
  near?: number;
  far?: number;
}

export interface ShotSpec {
  id: string;
  /** World 1 to 6. */
  chapter: 1 | 2 | 3 | 4 | 5 | 6;
  /** Shot seconds. */
  length: number;
  /** World 1's lighting mood (0 dusk, 1 moonlit night, 2 violet celebration, 3 morning). */
  mood?: 0 | 1 | 2 | 3;
  view?: ViewSpec;
  /** Fog that overrides the world's own after it updates. */
  fog?: FogSpec;
  /** Scene objects (by name) to hide for the shot. */
  hide?: string[];
  /** Where the hidden player crab stands, so world streaming, snowfall and footprints follow the shot. */
  anchor?: [number, number];
  actors: ActorSpec[];
  tracks?: Record<string, Track>;
  cam: CamSpec;
  fx?: FxCue[];
}
