# Local database testing

This documents how the schema and data layer were actually verified in this
scaffold — against a real local Postgres instance, not just "the SQL looks
correct." A real Supabase project is still required for production (see
`../../ANTHROPIC_INTEGRATION.md`-style note below on what's not covered).

## What this proves, and what it doesn't

**Proven, with a real running Postgres and an actual non-superuser session:**
- All 3 migrations apply cleanly against plain Postgres 16
  (`0000_auth_shim.sql` + `0001`–`0003`).
- RLS genuinely blocks cross-tenant reads and writes — not just "the policy
  exists," but a real `SELECT`/`INSERT`/`UPDATE` from a session authenticated
  as one business's member fails or returns zero rows against another
  business's data. See `test-rls.sh` — a bug in the original migration
  (missing UPDATE/DELETE policies on `ledger_entries`, which caused RLS to
  silently swallow the UPDATE before the append-only trigger could even fire)
  was caught and fixed by running this, not by review.
- The append-only ledger trigger blocks `UPDATE` and `DELETE`, including a
  cascading `DELETE` from removing the parent business — confirmed via a
  real failed test run before the test's own cleanup logic was fixed to
  account for it.
- `src/lib/data/finance.ts` round-trips real data through Postgres into the
  same `calculateSpendableCash()` used by the unit tests and the dashboard —
  see `finance.integration.test.ts`, 4 passing tests.

**NOT proven, because this is a local Postgres instance, not Supabase:**
- Supabase Auth's actual JWT verification and `auth.uid()` behavior — the
  auth shim (`0000_auth_shim.sql`) fakes `auth.uid()` via a session-local
  Postgres setting for testing purposes only. This is a reasonable proxy for
  RLS logic (the policies only care what `auth.uid()` returns), but it is
  not Supabase Auth itself.
- Supabase Storage, Realtime, or connection pooling behavior.
- Anything about running this against Supabase's hosted infrastructure
  specifically (network latency, pooler limits, etc).

## Running it yourself

Requires a Postgres 16 instance and superuser access to create roles/extensions.

```bash
# 1. Create roles and the database (once)
psql -U postgres -c "CREATE ROLE kiracash WITH LOGIN PASSWORD 'kiracash_dev' SUPERUSER;"
psql -U postgres -c "CREATE DATABASE kiracash OWNER kiracash;"
psql -U postgres -c "CREATE ROLE authenticated NOLOGIN;"
psql -U postgres -c "CREATE ROLE app_user LOGIN PASSWORD 'app_user_dev' IN ROLE authenticated;"

# 2. Apply migrations FIRST (order matters, and this must come before the
#    grants below — GRANT ... ON ALL TABLES IN SCHEMA only covers tables
#    that already exist at the moment it runs. Granting before the tables
#    are created is a no-op for every table these migrations create, and
#    app_user/authenticated end up with no real access even though the
#    GRANT command itself reports success.)
export PGPASSWORD=kiracash_dev
psql -h localhost -U kiracash -d kiracash -v ON_ERROR_STOP=1 -f db/local-dev/0000_auth_shim.sql
psql -h localhost -U kiracash -d kiracash -v ON_ERROR_STOP=1 -f db/migrations/0001_core.sql
psql -h localhost -U kiracash -d kiracash -v ON_ERROR_STOP=1 -f db/migrations/0002_financial_core.sql
psql -h localhost -U kiracash -d kiracash -v ON_ERROR_STOP=1 -f db/migrations/0003_receivables_proofs_saas.sql
psql -h localhost -U kiracash -d kiracash -v ON_ERROR_STOP=1 -f db/local-dev/0004_local_auth.sql
psql -h localhost -U kiracash -d kiracash -v ON_ERROR_STOP=1 -f db/local-dev/0005_auth_hardening.sql
psql -h localhost -U kiracash -d kiracash -v ON_ERROR_STOP=1 -f db/migrations/0006_self_serve_signup_rls.sql
psql -h localhost -U kiracash -d kiracash -v ON_ERROR_STOP=1 -f db/migrations/0007_product_price_constraints.sql
psql -h localhost -U kiracash -d kiracash -v ON_ERROR_STOP=1 -f db/migrations/0008_expense_amount_positive.sql
psql -h localhost -U kiracash -d kiracash -v ON_ERROR_STOP=1 -f db/migrations/0009_receivable_payment_amount_positive.sql
psql -h localhost -U kiracash -d kiracash -v ON_ERROR_STOP=1 -f db/migrations/0010_fix_is_business_member_search_path.sql
psql -h localhost -U kiracash -d kiracash -v ON_ERROR_STOP=1 -f db/migrations/0011_account_business_consistency.sql

# 3. Grant privileges AFTER all migrations have created their tables
psql -U postgres -d kiracash -c "GRANT USAGE ON SCHEMA public, auth TO app_user;"
psql -U postgres -d kiracash -c "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;"
psql -U postgres -d kiracash -c "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO app_user;"
psql -U postgres -d kiracash -c "GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth TO app_user;"

# 4. Seed the two test tenants used by test-rls.sh (see that script's header)
#    — or adapt it to your own seed data.

# 5. Run the RLS integration test
npm run db:test-rls

# 6. Run the data-layer integration test
DATABASE_URL="postgres://app_user:app_user_dev@localhost:5432/kiracash" \
TEST_ADMIN_DATABASE_URL="postgres://kiracash:kiracash_dev@localhost:5432/kiracash" \
npm run test:integration
```

If you ever add a new migration or table, re-run step 3's grants — this is
the standard Postgres `GRANT ... ON ALL TABLES` limitation (it snapshots
existing tables, it does not apply automatically to future ones). An
`ALTER DEFAULT PRIVILEGES` rule would remove the need to re-run this, but
isn't set up here since production (real Supabase) grants are managed by
Supabase itself, not this script.

## Moving to real Supabase

1. Create a project at supabase.com.
2. Run `0001`–`0003` (skip `0000_auth_shim.sql` — Supabase already has a
   real `auth` schema).
3. Point `DATABASE_URL` at Supabase's connection string, using the
   `authenticated`-scoped connection (via a user's session, not the
   `service_role` key) for anything going through `src/lib/data/`.
4. Replace the raw-`pg` pool in `src/lib/data/db.ts` with `supabase-js` if
   you want RLS to key off real Supabase session JWTs instead of the
   `withUserContext` shim — the query logic in `finance.ts` stays the same
   either way, since it's just SQL.
