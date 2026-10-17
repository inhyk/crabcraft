#!/usr/bin/env bash
# rollback.sh <dev|prod> [git-sha]
#
# Re-activates the previous release of an env (the one `previous` points at), or the given
# sha if it is still under /srv/crabcraft/<env>/releases/. It runs activate.sh, so the server
# restart, health check and automatic switch-back behave exactly as in a normal deploy.
# Running it twice without an argument flips between the two most recent releases.
set -euo pipefail

ROOT=/srv/crabcraft
[ "$(id -u)" -eq 0 ] || { echo "rollback: run as root (sudo)" >&2; exit 1; }
[ $# -ge 1 ] && [ $# -le 2 ] || { echo "usage: rollback.sh <dev|prod> [git-sha]" >&2; exit 1; }

ENV=$1
case "$ENV" in dev | prod) ;; *) echo "rollback: env must be dev or prod" >&2; exit 1 ;; esac

if [ $# -eq 2 ]; then
	TARGET=$2
else
	TARGET=$(readlink "$ROOT/$ENV/previous" 2>/dev/null || true)
	TARGET=${TARGET##*/}
	[ -n "$TARGET" ] || { echo "rollback: $ENV has no previous release; pass a sha from:" >&2; ls -1t "$ROOT/$ENV/releases" >&2; exit 1; }
fi

echo "rollback: $ENV -> $TARGET"
exec "$ROOT/bin/activate.sh" "$ENV" "$TARGET"
