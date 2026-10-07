-- Same defense-in-depth pattern as 0007 (products) and 0008 (expenses): a
-- non-positive receivable payment is now rejected by applyReceivablePayment()
-- (src/lib/finance/receivables.ts, InvalidPaymentAmountError) and by the
-- z.number().positive() schema in src/app/utang/actions.ts, but nothing at
-- the database layer enforced it. A zero/negative payment reaching this
-- table would either be a no-op that still writes a real ledger entry and
-- receivable_payments row, or — for a negative amount — silently reduce
-- amount_paid_centavos on the receivable while also writing a negative
-- RECEIVABLE_PAYMENT ledger entry (a cash decrease disguised as a payment).
alter table receivable_payments
  add constraint receivable_payments_amount_positive check (amount_centavos > 0);
