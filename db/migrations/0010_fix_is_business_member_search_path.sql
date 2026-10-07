-- CRITICAL SECURITY FIX — tenant isolation bypass.
--
-- is_business_member() (0002_financial_core.sql) is SECURITY DEFINER but
-- referenced `memberships` unqualified, with no `search_path` pinned. Every
-- RLS policy in this schema ("tenant isolation") is `using
-- (is_business_member(business_id))`, so this function is the single gate
-- that ALL cross-tenant protection in the entire application depends on.
--
-- This was verified LIVE, exploitable by any authenticated app_user with NO
-- special privileges (confirmed app_user has no CREATE on the public
-- schema or the database itself — this does not require any misconfigured
-- grant, just an ordinary session):
--
--   set_config('kiracash.test_user_id', '<attacker>', false);
--   create temp table memberships (business_id uuid, user_id uuid, role text);
--   insert into memberships select '<any business id>', '<attacker>', 'OWNER';
--   select is_business_member('<any business id>');  -- returned TRUE
--
-- Postgres always searches pg_temp first for unqualified relation names
-- inside a function body, regardless of that function's own search_path —
-- setting search_path alone does NOT stop this. An attacker's own ordinary
-- session-scoped temp table silently shadowed the real public.memberships
-- table inside this SECURITY DEFINER function, letting them grant
-- themselves fake membership in any business and bypass every RLS policy
-- in the schema (read/write access to every tenant's accounts, products,
-- orders, ledger_entries, receivables, receivable_payments, payment_proofs,
-- expenses, customers, subscriptions).
--
-- Fix: schema-qualify the table reference (defeats pg_temp shadowing,
-- which search_path cannot) AND pin search_path to '' as defense-in-depth
-- (Supabase's own documented recommendation for SECURITY DEFINER
-- functions). auth.uid() was already schema-qualified so is unaffected
-- either way.
create or replace function is_business_member(target_business_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships
    where business_id = target_business_id
      and user_id = auth.uid()
  );
$$;
