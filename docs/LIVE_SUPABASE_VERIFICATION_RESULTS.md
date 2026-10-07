# SUKITALA LIVE SUPABASE VERIFICATION — RESULTS

Copy this file (or fill in a fresh copy) each time the runbook is
executed. Do not put secret values anywhere in this file.

## Environment

* Project ref (non-secret, from preflight output):
* Deployment URL (if testing a deployed instance, not just the DB):
* Verification timestamp:
* Git commit under test:
* Run by:

## LOCAL VERIFIED

(Copy from the last known-good local baseline — do not re-derive from
memory; check the actual last commit's verification numbers.)

* Tests:            _/_
* Local RLS suite:  _/_
* Typecheck:        PASS / FAIL
* Lint:             PASS / FAIL
* Build:            PASS / FAIL
* npm audit --omit=dev:

## LIVE SUPABASE VERIFIED

Only mark PASS for something actually executed and observed against the
real project this run. Everything else is NOT TESTED, not an assumed pass.

| # | Item | Result | Evidence (non-secret) |
|---|---|---|---|
| 1 | Preflight (env + connectivity) | PASS / FAIL / NOT TESTED | |
| 2 | Project identity confirmed | PASS / FAIL / NOT TESTED | |
| 3 | Migration state inspected | PASS / FAIL / NOT TESTED | |
| 4 | Migrations applied (if needed) | PASS / FAIL / NOT TESTED / N-A | |
| 5 | Signup | PASS / FAIL / NOT TESTED | |
| 6 | Login (correct credentials) | PASS / FAIL / NOT TESTED | |
| 7 | Login (wrong credentials rejected, generic message) | PASS / FAIL / NOT TESTED | |
| 8 | Session persistence | PASS / FAIL / NOT TESTED | |
| 9 | Logout invalidates session | PASS / FAIL / NOT TESTED | |
| 10 | Password reset request (enumeration-safe) | PASS / FAIL / NOT TESTED | |
| 11 | Password reset completion (manual, real link) | PASS / FAIL / NOT TESTED | |
| 12 | Email verification behavior matches project config | PASS / FAIL / NOT TESTED | |
| 13 | `/auth/callback` PKCE exchange (manual, real browser) | PASS / FAIL / NOT TESTED | |
| 14 | Two-tenant RLS suite (`verify:live:rls`) | PASS / FAIL / NOT TESTED | script exit code + PASS/FAIL line count |
| 15 | `is_business_member()` pg_temp regression | PASS / FAIL / NOT TESTED | |
| 16 | Account/business consistency trigger (0011) | PASS / FAIL / NOT TESTED | |
| 17 | Legitimate same-business access still works | PASS / FAIL / NOT TESTED | |
| 18 | Paid sale financial behavior | PASS / FAIL / NOT TESTED | |
| 19 | Utang sale financial behavior | PASS / FAIL / NOT TESTED | |
| 20 | Partial payment | PASS / FAIL / NOT TESTED | |
| 21 | Full payment | PASS / FAIL / NOT TESTED | |
| 22 | Overpayment rejected | PASS / FAIL / NOT TESTED | |
| 23 | Zero/negative payment rejected | PASS / FAIL / NOT TESTED | |
| 24 | Zero/negative expense rejected | PASS / FAIL / NOT TESTED | |
| 25 | Invalid product price/COGS rejected | PASS / FAIL / NOT TESTED | |
| 26 | Ledger UPDATE/DELETE rejected | PASS / FAIL / NOT TESTED | |
| 27 | Concurrency (simultaneous payments) | PASS / FAIL / NOT TESTED | |
| 28 | Server-side IDOR resistance (deployed app) | PASS / FAIL / NOT TESTED | |
| 29 | Rate limiting (login) | PASS / FAIL / NOT TESTED | |
| 30 | Rate limiting (password reset, enumeration-safe) | PASS / FAIL / NOT TESTED | |
| 31 | Cookie flags (HttpOnly/Secure/SameSite) on deployed HTTPS | PASS / FAIL / NOT TESTED | |
| 32 | CSRF: forged cross-origin request rejected | PASS / FAIL / NOT TESTED | |
| 33 | CSRF: legitimate same-origin request still reaches action resolution | PASS / FAIL / NOT TESTED | |
| 34 | No service-role key in client bundle | PASS / FAIL / NOT TESTED | |
| 35 | No secrets in git history | PASS / FAIL / NOT TESTED | |
| 36 | Local-auth fallback structurally unreachable in production | PASS / FAIL / NOT TESTED | |
| 37 | Backup configuration observed | OBSERVED / NOT CHECKED | plan/tier + retention, no restore performed |

## NOT VERIFIED

List anything skipped, and why (e.g. "no deployed HTTPS instance available
yet — only the database was tested").

## FINDINGS

For each (if none, write "None found this run"):

* Severity:
* Component:
* Evidence:
* Reproduction:
* Impact:
* Fix:
* Regression test:
* Verification status:

## BLOCKERS

List anything preventing production launch. If none from this run,
say so explicitly — don't leave blank.

## CLEANUP STATUS

* `KIRACASH_LIVE_VERIFY_*` businesses removed: YES / NO
* Disposable auth users removed: YES / NO
* Verified via: `select count(*) from businesses where name like 'KIRACASH_LIVE_VERIFY_%';` → \_\_\_

## FINAL GATE

One of exactly:

`LIVE VERIFICATION PASS`
`LIVE VERIFICATION FAIL`
`LIVE VERIFICATION BLOCKED`

Do not use a numerical score. Do not call the application "production
ready" from this document alone — this covers security/auth/database only.
