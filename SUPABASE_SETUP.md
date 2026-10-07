# Connecting a Real Supabase Project

This document exists because no live Supabase project is reachable from
the environment this scaffold was built and tested in (no network path to
`supabase.com`, no credentials). Every session that has touched this
codebase has hit the same constraint. This file is the exact, complete
checklist for the person who *does* have a real Supabase account to close
that gap — nothing here has been executed, only prepared and reasoned
through carefully.

## What "activated but unverified" means in this codebase

As of this milestone, `src/lib/auth/provider.ts` is the single dispatcher
every auth entry point uses. It checks `isSupabaseConfigured()` — true only
when both `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
are set — and routes to `supabaseAuthAdapter.ts` when true, `authService.ts`
(the local stand-in) otherwise. **The dispatch logic itself is unit-tested**
(`provider.test.ts`, 5 tests, mocking both branches). **The actual Supabase
network calls inside `supabaseAuthAdapter.ts` have never executed against a
real project.** Following the steps below is what would close that gap —
and step 6 (running the test suite against the real project) is not
optional; completing steps 1–5 without it is "code complete," not "verified."

## Steps

### 1. Create the project

Sign up / log in at [supabase.com](https://supabase.com), create a new
project, and note its region (pick one close to your users/deployment).

### 2. Get your credentials

From Project Settings → API:
- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- **anon / publishable key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY` (safe to
  expose in the browser bundle by design — it's the whole point of RLS)
- **service_role key** → do NOT put this in `NEXT_PUBLIC_*`. This scaffold
  doesn't currently need it anywhere (see "What doesn't need service_role"
  below), but if a future feature does, it must stay server-only.

From Project Settings → Database:
- **Connection string** (direct or pooled) → this scaffold's `DATABASE_URL`
  concept, but see step 4 for why the app doesn't actually need a raw
  Postgres connection string once Supabase Auth is active — `supabase-js`
  talks to Supabase's REST/Auth APIs instead.

### 3. Run the migrations

In the Supabase SQL Editor (or via `supabase db push` with the CLI), run,
**in order, all 11**:

```
db/migrations/0001_core.sql
db/migrations/0002_financial_core.sql
db/migrations/0003_receivables_proofs_saas.sql
db/migrations/0006_self_serve_signup_rls.sql
db/migrations/0007_product_price_constraints.sql
db/migrations/0008_expense_amount_positive.sql
db/migrations/0009_receivable_payment_amount_positive.sql
db/migrations/0010_fix_is_business_member_search_path.sql
db/migrations/0011_account_business_consistency.sql
```

**0010 is not optional.** It fixes a CRITICAL, live-reproduced tenant-isolation
bypass in `is_business_member()` — the single function every RLS policy in
this schema depends on. Running 0001–0003/0006–0009/0011 without 0010 would
deploy a real, exploitable authorization bypass to production. See
`db/migrations/0010_fix_is_business_member_search_path.sql`'s own header
comment for the full vulnerability writeup and `docs/LIVE_SUPABASE_VERIFICATION.md`
for how to verify it's actually closed on your project, not just applied.

**Skip everything in `db/local-dev/`** — those files (`0000_auth_shim.sql`,
`0004_local_auth.sql`, `0005_auth_hardening.sql`) exist only to make the
local stand-in work against plain Postgres, which has no real `auth`
schema of its own. Real Supabase already has `auth.users`, `auth.uid()`,
password hashing, sessions, rate limiting, password reset, and email
verification — all natively, via GoTrue. Running the local-only files
against real Supabase would create tables/schemas that conflict with or
duplicate what Supabase already provides.

Migration `0002` creates the `auth` schema reference via foreign keys to
`auth.users(id)` — this works against real Supabase without modification,
since that table already exists there.

### 4. Configure environment variables

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
```

Setting both of these is what flips `isSupabaseConfigured()` to `true` and
activates the Supabase path in `provider.ts`. `DATABASE_URL` and
`ADMIN_DATABASE_URL` (the local stand-in's Postgres connection strings)
become unused once Supabase Auth handles authentication — the financial
data layer (`src/lib/data/finance.ts`) would need its own follow-up work to
either keep using a direct Postgres connection (Supabase exposes one) or
switch to `supabase-js` queries; this scaffold has not made that change,
since it's a separate concern from auth activation. See
`KNOWN_LIMITATIONS.md`.

### 5. Configure Supabase Auth settings

In Authentication → Providers → Email:
- Decide whether to require email confirmation before login. If enabled,
  `signUp/actions.ts`'s immediate sign-in-after-signup will correctly fail
  until the user confirms — this is expected Supabase behavior, not a bug,
  but the exact UX (what message the user sees) is untested here.

In Authentication → URL Configuration:
- Set the Site URL and Redirect URLs to match your deployment (needed for
  `supabaseRequestPasswordReset`'s `redirectTo` to work).

### 6. Run the full live verification package — REQUIRED, not optional

A single ad-hoc `test:integration` run against a real project isn't enough
to call this "verified" — see `docs/LIVE_SUPABASE_VERIFICATION.md` and
`docs/LIVE_SUPABASE_VERIFICATION_RUNBOOK.md` for the complete, ordered
procedure (auth, two-tenant RLS adversarial testing, the `is_business_member()`
regression, financial integrity, cookies/CSRF, production configuration,
backup posture). That package is what actually closes this gap; running
only the command below checks the financial data layer alone.

```bash
DATABASE_URL="<your Supabase Postgres connection string>" \
NEXT_PUBLIC_SUPABASE_URL="https://<your-project-ref>.supabase.co" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="<your-anon-key>" \
npm run test:integration
```

The existing `finance.integration.test.ts` should pass unchanged (it
queries plain tables via `pg`, not Supabase-specific behavior). Whether
`authService.integration.test.ts` needs adjustment depends on whether you
keep the local stand-in's tables around for reference — if you drop
`db/local-dev/`'s tables entirely on the real project, that test file
won't apply there and a new `supabaseAuthAdapter.integration.test.ts`
would need to be written and run for real, calling `supabaseSignUp`/
`supabaseSignIn`/etc. against the actual project. **This has not been
written**, because doing so meaningfully requires the real project to test
against — writing it blind, without ever running it, would just be more
unverified code.

### 7. Manually verify the end-to-end flow once, in a real browser

Signup → (confirm email if required) → login → dashboard shows real data →
quick-add a sale → utang → record a payment → logout → confirm redirected
away from protected routes → login again → confirm data persisted. This
scaffold's own testing has only ever reached the HTTP/cookie level (no
browser available in the environment it was built in) — a real click-
through in an actual browser is the one thing nothing here has done.

## What doesn't need service_role

Nothing in the current codebase's *active* Supabase path needs the
service-role key. The local stand-in's `getAdminPool()` (RLS-bypassing)
exists because the local stand-in manages its own credentials table and
needs a privileged connection for pre-session operations — real Supabase
Auth doesn't have that problem, since GoTrue itself is the privileged
component and the application never touches credentials directly. If a
future feature genuinely needs service-role access (e.g., an admin
dashboard spanning all tenants), treat that as a new, carefully-scoped
addition — never as a default.
