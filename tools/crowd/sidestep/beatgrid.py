# Beat grid for a constant-tempo song: onset envelope, the best period near a prior tempo and the
# best phase, the downbeat from the kick energy per beat position, and the loudness and kick per
# bar to help read the sections. Writes the grid JSON tools/crowd/make.mjs reads (no audio).
#
#   uv run --no-project --with librosa python tools/crowd/sidestep/beatgrid.py \
#     tools/crowd/sidestep/sidestep.mp3 tools/crowd/sidestep/grid.json 150 [downbeat]
#
# `downbeat` (0-3) says which of the first four beats starts bar 0, for a mix whose kick lands on
# every beat about as hard (the profile it prints is then nearly flat): read the bar line from the
# arrangement (where the sections, the stops and the sung lines start) and pass it.
import json, sys
import numpy as np
import librosa

path, out = sys.argv[1], sys.argv[2]
prior = float(sys.argv[3]) if len(sys.argv) > 3 else 150.0
y, sr = librosa.load(path, sr=22050, mono=True)
dur = len(y) / sr
hop = 128
env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop, aggregate=np.median)
# low band (kick) envelope
S = np.abs(librosa.stft(y, n_fft=2048, hop_length=hop))
freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
low = S[(freqs >= 30) & (freqs <= 120)].sum(axis=0)
lowd = np.maximum(0, np.diff(low, prepend=low[0]))
fr = sr / hop


def score(period, phase, e):
    ts = np.arange(phase, dur, period)
    idx = np.round(ts * fr).astype(int)
    idx = idx[idx < len(e)]
    return e[idx].sum()


best = None
for bpm in np.arange(prior - 1.0, prior + 1.0, 0.005):
    p = 60 / bpm
    for ph in np.arange(0, p, 0.002):
        s = score(p, ph, env)
        if best is None or s > best[0]:
            best = (s, bpm, ph)
_, bpm, ph = best
period = 60 / bpm
beats = np.arange(ph, dur, period)
# downbeat: which of the 4 beat positions carries the most kick energy over the song
idx = np.round(beats * fr).astype(int)
idx = idx[idx < len(lowd)]
k = np.array([lowd[max(0, i - 2): i + 3].max() for i in idx])
pos = [k[j::4].mean() for j in range(4)]
d0 = int(sys.argv[4]) if len(sys.argv) > 4 else int(np.argmax(pos))
downbeats = beats[d0::4]
# energy per bar (rms) to help section reading
rms = librosa.feature.rms(y=y, hop_length=hop)[0]
bars = []
for i, t in enumerate(downbeats):
    a, b = int(t * fr), int(min(dur, t + 4 * period) * fr)
    bars.append({'i': i, 't': round(float(t), 4), 'rms': round(float(rms[a:b].mean()), 4), 'kick': round(float(lowd[a:b].mean()), 2)})
json.dump({'bpm': round(float(bpm), 4), 'beat': round(float(period), 6), 'phase': round(float(ph), 4), 'downbeatIndex': d0,
           'beats': [round(float(b), 4) for b in beats], 'downbeats': [round(float(b), 4) for b in downbeats], 'duration': round(dur, 3), 'bars': bars},
          open(out, 'w'), indent=None)
print('bpm', bpm, 'phase', ph, 'downbeat pos', d0, pos, 'first downbeats', downbeats[:6])
for b in bars:
    print(b['i'], b['t'], b['rms'], b['kick'])
