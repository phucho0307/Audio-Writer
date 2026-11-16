#!/usr/bin/env bash
# Copy the local development database into an empty Supabase project.
#
#   bash apps/api/scripts/copy-db-to-supabase.sh
#
# Reads SUPABASE_DB_URL from the repo's .env - the "Session pooler" string
# from Supabase (Connect > Session pooler), with the real password in it.
# The pooler, not the direct connection: the direct host is IPv6-only on the
# free plan, and most home networks and VMs cannot reach it.
#
# Uses pg_dump and psql inside the local aw-postgres container, so nothing
# needs installing. Refuses to touch a target that already has tables: this
# is a one-time copy into a fresh project, never a merge or an overwrite.
# Everything goes in one transaction, so a failure leaves the target empty.
#
# Leaves DATABASE_URL alone. Switch it over yourself once the counts match.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CONTAINER="${PG_CONTAINER:-aw-postgres}"
SOURCE_DB="${SOURCE_DB:-audio_writer}"
SOURCE_USER="${SOURCE_USER:-aw}"

TARGET="${SUPABASE_DB_URL:-}"
[ -n "$TARGET" ] || TARGET="$(grep -E '^SUPABASE_DB_URL=' "$ROOT/.env" | head -1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/')"
if [ -z "$TARGET" ]; then
  echo "SUPABASE_DB_URL is not set in .env" >&2
  exit 1
fi
case "$TARGET" in *sslmode=*) ;; *\?*) TARGET="$TARGET&sslmode=require" ;; *) TARGET="$TARGET?sslmode=require" ;; esac

remote() { docker exec -i "$CONTAINER" psql "$TARGET" -v ON_ERROR_STOP=1 -X -q "$@"; }
local_() { docker exec -i "$CONTAINER" psql -U "$SOURCE_USER" -d "$SOURCE_DB" -X -At "$@"; }

echo "Checking the Supabase database..."
remote -At -c "select 'connected: ' || version();" | cut -c1-60
existing="$(remote -At -c "select count(*) from pg_tables where schemaname = 'public';")"
if [ "$existing" != "0" ]; then
  echo "The target already has $existing tables in public. Stopping - this script only fills an empty project." >&2
  exit 1
fi

# Tables refer to public.vector and public.unaccent by name, so the
# extensions have to live in public rather than Supabase's usual schema.
echo "Creating extensions..."
remote -c "create extension if not exists vector with schema public;" \
       -c "create extension if not exists unaccent with schema public;"

echo "Copying schema and data (one transaction)..."
docker exec "$CONTAINER" pg_dump -U "$SOURCE_USER" -d "$SOURCE_DB" \
    --no-owner --no-privileges --schema=public \
  | sed -E '/^CREATE SCHEMA public;$/d; /^COMMENT ON SCHEMA public IS/d' \
  | remote --single-transaction > /dev/null

echo "Comparing row counts..."
tables="$(local_ -c "select tablename from pg_tables where schemaname = 'public' order by 1;")"
bad=0
for t in $tables; do
  a="$(local_ -c "select count(*) from public.\"$t\";")"
  b="$(remote -At -c "select count(*) from public.\"$t\";")"
  flag="ok"; [ "$a" = "$b" ] || { flag="MISMATCH"; bad=1; }
  printf '  %-24s %8s %8s  %s\n' "$t" "$a" "$b" "$flag"
done

if [ "$bad" = 1 ]; then
  echo "Some tables differ. Do not switch DATABASE_URL yet." >&2
  exit 1
fi
echo "Done. Every table matches."
