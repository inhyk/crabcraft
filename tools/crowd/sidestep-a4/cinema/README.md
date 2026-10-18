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
node tools/crowd/sidestep-a4/cinema/edit.mjs --source "$SOURCE" --shots "$WORK/captures" --out "$OUTPUT"
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

## Validation, 2026-10-18

- `pnpm build`: passed, including TypeScript. `node --check` passed for all three new modules.
- `capture.mjs`: 9 shots, 3366 frames, 0 blank-frame repairs, 0 page errors. Both night shots
  passed after the lighthouse shader guard, with the original DOF and bloom settings retained.
- `edit.mjs`: `CHECKS PASSED`; 1080x1920, H.264 High, 60 fps, 9837 frames, 163.95 s.
- Source/output AAC packet SHA256 matched; final audio measured -14.0 LUFS and -2.6 dBFS true peak.
- Final black runs 0, black frames 0. Thirteen frame-alignment spot checks (all 9 inserts and
  4 retained crowd sections) had SSIM 0.9855 or higher against their corresponding source frames.
- Preview sheets, group rotation sequences and the final 41-frame contact sheet were opened
  and inspected. The original MP4 and failed preliminary takes were preserved locally.
