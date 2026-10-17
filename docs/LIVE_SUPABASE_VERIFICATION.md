# Live Supabase Verification — Environment & Safety Rules

This document exists because every session that has worked on SukiTala so
far — including the entire security-hardening pass that produced
`db/migrations/0010_fix_is_business_member_search_path.sql` and
`0011_account_business_consistency.sql` — has run in an environment with
**no network path to Supabase and no Supabase credentials**. Everything in
this repository's RLS/auth/finance logic has been proven against a local
Postgres stand-in only. This package is what closes that gap, run from an
environment that actually has both.

If you're picking this up fresh, start here, then follow
`LIVE_SUPABASE_VERIFICATION_RUNBOOK.md` in order, and fill in
`LIVE_SUPABASE_VERIFICATION_RESULTS.md` as you go.

## Required environment

**Public client configuration** (safe to expose in a browser bundle, by
design — this is the whole point of RLS):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon/publishable key>
```

**Privileged, server-only** (needed for direct-SQL migration/RLS testing —
never expose to a browser, never commit, never put in `NEXT_PUBLIC_*`):

```bash
# Project Settings → Database → Connection string (direct or pooled).
# The role this connects as matters for the live RLS script — see below.
SUPABASE_DB_URL=postgres://postgres:<password>@<host>:5432/postgres
```

Do not paste real values for either of these into a chat conversation with
an AI assistant, a shared doc, or anywhere else outside your own secret
manager / local shell / CI secret store. If you're running this alongside
an AI assistant, keep the values in your own environment and only share
back non-secret results (pass/fail, counts, redacted evidence).

## Distinguishing public vs. privileged

| Variable | Exposure | Used for |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public (browser-safe) | App runtime, preflight check |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public (browser-safe) | App runtime, real signup/login during live auth tests |
| `SUPABASE_DB_URL` | **Server-only, privileged** | Direct-SQL migration inspection and the live RLS adversarial script |

This repo's own `service_role` key is **not needed anywhere** in the
current codebase (see `SUPABASE_SETUP.md`, "What doesn't need
service_role") — if a verification step ever seems to require it, stop and
reconsider the approach rather than reaching for it.

## Safety rules (apply to every step in the runbook)

1. **Never blindly rerun all migrations.** Inspect first (Runbook step 4).
2. **Never drop or reset the project.** Not even a "just to be safe" reset.
3. **Never delete data you didn't create in this verification pass.** All
   disposable data this package creates is tagged so it's identifiable —
   see "Test data convention" below.
4. **Never print `SUPABASE_DB_URL`, the anon key, tokens, or passwords** in
   command output, logs, or the results doc. The preflight script and live
   RLS script are both written to avoid this — if you extend them, keep
   that property.
5. **Stop and report, don't guess**, if migration state is ambiguous or a
   step produces an unexpected result.

## Test data convention

Every disposable record this package creates — test users, businesses,
accounts — is tagged so it's unambiguous what's safe to delete afterward:

- Business names: `KIRACASH_LIVE_VERIFY_<timestamp>_A` and `..._B`
- Test user emails: `kiracash-live-verify-<timestamp>-a@example.com` /
  `...-b@example.com`

The cleanup step (Runbook step 18) matches on this prefix. Never delete
anything that doesn't match it.

## What this package can and can't automate

Can be scripted and run non-interactively: environment/connectivity
preflight, migration-state inspection, the SQL-level RLS/tenant-isolation
adversarial suite, the `is_business_member()` regression, ledger/financial
integrity checks, and the account/business consistency trigger check —
all via a direct Postgres connection, mirroring `db/local-dev/test-rls.sh`.

Cannot be meaningfully automated from a script alone, and need a human
(or a browser-capable agent) driving the actual deployed app or the
Supabase dashboard: email delivery/verification UX, the OAuth/PKCE
`/auth/callback` redirect in a real browser, deployed HTTPS cookie
inspection, CSRF testing against the actual deployed origin, Supabase
dashboard backup/PITR configuration, and any real recovery exercise. These
are called out explicitly, per step, in the runbook — this package does
not pretend a SQL script proves any of them.
