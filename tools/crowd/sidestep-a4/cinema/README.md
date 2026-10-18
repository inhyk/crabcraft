# Sidestep a4 world and small-group edit

Nine inserts replace 56.1 seconds of the existing **portrait** a4 video. The music, total length,
other crowd scenes and ending stay on their original frame positions. `edit.mjs` copies the
source AAC packets and checks that their SHA256 is identical afterwards. It refuses to overwrite
the source. Rendered videos and capture intermediates are local artifacts, outside Git.

The inserts use the actual Clawhaven map and dressed game crabs, rendered by the existing dev-only
crowd scene. The small groups play the game's recorded motion clips on the terrain. They are
staged cinematic replays, not footage of an online multiplayer gathering or physical robots.
The lighthouse beam shader clamps fractional-power inputs to their valid domain so cone-edge
rounding cannot spread NaN through bloom. No server, multiplayer protocol or production capture
hook is changed.

| Song range | Insert |
|---|---|
| 0.00-6.50 s | Bank from the bay toward the village and fountain |
| 19.30-25.70 s | Crew groove past a ground-level slide, then a crane over the six-step |
| 32.10-38.50 s | Corrodius grooves on the Iron Wreck, crouches, jump-spins and lands on the bar |
| 46.50-52.90 s | Lead close-up on the sand, then the crew's rippling 720 from a rising camera |
| 59.30-64.10 s | Push-in on the lead by the claw fountain, then a turning top-down crew spin |
| 70.50-76.90 s | Bank around the lighthouse over the water |
| 97.70-104.10 s | Lead close-up at the chapel, then the backflip ripple from a low 3/4 dolly |
| 118.50-124.90 s | Night flight around the lit beacon |
| 142.50-148.90 s | Night lead close-up, then a half orbit around the spinning crew |

The revised lighthouse insert alternates **day/off and night/on every 48 frames (0.8 seconds)**,
four times each. Both lighting states use the same camera path. The short version moves this
insert to 41.7-48.1 s and ends at 69.55 s with the original final chorus, hit and freeze.

The crew is the crowd video's lead crab with five dancers in a 1-2-3 wedge behind it
(`formation.points` in `src/capture/crowd/program.ts`): 4.8 units across, 3.8 between rows, so
no dancer stands straight behind another from the front. Every crew insert has two camera shots
with a cut on the bar line: two bars of groove close on the lead (low, moving, shallow focus),
then the whole crew through one power move that lands on a downbeat, from a crane, orbit or dolly.
The groove (`dance_crab` at 1.1549x) puts its steps on the song's beats, so the move starts from a
dance instead of a standstill. Power moves play at 0.8x-0.9x (the boss at 0.6x, its 3.5 scale) and
are entered from their standing pre-roll with a 0.5-second blend. The boss faces the wreck's bow so
the camera stays on the deck, clear of its posts. Opt-in `exactMotion` removes race stance biases
and servo twitches while keeping the outfits and character scale.

`terrainClearance` keeps foot tips and palm pads above the surface. `terrainLiftRate` precomputes
the minimum speed-limited envelope above the required correction, looking ahead and behind at
60 Hz. This prevents a sudden upward snap while preserving ground clearance. Correction speed
is bounded to 2 world units/s for the groups and 7 for the 3.5-scale boss. Sampling is deterministic
and does not depend on the previous seek. Default crowd programs are unchanged.

Positions are formation coordinates from `src/capture/crowd/program.ts`; the world layout is in
`src/world/layout.ts`. Flight and crew keys include camera roll. `--stills N` in preview mode grabs
N evenly spaced stills per shot. Every inserted range and every crew camera cut is rounded to whole
frames on the existing measured beat grid.

## Reproduce

Needs pnpm 10, ffmpeg and Chrome, as with the original crowd tools. Run from the checkout root.
Keep `SOURCE`, `WORK` and `OUTPUT` at different paths. The original must be 1080x1920 at 60 fps.

```sh
pnpm install --frozen-lockfile
pnpm dev --port 5297 --strictPort
```

In a second terminal, with a writable local `WORK` directory:

```sh
node tools/crowd/sidestep-a4/cinema/capture.mjs --url http://localhost:5297 --out "$WORK/previews" --preview --stills 8
# Inspect the per-shot JPGs before the full capture.
node tools/crowd/sidestep-a4/cinema/audit.mjs --out "$WORK/audit" --strict
node tools/crowd/sidestep-a4/cinema/capture.mjs --url http://localhost:5297 --out "$WORK/captures"
node tools/crowd/sidestep-a4/cinema/capture.mjs --url http://localhost:5297 --out "$WORK/night" --shots lighthouse-bank --night-lighthouse
node tools/crowd/sidestep-a4/cinema/edit.mjs --source "$SOURCE" --shots "$WORK/captures" --night-lighthouse "$WORK/night/lighthouse-bank.mp4" --out "$OUTPUT"
node tools/crowd/sidestep-a4/cinema/short.mjs --source "$OUTPUT" --out "$SHORT_OUTPUT" --work "$WORK/short"
```

`capture.mjs --shots island-dive,boss-reveal` limits capture to those shot IDs. Native output is
1080x1920/60 with `--dsf 1`. Larger device scales cost more render time; the editor expects the
default native size. Failed capture checks stop the command: frame count, first song time,
blank-frame repairs or page errors. The editor checks each sidecar and encoded segment's frame
count, the final frame count, unchanged audio packets, black runs and black frames, then writes
`<output>-report.json` and prints `CHECKS PASSED`.

Every frame of a performer shot also checks contact and continuity. Contact is measured between
the crabs' part boxes (each bone's rigidly skinned vertices and each gear mesh, transformed per
frame); the full render is rejected if any two crabs' parts touch, if a body moves more than 0.24
standing heights in a frame, or if it turns more than 28 degrees in a frame. Those bounds sit above
a real 720 at 0.8x (peak 0.21 heights and 24 degrees per frame on landing and in the air) and below
the 0.32-unit, 33-degree snaps the earlier transitions produced. On-screen occlusion and crabs
leaving the frame are allowed: the low, moving cameras need depth. Bounds supplement inspection of
the actual rotation and landing frames.

For a final overview, run the existing `tools/trailer/contact_sheet.py` on the output and open
the resulting image. Also inspect rotations and camera cuts in motion, including each insert's
boundaries. A clean numeric report alone does not establish visual quality.

`SHORT_OUTPUT` must be a separate file. The short edit cuts on the measured bar grid, adds 4 ms
audio fades at each music splice to prevent clicks, normalizes the soundtrack to -14 LUFS, and
keeps the complete original ending. It writes its own timeline and media-check report.

## Initial full-edit validation, 2026-10-18

- `pnpm build`: passed, including TypeScript. `node --check` passed for all three new modules.
- `capture.mjs`: 9 shots, 3366 frames, 0 blank-frame repairs, 0 page errors. Both night shots
  passed after the lighthouse shader guard, with the original DOF and bloom settings retained.
- `edit.mjs`: `CHECKS PASSED`; 1080x1920, H.264 High, 60 fps, 9837 frames, 163.95 s.
- Source/output AAC packet SHA256 matched; final audio measured -14.0 LUFS and -2.6 dBFS true peak.
- Final black runs 0, black frames 0. Thirteen frame-alignment spot checks (all 9 inserts and
  4 retained crowd sections) had SSIM 0.9855 or higher against their corresponding source frames.
- Preview sheets, group rotation sequences and the final 41-frame contact sheet were opened
  and inspected. The original MP4 and failed preliminary takes were preserved locally.

## Revision 2 validation, 2026-10-18 (archived)

- Full: 163.95 s, 9837 frames. Short: 69.55 s, 4173 frames. Both are 1080x1920/60 and pass
  black-frame checks. The full edit retains identical source AAC packets; the short soundtrack
  is edited on bar boundaries and uses two-pass loudnorm (-14.0 LUFS, -2.4 dBFS true peak).
- Shore recapture: 384 frames, 0 blank repairs, 0 page errors. Animated support-point clearance
  is at least 0.045 world units, with a maximum upward correction of 0.33645 units.
- The lighthouse has 8 alternating 48-frame lighting states. All 8 states, the full shore at
  51 s and all 8 short-edit sections passed frame-alignment spot checks (17/17, SSIM >= 0.9848).
- `pnpm build`, syntax checks for all four modules and `git diff --check` pass. Capture-only
  terrain-fit fields are absent from production JS. The existing web-game client, adapted to
  installed Chrome/Metal, produced 3 inspected screenshots and state JSONs with no error logs;
  the default SwiftShader run timed out during readiness and is not counted as a passing check.
- The final short and full contact sheets were opened. Both edits retain the original ending.

## Revision 3 motion validation, 2026-10-18

The five group shots cover 1824 frames; the boss shot adds 384. All 2208 recorded frames passed
the overlap, continuity, ground-clearance, framing and capture checks. Group geometry bounds do
not intersect (minimum world gap 1.2745), and projected actor rectangles never overlap (minimum
screen gap 20.50 px). The smallest frame margin is 22.69 px. Maximum normalized body step is
0.1307 standing heights/frame; maximum body rotation step is 18.825 degrees/frame.

Before this revision, the fountain transition reached 0.3155 world units/frame and 32.954
degrees/frame. In the revised fountain shot these are 0.0581 world units/frame and 13.034
degrees/frame. The non-seamless loop and fast mid-spin transition were removed, and the
framewise ground correction was replaced by the speed-limited clearance envelope.

Both v3 MP4s pass the full media checks at the original lengths (69.55 s and 163.95 s), with no
black frames. Fourteen final frame-alignment checks passed (minimum SSIM 0.986648). The full AAC
packets match the source, and the short AAC packets match revision 2 exactly. Final contact sheets
and the boss's takeoff, rotation, landing and recovered poses were opened and inspected.

## Revision 4 (dynamic crew and boss), 2026-10-18

Feedback on v3: the boss moved too suddenly and the six-crab cameras were too fixed; dance a
little, then spin. The v3 high, nearly fixed group cameras came from the screen-space rule (no
projected rectangles overlapping, every crab 8 px inside the frame); it is replaced by the
part-contact rule above.

- Captures: 9 shots, 3366 frames, 0 blank repairs, 0 page errors; the night lighthouse, 384 frames.
- Crew and boss motion over 2208 frames: part contact 0 (minimum part gap 0.2586 units, in the
  spins), maximum body step 0.212 standing heights/frame and turn 24.3 degrees/frame (720 and
  backflip in the air), foot and palm clearance at least 0.045 units.
- Full: `CHECKS PASSED`, 163.95 s, 9837 frames, source AAC packets unchanged, no black frames.
  Short: `CHECKS PASSED`, 69.55 s, 4173 frames, -14.0 LUFS, -2.4 dBFS true peak, original ending.
- Beat-spaced frame grids of every crew and boss shot and the prep, apex and landing frames of the
  720 and the boss jump spin were opened and inspected.
