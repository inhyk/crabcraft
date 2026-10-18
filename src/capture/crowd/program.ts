// The crowd program: everything a capture script hands the crowd scene, as plain JSON with every
// time in song seconds. The scene evaluates it as a pure function of the song clock, so any
// instant can be rendered on its own (a shot starts anywhere) and two renders of the same instant
// agree. The choreography for a song lives with the capture script that builds the program; this
// file only knows formations, cues, camera shots and effects.
import type { ClipId } from '../../motion/library';
import type { Expression } from '../../crab/types';
import type { DeckSpec } from './stage';

/** Where the formation stands in Clawhaven: ground centre and the direction the crowd faces. */
export interface Site {
  x: number;
  z: number;
  /** Facing as yaw (radians, 0 = +Z). */
  yaw: number;
}

/**
 * A block of crabs in rows behind a hero. Formation axes: +z toward the front (the way the crowd
 * faces), +x toward the crowd's left, origin on the ground at the centre of the block. Row 0 is the
 * front row; column 0 is the crowd's rightmost (smallest x).
 */
export interface FormationSpec {
  rows: number;
  cols: number;
  /** Spacing across (x) and between rows (z), world units (a standing crab is 1 unit tall). */
  dx: number;
  dz: number;
  /** Shift every other row by half a column. */
  stagger?: boolean;
  /** An aisle this wide (units) down the middle, between the halves. */
  aisle?: number;
  /** The hero stands this far in front of the front row (null: no hero). */
  hero?: number | null;
  /** Seed for the crowd's races, paint and gear. */
  seed?: number;
  /** Share of the crowd that keeps its class weapons in its claws (default 1); race gear always stays. */
  weapons?: number;
  /**
   * Explicit crowd places [x, z] in formation coordinates instead of the rows x cols grid (a small
   * crew in a wedge, an arc). Rows count the distinct z from the front; `dx` and `dz` stay the
   * spacing units for the waves' distances.
   */
  points?: [number, number][];
}

/** Which crabs a cue moves. */
export type Who =
  | 'all'
  | 'hero'
  | 'crowd'
  | {
      /** Row range, inclusive (0 = front). */
      rows?: [number, number];
      cols?: [number, number];
      /** The crowd's left (x > 0) or right half. */
      half?: 'left' | 'right';
      /** Checkerboard: (row + col) % 2. */
      parity?: 0 | 1;
      /** Every n-th row, starting at k: [n, k]. */
      everyRow?: [number, number];
      /** Ring of grid distance from the centre, in spacings: [from, to). */
      ring?: [number, number];
      /** Include the hero too (crowd selectors leave it out). */
      hero?: boolean;
    };

/**
 * A wave: each crab starts `step` seconds later per unit of `by`. `row` counts from the front,
 * `col` from the crowd's right, `out` is the distance from the centre in spacings, `side` the
 * column distance from the centre line (mirror halves meet in the middle), `diag` row + col,
 * `random` a seeded random 0..1. `reverse` runs it from the other end.
 */
export interface Wave {
  by: 'row' | 'col' | 'out' | 'side' | 'diag' | 'random';
  step: number;
  reverse?: boolean;
}

export interface Cue {
  /** Song second the clip's `sync` moment lands on (for a crab with no wave delay). */
  at: number;
  who: Who;
  clip: ClipId;
  /** Clip window, clip seconds. */
  from: number;
  to?: number;
  /** Clip second that lands on `at` (default `from`). */
  sync?: number;
  /** Playback rate (time scaling to the beat). */
  speed?: number;
  /** Repeat [loopFrom, to) after the first pass. */
  loop?: boolean;
  loopFrom?: number;
  /** Crossfade in from the previous cue, seconds (default 0.25). */
  fade?: number;
  /** Hold the window's last pose instead of easing back to standing. */
  hold?: boolean;
  /** Song second the cue lets go (eases back to standing), before any wave delay. */
  until?: number;
  wave?: Wave;
  /** Play the clip mirrored: every selected crab, or only the crowd's left or right half. */
  mirror?: boolean | 'left' | 'right';
  /** Turn the crabs this much (radians, + = toward their left) for the cue. */
  turn?: number;
  /** Turn each crab to face this formation point instead (e.g. the hero). */
  faceTo?: [number, number];
  /** Random start offset per crab, ± seconds (looser unison). */
  jitter?: number;
}

/** A face change for the selected crabs from `at` (plus the wave delay) on. */
export interface FaceCue {
  at: number;
  who: Who;
  expr: Expression;
  wave?: Wave;
}

/**
 * A camera key. Positions are formation coordinates (x left, y up, z front, units); a look point
 * may instead be { hero: [dx, dy, dz] }, the hero's body plus an offset in formation axes.
 */
export interface CamKey {
  /** Fraction of the shot, 0..1. */
  u: number;
  p: [number, number, number];
  l: [number, number, number] | { hero: [number, number, number] };
  fov?: number;
  roll?: number;
}

export interface Shot {
  from: number;
  /** End of the camera move (default: the next shot's start, or the program's end). */
  to?: number;
  keys: CamKey[];
  /** Easing over the whole shot (default 'inout'). */
  ease?: 'linear' | 'in' | 'out' | 'inout' | 'smooth' | 'sine';
  /** Portrait framing: these keys instead (default: the same keys, a wider lens). */
  port?: CamKey[];
  /** Focus distance: the hero, the look point, or units (default 'look'). */
  focus?: 'hero' | 'look' | number;
  /** Depth of field range, units (default 40: nearly everything sharp). */
  focusRange?: number;
  /** Hand-held wobble amplitude, units. */
  shake?: number;
  /** Follow the hero's body height with the look point (jumps): fraction of its rise. */
  rise?: number;
}

/** One-off effects on the song clock. */
export type Fx =
  | { at: number; kind: 'firework'; p: [number, number, number]; color?: string; height?: number }
  | { at: number; kind: 'mood'; mood: 0 | 1 | 2 }
  | { at: number; kind: 'beacon'; on: boolean }
  /** The deck's stage lights to `level` (0..1), ramped over `d` seconds (default 1.2). */
  | { at: number; kind: 'lights'; level: number; d?: number }
  | { at: number; kind: 'flash'; d: number; a: number };

export interface CrowdProgram {
  /** Song seconds the program covers. */
  length: number;
  site?: Site;
  /** A dance deck under the formation (on the bay), instead of the bare ground. */
  deck?: DeckSpec;
  formation: FormationSpec;
  /** Optional cinematic terrain fit: minimum clearance of feet/palm pads above the terrain. */
  terrainClearance?: number;
  /** A single cinematic performer using the actual first-world boss appearance. */
  actor?: 'corrodius';
  /** Preserve recorded joint kinematics without race stance/hunch bias or servo twitches. */
  exactMotion?: boolean;
  /** Bound terrain correction speed (world units/sec) using a precomputed clearance envelope. */
  terrainLiftRate?: number;
  /** Choreography; for one crab, the cue that started last is the one playing. */
  cues: Cue[];
  faces?: FaceCue[];
  shots: Shot[];
  fx?: Fx[];
  /** Song seconds the stage lights flare on (the beat), decaying over a tenth of a second or so. */
  pulses?: number[];
  /** Song seconds [from, to] where the song itself falls silent; tools/crowd/make.mjs lets those silences through. */
  quiet?: [number, number][];
}

/** Fill in what a program may leave out: each shot ends where the next starts. */
export function normalizeProgram(p: CrowdProgram): CrowdProgram {
  const shots = [...p.shots].sort((a, b) => a.from - b.from);
  return {
    ...p,
    fx: [...(p.fx ?? [])].sort((a, b) => a.at - b.at),
    shots: shots.map((s, i) => ({ ...s, to: s.to ?? (i + 1 < shots.length ? shots[i + 1].from : p.length) })),
  };
}

/** A crab's place in the formation. */
export interface Slot {
  index: number;
  hero: boolean;
  /** Row from the front and column from the right; the hero is row -1. */
  row: number;
  col: number;
  /** Formation coordinates, units. */
  x: number;
  z: number;
  /** Distance from the centre in spacings. */
  out: number;
  /** Column distance from the centre line, in spacings. */
  side: number;
  /** Seeded 0..1 per crab. */
  rnd: number;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The formation's slots: the hero first (when there is one), then the crowd row by row. */
export function formationSlots(f: FormationSpec): Slot[] {
  const rnd = mulberry32((f.seed ?? 7) * 7919 + 13);
  const out: Slot[] = [];
  const width = (f.cols - 1) * f.dx + (f.aisle ?? 0);
  const depth = (f.rows - 1) * f.dz;
  const cx = (f.cols - 1) / 2;
  const cr = (f.rows - 1) / 2;
  if (f.points) {
    const zs = [...new Set(f.points.map((p) => p[1]))].sort((a, b) => b - a);
    const front = zs[0] ?? 0;
    if (f.hero !== null && f.hero !== undefined) {
      out.push({ index: 0, hero: true, row: -1, col: 0, x: 0, z: front + f.hero, out: 0, side: 0, rnd: rnd() });
    }
    for (const [i, [x, z]] of f.points.entries()) {
      out.push({ index: out.length, hero: false, row: zs.indexOf(z), col: i, x, z,
        out: Math.hypot(x / f.dx, z / f.dz), side: Math.abs(x) / f.dx, rnd: rnd() });
    }
    return out;
  }
  if (f.hero !== null && f.hero !== undefined) {
    out.push({ index: 0, hero: true, row: -1, col: cx, x: 0, z: depth / 2 + f.hero, out: 0, side: 0, rnd: rnd() });
  }
  for (let r = 0; r < f.rows; r++) {
    for (let c = 0; c < f.cols; c++) {
      const shift = f.stagger && r % 2 ? 0.5 : 0;
      let x = -width / 2 + (c + shift) * f.dx;
      if (f.aisle && c > cx) x += f.aisle;
      if (f.stagger && r % 2 && c === f.cols - 1) continue;
      out.push({
        index: out.length,
        hero: false,
        row: r,
        col: c + shift,
        x,
        z: depth / 2 - r * f.dz,
        out: Math.hypot(c + shift - cx, r - cr),
        side: Math.abs(c + shift - cx),
        rnd: rnd(),
      });
    }
  }
  return out;
}

/** Whether a selector picks this slot. */
export function selects(who: Who, s: Slot): boolean {
  if (who === 'all') return true;
  if (who === 'hero') return s.hero;
  if (who === 'crowd') return !s.hero;
  if (s.hero) return !!who.hero;
  if (who.rows && (s.row < who.rows[0] || s.row > who.rows[1])) return false;
  if (who.cols && (s.col < who.cols[0] || s.col > who.cols[1])) return false;
  if (who.half === 'left' && s.x <= 0) return false;
  if (who.half === 'right' && s.x >= 0) return false;
  if (who.parity !== undefined && (Math.round(s.row + s.col) & 1) !== who.parity) return false;
  if (who.everyRow && (s.row - who.everyRow[1]) % who.everyRow[0] !== 0) return false;
  if (who.ring && (s.out < who.ring[0] || s.out >= who.ring[1])) return false;
  return true;
}

/** Seconds a wave holds this slot back. */
export function waveDelay(w: Wave | undefined, s: Slot, f: FormationSpec): number {
  if (!w) return 0;
  const maxRow = f.rows - 1;
  const maxCol = f.cols - 1;
  const row = Math.max(0, s.row);
  let k: number;
  let max: number;
  switch (w.by) {
    case 'row':
      k = row;
      max = maxRow;
      break;
    case 'col':
      k = s.col;
      max = maxCol;
      break;
    case 'out':
      k = s.out;
      max = Math.hypot(maxCol / 2, maxRow / 2);
      break;
    case 'side':
      k = s.side;
      max = maxCol / 2;
      break;
    case 'diag':
      k = row + s.col;
      max = maxRow + maxCol;
      break;
    default:
      k = s.rnd;
      max = 1;
  }
  return w.step * (w.reverse ? max - k : k);
}
