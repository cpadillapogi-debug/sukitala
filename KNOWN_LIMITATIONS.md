# Known Limitations

Format: limitation → impact → workaround → next action. Updated as the
codebase changes — if a limitation here is fixed, it moves to "Resolved"
with a link to the commit/test that proves it, not just deleted silently.

## Requires external configuration

### No live Supabase project connected
**Impact:** Everything is verified against local Postgres 16, which is
structurally the same engine, but Supabase Auth, Storage, Realtime, and
hosted-Postgres-specific behavior have never been exercised. The Supabase
Auth adapter (`src/lib/auth/supabaseAuthAdapter.ts`) is written and now
genuinely **wired** — `src/lib/auth/provider.ts` is the real dispatcher
every auth entry point uses, routing to Supabase when
`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` are set — but
the Supabase branch has never executed against a real project. The dispatch
LOGIC is unit-tested (`provider.test.ts`, 5 tests, both branches mocked);
the actual Supabase network calls inside `supabaseAuthAdapter.ts` are not,
and cannot be, tested here.
**Workaround:** none needed for continued local development — see
`db/local-dev/README.md`. The application correctly defaults to the local
stand-in in this and every environment without real Supabase credentials.
**Next action:** see `SUPABASE_SETUP.md` for the complete, exact checklist —
including that running the test suite against the real project is a
required step, not optional, before trusting any of the Supabase branch.

### No real email delivery (reset/verification links only reach the server console)
**Impact:** `requestPasswordReset` and `signUp` log the reset/verification
link via `console.log` rather than sending an actual email — there is no
email provider configured. A real user could not self-serve a password
reset in production as this stands. (Real Supabase Auth, once connected,
handles this natively and makes this whole limitation moot.)
**Workaround:** the mechanism (token generation, hashing, expiry, single-
use, generic responses) is fully real and tested; only delivery is stubbed.
**Next action:** wire a provider (Resend, Postmark, SES, etc.) by replacing
`devLogDeliverLink()` in `authService.ts` — nothing else in the reset/
verification flow needs to change. Moot if/when Supabase Auth is connected.

## Active limitations

### No IP-based rate limiting (email-keyed only)
**Impact:** `login_attempts`/`signup_attempts` are keyed on the normalized
email attempted, not client IP. An attacker rotating through many different
(fabricated or harvested) email addresses against the same password could
avoid the per-email threshold. Deliberately scoped this way because no
reliable client IP is guaranteed across every deployment target this
scaffold might run behind (serverless platforms, proxies) without careful
header configuration (`X-Forwarded-For` trust boundaries, etc.) — adding
IP-based limiting without that configuration risks either not working or
being trivially spoofable.
**Workaround:** email-keyed limiting still stops the most common attack
(hammering one account).
**Next action:** add IP-based limiting once the actual deployment target's
proxy/header configuration is known and can be trusted correctly.

### No email verification enforcement
**Impact:** `auth.users.email_verified` is tracked and a working
verification flow exists (`/verify-email`), but nothing checks this flag —
an account with an unverified (or even typo'd) email can fully use the
product.
**Workaround:** none; this was a deliberate scope limit (build the
mechanism, decide on enforcement later) not an oversight.
**Next action:** decide whether/where to gate access on `email_verified`
(e.g. block `/quick-add` until verified, or just show a banner) once real
email delivery exists — enforcing it now, with only console-logged links,
would lock real users out with no way to actually receive the link.

### Single-item ambiguity resolution has no persistence
**Impact:** If `resolveQuickSaleItems` returns AMBIGUOUS or NOT_FOUND, the
user's choice/new-product-creation is only held in React state on the
`/quick-add` page. Refreshing mid-flow loses progress.
**Workaround:** none — just re-parse.
**Next action:** low priority; not a correctness issue, just a UX rough edge.

### Marketplace payouts and inventory movements beyond sales: schema exists, workflows don't
**Impact:** `payment_proofs`, `marketplace_imports` tables exist with RLS
but have no server actions or UI writing to them yet. The dashboard's
"Pending Marketplace" figure stays demo-sourced. Utang creation/payment is
now real (see Resolved) — this entry now covers only what's still missing.
**Workaround:** none.
**Next action:** in priority order — payment-proof upload UI (Phase 6),
marketplace CSV import (Phase 9).

### No "apply overpayment as credit" path
**Impact:** `recordReceivablePayment` rejects any payment that would exceed
the remaining balance outright (`OverpaymentError`). If a customer actually
overpays in real life, there's no way to record it as store credit — the
seller has to record a smaller amount and handle the difference outside
SukiTala.
**Workaround:** record the exact remaining balance, note the excess manually.
**Next action:** low priority — only worth building if a real seller hits
this in practice.

### Receivable due dates and account selection aren't set by the utang UI flow
**Impact:** `/quick-add`'s utang flow doesn't currently collect a due date
(recordSale accepts one, but the UI doesn't expose an input for it — created
receivables have `due_date: null`, so `deriveReceivableStatus` can never mark
them OVERDUE). Payments always post through the business's first account
(same limitation as PAID sales, see below).
**Workaround:** none.
**Next action:** add a due-date field to the utang confirm step in
`/quick-add`.

### Quick-add uses the business's first cash account unconditionally
**Impact:** `resolveDevContext()` in `quick-add/actions.ts` always picks
`accounts[0]` rather than matching the AI-extracted `paymentMethod` (GCash
vs Maya vs Cash) to a specific account, or asking the user to pick.
**Workaround:** fine for a business with one account (the common case for a
brand-new seller); wrong for anyone with multiple.
**Next action:** account-selection step in the confirm UI, or auto-match by
`accounts[i].type === draft.paymentMethod` with a fallback to asking.

### No overselling override
**Impact:** `recordSale` always rejects a sale that would take stock
negative (`InsufficientStockError`). The original spec mentions "unless the
business explicitly enables overselling" — that flag doesn't exist.
**Workaround:** none; this is arguably the safer default to ship without,
not a bug.
**Next action:** low priority — add a per-product or per-business
`allow_overselling` flag only if a real seller asks for it.

### Product creation from quick-add uses `window.prompt()`
**Impact:** functional but not polished — a real "create product" form
(Phase 3, Product Management) would ask for SKU, initial stock, etc., not
just name/price/COGS via browser prompts.
**Workaround:** works for unblocking the sale flow today.
**Next action:** build the full Products section per spec Phase 3; quick-add
should link into it instead of using `prompt()`.

### No natural-language customer disambiguation ("Which Maria?") for standalone utang entry
**Impact:** Product resolution (`productResolution.ts`) has a full
EXACT/AMBIGUOUS/NOT_FOUND "never guess" flow with UI to disambiguate.
Customer resolution (`findOrCreateCustomerByName` in `data/finance.ts`)
does exact case-insensitive matching only — no ambiguity concept, and no
standalone "Maria owes me 800" (debt with no product/sale attached) or
"Maria paid 500" (resolve an existing customer's receivable from free
text) quick-add paths. Today, utang can only be created as part of a
product sale via `/quick-add`'s Paid/Utang toggle, and payments are only
recorded from the `/utang` page's form, not from natural language.
**Workaround:** use the `/quick-add` sale flow (requires a product) or the
`/utang` page's payment form directly.
**Next action:** build a `customerResolution.ts` mirroring
`productResolution.ts`'s AMBIGUOUS handling, plus two new quick-add intents
for standalone debt creation and natural-language payment resolution.

## Resolved

### ~~Middleware was not provider-aware (always used the local token check, even if Supabase were configured)~~
**Fixed.** `middleware.ts` now checks `isSupabaseConfigured()` and branches:
the Supabase path implements the current `@supabase/ssr` middleware pattern
(session refresh via `getUser()`); the local path is the existing
signed-token check, unchanged. Re-verified via live HTTP smoke test after
the change: unauthenticated → 307, valid session → 200 with real data,
tampered cookie → 307 — all still correct on the local branch, which is
what actually runs in this and every unconfigured environment. **The
Supabase branch itself remains unverified** — no real project exists to
execute it against.

### ~~No `/auth/callback` route existed for Supabase's code-exchange flow~~
**Fixed, unverified.** `src/app/auth/callback/route.ts` implements the
standard Supabase SSR pattern (exchange the `code` query param for a
session, then redirect to `next`). Required for both email verification
links and password recovery links to work under Supabase — without it,
those links would have had nowhere to land. Fails closed (redirects to
`/login`) if hit without Supabase configured or without a valid code.
**Never executed against a real project.**

### ~~requestPasswordReset/resetPassword were not dispatched through provider.ts at all~~
**Fixed.** Both are now genuinely unified in `provider.ts`:
`requestPasswordReset` dispatches by configuration (trivial — both
providers just need an email); `resetPassword` dispatches too, with an
honest signature difference preserved (`token: string | null` — the local
provider needs it, Supabase's flow doesn't, since `/auth/callback` already
established the recovery session). Proven with 5 new dispatcher tests
(10 total in `provider.test.ts`, up from 5) covering both directions and
the "null token under local provider fails cleanly" edge case.
`verifyEmail` remains local-only, documented as intentionally not unified
— Supabase handles verification implicitly via the callback route, with no
equivalent explicit "verify" call to dispatch to.

### ~~supabaseAuthAdapter.ts existed but was completely unwired (zero imports anywhere)~~
**Fixed.** `src/lib/auth/provider.ts` is now the single dispatcher every
auth entry point (`signup`, `login`, `logout`, `sessionContext.ts`,
`dashboardData.ts`, `forgot-password`, `reset-password`, `verify-email`)
imports from — confirmed by grep that zero files import `authService.ts`
directly anymore except `provider.ts` itself and its own test file. The
switch is real and tested (`provider.test.ts`): with no Supabase env vars
set, every call routes to the local adapter (proven); with both env vars
set, every call routes to the Supabase adapter (proven, via mocks — the
real network calls inside the Supabase adapter remain unverified, see
"Requires external configuration" above). A live HTTP smoke test confirmed
the local path still works correctly end-to-end through the new dispatcher
(signup → session → `/dashboard` → real per-tenant data).

### ~~No RLS path for self-serve business/membership creation (privileged bypass required)~~
**Fixed, for local Postgres — prepared but unverified for real Supabase.**
`db/migrations/0006_self_serve_signup_rls.sql` adds `INSERT` policies
letting a brand-new authenticated user create their own business and add
themselves as OWNER under their own session, rather than requiring a
privileged/service-role bypass. Proven against local Postgres in
`db/local-dev/test-rls.sh` (self-serve creation succeeds, self-assignment
as OWNER succeeds, assigning a *different* user as a member is rejected).
Also documents a real Postgres RLS subtlety this testing uncovered:
`INSERT ... RETURNING` requires the new row to pass the table's SELECT
policy too, not just the INSERT policy — failing for a business with no
members yet — so the correct pattern is a client-generated id inserted
explicitly, without `RETURNING`. This migration has never been applied to
or tested against a real Supabase project (see "Requires external
configuration" above).

### ~~No session revocation (logout only clears the local cookie)~~
**Fixed.** Every session now has a real `sessions` table row
(`db/local-dev/0005_auth_hardening.sql`); `getCurrentUserId()` checks
`revoked_at is null and expires_at > now()` in addition to the token's
signature/expiry. `signOut()` revokes the current session's row.
`resetPassword()` revokes ALL of a user's sessions. **Proven with a live
HTTP smoke test**, not just unit tests: the exact same session cookie
(unmodified, valid signature) granted `/dashboard` access before its DB row
was revoked (HTTP 200) and was rejected after (HTTP 307 to `/login`) — see
`KIRACASH_IMPLEMENTATION_PLAN.md` for the exact reproduction. Also proven
with 4 integration tests (fresh session valid, revoked session rejected,
expired session rejected, password reset revokes all sessions).

### ~~No rate limiting on login/signup~~
**Fixed** (email-keyed; see the new "No IP-based rate limiting" active
limitation above for the honest scope of this). `src/lib/auth/rateLimit.ts`,
Postgres-backed (`login_attempts`/`signup_attempts` tables) — deliberately
not in-memory, since this scaffold's architecture already treats Postgres
as shared source of truth, and an in-process limiter wouldn't be shared
across app instances. 5 failed login attempts / 15 minutes blocks further
attempts for that email before the bcrypt compare even runs; 5 signup
attempts / hour per email. Proven with 4 integration tests against real
Postgres.

### ~~No email verification or password reset~~
**Fixed, mechanism-complete** (see the two new active limitations above for
what's still genuinely missing — enforcement and real delivery). Both use
cryptographically random tokens (32 bytes), SHA-256-hashed before storage
(a DB dump alone can't yield a usable link), expiring (1 hour for reset, 24
hours for verification), single-use (enforced with `SELECT ... FOR UPDATE`
inside the same transaction as the state change, closing a race-condition
window). `requestPasswordReset` returns an identical generic message
whether or not the email exists — proven by a test comparing the two
responses directly. A successful password reset revokes every existing
session. Proven with 11 integration tests covering the full lifecycle:
generic-response equality, valid token success, invalid token rejection,
single-use enforcement, expiry rejection (for both reset and verification
tokens).

### ~~No real authentication — env-var placeholder resolved every server action's identity~~
**Fixed, with an important caveat.** Real signup/login/logout now exist
(`src/lib/auth/`), backed by bcrypt password hashing and signed httpOnly
session cookies, with `middleware.ts` protecting `/dashboard`, `/quick-add`,
`/utang` server-side. Every server action resolves identity from the real
session via `getCurrentUserId()`, never from `KIRACASH_DEV_USER_ID` (that
env var no longer exists anywhere in the codebase). Proven with: 9 real
auth integration tests (signup, duplicate-email rejection, password
verification, timing-safety), a real cross-tenant RLS test using two
actually-signed-up users (not hand-seeded fixtures), and a live HTTP smoke
test showing a real 307 redirect for unauthenticated access, a real 200
with correct per-tenant data for a valid session cookie, and a real 307
rejection for a tampered cookie.

**The caveat, stated plainly**: this is NOT Supabase Auth. No live
Supabase project is reachable from the environment this was built in, so
this is a self-hosted stand-in — real security practices (bcrypt, signed
cookies, RLS unchanged), but missing things real Supabase Auth provides for
free: session revocation, rate limiting, email verification, password
reset. See the three new active limitations above. Swapping to real
Supabase Auth later should only require replacing
`src/lib/auth/authService.ts`'s implementation — RLS policies and all
business logic are unaffected, since they already key off `auth.uid()` /
an arbitrary `userId` parameter, not this specific auth mechanism.

### ~~An UNPAID (utang) sale creates no receivable and disappears from tracking~~
**Fixed.** `recordSale()` now requires `customerName` for UNPAID sales,
resolves-or-creates the customer, and creates a real `receivables` row for
the exact sale amount — no ledger entry, no Spendable Cash change, but the
debt is tracked. `recordReceivablePayment()` handles partial/full payments:
increases the chosen account, appends a `RECEIVABLE_PAYMENT` ledger entry,
reduces the remaining balance, and rejects overpayment via the typed
`OverpaymentError` (delegating to the pure, unit-tested
`applyReceivablePayment()`). A new `/utang` page lists outstanding
receivables and lets a payment be recorded. Proven by 7 new integration
tests (full lifecycle: create → partial → full settlement → overpayment
rejection → cross-tenant rejection) and a live HTTP smoke test: a real
₱800 UNPAID sale left Spendable Cash unchanged and showed up on `/utang`
as "Maria Santos, UNPAID, ₱800.00 owed."

### ~~Concurrent payments against the same receivable were never tested~~
**Fixed/proven.** `recordReceivablePayment` already locked the receivable
row with `SELECT ... FOR UPDATE`, but this had never been exercised under
real concurrency. Added a test that fires two real concurrent
`recordReceivablePayment` calls at the same receivable (₱700 owed, two ₱500
payments) via `Promise.all` against actual Postgres: exactly one succeeds,
the other is rejected with `OverpaymentError` (not both succeeding, which
would silently overpay; not both failing, which would mean the locking was
broken). Final state asserted consistent: exactly one ₱500 payment applied,
₱200 remaining.

### ~~Quick-add sales don't resolve products into order_items, so revenue reads ₱0~~
**Fixed.** See `src/lib/finance/productResolution.ts` (never-guess matching)
and `recordSale()` in `src/lib/data/finance.ts` (creates real order_items,
decrements stock, transactional). Proven by
`finance.integration.test.ts`'s test named "FIXES THE DOCUMENTED GAP" and a
live HTTP smoke test: a real 3-unit sale of a ₱400/₱200-COGS product showed
up on the dashboard as Sales ₱1,200.00, Net Profit ₱600.00 — not ₱0.

### ~~order_items.product_id had no ON DELETE behavior, causing an FK cascade-ordering failure~~
**Fixed.** `db/migrations/0002_financial_core.sql` now has `on delete
cascade` on that FK, with reasoning documented inline. Caught by
`finance.integration.test.ts`'s own `afterAll` cleanup failing with a real
Postgres FK violation — not found by inspection.

### ~~receivable_payments.ledger_entry_id and payment_proofs.matched_ledger_entry_id had the same FK bug~~
**Fixed.** Same root cause as `order_items.product_id` above — both lacked
`ON DELETE` behavior. Added `on delete cascade` to both in
`db/migrations/0003_receivables_proofs_saas.sql`. Caught by the utang
integration tests' `afterAll` cleanup failing on a real FK violation, not
by inspection — same pattern as the first bug, same fix.

### ~~db/local-dev/test-rls.sh depended on manual, undocumented seed commands~~
**Fixed.** The script is now self-seeding and idempotent: it creates its
own two test tenants (users, businesses, memberships, accounts, a utang
fixture) via the admin connection before running any assertion, and can be
re-run safely from a clean database with no prior manual setup. Verified by
running it twice in a row with identical PASS output both times.
