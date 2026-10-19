#!/usr/bin/env bash
# Rebuild public/models/world/tidecrown-city.glb and tools/tidecrown-city-pieces.json (Blender + meshopt),
# then check the result. Extra arguments go to tools/build_tidecrown_city.py, for example
#   tools/build_tidecrown_city.sh --render /tmp/renders --textures /tmp/kit-textures
set -euo pipefail
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
"$BLENDER" -b -t "${BLENDER_THREADS:-4}" --python-exit-code 1 --python "$ROOT/tools/build_tidecrown_city.py" -- \
  --out "$TMP/tidecrown-city.raw.glb" --json "$ROOT/tools/tidecrown-city-pieces.json" "$@" > "$TMP/blender.log" 2>&1 \
  || { tail -40 "$TMP/blender.log"; exit 1; }
grep -E "^PIECE|^RENDER" "$TMP/blender.log" || true
npx -y @gltf-transform/cli@4 meshopt "$TMP/tidecrown-city.raw.glb" "$ROOT/public/models/world/tidecrown-city.glb" --quantize-normal 12
node "$ROOT/tools/check-tidecrown-city-glb.mjs"
