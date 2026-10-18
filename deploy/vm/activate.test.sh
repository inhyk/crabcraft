#!/usr/bin/env bash
# activate.test.sh: runs activate.sh against a scratch /srv/crabcraft with stubbed systemctl,
# curl, runuser, logger and journalctl, and checks when the server is restarted.
# Linux only (GNU find, touch, mv). CI: .github/workflows/deploy-scripts.yml.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
BASE=$T/srv/crabcraft/dev
R=$BASE/releases
mkdir -p "$R" "$T/bin"

# The script under test with only its fixed paths and the root check swapped.
sed -e "s|^ROOT=/srv/crabcraft$|ROOT=$T/srv/crabcraft|" \
	-e "s|^export PATH=|export PATH=$T/bin:|" \
	-e 's|^\[ "\$(id -u)" -eq 0 \] .*$|:|' \
	-e "s|/run/lock/crabcraft-activate-|$T/lock-|" \
	"$HERE/activate.sh" >"$T/activate.sh"

cat >"$T/bin/systemctl" <<EOF
#!/usr/bin/env bash
S=$T
EOF
cat >>"$T/bin/systemctl" <<'EOF'
cmd=$1
case "$cmd" in
	is-active) [ "$(cat "$S/state" 2>/dev/null)" = active ] ;;
	is-failed) exit 1 ;;
	is-enabled) [ -e "$S/enabled" ] ;;
	enable) touch "$S/enabled" ;;
	disable) rm -f "$S/enabled"; echo inactive >"$S/state"; echo disable >>"$S/calls" ;;
	reset-failed) exit 0 ;;
	restart)
		echo active >"$S/state"
		echo $(($(cat "$S/restarts" 2>/dev/null || echo 0) + 1)) >"$S/restarts"
		# A release that ships server-dist/BAD never becomes healthy.
		if [ -e "$S/srv/crabcraft/dev/current/server-dist/BAD" ]; then touch "$S/unhealthy"; else rm -f "$S/unhealthy"; fi
		;;
	*) echo "unexpected systemctl $*" >&2; exit 2 ;;
esac
EOF
cat >"$T/bin/curl" <<EOF
#!/usr/bin/env bash
[ "\$(cat $T/state 2>/dev/null)" = active ] && [ ! -e $T/unhealthy ]
EOF
printf '#!/usr/bin/env bash\nshift 3\nexec "$@"\n' >"$T/bin/runuser"
printf '#!/usr/bin/env bash\nexit 0\n' >"$T/bin/logger"
printf '#!/usr/bin/env bash\nexit 0\n' >"$T/bin/journalctl"
chmod +x "$T/bin/"*
echo inactive >"$T/state"
echo 0 >"$T/restarts"

# release <name> <server main.mjs content | -> [extra file]
release() {
	mkdir -p "$R/$1/dist"
	echo "$1" >"$R/$1/dist/index.html"
	if [ "$2" != - ]; then
		mkdir -p "$R/$1/server-dist/world"
		printf '%s\n' "$2" >"$R/$1/server-dist/main.mjs"
		echo '{}' >"$R/$1/server-dist/world/world-manifest.json"
		[ -z "${3:-}" ] || echo x >"$R/$1/server-dist/$3"
	fi
	# Older than an hour, so pruning may delete it once it falls out of the kept set.
	find "$R/$1" -exec touch -d '2 hours ago' {} +
}

activate() { CRABCRAFT_HEALTH_TIMEOUT=2 bash "$T/activate.sh" dev "$1" >>"$T/log" 2>&1; }
link() { local t; t=$(readlink "$BASE/$1" 2>/dev/null) || { echo none; return; }; echo "${t##*/}"; }
fails=0
expect() { # expect <label> <want> <got>
	if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: want '$2', got '$3'"; fails=$((fails + 1)); fi
}
restarts() { cat "$T/restarts"; }

# Each release is uploaded right before it is activated, as the deploy workflow does.
deploy() { release "$@"; activate "$1"; }
A=aaaaaaa1 B=aaaaaaa2 C=aaaaaaa3 D=aaaaaaa4 E=aaaaaaa5 S=aaaaaaa6 F=aaaaaaa7 H=aaaaaaa8 X=aaaaaaa9

deploy $A one
expect "first server release starts the server" 1 "$(restarts)"
expect "server link names the release it started from" $A "$(link server)"

deploy $B one
expect "same server-dist keeps the server running" 1 "$(restarts)"
expect "current moves to the new release" $B "$(link current)"
expect "server link stays on the release it started from" $A "$(link server)"
expect "log says it kept running" 1 "$(grep -c 'keeps running' "$T/log")"

deploy $C two
expect "changed server-dist restarts" 2 "$(restarts)"
expect "server link follows the restart" $C "$(link server)"

touch "$T/unhealthy"
deploy $D two
expect "same server-dist but unhealthy restarts" 3 "$(restarts)"
expect "server link after the unhealthy restart" $D "$(link server)"

echo inactive >"$T/state"
deploy $E two
expect "same server-dist but stopped server restarts" 4 "$(restarts)"

deploy $S -
expect "static-only release stops the server" 1 "$(grep -c disable "$T/calls")"
expect "static-only release drops the server link" none "$(link server)"

deploy $F two
expect "server comes back after a static-only release" 5 "$(restarts)"
expect "server link after coming back" $F "$(link server)"

deploy $H two extra
expect "an extra file in server-dist restarts" 6 "$(restarts)"

for i in 1 2 3 4 5 6 7; do deploy "bbbbbbb$i" two extra; done
expect "seven same-server deploys restart nothing" 6 "$(restarts)"
expect "server link still on the release it started from" $H "$(link server)"
expect "the running server's release survives pruning" yes "$([ -d "$R/$H" ] && echo yes || echo no)"
expect "older releases are pruned" no "$([ -d "$R/$A" ] && echo yes || echo no)"

set +e
deploy $X bad BAD
rc=$?
set -e
expect "unhealthy new server fails the activation" 1 "$rc"
expect "failed activation rolls current back" bbbbbbb7 "$(link current)"
expect "rollback restarts the previous server" 8 "$(restarts)"
expect "server link follows the rollback" bbbbbbb7 "$(link server)"

if [ "$fails" -ne 0 ]; then
	echo "--- activate.sh output"
	cat "$T/log"
	echo "$fails check(s) failed"
	exit 1
fi
echo "all checks passed"
