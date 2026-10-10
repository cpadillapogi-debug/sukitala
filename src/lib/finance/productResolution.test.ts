import { describe, it, expect } from "vitest";
import { pesosToCentavos } from "../money/money";
import { resolveProduct } from "./productResolution";
import type { Product } from "./types";

function product(overrides: Partial<Product> & { id: string; name: string }): Product {
  return {
    businessId: "b1",
    sku: null,
    unitCogs: pesosToCentavos("200"),
    sellingPrice: pesosToCentavos("400"),
    stockQty: 10,
    reorderThreshold: 5,
    active: true,
    ...overrides,
  };
}

describe("resolveProduct", () => {
  const heavyTee = product({ id: "p1", name: "Heavy Tee" });
  const heavyTeeXL = product({ id: "p2", name: "Heavy Tee XL" });
  const lightTee = product({ id: "p3", name: "Light Tee" });
  const products = [heavyTee, heavyTeeXL, lightTee];

  it("matches an exact name, case/whitespace-insensitive", () => {
    expect(resolveProduct("heavy tee", products)).toEqual({ status: "MATCHED", product: heavyTee });
    expect(resolveProduct("  Heavy   Tee  ", products)).toEqual({ status: "MATCHED", product: heavyTee });
  });

  it("matches an exact SKU", () => {
    const withSku = [product({ id: "p4", name: "Something", sku: "HT-001" })];
    expect(resolveProduct("HT-001", withSku)).toMatchObject({ status: "MATCHED" });
  });

  it("returns NOT_FOUND for a query matching nothing", () => {
    expect(resolveProduct("Blue Jacket", products)).toEqual({ status: "NOT_FOUND", query: "Blue Jacket" });
  });

  it("returns NOT_FOUND for empty input rather than matching everything", () => {
    expect(resolveProduct("   ", products)).toMatchObject({ status: "NOT_FOUND" });
  });

  it("NEVER silently guesses between two similarly-scored candidates — returns AMBIGUOUS", () => {
    // "Tee" alone is a weak, non-exact fragment of all three products.
    const result = resolveProduct("Tee", products);
    expect(result.status).toBe("AMBIGUOUS");
    if (result.status === "AMBIGUOUS") {
      expect(result.candidates.length).toBeGreaterThan(1);
    }
  });

  it("picks the clearly-best match when one candidate is a full match and another only partial", () => {
    // "Heavy Tee" is an exact match for heavyTee (score 1.0) and only a
    // partial word-overlap for "Heavy Tee XL" — should resolve confidently.
    const result = resolveProduct("Heavy Tee", [heavyTeeXL, heavyTee]);
    expect(result).toEqual({ status: "MATCHED", product: heavyTee });
  });

  it("does not match on a single-word overlap alone if below the candidate threshold", () => {
    const result = resolveProduct("Waterproof Heavy Duty Something Tee Extra", products);
    // Only 1 of 6 query words overlaps ("Tee") — below the 1/3 candidate floor.
    expect(result.status).toBe("NOT_FOUND");
  });
});
