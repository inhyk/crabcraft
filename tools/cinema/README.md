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
