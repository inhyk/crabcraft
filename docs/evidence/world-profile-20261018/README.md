# World host main-thread profile on crabcraft-1, 2026-10-18

Where the single host thread goes under bot load, measured on the same VM and config as Run D of
`docs/evidence/world-load-vm-20261018.md` (c2d-standard-2, AMD EPYC 7B13, Node 24.22.0), code dev 27e7684 (= 2aa6a51 plus
#106, #107, #109; no host, protocol or store change since 2aa6a51 except #107 skill effects).

## Setup

- Bundle: `pnpm build:server && node tools/profile-world-build.mjs OUT` (same bundling as `tools/load-world-actual-build.mjs`,
  entry `tools/profile-world-entry.mjs`). Six build-time hook calls are injected into `server/world/host.ts` while bundling
  (observe copy, host handles, snapshot entity counts, recipient visible/bytes, barrier start, barrier reason); the source is unchanged.
  Bundle tgz sha256 `121b39037b8b4355f8dac6a9f08c04d2204d85152eb7052db84c0e721ea17bce`.
- Host: launcher `tools/load-world-actual-vm.mjs` with `PORT=18734 LOAD_STATS_PORT=18735 PROFILE_DIR=$D/prof PROFILE_SECONDS=60`,
  throwaway PG 16 under `/tmp/crabcraft-load-20261018210332/`. One host process served all three runs; each run waited for `actors` 0.
- Profile: `POST /reset` (sent by the bot driver when measurement starts) starts an in-process V8 CPU profile
  (`node:inspector`, 1000 us sampling) that stops itself after 60 s, so each profile covers exactly the measured window.
- Bots on the Mac through one SSH tunnel: `node tools/load-world-actual.mjs --bots 25|50|100 --seconds 60 --warmup 25 --per-worker 5`
  with prod/dev health polled every second: 200/200 in all 59 + 60 + 59 samples.
- Analysis: `node tools/analyze-cpuprofile.mjs PROFILE BUNDLE/load-main.mjs [--focus NAME]` and
  `node tools/summarize-profile-run.mjs RESULT.json`. Outputs: `profile-{25,50,100}bots.txt`, `run-{25,50,100}bots.txt` here.
- Measurement overhead: the `profiling-tool` bucket (my pg wrapper and per-second `/stats` sorting) is 1.1 / 1.2 / 0.5% of wall.

## Runs

| bots | host CPU 1 core | VM busy | ticks run (of ~1800) / dropped | tick p50/p99 ms | snapshotBatch p50/p99 ms | snapshots per recipient Hz | barrier wall share, p50 | barriers/s |
|---|---|---|---|---|---|---|---|---|
| 25 | 96.3% | 59.7% | 1705 / 50 | 3.16 / 8.34 | 27.2 / 71.7 | 14.9 | 23.9%, 132 ms | 1.73 |
| 50 | 109.2% | 67.9% | 1378 / 343 | 4.68 / 10.85 | 48.0 / 104.2 | 8.05 | 35.4%, 240 ms | 1.41 |
| 100 | 108.2% | 70.8% | 518 / 1202 | 9.52 / 20.79 | 175.6 / 297.5 | 1.67 | 47.1%, 559 ms | 0.86 |

These agree with Run D (D1 25 bots 3.15 / 6.92 ms tick, 25.8 / 60.6 ms batch; D3 100 bots 9.66 / 22.63, 155 / 286).

## Main thread by owner (share of 60 s wall; first owner on the sampled stack)

| owner | 25 bots | 50 bots | 100 bots |
|---|---|---|---|
| snapshot publish (`host.ts` `publish`) | 41.8% | 40.2% | 29.4% |
| persistence (barrier work, `character-store.ts`, pg) | 15.1% | 22.0% | 25.1% |
| input receive + decode (`ws` message handler, `host.ts` line 944) | 7.7% | 13.9% | 27.4% |
| tick (`host.ts` `step`, `area.step`) | 11.3% | 13.1% | 10.2% |
| GC | 3.1% | 2.6% | 2.0% |
| idle | 19.0% | 5.9% | 4.0% |

Inside publish (inclusive, share of wall): 25 / 50 / 100 bots

- `encodeObservation` per recipient 19.6 / 23.8 / 23.9%: `preparedProjection` 5.7 / 5.4 / 8.6, `encodePreparedSnapshot` 4.8 / 6.5 / 6.8,
  `checkSnapshot` 3.0 / 4.5 / 6.9, `preparedBaseline` 3.6 / 2.7 / 0.5, `projectSelf` 1.1 / 2.1 / 0.3.
- `prepareObservationSnapshot` once per publish 13.3 / 8.8 / 2.7%: `assertDeepFrozen` 5.3 / 3.5, `validateActor` for every unit
  3.1 / 1.8, `clone` (JSON.stringify(clone(catalog)) each publish) 1.0 / 0.9.
- `area.snapshot()` once per publish 6.2 / 4.5 / 1.2%: all of it `immutable` (deep copy + deep freeze, `src/sim/events.ts`).

Persistence (inclusive): `character-store.ts` `decode` 8.4 / 12.7 / 14.4% of wall (`validateCheckpoint` + `parsed` + canonical `json`
of a stored checkpoint, called from `saveCheckpoint` x2, `getOwned`, `loadForRecovery`); pg client and protocol about 2-3%.

Input (inclusive): `InputSession.accept` 3.7 / 7.1 / 13.9% (two `clone` round trips per input) and `decodeClientMessage`
3.6 / 6.1 / 12.4% (`new FragmentAssembler(expected)` with `clone(binding)` per message, then `decodeInput` decodes the same bytes again).

Tick: `area.step` 10.0 / 11.4 / 8.8%, half of it `advanceNumericPose` (`src/sim/pose.ts`) for every unit every tick.

## Unit costs (main thread ms)

| cost | 25 | 50 | 100 | scales with |
|---|---|---|---|---|
| shared per publish (`area.snapshot` + `prepareObservationSnapshot`) | 13.0 | 16.4 | 23.2 | units: 140 / 165 / 215 |
| per recipient `encodeObservation` | 0.53 | 0.59 | 1.42 | visible entities 47.5 / 79.5 / 169.4, events in batch 11.6 / 37.1 / 229.7 |
| per input message (receive + decode + accept) | 0.099 | 0.089 | 0.089 | constant; 30 Hz per player |
| persistence per actor per barrier | 3.5 | 3.1 | 3.0 | constant; x actors x barriers/s |
| per tick (`step`) | 4.0 | 5.7 | 11.8 | units, players |
| bytes per recipient snapshot | 13.0 KB | 21.3 KB | 51.8 KB | visible, delta age |

## Why snapshotBatch grows superlinearly

Per publish (`host.ts` `publish`, line 770): `area.snapshot()` deep-copies and freezes the whole area, then
`prepareObservationSnapshot` walks it again (`assertDeepFrozen`), validates every unit and builds per-unit public actors, render
recipes and recipe keys. This is shared across recipients (O(units)) and is the PR #98 saving.

Per recipient: `visible()` (cheap, 0.1-0.2%), `projectObservationExtras` (clone), then `encodeObservation`:
`preparedBaseline` filters all snapshot units by the recipient's visible set and joins the id list into a cache key (O(units));
`preparedProjection` builds the actor update list for every visible actor and value-encodes it (`field` / `write`); field diffs are
cached per (previous actor object, current actor) in `p.deltas`, but the encoded bytes are not, and the projection cache only hits
when two recipients had the same previous and current visible sets, which bots spread over the map almost never do (100-group cap);
`encodePreparedSnapshot` encodes self, features, recovery, the recipient's events and results; `checkSnapshot` then validates this
server-built payload again (every selected event via `validateEvent`); `frameMessage` and `ws.send` copy the bytes.

So the per-recipient work is O(visible + events_selected), and total work per publish is O(units + N x (visible + events)).
Visible grows with N because players gather near the same homes and enemies (47.5 / 79.5 / 169.4 of 140 / 165 / 215 units), and
the events per publish grow with N and with the time since the last publish (11.6 / 37.1 / 229.7). That gives N x N: batch p50
27 / 48 / 176 ms for 25 / 50 / 100 bots. A second effect feeds it: when the thread saturates, snapshots fall to 1.7 Hz, so each
delta carries more changed fields and more events (51.8 KB per recipient at 100 bots).

## Persistence

- Barrier trigger: every tick with an xp, death, levelUp, respawn, quest, equipment, achievement or discovery event, or pending
  grants, plus every `checkpointIntervalMs` (1000 ms) (`host.ts` line 873). Reasons counted from ticks at 25 bots: 79 progression
  (59 `death+xp`, 18 `death+levelUp+xp`), 22 interval, out of 104 barriers (1.73/s). Kills alone drive barriers above 1/s.
- Each barrier covers every actor, not only the changed ones (actors per barrier = bots in every run). Per actor per barrier
  (retained mode, `WORLD_LEDGER_CONFIG_JSON` unset as on the VM): `readCertifiedGrantPage` = `getOwned` (SELECT *), `pendingGrants`,
  `loadForRecovery` (BEGIN, SELECT * FOR SHARE, COMMIT), then `persistence.commit` -> `saveCheckpoint` (BEGIN, SELECT * FOR UPDATE,
  UPDATE ... RETURNING *, COMMIT). About 10.8 pg queries per actor per barrier (269.7 per barrier at 25, 513.5 at 50, 938.2 at 100;
  466 / 723 / 809 queries/s), and 4 full decodes plus 1 `validateCheckpoint(parsed(...))` of the checkpoint per actor per barrier.
- Checkpoint JSON: 2.4-2.5 KB per UPDATE parameter. JSON size is not the cost; repeated canonicalization and validation are
  (`decode` 8.4-14.4% of wall).
- Blocking: the IO itself is awaited off the tick path, but `pump` runs no tick and no publish while `barrier` is set
  (`host.ts` line 894) and each barrier crosses at least four `boundary` hops that each wait for the next 5 ms pump. The world is
  frozen 23.9 / 35.4 / 47.1% of the wall time (barrier p50 132 / 240 / 559 ms). On resume `DeadlineScheduler` runs at most 4 ticks
  and 1 snapshot and drops the rest: this is where the dropped ticks come from, not from tick cost.
- pg pool (`max: 10`) saturates during barriers: unrelated queries wait, e.g. `SELECT expires FROM sessions` mean 27 ms at 50 bots
  and 86 ms at 100, `SELECT 1` mean 49 / 101 ms.

## What would have to change for 100 players under decision 10

At 100 players with 30 Hz ticks, 20 Hz snapshots, 30 Hz input and one barrier per second the measured unit costs give about
snapshot 20 x (23 + 100 x 0.6 to 1.4) = 1.7 to 3.3 core-seconds per second, input 0.27, persistence 0.30 (0.5 at today's
barrier rate), tick 0.35. The budget is about 1 core for the host (VM CPU < 60% of 2 vCPU must also cover PG, which used about
0.23-0.27 vCPU here). The required cut is about 3-4x overall and largest in per-recipient snapshot encoding.

## Ranked changes for the next PR

1. Input path, `server/world/gameplay/protocol.ts` `decodeClientMessage` and `FragmentAssembler`, `server/world/gameplay/intents.ts`
   `decodeInput`, `InputSession.accept`, `prepareTick`. Decode each input once (pass the decoded message from
   `decodeClientMessage` to the input validator instead of `decodeInput` re-assembling the same bytes), keep one assembler or
   pre-validated binding per connection instead of `new FragmentAssembler(expected)` + `clone(binding)` per message, and drop the
   `clone()` encode/decode round trips of freshly decoded intents in `accept` (two per input) and `prepareTick` (use the decoded
   object or `structuredClone`). Expected (estimate, not measured): 0.089 ms to about 0.03 ms per input, saving about 5% / 9% / 18% of the thread at
   25 / 50 / 100 bots (`clone` alone is 2.2 + 2.0 + 1.0% at 25). Risk low: pure functions with `server/world/protocol.test.mjs`,
   `gameplay/protocol.test.mjs` coverage; keep the same validation order and error codes.
2. Persistence barrier, `server/world/host.ts` `startDurability` (line 568) and the trigger at line 873, plus
   `server/world/character-store.ts`.
   a. Read the grant page (`readCertifiedGrantPage`, line 624) only for actors that are recipients of grants recorded in this
      barrier or have `pendingReplay`, not for every actor: removes 5 of about 10.8 queries and 2 of 5 decodes per actor.
   b. Checkpoint only actors whose state changed since their last durable capture (or batch the per-actor `saveCheckpoint` into one
      transaction with one multi-row UPDATE), instead of every actor on every barrier.
   c. Coalesce progression-triggered barriers to at most one per `checkpointIntervalMs` unless a result needs a durable ack
      (quest/equipment/discovery results already wait for the barrier via `c.results`).
   d. In `character-store.ts` select only `revision` where the stored checkpoint is not used (`getOwned` for `pendingGrants`, the
      `FOR UPDATE` read in `saveCheckpoint`) and use `RETURNING revision, updated_at` instead of `RETURNING *` + `decode`; skip
      `validateCheckpoint(parsed(checkpointJson))` of the JSON the host just produced from the codec.
   Expected (estimate): persistence CPU 15 / 22 / 25% to a few percent, barrier wall time (frozen world) 132 / 240 / 559 ms to tens of ms,
   dropped ticks mostly gone, PG load on the VM down by the same factor. Risk medium to high: these are the durability rules of
   #68/#77 (grant receipts, recovery after a lost ACK); 2a and 2d keep the semantics, 2b and 2c change when progress becomes durable
   and need an explicit decision.
3. Shared publish preparation, `prepareObservationSnapshot` (`protocol.ts` line ~381) and `area.snapshot()` (`src/sim/area.ts`
   line 300). Skip `assertDeepFrozen` for snapshots produced by `immutable` (mark them in a WeakSet in `src/sim/events.ts`
   `immutable` or trust `Area.snapshot()` by construction), validate actors only when built from untrusted input, compute
   `JSON.stringify(clone(catalog))` once per catalog object. Expected (estimate): 13 ms to about 6 ms per publish (25 bots), saving about
   7% of the thread at 25 bots and more per publish at a higher snapshot rate. Risk low.
4. Per-recipient encoding, `encodeObservation`, `preparedBaseline`, `preparedProjection`, `encodePreparedSnapshot`, `checkSnapshot`.
   a. Do not re-validate server-built payloads in production (`checkSnapshot` skips the public lists only on a projection cache
      hit; private fields and every selected event are validated per recipient): 3.0 / 4.5 / 6.9% of wall.
   b. `preparedBaseline`: walk the recipient's visible ids (the host already has `c.visible`) instead of filtering all units, and
      avoid the joined id string key when the cache cannot hit.
   c. Pre-encode each actor's update (fields + pose recipe index) once per publish and copy bytes per recipient. Needs an encoding
      without the per-message string table for those records, i.e. a wire-format decision (gameplay v3); this is what turns the
      O(N x visible) value encoding into O(N x visible) byte copies.
   d. Index `slot.events` by participant once per publish for `selectEvents`.
   Expected (estimate): per recipient 0.53 ms to about 0.3 ms with a-b-d, lower with c. Risk: a low, b low, c high (protocol), d low.
5. Interest management (design decision): AOI radius 80/88 (`host.ts` `visible`) covers 79-85% of the units at 100 bots because
   players cluster; per-recipient cost is proportional to it. Lower update rates for far or idle entities, or a smaller radius,
   is the only change that removes the N x N term rather than its constant.
6. Tick: `advanceNumericPose` is half of `area.step`; at 100 players `step` is 11.8 ms (tick p99 20.8 ms > 10 ms). Not host work,
   but decision 10's tick p99 needs it (e.g. skip pose evaluation for units nobody observes or at a lower rate).

## worker_threads

Not warranted now. c2d-standard-2 has two vCPU on one physical core (SMT), so a worker could add at most the sibling thread's
throughput while raising VM CPU, and decision 10 caps VM CPU at 60%, which needs less total work, not more threads. The snapshot
is a deep-frozen object graph; handing it to a worker costs a structured clone of about the size of `immutable()` (4-7 ms per
publish here), and the per-connection baselines would have to move with it. Items 1-4 are algorithmic and reduce total CPU; a
worker split is worth revisiting only on a larger VM, and only for latency.

## Not done

- No `--heap-prof`; GC was measured with a PerformanceObserver instead (1.9-2.3% of wall, scavenges max 7.3 ms, mark-compact max
  22 ms), so heap growth was not analyzed.
- Bots ran on the Mac; per-bot input rate is 30 Hz as in the earlier runs. Windows were 60 s, not 10 minutes.
- `.cpuprofile` files are not committed (1.2 MB each): `host-1-25c.cpuprofile` sha256 `84b3b866...b5c3`,
  `host-2-50c.cpuprofile` `99142b93...591e`, `host-3-100c.cpuprofile` `8c9bd139...1da2`, in the measuring session's scratchpad `vm/`.
- The VM run directory, host, throwaway PG and tunnel were removed after the runs; prod and dev answered 200 afterwards.
