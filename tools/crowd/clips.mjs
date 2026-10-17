// What a choreography needs to know about the game's recorded clips, read from the checkout it
// runs against (public/motions): each clip's length, its named events (take-off, landing, hit,
// beats) and, for the dances, the period and phase of their beat, measured from the motion itself
// when the clip carries no beat events. A choreography that places moves by these facts keeps
// working when the clips are re-recorded.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Decode a clip's int16 frames (src/motion/library.ts does the same in the browser). */
function decode(dir, h) {
  const buf = readFileSync(resolve(dir, h.bin));
  const raw = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
  const n = h.frameCount;
  const nj = h.joints.length;
  const q = new Float32Array(n * nj);
  for (let f = 0; f < n; f++) for (let k = 0; k < nj; k++) q[f * nj + k] = h.qOffset[k] + h.qScale[k] * raw[f * nj + k];
  const y = new Float32Array(n);
  for (let f = 0; f < n; f++) y[f] = h.baseOffset[1] + h.baseScale[1] * raw[n * nj + f * 7 + 1];
  return { q, y, n, nj };
}

/** Strongest autocorrelation peak of x between lags lo and hi (seconds), refined between frames. */
function period(x, fps, lo, hi) {
  const n = x.length;
  let mean = 0;
  for (const v of x) mean += v;
  mean /= n;
  const d = Float64Array.from(x, (v) => v - mean);
  const ac = (lag) => {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += d[i] * d[i + lag];
    return s;
  };
  const a0 = ac(0) || 1;
  let best = -1;
  let bestK = -1;
  const k0 = Math.max(1, Math.floor(lo * fps));
  const k1 = Math.ceil(hi * fps);
  const vals = [];
  for (let k = k0 - 1; k <= k1 + 1; k++) vals[k] = ac(k) / a0;
  for (let k = k0; k <= k1; k++) {
    if (vals[k] > vals[k - 1] && vals[k] >= vals[k + 1] && vals[k] > best) {
      best = vals[k];
      bestK = k;
    }
  }
  if (bestK < 0) return null;
  const [y0, y1, y2] = [vals[bestK - 1], vals[bestK], vals[bestK + 1]];
  const den = y0 - 2 * y1 + y2;
  const off = den ? (0.5 * (y0 - y2)) / den : 0;
  return { period: (bestK + off) / fps, strength: best };
}

/**
 * The beat of a dance clip: `period` (clip seconds per beat) and `phase` (a clip second that is on
 * a beat). From the clip's own `beat` events when it has them; otherwise the period from the
 * body's bob (or, failing that, the joints' speed) and the phase at the bob's lowest point.
 */
function danceBeat(dir, h) {
  const ev = h.events ?? {};
  if (ev.beat?.length > 8) {
    const b = ev.beat;
    return { period: (b[b.length - 1] - b[0]) / (b.length - 1), phase: b[0], from: 'events' };
  }
  const { q, y, n, nj } = decode(dir, h);
  const fps = h.fps;
  const a = Math.floor(((ev.policy_start?.[0] ?? 0) + 0.5) * fps);
  const z = Math.min(n, Math.floor((ev.policy_end?.[0] ?? n / fps) * fps));
  const ys = y.slice(a, z);
  const speed = new Float32Array(z - a - 1);
  for (let f = a; f < z - 1; f++) {
    let s = 0;
    for (let k = 0; k < nj; k++) s += (q[(f + 1) * nj + k] - q[f * nj + k]) ** 2;
    speed[f - a] = Math.sqrt(s) * fps;
  }
  const py = period(ys, fps, 0.3, 0.75);
  const pv = period(speed, fps, 0.3, 0.75);
  const p = py && py.strength > 0.5 ? { ...py, from: 'bob' } : pv ? { ...pv, from: 'joint speed' } : null;
  if (!p) return null;
  // Phase: fold the bob over the period and take its lowest point.
  const bins = 24;
  const sum = new Float64Array(bins);
  const cnt = new Float64Array(bins);
  for (let i = 0; i < ys.length; i++) {
    const t = (a + i) / fps;
    const b = Math.floor((((t % p.period) + p.period) % p.period) / p.period * bins) % bins;
    sum[b] += ys[i];
    cnt[b]++;
  }
  let lowest = 0;
  for (let b = 1; b < bins; b++) if (sum[b] / cnt[b] < sum[lowest] / cnt[lowest]) lowest = b;
  return { period: p.period, phase: ((lowest + 0.5) / bins) * p.period, from: p.from, strength: p.strength };
}

/**
 * Facts about every clip in <repo>/public/motions: { id: { length, fps, events, beat? } }.
 * `beat` is measured for the dances only.
 */
export function readClips(repo) {
  const dir = resolve(repo, 'public', 'motions');
  const index = JSON.parse(readFileSync(resolve(dir, 'index.json'), 'utf8'));
  const out = {};
  for (const e of index.clips) {
    const h = JSON.parse(readFileSync(resolve(dir, `${e.id}.json`), 'utf8'));
    const length = h.loop ? h.frameCount / h.fps : (h.frameCount - 1) / h.fps;
    out[e.id] = { id: e.id, kind: e.kind, length, fps: h.fps, events: h.events ?? {} };
    if (e.kind === 'dance') out[e.id].beat = danceBeat(dir, h);
  }
  return out;
}

/** First event time of `name` in a clip (throws when the clip does not have it). */
export function ev(clips, id, name) {
  const t = clips[id]?.events?.[name]?.[0];
  if (t === undefined) throw new Error(`clip ${id} has no event ${name}`);
  return t;
}
