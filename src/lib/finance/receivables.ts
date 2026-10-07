import { add, subtract, ZERO, type Centavos } from "../money/money";
import type { Receivable, ReceivableStatus } from "./types";

export function remainingBalance(r: Receivable): Centavos {
  return subtract(r.totalOwed, r.amountPaid);
}

/**
 * Recomputes a receivable's status deterministically from its amounts and due date.
 * A payment NEVER directly sets status — status is always derived, so it can't
 * drift out of sync with the actual paid/owed amounts.
 */
export function deriveReceivableStatus(
  r: Pick<Receivable, "totalOwed" | "amountPaid" | "dueDate">,
  now: Date = new Date()
): ReceivableStatus {
  const remaining = subtract(r.totalOwed, r.amountPaid);
  if (remaining <= ZERO) return "SETTLED";
  if (r.dueDate && new Date(r.dueDate) < now) return "OVERDUE";
  if (r.amountPaid > ZERO) return "PARTIAL";
  return "UNPAID";
}

export class OverpaymentError extends Error {
  constructor(
    public readonly paymentAmount: Centavos,
    public readonly remaining: Centavos
  ) {
    super(
      `Payment of ${paymentAmount} would exceed remaining balance of ${remaining}. ` +
        `This is rejected outright — there is no "apply as credit" path yet (see KNOWN_LIMITATIONS.md). ` +
        `Confirm the correct amount with the user, or record a smaller payment.`
    );
  }
}

export class InvalidPaymentAmountError extends Error {
  constructor(public readonly paymentAmount: Centavos) {
    super(
      `Payment amount must be positive, got ${paymentAmount}. A zero or negative payment would ` +
        `either be a no-op that still writes ledger noise, or — worse — silently REDUCE the ` +
        `amount already paid on this receivable and write a negative RECEIVABLE_PAYMENT ledger ` +
        `entry (a cash decrease disguised as a payment).`
    );
  }
}

/**
 * Applies a payment to a receivable, returning the updated record.
 * Overpayment is rejected — the caller must ask the user to confirm/adjust
 * rather than silently letting the balance go negative. A non-positive
 * payment amount is rejected too, for the same "never silently do the
 * opposite of what the caller asked for" reason — the current only caller
 * (src/app/utang/actions.ts) already enforces this via z.number().positive(),
 * but this is the shared, reusable domain function, so it enforces its own
 * invariant rather than trusting every future caller to have done so.
 */
export function applyReceivablePayment(
  r: Receivable,
  paymentAmount: Centavos,
  now: Date = new Date()
): Receivable {
  if (paymentAmount <= 0) {
    throw new InvalidPaymentAmountError(paymentAmount);
  }
  const newAmountPaid = add(r.amountPaid, paymentAmount);
  if (newAmountPaid > r.totalOwed) {
    throw new OverpaymentError(paymentAmount, remainingBalance(r));
  }
  const updated: Receivable = { ...r, amountPaid: newAmountPaid };
  return { ...updated, status: deriveReceivableStatus(updated, now) };
}

export function totalUnpaidReceivables(receivables: Receivable[]): Centavos {
  return add(
    ...receivables
      .filter((r) => r.status !== "SETTLED")
      .map((r) => remainingBalance(r)),
    ZERO
  );
}
