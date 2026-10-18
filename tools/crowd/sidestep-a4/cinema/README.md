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
| 19.30-25.70 s | Six crabs performing one continuous six-step recording |
| 32.10-38.50 s | Iron Wreck reveal and Corrodius performing a jump spin |
| 46.50-52.90 s | A complete group 720, from preparation through recovery |
| 59.30-64.10 s | A continuous group spin by the fountain |
| 70.50-76.90 s | Bank around the lighthouse over the water |
| 97.70-104.10 s | A complete group backflip in the village |
| 118.50-124.90 s | Night flight around the lit beacon |
| 142.50-148.90 s | Continuous group spins in the village at night |

The revised lighthouse insert alternates **day/off and night/on every 48 frames (0.8 seconds)**,
four times each. Both lighting states use the same camera path. The short version moves this
insert to 41.7-48.1 s and ends at 69.55 s with the original final chorus, hit and freeze.

The shore formation is at (112.5, 76). The groups use two columns and three rows, with 4.8-unit
column spacing and 5.8-unit row spacing. The higher camera keeps every performer separate.
Each power move plays through preparation and recovery without looping non-seamless break clips
or switching poses mid-spin. After recovery, a 0.9-second blend carries the performers into a
continuous groove instead of leaving a long stationary tail. Opt-in `exactMotion` removes race stance biases and servo twitches
while keeping the outfits and character scale, so the recorded joints retain their kinematics.

`terrainClearance` keeps foot tips and palm pads above the surface. `terrainLiftRate` precomputes
the minimum speed-limited envelope above the required correction, looking ahead and behind at
60 Hz. This prevents a sudden upward snap while preserving ground clearance. Correction speed
is bounded to 2 world units/s for the groups and 7 for the 3.5-scale boss. Sampling is deterministic
and does not depend on the previous seek. Default crowd programs are unchanged.

Positions are formation coordinates from `src/capture/crowd/program.ts`; the world layout is in
`src/world/layout.ts`. Flight keys include camera roll. Group cameras keep six performers in a
portrait composition. Flip playback uses 0.57x-0.65x for readability. Camera timing is linear through spline
keys, and every inserted range is rounded to whole frames on the existing measured beat grid.

## Reproduce

Needs pnpm 10, ffmpeg and Chrome, as with the original crowd tools. Run from the checkout root.
Keep `SOURCE`, `WORK` and `OUTPUT` at different paths. The original must be 1080x1920 at 60 fps.

```sh
pnpm install --frozen-lockfile
pnpm dev --port 5297 --strictPort
```

In a second terminal, with a writable local `WORK` directory:

```sh
node tools/crowd/sidestep-a4/cinema/capture.mjs --url http://localhost:5297 --out "$WORK/previews" --preview
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

Every frame of a performer shot also checks conservative animated geometry bounds (rigid skinning
per bone plus gear), screen-space separation, frame margins and body continuity. The full render
is rejected for overlapping projected bounds, margins below 8 px, body steps above 0.18 standing
heights/frame or rotation steps above 20 degrees/frame. Bounds are deliberately conservative;
the numerical checks supplement inspection of the actual rotation and landing frames.

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
