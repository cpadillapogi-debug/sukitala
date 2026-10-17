#!/usr/bin/env bash
# Integration test: proves tenant isolation actually works at the database
# level, not just "the SQL looks right." Run against a local Postgres with
# the migrations + auth shim applied (see README "Local database testing").
#
# Self-seeding and idempotent: running this fresh (e.g. right after applying
# migrations, with no prior manual setup) works — it creates its own two
# test tenants via the ADMIN connection before running any assertions. This
# used to depend on ad-hoc seed commands run by hand each session, which was
# a real reproducibility gap; this version fixes that.
#
# Exits non-zero on any assertion failure.
set -euo pipefail

PGHOST="${PGHOST:-localhost}"
ADMIN_PSQL="psql -h $PGHOST -U kiracash -d kiracash -t -A -v ON_ERROR_STOP=1"
export PGPASSWORD="${ADMIN_PASSWORD:-kiracash_dev}"

fail() { echo "FAIL: $1"; exit 1; }
pass() { echo "PASS: $1"; }

SELLER_A="11111111-1111-1111-1111-111111111111"
SELLER_B="22222222-2222-2222-2222-222222222222"
BUSINESS_A="aaaaaaaa-0000-0000-0000-000000000001"
BUSINESS_B="bbbbbbbb-0000-0000-0000-000000000002"

# --- Idempotent seed, via the admin/superuser connection (bypasses RLS) ---
$ADMIN_PSQL -c "
  insert into auth.users (id, email) values
    ('$SELLER_A', 'seller-a@test.com'), ('$SELLER_B', 'seller-b@test.com')
  on conflict (id) do nothing;

  insert into businesses (id, name) values
    ('$BUSINESS_A', 'Business A'), ('$BUSINESS_B', 'Business B')
  on conflict (id) do nothing;

  insert into memberships (business_id, user_id) values
    ('$BUSINESS_A', '$SELLER_A'), ('$BUSINESS_B', '$SELLER_B')
  on conflict do nothing;

  insert into accounts (id, business_id, type, name, opening_balance_centavos)
  select '99999999-0000-0000-0000-00000000000a', '$BUSINESS_A', 'GCASH', 'A GCash', 100000
  where not exists (select 1 from accounts where business_id = '$BUSINESS_A');

  insert into accounts (id, business_id, type, name, opening_balance_centavos)
  select '99999999-0000-0000-0000-00000000000b', '$BUSINESS_B', 'GCASH', 'B GCash', 999999
  where not exists (select 1 from accounts where business_id = '$BUSINESS_B');

  insert into ledger_entries (business_id, type, account_id, amount_centavos, created_by, note)
  select '$BUSINESS_A', 'SALE_CASH_IN', null, 80000, '$SELLER_A', 'seed sale'
  where not exists (select 1 from ledger_entries where business_id = '$BUSINESS_A');

  insert into customers (id, business_id, name)
  select '88888888-0000-0000-0000-00000000000b', '$BUSINESS_B', 'B''s Customer'
  where not exists (select 1 from customers where business_id = '$BUSINESS_B');

  insert into receivables (id, business_id, customer_id, total_owed_centavos, amount_paid_centavos, status)
  select '77777777-0000-0000-0000-00000000000b', '$BUSINESS_B',
         '88888888-0000-0000-0000-00000000000b', 100000, 0, 'UNPAID'
  where not exists (select 1 from receivables where business_id = '$BUSINESS_B');
" > /dev/null
pass "seed data present (idempotent — safe to re-run)"

# --- Assertions, as the real non-superuser app_user role ---
export PGPASSWORD="${APP_USER_PASSWORD:-app_user_dev}"
PSQL="psql -h $PGHOST -U app_user -d kiracash -t -A -v ON_ERROR_STOP=1"

ROWCOUNT=$($PSQL -c "
  select set_config('kiracash.test_user_id', '$SELLER_A', false);
  select count(*) from accounts;
" | tail -1)
[ "$ROWCOUNT" = "1" ] || fail "seller A should see exactly 1 account, saw $ROWCOUNT"
pass "seller A sees only their own account ($ROWCOUNT row)"

ROWCOUNT=$($PSQL -c "
  select set_config('kiracash.test_user_id', '$SELLER_A', false);
  select count(*) from accounts where business_id = '$BUSINESS_B';
" | tail -1)
[ "$ROWCOUNT" = "0" ] || fail "IDOR: seller A should not see business B's account"
pass "direct IDOR attempt on business B's account_id returns 0 rows"

# --- CRITICAL: is_business_member() pg_temp search-path hijack ---
# This was a LIVE, verified exploit: is_business_member() is SECURITY
# DEFINER and (before the fix in 0010_fix_is_business_member_search_path.sql)
# referenced the `memberships` table unqualified with no search_path
# pinned. Since Postgres always searches pg_temp first for unqualified
# names inside a function body — regardless of that function's own
# search_path — ANY authenticated app_user (no special privilege required;
# creating a temp table needs none) could shadow the real public.memberships
# table with their own, and grant themselves fake membership in ANY
# business. This is the single function every "tenant isolation" RLS
# policy in the schema depends on, so this was a full cross-tenant bypass.
#
# This test proves BOTH halves: the exploit is blocked, AND seller A's own
# real membership still works correctly (the fix didn't accidentally break
# legitimate access by, say, making the function always return false).
OUTPUT=$($PSQL -c "
  select set_config('kiracash.test_user_id', '$SELLER_A', false);
  create temp table memberships (business_id uuid, user_id uuid, role text);
  insert into memberships select '$BUSINESS_B', '$SELLER_A', 'OWNER';
  select is_business_member('$BUSINESS_B') as attack_should_be_false,
         is_business_member('$BUSINESS_A') as legitimate_should_be_true;
")
ATTACK_RESULT=$(echo "$OUTPUT" | tail -1 | cut -d'|' -f1)
LEGIT_RESULT=$(echo "$OUTPUT" | tail -1 | cut -d'|' -f2)
[ "$ATTACK_RESULT" = "f" ] || fail "CRITICAL: pg_temp shadowing attack on is_business_member() SUCCEEDED — tenant isolation bypassed: $OUTPUT"
[ "$LEGIT_RESULT" = "t" ] || fail "is_business_member() broke legitimate access for seller A's real membership: $OUTPUT"
pass "is_business_member() pg_temp shadowing attack blocked, legitimate membership check still works"

# --- Risk A: ledger_entries.account_id must belong to the SAME business as
# ledger_entries.business_id. This was a LIVE, verified gap: RLS on the
# INSERT only checked is_business_member(business_id), never that
# account_id's own business matched — a genuine member of Business A
# (no fake membership needed) could write a ledger_entries row with
# business_id=A but account_id pointing at a real account belonging to a
# completely different Business B. Fixed by
# 0011_account_business_consistency.sql (a BEFORE INSERT trigger, since
# Postgres CHECK constraints can't reference another table).
export PGPASSWORD="${ADMIN_PASSWORD:-kiracash_dev}"
$ADMIN_PSQL -c "
  insert into accounts (id, business_id, type, name, opening_balance_centavos)
  select '99999999-0000-0000-0000-00000000000c', '$BUSINESS_B', 'CASH', 'B Cash (for cross-account test)', 0
  where not exists (select 1 from accounts where id = '99999999-0000-0000-0000-00000000000c');
" > /dev/null
export PGPASSWORD="${APP_USER_PASSWORD:-app_user_dev}"

set +e
OUTPUT=$($PSQL -c "
  select set_config('kiracash.test_user_id', '$SELLER_A', false);
  insert into ledger_entries (business_id, type, account_id, amount_centavos, created_by, note)
  values ('$BUSINESS_A', 'ADJUSTMENT', '99999999-0000-0000-0000-00000000000c', 999999, '$SELLER_A', 'cross-business account_id attempt');
" 2>&1)
set -e
echo "$OUTPUT" | grep -q "does not belong to business_id" || fail "cross-business account_id was NOT rejected: $OUTPUT"
pass "ledger_entries.account_id cross-business mismatch rejected by trigger"

set +e
OUTPUT=$($PSQL -c "
  select set_config('kiracash.test_user_id', '$SELLER_A', false);
  insert into ledger_entries (business_id, type, account_id, amount_centavos, created_by, note)
  values ('$BUSINESS_B', 'ADJUSTMENT', null, 500000, '$SELLER_A', 'cross-tenant injection attempt');
" 2>&1)
set -e
echo "$OUTPUT" | grep -q "row-level security policy" || fail "cross-tenant insert was NOT rejected by RLS: $OUTPUT"
pass "cross-tenant ledger insert rejected by RLS policy"

set +e
OUTPUT=$($PSQL -c "
  select set_config('kiracash.test_user_id', '$SELLER_A', false);
  update ledger_entries set amount_centavos = 0 where business_id = '$BUSINESS_A';
" 2>&1)
set -e
echo "$OUTPUT" | grep -q "append-only" || fail "ledger UPDATE was not rejected by the append-only trigger: $OUTPUT"
pass "ledger_entries UPDATE rejected by append-only trigger"

# --- product_stock_history (0012): same tenant-isolation shape as
# ledger_entries, plus the same product/business consistency check as the
# account/business one above.
export PGPASSWORD="${ADMIN_PASSWORD:-kiracash_dev}"
$ADMIN_PSQL -c "
  insert into products (id, business_id, name, sku, unit_cogs_centavos, selling_price_centavos, stock_qty, reorder_threshold)
  select '99999999-0000-0000-0000-00000000000d', '$BUSINESS_B', 'B Product (for cross-tenant history test)', 'RLS-TEST-B-PRODUCT', 100, 200, 10, 5
  where not exists (select 1 from products where id = '99999999-0000-0000-0000-00000000000d');
" > /dev/null
export PGPASSWORD="${APP_USER_PASSWORD:-app_user_dev}"

ROWCOUNT=$($PSQL -c "
  select set_config('kiracash.test_user_id', '$SELLER_A', false);
  select count(*) from product_stock_history where business_id = '$BUSINESS_B';
" | tail -1)
[ "$ROWCOUNT" = "0" ] || fail "seller A can read business B's product stock history"
pass "seller A cannot read business B's product stock history"

set +e
OUT=$($PSQL -c "
  select set_config('kiracash.test_user_id', '$SELLER_A', false);
  insert into product_stock_history (business_id, product_id, change_qty, previous_qty, new_qty, reason, created_by)
  values ('$BUSINESS_A', '99999999-0000-0000-0000-00000000000d', 5, 10, 15, 'ADJUSTMENT', '$SELLER_A');
" 2>&1)
STATUS=$?
set -e
[ "$STATUS" -ne 0 ] || fail "cross-business product_id in product_stock_history was NOT rejected: $OUT"
echo "$OUT" | grep -q "does not belong to business_id" || fail "insert failed for the WRONG reason (expected the product/business trigger): $OUT"
pass "product_stock_history cross-business product_id mismatch rejected by trigger"

set +e
OUT=$($PSQL -c "
  select set_config('kiracash.test_user_id', '$SELLER_A', false);
  insert into product_stock_history (business_id, product_id, change_qty, previous_qty, new_qty, reason, created_by)
  values ('$BUSINESS_B', '99999999-0000-0000-0000-00000000000d', 5, 10, 15, 'ADJUSTMENT', '$SELLER_A');
" 2>&1)
STATUS=$?
set -e
[ "$STATUS" -ne 0 ] || fail "seller A inserted a product_stock_history row into business B"
pass "seller A cannot insert a product_stock_history row into business B (RLS-blocked)"

# --- Utang-specific RLS checks (new — see KIRACASH_IMPLEMENTATION_PLAN.md) ---

ROWCOUNT=$($PSQL -c "
  select set_config('kiracash.test_user_id', '$SELLER_A', false);
  select count(*) from receivables where business_id = '$BUSINESS_B';
" | tail -1)
[ "$ROWCOUNT" = "0" ] || fail "seller A should not see business B's receivable"
pass "cross-tenant receivable read returns 0 rows"

# Seller A cannot record a payment against Business B's receivable — RLS
# must block the UPDATE on receivables (the actual balance-changing step),
# not just the INSERT on receivable_payments.
OUTPUT=$($PSQL -c "
  select set_config('kiracash.test_user_id', '$SELLER_A', false);
  update receivables set amount_paid_centavos = 100000, status = 'SETTLED'
  where id = '77777777-0000-0000-0000-00000000000b';
" 2>&1)
UPDATED_ROWS=$(echo "$OUTPUT" | grep -oE "UPDATE [0-9]+" | grep -oE "[0-9]+" || echo "")
[ "$UPDATED_ROWS" = "0" ] || fail "cross-tenant receivable UPDATE should affect 0 rows, affected $UPDATED_ROWS: $OUTPUT"
pass "cross-tenant receivable payment UPDATE affects 0 rows (RLS-blocked)"

# --- Self-serve signup RLS checks (new — see 0006_self_serve_signup_rls.sql) ---
# Switch back to the admin password — the utang section above switched
# PGPASSWORD to the app_user password for its $PSQL checks, and $ADMIN_PSQL
# needs the admin one. (This exact mistake was caught by actually running
# this script, not by review — a real bug, not hypothetical.)
export PGPASSWORD="${ADMIN_PASSWORD:-kiracash_dev}"

NEW_USER="f0000000-0000-0000-0000-00000000f001"
OTHER_USER="f0000000-0000-0000-0000-00000000f002"
$ADMIN_PSQL -c "
  insert into auth.users (id, email) values
    ('$NEW_USER', 'self-serve-a@test.com'), ('$OTHER_USER', 'self-serve-b@test.com')
  on conflict (id) do nothing;
" > /dev/null
export PGPASSWORD="${APP_USER_PASSWORD:-app_user_dev}"

# A brand-new user (no existing memberships anywhere) can create their own
# business and add themselves as OWNER — this is what makes self-serve
# signup under the user's OWN session (not a privileged bypass) possible.
#
# IMPORTANT, discovered by actually running this: INSERT ... RETURNING also
# requires the new row to satisfy the table's SELECT policy (not just the
# INSERT policy's WITH CHECK) — and "member can view own business" is false
# for a brand-new business with no membership row yet, so `RETURNING id`
# fails even though the INSERT itself is allowed. The real fix (and what
# the eventual Supabase Auth adapter must do): generate the id CLIENT-SIDE
# and INSERT it explicitly, without RETURNING, avoiding the chicken-and-egg
# SELECT-policy check entirely.
export PGPASSWORD="${ADMIN_PASSWORD:-kiracash_dev}"
NEW_BUSINESS_ID=$($ADMIN_PSQL -c "select gen_random_uuid();" | tail -1)
export PGPASSWORD="${APP_USER_PASSWORD:-app_user_dev}"

OUTPUT=$($PSQL -c "
  select set_config('kiracash.test_user_id', '$NEW_USER', false);
  insert into businesses (id, name) values ('$NEW_BUSINESS_ID', 'RLS Self-Serve Test Business');
" 2>&1)
echo "$OUTPUT" | grep -q "INSERT 0 1" || fail "brand-new user could not create their own business: $OUTPUT"
pass "brand-new user can create their own business under RLS"

OUTPUT=$($PSQL -c "
  select set_config('kiracash.test_user_id', '$NEW_USER', false);
  insert into memberships (business_id, user_id, role) values ('$NEW_BUSINESS_ID', '$NEW_USER', 'OWNER');
" 2>&1)
echo "$OUTPUT" | grep -q "INSERT 0 1" || fail "brand-new user could not add themselves as OWNER: $OUTPUT"
pass "brand-new user can add themselves as OWNER of their own new business"

# The security-relevant boundary: self-assignment only — a user must NEVER
# be able to insert a membership row for a DIFFERENT user_id.
set +e
OUTPUT=$($PSQL -c "
  select set_config('kiracash.test_user_id', '$NEW_USER', false);
  insert into memberships (business_id, user_id, role) values ('$NEW_BUSINESS_ID', '$OTHER_USER', 'OWNER');
" 2>&1)
set -e
echo "$OUTPUT" | grep -q "row-level security policy" || fail "assigning a DIFFERENT user as a member was NOT rejected: $OUTPUT"
pass "a user cannot insert a membership row for a different user (self-assignment only)"

# Cleanup for idempotent re-runs.
export PGPASSWORD="${ADMIN_PASSWORD:-kiracash_dev}"
$ADMIN_PSQL -c "
  alter table ledger_entries disable trigger no_ledger_delete;
  delete from businesses where id = '$NEW_BUSINESS_ID';
  alter table ledger_entries enable trigger no_ledger_delete;
  delete from auth.users where id in ('$NEW_USER', '$OTHER_USER');
" > /dev/null

echo ""
echo "All tenant-isolation, ledger-integrity, utang, and self-serve-signup RLS checks passed."
