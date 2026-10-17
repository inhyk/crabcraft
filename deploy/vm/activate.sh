#!/usr/bin/env bash
# activate.sh <dev|prod> <git-sha>
#
# Points /srv/crabcraft/<env>/current at releases/<git-sha> (an atomic rename), restarts
# crabcraft-server@<env> when that release ships server-dist/main.mjs (stops it when not),
# waits for GET /healthz, and switches back to the previous release if the check fails.
# Keeps the last 5 activated releases plus current and previous; older ones are deleted.
#
# The deploy user may run exactly this script through sudo (/etc/sudoers.d/crabcraft-deploy),
# so every argument is validated before use.
set -euo pipefail
umask 022
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

ROOT=/srv/crabcraft
KEEP=5
HEALTH_TIMEOUT=${CRABCRAFT_HEALTH_TIMEOUT:-45}

log() { echo "activate: $*"; logger -t crabcraft-activate -- "$*" 2>/dev/null || true; }
die() { log "error: $*"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root (sudo)"
[ $# -eq 2 ] || die "usage: activate.sh <dev|prod> <git-sha>"

ENV=$1
SHA=$2
case "$ENV" in
	dev) PORT=8081 ;;
	prod) PORT=8080 ;;
	*) die "env must be dev or prod, got '$ENV'" ;;
esac
[[ "$SHA" =~ ^[0-9a-f]{7,40}$ ]] || die "sha must be 7-40 lowercase hex characters"

BASE=$ROOT/$ENV
RELEASES=$BASE/releases
UNIT=crabcraft-server@$ENV

exec 9>"/run/lock/crabcraft-activate-$ENV.lock"
flock -w 600 9 || die "another activation of $ENV is still running"

# A release is a real directory (not a symlink) owned by the deploy upload, with dist/index.html.
check_release() {
	local dir=$RELEASES/$1
	[ -d "$dir" ] && [ ! -L "$dir" ] || return 1
	[ -d "$dir/dist" ] && [ ! -L "$dir/dist" ] || return 1
	[ -f "$dir/dist/index.html" ] || return 1
	if [ -e "$dir/server-dist" ] && { [ -L "$dir/server-dist" ] || [ ! -d "$dir/server-dist" ]; }; then
		return 1
	fi
	return 0
}

has_server() { [ -f "$RELEASES/$1/server-dist/main.mjs" ]; }

link_sha() { # prints the sha a symlink in $BASE points at, or nothing
	local target
	target=$(readlink "$BASE/$1" 2>/dev/null) || return 0
	target=${target##*/}
	[[ "$target" =~ ^[0-9a-f]{7,40}$ ]] && echo "$target"
	return 0
}

point() { # point <link-name> <sha>: atomic symlink replacement
	ln -sfn "releases/$2" "$BASE/.$1.tmp"
	mv -Tf "$BASE/.$1.tmp" "$BASE/$1"
}

healthy() {
	local i
	for ((i = 0; i < HEALTH_TIMEOUT; i++)); do
		if curl -fsS --max-time 2 -o /dev/null "http://127.0.0.1:$PORT/healthz"; then
			return 0
		fi
		sleep 1
	done
	return 1
}

# Start or stop the env's server to match the release that `current` now points at.
run_server_for() {
	if has_server "$1"; then
		systemctl enable --quiet "$UNIT"
		systemctl reset-failed "$UNIT" 2>/dev/null || true
		systemctl restart "$UNIT"
		healthy
	else
		if systemctl is-enabled --quiet "$UNIT" 2>/dev/null || systemctl is-active --quiet "$UNIT"; then
			log "release $1 has no server-dist; stopping $UNIT"
		fi
		systemctl disable --now --quiet "$UNIT" 2>/dev/null || true
		return 0
	fi
}

check_release "$SHA" || die "$RELEASES/$SHA is not a complete release (needs dist/index.html)"

PREV=$(link_sha current)
log "$ENV: ${PREV:-none} -> $SHA$(has_server "$SHA" && echo ' (with server)' || echo ' (static only)')"

point current "$SHA"

if ! run_server_for "$SHA"; then
	log "$UNIT did not pass /healthz on port $PORT within ${HEALTH_TIMEOUT}s"
	journalctl -u "$UNIT" -n 30 --no-pager 2>/dev/null | sed 's/^/  /' || true
	if [ -n "$PREV" ] && [ "$PREV" != "$SHA" ] && check_release "$PREV"; then
		log "rolling $ENV back to $PREV"
		point current "$PREV"
		if run_server_for "$PREV"; then
			log "rollback to $PREV is healthy"
		else
			log "rollback to $PREV is not healthy either"
		fi
	else
		log "no previous release to roll back to; $ENV stays on $SHA"
	fi
	die "activation of $SHA failed"
fi

if [ -n "$PREV" ] && [ "$PREV" != "$SHA" ]; then
	point previous "$PREV"
fi
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $SHA" >>"$BASE/history"

# Prune: keep the last $KEEP activated releases plus current and previous.
declare -A keep=()
while read -r s; do
	[ -n "$s" ] && keep[$s]=1
done < <(awk '{print $2}' "$BASE/history" | tac | awk '!seen[$0]++' | head -n "$KEEP")
keep[$SHA]=1
cur_prev=$(link_sha previous)
[ -n "$cur_prev" ] && keep[$cur_prev]=1

for dir in "$RELEASES"/*; do
	[ -e "$dir" ] || continue
	name=${dir##*/}
	[[ "$name" =~ ^[0-9a-f]{7,40}$ ]] || continue
	[ -n "${keep[$name]:-}" ] && continue
	log "pruning release $name"
	# Release files belong to the deploy user; delete them as that user, never as root.
	runuser -u deploy -- rm -rf -- "$dir" || log "could not prune $dir"
done

log "$ENV is live on $SHA"
