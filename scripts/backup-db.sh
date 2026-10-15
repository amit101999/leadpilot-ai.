#!/bin/sh
# Writes a pg_dump (custom format) of the LeadPilot database to backups/ and deletes dumps
# older than BACKUP_KEEP_DAYS (default 14). Run from the repository root:
#
#   scripts/backup-db.sh
#   # cron, daily at 03:00:  0 3 * * * cd /opt/leadpilot && scripts/backup-db.sh >> backups/backup.log 2>&1
#
# pg_dump runs inside the postgres container with that container's own credentials, so no
# password is needed here. Restore with scripts/restore-db.sh. See docs/deployment.md.
set -eu

BACKUP_DIR="${BACKUP_DIR:-backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
case "$KEEP_DAYS" in
  '' | *[!0-9]*) echo "BACKUP_KEEP_DAYS must be a whole number of days" >&2; exit 1 ;;
esac

umask 077
mkdir -p "$BACKUP_DIR"
target="$BACKUP_DIR/leadpilot-$(date -u +%Y%m%d-%H%M%S).dump"
partial="$target.partial"
trap 'rm -f "$partial"' EXIT

docker compose exec -T postgres sh -c 'pg_dump --format=custom --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$partial"
# Refuse an empty or unreadable dump rather than rotating good backups away.
[ -s "$partial" ] || { echo "Backup failed: the dump is empty" >&2; exit 1; }
docker compose exec -T postgres pg_restore --list < "$partial" > /dev/null
mv "$partial" "$target"
echo "Backup written: $target ($(wc -c < "$target" | tr -d ' ') bytes)"

find "$BACKUP_DIR" -name 'leadpilot-*.dump' -type f -mtime +"$KEEP_DAYS" -print -delete
