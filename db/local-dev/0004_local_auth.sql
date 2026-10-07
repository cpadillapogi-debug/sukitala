-- LOCAL AUTH STAND-IN — NOT SUPABASE AUTH.
--
-- This migration exists ONLY because no live Supabase project is reachable
-- from the environment this scaffold was built in (see KNOWN_LIMITATIONS.md
-- and ARCHITECTURE.md "Authentication"). Real Supabase Auth stores
-- credentials, handles password hashing, session/JWT issuance, and email
-- verification itself — an application never touches any of that directly.
--
-- This table exists so a real, working signup/login flow could be built and
-- tested against local Postgres. When a real Supabase project is connected:
--   1. Do NOT run this migration against it — Supabase's `auth` schema
--      already handles credentials natively via GoTrue.
--   2. Replace src/lib/auth/authService.ts's local implementation with
--      supabase-js calls (signUp/signInWithPassword/signOut). Nothing else
--      in this codebase needs to change — RLS policies key off auth.uid(),
--      and withUserContext() already accepts an arbitrary userId, so the
--      swap is isolated to the auth adapter layer.
--
-- Passwords are NEVER stored in plaintext — bcrypt hashes only, generated
-- by src/lib/auth/password.ts (never write a raw password to this table
-- from anywhere else).
create table local_auth_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  password_hash text not null,
  created_at timestamptz not null default now()
);

-- No RLS policy here on purpose: this table is only ever touched by the
-- auth adapter using the ADMIN connection (bypasses RLS), during signup
-- (before any session exists) and login (before auth.uid() can be set,
-- since verifying the password IS what establishes identity). It is never
-- queried through withUserContext() / the app_user role. See
-- src/lib/data/db.ts for the admin-vs-app_user connection split, and
-- SECURITY.md for why this split is safe.
alter table local_auth_credentials enable row level security;
-- Deliberately NO policies: RLS with zero policies denies ALL access to any
-- non-superuser role, including app_user. Only the admin/superuser
-- connection (which bypasses RLS entirely) can ever read or write this
-- table. This is stricter than "add a policy" — there is no policy an
-- attacker could exploit a bug in.
