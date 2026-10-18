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
| 19.30-25.70 s | Six crabs doing six-step and spins on the village road |
| 32.10-38.50 s | Low flight through the gate and a rising turn around the fountain |
| 46.50-52.90 s | Six crabs doing 720s and six-step on the shore |
| 59.30-64.10 s | Six-step and spins by the fountain |
| 70.50-76.90 s | Bank around the lighthouse over the water |
| 97.70-104.10 s | Two sets of group backflips in the village |
| 118.50-124.90 s | Night flight around the lit beacon |
| 142.50-148.90 s | Backflip, spin and 720 in the village at night |

The revised lighthouse insert alternates **day/off and night/on every 48 frames (0.8 seconds)**,
four times each. Both lighting states use the same camera path. The short version moves this
insert to 41.7-48.1 s and ends at 69.55 s with the original final chorus, hit and freeze.

The shore formation is on the flat sand at (114.8, 43), with narrower columns. Its opt-in
`terrainClearance` fits the animated foot tips and palm pads to the terrain, starting from the
original root height every frame, and raises the root only where a support point would penetrate.
This correction changes neither the recorded joint angles nor the default crowd programs.

Positions are formation coordinates from `src/capture/crowd/program.ts`; the world layout is in
`src/world/layout.ts`. Flight keys include camera roll. Group cameras keep six performers in a
portrait composition with 2.2-unit column and 2.8-unit row spacing. Flip playback is 0.45x for
readability; recorded joint and root paths are unchanged. Camera timing is linear through spline
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
node tools/crowd/sidestep-a4/cinema/capture.mjs --url http://localhost:5297 --out "$WORK/captures"
node tools/crowd/sidestep-a4/cinema/capture.mjs --url http://localhost:5297 --out "$WORK/night" --shots lighthouse-bank --night-lighthouse
node tools/crowd/sidestep-a4/cinema/edit.mjs --source "$SOURCE" --shots "$WORK/captures" --night-lighthouse "$WORK/night/lighthouse-bank.mp4" --out "$OUTPUT"
node tools/crowd/sidestep-a4/cinema/short.mjs --source "$OUTPUT" --out "$SHORT_OUTPUT" --work "$WORK/short"
```

`capture.mjs --shots island-dive,village-run` limits capture to those shot IDs. Native output is
1080x1920/60 with `--dsf 1`. Larger device scales cost more render time; the editor expects the
default native size. Failed capture checks stop the command: frame count, first song time,
blank-frame repairs or page errors. The editor checks each sidecar and encoded segment's frame
count, the final frame count, unchanged audio packets, black runs and black frames, then writes
`<output>-report.json` and prints `CHECKS PASSED`.

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

## Revised versions, 2026-10-18

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
