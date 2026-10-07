# Security

## Authentication

**This is NOT Supabase Auth.** No live Supabase project is reachable from
the environment this was built in (no network path, no credentials — see
ARCHITECTURE.md and KNOWN_LIMITATIONS.md). What exists instead is a real,
working, self-hosted auth system (`src/lib/auth/`), built so that swapping
in real Supabase Auth later only touches the auth adapter layer, not RLS
policies (already keyed on `auth.uid()`) or business logic.

**Password handling:**
- Passwords are hashed with bcrypt (cost factor 12,
  `src/lib/auth/password.ts`) before ever touching the database. Plaintext
  passwords exist only transiently in memory during signup/login request
  handling — never logged, never persisted.
- `local_auth_credentials` (`db/local-dev/0004_local_auth.sql`) has Row
  Level Security enabled with **zero policies** — stricter than "add a
  restrictive policy," this denies all access to any non-superuser role,
  including the app's own `app_user`/`authenticated` role. Only the
  admin/superuser connection can ever read or write it.
- `signIn`'s credential check (`verifyCredentials` in `authService.ts`)
  always runs a real bcrypt compare, even for a nonexistent email (against
  a dummy hash), specifically to prevent a timing side-channel that would
  let an attacker enumerate valid emails by measuring response time — the
  error message alone being generic isn't sufficient; see the "SECURITY:"
  named test in `authService.integration.test.ts`, which measures this
  directly rather than just asserting the code looks right.

**Session handling:**
- Sessions are stateless signed tokens (HMAC-SHA256,
  `src/lib/auth/session.ts`), stored in an `httpOnly`, `sameSite: lax`
  cookie, `secure` in production. `httpOnly` prevents any client-side
  script (including an XSS payload) from reading the token; the signature
  prevents tampering (checked with `timingSafeEqual`, not `===`, to avoid a
  timing side-channel on signature comparison too).
- **Documented tradeoff**: no server-side session table means no remote
  session revocation — logging out only clears the cookie on that device.
  There is no "sign out all devices" or forced invalidation after a
  password change yet. See KNOWN_LIMITATIONS.md.

**Two connection pools, deliberately kept separate** (`src/lib/data/db.ts`):
- `withUserContext()` / the `app_user` role — RLS-respecting, used for
  every ordinary business-data query. This is the only path application
  code (server actions, page components) should ever use.
- `getAdminPool()` / the `kiracash` superuser role — bypasses RLS
  entirely, used ONLY by `src/lib/auth/authService.ts` (signup/login, which
  happen before any session/identity exists) and integration-test fixture
  setup. In real Supabase, this maps to the `service_role` connection.
  **`ADMIN_DATABASE_URL` must never be sent to the client or referenced
  from any `'use client'` file** — verified by a repo-wide grep as part of
  this milestone's security audit (see KIRACASH_IMPLEMENTATION_PLAN.md).

**Route protection:**
- `middleware.ts` protects `/dashboard`, `/quick-add`, `/utang` at the edge
  (before any page component runs), verifying the session token's signature
  and expiry. This runs on the Node.js runtime specifically, because
  `verifySessionToken` uses Node's `crypto` module, which the default Edge
  runtime doesn't support.
- This is **defense-in-depth, not the sole enforcement mechanism** — every
  actual data read/write still goes through `withUserContext()` (real RLS)
  regardless of whether the middleware ran. Per the spec's explicit
  instruction not to rely solely on client-side redirects: the middleware
  redirect happens server-side, and even if it were somehow bypassed, RLS
  is the real boundary underneath it.

**Session revocation** (added in the auth-hardening milestone):
- Every session now has a row in the `sessions` table (`id`, `user_id`,
  `expires_at`, `revoked_at`). The session TOKEN still carries that row's id
  (`sessionId`) and is still verified by signature+expiry alone at the
  middleware layer (cheap, no DB round-trip) — but `getCurrentUserId()`
  (`authService.ts`), the actual authorization boundary reached right before
  any business data is touched, ALSO checks the `sessions` row: `revoked_at
  is null and expires_at > now()`. A session whose signature is still
  perfectly valid is correctly rejected here once revoked.
- **Proven, not just built**: a live smoke test issued a real session for a
  real signed-up user, confirmed the cookie granted `/dashboard` access
  (HTTP 200), revoked that exact session's row in Postgres directly (what
  `signOut()` does), and confirmed the SAME cookie — unmodified, valid
  signature — was then rejected (HTTP 307 to `/login`). See
  `KIRACASH_IMPLEMENTATION_PLAN.md` for the exact commands.
- `signOut()` revokes only the current session (the one the cookie
  identifies). `resetPassword()` calls `revokeAllSessionsForUser()`,
  invalidating every session for that user across all devices — proven with
  an integration test that creates two session rows (simulating two logged-
  in devices), resets the password, and confirms both are rejected.

**Rate limiting** (`src/lib/auth/rateLimit.ts`):
- Postgres-backed (a `login_attempts` table), not in-memory — this
  scaffold's architecture already treats Postgres as the shared source of
  truth throughout, so this is consistent, and correctly shared across
  multiple app server instances (an in-process `Map` would not be, and the
  spec explicitly warns against exactly that). This is NOT a distributed
  cache (no Redis) — an honest description for a single-Postgres
  deployment, not a claim of general-purpose distributed rate limiting.
- Keyed on the normalized email attempted, not IP (no reliable client IP is
  guaranteed across every deployment target this scaffold might run behind
  without careful proxy header configuration — see Known Limitations).
  Applied identically whether or not the email is registered, so the block
  behavior itself doesn't leak which emails exist.
- 5 failed attempts within 15 minutes blocks further attempts for that
  email; a blocked request never reaches the bcrypt compare at all. Signup
  is separately limited (5 attempts/hour per email) against spam/abuse.
- Proven with 4 integration tests against real Postgres: allows attempts
  under the threshold, blocks after exceeding it, a success doesn't count
  toward the failure total, and one email's failures don't block a
  different email.

**Password reset** (`requestPasswordReset`/`resetPassword` in `authService.ts`):
- `requestPasswordReset` returns the exact same generic message ("If an
  account with that email exists...") whether or not the email is
  registered — proven with a test comparing both response messages
  directly, not just asserted.
- The reset token is a 32-byte cryptographically random value
  (`crypto.randomBytes`); only its SHA-256 hash is ever persisted
  (`password_reset_tokens.token_hash`) — a full database dump alone can
  never yield a usable link. Expires in 1 hour, single-use (the row is
  locked with `SELECT ... FOR UPDATE` and marked `used_at` inside the same
  transaction that changes the password, preventing a race where the same
  token is redeemed twice concurrently). A successful reset revokes every
  existing session for that account.
- **No email provider is configured.** The reset link is written to the
  server console (`[DEV EMAIL STAND-IN] ...`) — sufficient to prove the
  mechanism end-to-end in tests/dev, explicitly NOT production email
  delivery. See Known Limitations.

**Email verification** (`verifyEmail` in `authService.ts`):
- Same token design as password reset (random value, SHA-256 hash
  persisted, single-use, expiring — 24 hours here). `auth.users.email_verified`
  starts `false` at signup and is set `true` on successful verification.
  **Not currently enforced anywhere** — an unverified account can still log
  in and use the product fully. This is a deliberate scope limit for this
  milestone (building the mechanism, not gating access on it yet), not an
  oversight — see Known Limitations.

## User → tenant ownership

```
auth.users (real identity, real password hash in local_auth_credentials)
  ↓
memberships (user_id, business_id, role) — the ONLY authoritative link
  ↓
businesses → all financial data (accounts, orders, receivables, etc.)
```

A user's business is resolved via `getPrimaryBusinessIdForUser()`
(`src/lib/data/finance.ts`), which queries `memberships` through the same
RLS-respecting `withUserContext()` path as everything else — a user
querying their own `memberships` rows is itself protected by RLS (`db/migrations/0001_core.sql`,
"member can view own memberships"), not by application-level filtering.

## Multi-tenancy / RLS

Every business-owned table has Row Level Security enabled
(`db/migrations/*.sql`). The policy pattern is uniform:

```sql
create policy "tenant isolation" on <table> for all
  using (is_business_member(business_id));
```

`is_business_member` is a `security definer` SQL function that checks the
`memberships` table against `auth.uid()` — the authenticated user, never a
value the client sends. **No table trusts a client-supplied `business_id`**
for read or write authorization; every server action derives `businessId`
from the resolved session (`sessionContext.ts`), never from a request
argument.

`order_items` and `receivable_payments` don't have their own `business_id`
column; their policies join through `orders`/`receivables` to reach one, so
isolation still holds without denormalizing.

**Proven, not just asserted**: `finance.integration.test.ts` and
`authService.integration.test.ts` include real cross-tenant tests — using
both hand-seeded fixtures (`db/local-dev/test-rls.sh`) and, as of this
milestone, **actually signed-up users** going through the real auth flow —
confirming a second tenant's data returns zero rows on read and is rejected
on write (INSERT and UPDATE), including specifically for `receivables`
(the balance-changing UPDATE, not just the INSERT).

## Financial integrity

- Money columns are `BIGINT` (centavos), never `NUMERIC`/`REAL`/float.
- `ledger_entries` is append-only at the database level: `no_ledger_update`
  and `no_ledger_delete` triggers raise an exception on any attempt to
  `UPDATE` or `DELETE` a row. Corrections must be new `REVERSAL` rows.
- `applyReceivablePayment` (application code) rejects any payment that would
  push `amountPaid` above `totalOwed`, rather than allowing an overpayment
  to silently create a negative balance. `recordReceivablePayment` locks
  the receivable row (`SELECT ... FOR UPDATE`) so two simultaneous payments
  can't both succeed and overpay — proven with a real concurrent-request
  test, not just argued (see `finance.integration.test.ts`).

## Secrets

- `.env.local` and `.env` are gitignored (see `.gitignore`).
- `.env.example` documents required variables without values, including
  `AUTH_SESSION_SECRET` (generate with `openssl rand -base64 32`) and
  `ADMIN_DATABASE_URL`, both explicitly commented as server-only/never-expose.
- `SUPABASE_SERVICE_ROLE_KEY` is explicitly commented as server-only in
  `.env.example` — it must never be read from client-side code (no `NEXT_PUBLIC_` prefix).
- No API keys, credentials, or secrets are committed anywhere in this repository.

## File uploads (payment proof screenshots)

Not yet implemented in this scaffold. When built, `payment_proofs.storage_path`
must point at a **private** Supabase Storage bucket object (never a public
URL), and the upload handler needs: MIME-type allowlist (images only),
file-size limit, and a signed URL for any authorized read — this is called
out as a TODO in `KIRACASH_IMPLEMENTATION_PLAN.md` rather than left silent.

## AI input handling

See `AI_GUARDRAILS.md` — all user/OCR-derived text is treated as untrusted
data, not instructions, and everything the AI layer produces is
schema-validated before a human ever sees a confirm button, before anything
reaches the database.

## Supabase Auth status

**Architecture prepared, external configuration required — not integrated,
not tested.** `@supabase/supabase-js`/`@supabase/ssr` are installed and
`src/lib/auth/supabaseAuthAdapter.ts` exists, but it has never run against
a real Supabase project (none reachable from this environment) and is
**not wired into any active code path** — every page and server action
still uses the tested local stand-in in `authService.ts`. See
`ARCHITECTURE.md` "Supabase Auth" for the exact activation steps and why
this scaffold stops short of claiming more than this.

`db/migrations/0006_self_serve_signup_rls.sql` (a real, production-relevant
migration, not local-only) adds the RLS `INSERT` policies a Supabase-Auth-
based signup would need to create a business/membership under the user's
own session — proven against local Postgres in `db/local-dev/test-rls.sh`
(3 new checks: self-serve creation succeeds, self-assignment as OWNER
succeeds, assigning a *different* user is rejected).

## What's not yet built or audited

- ~~Rate limiting on login/signup~~ and ~~email verification/password
  reset~~ — done, see "Authentication" above.
- Rate limiting is not yet applied to any OTHER route (quick-add parsing,
  future OCR upload) — only auth endpoints are covered so far.
- CSRF — Next.js Server Actions have built-in origin-checking protection;
  re-verify this holds once real mutations (not just parsing) are wired to
  more server actions.
- No IP-based rate limiting (only email-keyed) — see "Rate limiting" above
  for why, and Known Limitations for the tradeoff.
- Password verification/reset/signup emails are not actually delivered —
  logged to the server console only. See Known Limitations.

