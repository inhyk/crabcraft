#!/bin/sh
# Re-render the Sidestep take 4 crowd video (both layouts) from this checkout's clips.
#   sh tools/crowd/sidestep-a4/rerender.sh [make.mjs options...]
#   e.g. sh tools/crowd/sidestep-a4/rerender.sh --layouts land --reuse
# Options given here come first, so they win over the defaults below (make.mjs takes the first).
# Environment: SONG (audio file, default sidestep-a4.mp3 next to this script), OUT_DIR (videos and
# contact sheets, default scratch/crowd-sidestep in the checkout), WORK (captured shots and
# report.json, default $TMPDIR/crabcraft-crowd-sidestep-a4-work), PORT (dev server port, default 5294).
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
cd "$REPO"
SONG=${SONG:-tools/crowd/sidestep-a4/sidestep-a4.mp3}
OUT=${OUT_DIR:-scratch/crowd-sidestep}
WORK=${WORK:-${TMPDIR:-/tmp}/crabcraft-crowd-sidestep-a4-work}
[ -d node_modules ] || pnpm install --frozen-lockfile
exec node tools/crowd/make.mjs "$@" --choreo tools/crowd/sidestep-a4/choreo.mjs --beats tools/crowd/sidestep-a4/grid.json \
  --audio "$SONG" --out-dir "$OUT" --name crabcraft-crowd-sidestep-a4 --work "$WORK" --port "${PORT:-5294}" --workers 2
