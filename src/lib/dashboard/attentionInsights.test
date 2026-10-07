import { describe, it, expect } from "vitest";
import { buildAttentionInsights } from "./attentionInsights";
import { pesosToCentavos } from "../money/money";
import type { Receivable, Order, Product } from "../finance/types";

const now = new Date("2026-06-15T12:00:00Z");

function receivable(overrides: Partial<Receivable> = {}): Receivable {
  return {
    id: "r1",
    businessId: "b1",
    customerId: "c1",
    orderId: null,
    totalOwed: pesosToCentavos("500"),
    amountPaid: pesosToCentavos("0"),
    dueDate: null,
    status: "UNPAID",
    ...overrides,
  };
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1",
    businessId: "b1",
    name: "T-shirt",
    sku: null,
    unitCogs: pesosToCentavos("180"),
    sellingPrice: pesosToCentavos("350"),
    stockQty: 20,
    reorderThreshold: 5,
    active: true,
    ...overrides,
  };
}

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: "o1",
    businessId: "b1",
    customerId: null,
    channel: "MESSENGER",
    items: [],
    paymentStatus: "PAID",
    paymentMethod: "CASH",
    createdAt: now.toISOString(),
    pendingMarketplaceSettlement: false,
    ...overrides,
  };
}

describe("buildAttentionInsights — the fix for the hardcoded fake dashboard bullets", () => {
  it(
    "returns an EMPTY list for a brand-new business with no data — never invents an insight " +
      "just to fill space (this is the exact bug being fixed: the restored checkpoint's dashboard " +
      "always showed '₱1,200 utang from Maria is overdue' and '₱8,500 pending from Shopee' " +
      "regardless of the user's actual data)",
    () => {
      const insights = buildAttentionInsights({ unpaidReceivables: [], products: [], orders: [], now });
      expect(insights).toEqual([]);
    }
  );

  it("reports unpaid receivables using the REAL total and count, not a hardcoded example", () => {
    const insights = buildAttentionInsights({
      unpaidReceivables: [receivable({ totalOwed: pesosToCentavos("1200"), amountPaid: pesosToCentavos("0") })],
      products: [],
      orders: [],
      now,
    });
    expect(insights).toHaveLength(1);
    expect(insights[0].text).toContain("₱1,200.00");
    expect(insights[0].text).toContain("1 customer");
    expect(insights[0].href).toBe("/utang");
  });

  it("sums MULTIPLE unpaid receivables (remaining balance, not total owed) correctly", () => {
    const insights = buildAttentionInsights({
      unpaidReceivables: [
        receivable({ totalOwed: pesosToCentavos("500"), amountPaid: pesosToCentavos("200") }), // 300 remaining
        receivable({ totalOwed: pesosToCentavos("1000"), amountPaid: pesosToCentavos("0") }), // 1000 remaining
      ],
      products: [],
      orders: [],
      now,
    });
    expect(insights[0].text).toContain("₱1,300.00");
    expect(insights[0].text).toContain("2 customers");
  });

  it("reports out-of-stock and low-stock products separately, by real stockQty vs reorderThreshold", () => {
    const insights = buildAttentionInsights({
      unpaidReceivables: [],
      products: [
        product({ name: "T-shirt", stockQty: 0, reorderThreshold: 5 }),
        product({ name: "Tote bag", stockQty: 3, reorderThreshold: 5 }),
        product({ name: "Mug", stockQty: 40, reorderThreshold: 5 }), // healthy stock, no insight
      ],
      orders: [],
      now,
    });
    const texts = insights.map((i) => i.text);
    expect(texts.some((t) => t.includes("T-shirt") && t.includes("out of stock"))).toBe(true);
    expect(texts.some((t) => t.includes("Tote bag") && t.includes("running low"))).toBe(true);
    expect(texts.join(" ")).not.toContain("Mug");
  });

  it("names the single low-stock product but summarizes when there are several", () => {
    const single = buildAttentionInsights({
      unpaidReceivables: [],
      products: [product({ name: "Only Low Item", stockQty: 2, reorderThreshold: 5 })],
      orders: [],
      now,
    });
    expect(single[0].text).toBe('"Only Low Item" is running low (2 left).');

    const multiple = buildAttentionInsights({
      unpaidReceivables: [],
      products: [
        product({ name: "A", stockQty: 1, reorderThreshold: 5 }),
        product({ name: "B", stockQty: 2, reorderThreshold: 5 }),
      ],
      orders: [],
      now,
    });
    expect(multiple[0].text).toBe("2 products are running low.");
  });

  it("counts real sales from THIS week only, using each order's actual createdAt", () => {
    const insights = buildAttentionInsights({
      unpaidReceivables: [],
      products: [],
      orders: [
        order({ createdAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString() }), // 2 days ago: in
        order({ createdAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString() }), // 10 days ago: out
      ],
      now,
    });
    expect(insights).toHaveLength(1);
    expect(insights[0].text).toBe("You recorded 1 sale this week.");
  });

  it("returns multiple insights together when multiple things are real and true at once", () => {
    const insights = buildAttentionInsights({
      unpaidReceivables: [receivable()],
      products: [product({ stockQty: 0 })],
      orders: [order()],
      now,
    });
    expect(insights.length).toBe(3);
  });
});
