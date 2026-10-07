import { describe, it, expect } from "vitest";
import { stockStatus, inventoryCostValue, potentialSalesValue, potentialGrossProfit, summarizeInventory } from "./inventory";
import { pesosToCentavos } from "../money/money";
import type { Product } from "./types";

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1",
    businessId: "b1",
    name: "T-shirt",
    sku: null,
    unitCogs: pesosToCentavos("180"),
    sellingPrice: pesosToCentavos("350"),
    stockQty: 12,
    reorderThreshold: 5,
    active: true,
    ...overrides,
  };
}

describe("stockStatus", () => {
  it("is OUT_OF_STOCK at exactly zero", () => {
    expect(stockStatus(product({ stockQty: 0 }))).toBe("OUT_OF_STOCK");
  });

  it("is OUT_OF_STOCK defensively below zero, rather than throwing", () => {
    expect(stockStatus(product({ stockQty: -1 }))).toBe("OUT_OF_STOCK");
  });

  it("is LOW_STOCK at exactly the reorder threshold", () => {
    expect(stockStatus(product({ stockQty: 5, reorderThreshold: 5 }))).toBe("LOW_STOCK");
  });

  it("is LOW_STOCK below the threshold but above zero", () => {
    expect(stockStatus(product({ stockQty: 2, reorderThreshold: 5 }))).toBe("LOW_STOCK");
  });

  it("is IN_STOCK once above the threshold", () => {
    expect(stockStatus(product({ stockQty: 6, reorderThreshold: 5 }))).toBe("IN_STOCK");
  });
});

describe("inventory value calculations — the worked example from the product spec", () => {
  // 12 units, cost ₱180 each, selling price ₱350 each
  const p = product({ stockQty: 12, unitCogs: pesosToCentavos("180"), sellingPrice: pesosToCentavos("350") });

  it("inventoryCostValue = 12 * 180 = ₱2,160", () => {
    expect(inventoryCostValue(p)).toBe(pesosToCentavos("2160"));
  });

  it("potentialSalesValue = 12 * 350 = ₱4,200", () => {
    expect(potentialSalesValue(p)).toBe(pesosToCentavos("4200"));
  });

  it("potentialGrossProfit = 4200 - 2160 = ₱2,040", () => {
    expect(potentialGrossProfit(p)).toBe(pesosToCentavos("2040"));
  });

  it("all values are zero for a product with no stock", () => {
    const empty = product({ stockQty: 0 });
    expect(inventoryCostValue(empty)).toBe(pesosToCentavos("0"));
    expect(potentialSalesValue(empty)).toBe(pesosToCentavos("0"));
    expect(potentialGrossProfit(empty)).toBe(pesosToCentavos("0"));
  });
});

describe("summarizeInventory", () => {
  it("returns all zeros for an empty product list", () => {
    const s = summarizeInventory([]);
    expect(s.totalCostValue).toBe(pesosToCentavos("0"));
    expect(s.totalPotentialSalesValue).toBe(pesosToCentavos("0"));
    expect(s.totalPotentialGrossProfit).toBe(pesosToCentavos("0"));
    expect(s.outOfStockCount).toBe(0);
    expect(s.lowStockCount).toBe(0);
    expect(s.inStockCount).toBe(0);
  });

  it("sums cost/sales/profit across multiple products and buckets by status", () => {
    const products = [
      product({ name: "A", stockQty: 12, unitCogs: pesosToCentavos("180"), sellingPrice: pesosToCentavos("350") }), // in stock
      product({ name: "B", stockQty: 2, reorderThreshold: 5, unitCogs: pesosToCentavos("50"), sellingPrice: pesosToCentavos("100") }), // low
      product({ name: "C", stockQty: 0, unitCogs: pesosToCentavos("20"), sellingPrice: pesosToCentavos("40") }), // out
    ];
    const s = summarizeInventory(products);
    // A: cost 2160, sales 4200 | B: cost 100, sales 200 | C: cost 0, sales 0
    expect(s.totalCostValue).toBe(pesosToCentavos("2260"));
    expect(s.totalPotentialSalesValue).toBe(pesosToCentavos("4400"));
    expect(s.totalPotentialGrossProfit).toBe(pesosToCentavos("2140"));
    expect(s.inStockCount).toBe(1);
    expect(s.lowStockCount).toBe(1);
    expect(s.outOfStockCount).toBe(1);
  });

  it("excludes inactive (archived) products from the totals", () => {
    const s = summarizeInventory([
      product({ active: true, stockQty: 10, unitCogs: pesosToCentavos("10"), sellingPrice: pesosToCentavos("20") }),
      product({ active: false, stockQty: 999, unitCogs: pesosToCentavos("999"), sellingPrice: pesosToCentavos("999") }),
    ]);
    expect(s.totalCostValue).toBe(pesosToCentavos("100"));
    expect(s.inStockCount).toBe(1);
  });
});
