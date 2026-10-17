#!/usr/bin/env bash
# Forced command for the deploy user's SSH key (see setup.sh). The key in the GitHub secret
# VM_SSH_KEY can do two things only: upload a release with rsync, and run activate.sh.
set -euo pipefail
set -f # no globbing when the rsync command line is split into words below

cmd=${SSH_ORIGINAL_COMMAND:-}

if [[ "$cmd" =~ ^sudo\ /srv/crabcraft/bin/activate\.sh\ (dev|prod)\ ([0-9a-f]{7,40})$ ]]; then
	exec sudo -n /srv/crabcraft/bin/activate.sh "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
fi

# rsync's receiving side, e.g. "rsync --server -rlce.iLsfxCIvu --delete --link-dest=... . /srv/...".
# Writes are limited by the deploy user's file permissions (only the releases/ directories).
if [[ "$cmd" =~ ^rsync\ --server\ [A-Za-z0-9\ ._/=,+:-]+$ ]] && [[ "$cmd" != *" --sender"* ]]; then
	# shellcheck disable=SC2086 # word splitting is intended; the regex allows no shell syntax
	exec $cmd
fi

echo "deploy-ssh-gate: command not allowed" >&2
logger -t crabcraft-deploy-gate -- "rejected: ${cmd:0:200}" 2>/dev/null || true
exit 1
