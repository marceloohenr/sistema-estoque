#!/usr/bin/env bash
set -euo pipefail
umask 077

BACKUP_DIR=/var/backups/guimaraes-estoque
UPLOADS_DIR=/home/guimaraes/apps/estoque/shared/uploads
install -d -m 700 "$BACKUP_DIR"
exec 9>"$BACKUP_DIR/.lock"
flock -n 9 || exit 0
stamp=$(date -u +%Y%m%dT%H%M%SZ)
database="$BACKUP_DIR/$stamp-database.dump"
uploads="$BACKUP_DIR/$stamp-uploads.tar.gz"

sudo -u postgres pg_dump -p 5433 -Fc --no-owner --no-acl guimaraes_estoque > "$database.partial"
tar -czf "$uploads.partial" -C "$UPLOADS_DIR" .
pg_restore --list "$database.partial" > /dev/null
tar -tzf "$uploads.partial" > /dev/null
mv "$database.partial" "$database"
mv "$uploads.partial" "$uploads"
# Retém catorze dias apenas dos arquivos gerados por esta rotina.
find "$BACKUP_DIR" -maxdepth 1 -type f -name '*-database.dump' -mtime +14 -delete
find "$BACKUP_DIR" -maxdepth 1 -type f -name '*-uploads.tar.gz' -mtime +14 -delete
printf 'Backup concluido: %s\n' "$stamp"
