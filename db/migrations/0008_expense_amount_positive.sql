-- recordQuickExpense() (src/lib/data/finance.ts) stores expenses.amount_centavos
-- as a positive magnitude and negates it separately when writing the ledger
-- entry. Nothing at the database layer enforced that assumption — a
-- negative amount reaching this table would silently become a cash INCREASE
-- once negated for the ledger, inverting the transaction's real effect.
--
-- The application layer now guards this at two points (the AI-output Zod
-- schema in src/lib/ai/schema.ts, and an explicit assertPositiveCentavos()
-- check in recordQuickExpense() itself), but per the same "database must
-- reject it too, not just application code" principle already applied to
-- products (0007_product_price_constraints.sql), this is the last line of
-- defense.
alter table expenses
  add constraint expenses_amount_positive check (amount_centavos > 0);
