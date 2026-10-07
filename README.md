# SukiTala

**Know exactly how much business cash you can safely spend today.**

> **Renamed from KiraCash.** Product-facing text was updated; internal
> identifiers (the local dev DB/role name `kiracash`, the
> `kiracash.test_user_id` session variable, migration filenames, historical
> doc filenames like `KIRACASH_IMPLEMENTATION_PLAN.md`) were deliberately
> left as-is — see that file's own notes for why.
>
> **Recovery note:** this repository's git history was rebuilt from a
> checkpoint ZIP after a previous sandbox environment reset destroyed the
> original commits. The rebuilt work (the dashboard "attention insights"
> fix and the full Inventory Management feature, `src/app/inventory/`) was
> reimplemented and re-verified from scratch against a freshly built
> database, not assumed from the lost environment's prior results.
>
> **Current status, verified fresh:** 162/162 tests passing, 15/15 local
> RLS/tenant-isolation checks, clean typecheck/lint/production build,
> `npm audit --omit=dev` reporting 0 vulnerabilities, and the full
> 13-migration chain (`0000`–`0012`) confirmed to apply cleanly to an empty
> database via `db/local-dev/reset-local-db.sh`. The counts quoted later in
> this file ("50 passing unit tests", "49 passing") are from an earlier,
> smaller checkpoint and are kept here as history, not current numbers.

A cash-flow and payment-verification cockpit for Philippine social-commerce
and multi-channel micro-sellers (Facebook Marketplace, Messenger, TikTok
Shop, Shopee, Lazada, GCash, Maya, cash/COD).

The core product question: **"Ano ang puwede kong gastusin ngayon?"**

## Status

This is an early scaffold, not a finished product. It was built from a
product spec with no attached repository, no live Supabase project, and no
OCR/AI credentials. See "What requires external credentials" below for
exactly what's real vs. stubbed.

**What actually works right now, tested and passing:**
- The deterministic financial engine (money, revenue, COGS, profit, Spendable
  Cash, receivables/utang state machine, duplicate-payment detection,
  product resolution) — 50 passing unit tests, including all the worked
  examples from the product spec (Case 1–6).
- A real Postgres/Supabase schema with Row Level Security for tenant
  isolation and an append-only ledger (`db/migrations/`) — **applied to and
  verified against an actual local Postgres 16 instance**, including an
  automated test (`db/local-dev/test-rls.sh`) that logs in as one tenant and
  confirms it cannot read or write another tenant's data. This caught and
  fixed multiple real bugs (see `KIRACASH_IMPLEMENTATION_PLAN.md` and
  `KNOWN_LIMITATIONS.md` → "Resolved").
- A real Postgres-backed data layer (`src/lib/data/`) with 49 passing
  integration tests that seed rows, query through RLS as a real non-admin
  session, and feed the result into the same engine functions the unit
  tests and dashboard use — including a real concurrency test (two
  simultaneous payments against one receivable via `Promise.all`) and
  explicit financial-invariant tests.
- **Real authentication.** Signup, login, logout, and server-side route
  protection (`middleware.ts`) all genuinely work — bcrypt password
  hashing, signed httpOnly session cookies, real cross-tenant RLS proven
  with actually-signed-up users, not just seeded fixtures. Now hardened
  with real session revocation (proven with a live HTTP smoke test: the
  same valid-signature cookie worked before revocation and was rejected
  after), Postgres-backed rate limiting, and password reset/email
  verification (both fully working mechanisms — see below for what's still
  stubbed). This is self-hosted against local Postgres, not Supabase Auth
  (no live Supabase project is reachable from this environment) — see
  "What is stubbed" below and `SECURITY.md` for exactly what that means and
  doesn't mean.
- **Real sales, with real revenue.** A quick-add sale resolves free-text
  product names against actual `products` rows (never guessing — see
  `src/lib/finance/productResolution.ts`), creates real `order_items`,
  decrements stock, and appends the ledger entry, all in one transaction.
  Proven with a live HTTP smoke test: a real 3-unit sale showed up on the
  dashboard as Sales ₱1,200.00 / Net Profit ₱600.00, computed by the real
  engine from real Postgres data.
- **Real utang, including under concurrency.** A sale can be recorded as
  UNPAID (requires a customer name — no anonymous debt), which creates a
  real `order_items` and a real `receivables` row instead of a ledger
  entry: revenue/COGS are still tracked, but Spendable Cash correctly
  doesn't move until the customer actually pays. The `/utang` page lists
  outstanding balances and lets a partial or full payment be recorded,
  which appends a ledger entry, reduces the balance, and updates Spendable
  Cash — overpayment is rejected outright, and two payments arriving at the
  same receivable simultaneously are correctly serialized by Postgres row
  locking (`SELECT ... FOR UPDATE`), proven with a real concurrent-request
  test, not just argued.
- A working Next.js UI: `/login`, `/signup`, dashboard with the Spendable
  Cash card and drill-down breakdown; quick-add's multi-step flow (parse →
  resolve products → disambiguate/create if needed → choose Paid or Utang →
  confirm → persist) with Zod re-validation at every persist step. Every
  page uses the real authenticated user's real data when `DATABASE_URL` is
  set and someone is logged in, demo data otherwise — visibly labeled
  either way.
- Zod schemas that are the *only* contract an AI/OCR provider is allowed to
  produce output through — see `src/lib/ai/schema.ts`.

**What is stubbed, and clearly labeled as such in the UI or docs:**
- No live database connection — pages render demo data
  (`src/lib/demo/demoData.ts`) when unauthenticated or `DATABASE_URL` isn't
  set, visibly marked with a "Demo data" badge.
- No real OCR/AI provider — `MockAiProvider` in `src/lib/ai/provider.ts` does
  a trivial regex match, sufficient to exercise the pipeline in dev, and
  every screen using it shows an "Integration not connected" notice.
- **Auth is real but not Supabase Auth** — a self-hosted bcrypt + signed-
  cookie system with real session revocation, rate limiting, and password
  reset/email verification mechanisms, built because no live Supabase
  project is reachable from this environment. Still missing vs. real
  Supabase Auth: actual email delivery (reset/verification links are
  logged to the server console, not sent), IP-based rate limiting
  (email-keyed only), and enforcement of the email-verified flag (tracked
  but not gated on yet). See `SECURITY.md` and `KNOWN_LIMITATIONS.md`.
  See `SECURITY.md` and `KNOWN_LIMITATIONS.md`.
- No billing provider — schema exists (`subscriptions` table), no Stripe/etc.
  integration.

## Stack, and why

- **Next.js 16 + TypeScript (App Router)** — one codebase for a solo founder,
  server actions avoid needing a separate API server for simple mutations,
  good mobile-web performance.
- **Tailwind CSS** — fast to build a clean mobile-first UI without a design
  system dependency.
- **PostgreSQL via Supabase** — Postgres gives real `NUMERIC`/`BIGINT`
  money types, real Row Level Security for multi-tenancy, and Supabase adds
  auth + storage (for payment screenshots) without extra infra to run.
- **Zod** — the hard boundary between "AI said this" and "the app trusts
  this." Every AI/OCR output is `.parse()`d against a schema before a human
  ever sees a confirm button.
- **Vitest** — fast unit testing for the financial engine, which is the part
  of this codebase that must never be wrong.

## Running locally

```bash
npm install
cp .env.example .env.local   # fill in values — see db/local-dev/README.md
                              # for a local Postgres setup, or Supabase keys
                              # once you have a real project
npm run dev
```

Visit `http://localhost:3000` → "View demo dashboard" (no login needed for
the demo), or `/signup` to create a real account against a connected
database (requires `DATABASE_URL`, `ADMIN_DATABASE_URL`, and
`AUTH_SESSION_SECRET` — see `.env.example` and `SECURITY.md`).

## Quality gate

```bash
npm run verify   # typecheck + lint + unit tests + production build
```

All four currently pass clean. There's also a database-backed suite that
needs a real Postgres instance (see `db/local-dev/README.md`):

```bash
npm run db:test-rls        # cross-tenant RLS isolation, run as a shell script
npm run test:integration   # data layer round-trip through real Postgres
```

## What requires external credentials to become real

| Feature | Needs | Where to wire it |
|---|---|---|
| Real accounts/transactions instead of demo data | `DATABASE_URL` (local Postgres or Supabase) | already built — `src/lib/data/` |
| Login/signup | Works today against local Postgres (`ADMIN_DATABASE_URL`, `AUTH_SESSION_SECRET`) | To become real Supabase Auth: replace `src/lib/auth/authService.ts`'s implementation with `supabase-js` calls — see `ARCHITECTURE.md` "Authentication" |
| Natural-language & screenshot extraction | An LLM/vision API key (e.g. `ANTHROPIC_API_KEY`) | Implement `AiProvider` in `src/lib/ai/provider.ts`, replacing `MockAiProvider` |
| Payment screenshot storage | Supabase Storage bucket (private) | `payment_proofs.storage_path` |
| Marketplace CSV import | No credentials needed — just adapters | new `src/lib/marketplace/` |
| Subscriptions/billing | A billing provider (Stripe, Xendit, etc.) | `subscriptions` table + provider adapter |

## Database

See `db/migrations/*.sql`. Apply in order against a Supabase/Postgres
instance (`supabase db push` or `psql -f`). Every business-owned table has
RLS enabled and a `tenant isolation` policy driven off `memberships`, never
off a client-supplied `business_id`. The ledger is append-only, enforced by
a database trigger, not just application code.

## Documentation

- `ARCHITECTURE.md` — layering, the AI boundary, data flow
- `AI_GUARDRAILS.md` — what the LLM is and isn't allowed to do
- `SECURITY.md` — tenant isolation, RLS, secrets
- `KIRACASH_IMPLEMENTATION_PLAN.md` — phased plan and current status
- `ANTHROPIC_INTEGRATION.md` — exact steps to wire a real AI/OCR provider
- `KNOWN_LIMITATIONS.md` — every known gap, its impact, and what fixes it —
  updated as limitations are found and resolved, not just at the end

## What's next

1. Wire a real Supabase project (create it, run migrations — everything
   from accounts through auth already has a working implementation against
   local Postgres, this is about connecting to real infra instead).
2. ~~Utang creation workflow~~ — done, see `KNOWN_LIMITATIONS.md` → Resolved.
3. ~~Authentication~~ — done as a self-hosted stand-in, see `KNOWN_LIMITATIONS.md`
   → Resolved for what it covers and the three new limitations (session
   revocation, rate limiting, email verification) for what it doesn't.
4. Implement a real `AiProvider` once an API key is available.
5. Marketplace CSV adapters (Shopee/TikTok/Lazada).
6. Browser-driven E2E tests (signup → add product → sale → utang payment →
   dashboard → logout) — not meaningful to write without a real browser;
   the closest verification done so far is HTTP/cookie-level testing (see
   `KIRACASH_IMPLEMENTATION_PLAN.md`, session 7).
