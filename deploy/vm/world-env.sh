#!/usr/bin/env bash
# world-env.sh <dev|prod>
#
# ExecStartPre of crabcraft-server@<env> (runs as root). Writes /run/crabcraft/<env>-world.env, which
# the unit reads as an EnvironmentFile. When /etc/crabcraft/<env>-world.json exists, the file turns the
# server world on (WORLD_ENABLED=1) with that config, its assets.source replaced by the source of the
# collision bake inside the release being started (server-dist/world/world-manifest.json). A release
# whose collision bake changed therefore still starts its world. Without the template, or when the
# template or manifest cannot be read, the file is empty and the server runs without a world, so the
# rest of the game (rooms, accounts) keeps running.
set -euo pipefail
umask 027
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

ROOT=/srv/crabcraft
ETC=/etc/crabcraft
RUN=/run/crabcraft

# stderr and syslog only: stdout of world_lines is the env file.
log() { echo "world-env: $*" >&2; logger -t crabcraft-world-env -- "$*" 2>/dev/null || true; }

[ $# -eq 1 ] || { log "usage: world-env.sh <dev|prod>"; exit 1; }
ENV=$1
case "$ENV" in dev | prod) ;; *) log "env must be dev or prod, got '$ENV'"; exit 1 ;; esac

TEMPLATE=$ETC/$ENV-world.json
MANIFEST=$ROOT/$ENV/current/server-dist/world/world-manifest.json
OUT=$RUN/$ENV-world.env

install -d -o root -g crabcraft -m 0750 "$RUN"
tmp=$(mktemp "$RUN/.$ENV-world.XXXXXX")
trap 'rm -f "$tmp"' EXIT

world_lines() {
	[ -f "$TEMPLATE" ] || { log "$ENV: no $TEMPLATE; world off"; return 0; }
	[ -f "$MANIFEST" ] || { log "$ENV: release has no world manifest; world off"; return 0; }
	local source json
	if ! source=$(jq -er '.source | select(type == "string" and test("^[0-9a-f]{64}$"))' "$MANIFEST"); then
		log "$ENV: $MANIFEST has no valid source; world off"
		return 0
	fi
	if ! json=$(jq -ce --arg source "$source" 'select(type == "object") | .assets.source = $source' "$TEMPLATE"); then
		log "$ENV: $TEMPLATE is not a JSON object; world off"
		return 0
	fi
	# systemd reads 'single quoted' values verbatim; the config itself must not contain one.
	case "$json" in *"'"*) log "$ENV: $TEMPLATE contains a single quote; world off"; return 0 ;; esac
	printf "WORLD_ENABLED=1\nWORLD_CONFIG_JSON='%s'\n" "$json"
	log "$ENV: world on, assets.source $source"
}

world_lines >"$tmp"
chgrp crabcraft "$tmp"
chmod 0640 "$tmp"
mv -f "$tmp" "$OUT"
trap - EXIT
