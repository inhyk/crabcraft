#!/usr/bin/env bash
# world-env.test.sh: runs world-env.sh against scratch /srv, /etc and /run directories and checks the
# env file it writes. Linux with jq (CI: .github/workflows/deploy-scripts.yml).
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/etc" "$T/srv/dev/current/server-dist/world"

sed -e "s|^ROOT=/srv/crabcraft$|ROOT=$T/srv|" \
	-e "s|^ETC=/etc/crabcraft$|ETC=$T/etc|" \
	-e "s|^RUN=/run/crabcraft$|RUN=$T/run|" \
	-e "s|^export PATH=|export PATH=$T/bin:|" \
	"$HERE/world-env.sh" >"$T/world-env.sh"
# No root here: install only makes the directory, chgrp and logger do nothing.
printf '#!/usr/bin/env bash\nfor last; do :; done\nmkdir -p "$last"\n' >"$T/bin/install"
printf '#!/usr/bin/env bash\nexit 0\n' >"$T/bin/chgrp"
printf '#!/usr/bin/env bash\nexit 0\n' >"$T/bin/logger"
chmod +x "$T/bin/"*

SRC=$(printf 'a%.0s' {1..64})
OUT=$T/run/dev-world.env
manifest() { printf '{"format":"crabcraft-world-manifest","version":1,"source":"%s","artifacts":{}}\n' "$1" >"$T/srv/dev/current/server-dist/world/world-manifest.json"; }
run() { bash "$T/world-env.sh" dev >>"$T/log" 2>&1; }
config() { sed -n "s/^WORLD_CONFIG_JSON='\(.*\)'$/\1/p" "$OUT"; }
fails=0
expect() {
	if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: want '$2', got '$3'"; fails=$((fails + 1)); fi
}

manifest "$SRC"
run
expect "no template writes an empty file" 0 "$(wc -c <"$OUT")"

cp "$HERE/world-dev.json" "$T/etc/dev-world.json"
run
expect "template turns the world on" WORLD_ENABLED=1 "$(head -1 "$OUT")"
expect "assets.source comes from the release manifest" "$SRC" "$(config | jq -r .assets.source)"
expect "the rest of the template is kept" "$(jq -cS 'del(.assets.source)' "$HERE/world-dev.json")" "$(config | jq -cS 'del(.assets.source)')"
expect "the env file has exactly two lines" 2 "$(wc -l <"$OUT")"

rm "$T/srv/dev/current/server-dist/world/world-manifest.json"
run
expect "a release without a manifest turns the world off" 0 "$(wc -c <"$OUT")"

manifest not-a-hash
run
expect "a manifest without a valid source turns the world off" 0 "$(wc -c <"$OUT")"

manifest "$SRC"
echo '{"schema":' >"$T/etc/dev-world.json"
run
expect "a broken template turns the world off" 0 "$(wc -c <"$OUT")"

echo "{\"schema\":\"it's\"}" >"$T/etc/dev-world.json"
run
expect "a template with a single quote turns the world off" 0 "$(wc -c <"$OUT")"

set +e
bash "$T/world-env.sh" staging >>"$T/log" 2>&1
rc=$?
set -e
expect "an unknown env is refused" 1 "$rc"

if [ "$fails" -ne 0 ]; then
	echo "--- world-env.sh output"
	cat "$T/log"
	echo "$fails check(s) failed"
	exit 1
fi
echo "all checks passed"
