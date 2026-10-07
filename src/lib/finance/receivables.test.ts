import { describe, it, expect } from "vitest";
import { pesosToCentavos } from "../money/money";
import {
  applyReceivablePayment,
  deriveReceivableStatus,
  remainingBalance,
  totalUnpaidReceivables,
  OverpaymentError,
  InvalidPaymentAmountError,
} from "./receivables";
import { checkForDuplicate, type PaymentProof } from "./duplicateDetection";
import type { Receivable } from "./types";

function receivable(overrides: Partial<Receivable> = {}): Receivable {
  return {
    id: "r1",
    businessId: "b1",
    customerId: "cust1",
    orderId: "o1",
    totalOwed: pesosToCentavos("1000"),
    amountPaid: pesosToCentavos("0"),
    dueDate: null,
    status: "UNPAID",
    ...overrides,
  };
}

describe("receivables — spec Case 4 & 5", () => {
  it("Case 4: order marked UTANG does not reduce remaining balance until paid", () => {
    const r = receivable();
    expect(remainingBalance(r)).toBe(pesosToCentavos("1000"));
    expect(deriveReceivableStatus(r)).toBe("UNPAID");
  });

  it("Case 5: customer pays ₱500 of ₱1,000 utang => remaining ₱500, status PARTIAL", () => {
    const r = receivable();
    const updated = applyReceivablePayment(r, pesosToCentavos("500"));
    expect(remainingBalance(updated)).toBe(pesosToCentavos("500"));
    expect(updated.status).toBe("PARTIAL");
  });

  it("fully paying a receivable settles it", () => {
    const r = receivable();
    const updated = applyReceivablePayment(r, pesosToCentavos("1000"));
    expect(updated.status).toBe("SETTLED");
    expect(remainingBalance(updated)).toBe(pesosToCentavos("0"));
  });

  it("rejects overpayment with a typed OverpaymentError rather than silently going negative", () => {
    const r = receivable();
    expect(() => applyReceivablePayment(r, pesosToCentavos("1500"))).toThrow(OverpaymentError);
  });

  it(
    "rejects a zero payment with a typed InvalidPaymentAmountError — a no-op payment should " +
      "never silently write a ledger entry and receivable_payments row",
    () => {
      const r = receivable();
      expect(() => applyReceivablePayment(r, pesosToCentavos("0"))).toThrow(InvalidPaymentAmountError);
    }
  );

  it(
    "rejects a negative payment — this is not just invalid input, it would silently REDUCE " +
      "amountPaid (un-paying the receivable) while the caller writes a matching negative " +
      "RECEIVABLE_PAYMENT ledger entry, i.e. a cash decrease disguised as a payment",
    () => {
      const r = receivable({ amountPaid: pesosToCentavos("500") });
      expect(() => applyReceivablePayment(r, pesosToCentavos("-200"))).toThrow(InvalidPaymentAmountError);
      // Confirm it actually throws BEFORE mutating anything — amountPaid must be untouched.
      try {
        applyReceivablePayment(r, pesosToCentavos("-200"));
      } catch {
        // expected
      }
      expect(r.amountPaid).toBe(pesosToCentavos("500"));
    }
  );

  it("marks OVERDUE when past due date and unpaid", () => {
    const r = receivable({ dueDate: "2020-01-01" });
    expect(deriveReceivableStatus(r, new Date("2026-08-20"))).toBe("OVERDUE");
  });

  it("sums total unpaid across receivables, excluding settled ones", () => {
    const receivables = [
      receivable({ id: "r1", totalOwed: pesosToCentavos("1000"), amountPaid: pesosToCentavos("0"), status: "UNPAID" }),
      receivable({ id: "r2", totalOwed: pesosToCentavos("500"), amountPaid: pesosToCentavos("500"), status: "SETTLED" }),
      receivable({ id: "r3", totalOwed: pesosToCentavos("300"), amountPaid: pesosToCentavos("100"), status: "PARTIAL" }),
    ];
    expect(totalUnpaidReceivables(receivables)).toBe(pesosToCentavos("1200"));
  });
});

describe("duplicate payment detection — spec Case 6", () => {
  function proof(overrides: Partial<PaymentProof> = {}): PaymentProof {
    return {
      id: "p1",
      businessId: "b1",
      referenceNumber: "REF123456",
      amount: pesosToCentavos("500"),
      timestamp: "2026-08-20T10:00:00Z",
      senderName: "Juan Dela Cruz",
      imageHash: "hash-abc",
      status: "PENDING_REVIEW",
      ...overrides,
    };
  }

  it("Case 6: same reference number uploaded twice is flagged as suspected duplicate", () => {
    const existing = [proof()];
    const result = checkForDuplicate(
      { referenceNumber: "REF123456", amount: pesosToCentavos("500"), timestamp: "2026-08-20T10:05:00Z", imageHash: "hash-different" },
      existing
    );
    expect(result.isDuplicateSuspected).toBe(true);
    expect(result.matchedProofIds).toContain("p1");
  });

  it("does not flag a genuinely different payment", () => {
    const existing = [proof()];
    const result = checkForDuplicate(
      { referenceNumber: "REF999999", amount: pesosToCentavos("300"), timestamp: "2026-08-21T09:00:00Z", imageHash: "hash-xyz" },
      existing
    );
    expect(result.isDuplicateSuspected).toBe(false);
  });

  it("flags same amount within timestamp proximity even with no reference number", () => {
    const existing = [proof({ referenceNumber: null, imageHash: null })];
    const result = checkForDuplicate(
      { referenceNumber: null, amount: pesosToCentavos("500"), timestamp: "2026-08-20T10:02:00Z", imageHash: null },
      existing
    );
    expect(result.isDuplicateSuspected).toBe(true);
  });

  it("never produces an accusatory status — only suspicion reasons for human review", () => {
    const existing = [proof()];
    const result = checkForDuplicate(
      { referenceNumber: "REF123456", amount: pesosToCentavos("500"), timestamp: null, imageHash: null },
      existing
    );
    expect(result.reasons.every((r) => !/fraud|fake|scam/i.test(r))).toBe(true);
  });
});
