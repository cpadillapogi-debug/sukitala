-- KiraCash core schema: users, businesses, memberships
-- Money is ALWAYS stored as BIGINT centavos, never NUMERIC/float, matching
-- src/lib/money/money.ts. Do not add a float/real money column anywhere.

create extension if not exists "pgcrypto";

create table businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Asia/Manila',
  currency text not null default 'PHP',
  created_at timestamptz not null default now()
);

-- Supabase: auth.users is managed by Supabase Auth. This table extends it.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create type membership_role as enum ('OWNER', 'STAFF');

create table memberships (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role membership_role not null default 'OWNER',
  created_at timestamptz not null default now(),
  unique (business_id, user_id)
);

create index idx_memberships_user on memberships(user_id);
create index idx_memberships_business on memberships(business_id);

alter table businesses enable row level security;
alter table profiles enable row level security;
alter table memberships enable row level security;

-- A user may only see businesses they are a member of.
create policy "member can view own business"
  on businesses for select
  using (
    id in (select business_id from memberships where user_id = auth.uid())
  );

create policy "member can view own memberships"
  on memberships for select
  using (user_id = auth.uid());

create policy "user can view own profile"
  on profiles for select
  using (id = auth.uid());

create policy "user can update own profile"
  on profiles for update
  using (id = auth.uid());
