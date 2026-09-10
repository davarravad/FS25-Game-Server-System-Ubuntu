#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "${BASH_SOURCE[0]}")/.."
mkdir -p .update-state
exec 9>.update-state/lock
flock -n 9 || { echo 'Another update is running.' >&2; exit 1; }
if [[ $# != 1 || ! "$1" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo 'Usage: bash scripts/update-node.sh vMAJOR.MINOR.PATCH' >&2; exit 1
fi
release="$1"
[[ -z "$(git status --porcelain --untracked-files=normal)" ]] || { echo 'Working tree is not clean. Commit or back up local changes first.' >&2; exit 1; }
git fetch origin "refs/tags/$release:refs/tags/$release"
git verify-tag "$release"
previous="$(git rev-parse HEAD)"
target="$(git rev-parse "$release^{commit}")"
[[ "$previous" != "$target" ]] || { echo 'Already at the requested release.'; exit 0; }
backup_dir="${UPDATE_BACKUP_DIR:-/var/backups/farmservers}/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"
cp .env "$backup_dir/node.env"
printf '%s\n' "$previous" > "$backup_dir/previous-commit"
docker compose exec -T db sh -c 'exec mariadb-dump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction "$MYSQL_DATABASE"' > "$backup_dir/panel.sql"
[[ -s "$backup_dir/panel.sql" ]] || { echo 'Database backup failed.' >&2; exit 1; }
git checkout --detach "$target"
if ! docker compose build web agent; then
  git checkout --detach "$previous"
  echo 'Build failed; source restored. Services were not restarted.' >&2; exit 1
fi
docker compose up -d --no-deps web agent nginx
if [[ -n "$(docker compose --profile central ps --status running publisher --quiet)" ]]; then
  docker compose --profile central up -d --build --no-deps publisher
fi
echo "Updated control services to $release. Game containers were not restarted."
echo "Backup: $backup_dir"
echo 'Verify the dashboard, telemetry, and node status before updating another host.'
echo "Previous revision: $previous"
