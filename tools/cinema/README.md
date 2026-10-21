# Cinema: staged shots inside the game

Tools for cinematic videos shot in the real game, in every world. The stage
(`src/capture/cinema/`) runs on the dev server only: `capture.mjs` imports it into the game page, so
nothing in the app references it and a production build never contains it.

What the stage does for a shot (`src/capture/cinema/types.ts` describes every field):

- hides the game's own crabs, HUD and quest markers, stops their AI, and travels to the shot's world
  (`chapter` 1 to 6);
- adds the shot's actors as ordinary game units (`createCrab` with a `CrabSpec`, or an enemy rig),
  so they walk, strafe and play motion clips with the game's own motion runtime;
- moves actors along timed paths (`tracks.<id>.path`, facing the way they travel unless keyed),
  fires clips (`acts`) and LED faces (`faces`) on the shot clock;
- flies the camera through keys whose points can be world positions, heights above the ground
  (`{ g: [x, h, z] }`) or offsets in an actor's own frame (`{ a: id, o: [left, up, ahead] }`);
- grades the picture per shot (`view`: exposure, saturation, contrast, bloom, vignette, depth of
  field) and can override the world's fog;
- runs effects (`fx`): `snow`, `leaves`, `motes`, `embers` (particle volumes, pure functions of
  time), `flames`, `wash` (a noise card over the lens), `cracks` (glowing ground), `light`,
  `flash`/`fade` (screen colour), `shake`, `meteor`, `explode`, `swirl`, and `vfx` (any recipe of
  `src/game/vfx/vfx.ts` by name). A scene can add kinds in `src/capture/cinema/fx/<name>.ts` with
  `registerEffect`.

Every effect cue takes `t` and most take `until`, `fadeIn`, `fadeOut`; see `fx.ts` for each kind's
parameters and defaults.

## Run

```sh
pnpm dev --port 5311 --strictPort
# stills at shot seconds 0 and 2.5 of two shots, to check framing:
node tools/cinema/capture.mjs --url http://localhost:5311 --program tools/cinema/tribute/program.mjs \
  --out "$WORK/stills" --shots snow-face,snow-beast --stills 0,2.5
python3 tools/cinema/stills-sheet.py "$WORK/sheet.jpg" 4 480 "$WORK/stills/*.jpg"
# the shots, 24 fps at 1920x872 (2.2:1; the edit letterboxes to 1920x1080):
node tools/cinema/capture.mjs --url http://localhost:5311 --program tools/cinema/tribute/program.mjs --out "$WORK/shots"
```

`capture.mjs` keeps one page for every shot and orders them by world. A shot owns the song frames
`round(at * 24)` up to `round((at + length) * 24)`, so shots that tile a range join frame for frame.

## The tribute

`tribute/` remakes a 2004 game cinematic shot for shot in World of Crabcraft, cut to a soundtrack
the user supplies at edit time. The soundtrack and the rendered video stay outside the repository
(the repository takes no third-party music or video). `tribute/timeline.mjs` is the cut list,
`tribute/cast.mjs` the characters, `tribute/scenes/*.mjs` the shots.

The snow opening uses one continuous `snow-face` take from 39.5 to 61 seconds (including the
former `snow-trudge` shot), followed by `snow-wide`. Capture both together to retain the walk's
snow tracks between views. `CC_QA_BASE=http://localhost:5311 node tools/cinema/qa-snow-opening.mjs`
checks the lamp clearance, motion through 57 seconds, the wide shot's footprints and restoration
of the world's lamp geometry after filming.

## Night-elf action showcase

`tribute/scenes/elf-actions.mjs` replaces only the original `night-elf-run`
(74.6-88.0 seconds, edit frames 1790-2111) with seven shots. The close-up,
transformation, cliff leap and the rest of the tribute retain their original specs.
All seven actions play existing MuJoCo motion clips through the game runtime:

| Shot | Song seconds | Source clip | Treatment |
|---|---|---|---|
| night-elf-toprock | 74.6-76.0 | break_toprock | Running entry, two-beat footwork excerpt |
| night-elf-sixstep | 76.0-77.7 | break_sixstep | Running entry, elevated view of the pivot |
| night-elf-spin | 77.7-79.15 | break_spin | Ground spin excerpt, side view |
| night-elf-backflip | 79.15-80.8 | break_backflip | Full takeoff, rotation and recovery, puddle hit at 79.72 |
| night-elf-clawstand | 80.8-82.8 | break_clawstand | Balance and return to the feet |
| night-elf-oneclaw | 82.8-85.2 | break_oneclaw | One-claw balance and release, water accent at 84.38 |
| night-elf-720 | 85.2-88.0 | break_jumpspin | Full 720 and recovery at 0.58x, then the original transformation mark |

The shorter dance shots are excerpts, not complete policy rollouts. Grounded action
roots stay planted. The jumps use the recorded floating-body pose; their stage path
does not add another jump. Only the post-720 transformation lift is authored, matching
the following shot at x=-90.5, z=94.5, lift=1.15. The 720 camera follows the recorded
floating body with `body: true` point references to keep the airborne crab prominent. The stage waits for referenced clips
before starting its clock, so a cold cache cannot delay the first action.

```sh
pnpm dev --host 127.0.0.1 --port 5357 --strictPort
node tools/cinema/qa-elf-actions.mjs --url http://127.0.0.1:5357 --out /absolute/qa.json
node tools/cinema/capture.mjs --url http://127.0.0.1:5357 \
  --program tools/cinema/tribute/program.mjs \
  --shots night-elf-toprock,night-elf-sixstep,night-elf-spin,night-elf-backflip,night-elf-clawstand,night-elf-oneclaw,night-elf-720 \
  --out /absolute/shots --size 1920x872 --dsf 2 --blur 6 --shutter 0.35
node tools/cinema/tribute/splice-elf-actions.mjs \
  --source /absolute/tribute-v14-fur.mp4 --shots /absolute/shots --out /absolute/edit
```

The browser QA checks every one of the 322 frames for visible-rig bounds within the
camera, verifies all seven actions actually play and the flip/720 complete their rotations,
checks clip windows and edit seams,
and compares every unrelated shot spec to the original. This is cinematic framing
and playback QA, not a physics-policy acceptance test. The splice script requires a
1920x1080, 24 fps source, checks exact shot/frame counts and copies its audio stream.
It writes a silent action master, full replacement edit, 72-93 s review excerpt and
before/after comparison. User-supplied media and rendered files stay outside the repo.
