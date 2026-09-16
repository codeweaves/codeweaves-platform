#!/usr/bin/env bash
#
# Copy DATA from the staging database into your LOCAL Docker Postgres.
#
#   bun db:pull
#
# Why data-only rather than a full dump: the schema here is owned by Prisma
# migrations, not by staging. Restoring staging's schema would bring along
# Supabase-specific extensions, roles and policies, and would leave
# `_prisma_migrations` disagreeing with the migrations folder. So this applies
# migrations first, then loads only the rows.
#
# Direction is enforced: it READS staging and WRITES local, never the reverse.
# The target must resolve to a local host or the script refuses.
#
# See docs/adr/0001-environments-and-deploy-pipeline.md.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API_ENV="$REPO_ROOT/apps/api/.env"

TARGET="${TARGET_DATABASE_URL:-postgresql://postgres:postgres@localhost:5433/codeweaves}"

# Source is STAGING_DIRECT_URL from apps/api/.env. Deliberately a separate
# variable from DIRECT_URL: DIRECT_URL is your LOCAL database now, and the two
# must never be confused. Use the non-pooled (port 5432) Supabase URL here,
# because pg_dump cannot run through pgbouncer in transaction mode.
if [[ -z "${SOURCE_DATABASE_URL:-}" ]]; then
  if [[ ! -f "$API_ENV" ]]; then
    echo "error: $API_ENV not found, and SOURCE_DATABASE_URL is not set." >&2
    exit 1
  fi
  SOURCE_DATABASE_URL="$(grep -E '^STAGING_DIRECT_URL=' "$API_ENV" | head -1 | cut -d= -f2- | tr -d '"'"'"'')"
fi

if [[ -z "$SOURCE_DATABASE_URL" ]]; then
  echo "error: STAGING_DIRECT_URL is not set in $API_ENV (and SOURCE_DATABASE_URL is unset)." >&2
  echo "       It is the Supabase DIRECT connection string, port 5432, not the 6543 pooler." >&2
  exit 1
fi

# --- safety: the TARGET must be local ---------------------------------------
target_host="$(printf '%s' "$TARGET" | sed -E 's#^[a-z+]+://([^@]*@)?([^:/?]+).*#\2#')"
case "$target_host" in
  localhost|127.0.0.1|::1|0.0.0.0|host.docker.internal|postgres) ;;
  *)
    echo "error: refusing to write to '$target_host'. This script only ever writes to a local database." >&2
    exit 1
    ;;
esac

source_host="$(printf '%s' "$SOURCE_DATABASE_URL" | sed -E 's#^[a-z+]+://([^@]*@)?([^:/?]+).*#\2#')"

# event_logs is 117 MB of request/provider tracing that is useless on a laptop
# and dominates both the dump and the restore. Everything else comes across.
EXCLUDED_DATA=(
  --exclude-table-data='public.event_logs'
  --exclude-table-data='public._prisma_migrations'
)

DUMP="$(mktemp -t klivo-staging-XXXXXX.sql)"
trap 'rm -f "$DUMP"' EXIT

echo "source : $source_host (read-only)"
echo "target : $target_host"
echo "skipped: event_logs (debug tracing), _prisma_migrations (owned by migrations)"
echo

echo "==> dumping data from staging"
pg_dump "$SOURCE_DATABASE_URL" \
  --data-only \
  --disable-triggers \
  --no-owner \
  --no-privileges \
  --schema=public \
  "${EXCLUDED_DATA[@]}" \
  -f "$DUMP"
echo "    $(du -h "$DUMP" | cut -f1) written"

# Migrations seed the role and permission catalogue, so those rows already
# exist locally and would collide with the ones in the dump. Clearing every
# table first makes the load a clean replace rather than a merge.
echo "==> clearing local tables"
psql "$TARGET" -v ON_ERROR_STOP=1 -q -c "
DO \$\$
DECLARE stmt text;
BEGIN
  SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
    INTO stmt
    FROM pg_tables
   WHERE schemaname = 'public' AND tablename <> '_prisma_migrations';
  IF stmt IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE ' || stmt || ' RESTART IDENTITY CASCADE';
  END IF;
END \$\$;"

echo "==> loading into local"
psql "$TARGET" -v ON_ERROR_STOP=1 -q -f "$DUMP"

echo
echo "==> done"
psql "$TARGET" -q -c "
SELECT 'agents' AS t, count(*) FROM agents
UNION ALL SELECT 'organizations', count(*) FROM organizations
UNION ALL SELECT 'users', count(*) FROM users
UNION ALL SELECT 'chat_sessions', count(*) FROM chat_sessions
UNION ALL SELECT 'chat_messages', count(*) FROM chat_messages;"

cat <<'NOTE'
Encrypted columns (collected_data, agent secrets, pii_tokens) were encrypted with
staging's AGENT_SECRET_KEY. To read them locally, apps/api/.env must carry that
same key, otherwise those values decrypt to null and everything else works.
NOTE
