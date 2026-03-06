#!/usr/bin/env bash
#
# Common Ground — Database Restore Script (CG-NFR36)
#
# Restores the most recent backup (or a specified file) to the target database.
# RTO target: ≤ 4 hours
#
# Usage:
#   ./scripts/restore-db.sh                     # restore latest backup
#   ./scripts/restore-db.sh /path/to/backup.sql.gz.gpg  # restore specific file
#
# Environment variables (required):
#   DATABASE_URL — PostgreSQL connection string for target database
#   BACKUP_ENCRYPTION_KEY — passphrase for GPG decryption (if backup is encrypted)
#   BACKUP_DIR — directory containing backups (default: ./backups)

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RESTORE_FILE="${1:-}"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set."
  exit 1
fi

# --- Find the backup to restore ---
if [ -z "${RESTORE_FILE}" ]; then
  # Auto-select the most recent backup
  RESTORE_FILE=$(ls -1t "${BACKUP_DIR}"/cg_backup_* 2>/dev/null | head -1)
  if [ -z "${RESTORE_FILE}" ]; then
    echo "ERROR: No backups found in ${BACKUP_DIR}."
    exit 1
  fi
  echo "Auto-selected latest backup: ${RESTORE_FILE}"
fi

if [ ! -f "${RESTORE_FILE}" ]; then
  echo "ERROR: File not found: ${RESTORE_FILE}"
  exit 1
fi

echo "Restoring from: ${RESTORE_FILE}"
echo "Target database: ${DATABASE_URL%%@*}@***"

# --- Decrypt if encrypted ---
SQL_FILE="${RESTORE_FILE}"
TEMP_DECRYPTED=""

if [[ "${RESTORE_FILE}" == *.gpg ]]; then
  if [ -z "${BACKUP_ENCRYPTION_KEY:-}" ]; then
    echo "ERROR: Backup is encrypted but BACKUP_ENCRYPTION_KEY is not set."
    exit 1
  fi
  TEMP_DECRYPTED=$(mktemp /tmp/cg_restore_XXXXXX.sql.gz)
  gpg --batch --yes --decrypt \
    --passphrase "${BACKUP_ENCRYPTION_KEY}" \
    --output "${TEMP_DECRYPTED}" "${RESTORE_FILE}"
  SQL_FILE="${TEMP_DECRYPTED}"
  echo "Decrypted backup to temporary file."
fi

# --- Decompress and restore ---
if [[ "${SQL_FILE}" == *.gz ]]; then
  gunzip -c "${SQL_FILE}" | psql "${DATABASE_URL}" --quiet --single-transaction
else
  psql "${DATABASE_URL}" --quiet --single-transaction < "${SQL_FILE}"
fi

# --- Cleanup temp files ---
if [ -n "${TEMP_DECRYPTED}" ]; then
  rm -f "${TEMP_DECRYPTED}"
fi

echo "Restore complete."
echo "Run 'npx prisma migrate deploy' if schema migrations are ahead of the restored data."
