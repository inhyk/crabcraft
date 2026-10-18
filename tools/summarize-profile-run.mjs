#!/usr/bin/env node
/** Prints the host-side numbers of one tools/load-world-actual.mjs result run against tools/profile-world-entry.mjs:
 * observed timers (sum, p50, p99), barrier reasons, pg statements per barrier, GC, entities per snapshot and per recipient.
 * Usage: node tools/summarize-profile-run.mjs RESULT.json */
import { readFileSync } from 'node:fs';

const r = JSON.parse(readFileSync(process.argv[2], 'utf8')), f = r.final, x = f.extra, s = r.summary ?? {};
const sec = f.windowMs / 1000, f1 = v => Number(v).toFixed(1), f2 = v => Number(v).toFixed(2);
console.log(`window ${f1(sec)} s, bots ${r.args.bots}, health samples ${r.health.length} non-200 ${r.health.filter(h => h.codes.some(c => c !== 200)).length}`);
console.log(`host CPU one core ${f1(s.hostCpuPctOneCore)}%, VM busy ${f1(s.vmCpuBusyPct ?? NaN)}%, ticks ${f.counters.ticks}, dropped ticks ${f.counters.droppedTicks}, dropped snapshots ${f.counters.droppedSnapshots}, snapshots/recipient Hz ${f2(f.counters.snapshots / f.counters.connections / sec)}`);
console.log('timer               n      sum ms  %wall    p50     p99     max');
for (const [k, v] of Object.entries(f.observed)) console.log(`${k.padEnd(18)} ${String(v.count).padStart(6)} ${f1(v.sum).padStart(10)} ${f1(v.sum / f.windowMs * 100).padStart(6)} ${f2(v.p50).padStart(7)} ${f2(v.p99).padStart(7)} ${f2(v.max).padStart(7)}`);
console.log(`event-loop delay p50/p99/max ${f2(f.eventLoopDelayMs.p50)} / ${f2(f.eventLoopDelayMs.p99)} / ${f2(f.eventLoopDelayMs.max)} ms`);
const barriers = x.barriersStarted;
console.log(`barriers started ${barriers} (${f2(barriers / sec)}/s), actors per barrier mean ${f1(x.barrierActors.mean)}, reasons from tick: ${JSON.stringify(x.barrierReasons)}`);
console.log(`pg total ${x.pgTotal.count} queries (${f1(x.pgTotal.count / sec)}/s, ${f1(x.pgTotal.count / Math.max(1, barriers))}/barrier), wall sum ${f1(x.pgTotal.ms)} ms, param bytes ${x.pgTotal.paramBytes}`);
for (const [k, v] of Object.entries(x.pg).slice(0, 14)) console.log(`  ${String(v.count).padStart(6)} q ${f1(v.ms).padStart(9)} ms  mean ${f2(v.ms / v.count)} max ${f2(v.maxMs)}  params ${Math.round(v.paramBytes / v.count)} B/q  ${k}`);
console.log(`GC total ${f1(x.gcTotalMs)} ms (${f1(x.gcTotalMs / f.windowMs * 100)}% wall): ${Object.entries(x.gc).map(([k, v]) => `${k} ${v.count}x ${f1(v.ms)} ms max ${f2(v.maxMs)}`).join(', ')}`);
const sn = x.snapshots, rc = x.recipients;
console.log(`per snapshot (${sn.count}): units mean ${f1(sn.units.mean)} max ${sn.units.max}, players ${f1(sn.players.mean)}, projectiles ${f1(sn.projectiles.mean)} max ${sn.projectiles.max}, events ${f1(sn.events.mean)} p99 ${sn.events.p99}`);
console.log(`per recipient (${rc.count}): visible mean ${f1(rc.visible.mean)} p50 ${rc.visible.p50} max ${rc.visible.max}, bytes mean ${Math.round(rc.bytes.mean)} p99 ${rc.bytes.p99}, chunks mean ${f2(rc.chunks.mean)}`);
console.log(`bytes sent ${f.counters.bytesSent} (${f1(f.counters.bytesSent / sec / 1e6)} MB/s), profile ${JSON.stringify(x.profile)}`);
