# SnapshotBatch local measurements

The public projection and binary prefix are shared only for an identical prepared
snapshot, provider/catalog, ordered effective visibility set, and prior public
baseline. Self state, progress, party features, recovery, events, and command
results remain recipient-specific. The host releases the prepared token in a
`finally` block after each synchronous recipient batch. The prefix cache is capped
at 100 groups and 2 MiB; exceeding either bound uses the exact uncached path.
AOI 80/88, 30 Hz simulation, 20 Hz publication, budgets, numeric precision, and ACK
semantics are unchanged.

## Revision boundaries

| Purpose | Revision |
|---|---|
| Original runtime | `5702ae9df9db1b5a80b60c81ada278b94730af37` |
| Original runtime plus benchmark tools | `2d9d892` |
| Deterministic optimized measurement | `cc7cfcbc2c8c28d0e7c127f385a08f10520d4912` |
| Final optimized runtime, explicit cache release | `57d063a347a7f6894b0531d7c605bf8ea225b726` |
| Matched host composition tools | `1949393935c1b4f35ceebcd0dee54031176f0be9` |
| Exact respawn/session/rate dependency on both host sides | `5a7abc9971cb99c13da7fe2ee075c7e27e097b46` |
| Current canonical integration, correctness only | `6514c62e7aca6599a432285623d1ac6ef23494fe` |

The last revision merges first-PR root `2afb313a570338fd20efa3f4e8bcbe59fd68ee76`.
It changes gameplay/catalog assets but has no additional diff in `host.ts` or
`gameplay/protocol.ts`. No performance claim below applies to that new gameplay
workload. No VM benchmark, deployment, or S8 acceptance was performed in this lane.

## Fixed deterministic input

Actual baked World I, real Area/rules, seed 1, spread placement, configured
60 scraplings / 30 scavengers / 10 jellyfish, **98 actual enemies** after terrain
placement. Node 24.22.0, 20 warmup publications, 80 measured publications. The
fixture advances the same deterministic inputs and simulation ticks on both sides.

| Viewers | Batch p50 before / after, ms | Batch p99 before / after, ms | p50 reduction |
|---:|---:|---:|---:|
| 25 | 18.07 / 12.62 | 23.06 / 18.66 | 30.2% |
| 50 | 38.39 / 24.98 | 48.24 / 29.98 | 34.9% |
| 100 | 84.93 / 42.59 | 114.07 / 59.15 | 49.9% |

The six `encoder-*.json` files preserve raw measurements. Packet counts and byte
totals match exactly. Digests differ because root object fields are serialized in
a different order; the independent decoders verify exact values. These measurements
compare original 5702 with cc7, before the explicit-release follow-up.

Endpoint RSS increased by 14.65 / 39.68 / 20.59 MB for 25 / 50 / 100 viewers.
These endpoints neither measure peak usage nor establish a leak. The 2 MiB prefix
limit is not a process-RSS bound. Explicit release removes prepared-cache references
at the end of every batch; its lifecycle was tested separately.

The initial CPU profile attributed 20.00% self time to value writing, 14.93% to
checksum, and 7.46% to object validation. Sharing their public portion targets
those repeated paths. The checked-in profile summaries are diagnostic, not an
additional timing sample.

## Actual local host with matched P1

Both bundles use the same 57d host, exact 5a7abc9 input fix, base 5702 rules, real
local Postgres, tickets, WS, and off-process bots. The before bundle replaces only
`protocol.ts` with original 5702 and adds the same token-release operation. This
avoids the known old-binding respawn bug changing only one side's population.
`host-composition.json` records the exact shim, protocol, host, input, tool, and
bundle hashes used. The later tool commit adds explicit timing-window metadata
and asset hashes; it does not change the measured bundles.

Each run has 5 seconds warmup and 15 seconds measured under CPU profiling.
CPU percentage uses only the post-warm interval. Latency percentiles use the
host's accumulated bounded statistics, including warmup. Clients use the same
policy/load shape; wall-clock input trajectories are not bitwise identical.

| Clients | CPU before / after, % | Batch p50, ms | Batch p99, ms | Measured dropped ticks |
|---:|---:|---:|---:|---:|
| 25 | 75.29 / 63.93 | 20.85 / 16.49 | 30.67 / 29.95 | 0 / 0 |
| 50 | 86.69 / 71.25 | 32.76 / 19.31 | 90.95 / 64.20 | 7 / 12 |

All four runs retain exactly 25 or 50 active actors/connections, with zero closes,
decode errors, and host failures. **50-client dropped ticks worsened from 7 to 12.**
The reduced snapshot cost is not an operational latency or VM 100 pass. These are
short local samples, not statistically controlled estimates. Earlier live runs
without P1 are not mixed into this table.

## Correctness

Independent baseline/new and new/baseline decoders at runtime 57d passed:

- 40 publications, 120 cross-decoder checks, 4,316 actor poses, 41,882 recipes.
- Full/delta/fragments, private NPC/quest/party/target filtering, AOI history
  convergence, same ID/new life, retire, Area/epoch reset, and publication ACKs.
- 513 personal XP events reject the owning viewer's 512-event budget while a
  different viewer receives zero events successfully. Failed publication does
  not advance its baseline or ACK.
- 128 groups and 7.43 MB cumulative public payload exercise the 100-group/2 MiB
  cache fallback. 104 previously returned packet buffers remain unchanged.
- Ten release/idempotency/released-token rejection checks preserve next-frame
  delta correctness.

`golden-57d063a.json` contains the independent result and source digests. It is
correctness evidence, not a controlled performance run. At runtime 57d, protocol
and actual PG/WS host tests passed 59/59, and `pnpm build` passed. The canonical
integration 6514c62 also passed the same 59 tests and build. The command outputs are
checked in as `composed-tests.txt` and `composed-build.txt`; no timing run was
repeated against its changed gameplay workload.

## Local PR77 dependency composition

Local merge `e6ee9da9e8841dec96fec65df66f65b31bc32102` combines snapshot parent
`bdc9a8288fd0b7bba159b495fd6bc04f0953d69c` with reviewed PR77 source
`55390293a95cd10c5778024c83fce308cb9bcaa0`. This is local integration evidence,
not dependency merge approval or production activation.

The only conflict was the `host.ts` publication recipient loop. It retains PR77's
`publishedConsumed(c)` and `materializeResults(c)` within the snapshot batch's
`try/finally releasePreparedObservation`. Relative to PR77, the entire host diff
is the release import and that wrapper. One-use certified leases and the shared
`InputRateBudget` remain unchanged. Protocol, events, and input codec source did
not change in this merge, so the historical golden was not rerun against a new
semantic implementation.

The composed head passed build and 98 protocol, actual PG/WS host, client, and
view tests with zero failures or skips. They include durable ACK withholding
until death seal, certified replay/lease disconnect, 257-grant receipt pruning,
retained/external public admission and party behavior, and P1 respawn input.
`pr77-composition.json` pins hashes and commands; `pr77-composed-boundary.txt` and
`pr77-composed-build.txt` retain outputs. There was no new performance run. The
old measured workloads and the 50-client dropped-tick regression remain exactly
as recorded above.

## Reproduction

Use separate checkouts at the pinned revisions, with the repository's frozen
pnpm 10.10.0 dependencies. Never run before/after timing jobs concurrently.
No VM, production database, or provider is required. Local Postgres binaries are
required for the host benchmark; each run creates and removes a throwaway cluster.

For the deterministic table, run this in `2d9d892` for before and `cc7cfcb` for after,
substituting 25, 50, and 100:

```sh
npx -y node@24 tools/bench-snapshot-batch.mjs --viewers 50 --frames 80 --warmup 20 --layout spread --out /tmp/encoder-50.json
```

For the matched P1 host table, use a checkout at `1949393`. Do not substitute the
current canonical head while claiming to reproduce the old workload:

```sh
npx -y node@24 tools/build-snapshot-host-bench.mjs /tmp/snapshot-compositions
# Copy the assets URL printed by that command into SNAPSHOT_BENCH_ASSETS.
SNAPSHOT_BENCH_ASSETS=file:///absolute/checkout/public/world/ npx -y node@24 /tmp/snapshot-compositions/before.mjs --viewers 50 --seconds 15 --warmup 5 --out /tmp/host-before-50.json --profile /tmp/host-before-50.cpuprofile
SNAPSHOT_BENCH_ASSETS=file:///absolute/checkout/public/world/ npx -y node@24 /tmp/snapshot-compositions/after.mjs --viewers 50 --seconds 15 --warmup 5 --out /tmp/host-after-50.json --profile /tmp/host-after-50.cpuprofile
```

Repeat with 25 viewers. Inspect `bots[].closes`, `bots[].errors`, `failures`, and
active actor/connection counts before comparing CPU. The manifest hashes every
checked-in artifact and preserves the original local profile hashes. Full CPU
profiles can be recreated with the commands above; they are not checked in.

The independent historical equivalence check accepts explicit checkout paths:

```sh
npx -y node@24 tools/qa-snapshot-batch-equivalence.mjs /absolute/baseline5702 /absolute/candidate57d /tmp/golden.json
```

Keep baseline 5702 clean and use candidate 57d for the recorded result. This script
uses the original 35-rig provider fixture; a later canonical 39-rig provider needs
a separately composed same-provider check, not a relaxed catalog assertion. The
checked-in helper preserves the reviewer's original assertions and only replaces
absolute path/output constants with CLI parameters.
