// The Clawhaven crowd dancing to "Sidestep (Click Clack)", an original song made for World of
// Crabcraft with Google Lyria 3.5 (see README.md). A build() for tools/crowd/make.mjs: it hands
// over the beat grid (grid.json: 149.995 bpm, bar b starts at 0.122 + 1.6 b seconds, made by
// beatgrid.py from sidestep.mp3) and the facts of the checkout's clips (tools/crowd/clips.mjs), so
// every move is placed by the clips' own events and tempo however they are re-recorded.
//
// Song map in bars (grid bar b starts at downbeats[b]), measured from the audio: loudness and kick
// energy per beat, onsets and word timestamps.
//   0-3 intro ("One, two... ready?", the crowd shouts "Sidestep!" on beat 4 of bar 1, drums in 3)
//   4-11 chorus 1 ("Click-clack, side to side", "Hey!" on beat 4 of bars 7 and 11)
//   12-19 verse 1 ("Low tide on the boardwalk")   20-26 pre-chorus 1 ("Hold your breath")
//   27 stop ("Step... to... the side!", the band out for two beats, a fill into the chorus)
//   28-35 chorus 2 (Hey! in 31, 35)   36-43 verse 2 ("Twist it like a tornado", "Shake it" in 43)
//   44-50 pre-chorus 2, 51 stop   52-59 chorus 3 (Hey! in 55, 59)
//   60-62 bridge A ("Everybody freeze... take a bow... now rise!", the drums back in 62)
//   63-76 bridge B ("Moonlight on the water" in 63 and 71, "Turn it up" four times in 75-76)
//   77-79 the band hits the downbeat of 77 and cuts out, "Here we go!" a cappella in 78
//   80-82 breakdown (whispered "Click... clack...", no kick)
//   83-85 pre-chorus 3 ("Lift your claws up higher", the band out for two beats of 85)
//   86-101 final chorus (a step up, "Hey! Hey!" in 89, 93)   102 "Sidestep!" and the hard stop.
// The song was asked for bridge B to bar 79, pre-chorus 3 to 87 and the final chorus in 88-103; it
// came two bars shorter (the band cuts at 77, the last pre-chorus has three bars), so from bar 77
// on everything sits two bars earlier than that plan.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export default async function build({ grid, clips, repo }) {
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
    // The shout and its ring end about a second after the last downbeat; the frame holds a little longer.
    length: D(102) + 2.25,
    // On the bay north of the pier, the crowd facing south toward the pier with Saltmere's
    // headland and lighthouse behind it; the low sun from the south-south-east lights its front.
    site: { x: 150, z: -34, yaw: 0 },
    deck: { width: width + 7.4, depth: depth + 12.8, y: 1.1, front: HERO_Z + 3.9, stage: { width: 12, depth: 7.2, rise: 0.35 } },
    formation: F,
    // The song's own rests, which make.mjs's silence check lets through: the breaths between
    // "One, two... ready?" and the shout, and the silence after "Here we go!".
    quiet: [
      [D(0, 3), D(1)],
      [D(1, 2), D(1, 3)],
      [D(78, 2), D(79)],
    ],
    cues: [],
    faces: [],
    shots: [],
    fx: [],
  };
  const cues = program.cues;
  const cue = (c) => cues.push(c);

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
   * landing on the shout (beat 4), or at `end`.
   */
  const fill = (bar, reverse = false, end = D(bar, 3)) => {
    const span = 2.4 * B;
    hop(end - span, { wave: { by: 'col', step: span / (F.cols - 1), reverse } });
  };
  const face = (at, expr, who = 'all', wave) => program.faces.push({ at, who, expr, ...(wave ? { wave } : {}) });

  // Windows of the dances (clip seconds), all among their liveliest stretches.
  const W = { crab: [16.3, 28.3, 92.3, 168.3, 60.3, 120.3, 140.3], braz: [7.3, 20.3, 36.3, 60.3, 46.3], wings: [13.3, 17.3, 41.3, 22.3] };

  // ---- intro (bars 0-3): "One, two... ready?" the crowd stands sleepy-eyed; on the shout
  // "Sidestep!" the faces wake from the middle out and everyone raises a claw to wave.
  face(0, 'sleepy');
  face(D(1, 3), 'happy', 'all', { by: 'out', step: 0.06 });
  cue({ at: D(2, 2), clip: 'gesture_hello', from: 0.9, to: 4.6, who: 'all', fade: 0.4, wave: { by: 'out', step: 0.05 }, until: D(4) - 0.35 });

  // ---- chorus 1 (bars 4-11): "Click-clack, side to side", the hop rippling across on each "Hey!".
  dance('dance_crab', 4, 3, W.crab[0]);
  fill(7);
  dance('dance_brazilian', 8, 3, W.braz[0], { mirror: 'left' });
  fill(11, true);

  // ---- verse 1 (bars 12-19): "Low tide on the boardwalk": the dream wings ripple back through
  // the rows a beat a row; the hero breaks in front (six-step, then the spin), then dance_crab in
  // canon on the checkerboard ("three hundred little dancers").
  dance('dance_dream_wings', 12, 4, W.wings[0], { who: 'crowd', wave: { by: 'row', step: B / 2 } });
  shot1('break_sixstep', 'policy_start', D(12), { who: 'hero', sync: win('break_sixstep').from });
  shot1('break_spin', 'policy_start', D(15, 2), { who: 'hero', sync: win('break_spin').from });
  dance('dance_crab', 16, 4, W.crab[1], { who: { parity: 0 } });
  dance('dance_crab', 16, 4, W.crab[1] - 2 * tempo('dance_crab').bt.period, { who: { parity: 1 }, lead: 0.3 + 2 * B });
  dance('dance_crab', 19, 1, W.crab[1] + 12 * tempo('dance_crab').bt.period, { who: 'hero' });

  // ---- pre-chorus 1 (bars 20-26), then the stop: on "Step... to... the side!" the claws fling
  // wide and hold while the band is out.
  dance('dance_brazilian', 20, 6, W.braz[1], { wave: { by: 'diag', step: 0.035 } });
  cast(D(27), { wave: { by: 'out', step: 0.03 } });
  face(D(26), 'surprised');

  // ---- chorus 2 (bars 28-35): the 720 rolls back through the rows, landing from the downbeat on.
  shot1('break_jumpspin', 'land', D(28), { wave: { by: 'row', step: 0.05 } });
  face(D(28), 'happy');
  dance('dance_crab', 29, 2, W.crab[2]);
  fill(31);
  dance('dance_brazilian', 32, 3, W.braz[2], { mirror: 'left' });
  fill(35, true);

  // ---- verse 2 (bars 36-43): "Twist it like a tornado": the spin on the checkerboard in canon,
  // the hero's six-step and, on "everybody let go", the one-claw freeze; the slam ripples across
  // on "Sun's already rising", the hop on "Shake it, shake it".
  shot1('break_spin', 'policy_start', D(36), { who: { parity: 0 }, sync: win('break_spin').from });
  shot1('break_spin', 'policy_start', D(37, 2), { who: { parity: 1 }, sync: win('break_spin').from });
  face(D(36), 'focused');
  dance('dance_crab', 39, 3, W.crab[3], { who: 'crowd', wave: { by: 'side', step: 0.05 } });
  shot1('break_sixstep', 'policy_start', D(36), { who: 'hero', sync: win('break_sixstep').from });
  shot1('break_oneclaw', 'hit', D(41), { who: 'hero', to: ev('break_oneclaw', 'release') + 0.15 });
  cue({ at: D(42), clip: 'attack_slam', from: ev('attack_slam', 'windup') - 0.45, to: ev('attack_slam', 'recovered') + 0.35, sync: ev('attack_slam', 'impact'), who: 'all', fade: 0.2, wave: { by: 'col', step: (2 * B) / (F.cols - 1) } });
  hop(D(43), { wave: { by: 'side', step: 0.06, reverse: true } });
  face(D(42), 'happy');

  // ---- pre-chorus 2 (bars 44-50), the stop
  dance('dance_dream_wings', 44, 6, W.wings[1], { wave: { by: 'diag', step: 0.035, reverse: true } });
  cast(D(51), { wave: { by: 'out', step: 0.03 } });
  face(D(50), 'surprised');

  // ---- chorus 3 (bars 52-59): the back flip rolls back through the rows.
  shot1('break_backflip', 'land', D(52), { wave: { by: 'row', step: 0.05 } });
  face(D(52), 'love');
  dance('dance_crab', 53, 2, W.crab[4]);
  fill(55);
  dance('dance_brazilian', 56, 3, W.braz[3], { mirror: 'left' });
  fill(59, true);
  face(D(56), 'happy');

  // ---- bridge A (bars 60-62): "Everybody freeze... take a bow": the crowd bows from the middle
  // out; on "now rise!" the hero goes up on its claws.
  cue({ at: D(60), clip: 'gesture_bow', from: 1.0, to: 6.4, who: 'crowd', fade: 0.4, wave: { by: 'out', step: 0.05 } });
  shot1('break_clawstand', 'hit', D(62), { who: 'hero', to: ev('break_clawstand', 'release') + 0.1 });
  face(D(60), 'focused');

  // ---- bridge B (bars 63-76), one move per four-bar line: "Moonlight on the water" the spin
  // spreads from the middle out, dance_crab in unison, the six-step on every other row and column
  // with the wings around it on the second "Moonlight", the brazilian mirrored on "Turn it up",
  // and the hop rippling across with the last column landing on the band's last hit (bar 77).
  shot1('break_spin', 'policy_start', D(63), { sync: win('break_spin').from, wave: { by: 'out', step: 0.09 } });
  dance('dance_crab', 67, 4, W.crab[5]);
  face(D(67), 'happy');
  dance('dance_dream_wings', 71, 4, W.wings[2]);
  shot1('break_sixstep', 'policy_start', D(71), { who: { everyRow: [2, 0], parity: 0 }, sync: win('break_sixstep').from });
  shot1('break_sixstep', 'policy_start', D(71), { who: 'hero', sync: win('break_sixstep').from });
  dance('dance_brazilian', 75, 2, W.braz[4], { mirror: 'left' });
  fill(76, false, D(77));

  // ---- the drop and the breakdown (bars 77-82): the band cuts out and night falls; after "Here we
  // go!" the crowd sits from the back rows forward, the lighthouse and the stage lights come on
  // with the pad in bar 79, and through the whispers the hero holds the one-claw freeze.
  cue({ at: D(78, 2), clip: 'sit', from: ev('sit', 'policy_start'), to: ev('sit', 'seated_to'), sync: ev('sit', 'settled'), hold: true, who: 'crowd', fade: 0.4, wave: { by: 'row', step: 0.06, reverse: true } });
  shot1('break_oneclaw', 'hit', D(80), { who: 'hero', to: ev('break_oneclaw', 'release') + 0.15 });
  program.fx.push({ at: D(77), kind: 'mood', mood: 2 }, { at: D(79), kind: 'beacon', on: true }, { at: D(79), kind: 'lights', level: 0.6, d: 2.5 });
  program.fx.push({ at: D(86), kind: 'lights', level: 1, d: 0.1 });
  program.pulses = [];
  for (let b = 86; b < 102; b++) for (let k = 0; k < 4; k++) program.pulses.push(D(b, k));
  program.pulses.push(D(102));
  face(D(79), 'love');

  // ---- pre-chorus 3 (bars 83-85): up again on "Lift your claws up higher", the wings on "let the
  // lighthouse spin", and from "On the count of three" the claws gather to fling wide on the drop.
  cue({ at: D(83), clip: 'sit', from: ev('sit', 'seated_to') - 0.2, to: ev('sit', 'recovered'), sync: ev('sit', 'rising'), who: 'crowd', fade: 0.3, wave: { by: 'row', step: 0.05 } });
  dance('dance_dream_wings', 84, 1, W.wings[3], { lead: 0.5 });
  cast(D(86) - 0.02, { wave: { by: 'out', step: 0.02 } });
  face(D(84), 'happy');

  // ---- final chorus (bars 86-101): the 720 bursts out from the middle, unison, the back flip
  // rolls across the diagonal, fireworks all the way, and the one-claw freeze on "Sidestep!".
  shot1('break_jumpspin', 'land', D(86), { wave: { by: 'out', step: 0.07 } });
  dance('dance_crab', 87, 2, W.crab[6]);
  fill(89);
  shot1('break_backflip', 'land', D(90), { wave: { by: 'diag', step: 0.025 } });
  dance('dance_brazilian', 91, 2, W.braz[0] + 20, { mirror: 'left' });
  fill(93, true);
  dance('dance_crab', 94, 4, W.crab[2] + 16);
  shot1('break_spin', 'policy_start', D(98), { sync: win('break_spin').from, wave: { by: 'col', step: 0.03 } });
  // The freeze: the one-claw lift lands on the closing shout and holds to the end.
  shot1('break_oneclaw', 'hit', D(102), { to: ev('break_oneclaw', 'hit') + 0.9, hold: true, fade: 0.2 });
  face(D(86), 'love');
  face(D(94), 'happy');
  face(D(102), 'love');

  // ------------------------------------------------------------------------------ flashes, fireworks
  for (const [b, a] of [[4, 0.3], [28, 0.28], [52, 0.28], [86, 0.38]]) program.fx.push({ at: D(b), kind: 'flash', d: 0.3, a });
  program.fx.push({ at: D(102), kind: 'flash', d: 0.4, a: 0.2 });
  // Dusk, the beacon dark and the stage lights off from the top (a shot rendered after a night
  // shot in the same page eases back within its pre-roll).
  program.fx.push({ at: 0, kind: 'mood', mood: 0 }, { at: 0, kind: 'beacon', on: false }, { at: 0, kind: 'lights', level: 0, d: 0.01 });
  const COLORS = ['#ffd76a', '#ff4a3a', '#59d8ff', '#b07cff', '#7dff8a', '#fff1c0'];
  let ci = 0;
  const fw = (at, x, z, h) => program.fx.push({ at, kind: 'firework', p: [x, -1, z], color: COLORS[ci++ % COLORS.length], height: h });
  // A salvo on every downbeat of the last chorus, bigger on the four-bar lines.
  for (let b = 86; b < 102; b++) {
    const n = [86, 90, 94, 98].includes(b) ? 5 : 2;
    for (let i = 0; i < n; i++) {
      const x = ((i + 0.5) / n - 0.5) * 70 + ((b * 7 + i * 13) % 9) - 4;
      fw(D(b) - 1.1 + i * 0.08, x, -depth / 2 - 22 - ((b + i) % 3) * 6, 30 + ((b * 3 + i * 5) % 11));
    }
  }
  for (let i = 0; i < 6; i++) fw(D(102) - 1.05 + i * 0.05, (i - 2.5) * 13, -depth / 2 - 20 - (i % 2) * 8, 32 + (i % 3) * 4);
  // Three over the lighthouse during the whispers.
  for (let i = 0; i < 3; i++) fw(D(81) + i * 0.6, (i - 1) * 25, -depth / 2 - 26, 30);

  // ------------------------------------------------------------------------------ camera
  // Formation coordinates: x to the crowd's left (screen right when it faces the camera), z front.
  const S = program.shots;
  const shot = (b0, keys, extra = {}) => S.push({ from: typeof b0 === 'number' ? D(b0) : b0.t, keys, ...extra });
  const K = (u, p, l, fov = 40, roll = 0) => ({ u, p, l, fov, ...(roll ? { roll } : {}) });
  const hero = (dy = 0.35, dz = 0) => ({ hero: [0, dy, dz] });

  // intro: down out of the sky over the bay to the deck, then the hero's face in the breath before
  // the shout, waking up on "Sidestep!"
  S.push({ from: 0, keys: [K(0, [26, 46, 132], [0, 0, -6], 44), K(1, [5, 9, 54], [0, 1, 0], 42)], ease: 'out' });
  shot({ t: D(1, 2) }, [K(0, [2.2, 1.0, 32.6], hero(0.4), 26), K(1, [0.9, 0.9, 31.2], hero(0.35), 24)], { focus: 'hero', focusRange: 6, ease: 'linear' });
  // chorus 1: low in front on the drop, high for the hop rippling across, the front row, the crane
  shot(4, [K(0, [0, 5, 37], [0, 0.6, 2], 48), K(1, [0, 6.5, 33.5], [0, 0.4, 0], 48)], { ease: 'out', focusRange: 60 });
  shot(6, [K(0, [-5, 17, 44], [0, 0, 0], 48), K(1, [5, 14, 40], [0, 0, -2], 48)], { focusRange: 80 });
  shot(8, [K(0, [-30, 1.15, HERO_Z - 1.2], [-18, 1.0, FRONT - 6], 46), K(1, [30, 1.15, HERO_Z - 1.2], [18, 1.0, FRONT - 6], 46)], { ease: 'linear', focusRange: 30 });
  shot(10, [K(0, [-16, 3, 32], [8, 0.8, 0], 46), K(1, [-8, 9, 36], [6, 0.5, -4], 46)], { focusRange: 60 });
  // verse 1: round the hero's six-step, along the rows from the side, the hero's spin, down the aisle
  shot(12, [K(0, [-5.5, 2.2, HERO_Z + 4.5], hero(0.2), 34), K(0.5, [0, 2.6, HERO_Z + 6.5], hero(0.2), 34), K(1, [5.5, 2.2, HERO_Z + 4.5], hero(0.2), 34)], { focus: 'hero', focusRange: 10, ease: 'linear' });
  shot(14, [K(0, [-36, 3.4, 18], [0, 1.0, -2], 42), K(1, [-34, 4.2, 8], [0, 1.0, -8], 42)], { ease: 'linear', focusRange: 50 });
  shot({ t: D(15, 2) }, [K(0, [0, 3.6, HERO_Z + 6.5], hero(0.1), 40), K(1, [2.5, 4.2, HERO_Z + 5.5], hero(0.1), 42)], { focus: 'hero', focusRange: 10, ease: 'linear' });
  shot(18, [K(0, [0, 1.25, HERO_Z + 2], [0, 1.3, -30], 50), K(1, [0, 1.25, -8], [0, 1.4, -40], 50)], { ease: 'linear', focusRange: 12 });
  // pre-chorus 1: a sweep round the front, the crowd from behind with the bay, the hero at the stop
  shot(20, [K(0, [-40, 8, 22], [0, 0.5, 0], 42), K(1, [-8, 8, 44], [0, 0.5, 0], 42)], { ease: 'inout', focusRange: 80 });
  shot(23, [K(0, [6, 9, -50], [0, 1, 16], 44), K(1, [3, 7, -40], [0, 1, 14], 42)], { ease: 'linear', focusRange: 60 });
  shot(26, [K(0, [-1.5, 0.75, HERO_Z + 5.5], hero(0.45), 34), K(1, [-0.6, 0.7, HERO_Z + 4.2], hero(0.45), 32)], { focus: 'hero', focusRange: 8, ease: 'linear' });
  // chorus 2: the 720 rolling back through the rows from the front left, high front, front row, crane
  shot(28, [K(0, [-24, 4, 32], [0, 2.0, 2], 46), K(1, [-20, 5, 29], [0, 1.4, 0], 46)], { focusRange: 80, ease: 'out' });
  shot(30, [K(0, [0, 15, 46], [0, 0, 0], 46), K(1, [0, 11, 41], [0, 0.5, 0], 46)], { focusRange: 80 });
  shot(32, [K(0, [30, 1.15, HERO_Z - 1.2], [18, 1.0, FRONT - 6], 46), K(1, [-30, 1.15, HERO_Z - 1.2], [-18, 1.0, FRONT - 6], 46)], { ease: 'linear', focusRange: 30 });
  shot(34, [K(0, [0, 1.4, HERO_Z + 5], hero(0.4), 38), K(1, [0, 26, HERO_Z + 22], [0, 0, -4], 46)], { ease: 'inout', focusRange: 60 });
  // verse 2: straight down on the spinning checkerboard, the hero, low in front for the slam
  shot(36, [K(0, [0, 40, 0.1], [0, 0, 0], 50, Math.PI / 2), K(1, [0, 34, 0.1], [0, 0, 0], 50, Math.PI / 2 + 0.5)], { ease: 'linear', focusRange: 100 });
  shot(39, [K(0, [5, 1.6, HERO_Z + 6], hero(0.3), 34), K(1, [2.5, 1.2, HERO_Z + 4.6], hero(0.35), 32)], { focus: 'hero', focusRange: 8, ease: 'linear' });
  shot(41, [K(0, [0, 3.0, 38], [0, 1.2, 4], 44), K(1, [0, 2.2, 33], [0, 1.2, 4], 44)], { ease: 'linear', focusRange: 40 });
  // pre-chorus 2: up the aisle, a sweep round the other side, the hero at the stop
  shot(44, [K(0, [0, 1.25, -24], [0, 1.3, 10], 50), K(1, [0, 1.25, HERO_Z - 4], [0, 1.4, 40], 50)], { ease: 'linear', focusRange: 12 });
  shot(47, [K(0, [40, 8, 22], [0, 0.5, 0], 42), K(1, [8, 8, 44], [0, 0.5, 0], 42)], { ease: 'inout', focusRange: 80 });
  shot(50, [K(0, [1.5, 0.75, HERO_Z + 5.5], hero(0.45), 34), K(1, [0.6, 0.7, HERO_Z + 4.2], hero(0.45), 32)], { focus: 'hero', focusRange: 8, ease: 'linear' });
  // chorus 3: the back flip rolling back seen from the side, low front, front row, the high corner
  shot(52, [K(0, [-36, 3.6, 10], [0, 1.4, 0], 44), K(1, [-34, 4.2, 6], [0, 1.2, -2], 44)], { focusRange: 80, ease: 'out' });
  shot(54, [K(0, [0, 5, 37], [0, 0.6, 2], 48), K(1, [0, 6.5, 33.5], [0, 0.4, 0], 48)], { focusRange: 60 });
  shot(56, [K(0, [-30, 1.15, HERO_Z - 1.2], [-18, 1.0, FRONT - 6], 46), K(1, [30, 1.15, HERO_Z - 1.2], [18, 1.0, FRONT - 6], 46)], { ease: 'linear', focusRange: 30 });
  shot(58, [K(0, [16, 3, 32], [-8, 0.8, 0], 46), K(1, [8, 9, 36], [-6, 0.5, -4], 46)], { focusRange: 60 });
  // bridge A: the hero, the crowd bowing behind
  shot(60, [K(0, [0, 1.3, HERO_Z + 9], hero(0.4), 30), K(1, [0, 1.0, HERO_Z + 5], hero(0.4), 30)], { focus: 'hero', focusRange: 10, ease: 'linear' });
  // bridge B: straight down on the spin spreading out, round the front low, down the aisle through
  // the six-step, in from high to low, the crane up for the last "Turn it up"
  shot(63, [K(0, [0, 52, 0.1], [0, 0, 0], 52, Math.PI / 2), K(1, [0, 34, 0.1], [0, 0, 0], 52, Math.PI / 2 - 1.2)], { ease: 'inout', focusRange: 100 });
  shot(67, [K(0, [-38, 3.5, 16], [0, 1, 0], 42), K(0.5, [-16, 4, 38], [0, 1, 0], 42), K(1, [16, 3.5, 38], [0, 1, 0], 42)], { ease: 'inout', focusRange: 60 });
  shot(71, [K(0, [0, 1.25, HERO_Z + 1], [0, 1.3, -30], 50), K(1, [0, 1.25, -12], [0, 1.4, -40], 50)], { ease: 'linear', focusRange: 12 });
  shot(73, [K(0, [0, 12, 46], [0, 0.5, 0], 46), K(1, [0, 2.2, 34], [0, 1.2, 2], 46)], { ease: 'inout', focusRange: 50 });
  shot(75, [K(0, [0, 3, HERO_Z + 10], [0, 1, 0], 44), K(1, [0, 24, 46], [0, 0, -4], 48)], { ease: 'inout', focusRange: 80 });
  // the drop: low in front, the lighthouse lighting behind the crowd as it sits; the breakdown:
  // low on the hero's one-claw freeze with the sitting crowd and the lit lighthouse behind
  shot(77, [K(0, [9, 2.4, 40], [0, 4, -40], 40), K(1, [5, 2.0, 34], [0, 4, -40], 40)], { ease: 'linear', focusRange: 100 });
  shot(80, [K(0, [-4.5, 1.1, HERO_Z + 6.5], hero(0.5), 34), K(1, [-2.5, 0.9, HERO_Z + 4.8], hero(0.5), 32)], { focus: 'hero', focusRange: 10, ease: 'linear' });
  // pre-chorus 3: round the hero, then a sweep in from the side for the drop
  shot(83, [K(0, [-6, 2.0, HERO_Z + 6], hero(0.3), 34), K(1, [6, 2.0, HERO_Z + 6], hero(0.3), 34)], { focus: 'hero', focusRange: 10, ease: 'linear' });
  shot({ t: D(84, 2) }, [K(0, [40, 8, 22], [0, 0, 0], 42), K(1, [10, 5, 44], [0, 1, 0], 42)], { ease: 'inout', focusRange: 80 });
  // final chorus: the 720 bursting out from the front left, front, the back flip from the side,
  // the front row, a sweep round the front with the fireworks behind, straight down on the spin,
  // the hero, and up and away from the freeze
  shot(86, [K(0, [-22, 9, 32], [0, 1.5, 0], 46), K(1, [-18, 7, 29], [0, 1.5, 0], 46)], { ease: 'out', focusRange: 80 });
  shot(88, [K(0, [0, 6, 46], [0, 3, -4], 48), K(1, [0, 7, 41], [0, 3, -4], 48)], { focusRange: 80 });
  shot(90, [K(0, [36, 3.6, 10], [0, 1.4, 0], 44), K(1, [34, 4.2, 6], [0, 1.2, -2], 44)], { focusRange: 80, ease: 'out' });
  shot(92, [K(0, [30, 1.15, HERO_Z - 1.2], [18, 1.0, FRONT - 6], 46), K(1, [-30, 1.15, HERO_Z - 1.2], [-18, 1.0, FRONT - 6], 46)], { ease: 'linear', focusRange: 30 });
  shot(94, [K(0, [-46, 7, 40], [0, 5, -14], 46), K(0.5, [0, 10, 56], [0, 6, -14], 46), K(1, [46, 7, 40], [0, 5, -14], 46)], { ease: 'inout', focusRange: 100 });
  shot(98, [K(0, [-8, 24, 30], [0, 0, -4], 48), K(1, [8, 20, 28], [0, 0, -4], 48)], { ease: 'linear', focusRange: 100 });
  shot(100, [K(0, [-3, 1.3, HERO_Z + 6], hero(0.35), 34), K(1, [-1.5, 1.0, HERO_Z + 4.5], hero(0.35), 32)], { focus: 'hero', focusRange: 8, ease: 'linear' });
  shot(101, [K(0, [0, 2.4, HERO_Z + 8], [0, 1.4, 0], 46), K(1, [0, 22, HERO_Z + 34], [0, 2, -12], 48)], { ease: 'inout', focusRange: 100 });

  return program;
}
