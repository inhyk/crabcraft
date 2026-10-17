#!/usr/bin/env bash
# Mirror the media bucket prefix to the local disk Caddy serves at /media/.
# The bucket cannot be public (org policy rejects allUsers), so the VM reads it with its
# service account (roles/storage.objectViewer on the bucket) and serves the copy itself.
set -euo pipefail

SRC=${CRABCRAFT_MEDIA_SRC:-gs://crabcraft-seonn-media/media}
DEST=${CRABCRAFT_MEDIA_DEST:-/srv/crabcraft/media}

GCLOUD=$(command -v gcloud || true)
[ -n "$GCLOUD" ] || GCLOUD=/snap/bin/gcloud

mkdir -p "$DEST"

# An empty prefix makes rsync fail with "matched no objects". Treat that as nothing to do and
# leave the local copy alone, so a listing hiccup never wipes the served videos.
if ! listing=$("$GCLOUD" storage ls "$SRC/" 2>&1); then
	if grep -q "matched no objects" <<<"$listing"; then
		echo "media-sync: $SRC/ is empty, nothing to sync"
		exit 0
	fi
	echo "media-sync: cannot list $SRC/: $listing" >&2
	exit 1
fi

"$GCLOUD" storage rsync --recursive --delete-unmatched-destination-objects --no-user-output-enabled "$SRC" "$DEST"
echo "media-sync: $(find "$DEST" -type f | wc -l) files in $DEST"
