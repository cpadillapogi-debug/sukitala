import { add, multiplyByQuantity, subtract, ZERO, type Centavos } from "../money/money";
import type { Order, Expense } from "./types";

/**
 * Revenue = sum of order item (unitPrice * quantity) across the given orders.
 * Callers decide which orders to include (e.g. "this month", "PAID only") —
 * this function makes no assumption about reporting period or recognition rule.
 */
export function calculateRevenue(orders: Order[]): Centavos {
  return add(
    ...orders.flatMap((o) => o.items.map((i) => multiplyByQuantity(i.unitPrice, i.quantity)))
  );
}

/** COGS = sum(unit_cogs * quantity_sold) across the given orders. */
export function calculateCOGS(orders: Order[]): Centavos {
  return add(
    ...orders.flatMap((o) => o.items.map((i) => multiplyByQuantity(i.unitCogs, i.quantity)))
  );
}

export function calculateGrossProfit(orders: Order[]): Centavos {
  return subtract(calculateRevenue(orders), calculateCOGS(orders));
}

export function calculateOperatingExpenses(expenses: Expense[]): Centavos {
  return add(...expenses.map((e) => e.amount), ZERO);
}

export interface NetProfitBreakdown {
  revenue: Centavos;
  cogs: Centavos;
  grossProfit: Centavos;
  operatingExpenses: Centavos;
  netProfit: Centavos;
}

/**
 * Net Profit = Gross Profit - Operating Expenses.
 * IMPORTANT: net profit is an accounting concept, not cash. A PAID order and an
 * UNPAID (utang) order both contribute to revenue/profit here — callers who want
 * a cash-only view should filter orders by paymentStatus === "PAID" first, or
 * use calculateSpendableCash() for the cash-specific question.
 */
export function calculateNetProfit(orders: Order[], expenses: Expense[]): NetProfitBreakdown {
  const revenue = calculateRevenue(orders);
  const cogs = calculateCOGS(orders);
  const grossProfit = subtract(revenue, cogs);
  const operatingExpenses = calculateOperatingExpenses(expenses);
  const netProfit = subtract(grossProfit, operatingExpenses);
  return { revenue, cogs, grossProfit, operatingExpenses, netProfit };
}
