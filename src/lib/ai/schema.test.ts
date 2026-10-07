import { describe, it, expect } from "vitest";
import { parseDraftTransaction, draftExpenseSchema, ocrExtractionSchema } from "./schema";

const baseExpense = {
  intent: "CREATE_EXPENSE" as const,
  confidence: 0.9,
  description: "Lalamove delivery",
  category: "LOGISTICS" as const,
};

describe("moneyAmountSchema (via draftExpenseSchema) — the fix for the sign-inversion gap", () => {
  it("accepts a normal positive amount", () => {
    expect(() => draftExpenseSchema.parse({ ...baseExpense, amount: 180 })).not.toThrow();
  });

  it(
    "REJECTS a negative amount — recordQuickExpense() negates this value for the ledger " +
      "assuming it's a positive magnitude, so a negative amount here would silently flip an " +
      "expense into a cash INCREASE if it ever reached that function",
    () => {
      expect(() => draftExpenseSchema.parse({ ...baseExpense, amount: -180 })).toThrow();
    }
  );

  it("rejects a zero amount", () => {
    expect(() => draftExpenseSchema.parse({ ...baseExpense, amount: 0 })).toThrow();
  });

  it("still rejects more than 2 decimal places (pre-existing behavior, unchanged)", () => {
    expect(() => draftExpenseSchema.parse({ ...baseExpense, amount: 1.999 })).toThrow();
  });

  it("parseDraftTransaction throws (not silently coerces) on a negative amount end-to-end", () => {
    expect(() => parseDraftTransaction({ ...baseExpense, amount: -50 })).toThrow();
  });
});

describe("ocrExtractionSchema.amount — same contract applies to future OCR extraction", () => {
  it("rejects a negative extracted amount", () => {
    expect(() =>
      ocrExtractionSchema.parse({
        amount: -100,
        referenceNumber: "REF123",
        senderName: "Juan",
        recipientName: "Store",
        timestamp: null,
        paymentProvider: "GCASH",
        confidence: 0.8,
      })
    ).toThrow();
  });

  it("still allows null (nothing extracted)", () => {
    expect(() =>
      ocrExtractionSchema.parse({
        amount: null,
        referenceNumber: null,
        senderName: null,
        recipientName: null,
        timestamp: null,
        paymentProvider: "UNKNOWN",
        confidence: 0.1,
      })
    ).not.toThrow();
  });
});
