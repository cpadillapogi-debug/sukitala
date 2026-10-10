import { describe, it, expect } from "vitest";
import {
  pesosToCentavos,
  pesosToPositiveCentavos,
  pesosToNonNegativeCentavos,
  assertPositiveCentavos,
  centavosToPesos,
  formatPHP,
  add,
  subtract,
  multiplyByQuantity,
  MoneyError,
  ZERO,
} from "./money";

describe("money", () => {
  it("converts peso strings to exact centavos", () => {
    expect(pesosToCentavos("1234.56")).toBe(123456);
    expect(pesosToCentavos("0.1")).toBe(10);
    expect(pesosToCentavos("800")).toBe(80000);
    expect(pesosToCentavos(0)).toBe(0);
  });

  it("rejects invalid peso strings", () => {
    expect(() => pesosToCentavos("abc")).toThrow(MoneyError);
    expect(() => pesosToCentavos("1.999")).toThrow(MoneyError);
  });

  it("round-trips centavos to pesos", () => {
    expect(centavosToPesos(pesosToCentavos("1234.56"))).toBeCloseTo(1234.56);
  });

  it("formats as PHP currency", () => {
    expect(formatPHP(pesosToCentavos("8450"))).toContain("8,450.00");
  });

  it("adds without floating point drift (classic 0.1 + 0.2 case)", () => {
    // In raw JS floats, 0.1 + 0.2 !== 0.3. Centavos avoids this entirely.
    const a = pesosToCentavos("0.10");
    const b = pesosToCentavos("0.20");
    expect(add(a, b)).toBe(pesosToCentavos("0.30"));
  });

  it("subtracts correctly", () => {
    expect(subtract(pesosToCentavos("100"), pesosToCentavos("30"))).toBe(pesosToCentavos("70"));
  });

  it("multiplies unit price by integer quantity", () => {
    expect(multiplyByQuantity(pesosToCentavos("400"), 2)).toBe(pesosToCentavos("800"));
  });

  it("rejects non-integer quantity", () => {
    expect(() => multiplyByQuantity(pesosToCentavos("400"), 1.5)).toThrow(MoneyError);
  });

  it("ZERO is additive identity", () => {
    expect(add(pesosToCentavos("50"), ZERO)).toBe(pesosToCentavos("50"));
  });

  describe("pesosToPositiveCentavos", () => {
    it("accepts a positive amount", () => {
      expect(pesosToPositiveCentavos("199.99", "Selling price")).toBe(19999);
    });

    it("rejects zero", () => {
      expect(() => pesosToPositiveCentavos("0", "Selling price")).toThrow(MoneyError);
    });

    it("rejects negative amounts", () => {
      expect(() => pesosToPositiveCentavos("-50", "Selling price")).toThrow(MoneyError);
    });

    it("includes the given label in the error message", () => {
      expect(() => pesosToPositiveCentavos("-50", "Selling price")).toThrow(/Selling price/);
    });
  });

  describe("pesosToNonNegativeCentavos", () => {
    it("accepts a positive amount", () => {
      expect(pesosToNonNegativeCentavos("50", "COGS")).toBe(5000);
    });

    it("accepts zero", () => {
      expect(pesosToNonNegativeCentavos("0", "COGS")).toBe(0);
    });

    it("rejects negative amounts", () => {
      expect(() => pesosToNonNegativeCentavos("-1", "COGS")).toThrow(MoneyError);
    });
  });

  describe("assertPositiveCentavos", () => {
    it("does not throw for a positive amount", () => {
      expect(() => assertPositiveCentavos(pesosToCentavos("180"), "Expense amount")).not.toThrow();
    });

    it("throws for zero", () => {
      expect(() => assertPositiveCentavos(ZERO, "Expense amount")).toThrow(MoneyError);
    });

    it("throws for a negative amount", () => {
      expect(() => assertPositiveCentavos(pesosToCentavos("-50"), "Expense amount")).toThrow(MoneyError);
    });
  });
});
