# SukiTala — Implementation Plan & Status

## Context

Built from scratch (no prior repository existed) inside a sandboxed
environment with: no persistent database, no OCR/LLM API credentials, no
network access beyond npm/pip package registries, no deployment target.
Every claim below about what "works" means: actually run in this session
(`npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` all
pass), not merely written and assumed correct.

## What exists (Phase 1 & 2, partial)

### Financial engine — DONE, tested
- `src/lib/money/` — integer-centavos money type, PHP formatting
- `src/lib/finance/profit.ts` — revenue, COGS, gross/net profit
- `src/lib/finance/spendableCash.ts` — the core product metric, with full
  drill-down breakdown
- `src/lib/finance/receivables.ts` — utang state machine, payment
  application, overpayment rejection
- `src/lib/finance/duplicateDetection.ts` — reference-number/image-hash/
  timestamp-proximity duplicate suspicion, non-accusatory
- **29 unit tests, all passing**, directly covering the product spec's own
  worked examples (Cases 1, 2, 4, 5, 6; edge cases: zero orders, overpayment
  rejection, negative-clamping, safety buffer)

### AI boundary — DONE (contract + mock), not connected to a real model
- `src/lib/ai/schema.ts` — Zod contract for all AI/OCR output
- `src/lib/ai/provider.ts` — `AiProvider` interface + `MockAiProvider`
  (explicitly labeled, not a real extraction)

### Database schema — DONE (SQL written, RLS policies written), NOT applied to a live database
- `db/migrations/0001_core.sql` — businesses, profiles, memberships
- `db/migrations/0002_financial_core.sql` — accounts, append-only ledger,
  products, customers, orders, order_items, expenses
- `db/migrations/0003_receivables_proofs_saas.sql` — receivables, payment
  proofs, marketplace imports, audit logs, subscriptions

I could not provision a live Postgres/Supabase instance in this environment
to actually run these migrations end-to-end. They're syntactically
consistent Postgres DDL following the documented conventions (BIGINT money,
RLS-per-table, append-only ledger trigger), but "the SQL runs clean against
a real Supabase project" is unverified and should be the first thing you
check when you connect one.

### UI — DONE for the vertical slice, using demo data
- `/` — landing
- `/dashboard` — Spendable Cash card with drill-down, stat cards, alerts,
  visibly labeled "Demo data"
- `/quick-add` — natural-language input → parse (mock) → mandatory human
  confirmation step → (persistence not wired)

## Update: middleware + callback route made provider-aware (session 11)

This session's spec demanded Supabase become "the sole production
authentication authority" with the old system "no longer active." That
directly conflicts with this same spec's own honest fallback (Phase 19:
"if no real Supabase project, stop short of claiming live verification —
that is an acceptable result") and with "preserve existing working
features" — forcing the switch with zero real credentials configured
anywhere would mean the application can no longer authenticate ANYONE in
this or any similarly-unconfigured environment. Followed the spec's own
designed escape valve instead of breaking the app to satisfy a phrase.

What was genuinely built, real and tested where testable:

- **`middleware.ts` made provider-aware** — the one real gap from the
  audit: it was still hardcoded to the local check regardless of
  configuration, unlike everything else (`sessionContext.ts`,
  `dashboardData.ts`, all 6 auth action files) which already dispatched
  through `provider.ts`. Now branches on `isSupabaseConfigured()`, with a
  real `@supabase/ssr` session-refresh implementation for the Supabase
  path. Re-verified via live HTTP smoke test that the local path (still
  the only one that runs here) is unaffected: unauthenticated → 307, valid
  session → 200 with real data, tampered cookie → 307.
- **`src/app/auth/callback/route.ts`** — the standard Supabase code-
  exchange handler, genuinely missing before this session. Without it,
  Supabase's own email verification and password recovery links would
  have nowhere to land. Fails closed to `/login` if hit without
  configuration or a valid code.
- **`requestPasswordReset`/`resetPassword` now genuinely dispatch** through
  `provider.ts` (previously only signup/login/logout/session did).
  `supabaseResetPassword()` added to the adapter, using
  `supabase.auth.updateUser()` against the recovery session the callback
  route establishes. 5 new dispatcher tests (10 total, up from 5).
- **Phase 15's classification, done honestly**: every "old auth" component
  (authService.ts, local_auth_credentials, bcrypt, custom sessions/reset/
  verification tokens) is genuinely **ACTIVE**, not dead — confirmed by
  grep, not assumed. None could honestly be marked otherwise without a
  real Supabase project to actually switch to.
- Full gate: **60 unit tests** (+5), **49 integration tests** (unchanged),
  **10 RLS checks** (unchanged), typecheck, lint, production build (new
  `/auth/callback` route present as dynamic) — all pass.

### What this session does not and cannot claim

Per Phase 19's own explicit, sanctioned language:
```
CODE COMPLETE: YES
LIVE SUPABASE VERIFIED: NO
REASON: real project credentials/configuration unavailable
```
This remains true and unchanged across every session that has touched this
codebase. The production authentication authority in this and every
environment without real Supabase credentials is, and must honestly remain,
the local stand-in.



Forensic audit first: confirmed `supabaseAuthAdapter.ts` (from session 9)
had zero imports anywhere in `src/` — completely dead code, exactly as
session 9's own report said. This session's job was closing that specific
gap: making the switch real, not adding more unverified Supabase surface
area.

- **`src/lib/auth/provider.ts`**: the real dispatcher. `isSupabaseConfigured()`
  checks both `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`;
  routes to `supabaseAuthAdapter.ts` if both are set, `authService.ts`
  otherwise. Every one of the 6 auth-related files (`signup`, `login`,
  `logout-action`, `forgot-password`, `reset-password`, `verify-email`
  actions) plus `sessionContext.ts` and `dashboardData.ts` now import from
  here — confirmed by grep that zero files import `authService.ts` directly
  except `provider.ts` itself and its own integration test.
- **`provider.test.ts`**: 5 unit tests proving the switch itself works in
  both directions (mocking both adapters) — with no env vars set, every
  call routes to local; with both set, every call routes to Supabase. This
  is genuinely new test coverage, not a restatement of prior work.
- **Password reset/email verification deliberately NOT unified** — the two
  systems' flows differ structurally enough (Supabase's is a redirect +
  recovery-session flow; the local stand-in is a token-hash + form-submit
  flow) that unifying them without a real project to test against risks
  shipping something that looks wired but silently doesn't work. Documented
  as an explicit scope boundary in `provider.ts` itself, not left
  ambiguous.
- **`SUPABASE_SETUP.md`** created — the complete, exact checklist (project
  creation, migrations to run vs. skip, env vars, Auth settings, and
  explicitly: running the test suite against the real project is a
  required step, not optional). Nothing in it has been executed; it's
  prepared, not verified.
- **Live HTTP smoke test, after rewiring**: confirmed `isSupabaseConfigured()`
  correctly returns `false` in this environment (`Supabase configured?
  false`, printed live), signup → session → `/dashboard` returned real
  HTTP 200 with that specific fresh business's real (zero) numbers and a
  "Sign out" button — proving the rewiring caused no regression to the
  still-active local path.
- **Full gate re-run clean**: **55 unit tests** (+5 — the new provider
  tests), **49 integration tests** (unchanged: 23 finance + 26 auth),
  **10 RLS checks** (unchanged), typecheck, lint, production build — all
  pass, all 10 routes present.

### What this milestone does NOT claim

Per this milestone's own explicit rules: this is **not** "Supabase Auth is
now the active production authentication path" — that statement would only
be true with real credentials configured, which none exist here. What
changed is that the switch mechanism is now real and tested, instead of a
completely unwired, dead file. The distinction matters and is preserved
throughout the docs, not blurred.



Forensic audit first, per instructions — answered all 10 required
questions before touching code (see this session's chat transcript for the
full answers). Key finding: the real gap wasn't "Supabase isn't installed"
(expected, unchanged) but that the current signup flow *needs* a
privileged database connection because no RLS policy lets a brand-new user
create their own first business/membership under their own session. That's
the one thing actually fixable and testable without real Supabase
credentials, so that's what this session focused on.

- **Installed `@supabase/supabase-js` and `@supabase/ssr`.**
- **`db/migrations/0006_self_serve_signup_rls.sql`**: two new RLS `INSERT`
  policies — any authenticated user may create a business; a user may only
  insert a membership row for *themselves*, never a different user. This is
  a real, production-relevant migration (applies to actual Supabase, not
  local-only).
- **Found a genuine Postgres RLS subtlety by testing, not by review**:
  `INSERT ... RETURNING` requires the new row to also pass the table's
  *SELECT* policy — which is false for a business with no members yet — so
  `RETURNING id` failed even though the `INSERT` policy itself allowed the
  row. Fixed by using a client-generated UUID inserted explicitly, no
  `RETURNING`. This is now documented in the migration itself and is the
  pattern `supabaseAuthAdapter.ts`'s `signUp` uses.
- **`db/local-dev/test-rls.sh`** gained 3 new checks proving the above:
  self-serve creation succeeds, self-assignment as OWNER succeeds,
  assigning a *different* user is rejected. Verified idempotent (ran twice
  in a row, identical output).
- **`src/lib/supabase/client.ts` / `server.ts`**: browser/server Supabase
  client factories per the current `@supabase/ssr` pattern, anon-key only.
- **`src/lib/auth/supabaseAuthAdapter.ts`**: implements the same
  signUp/signIn/signOut/getCurrentUserId/requestPasswordReset shape as
  `authService.ts`, using real Supabase Auth calls.
- **Deliberately NOT wired into any active path.** `sessionContext.ts` and
  every page still use `authService.ts` — the tested, working local
  stand-in. No live Supabase project is reachable from this environment
  (unchanged across every session), so the adapter has never been run
  against a real project. Activating it without that verification would
  mean replacing tested functionality with untested functionality — this
  milestone's own rules explicitly prohibit exactly that.
- **A real environment reset happened mid-session**: the entire working
  directory was lost partway through (not just uncommitted changes — the
  whole filesystem). Recovered by extracting the last verified archive
  (`kiracash-v0.4.1-auth-hardening-d7e71a7.tar.gz`), reinstalling
  dependencies, reinstalling Postgres, recreating the roles/database, and
  reapplying every migration from scratch — then re-verified the restored
  state matched the pre-reset report exactly (50 unit, 49 integration, 7
  RLS, clean build) *before* redoing this session's new work. This is
  disclosed here because it's a genuine reproducibility test of everything
  documented in `db/local-dev/README.md`, and it held up.
- **Financial regression**: re-ran the full existing financial integration
  suite unchanged — all 23 tests still pass. Not touched this session.
- Full gate: **50 unit tests** (unchanged), **49 integration tests**
  (unchanged — 23 finance + 26 auth), **10 RLS checks** (+3), typecheck,
  lint, production build — all pass.

### Supabase status: architecture prepared, external configuration required

Not "integrated." Not "tested against real Supabase." The client
factories, the adapter, and the RLS migration all exist and the migration
is genuinely tested — against local Postgres. The single highest-leverage
next step, unchanged since session 1: get real Supabase credentials and a
network path to them, then actually run the existing test suite against a
real project before wiring the adapter into any active path.



Forensic audit first, per instructions: confirmed no `@supabase/supabase-js`
installed (still not real Supabase Auth), no rate limiting, no session
revocation, no password reset, no email verification existed — matching
what session 7's own documentation already said. Nothing was rebuilt that
already worked (bcrypt config, httpOnly/secure/sameSite cookies, the
timing-safe login fix, RLS/tenant isolation were all verified intact and
left alone).

- **`db/local-dev/0005_auth_hardening.sql`**: `sessions` (revocation),
  `login_attempts`/`signup_attempts` (rate limiting), `password_reset_tokens`,
  `email_verification_tokens` — all RLS-locked with zero policies, same
  pattern as `0004_local_auth.sql`. `auth.users` gained `email_verified`.
- **Session revocation**: `session.ts`'s token now carries a `sessionId`
  (the `sessions` row's id). Signature+expiry checking stays fast and DB-
  free (used by `middleware.ts`); `getCurrentUserId()` in `authService.ts`
  additionally checks the `sessions` row isn't revoked/expired — this is
  where revocation is actually enforced, right before business data is
  touched, mirroring the existing "middleware = defense-in-depth, real
  check = the data layer" pattern already used for tenant isolation.
- **THE PROOF, exactly reproduced**: created a real user via `signUp()`,
  minted a session token embedding a real `sessions` row's id, booted the
  dev server, confirmed the cookie granted `/dashboard` (HTTP 200), then
  ran `UPDATE sessions SET revoked_at = now() WHERE id = '<id>'` directly
  against Postgres (exactly what `signOut()` does), then re-requested
  `/dashboard` with the SAME cookie — HTTP 307 to `/login`. The token's
  signature was never touched; only the DB row changed. This is the
  concrete answer to "can a stolen/revoked session remain valid?" — no.
- **Rate limiting** (`src/lib/auth/rateLimit.ts`): Postgres-backed, not
  in-memory — deliberately, since an in-process `Map` wouldn't be shared
  across multiple app server instances (the spec's explicit warning) while
  a Postgres table naturally is, consistent with this scaffold's existing
  architecture. Keyed on the normalized email attempted (documented
  tradeoff vs. IP-based — see `KNOWN_LIMITATIONS.md`), applied identically
  regardless of whether that email is registered. `signIn()` checks the
  limit BEFORE calling `verifyCredentials()`, so a blocked request never
  reaches the bcrypt compare.
- **Password reset** (`requestPasswordReset`/`resetPassword`): 32-byte
  random tokens, SHA-256-hashed before persistence, 1-hour expiry,
  single-use enforced via `SELECT ... FOR UPDATE` inside the same
  transaction as the password change (closes a race window where the same
  token could be redeemed twice concurrently). Revokes all sessions for
  that user on success. Generic response regardless of whether the email
  exists — proven by a test asserting the two response messages are
  byte-identical, not just "similar."
- **Email verification** (`verifyEmail`): same token design, 24-hour
  expiry. `email_verified` starts `false`, flips to `true` on success.
  **Deliberately not enforced anywhere yet** — documented as an active
  limitation, not silently glossed over, because enforcing it now (with
  only console-logged links, no real delivery) would lock real users out
  with no way to receive the link.
- **No real email delivery** — `devLogDeliverLink()` writes reset/
  verification links to the server console. Explicitly not production email
  delivery; documented as such everywhere it's relevant, not just once.
- **UI**: `/forgot-password`, `/reset-password`, `/verify-email` pages,
  linked from `/login`. All four routes confirmed present in the production
  build output.
- **Financial regression (spec's Phase 12)**: re-ran the full existing
  financial integration suite unchanged — all 23 tests (revenue, COGS,
  Spendable Cash, paid vs. utang cash behavior, partial/full payment,
  overpayment rejection, concurrency) still pass. The financial engine was
  not touched this session.
- **Security audit (Phase 9)**: repo-wide grep confirmed no `'use client'`
  file references `ADMIN_DATABASE_URL`/`AUTH_SESSION_SECRET`/`SERVICE_ROLE`,
  `password_hash`/`token_hash` are never selected by any function whose
  result reaches a client action, no `NEXT_PUBLIC_` var carries a secret,
  `getAdminPool()` usage is scoped to auth code + rate limiting + test
  fixtures only, and the one `console.log` in production code is exactly
  the documented dev-email stand-in.
- Full gate: **50 unit tests** (+1 — a new "rejects a token missing
  sessionId" test), **49 integration tests** (+17: 23 finance unchanged +
  26 auth, up from 9 — new: 4 rate-limit, 4 revocation-query, 5 password-
  reset, 4 email-verification, plus the original 9), **7 RLS checks**
  (unchanged), typecheck, lint, production build — all pass.

### Supabase status: unchanged — architecture prepared, external configuration required

Still no network path or credentials to a live Supabase project in this
environment. This session hardened the self-hosted stand-in; it did not
and could not attempt the actual Supabase migration. That remains the
single highest-leverage next step whenever real infrastructure access
exists — see "Recommended next session's scope" below.



No live Supabase project is reachable from this environment (no network
path, no credentials — unchanged since session 1). This session built a
real, working auth system against local Postgres instead, deliberately
shaped so the swap to real Supabase Auth later touches only the adapter
layer.

- **`db/local-dev/0004_local_auth.sql`**: `local_auth_credentials` table
  (bcrypt hashes only), RLS-enabled with **zero policies** — stricter than
  "add a restrictive policy," this denies all access to any non-superuser
  role. Local-only, never run against real Supabase (which has this
  natively via GoTrue).
- **`src/lib/data/db.ts`**: split into two connection pools —
  `withUserContext()`/`app_user` (RLS-respecting, all business queries,
  unchanged) and a new `getAdminPool()`/`kiracash` superuser (RLS-bypassing,
  used ONLY by auth pre-session and test fixtures — maps to Supabase's
  `service_role` in production).
- **`src/lib/auth/`**: `password.ts` (bcrypt, cost 12), `session.ts`
  (stateless signed HMAC-SHA256 cookies, `timingSafeEqual` comparison),
  `authService.ts` (`signUp`/`signIn`/`signOut`/`getCurrentUserId`).
- **Found and fixed a real security bug**: `signIn` originally returned
  immediately for a nonexistent email but ran a real bcrypt compare
  (~300-700ms) for a wrong password on a real account — a timing
  side-channel letting an attacker enumerate valid emails via response
  time, even though the error *message* was already generic. Fixed by
  always comparing against a dummy hash when no real one exists, and
  refactored the credential check into a separately-testable
  `verifyCredentials()`. Proven by a test that actually measures response
  timing across both paths, not just asserts the code looks right.
- **`middleware.ts`**: real server-side route protection for `/dashboard`,
  `/quick-add`, `/utang`, on the Node.js runtime (not Edge — the session
  verifier uses Node's `crypto`). Confirmed compiled into the production
  build (`.next/server/middleware.js` present) and confirmed working via a
  real HTTP 307 redirect for unauthenticated requests and for a tampered
  session cookie.
- **`/login`, `/signup` pages**, a logout button, and
  `getPrimaryBusinessIdForUser()` (resolves a real user's business via the
  existing `memberships` table/RLS policy — no new policy needed).
- **Removed the `KIRACASH_DEV_USER_ID`/`KIRACASH_DEV_BUSINESS_ID` env-var
  placeholder entirely** from production code paths. `devContext.ts` was
  renamed to `sessionContext.ts` (the old name was itself a demo-user
  artifact) and rewired onto `getCurrentUserId()`.
- **Security audit performed**: grepped the repo for any `'use client'`
  file referencing `ADMIN_DATABASE_URL`/`AUTH_SESSION_SECRET`/secrets
  (none found), confirmed `getAdminPool()` is only imported by the auth
  service and test fixtures, confirmed no server action ever trusts a
  client-supplied `businessId`/`userId` (all derived from
  `resolveSessionContext()`/`getCurrentUserId()`), confirmed `.env*` is
  gitignored.
- **Live HTTP smoke test**: created a real user via `signUp()`, minted a
  session token with the exact function `signIn()` uses, then via `curl`:
  unauthenticated request to `/dashboard` → real 307 to `/login`; request
  with the valid session cookie → real 200 showing THAT SPECIFIC user's
  real business data (₱3,000.00, "Smoke Test GCash" by name, "Sign out"
  button, "Live" badge — not demo data, not another tenant's numbers,
  proving per-user isolation end-to-end over real HTTP); request with a
  tampered cookie → real 307 rejection.
- Full gate re-run clean: **49 unit tests** (up from 36 — 13 new: 6
  password, 7 session token), **32 integration tests** (up from 23 — 9 new
  auth tests: signup, duplicate-email rejection, weak-password rejection,
  password verification, cross-tenant RLS via actually-signed-up users, and
  the timing-safety measurement), **7 RLS shell-script checks** (unchanged,
  confirmed still passing), typecheck, lint, production build.



Received a repeat of the utang milestone instructions, which described the
gap as still open. Verified the current repo first, as instructed, rather
than assuming — confirmed everything from session 5 (`recordSale` requiring
`customerName` for UNPAID, `recordReceivablePayment`, `/utang` page,
`KNOWN_LIMITATIONS.md` marking it Resolved) was genuinely present and
passing at `git log -1` before touching anything. The instructions were
operating on stale context from earlier in the conversation, not a real
regression.

Closed the two gaps from that instruction set that genuinely weren't
covered yet:

- **Concurrency test**: `recordReceivablePayment` already used
  `SELECT ... FOR UPDATE` row locking, but this had never been exercised
  under real concurrency. Added a test firing two real concurrent
  `recordReceivablePayment` calls at the same receivable via `Promise.all`
  against actual Postgres — confirms exactly one succeeds and the other is
  rejected with `OverpaymentError`, proving the locking actually works
  rather than just looking correct.
- **Explicit invariant tests** (spec's Section 22 framing): added direct
  tests for "remaining = original - paid", "paid cannot exceed original",
  "an UNPAID sale never increases cash," "two payment calls apply as two
  distinct ledger entries, not deduplicated," and "a receivable belongs to
  exactly one business." Most of these were already implied by existing
  tests; making them explicit, named invariants makes regressions easier to
  spot later.
- **Docs**: `ARCHITECTURE.md` had a stale "What's NOT built yet" section
  dating from before sessions 2–6 (still claimed no Supabase data layer
  existed) — rewritten to point at `KNOWN_LIMITATIONS.md` as the single
  current source of truth instead of duplicating a list that goes stale.
  Added a "Receivable / utang lifecycle" section documenting the
  sale-vs-payment asymmetry and the concurrency guarantee.
  `KNOWN_LIMITATIONS.md` gained one new genuine active limitation (no
  natural-language customer disambiguation for standalone utang entry —
  "Maria owes me 800" without a product attached isn't supported) and one
  new resolved entry (concurrency, now proven).

Full gate re-run clean: **36 unit tests**, **23 integration tests** (up
from 17 — 6 new: 1 concurrency + 5 invariants), **7 RLS checks**,
typecheck, lint, production build.



Fixed the next gap flagged at the end of session 4.

- **`recordSale()` extended**: `paymentStatus: "UNPAID"` now requires a
  `customerName` (refuses to create untraceable debt — no anonymous utang),
  resolves-or-creates the customer within the same transaction
  (`findOrCreateCustomerByName`, exact case-insensitive match), and creates
  a real `receivables` row for the exact sale amount. No ledger entry, no
  cash change — order_items/revenue/COGS are still real either way, only
  the cash side differs by payment status.
- **`recordReceivablePayment()`**: new function. Locks the receivable row,
  delegates the actual arithmetic/validation to the existing pure,
  unit-tested `applyReceivablePayment()` (doesn't reimplement it in SQL),
  appends a `RECEIVABLE_PAYMENT` ledger entry, updates the receivable's
  paid amount and derived status, all transactionally. Rejects overpayment
  via a new typed `OverpaymentError` (was a generic `Error` before).
- **Two more real bugs, same class as session 4's, found by testing**:
  `receivable_payments.ledger_entry_id` and
  `payment_proofs.matched_ledger_entry_id` both lacked `ON DELETE`
  behavior, causing the identical FK cascade-ordering failure on business
  deletion. Fixed with `on delete cascade` in
  `db/migrations/0003_receivables_proofs_saas.sql`, applied live to the
  running DB. Caught by `finance.integration.test.ts`'s own teardown, not
  by inspection — same pattern as before, same fix.
- **A real test-fixture bug**: the shared "Heavy Tee" product (10 units
  initial stock) got exhausted by the growing number of tests reusing it
  across the file, causing spurious `InsufficientStockError` failures.
  Fixed by giving the fixture realistic headroom (1000 units), documented
  as a fixture design note, not silently changed.
- **`db/local-dev/test-rls.sh` rewritten to be self-seeding and
  idempotent** — it used to depend on ad-hoc seed commands run by hand each
  session, a real reproducibility gap. Now creates its own two test tenants
  (users, businesses, memberships, accounts, a utang fixture) via the admin
  connection before any assertion runs. Verified idempotent by running it
  twice in a row with identical PASS output. Added 2 new utang-specific
  checks: cross-tenant receivable read returns 0 rows, and — importantly —
  a cross-tenant attempt to UPDATE another business's receivable (the
  actual balance-changing operation, not just the INSERT on
  `receivable_payments`) affects 0 rows.
- **`src/lib/data/devContext.ts`**: extracted the placeholder
  user/business/account resolution (previously duplicated inline in
  `quick-add/actions.ts`) into a shared module, since `/utang`'s actions
  needed the same logic. One place to change when real auth arrives.
- **UI**: `/quick-add` gained a Paid/Utang toggle with a required customer-
  name field for Utang. New `/utang` page (server component + client
  `UtangList` subcomponent, matching the dashboard's pattern) lists
  outstanding receivables with a payment form. Dashboard's Utang stat card
  now links to `/utang`.
  - Building `/utang` as a client component with `useEffect` fetching
    initially triggered a real ESLint error (`react-hooks/set-state-in-effect`
    — synchronous `setState` in an effect body). Fixed by restructuring as a
    server component (like `/dashboard`) with a client subcomponent for the
    interactive payment form, using `router.refresh()` after a successful
    payment to re-pull server data. Cleaner and more consistent with the
    rest of the app than suppressing the lint rule would have been.
- **Live HTTP smoke test**: recorded a real ₱800 UNPAID sale (2× Heavy Tee,
  "Maria Santos") via the real `recordSale()` against real Postgres, booted
  the dev server, fetched both pages over HTTP. Dashboard: Safe to Spend
  stayed at ₱6,200.00 (unaffected, correctly), `unpaidReceivables` showed
  80000 centavos (₱800.00) in the breakdown JSON. `/utang`: HTTP 200,
  "Live" badge, "Maria Santos, UNPAID, ₱800.00 owed, ₱0.00 paid."
- Full gate re-run clean: **36 unit tests**, **17 integration tests**
  (up from 10 — 7 new utang tests covering create → partial payment → full
  settlement → overpayment rejection → cross-tenant rejection), **7 RLS
  checks** (up from 4), typecheck, lint, production build.



Directly fixed the gap session 3 documented rather than hid.

- **`src/lib/finance/productResolution.ts`**: pure, unit-tested matcher
  (7 tests). Exact name/SKU match resolves confidently; a clearly-best fuzzy
  match resolves confidently; anything else returns `AMBIGUOUS` (with
  candidates) or `NOT_FOUND` — never a guess. This is the same "never guess"
  discipline as `duplicateDetection.ts`, applied to products.
- **`recordSale()`** in `src/lib/data/finance.ts` replaces the old
  `recordQuickSale()`. Locks product rows (`for update`), checks stock,
  creates the order AND real `order_items` (previous version created none),
  decrements stock, appends the ledger entry only if `paymentStatus ===
  'PAID'`. All in one transaction. Rejects overselling via
  `InsufficientStockError` rather than allowing negative stock.
- **`/quick-add` rebuilt as a multi-step flow**: parse → resolve each line
  item against real products → user disambiguates or creates a new product
  if needed → confirm → persist. Every server action re-validates its input
  against Zod, not trusting client state.
- **Found a second real bug via the test suite's own teardown**:
  `order_items.product_id` had no `ON DELETE` behavior, so Postgres could
  attempt to delete a `products` row before the `order_items` row
  referencing it during a cascading business delete — a genuine FK
  ordering conflict, not a test artifact. Fixed with `on delete cascade` in
  the migration, documented inline with the reasoning (and why a future
  single-product delete should soft-delete via the new `active` column
  instead of relying on this cascade).
- Added `products.active` (boolean, default true) per spec Phase 3;
  `getProducts()` filters to active products, documented as intentionally
  narrow for its current callers (quick-add resolution) — a future full
  product-management screen needs its own unfiltered query.
- **Dashboard Sales/Net Profit cards switched from demo to real data**,
  unblocked by the fix above. `getDashboardData()` now fetches real
  `orders`/`expenses` via `getOrders`/`getExpenses` when `DATABASE_URL` is
  set. The live-data badge now reads "Live cash & sales data (marketplace
  payouts still demo)" — precise about what's real vs. not, not a blanket claim.
- **Live HTTP smoke test, end to end**: seeded a real product (Heavy Tee,
  ₱400 selling / ₱200 COGS) for the dev tenant, called the real
  `recordSale()` for a 3-unit sale (via a throwaway `tsx` script hitting
  actual Postgres — not a test harness), booted the Next.js dev server,
  fetched `/dashboard` over HTTP. Result: Sales **₱1,200.00**, Net Profit
  **₱600.00**, Safe to Spend **₱6,200.00** (₱5,000 opening + ₱1,200 sale) —
  every figure exactly matches hand-calculated expectations from real
  Postgres data rendered by a real HTTP response.
- Created `KNOWN_LIMITATIONS.md` per spec Phase 19, moving this session's
  fixed bug to "Resolved" with the evidence, and listing what's still
  genuinely missing (auth, live Supabase, marketplace/utang/payment-proof
  workflows, account-selection in quick-add).
- Full gate re-run clean: 36 unit tests (up from 29 — 7 new product-
  resolution tests), 10 real-Postgres integration tests (up from 7),
  4 RLS checks, typecheck, lint, production build.



Continued from session 2's real-Postgres data layer. This session:

- Added `getOrders`, `getExpenses`, `recordQuickSale`, `recordQuickExpense`
  to `src/lib/data/finance.ts`, with 3 new integration tests (7 total in that
  file now, all passing against real Postgres).
- **Found and documented a real gap via testing, not review**: a test named
  literally `"DOCUMENTS A REAL GAP"` in `finance.integration.test.ts` proves
  that `recordQuickSale()` does NOT make revenue show up in
  `calculateNetProfit()`, because it doesn't create `order_items` (no
  product-matching pipeline exists to resolve free-text like "Heavy Tee" to
  a real `products` row). The order is created with zero items, so
  `calculateRevenue()` correctly sums to ₱0 for it. Expenses, by contrast,
  don't depend on items and do flow through correctly — that asymmetry is
  now a permanent regression test, not a comment someone could miss.
- Because of that gap, the dashboard's Sales/Net Profit cards **deliberately
  stay on demo data** even though `getOrders`/`getExpenses` are real —
  wiring them to the real-but-incomplete path would silently underreport
  revenue, which is worse than an honest demo badge. See the comment in
  `src/app/dashboard/page.tsx` right above where `demoOrders`/`demoExpenses`
  are still used.
- Wired `/quick-add`'s Confirm button to a real server action
  (`confirmDraftTransaction`), which re-validates the draft against the Zod
  schema (never trusts client state just because it was shown once) and
  calls `recordQuickSale`/`recordQuickExpense`. Without `DATABASE_URL`/
  `KIRACASH_DEV_USER_ID` set, it returns `persisted: false` with an honest
  explanation rather than pretending to save.
- **Live HTTP smoke test**: booted the actual Next.js dev server against
  real local Postgres, with a freshly seeded tenant (`Dev Business`, one
  GCash account, ₱5,000 opening balance, zero ledger entries), and fetched
  `/dashboard` over real HTTP. Response: HTTP 200, "Live cash data" badge
  (not "Demo data"), Safe to Spend = ₱5,000.00 — exactly the seeded opening
  balance, computed by the real engine from real Postgres data served over
  a real HTTP response, not a test harness calling functions directly.
- Full gate re-run after every change: 29 unit + 7 integration tests +
  4 RLS checks all pass, typecheck/lint clean, production build passes.

**NOT done this session, and why**: a browser-level (Playwright) E2E test of
the quick-add flow, because this sandbox has no display/browser to drive —
the HTTP-level dashboard smoke test above is the closest verification
available without one. Actual browser E2E remains a real gap, tracked below.



This session added `src/lib/data/` (`db.ts`, `finance.ts`, `dashboardData.ts`)
and verified it against a **real local Postgres 16 instance** — not a live
Supabase project (still no credentials/network access for that), but a real
database, with all 3 migrations actually applied and a real non-superuser
session exercising RLS. See `db/local-dev/README.md` for exactly what this
does and doesn't prove.

Concretely, this session:
- Installed Postgres 16 locally, created a `kiracash` superuser (for
  migrations) and a separate non-superuser `app_user`/`authenticated` role
  (for RLS-respecting application queries) — mirroring the real distinction
  between Supabase's admin/migration access and its `authenticated` role.
- Applied all 3 migrations cleanly against a real database.
- Wrote and ran `db/local-dev/test-rls.sh`, an automated cross-tenant
  isolation test. **This caught a real bug**: `ledger_entries` had no
  UPDATE/DELETE RLS policy, so an UPDATE attempt was silently blocked by RLS
  before ever reaching the append-only trigger — which meant the trigger
  (the documented enforcement mechanism) was unreachable dead code. Fixed by
  adding explicit tenant-scoped UPDATE/DELETE policies so RLS lets the row
  through and the trigger's specific "append-only" error actually fires.
- Built `src/lib/data/finance.ts`: real parameterized queries for accounts,
  ledger entries, receivables, and an append-only `appendLedgerEntry`
  (matching the schema — no update/delete function exists for ledger rows).
- Wrote `finance.integration.test.ts` — 4 tests that seed real rows, query
  through the data layer as a real non-superuser session, and feed the
  result into the SAME `calculateSpendableCash()` the unit tests and
  dashboard use. All 4 pass. One of them attempts a direct cross-tenant
  insert and asserts it's rejected by Postgres, not by application logic.
- Wired `src/app/dashboard/page.tsx` to `getDashboardData()`, which uses
  real queries when `DATABASE_URL` is set and falls back to demo data
  (clearly badged) otherwise. Orders/expenses (for the Sales/Profit stat
  cards) are NOT yet wired to real tables — no `orders` query exists in
  `finance.ts` yet — so those two numbers stay demo-sourced even in "live"
  mode, and the dashboard badge says so explicitly rather than overclaiming.
- Full quality gate re-run after every change: typecheck clean, lint clean
  (2 warnings on an intentionally-stubbed function), 29 unit tests +
  4 integration tests passing, production build passes.

## What's NOT built yet, in priority order

1. **A live Supabase project** — everything above is verified against local
   Postgres, which is structurally the same engine Supabase runs, but a real
   Supabase project (with its real Auth, Storage, and hosted Postgres) has
   never been connected, because no credentials/network path to Supabase's
   cloud exists in this environment. First real step: create the project,
   run `0001`–`0003` (not the local-only auth shim or `0004_local_auth.sql`,
   both of which are explicitly local-only), point `DATABASE_URL` at it,
   re-run `npm run test:integration` against it.
2. ~~Auth~~ — **done, session 7**, as a self-hosted stand-in (see the update
   above and `KNOWN_LIMITATIONS.md` for exactly what it doesn't cover:
   session revocation, rate limiting, email verification, password reset —
   all things real Supabase Auth would provide natively).
3. ~~Product/entity resolution~~ — **done, session 4.**
4. **Real AiProvider** — see `ANTHROPIC_INTEGRATION.md`.
5. **Screenshot upload + OCR pipeline UI** — schema exists
   (`payment_proofs`), no upload component or storage wiring yet.
6. **Marketplace CSV adapters** (Shopee/TikTok/Lazada) — no code yet;
   `marketplace_imports` table exists to receive the result. Dashboard's
   "Pending Marketplace" figure stays demo-sourced until this exists.
7. **Inventory movement recording beyond sales** — sales now decrement
   stock (`recordSale`); restocks/returns/adjustments have no code path yet.
8. ~~Utang creation workflow~~ — **done, session 5.**
9. **Alerts engine** (margin compression, dead stock, cash risk, etc.) — the
   dashboard's "Attention needed" section is currently hardcoded demo text,
   not computed from rules.
10. **Subscriptions/entitlements enforcement** — table exists, no
    server-side check gates any feature yet.
11. **No due date / account selection in the utang UI flow** — `recordSale`
    accepts a `dueDate` param, but `/quick-add`'s utang toggle doesn't
    expose an input for it, so created receivables never become OVERDUE.
    Payments also always post through the business's first account. See
    KNOWN_LIMITATIONS.md.
12. **No business-switcher UI** — `getPrimaryBusinessIdForUser()` (session 7)
    always returns the first membership; a user belonging to multiple
    businesses has no way to choose which one they're viewing.
13. **Browser-level E2E tests** (Playwright) — this sandbox has no
    display/browser to drive one; the closest verification done is an HTTP
    fetch of server-rendered pages plus cookie-level auth testing (see
    session 7's smoke test), which proves the server round-trip and the
    session mechanism but not client-side form interaction (typing into
    `/login`, clicking submit, watching the redirect happen in a real
    browser). Needs a real environment with a browser.

## Why this scope, not more

The spec itself says: "Do not build everything simultaneously... build a
working vertical slice first." Session 1 built the engine; session 2 proved
it against a real database and RLS; session 3 wired orders/expenses and
persisted quick-add; session 4 fixed the product-resolution gap it found;
session 5 fixed the utang gap session 4 flagged; session 6 verified and
stress-tested it; session 7 built real authentication, replacing the
demo-user assumption that every prior session's own `KNOWN_LIMITATIONS.md`
entry had flagged as "never deploy with this as-is." Each session closed
exactly one documented gap rather than starting something new while a known
issue sat unfixed. Building further (CSV adapters, billing, alerts engine,
OCR) before real auth existed would have meant every one of those features
inheriting the same "any visitor sees one fixed business's data" security
hole — exactly the kind of issue the spec's "fix security issues before
declaring the milestone complete" instruction is aimed at.

## Recommended next session's scope

1. Create a real Supabase project, run `0001`–`0003` against it, and
   re-run `npm run test:integration` pointed at it to confirm the same
   behavior holds on Supabase's actual Postgres — the biggest remaining
   unknown, since everything so far has only ever touched local Postgres.
2. If staying on the local auth stand-in for now rather than migrating to
   Supabase Auth: add rate limiting to `/login`/`/signup` before any real
   traffic could reach them.
3. Payment-proof/OCR upload UI, now that both the deterministic financial
   core (sales, expenses, utang) and real authentication are genuinely
   solid — this was always meant to come after both, per the spec's own
   phase ordering.
4. Business-switcher UI for users who belong to more than one business
   (currently silently picks the first membership).
5. Re-run the full path by hand in a real browser (not just HTTP/cookie-
   level testing): sign up → verify redirected to dashboard → add a cash
   account and product → quick-add a sale (both paid and utang) → record a
   utang payment → sign out → confirm redirected away from private routes
   → sign back in → confirm data is still there. This needs an actual
   browser-capable environment to be meaningful.

At that point the MVP vertical slice described in the original spec is
genuinely, not superficially, done — including the "sale creates real
revenue" piece that took two sessions (found, then fixed) to get right.
