# Live Supabase Verification — Runbook

Read `LIVE_SUPABASE_VERIFICATION.md` first (environment, safety rules, test
data convention). Fill in `LIVE_SUPABASE_VERIFICATION_RESULTS.md` as you
work through these steps — don't wait until the end to write it up.

Run every step from the repository root, in order. Stop at the first step
that fails and report it rather than continuing past it.

## 1. Preflight

```bash
npm run verify:live:preflight
```

**Expected:** `Preflight PASSED`, exit code 0.
**Failure:** prints `LIVE VERIFICATION BLOCKED — <reason>` and exits 1. Stop
here and fix the reported issue (missing env var, bad URL, unreachable
host) before doing anything else.
**Evidence to save:** the printed project ref/hostname (non-secret).

## 2. Project identity

Confirm the `Project ref` the preflight script printed matches the
Supabase project you intend to target (check against your own records —
this script can't know your intent, only that *a* reachable project is
configured).

**Expected:** ref matches the intended project.
**Failure:** wrong project configured — stop, fix `NEXT_PUBLIC_SUPABASE_URL`.

## 3. Migration-state inspection (READ-ONLY — do this before step 4)

```bash
psql "$SUPABASE_DB_URL" -c "
  select proname from pg_proc
  where pronamespace = 'public'::regnamespace
  order by proname;
"
psql "$SUPABASE_DB_URL" -c "
  select tablename, count(*) as policy_count
  from pg_policies where schemaname = 'public'
  group by tablename order by tablename;
"
psql "$SUPABASE_DB_URL" -c "\dt public.*"
```

Compare against what the 11 migrations in `db/migrations/` (run in the
order listed in `SUPABASE_SETUP.md`) should have created: tables
(`businesses`, `memberships`, `accounts`, `products`, `orders`,
`order_items`, `ledger_entries`, `receivables`, `receivable_payments`,
`payment_proofs`, `marketplace_imports`, `subscriptions`, `audit_logs`,
`expenses`, `customers`), the `is_business_member` function, and RLS
policies on every tenant table.

**Expected:** all expected tables/functions/policies present.
**Failure — nothing present:** none of the migrations have been run yet.
Proceed to step 4 to apply them (from scratch, safe).
**Failure — partially present, or present but different from what the
migration files define:** STOP. Do not guess or blindly rerun migrations
over existing data. Document exactly what differs and resolve it
manually (a targeted `CREATE OR REPLACE` / `ALTER` for just the
differing object) before proceeding — never `DROP` and recreate a table
that might hold real data.

## 4. Apply missing migrations (only if step 3 showed a clean/empty state, or you've resolved a partial state safely)

Via the Supabase SQL Editor, or:

```bash
for f in db/migrations/0001_core.sql \
         db/migrations/0002_financial_core.sql \
         db/migrations/0003_receivables_proofs_saas.sql \
         db/migrations/0006_self_serve_signup_rls.sql \
         db/migrations/0007_product_price_constraints.sql \
         db/migrations/0008_expense_amount_positive.sql \
         db/migrations/0009_receivable_payment_amount_positive.sql \
         db/migrations/0010_fix_is_business_member_search_path.sql \
         db/migrations/0011_account_business_consistency.sql; do
  echo "=== $f ==="
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$f" || { echo "STOPPED at $f"; break; }
done
```

Note: **skip everything in `db/local-dev/`** — those are the local
Postgres stand-in's own auth shim, not needed against real Supabase (see
`SUPABASE_SETUP.md`).

**Expected:** each file applies cleanly, in order.
**Failure:** stop at the first error — do not skip ahead or force through.
**Evidence to save:** which migrations were applied this run vs. already present.

## 5. Live Auth

Using the app itself (deployed, or `npm run dev`/`npm run build && npm start`
pointed at the real project) or direct REST calls to
`${NEXT_PUBLIC_SUPABASE_URL}/auth/v1/*`:

- Signup with a disposable `kiracash-live-verify-<ts>-*@example.com` address
- Login with correct credentials
- Login with an intentionally wrong password (expect rejection, generic message)
- Session persists across a page reload / repeated `getCurrentUserId()` call
- Logout actually invalidates the session (a subsequent protected-route
  request must fail)
- Password reset request (expect the SAME response whether or not the
  email exists — do not eyeball this from the UI alone; compare the two
  raw responses)
- Password reset completion via the emailed link (manual — see "what
  can't be automated")
- Email verification behavior: confirm whether your project's Auth
  settings require confirmed email before login, and that the app's
  behavior matches what you configured (not a right/wrong answer — a
  deliberate setting to confirm)

**Expected:** all of the above behave as designed.
**Cannot be automated:** actually clicking the emailed reset/verification
link in a browser, and the `/auth/callback` PKCE exchange it triggers —
do this manually once.
**Evidence to save:** pass/fail per bullet. Never save the actual password,
token, or reset link.

## 6. Two-tenant live RLS

```bash
npm run verify:live:rls
```

This runs the full adversarial suite from `db/live-verify/test-rls-live.sh`:
cross-tenant read/write rejection, membership self-assignment rejection,
the `is_business_member()` pg_temp regression, the account/business
consistency trigger, and confirms legitimate same-business access still
works. It signs up its own two disposable users and cleans up the
businesses/memberships/accounts it creates on exit (see the script's own
cleanup, and step 18 below for the one thing it deliberately leaves for
you).

**Expected:** every `PASS:` line, script exits 0.
**Failure:** any `FAIL:` line — this is a live tenant-isolation bypass.
Treat as CRITICAL, stop everything else, reproduce/confirm, fix, rerun
this script until green, then continue.

## 7. SECURITY DEFINER regression

Covered by step 6 above (the `is_business_member()` section of
`test-rls-live.sh`). If you want to double-check the function definition
directly:

```bash
psql "$SUPABASE_DB_URL" -c "\sf is_business_member"
```

**Expected:** references `public.memberships` (schema-qualified) and has
`search_path=''` set — matching `db/migrations/0010_fix_is_business_member_search_path.sql`.

## 8. Ledger / financial integrity

Also largely covered by step 6 (cross-tenant ledger insert rejection,
account/business consistency). Additionally, using the live RLS script's
seeded test businesses (or your own disposable ones) and the app itself:

- Record a paid sale → revenue, cash, and Spendable Cash all move as expected
- Record a utang (unpaid) sale → receivable created, cash does NOT increase
- Partial payment → receivable decreases, cash increases, ledger entry correct
- Full payment → receivable reaches settled state
- Attempt overpayment → rejected (`OverpaymentError`)
- Attempt a zero or negative payment → rejected (`InvalidPaymentAmountError`)
- Attempt a zero or negative expense → rejected (schema + `assertPositiveCentavos` + DB constraint)
- Attempt a zero/negative product selling price or COGS → rejected (DB constraint)
- Confirm an UPDATE or DELETE on any `ledger_entries` row is rejected

**Expected:** matches the local integration-test behavior exactly (same
assertions as `finance.integration.test.ts`, now against the real project).
**Evidence to save:** which specific scenarios you exercised and the result.

## 9. Concurrency (optional, if you have a safe way to fire two requests simultaneously)

Fire two simultaneous payment requests against the same disposable
receivable (e.g. two parallel `curl`/script invocations) and confirm only
one succeeds, matching the row-locking behavior already proven locally in
`finance.integration.test.ts`.

**Expected:** exactly one payment succeeds; the other is rejected (either
as an overpayment, or blocked by the `FOR UPDATE` row lock and then
correctly evaluated once the first commits).
**If skipped:** mark NOT TESTED in the results doc, don't guess.

## 10. Server-side authorization / IDOR against the deployed app

Using the actual deployed app (not raw SQL): sign in as one disposable
user, then attempt to tamper with any client-visible identifier (a
receivable ID from the other tenant, if you can obtain one; a forged
account ID in a request body) and confirm the server action rejects it
rather than trusting the client value. This exercises the *application*
authorization layer on top of the *database* RLS layer already proven in
step 6 — both matter.

**Expected:** rejected, same as the local behavior already proven in
`finance.integration.test.ts` and `authService.integration.test.ts`.

## 11. Rate limiting

Within the app's own limits (do not hammer production infrastructure):

- Attempt 4+ logins with a wrong password for one disposable account within
  the window → the 4th+ should be rate-limited
- Attempt 4+ password-reset requests for the same disposable email → the
  4th+ should be silently capped, but return the IDENTICAL response as the
  first (see `d36e2ed`'s commit message for why this matters — a differing
  response would itself leak whether the email exists)

**Expected:** limit activates; enumeration-safe response preserved either way.
**Note:** this app's real Supabase Auth branch (`supabaseAuthAdapter.ts`)
does not implement its own rate limiting — GoTrue has its own built-in
limits. Confirm what those are in your project's Auth settings rather than
assuming this repo's local rate-limit code applies once Supabase is active.

## 12. Cookies / HTTPS (deployed environment only — not local `npm run dev`)

Using browser dev tools or `curl -v` against the deployed HTTPS URL, inspect
the actual `Set-Cookie` header on login:

**Expected:** `HttpOnly`, `Secure`, `SameSite=Lax`, correct `Path`.
**Cannot be verified from source code alone** — `secure: process.env.NODE_ENV
=== "production"` in `authService.ts` is correct in principle, but only
this step proves the deployed environment actually sets `NODE_ENV=production`.

## 13. CSRF / Server Action protection (deployed environment)

Repeat the test already done locally in the security audit (forged
`Origin` header against a live Server Action endpoint), but against the
real deployed origin:

```bash
curl -s -i -X POST https://<your-deployed-domain>/login \
  -H "Next-Action: 0000000000000000000000000000000000000000" \
  -H "Origin: https://attacker.example" \
  -H "Content-Type: text/plain;charset=UTF-8" --data '[]'
```

**Expected:** rejected before any action logic runs (a `500` with a bare
digest, no `x-nextjs-action-not-found` header — see the local test's
findings for exactly what this looks like). A same-origin request with the
same fake action ID should instead get `404 Server action not found`.
**Do not** set `experimental.serverActions.allowedOrigins` in
`next.config.ts` to make this pass — that would weaken real protection.

## 14. Production configuration

- Confirm `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` in the deployment's actual
  env config match the intended project (not a staging/test project by
  accident)
- Confirm no `service_role` key exists in any deployment env var meant for
  the client bundle
- `grep -r` the deployed build output's client-side JS bundles for the
  literal string `service_role` — should find nothing
- Confirm `git log --all -- .env .env.local .env.production` is empty (no
  secret file was ever committed, even historically)
- Confirm the local-auth fallback (`authService.ts`) is never reachable in
  production — it only activates when `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY`
  are unset, so as long as both are correctly set in the deployment, this
  is structurally impossible, not just "shouldn't happen"

**Expected:** all clear.
**Failure:** treat as CRITICAL (any service-role exposure) or HIGH
(anything else here) and stop to fix before continuing.

## 15. Backup / recovery posture (Supabase dashboard — not automatable)

In the Supabase dashboard, Database → Backups:

- Record the project's plan/tier
- Record what backup capability is actually enabled (daily backups?
  point-in-time recovery? what retention window?)
- Do **not** perform an actual restore/recovery exercise against this
  project unless you have a truly disposable project to test it on — this
  runbook does not require that, only that you document what's configured.

**Expected output:** `BACKUP CONFIGURATION OBSERVED: <details>`. Do NOT
write `RECOVERY EXERCISE VERIFIED` unless you actually performed one on a
disposable project.

## 16. Post-verification local regression

After all live steps:

```bash
npm run typecheck
npm run lint
npm run test
npm run db:test-rls   # the LOCAL suite, still against local Postgres — confirms nothing here regressed it
npm run build
npm audit --omit=dev
```

**Expected:** identical to the last known-good local baseline (135+
tests, 11/11 local RLS, clean typecheck/lint/build/audit). If live
testing required any code change, it should be a small, targeted, tested
change — not a rewrite — and this regression pass is what proves it
didn't break anything already proven.

## 17. If a live-only fix was needed

- Smallest correct change only
- Add a regression test (extend the relevant local test file, or add to
  `test-rls-live.sh` if the finding is Supabase-specific)
- Rerun everything in step 16
- Commit locally with a clear message, same discipline as every other
  security commit this project has made (see `git log --oneline` for the
  established pattern: `fix(security): ...` with full reproduction detail
  in the body)
- Do not bundle this with unrelated work

## 18. Cleanup

`test-rls-live.sh` cleans up the businesses/memberships/accounts it
creates automatically (on both success and failure, via its own `trap`).
It deliberately does **not** delete the two `auth.users` rows it
signs up — remove those manually via Supabase dashboard → Authentication →
Users (search for `kiracash-live-verify-`), or the Admin API with the
service-role key if you're scripting this and have that key available in
a context that's appropriate for it (this runbook's own scripts never
need or use it).

**Expected:** no `KIRACASH_LIVE_VERIFY_*` businesses remain; the two test
auth users removed.
**Verify:** `select count(*) from businesses where name like 'KIRACASH_LIVE_VERIFY_%';` returns `0`.

## 19. Final report

Fill in `LIVE_SUPABASE_VERIFICATION_RESULTS.md` completely before calling
this done.
