#!/usr/bin/env bash
# Rebuilds the LOCAL, DISPOSABLE test database from scratch and applies the
# entire migration chain in numeric order — the "does the chain work from an
# empty database" check, and the standard way to get a clean DB for
# `npm run db:test-rls` and the integration tests.
#
# Follows db/local-dev/README.md exactly: roles -> migrations -> grants
# (grants MUST come after migrations; GRANT ... ON ALL TABLES only covers
# tables that already exist).
#
# SAFETY: this DROPS the database named below. It refuses to run against any
# host other than localhost, and it is only ever meant for the throwaway
# local-dev Postgres. It must never be pointed at Supabase or any shared or
# production database.
#
# Usage (from repo root):  bash db/local-dev/reset-local-db.sh
set -euo pipefail

PGHOST="${PGHOST:-localhost}"
case "$PGHOST" in
  localhost|127.0.0.1) ;;
  *) echo "REFUSING: PGHOST=$PGHOST is not localhost. This script drops the database." >&2; exit 1 ;;
esac

DB_NAME="${LOCAL_DB_NAME:-kiracash}"   # historical local DB/role names; see README
ADMIN_ROLE="${LOCAL_ADMIN_ROLE:-kiracash}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-kiracash_dev}"
APP_ROLE="${LOCAL_APP_ROLE:-app_user}"
APP_PASSWORD="${APP_USER_PASSWORD:-app_user_dev}"

# Superuser operations go through the postgres OS user (peer auth), the same
# way the README's step 1 / step 3 do.
PG_SUPER() { su postgres -c "psql -v ON_ERROR_STOP=1 -q $*"; }

echo "=== Resetting local database '$DB_NAME' ==="
PG_SUPER "-c \"DROP DATABASE IF EXISTS $DB_NAME;\""
PG_SUPER "-c \"DROP ROLE IF EXISTS $APP_ROLE;\""
PG_SUPER "-c \"DROP ROLE IF EXISTS authenticated;\""
PG_SUPER "-c \"DROP ROLE IF EXISTS $ADMIN_ROLE;\""
PG_SUPER "-c \"CREATE ROLE $ADMIN_ROLE WITH LOGIN PASSWORD '$ADMIN_PASSWORD' SUPERUSER;\""
PG_SUPER "-c \"CREATE DATABASE $DB_NAME OWNER $ADMIN_ROLE;\""
PG_SUPER "-c \"CREATE ROLE authenticated NOLOGIN;\""
PG_SUPER "-c \"CREATE ROLE $APP_ROLE LOGIN PASSWORD '$APP_PASSWORD' IN ROLE authenticated;\""

# Every migration from both directories, ordered by numeric filename prefix.
# This yields exactly the README's interleaving (0000 local shim, 0001-0003,
# 0004-0005 local auth, 0006 onward) and automatically includes new ones.
mapfile -t FILES < <(ls db/local-dev/[0-9]*.sql db/migrations/[0-9]*.sql | awk -F/ '{print $NF"\t"$0}' | sort | cut -f2)

# Guard against duplicate migration numbers (would silently mis-order).
DUPES=$(printf '%s\n' "${FILES[@]}" | xargs -n1 basename | cut -c1-4 | sort | uniq -d)
if [ -n "$DUPES" ]; then
  echo "ERROR: duplicate migration numbers: $DUPES" >&2
  exit 1
fi

export PGPASSWORD="$ADMIN_PASSWORD"
for f in "${FILES[@]}"; do
  echo "--- applying $f"
  psql -h "$PGHOST" -U "$ADMIN_ROLE" -d "$DB_NAME" -q -v ON_ERROR_STOP=1 -f "$f" > /dev/null
done

echo "=== Granting privileges (after all tables exist) ==="
PG_SUPER "-d $DB_NAME -c \"GRANT USAGE ON SCHEMA public, auth TO $APP_ROLE;\""
PG_SUPER "-d $DB_NAME -c \"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO $APP_ROLE;\""
PG_SUPER "-d $DB_NAME -c \"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO $APP_ROLE;\""
PG_SUPER "-d $DB_NAME -c \"GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth TO $APP_ROLE;\""

echo "=== Done: ${#FILES[@]} migrations applied to a fresh '$DB_NAME' ==="
