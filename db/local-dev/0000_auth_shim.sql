-- LOCAL DEV ONLY. Supabase provides `auth.users`, `auth.uid()`, and the
-- `auth` schema for real. This file exists ONLY so the migrations in
-- db/migrations/ can be applied and tested against a plain local Postgres
-- instance (e.g. for CI or local dev without a Supabase project yet).
--
-- NEVER run this against a real Supabase database — it already has a real
-- (and much more complete) auth schema; this shim would conflict with it.

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamptz not null default now()
);

-- In real Supabase, auth.uid() reads the JWT claim of the current request.
-- Locally, we fake it via a session-local setting so RLS policies can be
-- exercised in tests: `select set_config('kiracash.test_user_id', '<uuid>', true);`
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('kiracash.test_user_id', true), '')::uuid;
$$;
