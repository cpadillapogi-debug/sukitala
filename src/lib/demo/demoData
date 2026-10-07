import { pesosToCentavos } from "../money/money";
import type { CashAccount, LedgerEntry, CommittedObligation, Order, Expense, Receivable } from "../finance/types";

/**
 * DEMO DATA — not real business data. Used to render the dashboard before a
 * Supabase project is connected. Every screen using this must show a visible
 * "Demo data" badge; see DemoBadge component. Swap for real Supabase queries
 * in src/lib/data/*.ts once DATABASE_URL / Supabase credentials exist.
 */

export const demoBusinessId = "demo-business";

export const demoAccounts: CashAccount[] = [
  { id: "acc-gcash", businessId: demoBusinessId, type: "GCASH", name: "GCash", openingBalance: pesosToCentavos("4200") },
  { id: "acc-cash", businessId: demoBusinessId, type: "CASH", name: "Cash on hand", openingBalance: pesosToCentavos("1800") },
  { id: "acc-escrow", businessId: demoBusinessId, type: "MARKETPLACE_ESCROW", name: "Shopee Pending", openingBalance: pesosToCentavos("8500") },
];

export const demoLedgerEntries: LedgerEntry[] = [
  { id: "l1", businessId: demoBusinessId, type: "SALE_CASH_IN", accountId: "acc-gcash", amount: pesosToCentavos("800"), effectiveAt: "2026-08-20T09:00:00Z", createdAt: "2026-08-20T09:00:00Z", createdBy: "demo", sourceDocumentId: null, reversalOfId: null, note: "2 Heavy Tee to Juan" },
  { id: "l2", businessId: demoBusinessId, type: "EXPENSE", accountId: "acc-gcash", amount: pesosToCentavos("-180"), effectiveAt: "2026-08-20T10:00:00Z", createdAt: "2026-08-20T10:00:00Z", createdBy: "demo", sourceDocumentId: null, reversalOfId: null, note: "Lalamove delivery" },
  { id: "l3", businessId: demoBusinessId, type: "SALE_CASH_IN", accountId: "acc-cash", amount: pesosToCentavos("650"), effectiveAt: "2026-08-20T11:30:00Z", createdAt: "2026-08-20T11:30:00Z", createdBy: "demo", sourceDocumentId: null, reversalOfId: null, note: "Walk-in sale" },
];

export const demoCommittedObligations: CommittedObligation[] = [
  { id: "c1", businessId: demoBusinessId, description: "Next restock — shirts supplier", amount: pesosToCentavos("2470"), dueDate: "2026-08-25" },
];

export const demoOrders: Order[] = [
  {
    id: "o1", businessId: demoBusinessId, customerId: "cust-juan", channel: "MESSENGER",
    items: [{ productId: "p1", quantity: 2, unitPrice: pesosToCentavos("400"), unitCogs: pesosToCentavos("200") }],
    paymentStatus: "PAID", paymentMethod: "GCASH", createdAt: "2026-08-20T09:00:00Z", pendingMarketplaceSettlement: false,
  },
  {
    id: "o2", businessId: demoBusinessId, customerId: null, channel: "WALK_IN",
    items: [{ productId: "p2", quantity: 1, unitPrice: pesosToCentavos("650"), unitCogs: pesosToCentavos("300") }],
    paymentStatus: "PAID", paymentMethod: "CASH", createdAt: "2026-08-20T11:30:00Z", pendingMarketplaceSettlement: false,
  },
];

export const demoExpenses: Expense[] = [
  { id: "e1", businessId: demoBusinessId, category: "LOGISTICS", amount: pesosToCentavos("180"), accountId: "acc-gcash", createdAt: "2026-08-20T10:00:00Z" },
];

export const demoReceivables: Receivable[] = [
  { id: "r1", businessId: demoBusinessId, customerId: "cust-maria", orderId: null, totalOwed: pesosToCentavos("1200"), amountPaid: pesosToCentavos("0"), dueDate: "2026-08-15", status: "OVERDUE" },
];

export const demoReceivablesWithCustomer = demoReceivables.map((r) => ({
  ...r,
  customerName: "Maria Santos",
}));

export const demoPendingMarketplaceFunds = pesosToCentavos("8500");
