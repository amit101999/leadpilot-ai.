#!/bin/sh
# Replaces the LeadPilot database with a dump made by scripts/backup-db.sh. Run from the
# repository root:
#
#   scripts/restore-db.sh backups/leadpilot-20261015-030000.dump --yes
#
# The dump is loaded into a scratch database first, so a bad file changes nothing. Then the web
# app is stopped and the two databases are swapped by renaming them in one transaction. The
# previous database is kept as <db>_pre_restore_<timestamp>; drop it once the restore is checked.
set -eu

file="${1:-}"
if [ -z "$file" ] || [ ! -f "$file" ]; then
  echo "Usage: $0 <dump file> --yes" >&2
  exit 1
fi
if [ "${2:-}" != "--yes" ]; then
  echo "This replaces the live database. Re-run with --yes to confirm." >&2
  exit 1
fi

# Runs a shell command inside the postgres container, where POSTGRES_USER and POSTGRES_DB are set.
in_postgres() { docker compose exec -T -e STAMP="$stamp" postgres sh -c "$1"; }
stamp="$(date -u +%Y%m%d_%H%M%S)"

echo "Loading $file into a scratch database..."
in_postgres 'dropdb --if-exists -U "$POSTGRES_USER" "${POSTGRES_DB}_restore" && createdb -U "$POSTGRES_USER" "${POSTGRES_DB}_restore"'
in_postgres 'pg_restore --no-owner --single-transaction --exit-on-error -U "$POSTGRES_USER" -d "${POSTGRES_DB}_restore"' < "$file"

# The rename needs the database to have no open connections, so stop the web app if it runs.
web_running="$(docker compose --profile stack ps --status running --services | grep -x web || true)"
if [ -n "$web_running" ]; then
  docker compose --profile stack stop web
  trap 'docker compose --profile stack start web' EXIT
fi

echo "Swapping databases..."
in_postgres 'psql -v ON_ERROR_STOP=1 --single-transaction -U "$POSTGRES_USER" -d postgres \
  -c "ALTER DATABASE \"$POSTGRES_DB\" RENAME TO \"${POSTGRES_DB}_pre_restore_$STAMP\"" \
  -c "ALTER DATABASE \"${POSTGRES_DB}_restore\" RENAME TO \"$POSTGRES_DB\""'
echo "Restored $file. Previous database kept as <db>_pre_restore_$stamp."
