#!/usr/bin/env node
/** Reads a V8 .cpuprofile of the world host (written by tools/profile-world-entry.mjs) plus the load-main.mjs bundle it ran,
 * and prints where the single main thread spent its time:
 * - totals (idle, GC, program, busy);
 * - buckets: each sample goes to the first matching owner on its stack (snapshot publish, tick step, persistence, network, ...);
 * - self time by source module (from esbuild's `// path` module markers) and by function;
 * - inclusive time by function (each function counted once per sample), overall and inside the snapshot/persistence buckets.
 * Usage: node tools/analyze-cpuprofile.mjs PROFILE.cpuprofile BUNDLE/load-main.mjs [--json OUT.json] [--top 30] [--focus NAME ...] */
import { readFileSync, writeFileSync } from 'node:fs';

const [profilePath, bundlePath, ...rest] = process.argv.slice(2);
if (!profilePath || !bundlePath) throw new Error('usage: analyze-cpuprofile.mjs PROFILE BUNDLE [--json OUT] [--top N]');
const opt = (name, fallback) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : fallback; };
const top = Number(opt('--top', 30)), jsonOut = opt('--json', '');
const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
const bundle = readFileSync(bundlePath, 'utf8').split('\n');

// Module ranges from esbuild's per-module comment markers (0-based line numbers, like callFrame.lineNumber).
const modules = [];
bundle.forEach((line, i) => { const m = /^\/\/ ((?:node_modules|server|src|tools|shared)\/\S+)$/.exec(line); if (m) modules.push({ start: i, name: m[1].replace(/^node_modules\/\.pnpm\/[^/]+\/node_modules\//, 'npm:') }); });
const moduleAt = line => { let lo = 0, hi = modules.length - 1, found = null; while (lo <= hi) { const mid = (lo + hi) >> 1; if (modules[mid].start <= line) { found = modules[mid]; lo = mid + 1; } else hi = mid - 1; } return found?.name ?? 'bundle-prelude'; };
// Host regions: bundle line ranges between known declarations inside createActualWorldHost.
const anchor = text => { const i = bundle.findIndex(l => l.startsWith(text)); if (i < 0) throw new Error(`bundle anchor missing: ${text}`); return i; };
const regionList = [
  ['host.startDurability', anchor('  function startDurability() {'), anchor('  function runDurability(work) {')],
  ['host.runDurability', anchor('  function runDurability(work) {'), anchor('  function startFailedSourceDrain() {')],
  ['host.retireDetached', anchor('  const retireDetached = (now) => {'), anchor('  const visible = (slot, actor, c) => {')],
  ['host.visible', anchor('  const visible = (slot, actor, c) => {'), anchor('  const publish = (slot) => {')],
  ['host.publish', anchor('  const publish = (slot) => {'), anchor('  const step = (slot) => {')],
  ['host.step', anchor('  const step = (slot) => {'), anchor('  const pump = () => {')],
  ['host.pump', anchor('  const pump = () => {'), anchor('  const ledgerStats = () => {')],
];
const regionAt = line => regionList.find(([, a, b]) => line >= a && line < b)?.[0] ?? null;

const nodes = new Map(), parent = new Map();
for (const n of profile.nodes) { nodes.set(n.id, n); for (const c of n.children ?? []) parent.set(c, n.id); }
const info = new Map();
for (const n of profile.nodes) {
  const f = n.callFrame, inBundle = f.url.endsWith('load-main.mjs');
  const module = inBundle ? moduleAt(f.lineNumber) : f.url ? f.url.replace(/^file:\/\/.*\//, '') : f.functionName.startsWith('(') ? f.functionName : 'native';
  const region = inBundle ? regionAt(f.lineNumber) : null;
  const name = f.functionName || '(anonymous)';
  info.set(n.id, { name, module, region, key: `${name} ${module}${inBundle ? ':' + (f.lineNumber + 1) : ''}`, special: ['(idle)', '(program)', '(garbage collector)', '(root)'].includes(f.functionName) ? f.functionName : null });
}
const stackCache = new Map();
const stack = id => { let s = stackCache.get(id); if (s) return s; s = []; for (let cur = id; cur !== undefined; cur = parent.get(cur)) s.push(info.get(cur)); stackCache.set(id, s); return s; };

// Sample i lasts until sample i+1 (timeDeltas[i+1]); the last sample gets the mean.
const dt = profile.timeDeltas, n = profile.samples.length, durations = new Array(n);
const meanDt = (profile.endTime - profile.startTime) / Math.max(1, n);
for (let i = 0; i < n; i++) durations[i] = (i + 1 < n ? dt[i + 1] : meanDt) / 1000;
const wallMs = (profile.endTime - profile.startTime) / 1000;

const PERSIST_MODULES = /character-store\.ts|persistence-coordinator\.ts|contribution-store\.ts|npm:pg|npm:pg-|npm:postgres-|server\/node\/db\.ts/;
const NET_MODULES = /npm:ws\/|node:net|node:internal\/stream|node:internal\/streams|node:stream|node:_http|node:internal\/http|node:http/;
function bucket(s) {
  const has = r => s.some(f => f.region === r);
  if (s[0].special === '(idle)') return 'idle';
  if (s[0].special === '(garbage collector)') return 'gc';
  if (s[0].special === '(program)') return 'program';
  if (has('host.publish') || has('host.visible')) return 'snapshot.publish';
  if (has('host.step')) return 'tick.step';
  if (has('host.startDurability') || has('host.runDurability') || has('host.retireDetached') || s.some(f => PERSIST_MODULES.test(f.module))) return 'persistence';
  if (s.some(f => /server\/world\/admission\.ts|server\/node\/accounts\.ts|characters-http\.ts/.test(f.module))) return 'admission/http';
  if (s.some(f => /server\/world\/gameplay\/intents\.ts/.test(f.module))) return 'input.decode';
  if (s.some(f => /tools\/profile-world-entry\.mjs/.test(f.module))) return 'profiling-tool';
  if (s.some(f => NET_MODULES.test(f.module))) return 'network(ws/http)';
  if (has('host.pump')) return 'pump.other';
  if (s.some(f => f.module === 'server/world/host.ts')) return 'host.other';
  return 'other';
}
const add = (map, key, ms) => map.set(key, (map.get(key) ?? 0) + ms);
const buckets = new Map(), selfFn = new Map(), selfModule = new Map(), incl = new Map(), inclByBucket = new Map(), inclModuleByBucket = new Map();
for (let i = 0; i < n; i++) {
  const s = stack(profile.samples[i]), ms = durations[i], b = bucket(s);
  add(buckets, b, ms);
  add(selfFn, s[0].key, ms); add(selfModule, s[0].module, ms);
  const seen = new Set(), seenModule = new Set();
  let ib = inclByBucket.get(b); if (!ib) inclByBucket.set(b, ib = new Map());
  let mb = inclModuleByBucket.get(b); if (!mb) inclModuleByBucket.set(b, mb = new Map());
  for (const f of s) {
    if (!seen.has(f.key)) { seen.add(f.key); add(incl, f.key, ms); add(ib, f.key, ms); }
    if (!seenModule.has(f.module)) { seenModule.add(f.module); add(mb, f.module, ms); }
  }
}
const busy = wallMs - (buckets.get('idle') ?? 0);
const sorted = map => [...map].sort((a, b) => b[1] - a[1]);
const pct = (ms, base) => (ms / base * 100).toFixed(1).padStart(5) + '%';
const line = (label, ms) => `${ms.toFixed(0).padStart(8)} ms ${pct(ms, wallMs)} wall ${pct(ms, busy)} busy  ${label}`;
const out = [];
out.push(`profile ${profilePath}`, `wall ${wallMs.toFixed(0)} ms, samples ${n}, mean interval ${(meanDt / 1000).toFixed(3)} ms, busy (non-idle) ${busy.toFixed(0)} ms = ${(busy / wallMs * 100).toFixed(1)}% of one core`);
out.push('', '== buckets (first owner on the stack) ==', ...sorted(buckets).map(([k, v]) => line(k, v)));
out.push('', '== self time by module ==', ...sorted(selfModule).slice(0, top).map(([k, v]) => line(k, v)));
out.push('', '== self time by function ==', ...sorted(selfFn).slice(0, top).map(([k, v]) => line(k, v)));
out.push('', '== inclusive time by function (all samples) ==', ...sorted(incl).filter(([k]) => !k.startsWith('(root)')).slice(0, top).map(([k, v]) => line(k, v)));
for (const b of ['snapshot.publish', 'persistence', 'tick.step', 'network(ws/http)', 'pump.other', 'other']) {
  const ib = inclByBucket.get(b), mb = inclModuleByBucket.get(b); if (!ib) continue;
  out.push('', `== inclusive inside ${b} (${(buckets.get(b) ?? 0).toFixed(0)} ms) by function ==`, ...sorted(ib).filter(([k]) => !k.startsWith('(root)')).slice(0, top).map(([k, v]) => line(k, v)));
  out.push(`-- by module --`, ...sorted(mb).filter(([k]) => k !== '(root)').slice(0, 15).map(([k, v]) => line(k, v)));
}
// --focus KEY_SUBSTRING (repeatable): for samples with a matching frame (outermost match), time by the frame directly
// below it (its callee on the sampled stack, or "(self)") and by its caller.
for (let i = 0; i < rest.length; i++) if (rest[i] === '--focus') {
  const needle = rest[i + 1], callees = new Map(), callers = new Map(); let total = 0;
  for (let j = 0; j < n; j++) {
    const s = stack(profile.samples[j]); let at = -1;
    for (let k = s.length - 1; k >= 0; k--) if (s[k].key.includes(needle)) { at = k; break; }
    if (at < 0) continue; const ms = durations[j]; total += ms;
    add(callees, at === 0 ? '(self)' : s[at - 1].key, ms); add(callers, s[at + 1]?.key ?? '(none)', ms);
  }
  out.push('', `== focus "${needle}" ${total.toFixed(0)} ms ${pct(total, wallMs)} wall: callees ==`, ...sorted(callees).slice(0, top).map(([k, v]) => line(k, v)));
  out.push('-- callers --', ...sorted(callers).slice(0, 10).map(([k, v]) => line(k, v)));
}
console.log(out.join('\n'));
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ profile: profilePath, wallMs, busyMs: busy, samples: n, buckets: Object.fromEntries(sorted(buckets)), selfModule: Object.fromEntries(sorted(selfModule).slice(0, 60)),
  selfFunction: Object.fromEntries(sorted(selfFn).slice(0, 100)), inclusive: Object.fromEntries(sorted(incl).slice(0, 150)),
  inclusiveByBucket: Object.fromEntries([...inclByBucket].map(([b, m]) => [b, Object.fromEntries(sorted(m).slice(0, 80))])),
  modulesByBucket: Object.fromEntries([...inclModuleByBucket].map(([b, m]) => [b, Object.fromEntries(sorted(m).slice(0, 40))])) }, null, 1));
