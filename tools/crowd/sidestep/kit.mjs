// What the Sidestep choreographies share (choreo.mjs for take 1 of the song, ../sidestep-a4 for
// take 4): the formation on the dance deck by the bay, the program skeleton and the helpers that
// place moves, faces, fireworks and camera shots on a song's beat grid by the clips' own events and
// tempo. Each choreography sets the program's length and the song's own rests and places
// everything on its take's bars.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export async function stage({ grid, clips, repo }) {
  // The game's own windows for the breakdance moves (generated from the clips with them).
  let BREAK = {};
  try {
    BREAK = (await import(pathToFileURL(resolve(repo, 'src/motion/breakClips.ts')).href)).BREAK_CLIPS;
  } catch {
    BREAK = {};
  }
  const B = grid.beat;
  const DB = grid.downbeats;
  const BAR = 4 * B;
  /** Song second of bar b (+ beats). */
  const D = (b, beats = 0) => (b < DB.length ? DB[b] : DB[DB.length - 1] + (b - DB.length + 1) * BAR) + beats * B;
  const ev = (id, name) => {
    const t = clips[id]?.events?.[name]?.[0];
    if (t === undefined) throw new Error(`clip ${id} has no event ${name}`);
    return t;
  };
  const len = (id) => clips[id].length;

  // ------------------------------------------------------------------------------ formation

  const F = { rows: 17, cols: 20, dx: 2.9, dz: 2.7, aisle: 1.6, hero: 4.5, stagger: false, seed: 11, weapons: 0.12 };
  const width = (F.cols - 1) * F.dx + F.aisle;
  const depth = (F.rows - 1) * F.dz;
  const FRONT = depth / 2; // front row z
  const HERO_Z = FRONT + F.hero;
  const program = {
    // Set by the choreography: the song's end plus a held last frame.
    length: 0,
    // On the bay north of the pier, the crowd facing south toward the pier with Saltmere's
    // headland and lighthouse behind it; the low sun from the south-south-east lights its front.
    site: { x: 150, z: -34, yaw: 0 },
    deck: { width: width + 7.4, depth: depth + 12.8, y: 1.1, front: HERO_Z + 3.9, stage: { width: 12, depth: 7.2, rise: 0.35 } },
    formation: F,
    // Set by the choreography: the song's own rests, which make.mjs's silence check lets through.
    quiet: [],
    cues: [],
    faces: [],
    shots: [],
    fx: [],
  };
  const cue = (c) => program.cues.push(c);

  // ------------------------------------------------------------------------------ moves

  /** Each dance's tempo: the time scale that puts its beat on the song's. */
  const tempo = (id) => {
    const bt = clips[id].beat;
    if (!bt) throw new Error(`no beat measured for ${id}`);
    return { speed: bt.period / B, bt };
  };

  /**
   * A dance from bar `bar` for `bars` bars: the clip beat nearest `near` (clip seconds) lands on the
   * bar's downbeat, the clip time-scaled to the song's tempo; it starts `lead` song seconds early
   * (the crossfade) and runs a little past its last bar for the next move to fade over.
   */
  const dance = (id, bar, bars, near, extra = {}) => {
    const { speed, bt } = tempo(id);
    const k = Math.round((near - bt.phase) / bt.period);
    const sync = bt.phase + k * bt.period;
    const lead = extra.lead ?? 0.3;
    const from = Math.max(0, sync - lead * speed);
    const to = Math.min(len(id), sync + (bars * BAR + 0.6) * speed);
    const { lead: _l, ...rest } = extra;
    cue({ at: D(bar), clip: id, from, to, sync, speed, who: 'all', fade: lead, ...rest });
  };

  /** A breakdance move's window from the game (breakClips.ts), or from its events. */
  const win = (id) => {
    if (BREAK[id]) return { from: BREAK[id].from, to: BREAK[id].to };
    const e = clips[id].events;
    const from = e.policy_start?.[0] ?? 0;
    const to = e.settled ? e.settled[0] + 0.25 : e.recovered ? e.recovered[0] : e.hit ? e.hit[0] + 0.6 : len(id);
    return { from, to };
  };
  /** A one-shot move whose `event` lands at song time `at`. */
  const shot1 = (id, event, at, extra = {}) => {
    const w = win(id);
    cue({ at, clip: id, from: extra.from ?? w.from, to: extra.to ?? w.to, sync: ev(id, event), who: 'all', fade: 0.22, ...extra });
  };
  /** The hop: Jumper's jump, landing at `at` (+ the wave). */
  const hop = (at, extra = {}) => cue({ at, clip: 'jump', from: ev('jump', 'policy_start'), to: ev('jump', 'policy_end'), sync: ev('jump', 'land'), who: 'all', fade: 0.18, ...extra });
  /** The claws gather and fling wide at `at`, and hold there. */
  const cast = (at, extra = {}) => cue({ at, clip: 'cast', from: ev('cast', 'gather') - 0.5, to: ev('cast', 'release') + 0.12, sync: ev('cast', 'release'), hold: true, who: 'all', fade: 0.25, ...extra });
  /**
   * The "Hey!" fill: a hop rippling across the columns over 2.4 beats of bar `bar`, the last column
   * landing on beat 4, or at `end` (`extra` goes to the hop, e.g. `who`).
   */
  const fill = (bar, reverse = false, end = D(bar, 3), extra = {}) => {
    const span = 2.4 * B;
    hop(end - span, { wave: { by: 'col', step: span / (F.cols - 1), reverse }, ...extra });
  };
  const face = (at, expr, who = 'all', wave) => program.faces.push({ at, who, expr, ...(wave ? { wave } : {}) });

  // Windows of the dances (clip seconds), all among their liveliest stretches.
  const W = { crab: [16.3, 28.3, 92.3, 168.3, 60.3, 120.3, 140.3], braz: [7.3, 20.3, 36.3, 60.3, 46.3], wings: [13.3, 17.3, 41.3, 22.3] };

  // ------------------------------------------------------------------------------ fireworks
  const COLORS = ['#ffd76a', '#ff4a3a', '#59d8ff', '#b07cff', '#7dff8a', '#fff1c0'];
  let ci = 0;
  /** A firework from (x, z) in formation coordinates bursting `h` units up. */
  const fw = (at, x, z, h) => program.fx.push({ at, kind: 'firework', p: [x, -1, z], color: COLORS[ci++ % COLORS.length], height: h });

  // ------------------------------------------------------------------------------ camera
  // Formation coordinates: x to the crowd's left (screen right when it faces the camera), z front.
  /** A shot from bar `b0` (or `{ t }` song seconds) along `keys`. */
  const shot = (b0, keys, extra = {}) => program.shots.push({ from: typeof b0 === 'number' ? D(b0) : b0.t, keys, ...extra });
  const K = (u, p, l, fov = 40, roll = 0) => ({ u, p, l, fov, ...(roll ? { roll } : {}) });
  /** A look point on the hero's body. */
  const hero = (dy = 0.35, dz = 0) => ({ hero: [0, dy, dz] });

  return { program, B, BAR, D, ev, len, F, width, depth, FRONT, HERO_Z, cue, tempo, dance, win, shot1, hop, cast, fill, face, W, fw, shot, K, hero };
}
