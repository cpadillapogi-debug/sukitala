#!/usr/bin/env bash
# LIVE Supabase equivalent of db/local-dev/test-rls.sh. Read
# docs/LIVE_SUPABASE_VERIFICATION.md before running this.
#
# Key difference from the local script: on real Supabase, `auth.uid()` is
# GoTrue's own built-in function — it reads the PostgREST/session JWT claims
# (`request.jwt.claim.sub`), not a custom session variable. It also means
# test users MUST come from a real signup (GoTrue owns and manages
# auth.users; directly INSERTing rows into it bypasses GoTrue entirely and
# is not representative of real behavior). This script:
#   1. Signs up two real, disposable users via the Auth REST API (anon key
#      only — no service-role key needed anywhere in this script).
#   2. Seeds their businesses/memberships via a privileged Postgres
#      connection (SUPABASE_DB_URL) — these tables are app-owned, not
#      GoTrue-owned, so direct INSERT is correct and normal here.
#   3. For each adversarial assertion, connects as the REAL `authenticated`
#      Postgres role (not a superuser) and sets `request.jwt.claim.sub` to
#      simulate that specific user's request — the same mechanism
#      PostgREST itself uses, and Supabase's own documented way to test
#      RLS policies via direct SQL.
#
# Required env (see docs/LIVE_SUPABASE_VERIFICATION.md):
#   NEXT_PUBLIC_SUPABASE_URL       - public, e.g. https://xxxx.supabase.co
#   NEXT_PUBLIC_SUPABASE_ANON_KEY  - public anon/publishable key
#   SUPABASE_DB_URL                - privileged Postgres connection string
#                                     (Project Settings -> Database).
#                                     NEVER printed by this script.
#
# Exits non-zero on any assertion failure. Safe to re-run — all created
# data is tagged per docs/LIVE_SUPABASE_VERIFICATION.md's "Test data
# convention" and this script cleans up after itself on both success and
# failure (see cleanup() / trap below).
set -euo pipefail

: "${NEXT_PUBLIC_SUPABASE_URL:?Set NEXT_PUBLIC_SUPABASE_URL (see docs/LIVE_SUPABASE_VERIFICATION.md)}"
: "${NEXT_PUBLIC_SUPABASE_ANON_KEY:?Set NEXT_PUBLIC_SUPABASE_ANON_KEY}"
: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL (privileged, server-only — never commit or print this)}"

fail() { echo "FAIL: $1"; exit 1; }
pass() { echo "PASS: $1"; }

TS="$(date +%s)"
EMAIL_A="kiracash-live-verify-${TS}-a@example.com"
EMAIL_B="kiracash-live-verify-${TS}-b@example.com"
PASSWORD="LiveVerify!$(date +%N)Aa1"  # disposable, random-enough, never reused
BUSINESS_A_NAME="KIRACASH_LIVE_VERIFY_${TS}_A"
BUSINESS_B_NAME="KIRACASH_LIVE_VERIFY_${TS}_B"

# psql against the privileged connection. -X ignores any local ~/.psqlrc.
# Never echo $SUPABASE_DB_URL itself anywhere.
PSQL="psql -X -q -t -A -v ON_ERROR_STOP=1 \"$SUPABASE_DB_URL\""

echo "=== Step 1: real signup for two disposable users (Auth REST API, anon key only) ==="

signup() {
  local email="$1"
  curl -sS -X POST "${NEXT_PUBLIC_SUPABASE_URL}/auth/v1/signup" \
    -H "apikey: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${email}\",\"password\":\"${PASSWORD}\"}"
}

SIGNUP_A_JSON="$(signup "$EMAIL_A")"
SIGNUP_B_JSON="$(signup "$EMAIL_B")"

# Parse with node (already a repo dependency) rather than grep/sed, to
# handle real JSON correctly. Never print the full response (may echo
# back an access_token).
USER_A_ID="$(node -e 'const d=JSON.parse(process.argv[1]); console.log((d.user&&d.user.id)||d.id||"")' "$SIGNUP_A_JSON")"
USER_B_ID="$(node -e 'const d=JSON.parse(process.argv[1]); console.log((d.user&&d.user.id)||d.id||"")' "$SIGNUP_B_JSON")"

[ -n "$USER_A_ID" ] || fail "signup for user A did not return a user id — check that email confirmation isn't blocking signup response, or inspect Auth logs in the Supabase dashboard (do not print the raw response, it may contain a token)"
[ -n "$USER_B_ID" ] || fail "signup for user B did not return a user id"
pass "two disposable users signed up via real Supabase Auth"
echo "  (user A id and user B id captured; not printed — not secret, but no reason to)"

cleanup() {
  echo ""
  echo "=== Cleanup: removing disposable test data (KIRACASH_LIVE_VERIFY_${TS}_*) ==="
  eval "$PSQL" -c "
    delete from memberships where business_id in (select id from businesses where name in ('$BUSINESS_A_NAME','$BUSINESS_B_NAME'));
    delete from accounts where business_id in (select id from businesses where name in ('$BUSINESS_A_NAME','$BUSINESS_B_NAME'));
    delete from businesses where name in ('$BUSINESS_A_NAME','$BUSINESS_B_NAME');
  " > /dev/null 2>&1 || echo "  WARNING: automated cleanup of businesses/memberships hit an error — verify manually in the dashboard."
  echo "  Businesses/memberships/accounts tagged '${TS}' removed (best-effort)."
  echo "  NOTE: the two auth.users rows ($EMAIL_A, $EMAIL_B) are NOT deleted by this script —"
  echo "  GoTrue-managed users should be removed via the Supabase dashboard (Authentication ->"
  echo "  Users) or the Admin API with the service-role key, deliberately kept out of this"
  echo "  script since it's designed to never need service-role access."
}
trap cleanup EXIT

echo ""
echo "=== Step 2: seed businesses/memberships via privileged connection ==="
eval "$PSQL" -c "
  insert into businesses (id, name) values (gen_random_uuid(), '$BUSINESS_A_NAME') returning id;
" > /tmp/kiracash_live_verify_biz_a.txt
BUSINESS_A="$(cat /tmp/kiracash_live_verify_biz_a.txt)"
eval "$PSQL" -c "
  insert into businesses (id, name) values (gen_random_uuid(), '$BUSINESS_B_NAME') returning id;
" > /tmp/kiracash_live_verify_biz_b.txt
BUSINESS_B="$(cat /tmp/kiracash_live_verify_biz_b.txt)"
rm -f /tmp/kiracash_live_verify_biz_a.txt /tmp/kiracash_live_verify_biz_b.txt

eval "$PSQL" -c "
  insert into memberships (business_id, user_id, role) values ('$BUSINESS_A', '$USER_A_ID', 'OWNER');
  insert into memberships (business_id, user_id, role) values ('$BUSINESS_B', '$USER_B_ID', 'OWNER');
  insert into accounts (id, business_id, type, name, opening_balance_centavos)
    values (gen_random_uuid(), '$BUSINESS_A', 'CASH', 'A Cash', 0);
  insert into accounts (id, business_id, type, name, opening_balance_centavos)
    values (gen_random_uuid(), '$BUSINESS_B', 'CASH', 'B Cash', 0);
" > /dev/null
pass "businesses, memberships, and cash accounts seeded for both users"

# Runs a query AS the real `authenticated` role, simulating a specific
# user's request the same way PostgREST does. This is the correct,
# Supabase-documented way to test RLS via direct SQL.
as_user() {
  local user_id="$1"; shift
  local sql="$1"
  eval "$PSQL" -c "
    set role authenticated;
    select set_config('request.jwt.claim.sub', '$user_id', true);
    select set_config('request.jwt.claim.role', 'authenticated', true);
    $sql
    reset role;
  "
}

echo ""
echo "=== Step 3: adversarial cross-tenant assertions (User A attacking Business B) ==="

COUNT=$(as_user "$USER_A_ID" "select count(*) from businesses where id = '$BUSINESS_B';" | tail -1)
[ "$COUNT" = "0" ] || fail "User A can read Business B's business row ($COUNT rows)"
pass "User A cannot read Business B's business row"

COUNT=$(as_user "$USER_A_ID" "select count(*) from memberships where business_id = '$BUSINESS_B';" | tail -1)
[ "$COUNT" = "0" ] || fail "User A can read Business B's memberships"
pass "User A cannot read Business B's memberships"

COUNT=$(as_user "$USER_A_ID" "select count(*) from accounts where business_id = '$BUSINESS_B';" | tail -1)
[ "$COUNT" = "0" ] || fail "User A can read Business B's accounts"
pass "User A cannot read Business B's accounts"

set +e
OUT=$(as_user "$USER_A_ID" "
  insert into ledger_entries (business_id, type, account_id, amount_centavos, created_by, note)
  values ('$BUSINESS_B', 'ADJUSTMENT', (select id from accounts where business_id='$BUSINESS_B' limit 1), 100, '$USER_A_ID', 'live-verify cross-tenant attempt');
" 2>&1)
STATUS=$?
set -e
[ "$STATUS" -ne 0 ] || fail "User A successfully inserted a ledger entry into Business B: $OUT"
pass "User A cannot insert a ledger entry into Business B (rejected: $(echo "$OUT" | head -1))"

set +e
OUT=$(as_user "$USER_A_ID" "
  insert into memberships (business_id, user_id, role) values ('$BUSINESS_B', '$USER_A_ID', 'OWNER');
" 2>&1)
STATUS=$?
set -e
[ "$STATUS" -ne 0 ] || fail "User A successfully self-assigned membership into Business B"
pass "User A cannot self-assign membership into Business B (rejected)"

echo ""
echo "=== Step 4: is_business_member() pg_temp shadowing regression (0010 fix) ==="
BEFORE=$(as_user "$USER_A_ID" "select is_business_member('$BUSINESS_B');" | tail -1)
OUT2=$(as_user "$USER_A_ID" "
  create temp table memberships (business_id uuid, user_id uuid, role text);
  insert into memberships select '$BUSINESS_B', '$USER_A_ID', 'OWNER';
  select is_business_member('$BUSINESS_B');
" | tail -1)
[ "$BEFORE" = "f" ] || fail "baseline is_business_member() check was already true — test setup is wrong"
[ "$OUT2" = "f" ] || fail "CRITICAL: pg_temp shadowing attack SUCCEEDED on the live project — is_business_member() returned true after the attack"
pass "is_business_member() pg_temp shadowing attack blocked on the live project"

LEGIT=$(as_user "$USER_A_ID" "select is_business_member('$BUSINESS_A');" | tail -1)
[ "$LEGIT" = "t" ] || fail "is_business_member() broke legitimate access for User A's own business on the live project"
pass "is_business_member() still correctly allows User A's own real membership"

echo ""
echo "=== Step 5: account/business consistency trigger (0011 fix) ==="
set +e
OUT=$(as_user "$USER_A_ID" "
  insert into ledger_entries (business_id, type, account_id, amount_centavos, created_by, note)
  values ('$BUSINESS_A', 'ADJUSTMENT', (select id from accounts where business_id='$BUSINESS_B' limit 1), 100, '$USER_A_ID', 'live-verify cross-account attempt');
" 2>&1)
STATUS=$?
set -e
[ "$STATUS" -ne 0 ] || fail "cross-business account_id was NOT rejected on the live project"
echo "$OUT" | grep -q "does not belong to business_id" || fail "insert failed for the WRONG reason (expected the account/business trigger): $OUT"
pass "ledger_entries.account_id cross-business mismatch rejected by trigger on the live project"

echo ""
echo "=== Step 6: legitimate same-business access still works ==="
OUT=$(as_user "$USER_A_ID" "
  insert into ledger_entries (business_id, type, account_id, amount_centavos, created_by, note)
  values ('$BUSINESS_A', 'ADJUSTMENT', (select id from accounts where business_id='$BUSINESS_A' limit 1), 100, '$USER_A_ID', 'live-verify legitimate write')
  returning id;
")
[ -n "$OUT" ] || fail "User A could not write a legitimate ledger entry to their OWN business — RLS is over-restrictive"
pass "User A can still write legitimate ledger entries to their own business"

COUNT=$(as_user "$USER_A_ID" "select count(*) from businesses where id = '$BUSINESS_A';" | tail -1)
[ "$COUNT" = "1" ] || fail "User A cannot read their OWN business — RLS is over-restrictive"
pass "User A can still read their own business"

echo ""
echo "All live adversarial RLS/tenant-isolation/regression checks passed against the real Supabase project."
