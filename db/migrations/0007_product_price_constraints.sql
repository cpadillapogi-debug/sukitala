-- Products currently have no floor on price/cost columns: pesosToCentavos()
-- (src/lib/money/money.ts) accepts negative amounts by design (it's used
-- for signed ledger entries too), and nothing downstream of it rejected a
-- negative value before it reached the products table. Quick Add's
-- window.prompt()-based product creation flow could pass a user-typed
-- negative number straight through with no validation at any layer.
--
-- This mirrors the existing `quantity > 0` check already used on
-- order_items (0002_financial_core.sql) — same pattern, applied to the one
-- table that was missing it for money columns.
alter table products
  add constraint products_selling_price_non_negative check (selling_price_centavos >= 0),
  add constraint products_unit_cogs_non_negative check (unit_cogs_centavos >= 0);
