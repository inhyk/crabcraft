# Sidestep crowd video, take 4

The same Clawhaven crowd and moves as [`../sidestep`](../sidestep/README.md), cut to the fourth
take of "Sidestep (Click Clack)". Google Lyria 3.5 (model `lyria-3.5`, Gemini API, 2026-10-17)
gave four candidates for the one original prompt and original lyrics written for this project;
`../sidestep/README.md` has the prompt exactly as sent. Take 1 is the song in `../sidestep`, this
is take 4. It carries Google's SynthID audio watermark.

| File | What |
|---|---|
| `choreo.mjs` | The choreography for `make.mjs`: take 1's moves, faces, lights and shots on this take's bars (helpers shared in `../sidestep/kit.mjs`) |
| `grid.json` | The beat grid (149.995 bpm, the same tempo as take 1; bar 0 at 0.100 s, bar n at 0.100 + 1.6 n s) |
| `sidestep-a4.mp3` | The song, 256 kbps MP3 (48 kHz stereo, 166.2 s) |
| `rerender.sh` | Renders both videos with `make.mjs` |

## The song as it came out

Take 4 follows the prompt's 104-bar plan less closely than take 1. Measured from the audio
(loudness and kick per beat of the band and of the voices apart, onsets, word timestamps from a
speech-to-text pass), in grid bars:

| Section | Planned bar | Measured bar | Measured start (s) |
|---|---|---|---|
| Intro ("Sidestep!" on beats 2-3 of bar 3) | 0 | 0 | 0.10 |
| Chorus 1 | 4 | 4 | 6.50 |
| Verse 1 | 12 | 12 | 19.30 |
| Pre-chorus 1 | 20 | 20 (eight bars) | 32.10 |
| Stop | 27 | 28 (the band out the whole bar) | 44.90 |
| Chorus 2 | 28 | 29 | 46.50 |
| The chorus without voices ("Hey!" in 39 and 43) | - | 37 | 59.30 |
| Verse 2 | 36 | 44 | 70.50 |
| Pre-chorus 2 | 44 | 52 | 83.30 |
| Stop | 51 | 60 (the band out for three beats) | 96.10 |
| Chorus 3 | 52 | 61 | 97.70 |
| Bridge A | 60 | 69 (one bar) | 110.50 |
| Bridge B | 63 | 70 ("Turn it up" in 76, "Here we go!" in 77) | 112.10 |
| Breakdown | 80 | none: 78-79 with the full band, 80 a cappella | 124.90 |
| Pre-chorus 3 | 83 | 81 | 129.70 |
| Final chorus | 88 | 85 | 136.10 |
| Ending | 104 | 101: the last hit, no closing shout | 161.71 |

Bridge A and the first six bars of bridge B (69-75) are the song's longest quiet, open stretch:
the band 0.8-2.1 dB under the choruses and the kick on only 9 of its 28 beats (22 to 31 of 32 in
the choruses and verses). The song never falls silent before its end (silencedetect at -40 dB,
0.3 s finds only the tail from 163.7 s, also at the video's -14 LUFS), so `choreo.mjs` lists no
rests.

## The choreography

Take 1's moves, section for section, on the bars above: the sleepy crowd waking on the intro's
shout, the hop rippling across onto beat 4 of each chorus's fourth and eighth bars (the "Hey!"s
where this take has them), the claws flung wide on both stops, the 720 opening chorus 2, the back
flip chorus 3 and the 720 again the final chorus, the verse 2 canon, slam and hop on their lines.
Bars 37-43 get take 1's bridge B moves (dance_crab in unison, the six-step on every other row and
column with the wings around it). Night falls on bridge A, where take 1 had it at the band cut:
the crowd bows on "take a bow", the hero goes up on "arise", the lighthouse and the stage lights
come on with "Moonlight on the water", the crowd sits through bridge B and rises on "Turn it up".
The hero holds the one-claw freeze through the a cappella bar 80, and the final one-claw freeze
lands on the last hit of bar 101.

## Re-render

From the checkout root (needs ffmpeg, uv and an installed Chrome):

```sh
sh tools/crowd/sidestep-a4/rerender.sh                     # both layouts, 1920x1080 and 1080x1920
sh tools/crowd/sidestep-a4/rerender.sh --layouts land      # one layout
OUT_DIR=~/Movies/crowd SONG=path/to/master.wav sh tools/crowd/sidestep-a4/rerender.sh
```

It starts a dev server on port 5294 (`PORT`) and otherwise works as `../sidestep/rerender.sh`.
The grid comes from the audio; this take's kick lands on every beat about as hard, so the
downbeat is given (beat 0, read from where the sections, stops and lines start):

```sh
uv run --no-project --with librosa python tools/crowd/sidestep/beatgrid.py \
  tools/crowd/sidestep-a4/sidestep-a4.mp3 tools/crowd/sidestep-a4/grid.json 150 0
```
