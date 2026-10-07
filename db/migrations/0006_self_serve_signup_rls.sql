-- Enables self-serve signup to eventually run under the USER'S OWN
-- authenticated session (RLS-respecting) instead of a privileged/service-
-- role bypass — this is a real, production-relevant policy (applies to
-- real Supabase too, not local-only), not part of the local auth shim.
--
-- Without these, the only way to create a brand-new business + its first
-- membership row is via a privileged connection, because is_business_member()
-- has nothing to check yet at insert-time (the row doesn't exist). These
-- policies close that gap narrowly:
--   - businesses: any authenticated user may INSERT a new business. There is
--     no way to restrict this further at this stage (a brand-new business
--     has no members yet) — this is the standard pattern for self-serve
--     SaaS signup. It does NOT grant SELECT/UPDATE/DELETE on businesses the
--     user isn't a member of; the existing "member can view own business"
--     policy is unaffected.
--   - memberships: an authenticated user may INSERT a membership row ONLY
--     for themselves (`user_id = auth.uid()`) — they can make themselves a
--     member/owner of a business they're creating, but can never insert a
--     membership row assigning a DIFFERENT user to any business. This is
--     the actual security-relevant boundary: self-assignment only.
--
-- IMPORTANT CONSEQUENCE, discovered by testing this against real Postgres
-- (see db/local-dev/test-rls.sh): `INSERT ... RETURNING` also requires the
-- new row to pass the table's SELECT policy, not just this INSERT policy's
-- WITH CHECK — and "member can view own business" is false for a business
-- with no membership row yet, so `INSERT INTO businesses (...) RETURNING id`
-- fails even though the INSERT itself is allowed. The correct pattern (and
-- what any real signup adapter built on this — e.g. a future Supabase Auth
-- integration — must do): generate the business id CLIENT-SIDE and INSERT
-- it explicitly, without RETURNING, avoiding the chicken-and-egg check.

create policy "authenticated users can create a business"
  on businesses for insert
  with check (auth.uid() is not null);

create policy "users can add themselves as a member"
  on memberships for insert
  with check (user_id = auth.uid());
