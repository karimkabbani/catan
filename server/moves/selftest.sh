#!/usr/bin/env bash
# Tests the move log end to end on a throwaway local Postgres: the live schema's games table, card guard and audit
# triggers, then server/migrate-moves.sql (applied twice: it must be safe to re-run). A simulated table plays full
# games the way the app saves them (server/moves/selftest.mjs), and server/moves/replay.mjs must rebuild every one.
# Needs Postgres 13+ (initdb, pg_ctl, psql on PATH or in a standard install folder) and node. Nothing is left behind.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; server="$(cd "$here/.." && pwd)"
for d in /usr/lib/postgresql/*/bin /opt/homebrew/opt/postgresql*/bin /usr/local/opt/postgresql*/bin; do [ -x "$d/initdb" ] && PATH="$d:$PATH"; done
tmp="$(mktemp -d)"; chmod 777 "$tmp"
as() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }   # initdb won't run as root
cleanup() { as pg_ctl -D "$tmp/db" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT
as initdb -D "$tmp/db" -A trust -U postgres >/dev/null
as pg_ctl -D "$tmp/db" -o "-k $tmp -p 55439 -c listen_addresses=''" -l "$tmp/log" -w start >/dev/null
export PGHOST="$tmp" PGPORT=55439 PGUSER=postgres PGDATABASE=postgres PGOPTIONS="-c client_min_messages=warning"
q() { psql -q -v ON_ERROR_STOP=1 "$@" >/dev/null; }
# what Supabase provides that the schema files expect
q -c "create role anon; create role authenticated; create publication supabase_realtime;" 2>/dev/null; q -c " create extension if not exists pgcrypto;"
for f in schema.sql results.sql migrate-final.sql migrate-audit.sql migrate-audit-2.sql; do q -f "$server/$f"; done
# migrate-5-6.sql's bigger card counts (its other half needs the players table, which this test doesn't build)
sed -n '/create or replace function public.catan_card_problems/,/^end \$\$;/p' "$server/migrate-5-6.sql" > "$tmp/cards56.sql"
q -f "$tmp/cards56.sql"
node "$here/selftest.mjs" before          # a game already running before the log is switched on
q -f "$server/migrate-moves.sql"
q -f "$server/migrate-moves.sql"          # safe to run twice
node "$here/selftest.mjs" games "$tmp/rows.json"
node "$here/replay.mjs" "$tmp/rows.json" --out "$tmp/out"
node "$here/selftest.mjs" check "$tmp/out" "$tmp/rows.json"
echo "selftest passed"
