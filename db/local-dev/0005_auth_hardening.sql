-- LOCAL AUTH HARDENING — same status as 0004_local_auth.sql: exists only
-- because no live Supabase project is reachable from this environment.
-- Real Supabase Auth provides session management, rate limiting, and
-- password-reset/email-verification flows natively; this migration is the
-- self-hosted equivalent, local-only, never run against real Supabase.

-- Sessions: makes revocation possible. The session TOKEN (see session.ts)
-- stays a fast, stateless signature+expiry check for cheap verification
-- (e.g. in middleware); this table is the actual authorization boundary
-- checked at getCurrentUserId() — the point where business data is about
-- to be read/written, not merely "should this request see a login page."
create table sessions (
  id uuid primary key default gen_random_uuid(), -- this IS the token's "jti"
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz -- null = still valid; set on logout, password change, or reset
);
create index idx_sessions_user on sessions(user_id);

-- Login attempts: backs rate limiting. Deliberately Postgres-backed, not
-- in-memory — this scaffold's whole architecture already assumes a shared
-- Postgres as the source of truth, so this is consistent (and correctly
-- shared across multiple app server instances, unlike an in-process map)
-- rather than a new kind of infrastructure dependency.
create table login_attempts (
  id uuid primary key default gen_random_uuid(),
  email text not null, -- normalized (lowercase) — see authService.ts
  succeeded boolean not null,
  attempted_at timestamptz not null default now()
);
create index idx_login_attempts_email_time on login_attempts(email, attempted_at);

create table signup_attempts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  attempted_at timestamptz not null default now()
);
create index idx_signup_attempts_email_time on signup_attempts(email, attempted_at);

-- Password reset tokens: the RAW token is only ever shown to the user once
-- (via the dev-log delivery abstraction — see authService.ts, no real email
-- provider is configured); only its SHA-256 hash is ever persisted, so a
-- database read alone can never yield a usable token.
create table password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz -- null = unused; set exactly once, enforcing single-use
);
create index idx_password_reset_user on password_reset_tokens(user_id);
create index idx_password_reset_hash on password_reset_tokens(token_hash);

create table email_verification_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index idx_email_verification_user on email_verification_tokens(user_id);
create index idx_email_verification_hash on email_verification_tokens(token_hash);

alter table auth.users add column if not exists email_verified boolean not null default false;

-- All new tables: RLS enabled with ZERO policies — same reasoning as
-- local_auth_credentials in 0004_local_auth.sql. These are only ever
-- touched via the admin connection (bypasses RLS), never via
-- withUserContext()/app_user, because they're pre-identity or
-- identity-establishing operations, not tenant business data.
alter table sessions enable row level security;
alter table login_attempts enable row level security;
alter table signup_attempts enable row level security;
alter table password_reset_tokens enable row level security;
alter table email_verification_tokens enable row level security;
