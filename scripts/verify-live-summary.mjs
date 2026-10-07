#!/usr/bin/env node
/**
 * Runs after preflight + the live RLS script both pass. Does not test
 * anything itself — just states plainly what `npm run verify:live` did
 * and did not just prove, so nobody mistakes "the script exited 0" for
 * "the whole runbook is done."
 */
console.log(`
=== npm run verify:live — summary ===

AUTOMATED BY THIS COMMAND (just now, against the real project):
  - Environment/connectivity preflight
  - Two-tenant RLS/tenant-isolation adversarial suite
  - is_business_member() pg_temp shadowing regression (0010)
  - ledger_entries/expenses account-business consistency trigger (0011)
  - legitimate same-business access sanity check

NOT covered by this command — see docs/LIVE_SUPABASE_VERIFICATION_RUNBOOK.md
for each of these, in order:
  - Live auth UX (signup/login/logout/session, steps 5)
  - Password reset email + real browser link click (step 5)
  - Financial integrity walkthrough via the app itself (step 8)
  - Concurrency test (step 9)
  - Server-side IDOR test against the deployed app (step 10)
  - Rate limiting (step 11)
  - Cookie flags on deployed HTTPS (step 12)
  - CSRF against the deployed origin (step 13)
  - Production configuration / client-bundle secret scan (step 14)
  - Backup/recovery posture in the Supabase dashboard (step 15)
  - Cleanup verification (step 18)

Fill in docs/LIVE_SUPABASE_VERIFICATION_RESULTS.md with the full picture
before calling this verification complete.
`);
