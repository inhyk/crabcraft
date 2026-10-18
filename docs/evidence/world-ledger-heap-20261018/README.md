# External contribution ledger local retained-heap evidence

Pinned source: `b1c42d048737068ef6f16feed4fea031bd7e977b`. Node `v24.22.0`, platform `darwin`, disposable PostgreSQL `14.20 (Homebrew)`. External packages: `{'pg': '8.23.1', 'esbuild': '0.28.2'}`. This is local Area/source+PG-adapter evidence, not an actual WS host, VM/S8 load or earned-gameplay result.

The live integration worktree moved during inspection. Before compilation, an immutable git archive of the exact requested b1 source was extracted into this owned directory. All370 source file SHA256 values and bundle/entry SHA were verified unchanged after execution. No project source or branch file was modified. Existing untracked `output/` was untouched.

Source snapshot: `/private/tmp/crabcraft-ledger-heap-bzg9x2_d/source`
Archive SHA256: `91ee224920fa1337bf2849b9f764b4cdcc07921b57fc75ca980c37e6d7c281db`
Bundle SHA256: `473a94fb61fa70ac14d1b00102b4dc23f55794aa6fefc798b2c446587057ffad`
Manifest: `/private/tmp/crabcraft-ledger-heap-bzg9x2_d/source-manifest.json`
Entry/bundle: `/private/tmp/crabcraft-ledger-heap-bzg9x2_d/entry.mjs`, `/private/tmp/crabcraft-ledger-heap-bzg9x2_d/bench.mjs`
Raw results/log: `/private/tmp/crabcraft-ledger-heap-bzg9x2_d/result.json`, `/private/tmp/crabcraft-ledger-heap-bzg9x2_d/run.log`

Run command:
`npx --offline -y -p node@24 -p pnpm@10.10.0 -c 'node --expose-gc /private/tmp/crabcraft-ledger-heap-bzg9x2_d/bench.mjs'`

## Reproduce from the checked-in evidence

The following setup/build/run recipe needs the checked-in `entry.mjs` and `source-manifest.json`, a clone retaining the pinned Git object, Node24.22.0, pnpm10.10.0, esbuild0.28.2/pg8.23.1 from the pinned lockfile, and local PostgreSQL binaries. It does not require this temporary bundle or its dependencies to survive. Set `heap_evidence` to the directory containing those two evidence files. These commands describe reproduction; they were added after the recorded run without rerunning the experiment.

```sh
heap_repo=/Users/inkeun/projects/crabcraft
heap_evidence=/absolute/path/to/checked-in/heap-evidence
heap_run=$(mktemp -d /private/tmp/crabcraft-ledger-heap-reproduce-XXXXXX)
heap_head=b1c42d048737068ef6f16feed4fea031bd7e977b
mkdir "$heap_run/source"
git -C "$heap_repo" archive --format=tar "$heap_head" \
  src server tests/core package.json pnpm-lock.yaml > "$heap_run/source.tar"
shasum -a 256 "$heap_run/source.tar"
# Expected: 91ee224920fa1337bf2849b9f764b4cdcc07921b57fc75ca980c37e6d7c281db
tar -xf "$heap_run/source.tar" -C "$heap_run/source"
cp "$heap_evidence/entry.mjs" "$heap_run/entry.mjs"
cp "$heap_evidence/source-manifest.json" "$heap_run/source-manifest.json"
python3 - "$heap_run" <<'PYVERIFY'
import hashlib, json, pathlib, sys
root = pathlib.Path(sys.argv[1])
m = json.loads((root / 'source-manifest.json').read_text())
assert m['head'] == 'b1c42d048737068ef6f16feed4fea031bd7e977b'
assert hashlib.sha256((root / 'source.tar').read_bytes()).hexdigest() == m['archiveSha256']
assert len(m['sourceFiles']) == 370
for relative, expected in m['sourceFiles'].items():
    assert hashlib.sha256((root / 'source' / relative).read_bytes()).hexdigest() == expected, relative
assert hashlib.sha256((root / 'entry.mjs').read_bytes()).hexdigest() == m['entrySha256']
print('Pinned archive, 370 source files and entry verified')
PYVERIFY
# Independent dependency setup; modifies only this disposable source directory.
(
  cd "$heap_run/source"
  npx --offline -y -p node@24 -p pnpm@10.10.0 \
    -c 'pnpm install --offline --frozen-lockfile'
)
ln -s "$heap_run/source/node_modules" "$heap_run/node_modules"
# db.ts resolves this URL relative to the output bundle, not the source tree.
cp -R "$heap_run/source/server/node/migrations" "$heap_run/migrations"
(
  cd "$heap_run"
  npx --offline -y -p node@24 -p pnpm@10.10.0 -c 'node --input-type=module' <<'JSBUILD'
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const require = createRequire(import.meta.url);
assert.equal(process.version, 'v24.22.0');
assert.equal(require('esbuild/package.json').version, '0.28.2');
assert.equal(require('pg/package.json').version, '8.23.1');
console.log({pgResolved: require.resolve('pg')});
await build({
  entryPoints: ['entry.mjs'], outfile: 'bench.mjs',
  bundle: true, platform: 'node', format: 'esm', target: 'node24',
  packages: 'external', minify: false, sourcemap: false,
  banner: {js: "import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);"},
});
JSBUILD
  # Optional when the helper cannot discover initdb/pg_ctl:
  # export PG_BIN=/opt/homebrew/opt/postgresql@14/bin
  npx --offline -y -p node@24 -p pnpm@10.10.0 \
    -c 'node --expose-gc bench.mjs' > run.log 2>&1
)
# Read "$heap_run/result.json" and "$heap_run/run.log".
```

The original recorded setup reused already installed dependencies rather than reinstalling: both `source/node_modules` and the output directory's `node_modules` were absolute symlinks to `/Users/inkeun/projects/crabcraft/.worktrees/feat-world-ledger-integration/node_modules`. `pg` remains external in the bundle; Node resolves it from the output directory's `node_modules` at runtime. `esbuild` is used only to compile. Node built-ins remain external, and the createRequire banner supports CommonJS resolution. The standalone recipe above installs the same pinned package/lockfile under the extracted source and links the output to those dependencies, avoiding reliance on the live worktree.

The archive selection is exactly `src server tests/core package.json pnpm-lock.yaml`, totaling370 tracked files. Do not replace it with a live-worktree copy. All seven pinned SQL files001-007 are copied unchanged beside `bench.mjs` in `./migrations`; bundled `db.ts` uses `new URL('./migrations/', import.meta.url)`. A symlink from output `migrations` to the pinned extracted source migration directory is equivalent, but the recorded run used a copy. The helper creates a fresh cluster/database, migrates it and stops/removes it in the entry's finally block.

Rebuilt bundle comments include source paths, so a different checkout/temp path can change its SHA. Keep the original measured bundle SHA above as provenance of this run, and record the newly built SHA separately. Source and entry hashes must match the manifest; future measured heap/timings are independent observations and need not equal this run. The exact recorded run command used the absolute `bench.mjs` path shown above.

## Experiment

One actual external-durable World I Area used the existing core test flat-world query, real players/controllers, WorldRules, CharacterStore, DurableOutcomeStore, AreaSourceDrain, actual PG ownership guard, migration and checkpoint APIs. Operational source limits were copied from existing PG/oracle tests. No new runtime knobs or implementation changes were added.

Contributors were admitted in batches of100, generated individually by server fresh creation. Each used actual core questAccept and damage/heal calls against one living victim. The trusted heal fixture prevents early death; it does not represent earned gameplay or frontend-authorized combat. Every resident batch was flushed through actual source capture/ACK and real PostgreSQL, final summaries were installed through the real Area adapter, then old residents were quiesced/checkpointed/receipted and retired before admitting the next batch. Peak live residents was100. No all-N contributor/grant JavaScript array was constructed or retained; only the current batch and bounded100-record pages were held.

Normal event draining mirrors the host boundary. No contribution eligibility cap, reward drop, time/distance cutoff, journal pruning or DB cleanup was used to manufacture the result. The complete old eligibility remained in PostgreSQL throughout. Legacy account save/revision47 was preserved and never imported.

## Increasing lifetime contributors

Every point has100 live residents, one live source victim/summary,100 ledger owners, dirty credit entries0, pending deaths0, captures0 and retirements0. Database grants stay0 until death.

| lifetime contributors | forced-GC heap MiB | ordinary pre-GC heap MiB | post-GC RSS MiB | PG characters / credits |
|---:|---:|---:|---:|---:|
|100 |26.12 |47.07 |179.00 |100 / 100 |
|500 |27.12 |33.03 |186.23 |500 / 500 |
|2000 |27.25 |69.55 |256.03 |2000 / 2000 |

At100→2000 lifetime contributors the post-GC heap increased1.13MiB. At500→2000 it increased0.13MiB. This finite observation supports the intended small resident/source envelope here; it is not a proof of a constant heap or an exclusion of a small linear component.

## Death, bounded materialization and receipts

At2000 total contributors, actual core death reservation retained100 resident grants and one staged recipe: staged source bytes48,499, pending deaths1. Actual PG materialization took20 bounded100-recipient source-drain slices, producing2000 immutable grants and one complete seal. No full-N grant result array was collected in the experiment.

After seal/source retirement, live victims0, summaries0, pending deaths0 and staged bytes0;100 already-applied resident IDs were still present until their exact checkpoint/receipt commits. After those100 real PG checkpoints, appliedGrantIds0, captures0, replayTokens0 and durableCharacters0. Current ledger owners remained100, as the current100 residents were still attached. Final PG retained2000 credits,2000 grants,100 receipts and one seal; all1900 offline grants remained pending. Temporary DB contribution rows were deliberately not cleaned before final memory measurement.

| phase | forced-GC heap MiB | source pending / staged bytes | PG grants / receipts |
|---|---:|---:|---:|
|death-before-drain |27.37 |1 / 48499 |0 / 0 |
|all-pages-sealed-source-retired |27.48 |0 / 0 |2000 / 0 |
|resident-checkpoints-receipted |27.50 |0 / 0 |2000 / 100 |

## Peak and GC conditions

The run completed in7.24s. Named checkpoints used three explicit global.gc calls separated by setImmediate. This is a measurement technique, not a production GC recommendation. Forced-GC values above are separate from ordinary allocation peaks.

Observed sampled peak heap was96.85MiB and RSS257.53MiB. Sampling was every20ms plus per-character/per-batch/high-tide calls (6405 samples); shorter peaks may be missed. Node process.resourceUsage maxRSS raw value `263728` is recorded separately in the JSON. RSS and V8 heap capacity increased with allocation pressure and did not return to the small post-GC used-heap value. The experiment therefore does not establish an RSS plateau or process-memory maximum. PostgreSQL server RAM is outside Node process.memoryUsage and was not measured.

## Limits

This is one short run, one victim life and one fixed resident ceiling. It omits WS serialization, actual host scheduler/session/input traffic, many concurrent victims, repeated victim lives, outages/retries, process restart and long steady-state soak. Existing source/PG oracle APIs were exercised rather than mocks, but a trusted damage/heal and flat-world fixture is not real-host/battle proof. Raw process heap includes engine/module data, PG driver, current character fixtures and measurement objects, so it is not a source-only retained-object attribution. No heap-snapshot dominator analysis or asymptotic bound is claimed.

No source changes were required for this experiment. Disposable PostgreSQL was stopped/removed in finally after counts were saved. No VM, provider, merge, push or wiki action occurred. Parent may use this as additional local evidence for the retained-source envelope, keeping deployment/operational/formal-bound gates separate.
