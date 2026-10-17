#!/usr/bin/env bash
# Provision crabcraft-1 (Ubuntu 24.04) to serve World of Crabcraft. Idempotent: run it again
# after any change under deploy/vm/. Run as root from a copy of this directory:
#
#   gcloud compute scp --recurse deploy/vm crabcraft-1:/tmp/ --zone asia-northeast3-a --project crabcraft-seonn
#   gcloud compute ssh crabcraft-1 --zone asia-northeast3-a --project crabcraft-seonn \
#     --command 'sudo bash /tmp/vm/setup.sh [--deploy-key /tmp/deploy.pub]'
#
# Installs Node 24 LTS (NodeSource), PostgreSQL 16 (Ubuntu) and Caddy (official apt repo);
# creates the users crabcraft (runs the servers) and deploy (receives releases over SSH),
# the databases crabcraft_dev and crabcraft_prod, /etc/crabcraft/<env>.env, the systemd units,
# the Caddyfile, and the media sync timer. Database passwords go to the env files only and are
# never printed.
set -euo pipefail
umask 022

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
NODE_MAJOR=24
PG_MAJOR=16
ROOT=/srv/crabcraft
ENVS=(dev prod)
declare -A HOST=([dev]=crabcraft-dev.seonn.dev [prod]=crabcraft.seonn.dev)
declare -A PORT=([dev]=8081 [prod]=8080)

step() { printf '\n== %s\n' "$*"; }
die() { echo "setup: $*" >&2; exit 1; }

DEPLOY_KEY_FILE=
while [ $# -gt 0 ]; do
	case $1 in
		--deploy-key) DEPLOY_KEY_FILE=${2:-}; shift 2 ;;
		-h | --help) sed -n '2,15p' "$0"; exit 0 ;;
		*) die "unknown argument: $1" ;;
	esac
done

[ "$(id -u)" -eq 0 ] || die "run as root"
# shellcheck source=/dev/null
. /etc/os-release
[ "${VERSION_ID:-}" = "24.04" ] || echo "setup: warning: written for Ubuntu 24.04, this is ${PRETTY_NAME:-unknown}"
for f in Caddyfile crabcraft-server@.service crabcraft-media-sync.service crabcraft-media-sync.timer \
	activate.sh rollback.sh media-sync.sh deploy-ssh-gate.sh; do
	[ -f "$HERE/$f" ] || die "missing $HERE/$f"
done

export DEBIAN_FRONTEND=noninteractive

step "apt repositories (NodeSource node_$NODE_MAJOR.x, Caddy stable)"
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg rsync openssl debian-keyring debian-archive-keyring apt-transport-https
install -d -m 0755 /etc/apt/keyrings
if [ ! -s /etc/apt/keyrings/nodesource.gpg ]; then
	curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
fi
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" >/etc/apt/sources.list.d/nodesource.list
printf 'Package: nodejs\nPin: origin deb.nodesource.com\nPin-Priority: 600\n' >/etc/apt/preferences.d/nodejs
if [ ! -s /usr/share/keyrings/caddy-stable-archive-keyring.gpg ]; then
	curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
fi
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt >/etc/apt/sources.list.d/caddy-stable.list
chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list

step "packages: nodejs, postgresql-$PG_MAJOR, caddy"
apt-get update -q
apt-get install -y -q nodejs "postgresql-$PG_MAJOR" caddy
node_major=$(node -p 'process.versions.node.split(".")[0]')
[ "$node_major" = "$NODE_MAJOR" ] || die "node $node_major installed, expected $NODE_MAJOR"
echo "node $(node --version), $(psql --version), caddy $(caddy version | cut -d' ' -f1)"

step "users crabcraft and deploy"
getent group crabcraft >/dev/null || groupadd --system crabcraft
id -u crabcraft >/dev/null 2>&1 ||
	useradd --system --gid crabcraft --home-dir /var/lib/crabcraft --shell /usr/sbin/nologin crabcraft
# A real home: the snap-packaged gcloud used by the media sync keeps its state under $HOME/snap.
install -d -o crabcraft -g crabcraft -m 0750 /var/lib/crabcraft
id -u deploy >/dev/null 2>&1 ||
	useradd --system --user-group --home-dir /home/deploy --shell /bin/bash deploy
# '*' (not the locked '!') so sshd accepts key logins; there is no password.
usermod -p '*' deploy
# deploy's home and .ssh are root-owned so the key's forced command cannot be edited away.
install -d -o root -g root -m 0755 /home/deploy /home/deploy/.ssh
if [ -n "$DEPLOY_KEY_FILE" ]; then
	key=$(grep -m1 -E '^ssh-ed25519 [A-Za-z0-9+/=]+( .*)?$' "$DEPLOY_KEY_FILE") || die "$DEPLOY_KEY_FILE holds no ssh-ed25519 public key"
	printf 'restrict,command="%s/bin/deploy-ssh-gate.sh" %s\n' "$ROOT" "$key" >/home/deploy/.ssh/authorized_keys.new
	install -o root -g root -m 0644 /home/deploy/.ssh/authorized_keys.new /home/deploy/.ssh/authorized_keys
	rm -f /home/deploy/.ssh/authorized_keys.new
	echo "installed deploy key $(ssh-keygen -lf /home/deploy/.ssh/authorized_keys | cut -d' ' -f2)"
elif [ ! -s /home/deploy/.ssh/authorized_keys ]; then
	echo "setup: note: deploy has no SSH key yet; rerun with --deploy-key <file.pub>"
fi

step "layout under $ROOT"
install -d -o root -g root -m 0755 "$ROOT" "$ROOT/bin"
for env in "${ENVS[@]}"; do
	install -d -o root -g root -m 0755 "$ROOT/$env"
	install -d -o deploy -g deploy -m 0755 "$ROOT/$env/releases"
done
install -d -o crabcraft -g crabcraft -m 0755 "$ROOT/media"
install -o root -g root -m 0755 "$HERE/activate.sh" "$HERE/rollback.sh" "$HERE/media-sync.sh" \
	"$HERE/deploy-ssh-gate.sh" "$ROOT/bin/"

step "sudoers: deploy may run activate.sh only"
cat >/etc/sudoers.d/.crabcraft-deploy.new <<EOF
# GitHub Actions logs in as deploy (see deploy/vm/deploy-ssh-gate.sh) and may only switch releases.
Cmnd_Alias CRABCRAFT_ACTIVATE = $ROOT/bin/activate.sh dev *, $ROOT/bin/activate.sh prod *
deploy ALL=(root) NOPASSWD: CRABCRAFT_ACTIVATE
EOF
visudo -cqf /etc/sudoers.d/.crabcraft-deploy.new || die "sudoers rule does not parse"
install -o root -g root -m 0440 /etc/sudoers.d/.crabcraft-deploy.new /etc/sudoers.d/crabcraft-deploy
rm -f /etc/sudoers.d/.crabcraft-deploy.new

step "postgresql: roles and databases"
systemctl enable --now postgresql >/dev/null
install -d -o root -g crabcraft -m 0750 /etc/crabcraft
for env in "${ENVS[@]}"; do
	name=crabcraft_$env
	file=/etc/crabcraft/$env.env
	[ -f "$file" ] || install -o root -g crabcraft -m 0640 /dev/null "$file"
	chown root:crabcraft "$file"
	chmod 0640 "$file"

	pw=$(sed -n "s|^DATABASE_URL=postgres://$name:\([0-9a-f]*\)@127\.0\.0\.1:5432/$name\$|\1|p" "$file")
	if [ -z "$pw" ] && ! grep -q '^DATABASE_URL=' "$file"; then
		pw=$(openssl rand -hex 24)
		printf 'DATABASE_URL=postgres://%s:%s@127.0.0.1:5432/%s\n' "$name" "$pw" "$name" >>"$file"
	fi
	if [ -z "$pw" ]; then
		echo "setup: $file has a custom DATABASE_URL; not touching the $name password"
		pw_sql=
	else
		pw_sql="ALTER ROLE $name PASSWORD '$pw';"
	fi
	# SQL goes through stdin so the password never shows up in a process list.
	runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 -d postgres <<SQL
SET log_statement = 'none';
SET log_min_error_statement = 'panic';
DO \$\$ BEGIN
	IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$name') THEN CREATE ROLE $name LOGIN; END IF;
END \$\$;
ALTER ROLE $name WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
$pw_sql
SELECT 'CREATE DATABASE $name OWNER $name' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$name')\gexec
ALTER DATABASE $name OWNER TO $name;
REVOKE ALL ON DATABASE $name FROM PUBLIC;
GRANT ALL ON DATABASE $name TO $name;
SQL
	unset pw pw_sql

	# Non-secret settings: added when missing, existing values are kept.
	for kv in "PORT=${PORT[$env]}" "HOST=127.0.0.1" "ALLOWED_ORIGINS=https://${HOST[$env]}" "TRUST_PROXY=1"; do
		grep -q "^${kv%%=*}=" "$file" || echo "$kv" >>"$file"
	done
	echo "$file: $(cut -d= -f1 "$file" | grep -v '^#' | paste -sd' ' -)"
done

step "systemd units"
server_unit_changed=0
cmp -s "$HERE/crabcraft-server@.service" /etc/systemd/system/crabcraft-server@.service || server_unit_changed=1
install -o root -g root -m 0644 "$HERE/crabcraft-server@.service" "$HERE/crabcraft-media-sync.service" \
	"$HERE/crabcraft-media-sync.timer" /etc/systemd/system/
systemctl daemon-reload
for env in "${ENVS[@]}"; do
	if [ "$server_unit_changed" = 1 ] && systemctl is-active --quiet "crabcraft-server@$env"; then
		echo "unit changed, restarting crabcraft-server@$env"
		systemctl restart "crabcraft-server@$env"
	fi
	echo "crabcraft-server@$env: $(systemctl is-active "crabcraft-server@$env" || true)"
done

step "caddy"
install -o root -g root -m 0644 "$HERE/Caddyfile" /etc/caddy/Caddyfile.new
caddy validate --config /etc/caddy/Caddyfile.new --adapter caddyfile >/dev/null 2>&1 ||
	{ caddy validate --config /etc/caddy/Caddyfile.new --adapter caddyfile; die "Caddyfile does not validate"; }
systemctl enable --quiet caddy
# Reload only on a real change: every reload restarts certificate issuance, and while DNS is
# not pointing here each attempt counts against Let's Encrypt's 5 failed validations per
# hostname per hour.
if cmp -s /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile && systemctl is-active --quiet caddy; then
	rm -f /etc/caddy/Caddyfile.new
	echo "Caddyfile unchanged, caddy not reloaded"
else
	mv -f /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile
	if systemctl is-active --quiet caddy; then systemctl reload caddy; else systemctl start caddy; fi
fi
echo "caddy: $(systemctl is-active caddy)"

step "media sync (gs://crabcraft-seonn-media/media/ -> $ROOT/media/ every 10 minutes)"
systemctl enable --now --quiet crabcraft-media-sync.timer
if systemctl start crabcraft-media-sync.service; then
	journalctl -u crabcraft-media-sync.service -n 3 --no-pager -o cat | sed 's/^/  /'
else
	echo "setup: warning: first media sync failed; see journalctl -u crabcraft-media-sync"
fi

step "done"
for env in "${ENVS[@]}"; do
	echo "$env: https://${HOST[$env]} -> $(readlink "$ROOT/$env/current" 2>/dev/null || echo 'no release yet')"
done
