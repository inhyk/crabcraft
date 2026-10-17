# Sidestep crowd video

The Clawhaven crowd (340 game crabs and a hero in front, on a dance deck on the bay) dancing in
unison to "Sidestep (Click Clack)". Every move is a recorded clip of a trained Jumper policy from
`public/motions`; `tools/crowd/make.mjs` captures the crowd scene frame by frame and lays the song
under it.

| File | What |
|---|---|
| `choreo.mjs` | The choreography: a `build()` for `make.mjs` that places every move, face, light and camera shot on the song's bars |
| `grid.json` | The beat grid of the song (149.995 bpm, bar 0 at 0.122 s, bar n at 0.122 + 1.6 n s) |
| `beatgrid.py` | Makes `grid.json` from the audio |
| `sidestep.mp3` | The song, 256 kbps MP3 (48 kHz stereo, 167.6 s) |
| `rerender.sh` | Renders both videos with `make.mjs` |

## The song

"Sidestep (Click Clack)" was generated with Google Lyria 3.5 (model `lyria-3.5`) via the Gemini API
on 2026-10-17, from the original prompt and original lyrics below, written for this project. Of
four candidates, this is the first. It carries Google's SynthID audio watermark.

The prompt, exactly as sent:

```text
"Sidestep (Click Clack)": a brand-new, original, high-energy pop-rock party anthem with chart-topping, radio-ready production. 150 BPM, 4/4, bright major key. Driving palm-muted and distorted electric guitars, tight punchy live drums, round bass guitar, crisp handclaps, shout-along gang vocals, a glossy modern pop mix with the energy of 2000s pop-punk and the polish of modern K-pop. A duet: a bright, airy female lead vocal trading lines with a charismatic, soulful male lead vocal; both sing every chorus together over a crowd of gang vocals. Playful, cheeky and irresistible, built for a huge crowd dancing in unison. English lyrics. Every section starts exactly on a bar line (one bar = 1.6 s). Total length 2:48, ending on a hard stop.

[0:00 - 0:06.4] Intro: four bars. A catchy muted electric guitar riff alone, handclaps on beats 2 and 4, a female voice says "One, two... ready?", the whole crowd shouts "Sidestep!" on the last beat.
[0:06.4 - 0:19.2] Chorus 1: eight bars, the full band drops in with a four-on-the-floor kick, both lead vocals and the gang vocals, a shouted "Hey!" at the end of bars 4 and 8.
[0:19.2 - 0:32.0] Verse 1: eight bars, drums tighten to a bouncy groove, female lead first, male lead answers.
[0:32.0 - 0:43.2] Pre-chorus 1: seven bars, a rising build, snare rolls, the vocals climb.
[0:43.2 - 0:44.8] Stop: one bar, the band cuts out completely, the two voices sing one line a cappella.
[0:44.8 - 0:57.6] Chorus 2: eight bars, full energy, shouted "Hey!" at the end of bars 4 and 8.
[0:57.6 - 1:10.4] Verse 2: eight bars, male lead first, female lead answers, a playful talk-sung line in the last bar.
[1:10.4 - 1:21.6] Pre-chorus 2: seven bars, rising build.
[1:21.6 - 1:23.2] Stop: one bar, band out, one a cappella line.
[1:23.2 - 1:36.0] Chorus 3: eight bars, full energy.
[1:36.0 - 1:40.8] Bridge A: three bars, half-time drums, a spoken call from the male voice.
[1:40.8 - 2:08.0] Bridge B: seventeen bars, a new melody over a steady beat that slowly builds, a big drum fill in the last bar.
[2:08.0 - 2:12.8] Breakdown: three bars, no kick drum, only guitar chords, handclaps and whispered vocals.
[2:12.8 - 2:20.8] Pre-chorus 3: five bars, the build returns faster.
[2:20.8 - 2:46.4] Final chorus: sixteen bars, a key change up one whole step, the biggest gang vocals, every shouted "Hey!" doubled.
[2:46.4 - 2:48.0] Ending: everyone shouts "Sidestep!" on the downbeat, then a hard stop.

Lyrics:

[Intro]
One, two... ready?
Sidestep!

[Chorus]
Click-clack, side to side
Claws up, ride the tide
Click-clack, left and right
Nobody walks a straight line tonight (Hey!)
Click-clack, side to side
Shells on, shining bright
Click-clack, left and right
Everybody sidestep, one more time (Hey!)

[Verse 1]
Low tide on the boardwalk, neon on the bay
Got my red shell polished, gonna dance the night away
You walk forward, baby, that's a little old
We go sideways, honey, that's the way we roll
Feel the dock get louder, feel the planks go boom
Three hundred little dancers in a moonlit room
Lighthouse on the corner throwing light around
Nobody here is leaving till the sun comes down

[Pre-Chorus]
Hold your breath (hold it), dig your toes in deep
Here's the wave (coming), no one's gonna sleep
Lift your claws up higher, let the lighthouse spin
On the count of three, let the tide come in

[Stop]
Step... to... the side!

[Chorus]
Click-clack, side to side
Claws up, ride the tide
Click-clack, left and right
Nobody walks a straight line tonight (Hey!)
Click-clack, side to side
Shells on, shining bright
Click-clack, left and right
Everybody sidestep, one more time (Hey!)

[Verse 2]
Twist it like a tornado, flip it like a coin
Two full turns up in the air, and we land right on the point
Back flip off the railing, nobody falls down
Loudest little army in the whole seaside town
Left claw, right claw, front row, back row
Everybody knows it now, everybody let go
Sun's already rising and we're not done yet
Shake it, shake it, shake it like you're soaking wet

[Pre-Chorus]
Hold your breath (hold it), dig your toes in deep
Here's the wave (coming), no one's gonna sleep
Lift your claws up higher, let the lighthouse spin
On the count of three, let the tide come in

[Stop]
Step... to... the side!

[Chorus]
Click-clack, side to side
Claws up, ride the tide
Click-clack, left and right
Nobody walks a straight line tonight (Hey!)
Click-clack, side to side
Shells on, shining bright
Click-clack, left and right
Everybody sidestep, one more time (Hey!)

[Bridge A]
Everybody freeze... take a bow... now rise!

[Bridge B]
Moonlight on the water, starlight on the shell
Every little heartbeat ringing like a bell
If the world goes forward, we can let it go
We were never made to walk the way they show
Moonlight on the water, starlight on the shell
Every little heartbeat ringing like a bell
Turn it up, turn it up, turn it up, turn it up
Here we go!

[Breakdown]
(whispered) Click... clack... side to side...
(whispered) Click... clack... here we go...

[Pre-Chorus]
Lift your claws up higher, let the lighthouse spin
On the count of three, let the tide come in

[Final Chorus]
Click-clack, side to side
Claws up, ride the tide
Click-clack, left and right
Nobody walks a straight line tonight (Hey! Hey!)
Click-clack, side to side
Shells on, shining bright
Click-clack, left and right
Everybody sidestep, one more time (Hey! Hey!)
Click-clack, side to side
Claws up, ride the tide
Click-clack, left and right
Nobody walks a straight line tonight (Hey! Hey!)
Click-clack, side to side
Shells on, shining bright
Click-clack, left and right
Everybody sidestep, one more time!

[Ending]
Sidestep!
```

### The song as it came out

The prompt planned 104 bars of 1.6 s. The audio follows that plan bar for bar up to the end of
bridge B's beat, then runs two bars short. Measured from the audio (loudness and kick energy per
beat, onsets, word timestamps from a speech-to-text pass), in grid bars:

| Section | Planned bar | Measured bar | Measured start (s) |
|---|---|---|---|
| Intro | 0 | 0 | 0.12 |
| Chorus 1 | 4 | 4 | 6.52 |
| Verse 1 | 12 | 12 | 19.32 |
| Pre-chorus 1 | 20 | 20 | 32.12 |
| Stop | 27 | 27 (band out for two beats) | 43.32 |
| Chorus 2 | 28 | 28 | 44.92 |
| Verse 2 | 36 | 36 | 57.72 |
| Pre-chorus 2 | 44 | 44 | 70.52 |
| Stop | 51 | 51 (band out for two beats) | 81.72 |
| Chorus 3 | 52 | 52 | 83.32 |
| Bridge A | 60 | 60 (drums back in 62) | 96.13 |
| Bridge B | 63 | 63 | 100.93 |
| Band cut, "Here we go!" | (drum fill in 79) | 77 | 123.33 |
| Breakdown (whispers) | 80 | 80 | 128.13 |
| Pre-chorus 3 | 83 | 83 (three bars) | 132.93 |
| Final chorus | 88 | 86 | 137.73 |
| "Sidestep!" and the stop | 104 | 102 | 163.33 |

The song falls silent for a moment three times before its end (silencedetect at -40 dB, 0.3 s):
in the breaths of the intro (1.3 s and 2.6 s) and after "Here we go!" (125.9 s). `choreo.mjs`
lists them as `quiet`, so `make.mjs` does not count them as gaps. After the closing shout the song
is silent from 165.3 s.

## Re-render

From the checkout root (needs ffmpeg, uv and an installed Chrome):

```sh
sh tools/crowd/sidestep/rerender.sh                     # both layouts, 1920x1080 and 1080x1920
sh tools/crowd/sidestep/rerender.sh --layouts land      # one layout
sh tools/crowd/sidestep/rerender.sh --reuse             # keep shots already captured and unchanged
OUT_DIR=~/Movies/crowd SONG=path/to/master.wav sh tools/crowd/sidestep/rerender.sh
```

It starts a dev server on port 5293 (`PORT`), captures each shot in two pages per layout, joins
them, normalises the song to -14 LUFS (true peak -1.5 dBTP), encodes H.264 high + AAC 256 kbps at
60 fps and writes contact sheets and `report.json` (specs, loudness, silences, black frames,
capture repairs). The choreography reads the clips' events and tempo when it runs, so a re-render
after the clips are re-recorded keeps every move on the beat.

The grid comes from the audio:

```sh
uv run --no-project --with librosa python tools/crowd/sidestep/beatgrid.py \
  tools/crowd/sidestep/sidestep.mp3 tools/crowd/sidestep/grid.json 150
```
