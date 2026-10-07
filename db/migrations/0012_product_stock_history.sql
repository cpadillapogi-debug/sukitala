-- Inventory history: every stock-quantity change on a product, so sellers
-- can see "why did this product's stock change" the same way they can
-- already see every cash movement in ledger_entries. Reuses that table's
-- own append-only pattern (a BEFORE UPDATE/DELETE trigger rejecting both
-- outright) rather than inventing a different integrity mechanism.
--
-- change_qty is signed: positive for a restock, negative for a sale or a
-- downward manual adjustment. previous_qty/new_qty are the product's
-- stock_qty immediately before/after, captured at write time so history
-- stays accurate even if stock is adjusted again later.
create table product_stock_history (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  change_qty integer not null,
  previous_qty integer not null,
  new_qty integer not null,
  reason text not null check (reason in ('RESTOCK', 'SALE', 'ADJUSTMENT')),
  note text,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  -- Same integrity invariant as ledger_entries: new_qty must actually equal
  -- previous_qty + change_qty. Catches an application bug writing an
  -- inconsistent history row at the database layer, not just app code.
  check (new_qty = previous_qty + change_qty)
);

create index idx_product_stock_history_product on product_stock_history(product_id, created_at desc);
create index idx_product_stock_history_business on product_stock_history(business_id);

alter table product_stock_history enable row level security;

create policy "tenant isolation" on product_stock_history
  for all
  using (is_business_member(business_id))
  with check (is_business_member(business_id));

-- Same account/business-consistency reasoning as 0011's
-- account_matches_business(): product_id's own business must match
-- business_id, so a member of Business A can't write a history row
-- against a product that actually belongs to Business B.
create function product_matches_business() returns trigger
language plpgsql as $$
begin
  if not exists (
    select 1 from products where products.id = NEW.product_id and products.business_id = NEW.business_id
  ) then
    raise exception 'product_id % does not belong to business_id % (cross-tenant product reference rejected)',
      NEW.product_id, NEW.business_id;
  end if;
  return NEW;
end;
$$;

create trigger product_stock_history_product_matches_business
  before insert on product_stock_history
  for each row execute function product_matches_business();

create or replace function no_history_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'product_stock_history is append-only: % is not allowed', TG_OP;
end;
$$;

create trigger no_product_stock_history_update
  before update on product_stock_history
  for each row execute function no_history_mutation();

create trigger no_product_stock_history_delete
  before delete on product_stock_history
  for each row execute function no_history_mutation();
