#!/bin/sh
# Re-render the Sidestep crowd video (both layouts) from this checkout's clips.
#   sh tools/crowd/sidestep/rerender.sh [make.mjs options...]
#   e.g. sh tools/crowd/sidestep/rerender.sh --layouts land --reuse
# Options given here come first, so they win over the defaults below (make.mjs takes the first).
# Environment: SONG (audio file, default sidestep.mp3 next to this script), OUT_DIR (videos and
# contact sheets, default scratch/crowd-sidestep in the checkout), WORK (captured shots and
# report.json, default $TMPDIR/crabcraft-crowd-sidestep-work), PORT (dev server port, default 5293).
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
cd "$REPO"
SONG=${SONG:-tools/crowd/sidestep/sidestep.mp3}
OUT=${OUT_DIR:-scratch/crowd-sidestep}
WORK=${WORK:-${TMPDIR:-/tmp}/crabcraft-crowd-sidestep-work}
[ -d node_modules ] || pnpm install --frozen-lockfile
exec node tools/crowd/make.mjs "$@" --choreo tools/crowd/sidestep/choreo.mjs --beats tools/crowd/sidestep/grid.json \
  --audio "$SONG" --out-dir "$OUT" --name crabcraft-crowd-sidestep --work "$WORK" --port "${PORT:-5293}" --workers 2
