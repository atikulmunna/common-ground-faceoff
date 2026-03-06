#!/usr/bin/env bash
#
# Common Ground — Database Backup Script (CG-NFR35-38)
#
# NFR35: RPO ≤ 1 hour — scheduled via cron every hour
# NFR36: RTO ≤ 4 hours — restore from latest backup
# NFR37: Backups encrypted at rest (AES-256 via gpg)
# NFR38: Backup integrity verified after each dump
#
# Usage:
#   ./scripts/backup-db.sh
#
# Environment variables (required):
#   DATABASE_URL — PostgreSQL connection string
#   BACKUP_DIR  — local directory for backup storage (default: ./backups)
#   BACKUP_ENCRYPTION_KEY — passphrase for GPG symmetric encryption
#   R2_BUCKET   — (optional) Cloudflare R2 bucket for offsite storage
#
# Cron example (hourly, matching RPO ≤ 1h):
#   0 * * * * /path/to/scripts/backup-db.sh >> /var/log/cg-backup.log 2>&1

set -euo pipefail

TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
BACKUP_DIR="${BACKUP_DIR:-./backups}"
DUMP_FILE="${BACKUP_DIR}/cg_backup_${TIMESTAMP}.sql.gz"
ENC_FILE="${DUMP_FILE}.gpg"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

mkdir -p "${BACKUP_DIR}"

echo "[${TIMESTAMP}] Starting database backup..."

# --- 1. Dump database (compressed) ---
if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set."
  exit 1
fi

pg_dump "${DATABASE_URL}" --no-owner --no-privileges --clean --if-exists \
  | gzip > "${DUMP_FILE}"

DUMP_SIZE=$(stat -c%s "${DUMP_FILE}" 2>/dev/null || stat -f%z "${DUMP_FILE}")
echo "[${TIMESTAMP}] Dump created: ${DUMP_FILE} (${DUMP_SIZE} bytes)"

# --- 2. Verify integrity (NFR38) ---
if ! gzip -t "${DUMP_FILE}"; then
  echo "ERROR: Backup integrity check failed — corrupt gzip."
  rm -f "${DUMP_FILE}"
  exit 1
fi
echo "[${TIMESTAMP}] Integrity check passed."

# --- 3. Encrypt at rest (NFR37 — AES-256) ---
if [ -n "${BACKUP_ENCRYPTION_KEY:-}" ]; then
  gpg --batch --yes --symmetric --cipher-algo AES256 \
    --passphrase "${BACKUP_ENCRYPTION_KEY}" \
    --output "${ENC_FILE}" "${DUMP_FILE}"
  rm -f "${DUMP_FILE}"
  echo "[${TIMESTAMP}] Encrypted: ${ENC_FILE}"
  FINAL_FILE="${ENC_FILE}"
else
  echo "[${TIMESTAMP}] WARNING: BACKUP_ENCRYPTION_KEY not set — backup stored unencrypted."
  FINAL_FILE="${DUMP_FILE}"
fi

# --- 4. Offsite copy to R2 (optional) ---
if [ -n "${R2_BUCKET:-}" ] && command -v aws &>/dev/null; then
  R2_ENDPOINT="https://${R2_ACCOUNT_ID:-}.r2.cloudflarestorage.com"
  aws s3 cp "${FINAL_FILE}" "s3://${R2_BUCKET}/backups/$(basename "${FINAL_FILE}")" \
    --endpoint-url "${R2_ENDPOINT}" --quiet
  echo "[${TIMESTAMP}] Uploaded to R2: s3://${R2_BUCKET}/backups/$(basename "${FINAL_FILE}")"
fi

# --- 5. Retention — delete backups older than RETENTION_DAYS ---
find "${BACKUP_DIR}" -name "cg_backup_*" -type f -mtime +"${RETENTION_DAYS}" -delete
echo "[${TIMESTAMP}] Cleaned backups older than ${RETENTION_DAYS} days."

echo "[${TIMESTAMP}] Backup complete."
