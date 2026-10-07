create type receivable_status as enum ('UNPAID', 'PARTIAL', 'OVERDUE', 'SETTLED');

create table receivables (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  customer_id uuid not null references customers(id),
  order_id uuid references orders(id),
  total_owed_centavos bigint not null,
  amount_paid_centavos bigint not null default 0,
  due_date date,
  status receivable_status not null default 'UNPAID',
  created_at timestamptz not null default now()
);

create index idx_receivables_business on receivables(business_id);
create index idx_receivables_status on receivables(business_id, status);

create table receivable_payments (
  id uuid primary key default gen_random_uuid(),
  receivable_id uuid not null references receivables(id) on delete cascade,
  amount_centavos bigint not null,
  -- ON DELETE CASCADE for the same reason as order_items.product_id in
  -- 0002_financial_core.sql: without it, deleting a business can hit a real
  -- FK-ordering conflict (Postgres attempting to delete a ledger_entries row
  -- before the receivable_payments row referencing it is gone), even though
  -- both are slated for deletion in the same cascade. Caught by
  -- finance.integration.test.ts's own afterAll cleanup, not by inspection —
  -- see KNOWN_LIMITATIONS.md.
  ledger_entry_id uuid references ledger_entries(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id)
);

-- Payment proof: OCR/AI extraction of an uploaded screenshot. Status here is
-- the ONLY place the product is allowed to say anything about verification —
-- see src/lib/finance/duplicateDetection.ts for the exact state machine and
-- product rule ("never claim independently verified").
create type payment_proof_status as enum (
  'UNVERIFIED', 'PENDING_REVIEW', 'DUPLICATE_SUSPECTED',
  'MATCHED', 'CONFIRMED_BY_ACCOUNT_DATA', 'REJECTED'
);

create table payment_proofs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  storage_path text not null, -- private Supabase Storage object path, never public
  reference_number text,
  amount_centavos bigint,
  extracted_timestamp timestamptz,
  sender_name text,
  image_hash text,
  ocr_confidence numeric(4,3),
  status payment_proof_status not null default 'UNVERIFIED',
  -- Same reasoning as receivable_payments.ledger_entry_id above — CASCADE
  -- for cascade-safety on whole-business deletion, not because deleting one
  -- ledger entry should silently unmatch a payment proof in normal operation
  -- (nothing in this codebase deletes a single ledger_entries row directly;
  -- it's append-only per the trigger in 0002_financial_core.sql).
  matched_ledger_entry_id uuid references ledger_entries(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id)
);

create index idx_payment_proofs_business on payment_proofs(business_id);
create index idx_payment_proofs_reference on payment_proofs(business_id, reference_number);
create index idx_payment_proofs_hash on payment_proofs(business_id, image_hash);

create table marketplace_imports (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  channel text not null, -- 'SHOPEE' | 'TIKTOK_SHOP' | 'LAZADA'
  file_name text not null,
  row_count integer not null default 0,
  imported_count integer not null default 0,
  duplicate_count integer not null default 0,
  error_count integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id)
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  actor_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_audit_business on audit_logs(business_id, created_at);

create type plan_tier as enum ('FREE', 'PRO');

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references businesses(id) on delete cascade,
  plan plan_tier not null default 'FREE',
  status text not null default 'ACTIVE', -- ACTIVE | PAST_DUE | CANCELED
  ocr_scans_used_this_period integer not null default 0,
  period_start date not null default current_date,
  billing_provider_ref text, -- external billing provider's subscription id, once wired
  created_at timestamptz not null default now()
);

alter table receivables enable row level security;
alter table receivable_payments enable row level security;
alter table payment_proofs enable row level security;
alter table marketplace_imports enable row level security;
alter table audit_logs enable row level security;
alter table subscriptions enable row level security;

create policy "tenant isolation" on receivables for all using (is_business_member(business_id));
create policy "tenant isolation" on receivable_payments for all
  using (is_business_member((select business_id from receivables where receivables.id = receivable_payments.receivable_id)));
create policy "tenant isolation" on payment_proofs for all using (is_business_member(business_id));
create policy "tenant isolation" on marketplace_imports for all using (is_business_member(business_id));
create policy "tenant isolation select" on audit_logs for select using (is_business_member(business_id));
create policy "tenant isolation" on subscriptions for all using (is_business_member(business_id));
