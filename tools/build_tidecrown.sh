#!/usr/bin/env bash
# Rebuild public/models/world/tidecrown.glb (Tidecrown kit: Crownshell Keep, lantern, ward and city
# walls, towers and gates, Pincer Gate, bridge span, statue plinth) and tools/tidecrown-pieces.json.
# Usage: tools/build_tidecrown.sh [--render DIR [--kit-tex DIR]]   (extra args go to build_tidecrown.py)
# Blender runs on BLENDER_THREADS threads (default 4).
set -euo pipefail
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
"$BLENDER" -b --factory-startup -t "${BLENDER_THREADS:-4}" --python "$ROOT/tools/build_tidecrown.py" -- \
  --out "$TMP/tidecrown.raw.glb" --json "$ROOT/tools/tidecrown-pieces.json" "$@" >"$TMP/blender.log" 2>&1 || {
  tail -40 "$TMP/blender.log"
  exit 1
}
grep -E "^TC_(BUILD|EXPORT)" "$TMP/blender.log"
test -s "$TMP/tidecrown.raw.glb"
mkdir -p "$ROOT/public/models/world"
npx -y @gltf-transform/cli@4 meshopt "$TMP/tidecrown.raw.glb" "$ROOT/public/models/world/tidecrown.glb" --quantize-normal 12 \
  >"$TMP/meshopt.log" 2>&1 || { cat "$TMP/meshopt.log"; exit 1; }
grep -v "Skipping TEXCOORD_0" "$TMP/meshopt.log" || true  # world-unit UVs stay float32 by design
node "$ROOT/tools/check-tidecrown-glb.mjs" "$ROOT/public/models/world/tidecrown.glb"
echo "tidecrown.glb $(wc -c <"$ROOT/public/models/world/tidecrown.glb" | tr -d ' ') bytes"
