import { describe, it, expect } from "vitest";
import { pesosToCentavos } from "../money/money";
import { calculateRevenue, calculateCOGS, calculateGrossProfit, calculateNetProfit } from "./profit";
import type { Order, Expense } from "./types";

function order(overrides: Partial<Order> & { items: Order["items"] }): Order {
  return {
    id: "o1",
    businessId: "b1",
    customerId: null,
    channel: "FACEBOOK",
    paymentStatus: "PAID",
    paymentMethod: "GCASH",
    createdAt: new Date().toISOString(),
    pendingMarketplaceSettlement: false,
    ...overrides,
  };
}

describe("profit engine — spec Case 1", () => {
  it("Product COGS ₱200, Sale ₱400, Qty 2 => Revenue 800, COGS 400, Gross Profit 400", () => {
    const orders = [
      order({
        items: [
          {
            productId: "p1",
            quantity: 2,
            unitPrice: pesosToCentavos("400"),
            unitCogs: pesosToCentavos("200"),
          },
        ],
      }),
    ];
    expect(calculateRevenue(orders)).toBe(pesosToCentavos("800"));
    expect(calculateCOGS(orders)).toBe(pesosToCentavos("400"));
    expect(calculateGrossProfit(orders)).toBe(pesosToCentavos("400"));
  });
});

describe("profit engine — spec Case 2", () => {
  it("Sale ₱1,000, fee ₱100, COGS ₱500, logistics ₱50 => Net Profit ₱350", () => {
    const orders = [
      order({
        items: [
          { productId: "p1", quantity: 1, unitPrice: pesosToCentavos("1000"), unitCogs: pesosToCentavos("500") },
        ],
      }),
    ];
    const expenses: Expense[] = [
      { id: "e1", businessId: "b1", category: "PLATFORM_FEE", amount: pesosToCentavos("100"), accountId: "a1", createdAt: new Date().toISOString() },
      { id: "e2", businessId: "b1", category: "LOGISTICS", amount: pesosToCentavos("50"), accountId: "a1", createdAt: new Date().toISOString() },
    ];
    const result = calculateNetProfit(orders, expenses);
    expect(result.netProfit).toBe(pesosToCentavos("350"));
  });
});

describe("profit engine edge cases", () => {
  it("handles zero-value orders", () => {
    expect(calculateRevenue([])).toBe(pesosToCentavos("0"));
    expect(calculateNetProfit([], []).netProfit).toBe(pesosToCentavos("0"));
  });

  it("does not conflate profit recognition with cash — UNPAID orders still count toward revenue/profit here", () => {
    // This is intentional: calculateNetProfit is an accounting view. Callers who
    // want cash must use calculateSpendableCash(), never this function, for that question.
    const orders = [
      order({
        paymentStatus: "UNPAID",
        items: [{ productId: "p1", quantity: 1, unitPrice: pesosToCentavos("1000"), unitCogs: pesosToCentavos("500") }],
      }),
    ];
    expect(calculateGrossProfit(orders)).toBe(pesosToCentavos("500"));
  });
});
