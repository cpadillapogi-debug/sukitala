# Architecture

## Layering

```
UI (src/app, src/components)
  ↓
Server Actions (src/app/*/actions.ts)
  ↓
Domain logic (src/lib/finance, src/lib/ai)
  ↓
Deterministic financial engine (src/lib/finance) ← the only place money math happens
  ↓
Database (Postgres/Supabase, db/migrations)
```

The AI path is a separate, narrower lane that always rejoins the same
pipeline at "human confirmation":

```
User input (text / screenshot)
  ↓
AiProvider (src/lib/ai/provider.ts)
  ↓
zod schema validation (src/lib/ai/schema.ts) — throws on anything unexpected
  ↓
DraftTransaction shown to user, NOT saved
  ↓
Human confirms / edits / rejects
  ↓
Deterministic domain logic — same path as manual entry from here
  ↓
Database
```

This repository never allows `User → LLM → Database` as a path. Search the
codebase for `parseDraftTransaction` / `draftTransactionSchema` — that's the
single choke point every AI output must pass through before a human sees it.

## Money

All money is `Centavos` — a branded integer type (`src/lib/money/money.ts`).
There is no float/double money type anywhere in this codebase, including the
database (`BIGINT`, not `NUMERIC`/`REAL`). `pesosToCentavos()` is the only
sanctioned way to turn user/AI-supplied decimal input into a `Centavos`
value, and it validates the input has at most 2 decimal places before
converting — it does not silently round.

## The Spendable Cash engine

`src/lib/finance/spendableCash.ts` is the most important file in this
repository. It:
- derives every account balance from ledger entries (opening balance + sum
  of entries), never from a cached/mutable balance column
- excludes `MARKETPLACE_ESCROW` accounts from spendable cash entirely
- subtracts only explicitly-tracked `CommittedObligation` rows, never an
  inferred number
- clamps to zero rather than going negative
- returns pending marketplace funds and unpaid receivables as separate,
  clearly-labeled informational fields — never folded into the spendable
  number

See `spendableCash.test.ts` for the worked example from the product spec
(₱6,000 GCash, ₱800 committed → ₱5,200 spendable) as an executable test, not
just documentation.

## Ledger design

`ledger_entries` (see `db/migrations/0002_financial_core.sql`) is
append-only: a Postgres trigger raises an exception on any `UPDATE` or
`DELETE`. Corrections must be new rows with `type = 'REVERSAL'` and
`reversal_of_id` pointing at the original. This is the DB-level enforcement
of the "never silently mutate financial history" product rule.

## Multi-tenancy

Every business-owned table has RLS enabled with a policy built on
`is_business_member(business_id)`, a `security definer` function that checks
`memberships` against `auth.uid()`. No table trusts a client-supplied
`business_id` for authorization — it's always derived from the authenticated
session on the server.

## Authentication

**Not Supabase Auth** — no live Supabase project is reachable from the
environment this was built in (no network path, no credentials). What
exists is a real, self-hosted stand-in (`src/lib/auth/`), deliberately
shaped so that swapping in real Supabase Auth later touches only this
layer, not RLS policies or business logic:

```
signUp(email, password, businessName)
  ↓ (via getAdminPool() — RLS-bypassing, correct here since no
  ↓  session/identity exists yet)
  auth.users row created
  ↓
  local_auth_credentials row created (bcrypt hash — see
  db/local-dev/0004_local_auth.sql, RLS-locked with zero policies)
  ↓
  businesses row + memberships row (role: OWNER) created
  ↓
  all four inserts in ONE transaction — signup either fully succeeds
  or fully rolls back, never a half-created account
```

```
signIn(email, password)
  ↓
  verifyCredentials() — ALWAYS runs a real bcrypt compare, even for a
  nonexistent email (against a dummy hash), specifically to prevent a
  timing side-channel that would otherwise let an attacker enumerate
  valid emails by response time, despite the error message already
  being generic. This was a real bug, found and fixed during this
  milestone — see the "SECURITY:" named test in
  authService.integration.test.ts, which measures timing directly.
  ↓
  createSessionToken(userId) — a stateless, signed (HMAC-SHA256) token,
  NOT a database session row (see session.ts's documented tradeoff:
  no remote revocation is possible with this design)
  ↓
  set as an httpOnly, sameSite=lax, secure-in-production cookie
```

Once a session exists, **every subsequent request uses the exact same RLS
path as before auth existed** — `withUserContext(userId, ...)` was already
generic (it just sets `auth.uid()` for the connection and lets RLS do the
rest), so building real auth required zero changes to any RLS policy or any
query in `finance.ts`. The only thing that changed is *where `userId` comes
from*: `sessionContext.ts`'s `resolveSessionContext()` now calls
`getCurrentUserId()` (reads the verified session cookie) instead of reading
a `KIRACASH_DEV_USER_ID` environment variable. This is the single place
that will need to change again if/when real Supabase Auth replaces this.

**Route protection is two-layered, deliberately**: `middleware.ts` redirects
unauthenticated requests to `/login` before any page component runs (fast,
no DB round-trip — signature + expiry check only). But this is
defense-in-depth, not the real boundary — even if middleware were somehow
bypassed, every actual data read/write still goes through
`withUserContext()`, where RLS is the actual enforcement. Per the spec's
explicit instruction, client-side redirects are never relied on alone.

See `SECURITY.md` for the full authentication threat-model writeup and
`KNOWN_LIMITATIONS.md` for the current, complete list of what's still
genuinely missing.

### Supabase Auth: genuinely wired, activation-ready — live infrastructure unverified

`@supabase/supabase-js` and `@supabase/ssr` are installed. `src/lib/supabase/client.ts`
and `server.ts` create browser/server Supabase clients (anon-key only,
never service-role). `src/lib/auth/supabaseAuthAdapter.ts` implements the
same signUp/signIn/signOut/getCurrentUserId/requestPasswordReset shape as
`authService.ts`, using real Supabase Auth calls.

**`src/lib/auth/provider.ts` is the real activation switch.** Every auth
entry point in the app (signup, login, logout, session resolution in
`sessionContext.ts` and `dashboardData.ts`) imports from `provider.ts`, not
`authService.ts` directly — confirmed by a repo-wide grep finding zero
other files importing `authService.ts`. `provider.ts`'s
`isSupabaseConfigured()` checks whether `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` are both set; if so, every call routes to
`supabaseAuthAdapter.ts`, otherwise to `authService.ts`. This switch itself
is unit-tested (`provider.test.ts`, 5 tests: both branches mocked, proving
the dispatch logic is correct in both directions).

**What this does and doesn't prove**: because no live Supabase project is
reachable from this environment (still true across every session that has
touched this codebase), the Supabase branch inside `supabaseAuthAdapter.ts`
has never executed against a real project — the mocked test proves the
*switch* works, not that Supabase Auth itself behaves as expected once
wired to something real. In this and every environment without real
Supabase credentials configured, the application correctly and
automatically uses the tested local stand-in — proven with a live HTTP
smoke test (signup → session → `/dashboard` → real per-tenant data) run
*after* this rewiring, confirming no regression.

`db/migrations/0006_self_serve_signup_rls.sql` adds two RLS `INSERT`
policies (`businesses`, `memberships`) needed for `supabaseSignUp()`'s
self-serve business/membership creation to work under the user's own
session rather than a privileged bypass. This migration is real,
production-relevant (applies to actual Supabase too, not just local
Postgres), and **is** tested — `db/local-dev/test-rls.sh` proves a
brand-new user can create their own business and add themselves as OWNER,
but can never insert a membership row assigning a *different* user to any
business. That test also documents a genuine Postgres RLS subtlety it
uncovered: `INSERT ... RETURNING` requires the new row to pass the table's
*SELECT* policy too, not just the `INSERT` policy — which fails for a
business with no members yet — so the correct pattern (used by
`supabaseSignUp()`) is a client-generated id, inserted explicitly, without
`RETURNING`.

See `SUPABASE_SETUP.md` for the complete, exact checklist to connect a real
project — including that running the full test suite against it is a
required step, not optional, before the Supabase branch should be trusted.

## Receivable / utang lifecycle

An UNPAID sale and a payment against it are two separate, deliberately
asymmetric operations:

```
recordSale(paymentStatus: "UNPAID", customerName: "Maria")
  ↓
  order + order_items created (revenue/COGS ARE real — see profit.ts)
  ↓
  stock decremented
  ↓
  customer resolved-or-created (findOrCreateCustomerByName, exact
  case-insensitive match — same transaction)
  ↓
  receivables row created: total_owed = sale amount, amount_paid = 0
  ↓
  NO ledger_entries row — cash has not moved, Spendable Cash is unaffected
```

```
recordReceivablePayment(receivableId, amount, accountId)
  ↓
  SELECT ... FOR UPDATE locks the receivable row (see Concurrency below)
  ↓
  applyReceivablePayment() — the SAME pure, unit-tested function used by
  finance/receivables.ts — validates the amount and computes the new
  amount_paid/status; throws OverpaymentError rather than letting the
  balance go negative
  ↓
  ledger_entries row appended (type RECEIVABLE_PAYMENT, positive amount)
  ↓
  receivable_payments row appended (payment history, links to the ledger entry)
  ↓
  receivables row updated: amount_paid, status — status is always DERIVED
  (deriveReceivableStatus), never set directly, so it can't drift out of
  sync with the actual amounts
```

**Why this shape, not "just increase paid and check status inline":** the
pure functions in `finance/receivables.ts` are the single source of truth
for the arithmetic and status-transition rules, shared between the data
layer (real Postgres writes) and anything that needs to reason about a
receivable without a database (e.g. a future preview UI showing "what would
this payment do"). `recordReceivablePayment` in `data/finance.ts`
deliberately does not reimplement that logic in SQL.

### Concurrency

Two payments arriving for the same receivable at effectively the same time
are handled by Postgres row locking (`SELECT ... FOR UPDATE`), not
application-level mutexing. The first transaction to reach the lock holds
it until commit; the second blocks until the first releases, then reads the
now-updated `amount_paid` and evaluates the overpayment check against that
current value — so if the sum of both payments would exceed the balance,
the second is correctly rejected with `OverpaymentError`, never silently
allowed to create a negative-implied balance. This is proven, not just
argued: `finance.integration.test.ts` fires two real concurrent
`recordReceivablePayment` calls at the same receivable via `Promise.all`
and asserts exactly one succeeds.

## What's NOT built yet

See `KNOWN_LIMITATIONS.md` for the full, current list with impact and next
steps. Highlights: no live Supabase project connected (verified against
local Postgres only), no session revocation/rate limiting/email
verification (real auth now exists, but as a self-hosted stand-in with
those specific gaps — see "Authentication" above), no real OCR/AI provider
(only `MockAiProvider`), no marketplace CSV import, no customer-resolution
"which Maria?" disambiguation for natural-language utang entry (only
product resolution has this; a standalone "Maria owes me 800" quick-add
path without a product/sale attached doesn't exist yet).
