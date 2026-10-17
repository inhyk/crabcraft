// The Clawhaven crowd dancing to take 4 of "Sidestep (Click Clack)", the same Lyria 3.5 prompt as
// ../sidestep (see README.md). A build() for tools/crowd/make.mjs, with the moves of the take 1
// choreography (../sidestep/choreo.mjs, sharing its helpers in ../sidestep/kit.mjs) re-mapped to
// this take's sections. The beat grid (grid.json: 149.995 bpm, bar b starts at 0.100 + 1.6 b
// seconds, made by ../sidestep/beatgrid.py from sidestep-a4.mp3 with the downbeat on beat 0) has
// the same tempo as take 1, so every clip keeps the same speed.
//
// Song map in bars (grid bar b starts at downbeats[b]), measured from the audio: loudness and kick
// per beat of the band and the voices apart (a vocal stem), onsets and word timestamps.
//   0-3 intro ("One, two... ready?" in bar 1, the crowd shouts "Sidestep!" on beats 2-3 of bar 3)
//   4-11 chorus 1 ("Click-clack, side to side"; no shouted "Hey!" in this take, the band hits beat 4
//     of bar 7 and drops out for beat 4 of bar 11)
//   12-19 verse 1 ("Low tide on the boardwalk")
//   20-27 pre-chorus 1 (the kick on the downbeats only, a drum fill in 27; the verse's last line runs
//     into 20-21, "Hold your breath" from beat 4 of 21)
//   28 stop ("Step... to... the side!", the band out for the whole bar)
//   29-36 chorus 2 (the band out for beats 3-4 of 31)
//   37-43 the chorus again without voices, "Hey!" on beat 4 of 39 and 43
//   44-51 verse 2 ("Twist it like a tornado" over three beats of near silence, "everybody let go" in
//     50, "The sun's already risen" in 51), "Just shake it" over bar 52
//   52-59 pre-chorus 2 (kick on the downbeats, a fill in 59)   60 stop (the band out for three beats)
//   61-68 chorus 3 ("Hey!" on beat 4 of 68, the band out under it)
//   69 bridge A in one bar ("Everybody freeze, take a bow, and arise")
//   70-75 bridge B ("Moonlight on the water" in 70 and 74): with bridge A the song's longest quiet,
//     open stretch (the band 0.8-2.1 dB under the choruses, the kick on 9 of 28 beats)
//   76 "Turn it up" four times   77 "Here we go!", the full beat back   78-79 the full band
//   80 the band out, "Here we go!" a cappella
//   81-84 pre-chorus 3 ("Lift your claws up higher", "On the count of three")
//   85-100 final chorus (kick on the downbeats in 85-92, four to the bar from 93)
//   101 the last hit on the downbeat (161.7 s); the ring dies by 163.7 s.
// Against the 104 bars the prompt planned: on plan to bar 19, the first stop a bar late (28), so
// chorus 2 starts at 29; then seven bars of the chorus without voices the prompt did not ask for,
// verse 2 eight bars late (44), the second stop at 60, chorus 3 at 61, bridge A one bar long (69)
// and bridge B six bars (70-75) instead of seventeen; no whispered breakdown (78-79 have the full
// band and 80 is a cappella), pre-chorus 3 at 81, the final chorus at 85 (three bars early) and no
// closing shout: the song ends on the hit of bar 101.
import { stage } from '../sidestep/kit.mjs';

export default async function build({ grid, clips, repo }) {
  const { program, B, D, ev, F, depth, FRONT, HERO_Z, cue, tempo, dance, win, shot1, hop, cast, fill, face, W, fw, shot, K, hero } = await stage({ grid, clips, repo });
  // The last hit rings for about two seconds; the frame holds a little longer.
  program.length = D(101) + 2.25;
  // The song's own rests: none. Before its end this take never falls under -40 dB for 0.3 s, also
  // after make.mjs takes it down to -14 LUFS (silencedetect on the WAV finds only the tail from
  // 163.7 s).
  program.quiet = [];

  // ---- intro (bars 0-3): "One, two... ready?" the crowd stands sleepy-eyed; on the shout
  // "Sidestep!" the faces wake from the middle out, the claws coming up into the shout to wave.
  face(0, 'sleepy');
  face(D(3, 1), 'happy', 'all', { by: 'out', step: 0.06 });
  cue({ at: D(3, 1), clip: 'gesture_hello', from: 0.9, to: 4.6, sync: 1.9, who: 'all', fade: 0.4, wave: { by: 'out', step: 0.05 }, until: D(4) - 0.35 });

  // ---- chorus 1 (bars 4-11): "Click-clack, side to side", the hop rippling across onto the band's
  // hit at the end of bar 7 and its break at the end of bar 11.
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

  // ---- pre-chorus 1 (bars 20-27), then the stop (28): on "Step... to... the side!" the claws
  // fling wide and hold while the band is out.
  dance('dance_brazilian', 20, 7, W.braz[1], { wave: { by: 'diag', step: 0.035 } });
  cast(D(28), { wave: { by: 'out', step: 0.03 } });
  face(D(27), 'surprised');

  // ---- chorus 2 (bars 29-36): the 720 rolls back through the rows, landing from the downbeat on.
  shot1('break_jumpspin', 'land', D(29), { wave: { by: 'row', step: 0.05 } });
  face(D(29), 'happy');
  dance('dance_crab', 30, 2, W.crab[2]);
  fill(32);
  dance('dance_brazilian', 33, 3, W.braz[2], { mirror: 'left' });
  fill(36, true);

  // ---- the chorus without voices (bars 37-43), with take 1's bridge moves: dance_crab in unison,
  // the hop rippling across onto the first "Hey!", the six-step on every other row and column with
  // the wings around it, and the hop back across onto the second "Hey!".
  dance('dance_crab', 37, 2, W.crab[5]);
  fill(39);
  dance('dance_dream_wings', 40, 3, W.wings[2]);
  shot1('break_sixstep', 'policy_start', D(40), { who: { everyRow: [2, 0], parity: 0 }, sync: win('break_sixstep').from });
  shot1('break_sixstep', 'policy_start', D(40), { who: 'hero', sync: win('break_sixstep').from });
  fill(43, true);

  // ---- verse 2 (bars 44-51): "Twist it like a tornado": the spin on the checkerboard in canon,
  // the hero's six-step, dance_crab rippling in from the sides, and on "everybody let go" the
  // hero's one-claw freeze; the slam ripples across on "The sun's already risen", the hop on "Just
  // shake it" (bar 52).
  shot1('break_spin', 'policy_start', D(44), { who: { parity: 0 }, sync: win('break_spin').from });
  shot1('break_spin', 'policy_start', D(45, 2), { who: { parity: 1 }, sync: win('break_spin').from });
  face(D(44), 'focused');
  shot1('break_sixstep', 'policy_start', D(44), { who: 'hero', sync: win('break_sixstep').from });
  dance('dance_crab', 47, 4, W.crab[3], { wave: { by: 'side', step: 0.05 } });
  shot1('break_oneclaw', 'hit', D(50), { who: 'hero', to: ev('break_oneclaw', 'release') + 0.15 });
  cue({ at: D(51), clip: 'attack_slam', from: ev('attack_slam', 'windup') - 0.45, to: ev('attack_slam', 'recovered') + 0.35, sync: ev('attack_slam', 'impact'), who: 'all', fade: 0.2, wave: { by: 'col', step: (2 * B) / (F.cols - 1) } });
  hop(D(52), { wave: { by: 'side', step: 0.06, reverse: true } });
  face(D(51), 'happy');

  // ---- pre-chorus 2 (bars 52-59, "Hold your breath" from 53), the stop (60)
  dance('dance_dream_wings', 53, 6, W.wings[1], { wave: { by: 'diag', step: 0.035, reverse: true } });
  cast(D(60), { wave: { by: 'out', step: 0.03 } });
  face(D(59), 'surprised');

  // ---- chorus 3 (bars 61-68): the back flip rolls back through the rows; the crowd hops onto the
  // "Hey!" while the hero gathers for the claw stand.
  shot1('break_backflip', 'land', D(61), { wave: { by: 'row', step: 0.05 } });
  face(D(61), 'love');
  dance('dance_crab', 62, 2, W.crab[4]);
  fill(64);
  dance('dance_brazilian', 65, 3, W.braz[3], { mirror: 'left' });
  fill(68, true, D(68, 3), { who: 'crowd' });
  face(D(65), 'happy');

  // ---- the night (bars 69-76), at the song's quietest, most open stretch: night falls on bridge
  // A and the crowd bows from the middle out on "take a bow"; on "arise" the hero goes up on its
  // claws, the lighthouse and the stage lights come on with "Moonlight on the water", the crowd
  // sits from the back rows forward and watches the hero spin and break while fireworks go up over
  // the lighthouse; on "Turn it up" it rises again, row by row from the front.
  program.fx.push({ at: D(69), kind: 'mood', mood: 2 }, { at: D(70), kind: 'beacon', on: true }, { at: D(70), kind: 'lights', level: 0.6, d: 2.5 });
  cue({ at: D(69), clip: 'gesture_bow', from: 1.0, to: 6.4, who: 'crowd', fade: 0.4, wave: { by: 'out', step: 0.05 } });
  shot1('break_clawstand', 'hit', D(70), { who: 'hero', to: ev('break_clawstand', 'release') + 0.1 });
  face(D(69), 'focused');
  cue({ at: D(72, 2), clip: 'sit', from: ev('sit', 'policy_start'), to: ev('sit', 'seated_to'), sync: ev('sit', 'settled'), hold: true, who: 'crowd', fade: 0.4, wave: { by: 'row', step: 0.06, reverse: true } });
  face(D(71), 'love');
  shot1('break_spin', 'policy_start', D(72), { who: 'hero', sync: win('break_spin').from });
  shot1('break_sixstep', 'policy_start', D(74, 2), { who: 'hero', sync: win('break_sixstep').from });
  for (let i = 0; i < 3; i++) fw(D(73) + i * 0.6, (i - 1) * 25, -depth / 2 - 26, 30);
  cue({ at: D(76), clip: 'sit', from: ev('sit', 'seated_to') - 0.2, to: ev('sit', 'recovered'), sync: ev('sit', 'rising'), who: 'crowd', fade: 0.3, wave: { by: 'row', step: 0.05 } });

  // ---- "Here we go!" (bars 77-80): the brazilian mirrored with the full band, then everyone
  // stands still for the a cappella bar while the hero holds the one-claw freeze.
  dance('dance_brazilian', 77, 3, W.braz[4], { mirror: 'left', until: D(80) });
  shot1('break_oneclaw', 'hit', D(80), { who: 'hero', to: ev('break_oneclaw', 'release') + 0.15 });

  // ---- pre-chorus 3 (bars 81-84): the wings on "Lift your claws up higher, let the lighthouse
  // spin" (the hero joining from 82), and from "On the count of three" the claws gather to fling
  // wide on the drop.
  dance('dance_dream_wings', 81, 3, W.wings[3], { who: 'crowd', lead: 0.5 });
  dance('dance_dream_wings', 82, 2, W.wings[3] + 4 * tempo('dance_dream_wings').bt.period, { who: 'hero' });
  cast(D(85) - 0.02, { wave: { by: 'out', step: 0.02 } });
  face(D(81), 'happy');

  // ---- final chorus (bars 85-100): the 720 bursts out from the middle, unison, the back flip
  // rolls across the diagonal, fireworks all the way, and the one-claw freeze on the last hit.
  program.fx.push({ at: D(85), kind: 'lights', level: 1, d: 0.1 });
  program.pulses = [];
  for (let b = 85; b < 101; b++) for (let k = 0; k < 4; k++) program.pulses.push(D(b, k));
  program.pulses.push(D(101));
  shot1('break_jumpspin', 'land', D(85), { wave: { by: 'out', step: 0.07 } });
  dance('dance_crab', 86, 2, W.crab[6]);
  fill(88);
  shot1('break_backflip', 'land', D(89), { wave: { by: 'diag', step: 0.025 } });
  dance('dance_brazilian', 90, 2, W.braz[0] + 20, { mirror: 'left' });
  fill(92, true);
  dance('dance_crab', 93, 4, W.crab[2] + 16);
  shot1('break_spin', 'policy_start', D(97), { sync: win('break_spin').from, wave: { by: 'col', step: 0.03 } });
  // The freeze: the one-claw lift lands on the last hit and holds to the end.
  shot1('break_oneclaw', 'hit', D(101), { to: ev('break_oneclaw', 'hit') + 0.9, hold: true, fade: 0.2 });
  face(D(85), 'love');
  face(D(93), 'happy');
  face(D(101), 'love');

  // ------------------------------------------------------------------------------ flashes, fireworks
  for (const [b, a] of [[4, 0.3], [29, 0.28], [61, 0.28], [85, 0.38]]) program.fx.push({ at: D(b), kind: 'flash', d: 0.3, a });
  program.fx.push({ at: D(101), kind: 'flash', d: 0.4, a: 0.2 });
  // Dusk, the beacon dark and the stage lights off from the top (a shot rendered after a night
  // shot in the same page eases back within its pre-roll).
  program.fx.push({ at: 0, kind: 'mood', mood: 0 }, { at: 0, kind: 'beacon', on: false }, { at: 0, kind: 'lights', level: 0, d: 0.01 });
  // A salvo on every downbeat of the last chorus, bigger on the four-bar lines.
  for (let b = 85; b < 101; b++) {
    const n = [85, 89, 93, 97].includes(b) ? 5 : 2;
    for (let i = 0; i < n; i++) {
      const x = ((i + 0.5) / n - 0.5) * 70 + ((b * 7 + i * 13) % 9) - 4;
      fw(D(b) - 1.1 + i * 0.08, x, -depth / 2 - 22 - ((b + i) % 3) * 6, 30 + ((b * 3 + i * 5) % 11));
    }
  }
  for (let i = 0; i < 6; i++) fw(D(101) - 1.05 + i * 0.05, (i - 2.5) * 13, -depth / 2 - 20 - (i % 2) * 8, 32 + (i % 3) * 4);

  // ------------------------------------------------------------------------------ camera
  // Take 1's shots on this take's bars. Five of them (bars 80, 81, 89, 93 and 100) start, pass or
  // end a hair off take 1's keys: on take 1's the canvas rendered black for a frame there, the
  // same frame on every capture. Formation coordinates: x to the crowd's left (screen right when
  // it faces the camera), z front.
  // intro: down out of the sky over the bay to the deck, then the hero's face before the shout,
  // waking up on "Sidestep!"
  program.shots.push({ from: 0, keys: [K(0, [26, 46, 132], [0, 0, -6], 44), K(1, [5, 9, 54], [0, 1, 0], 42)], ease: 'out' });
  shot({ t: D(2, 2) }, [K(0, [2.2, 1.0, 32.6], hero(0.4), 26), K(1, [0.9, 0.9, 31.2], hero(0.35), 24)], { focus: 'hero', focusRange: 6, ease: 'linear' });
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
  shot(27, [K(0, [-1.5, 0.75, HERO_Z + 5.5], hero(0.45), 34), K(1, [-0.6, 0.7, HERO_Z + 4.2], hero(0.45), 32)], { focus: 'hero', focusRange: 8, ease: 'linear' });
  // chorus 2: the 720 rolling back through the rows from the front left, high front, front row, crane
  shot(29, [K(0, [-24, 4, 32], [0, 2.0, 2], 46), K(1, [-20.5, 5.2, 29.4], [0, 1.4, 0], 46)], { focusRange: 80, ease: 'out' });
  shot(31, [K(0, [0, 15, 46], [0, 0, 0], 46), K(1, [0, 11, 41], [0, 0.5, 0], 46)], { focusRange: 80 });
  shot(33, [K(0, [30, 1.15, HERO_Z - 1.2], [18, 1.0, FRONT - 6], 46), K(1, [-30, 1.15, HERO_Z - 1.2], [-18, 1.0, FRONT - 6], 46)], { ease: 'linear', focusRange: 30 });
  shot(35, [K(0, [0, 1.4, HERO_Z + 5], hero(0.4), 38), K(1, [0, 26, HERO_Z + 22], [0, 0, -4], 46)], { ease: 'inout', focusRange: 60 });
  // the chorus without voices: round the front low, down the aisle through the six-step, in from
  // high to low for the last "Hey!"
  shot(37, [K(0, [-38, 3.5, 16], [0, 1, 0], 42), K(0.5, [-16, 4, 38], [0, 1, 0], 42), K(1, [16, 3.5, 38], [0, 1, 0], 42)], { ease: 'inout', focusRange: 60 });
  shot(40, [K(0, [0, 1.25, HERO_Z + 1], [0, 1.3, -30], 50), K(1, [0, 1.25, -12], [0, 1.4, -40], 50)], { ease: 'linear', focusRange: 12 });
  shot(42, [K(0, [0, 12, 46], [0, 0.5, 0], 46), K(1, [0, 2.2, 34], [0, 1.2, 2], 46)], { ease: 'inout', focusRange: 50 });
  // verse 2: straight down on the spinning checkerboard, the hero, low in front for the slam
  shot(44, [K(0, [0, 40, 0.1], [0, 0, 0], 50, Math.PI / 2), K(1, [0, 34, 0.1], [0, 0, 0], 50, Math.PI / 2 + 0.5)], { ease: 'linear', focusRange: 100 });
  shot(47, [K(0, [5, 1.6, HERO_Z + 6], hero(0.3), 34), K(1, [2.5, 1.2, HERO_Z + 4.6], hero(0.35), 32)], { focus: 'hero', focusRange: 8, ease: 'linear' });
  shot(50, [K(0, [0, 3.0, 38], [0, 1.2, 4], 44), K(1, [0, 2.2, 33], [0, 1.2, 4], 44)], { ease: 'linear', focusRange: 40 });
  // pre-chorus 2: up the aisle, a sweep round the other side, the hero at the stop
  shot(53, [K(0, [0, 1.25, -24], [0, 1.3, 10], 50), K(1, [0, 1.25, HERO_Z - 4], [0, 1.4, 40], 50)], { ease: 'linear', focusRange: 12 });
  shot(56, [K(0, [40, 8, 22], [0, 0.5, 0], 42), K(1, [8, 8, 44], [0, 0.5, 0], 42)], { ease: 'inout', focusRange: 80 });
  shot(59, [K(0, [1.5, 0.75, HERO_Z + 5.5], hero(0.45), 34), K(1, [0.6, 0.7, HERO_Z + 4.2], hero(0.45), 32)], { focus: 'hero', focusRange: 8, ease: 'linear' });
  // chorus 3: the back flip rolling back seen from the side, low front, front row, the high corner
  shot(61, [K(0, [-36, 3.6, 10], [0, 1.4, 0], 44), K(1, [-34, 4.2, 6], [0, 1.2, -2], 44)], { focusRange: 80, ease: 'out' });
  shot(63, [K(0, [0, 5, 37], [0, 0.6, 2], 48), K(1, [0, 6.5, 33.5], [0, 0.4, 0], 48)], { focusRange: 60 });
  shot(65, [K(0, [-30, 1.15, HERO_Z - 1.2], [-18, 1.0, FRONT - 6], 46), K(1, [30, 1.15, HERO_Z - 1.2], [18, 1.0, FRONT - 6], 46)], { ease: 'linear', focusRange: 30 });
  shot(67, [K(0, [16, 3, 32], [-8, 0.8, 0], 46), K(1, [8, 9, 36], [-6, 0.5, -4], 46)], { focusRange: 60 });
  // the night: the hero with the crowd bowing behind as the dusk goes; low in front, the
  // lighthouse lighting behind the crowd as it sits; low on the hero breaking in front of the
  // sitting crowd; the crane up for "Turn it up"
  shot(69, [K(0, [0, 1.3, HERO_Z + 9], hero(0.4), 30), K(1, [0, 1.0, HERO_Z + 5], hero(0.4), 30)], { focus: 'hero', focusRange: 10, ease: 'linear' });
  shot(71, [K(0, [9, 2.4, 40], [0, 4, -40], 40), K(1, [5, 2.0, 34], [0, 4, -40], 40)], { ease: 'linear', focusRange: 100 });
  shot(74, [K(0, [-4.5, 1.1, HERO_Z + 6.5], hero(0.5), 34), K(1, [-2.5, 0.9, HERO_Z + 4.8], hero(0.5), 32)], { focus: 'hero', focusRange: 10, ease: 'linear' });
  shot(76, [K(0, [0, 3, HERO_Z + 10], [0, 1, 0], 44), K(1, [0, 24, 46], [0, 0, -4], 48)], { ease: 'inout', focusRange: 80 });
  // "Here we go!": the crane down over the front for the brazilian, then the hero's one-claw
  // freeze in the a cappella bar
  shot(78, [K(0, [-16, 3, 32], [8, 0.8, 0], 46), K(1, [-8, 9, 36], [6, 0.5, -4], 46)], { focusRange: 60 });
  shot(80, [K(0, [4.5, 1.1, HERO_Z + 6.5], hero(0.5), 34), K(1, [2.3, 0.95, HERO_Z + 4.6], hero(0.5), 32)], { focus: 'hero', focusRange: 10, ease: 'linear' });
  // pre-chorus 3: round the hero, then a sweep in from the side for the drop
  shot(81, [K(0, [-6.4, 2.1, HERO_Z + 6.2], hero(0.3), 34), K(1, [6, 2.0, HERO_Z + 6], hero(0.3), 34)], { focus: 'hero', focusRange: 10, ease: 'linear' });
  shot({ t: D(83, 2) }, [K(0, [40, 8, 22], [0, 0, 0], 42), K(1, [10.5, 5.2, 44.4], [0, 1, 0], 42)], { ease: 'inout', focusRange: 80 });
  // final chorus: the 720 bursting out from the front left, front, the back flip from the side,
  // the front row, a sweep round the front with the fireworks behind, straight down on the spin,
  // the hero, and up and away from the freeze
  shot(85, [K(0, [-22, 9, 32], [0, 1.5, 0], 46), K(1, [-18, 7, 29], [0, 1.5, 0], 46)], { ease: 'out', focusRange: 80 });
  shot(87, [K(0, [0, 6, 46], [0, 3, -4], 48), K(1, [0, 7, 41], [0, 3, -4], 48)], { focusRange: 80 });
  shot(89, [K(0, [36.4, 3.5, 10.4], [0, 1.4, 0], 44), K(1, [34, 4.2, 6], [0, 1.2, -2], 44)], { focusRange: 80, ease: 'out' });
  shot(91, [K(0, [30, 1.15, HERO_Z - 1.2], [18, 1.0, FRONT - 6], 46), K(1, [-30, 1.15, HERO_Z - 1.2], [-18, 1.0, FRONT - 6], 46)], { ease: 'linear', focusRange: 30 });
  shot(93, [K(0, [-46, 7, 40], [0, 5, -14], 46), K(0.5, [0, 10.4, 56.5], [0, 6, -14], 46), K(1, [46, 7, 40], [0, 5, -14], 46)], { ease: 'inout', focusRange: 100 });
  shot(97, [K(0, [-8, 24, 30], [0, 0, -4], 48), K(1, [8, 20, 28], [0, 0, -4], 48)], { ease: 'linear', focusRange: 100 });
  shot(99, [K(0, [-3, 1.3, HERO_Z + 6], hero(0.35), 34), K(1, [-1.5, 1.0, HERO_Z + 4.5], hero(0.35), 32)], { focus: 'hero', focusRange: 8, ease: 'linear' });
  shot(100, [K(0, [0, 2.4, HERO_Z + 8], [0, 1.4, 0], 46), K(1, [0.5, 22.5, HERO_Z + 34.5], [0, 2, -12], 48)], { ease: 'inout', focusRange: 100 });

  return program;
}
