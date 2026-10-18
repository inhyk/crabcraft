# World host load on crabcraft-1, 2026-10-18

Two measurement sessions with the same tools and the same measurement config. Run A (morning) measured fa740ec on the
VM when it was e2-medium. Run B (evening) measured dev 2aa6a51 (after #68, #101, #77 and the snapshot optimization #98)
on the VM after its resize to e2-standard-2 (2 vCPU, 7.9 GB), plus a control run of the Run A bundle (fa740ec) on the
same e2-standard-2 VM, to separate the code change from the VM change.

## Run A: fa740ec on e2-medium (morning)

Real host: `server/node/main.ts` (WORLD_ENABLED=1) bundled by `tools/load-world-actual-build.mjs` with a build-time hook copying the host's own `observe('tick'|'snapshotBatch')` samples; source files unchanged. Host on 127.0.0.1:18734 of the VM with a throwaway PG (`local-postgres.mjs`), bots on the Mac through an SSH tunnel (`tools/load-world-actual.mjs`, 30 Hz input, warrior/mage/priest, X-Forwarded-For per bot, TRUST_PROXY=1). Base commit fa740ec.

Measurement config (not a tuning recommendation): w1 fixed-slots, levels scrapling1/scavenger2/jellyfish2/echo10, population scrapling60 scavenger30 jellyfish10 shallowPatrols0, respawn 30/45/40/120 s; w2..w4 one scrapling; limits maxConnections400 perIp400 maxWaiting400; other limits default.

| run | bots | s | tick p50/p99/max ms | tick >33ms | droppedTicks | snapshotBatch p50/p99 ms | host CPU 1 core / VM2 | VM busy | RSS MB | bytes/s per bot mean/p95 | snapshot Hz | kills/deaths | closes | prod/dev healthz |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| r1 | 25 | 90 | 4.00 / 9.91 / 18.6 | 0 | 0 | 30.1 / 62.8 | 99.5% / 49.7% | 56.8% | 328-345 | 148k / 220k | 13.7 | 89/11 | 8 (1008 invalid-input) | 200/200 x90 |
| r2 | 50 | 90 | 5.43 / 131.7 / 166.7 | 25 | 863 | 84.8 / 234.4 | 110.6% / 55.3% | 61.3% | 359-360 | 80k / 86k | 4.2 | 68/2 | 2 (reconnected) | 200/200 x83 |

The 100-bot run was not executed (usage limit). Verdict against decision 10: at 50 bots tick p99 131.7 ms > 10 ms and VM CPU 61.3% > 60%; the single Node host thread is saturated from 25 bots, dominated by snapshotBatch.

Finding: after respawn the host rebinds the stream (`bootstrap` in host.ts tick loop); an input already in flight on the old binding is rejected and the socket closed 1008 `invalid-input`.

## Run B: dev 2aa6a51 on e2-standard-2 (evening), with a fa740ec control

VM: `e2-standard-2`, cpu-platform `Intel Broadwell` (`Intel(R) Xeon(R) CPU @ 2.20GHz`, 2 threads on 1 core), Node 24.22.0,
throwaway PG 16 under `/tmp/crabcraft-load-20261018193124/`, host on 127.0.0.1:18734, stats on 127.0.0.1:18735. The live
prod (8080) and dev (8081, server world on) servers kept running and were polled every second through the tunnel; every
sample was 200/200. Bots on the Mac through one SSH tunnel, `--warmup 25 --per-worker 5`, 30 Hz input. The CPU platform of
the Run A e2-medium VM was not recorded, so the platform difference between A and B is unverified.

Tool changes for the current host: the launcher config adds the now-required `victimOutcome` (1024 / 4194304 / 3000 ms)
and `chat` (`maxPending` 16), values copied from `deploy/vm/world-dev.json`; the stats endpoint reports
`connections`/`actors`/`waiting` as current values instead of deltas (Run A's log showed `conn -3` for that reason). The
two `host.ts` build-hook anchors still match unchanged. Each run waited for `actors` 0 (the previous run's 30 s reconnect
grace) before starting.

| run | code | bots | s | ticks run / due | tick p50/p99/max ms | tick >10 / >33 ms | droppedTicks | snapshotBatch n, p50/p99/max ms | snapshot Hz | host CPU 1 core / VM2 | VM busy | RSS MB | bytes/s per bot mean/p95 | kills/deaths | closes | event-loop delay p99/max ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| B1 | 2aa6a51 | 25 | 90 | 2075 / 2700 | 5.69 / 12.38 / 25.5 | 93 / 0 | 469 | 670, 53.7 / 102.1 / 150.9 | 7.46 | 105.3% / 52.7% | 65.7% | 333-404 | 101k / 113k | 112/1 | 0 | 96.8 / 201.5 |
| B2 | 2aa6a51 | 50 | 90 | 1027 / 2700 | 8.95 / 24.73 / 56.8 | 258 / 4 | 1498 | 212, 125.0 / 191.1 / 226.3 | 2.37 | 104.6% / 52.3% | 69.7% | 408-430 | 65k / 71k | 73/2 | 0 | 202.8 / 373.6 |
| B3 | 2aa6a51 | 100 | 60 | 165 / 1800 | 18.41 / 47.32 / 65.2 | 165 / 32 | 1595 | 36, 317.6 / 371.8 / 372.2 | 0.60 | 111.2% / 55.6% | 74.5% | 443-466 | 20k / 21k | 0/0 | 0 | 498.1 / 966.8 |
| C1 | fa740ec | 25 | 90 | 2428 / 2700 | 5.57 / 12.16 / 29.3 | 86 / 0 | 77 | 725, 62.8 / 134.6 / 176.8 | 8.05 | 105.7% / 52.9% | 64.1% | 362-402 | 98k / 117k | 112/8 | 6 (1008 invalid-input) | 117.7 / 272.1 |

B3 was shortened to 60 s because B2 already failed. In B3 the host neutralized 69 inputs (`neutralizations`), no bot
pressed an ability (bots act on a 0.6 Hz view) and no damage was dealt, so B3 measures the host's ceiling, not play.
Steal time was 0.03-0.13% in every run. Health of prod/dev: 200/200 in all 89 + 90 + 58 + 90 samples.

### Before/after

| | A r1 fa740ec e2-medium | C1 fa740ec e2-standard-2 | B1 2aa6a51 e2-standard-2 | A r2 fa740ec e2-medium | B2 2aa6a51 e2-standard-2 | B3 2aa6a51 e2-standard-2 |
|---|---|---|---|---|---|---|
| bots | 25 | 25 | 25 | 50 | 50 | 100 |
| ticks run (of 2700 in 90 s) | 2658 | 2428 | 2075 | 1609 | 1027 | 165 of 1800 in 60 s |
| tick p50/p99 ms | 4.00 / 9.91 | 5.57 / 12.16 | 5.69 / 12.38 | 5.43 / 131.7 | 8.95 / 24.73 | 18.41 / 47.32 |
| droppedTicks | 0 | 77 | 469 | 863 | 1498 | 1595 |
| snapshotBatch p50/p99 ms | 30.1 / 62.8 | 62.8 / 134.6 | 53.7 / 102.1 | 84.8 / 234.4 | 125.0 / 191.1 | 317.6 / 371.8 |
| snapshot Hz | 13.7 | 8.05 | 7.46 | 4.2 | 2.37 | 0.60 |
| host CPU 1 core | 99.5% | 105.7% | 105.3% | 110.6% | 104.6% | 111.2% |
| VM busy | 56.8% | 64.1% | 65.7% | 61.3% | 69.7% | 74.5% |
| 1008 invalid-input closes | 8 (11 deaths) | 6 (8 deaths) | 0 (1 death) | 2 | 0 (2 deaths) | 0 (0 deaths) |

Reading:
- The same fa740ec bundle is about twice as slow per snapshot batch on today's e2-standard-2 (C1 65.0 ms mean, 47.1 s over
  725 batches) as on the morning e2-medium (A r1 32.4 ms mean, 50.4 s over 1553 batches). The host is single-threaded, so a
  second vCPU does not help it; per-thread speed of this Broadwell instance decides. The morning platform is unknown.
- Same VM, 25 bots, new against old code: snapshotBatch p50 -14% (62.8 to 53.7 ms), p99 -24% (134.6 to 102.1 ms), mean per
  batch 65.0 to 56.6 ms. #98 helps per batch, but B1 ran fewer ticks (2075 against 2428) and fewer batches (670 against
  725) at the same CPU: tick plus snapshotBatch took 50.9 s of the 90 s against 61.9 s for C1, so about 11 s more of the
  main thread goes to work outside those two timers (not profiled; persistence wall time per run was 29.8 s against 16.7 s).
- Respawn rebinding: C1 reproduced the old 6 closes `1008 invalid-input` on 8 deaths. Dev had 3 deaths over B1 and B2, 0
  closes, and `discardedRevokedFrames` 2 + 2, so the in-flight old-binding frame is now discarded instead of closing the
  socket. Three deaths is a small sample.
- tick p99 only covers ticks that ran; dropped ticks are not in it.

Verdict against decision 10 (tick p99 under 10 ms and CPU under 60% on the VM): fails at 25, 50 and 100 bots. tick p99
12.4 / 24.7 / 47.3 ms, VM busy 65.7 / 69.7 / 74.5%, and from 25 bots the single host thread is saturated (CPU 105% of one
core, 469 dropped ticks, 7.5 Hz snapshots against the 20 Hz target). The 2-vCPU resize does not lift the per-thread limit.

Raw results: `r1-25bots.*`, `r2-50bots.*`, `r3-100bots.*`, `c1-fa740ec-25bots.*`, `host.log`, `host-fa740ec.log` in the
measuring session's scratchpad `vm/` directory (not committed).
