import type { Product } from "./types";
import { multiplyByQuantity, subtract, add, ZERO, type Centavos } from "../money/money";

export type StockStatus = "OUT_OF_STOCK" | "LOW_STOCK" | "IN_STOCK";

/**
 * A product is "low stock" once its quantity drops to or below its own
 * reorder threshold, and "out of stock" at exactly zero (or, defensively,
 * anything at/below zero — stock_qty should never legitimately go
 * negative, but this reads as OUT_OF_STOCK rather than crashing if it
 * ever does).
 */
export function stockStatus(product: Product): StockStatus {
  if (product.stockQty <= 0) return "OUT_OF_STOCK";
  if (product.stockQty <= product.reorderThreshold) return "LOW_STOCK";
  return "IN_STOCK";
}

/** Recorded cost of the stock currently on hand: stockQty × unitCogs. */
export function inventoryCostValue(product: Product): Centavos {
  return multiplyByQuantity(product.unitCogs, product.stockQty);
}

/**
 * What selling every unit currently in stock, at the current listed
 * price, would bring in — NOT a forecast or a guarantee, just current
 * quantity × current price. This is "potential", never realized revenue
 * or profit; the caller must never add it to actual sales figures.
 */
export function potentialSalesValue(product: Product): Centavos {
  return multiplyByQuantity(product.sellingPrice, product.stockQty);
}

/** potentialSalesValue − inventoryCostValue. Same "potential, not realized" caveat. */
export function potentialGrossProfit(product: Product): Centavos {
  return subtract(potentialSalesValue(product), inventoryCostValue(product));
}

export interface InventorySummary {
  totalCostValue: Centavos;
  totalPotentialSalesValue: Centavos;
  totalPotentialGrossProfit: Centavos;
  outOfStockCount: number;
  lowStockCount: number;
  inStockCount: number;
}

/** Aggregates the above across every given product — for the dashboard's "money tied up in inventory" card. */
export function summarizeInventory(products: Product[]): InventorySummary {
  const active = products.filter((p) => p.active);
  const summary: InventorySummary = {
    totalCostValue: ZERO,
    totalPotentialSalesValue: ZERO,
    totalPotentialGrossProfit: ZERO,
    outOfStockCount: 0,
    lowStockCount: 0,
    inStockCount: 0,
  };
  for (const p of active) {
    summary.totalCostValue = add(summary.totalCostValue, inventoryCostValue(p));
    summary.totalPotentialSalesValue = add(summary.totalPotentialSalesValue, potentialSalesValue(p));
    summary.totalPotentialGrossProfit = add(summary.totalPotentialGrossProfit, potentialGrossProfit(p));
    const status = stockStatus(p);
    if (status === "OUT_OF_STOCK") summary.outOfStockCount++;
    else if (status === "LOW_STOCK") summary.lowStockCount++;
    else summary.inStockCount++;
  }
  return summary;
}
