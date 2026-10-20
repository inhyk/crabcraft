#!/usr/bin/env bash
# Rebuild public/models/world/tidecrown-harbor.glb (Blender headless, then meshopt), refresh
# tools/tidecrown-harbor-pieces.json and check the result.
# Usage: tools/build_tidecrown_harbor.sh [render-dir]   (render-dir: also write EEVEE previews there)
set -euo pipefail
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
RENDER=()
if [ -n "${1:-}" ]; then RENDER=(--render "$1"); fi
"$BLENDER" -b -t 4 --factory-startup --python "$ROOT/tools/build_tidecrown_harbor.py" -- \
  --out "$TMP/tidecrown-harbor.raw.glb" --pieces "$ROOT/tools/tidecrown-harbor-pieces.json" ${RENDER[@]+"${RENDER[@]}"} \
  | grep -E "^PIECE|^RENDER|Error|Traceback" || true
test -s "$TMP/tidecrown-harbor.raw.glb"
mkdir -p "$ROOT/public/models/world"
npx -y @gltf-transform/cli@4 meshopt "$TMP/tidecrown-harbor.raw.glb" "$ROOT/public/models/world/tidecrown-harbor.glb" --quantize-normal 12 2>&1 | grep -E "→|rror" || true
node "$ROOT/tools/check-tidecrown-harbor-glb.mjs"
ls -la "$ROOT/public/models/world/tidecrown-harbor.glb"
