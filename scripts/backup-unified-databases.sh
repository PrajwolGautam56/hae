#!/usr/bin/env bash
set -euo pipefail

: "${UNIFIED_DATABASE_URL:?Set UNIFIED_DATABASE_URL to the shared Supabase Postgres connection string}"

BACKUP_ROOT="${BACKUP_ROOT:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DESTINATION="${BACKUP_ROOT}/${STAMP}"
mkdir -p "${DESTINATION}"
chmod 700 "${BACKUP_ROOT}" "${DESTINATION}"

pg_dump "${UNIFIED_DATABASE_URL}" --format=custom --no-owner --no-acl --file="${DESTINATION}/unified.dump"
pg_dump "${UNIFIED_DATABASE_URL}" --schema-only --no-owner --no-acl --file="${DESTINATION}/unified-schema.sql"

if [[ -n "${CONTROL_DATABASE_URL:-}" ]]; then
  pg_dump "${CONTROL_DATABASE_URL}" --format=custom --no-owner --no-acl --file="${DESTINATION}/control.dump"
fi

(cd "${DESTINATION}" && shasum -a 256 ./* > SHA256SUMS)
chmod 600 "${DESTINATION}"/*
printf 'Verified backup written to %s\n' "${DESTINATION}"
