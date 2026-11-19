#!/bin/sh
# Nightly copy of the database to R2, keeping the last $KEEP.
#
# Supabase's free plan takes no backups a project can restore from, so this is
# the only copy of accounts, stories and progress outside Supabase itself.
# Restore with:
#   pg_restore --clean --if-exists --no-owner -d "$URL" db-YYYY-MM-DD.dump
set -eu

KEEP="${BACKUP_KEEP:-7}"
HOUR="${BACKUP_HOUR_UTC:-20}"   # 20:00 UTC is 03:00 in Vietnam: nobody reading.
PREFIX="backups/db"

# Prisma's extra parameters (connection_limit, pgbouncer) mean nothing to
# pg_dump and make it refuse the URL.
URL="$(printf '%s' "$DATABASE_URL" | sed 's/?.*$//')?sslmode=require"
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION=auto
S3="aws s3 --endpoint-url https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

once() {
  name="${PREFIX}-$(date -u +%Y-%m-%d).dump"
  echo "backup: dumping to $name"
  # Custom format is already compressed and restores one table at a time.
  # A long COPY through the pooler is sometimes cut off part way ("SSL
  # connection has been closed unexpectedly"), so a failed dump is retried.
  n=1
  until pg_dump --format=custom --no-owner --no-privileges "$URL" > /tmp/db.dump; do
    [ "$n" -ge 3 ] && { rm -f /tmp/db.dump; return 1; }
    echo "backup: dump failed (attempt $n), retrying in a minute"
    n=$((n + 1)); sleep 60
  done
  $S3 cp --only-show-errors /tmp/db.dump "s3://${R2_BUCKET}/${name}"
  echo "backup: $(du -h /tmp/db.dump | cut -f1) uploaded"
  rm -f /tmp/db.dump
  # Names sort by date, so everything before the newest $KEEP goes.
  $S3 ls "s3://${R2_BUCKET}/${PREFIX}-" | awk '{print $4}' | sort | head -n "-${KEEP}" |
    while read -r old; do
      [ -n "$old" ] && $S3 rm --only-show-errors "s3://${R2_BUCKET}/backups/${old}" && echo "backup: removed $old"
    done
}

if [ "${1:-}" = "now" ]; then once; exit 0; fi

while true; do
  now=$(date -u +%s)
  next=$(date -u -d "$(date -u +%Y-%m-%d) ${HOUR}:00:00" +%s)
  [ "$next" -le "$now" ] && next=$((next + 86400))
  echo "backup: next run in $(( (next - now) / 60 )) minutes"
  sleep $((next - now))
  once || echo "backup: FAILED, will try again tomorrow"
done
