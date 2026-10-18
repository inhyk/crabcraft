# World host load on crabcraft-1, 2026-10-18

Three measurement sessions with the same tools and the same measurement config. Run A (morning) measured fa740ec on the
VM when it was e2-medium. Run B (evening) measured dev 2aa6a51 (after #68, #101, #77 and the snapshot optimization #98)
on the VM after its resize to e2-standard-2 (2 vCPU, 7.9 GB), plus a control run of the Run A bundle (fa740ec) on the
same e2-standard-2 VM, to separate the code change from the VM change. Run D (night) repeats Run B with the same two
bundles after the VM was switched to c2d-standard-2 (AMD Milan), so the CPU is the only change.

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
| B1b | 2aa6a51 | 25 | 90 | 1999 / 2700 | 5.74 / 12.90 / 30.8 | 91 / 0 | 526 | 604, 57.6 / 128.6 / 143.6 | 6.72 | 105.7% / 52.9% | 66.5% | 324-327 | 102k / 115k | 125/5 | 0 | 97.3 / 211.0 |
| C1 | fa740ec | 25 | 90 | 2428 / 2700 | 5.57 / 12.16 / 29.3 | 86 / 0 | 77 | 725, 62.8 / 134.6 / 176.8 | 8.05 | 105.7% / 52.9% | 64.1% | 362-402 | 98k / 117k | 112/8 | 6 (1008 invalid-input) | 117.7 / 272.1 |

B3 was shortened to 60 s because B2 already failed. In B3 the host neutralized 69 inputs (`neutralizations`), no bot
pressed an ability (bots act on a 0.6 Hz view) and no damage was dealt, so B3 measures the host's ceiling, not play.
Steal time was 0.03-0.13% in every run. Health of prod/dev: 200/200 in all 89 + 90 + 58 + 90 + 90 samples.

Dev restarts: the dev server (8081) restarted at 19:33:10 KST for PR #104 (merged 10:32:23Z). B1 started 27 s later
(19:33:37, measurement from about 19:34:07), so its warm-up overlapped the dev startup minute although no health sample
failed; B1b repeats it at 19:49:39 with dev unchanged since 19:33:10 and agrees with B1. B2 (19:36:16), B3 (19:38:49),
C1 (19:43:03) and B1b started more than 3 minutes after that restart. The dev push 08b1ce2 (deploy run 10:44:57Z to
10:45:51Z) did not restart the dev process; it may have touched the VM in the last seconds of C1 (ended 19:45:03).

### Before/after

| | A r1 fa740ec e2-medium | C1 fa740ec e2-standard-2 | B1 / B1b 2aa6a51 e2-standard-2 | A r2 fa740ec e2-medium | B2 2aa6a51 e2-standard-2 | B3 2aa6a51 e2-standard-2 |
|---|---|---|---|---|---|---|
| bots | 25 | 25 | 25 | 50 | 50 | 100 |
| ticks run (of 2700 in 90 s) | 2658 | 2428 | 2075 / 1999 | 1609 | 1027 | 165 of 1800 in 60 s |
| tick p50/p99 ms | 4.00 / 9.91 | 5.57 / 12.16 | 5.69 / 12.38, 5.74 / 12.90 | 5.43 / 131.7 | 8.95 / 24.73 | 18.41 / 47.32 |
| droppedTicks | 0 | 77 | 469 / 526 | 863 | 1498 | 1595 |
| snapshotBatch p50/p99 ms | 30.1 / 62.8 | 62.8 / 134.6 | 53.7 / 102.1, 57.6 / 128.6 | 84.8 / 234.4 | 125.0 / 191.1 | 317.6 / 371.8 |
| snapshot Hz | 13.7 | 8.05 | 7.46 / 6.72 | 4.2 | 2.37 | 0.60 |
| host CPU 1 core | 99.5% | 105.7% | 105.3% / 105.7% | 110.6% | 104.6% | 111.2% |
| VM busy | 56.8% | 64.1% | 65.7% / 66.5% | 61.3% | 69.7% | 74.5% |
| 1008 invalid-input closes | 8 (11 deaths) | 6 (8 deaths) | 0 (1 death) / 0 (5 deaths) | 2 | 0 (2 deaths) | 0 (0 deaths) |

Reading:
- The same fa740ec bundle is about twice as slow per snapshot batch on today's e2-standard-2 (C1 65.0 ms mean, 47.1 s over
  725 batches) as on the morning e2-medium (A r1 32.4 ms mean, 50.4 s over 1553 batches). The host is single-threaded, so a
  second vCPU does not help it; per-thread speed of this Broadwell instance decides. The morning platform is unknown.
- Same VM, 25 bots, new against old code: snapshotBatch p50 -14% / -8% (62.8 to 53.7 / 57.6 ms in B1 / B1b), p99 -24% / -4%
  (134.6 to 102.1 / 128.6 ms), mean per batch 65.0 to 56.6 / 60.1 ms. #98 helps per batch, but B1 ran fewer ticks (2075
  and 1999 against 2428) and fewer batches (670 and 604 against 725) at the same CPU: tick plus snapshotBatch took 50.9 s of the 90 s against 61.9 s for C1, so about 11 s more of the
  main thread goes to work outside those two timers (not profiled; persistence wall time per run was 29.8 s against 16.7 s).
- Respawn rebinding: C1 reproduced the old 6 closes `1008 invalid-input` on 8 deaths. Dev had 8 deaths over B1, B2 and
  B1b, 0 closes, and `discardedRevokedFrames` 2 + 2 + 7: the in-flight frame on the revoked binding is now discarded
  (`host.ts` revoked-binding branch) instead of closing the socket.
- tick p99 only covers ticks that ran; dropped ticks are not in it.

Verdict against decision 10 (tick p99 under 10 ms and CPU under 60% on the VM): fails at 25, 50 and 100 bots. tick p99
12.4-12.9 / 24.7 / 47.3 ms, VM busy 65.7-66.5 / 69.7 / 74.5%, and from 25 bots the single host thread is saturated (CPU
105% of one core, 469-526 dropped ticks, 6.7-7.5 Hz snapshots against the 20 Hz target). The 2-vCPU resize does not lift the per-thread limit.

Raw results: `r1-25bots.*`, `r1b-25bots.*`, `r2-50bots.*`, `r3-100bots.*`, `c1-fa740ec-25bots.*`, `host.log`,
`host-r1b.log`, `host-fa740ec.log` in the
measuring session's scratchpad `vm/` directory (not committed).

## Run D: dev 2aa6a51 on c2d-standard-2 (night), with a fa740ec control

VM: `c2d-standard-2`, cpu-platform `AMD Milan` (`AMD EPYC 7B13`, 2 threads on 1 core), 7.9 GB, Node 24.22.0, throwaway
PG 16 under `/tmp/crabcraft-load-20261018202325/`, host on 127.0.0.1:18734, stats on 127.0.0.1:18735. The VM had booted
at about 20:21 KST after the switch (dev process started 20:21:03, prod 20:22:29 for the main deploy c163124, v1.0.2
with migration 007, Deploy run 39122772503 attempt 2, finished 11:22:54Z; prod `/version.json` read 1.0.2 at 20:44). Neither process restarted during the runs (start times checked at 20:31, 20:33 and 20:41); the first
run started at 20:24:06. Health of prod/dev: 200/200 in all 89 + 87 + 60 + 90 + 87 + 90 + 90 samples.

Same bundles as Run B, not rebuilt: dev `load-bundle.tgz` (2aa6a51 with the tools of b060ee4) sha256
`878175626c271ccb08f08952757ec6825815d6f2afc3090d948226c68f235d67`, and the Run A bundle (fa740ec) sha256
`cd74c93d8edd58323d5fd748a83ec8e8fd88d7252bc0d9b4924fa28594f94228`; the VM copies had the same hashes. Dev bots ran from this worktree
(fa84cb8 tools, 2aa6a51 source), control bots from `.worktrees/ops-world-load` (c6e5cca, fa740ec source) as for C1.
D1, D2, D3 shared one host process; C2 had its own; D4, D1b and D5 shared a fresh dev host. Each run waited for `actors` 0.
D4 (35 bots) and D5 (30 bots) were added to locate the decision 10 limit.

| run | code | bots | s | ticks run / due | tick p50/p99/max ms | tick >10 / >33 ms | droppedTicks | snapshotBatch n, p50/p99/max ms | snapshot Hz | host CPU 1 core / VM2 | VM busy | RSS MB | bytes/s per bot mean/p95 | kills/deaths | closes | event-loop delay p99/max ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| D1 | 2aa6a51 | 25 | 90 | 2628 / 2700 | 3.15 / 6.92 / 25.9 | 8 / 0 | 28 | 1444, 25.8 / 60.6 / 74.9 | 16.08 | 90.4% / 45.2% | 55.2% | 359-426 | 203k / 231k | 124/7 | 0 | 38.6 / 90.0 |
| D1b | 2aa6a51 | 25 | 90 | 2655 / 2700 | 3.05 / 6.48 / 15.5 | 6 / 0 | 15 | 1493, 23.4 / 49.7 / 74.4 | 16.58 | 86.5% / 43.3% | 50.7% | 423-423 | 238k / 253k | 103/11 | 0 | 33.9 / 88.1 |
| D5 | 2aa6a51 | 30 | 90 | 2588 / 2700 | 3.11 / 6.37 / 16.2 | 5 / 0 | 70 | 1372, 26.6 / 65.2 / 84.0 | 15.25 | 91.8% / 45.9% | 55.8% | 423-466 | 190k / 220k | 133/1 | 0 | 39.9 / 110.0 |
| D4 | 2aa6a51 | 35 | 90 | 2472 / 2700 | 3.43 / 8.19 / 17.2 | 7 / 0 | 167 | 1293, 31.2 / 74.4 / 102.2 | 14.39 | 100.7% / 50.3% | 61.6% | 375-414 | 184k / 214k | 115/0 | 0 | 51.8 / 119.9 |
| D2 | 2aa6a51 | 50 | 90 | 2101 / 2700 | 4.30 / 10.27 / 24.8 | 25 / 0 | 472 | 829, 44.9 / 103.4 / 122.7 | 9.21 | 103.6% / 51.8% | 67.4% | 453-457 | 157k / 176k | 102/1 | 0 | 74.3 / 189.0 |
| D3 | 2aa6a51 | 100 | 60 | 518 / 1800 | 9.66 / 22.63 / 33.4 | 219 / 1 | 1173 | 102, 155.0 / 286.4 / 294.5 | 1.70 | 106.5% / 53.3% | 72.5% | 501-509 | 88k / 92k | 46/0 | 0 | 207.6 / 434.1 |
| C2 | fa740ec | 25 | 90 | 2676 / 2700 | 2.96 / 5.94 / 12.9 | 2 / 0 | 0 | 1600, 30.1 / 56.5 / 85.0 | 17.79 | 89.5% / 44.7% | 53.0% | 372-425 | 205k / 231k | 125/6 | 4 (1008 invalid-input) | 42.6 / 100.3 |

D3 ran 60 s like B3 because D2 already saturated the host thread. Unlike B3, D3 bots still played (46 kills, 4845
ability presses, 0 neutralizations). Steal time was 0.00% in every run. No errors other than C2's 4 closes; all bots were
admitted and open at the end of every run. `discardedRevokedFrames` on dev: 10 / 8 / 2 / 0 / 1 / 0 (D1, D1b, D5, D4, D2, D3).

### Before/after (e2-standard-2 Broadwell to c2d-standard-2 Milan, same bundles)

| | B1 / B1b | D1 / D1b | B2 | D2 | B3 (60 s) | D3 (60 s) | C1 fa740ec | C2 fa740ec |
|---|---|---|---|---|---|---|---|---|
| bots | 25 | 25 | 50 | 50 | 100 | 100 | 25 | 25 |
| ticks run / due | 2075, 1999 / 2700 | 2628, 2655 / 2700 | 1027 / 2700 | 2101 / 2700 | 165 / 1800 | 518 / 1800 | 2428 / 2700 | 2676 / 2700 |
| tick p50/p99 ms | 5.69 / 12.38, 5.74 / 12.90 | 3.15 / 6.92, 3.05 / 6.48 | 8.95 / 24.73 | 4.30 / 10.27 | 18.41 / 47.32 | 9.66 / 22.63 | 5.57 / 12.16 | 2.96 / 5.94 |
| droppedTicks | 469, 526 | 28, 15 | 1498 | 472 | 1595 | 1173 | 77 | 0 |
| snapshotBatch p50/p99 ms | 53.7 / 102.1, 57.6 / 128.6 | 25.8 / 60.6, 23.4 / 49.7 | 125.0 / 191.1 | 44.9 / 103.4 | 317.6 / 371.8 | 155.0 / 286.4 | 62.8 / 134.6 | 30.1 / 56.5 |
| snapshotBatch mean ms | 56.5, 60.1 | 27.5, 25.1 | 124.6 | 47.6 | 307.8 | 161.7 | 65.0 | 30.9 |
| snapshot Hz | 7.46, 6.72 | 16.08, 16.58 | 2.37 | 9.21 | 0.60 | 1.70 | 8.05 | 17.79 |
| host CPU 1 core | 105.3%, 105.7% | 90.4%, 86.5% | 104.6% | 103.6% | 111.2% | 106.5% | 105.7% | 89.5% |
| VM busy | 65.7%, 66.5% | 55.2%, 50.7% | 69.7% | 67.4% | 74.5% | 72.5% | 64.1% | 53.0% |
| 1008 invalid-input closes | 0, 0 | 0, 0 | 0 | 0 | 0 | 0 | 6 (8 deaths) | 4 (6 deaths) |

snapshotBatch speed-up from Broadwell to Milan, same code and bot count (B value divided by D value):

| bots | p50 | p99 | mean per batch |
|---|---|---|---|
| 25 (B1, B1b against D1, D1b, averaged) | 2.3x (55.6 to 24.6) | 2.1x (115.3 to 55.2) | 2.2x (58.3 to 26.3) |
| 50 | 2.8x | 1.8x | 2.6x |
| 100 | 2.0x | 1.3x | 1.9x |
| 25, fa740ec (C1 against C2) | 2.1x | 2.4x | 2.1x |

Reading:
- The c2d per-thread speed roughly halves the cost of one snapshot batch at every bot count. At 25 bots the dev host
  now runs 97-98% of its ticks (15-28 dropped against 469-526) and sends 16.1-16.6 Hz snapshots against 6.7-7.5 Hz.
  The fa740ec control on c2d (C2: tick 2.96 / 5.94 ms, snapshotBatch 30.1 / 56.5 ms, 17.8 Hz) is at least as fast as the
  morning e2-medium run of the same bundle (A r1: 4.00 / 9.91 ms, 30.1 / 62.8 ms, 13.7 Hz).
- The host is still one thread: 86-92% of one core at 25-30 bots and saturated from 35 bots (100.7%, 167 dropped ticks).
  Snapshot rate never reached the 20 Hz target (best 16.6 Hz at 25 bots).
- New against old code on the same c2d VM at 25 bots repeats the Run B pattern: snapshotBatch mean 27.5 / 25.1 ms
  against 30.9 ms, but fewer ticks run (2628 / 2655 against 2676), 15-28 dropped against 0 and a lower snapshot rate
  (16.1-16.6 against 17.8 Hz); tick plus snapshotBatch took 48.8 / 46.2 s of the 90 s against 58.0 s, and persistence wall
  time was 19.3 / 17.2 s against 10.5 s. The extra main-thread work outside those two timers was not profiled.
- Respawn rebinding: C2 reproduced 4 closes `1008 invalid-input` on 6 deaths with fa740ec; dev had 0 closes on 20 deaths.

Verdict against decision 10 (tick p99 under 10 ms and VM CPU under 60%): on c2d, 25 bots pass (tick p99 6.48-6.92 ms,
VM busy 50.7-55.2%) and 30 bots pass (6.37 ms, 55.8%); 35 bots fail on CPU (8.19 ms, 61.6%), 50 bots fail on both
(10.27 ms, 67.4%) and 100 bots fail on both (22.63 ms, 72.5%). VM busy crosses 60% at about 33 bots by linear
interpolation between D5 and D4, and tick p99 would cross 10 ms near 48 bots, so CPU binds first: about 30 bots pass on
c2d-standard-2, against none of the measured counts on e2-standard-2. Limits of this estimate: 90 s windows, not the
decision's 10-minute average; VM busy includes the idle prod and dev servers and the throwaway PG; bots ran on the Mac,
not on the VM; at 30 bots the host thread already uses 92% of one core with 70 dropped ticks.

Commands (Run D):

```sh
TS=20261018202325   # run dir /tmp/crabcraft-load-$TS on the VM
gcloud compute scp bundle-2aa6a51.tgz bundle-fa740ec.tgz crabcraft-1:/tmp/ --zone asia-northeast3-a --project crabcraft-seonn
gcloud compute ssh crabcraft-1 --zone asia-northeast3-a --project crabcraft-seonn --command "D=/tmp/crabcraft-load-$TS; mkdir -p \$D/bundle \$D/bundle-fa740ec \$D/tmp; tar xzf /tmp/bundle-2aa6a51.tgz -C \$D/bundle; tar xzf /tmp/bundle-fa740ec.tgz -C \$D/bundle-fa740ec; mv /tmp/bundle-*.tgz \$D/"
# host (dev); the control used \$D/bundle-fa740ec/load-bundle/launch.mjs
gcloud compute ssh crabcraft-1 --zone asia-northeast3-a --project crabcraft-seonn --command "D=/tmp/crabcraft-load-$TS; cd \$D; PORT=18734 LOAD_STATS_PORT=18735 TMPDIR=\$D/tmp setsid -f node \$D/bundle/launch.mjs > \$D/host.log 2>&1 < /dev/null"
gcloud compute ssh crabcraft-1 --zone asia-northeast3-a --project crabcraft-seonn -- -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 \
  -L 18734:127.0.0.1:18734 -L 18735:127.0.0.1:18735 -L 18080:127.0.0.1:8080 -L 18081:127.0.0.1:8081
# bots, from this worktree (control: from .worktrees/ops-world-load); --bots 25/30/35/50/100, --seconds 60 for D3
node tools/load-world-actual.mjs --origin http://127.0.0.1:18734 --stats http://127.0.0.1:18735 --bots 25 --seconds 90 \
  --warmup 25 --per-worker 5 --health http://127.0.0.1:18080/healthz,http://127.0.0.1:18081/healthz --label d1 --out d1-25bots.json
# stop: pkill -TERM -u $USER -f "$D/bundle/launch.mjs"; cleanup: rm -rf /tmp/crabcraft-load-$TS
```

Labels: D1 `d1`, D2 `d2`, D3 `d3`, C2 `c2`, D4 `d4`, D1b `d5`, D5 `d6`. Raw results: `d1-25bots.*`, `d1b-25bots.*`,
`d5-30bots.*`, `d4-35bots.*`, `d2-50bots.*`, `d3-100bots.*`, `c2-fa740ec-25bots.*`, `host-2aa6a51.log`, `host-2aa6a51-b.log`,
`host-fa740ec.log` in the measuring session's scratchpad `vm/` directory (not committed). The VM run directory, host
processes and tunnel were removed after the runs.
