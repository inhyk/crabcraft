# Tidecrown city portrait

A 96-second film in twelve shots, captured from the actual Tidecrown city. Dawn,
day, sunset and night cover the Bridge of Six Shells, Pincer Gate, market,
rooftops, cathedral, canal, harbour, Crownshell Keep and Seaglass Quarter.
The bridge, gate and canal use low FPV flights; the other shots use slower aerial
camera moves. Korean place titles accompany an original synthesized score, with
no narration or downloaded soundtrack.

The lighting presets are film staging, not a gameplay day/night system. They
change the sky, sunlight, moon/stars, fog, water and reflection environment only
in the capture page. The map, architecture and game source are unchanged. The
existing cinema stage hides the player's crab, residents and HUD. The production
app does not import these tools.

## Reproduce

Use pnpm 10, Node, Python 3 with numpy and Pillow, ffmpeg, and the project's
Chrome for Testing/Chromium launcher. The edit's Korean titles use Arial Unicode
MS (available on the authoring Mac); adjust the font paths in `title_movie()`
when editing on another system. Titles render as a transparent movie through
Pillow, so ffmpeg does not need libass or drawtext. An ASS copy is also saved.

```sh
npx -y pnpm@10.10.0 install --frozen-lockfile
npx -y pnpm@10.10.0 dev --host 127.0.0.1 --port 5379 --strictPort

# Run the following from this worktree in another terminal.
# Keep rendered media outside the repository.
FILM_OUT=/absolute/path/tidecrown-film
node tools/cinema/tidecrown/capture.mjs --audit --size 640x360 --out "$FILM_OUT/audit"
node tools/cinema/tidecrown/capture.mjs --stills --size 1280x720 --out "$FILM_OUT/stills"
node tools/cinema/tidecrown/capture.mjs --size 1920x1080 --dsf 1.5 --out "$FILM_OUT/shots"
python3 tools/cinema/tidecrown/edit.py --work "$FILM_OUT"
```

`--url` selects another dev server. `--shots 05-cathedral,06-canal-run` recaptures
only named shots. Do not run two captures into the same output folder. Recording
defaults to 24 fps; the editor requires 24 fps. DSF 1.5 captures 2880x1620 frames
which the edit downsamples to 1920x1080. `--stills` writes five views per shot;
`--audit` checks all 2,304 camera positions and a 0.25-unit cross around each
against the live city's height-aware collision solids. This checks the camera
path, not every visible triangle or an in-game aircraft physics model.

The capture fails on page errors, repaired blank frames, wrong frame counts,
an off-clock first frame, and cameras below ground. Each take has a JSON sidecar
with frame times, camera positions, ground clearance and draw statistics. The
editor rejects incomplete/error-containing sidecars and writes:

- `tidecrown-1080p.mp4`: H.264, 24 fps, AAC stereo, faststart.
- `tidecrown-720p.mp4`: smaller sharing copy.
- `original-score.wav`: original deterministic pad, bell and percussion score.
- `titles.ass`: editable Korean place titles and English flight/time labels.

Inspect actual exported frames and the complete decode before delivering. The
opening 1.2 s and closing 1.6 s intentionally fade from/to black.
