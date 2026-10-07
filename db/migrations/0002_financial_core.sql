-- Financial core: accounts, immutable ledger entries, products, orders.
-- RLS pattern used throughout: a row is visible/mutable only if the
-- requesting user has a membership row for that business_id. business_id is
-- NEVER trusted from client input for writes — see helper function below.

create or replace function is_business_member(target_business_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from memberships
    where business_id = target_business_id
      and user_id = auth.uid()
  );
$$;

create type account_type as enum ('GCASH', 'MAYA', 'BANK', 'CASH', 'MARKETPLACE_ESCROW', 'OTHER');

create table accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  type account_type not null,
  name text not null,
  opening_balance_centavos bigint not null default 0,
  created_at timestamptz not null default now()
);

create index idx_accounts_business on accounts(business_id);

create type ledger_entry_type as enum (
  'SALE_CASH_IN', 'SALE_ON_CREDIT', 'RECEIVABLE_PAYMENT', 'EXPENSE',
  'INVENTORY_PURCHASE', 'MARKETPLACE_PAYOUT_RECEIVED', 'TRANSFER',
  'ADJUSTMENT', 'REVERSAL'
);

-- Immutable ledger. Rows are inserted, never updated. Corrections are new
-- REVERSAL rows referencing reversal_of_id. Enforce via a trigger below.
create table ledger_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  type ledger_entry_type not null,
  account_id uuid references accounts(id),
  amount_centavos bigint not null,
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  source_document_id uuid,
  reversal_of_id uuid references ledger_entries(id),
  note text not null default ''
);

create index idx_ledger_business on ledger_entries(business_id);
create index idx_ledger_account on ledger_entries(account_id);
create index idx_ledger_created_at on ledger_entries(created_at);

create function prevent_ledger_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'ledger_entries is append-only: % not allowed. Insert a REVERSAL row instead.', TG_OP;
end;
$$;

create trigger no_ledger_update before update on ledger_entries
  for each row execute function prevent_ledger_mutation();
create trigger no_ledger_delete before delete on ledger_entries
  for each row execute function prevent_ledger_mutation();

create table products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  sku text,
  unit_cogs_centavos bigint not null default 0,
  selling_price_centavos bigint not null default 0,
  stock_qty integer not null default 0,
  reorder_threshold integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (business_id, sku)
);

create index idx_products_business on products(business_id);

create table customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  contact_info text,
  created_at timestamptz not null default now()
);

create index idx_customers_business on customers(business_id);

create type payment_status as enum ('PAID', 'UNPAID', 'PARTIAL');

create table orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  customer_id uuid references customers(id),
  channel text not null default 'UNKNOWN',
  payment_status payment_status not null,
  payment_method account_type,
  pending_marketplace_settlement boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_orders_business on orders(business_id);

-- product_id is ON DELETE CASCADE so that deleting a whole business (which
-- cascades to both `products` and `orders`/`order_items` independently)
-- can't hit a foreign-key ordering conflict where Postgres tries to delete
-- a product before the order_items row referencing it is gone. This was a
-- real bug caught by finance.integration.test.ts's afterAll cleanup, not a
-- theoretical concern — see KIRACASH_IMPLEMENTATION_PLAN.md.
-- NOTE: this scaffold has no "delete a single product" feature yet — only
-- create/list (see src/lib/data/finance.ts). If that's added later, it
-- should use products.active = false (soft delete) rather than a hard
-- DELETE, specifically so historical order_items are never silently
-- destroyed by removing one product from an otherwise-live business. This
-- CASCADE exists for the "delete the whole business" case, not routine
-- product management.
create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  unit_price_centavos bigint not null,
  unit_cogs_centavos bigint not null
);

create index idx_order_items_order on order_items(order_id);

create table expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  category text not null default 'OTHER',
  amount_centavos bigint not null,
  account_id uuid references accounts(id),
  created_at timestamptz not null default now()
);

create index idx_expenses_business on expenses(business_id);

-- RLS: enable + tenant-isolation policy on every table above.
alter table accounts enable row level security;
alter table ledger_entries enable row level security;
alter table products enable row level security;
alter table customers enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table expenses enable row level security;

create policy "tenant isolation" on accounts for all using (is_business_member(business_id));
create policy "tenant isolation" on ledger_entries for select using (is_business_member(business_id));
create policy "tenant isolation insert" on ledger_entries for insert with check (is_business_member(business_id));
-- UPDATE/DELETE are intentionally permitted by RLS (scoped to the caller's
-- own business) so that an attempt reaches the prevent_ledger_mutation()
-- trigger below and fails with a clear "append-only" error, rather than
-- being silently swallowed by RLS as "0 rows matched" — which would look
-- indistinguishable from the row simply not existing. Defense in depth:
-- a cross-tenant attempt is still stopped by RLS; a same-tenant attempt at
-- mutating history is stopped by the trigger, with an explicit reason.
create policy "tenant isolation update" on ledger_entries for update using (is_business_member(business_id));
create policy "tenant isolation delete" on ledger_entries for delete using (is_business_member(business_id));
create policy "tenant isolation" on products for all using (is_business_member(business_id));
create policy "tenant isolation" on customers for all using (is_business_member(business_id));
create policy "tenant isolation" on orders for all using (is_business_member(business_id));
create policy "tenant isolation" on order_items for all
  using (is_business_member((select business_id from orders where orders.id = order_items.order_id)));
create policy "tenant isolation" on expenses for all using (is_business_member(business_id));
