import { describe, it, expect } from "vitest";
import { pesosToCentavos } from "../money/money";
import { calculateSpendableCash } from "./spendableCash";
import type { CashAccount, LedgerEntry } from "./types";

describe("Spendable Cash engine", () => {
  it("matches the product spec example: GCash ₱6,000, committed ₱800 => Spendable ₱5,200", () => {
    const accounts: CashAccount[] = [
      { id: "acc1", businessId: "b1", type: "GCASH", name: "GCash", openingBalance: pesosToCentavos("6000") },
    ];
    const result = calculateSpendableCash({
      accounts,
      ledgerEntries: [],
      committedObligations: [
        { id: "c1", businessId: "b1", description: "Restock", amount: pesosToCentavos("800"), dueDate: null },
      ],
    });
    expect(result.availableCash).toBe(pesosToCentavos("6000"));
    expect(result.spendableCash).toBe(pesosToCentavos("5200"));
  });

  it("EXCLUDES marketplace escrow accounts from available cash entirely", () => {
    const accounts: CashAccount[] = [
      { id: "acc1", businessId: "b1", type: "GCASH", name: "GCash", openingBalance: pesosToCentavos("1000") },
      { id: "acc2", businessId: "b1", type: "MARKETPLACE_ESCROW", name: "Shopee Pending", openingBalance: pesosToCentavos("4500") },
    ];
    const result = calculateSpendableCash({ accounts, ledgerEntries: [], committedObligations: [] });
    expect(result.availableCash).toBe(pesosToCentavos("1000"));
    expect(result.accountBalances.find((b) => b.accountId === "acc2")).toBeUndefined();
  });

  it("derives account balance from ledger entries, not a cached field", () => {
    const accounts: CashAccount[] = [
      { id: "acc1", businessId: "b1", type: "CASH", name: "Cash on hand", openingBalance: pesosToCentavos("1000") },
    ];
    const entries: LedgerEntry[] = [
      { id: "l1", businessId: "b1", type: "SALE_CASH_IN", accountId: "acc1", amount: pesosToCentavos("800"), effectiveAt: "2026-08-01", createdAt: "2026-08-01", createdBy: "u1", sourceDocumentId: null, reversalOfId: null, note: "" },
      { id: "l2", businessId: "b1", type: "EXPENSE", accountId: "acc1", amount: pesosToCentavos("-180"), effectiveAt: "2026-08-01", createdAt: "2026-08-01", createdBy: "u1", sourceDocumentId: null, reversalOfId: null, note: "Lalamove" },
    ];
    const result = calculateSpendableCash({ accounts, ledgerEntries: entries, committedObligations: [] });
    expect(result.availableCash).toBe(pesosToCentavos("1620")); // 1000 + 800 - 180
  });

  it("never goes negative — clamps spendable cash to zero if obligations exceed cash", () => {
    const accounts: CashAccount[] = [
      { id: "acc1", businessId: "b1", type: "GCASH", name: "GCash", openingBalance: pesosToCentavos("500") },
    ];
    const result = calculateSpendableCash({
      accounts,
      ledgerEntries: [],
      committedObligations: [
        { id: "c1", businessId: "b1", description: "Restock", amount: pesosToCentavos("2000"), dueDate: null },
      ],
    });
    expect(result.spendableCash).toBe(pesosToCentavos("0"));
  });

  it("reports pending marketplace funds and receivables informationally, never inside spendableCash", () => {
    const accounts: CashAccount[] = [
      { id: "acc1", businessId: "b1", type: "GCASH", name: "GCash", openingBalance: pesosToCentavos("1000") },
    ];
    const result = calculateSpendableCash({
      accounts,
      ledgerEntries: [],
      committedObligations: [],
      pendingMarketplaceFunds: pesosToCentavos("8500"),
      unpaidReceivablesTotal: pesosToCentavos("1200"),
    });
    expect(result.spendableCash).toBe(pesosToCentavos("1000"));
    expect(result.pendingMarketplaceFunds).toBe(pesosToCentavos("8500"));
    expect(result.unpaidReceivables).toBe(pesosToCentavos("1200"));
  });

  it("applies an optional safety buffer", () => {
    const accounts: CashAccount[] = [
      { id: "acc1", businessId: "b1", type: "CASH", name: "Cash", openingBalance: pesosToCentavos("1000") },
    ];
    const result = calculateSpendableCash({
      accounts,
      ledgerEntries: [],
      committedObligations: [],
      safetyBuffer: pesosToCentavos("200"),
    });
    expect(result.spendableCash).toBe(pesosToCentavos("800"));
  });
});
