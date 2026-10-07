import type { Centavos } from "../money/money";

/**
 * Domain types for the deterministic financial engine.
 * These mirror the eventual database schema (see /db/migrations).
 * NOTHING in this module is computed by an LLM. AI only ever produces
 * DraftTransaction candidates (see /src/lib/ai/schema.ts), which a human
 * confirms before they become real rows here.
 */

export type AccountType = "GCASH" | "MAYA" | "BANK" | "CASH" | "MARKETPLACE_ESCROW" | "OTHER";

export interface CashAccount {
  id: string;
  businessId: string;
  type: AccountType;
  name: string;
  /** Only used as a starting point; current balance is derived from ledger entries. */
  openingBalance: Centavos;
}

export type LedgerEntryType =
  | "SALE_CASH_IN"
  | "SALE_ON_CREDIT" // utang created, no cash movement
  | "RECEIVABLE_PAYMENT"
  | "EXPENSE"
  | "INVENTORY_PURCHASE"
  | "MARKETPLACE_PAYOUT_RECEIVED"
  | "TRANSFER"
  | "ADJUSTMENT"
  | "REVERSAL";

/**
 * Every financial mutation is an immutable ledger entry. Corrections are made
 * by inserting a REVERSAL entry that references the original, never by
 * editing or deleting a prior entry.
 */
export interface LedgerEntry {
  id: string;
  businessId: string;
  type: LedgerEntryType;
  accountId: string | null; // null for entries with no direct cash effect (e.g. SALE_ON_CREDIT)
  amount: Centavos; // positive = cash in, negative = cash out; 0 for non-cash entries
  effectiveAt: string; // ISO timestamp
  createdAt: string; // ISO timestamp
  createdBy: string; // user id
  sourceDocumentId: string | null;
  reversalOfId: string | null;
  note: string;
}

export interface Product {
  id: string;
  businessId: string;
  name: string;
  sku: string | null;
  unitCogs: Centavos;
  sellingPrice: Centavos;
  stockQty: number;
  reorderThreshold: number;
  active: boolean;
}

export interface OrderItem {
  productId: string;
  quantity: number;
  unitPrice: Centavos;
  unitCogs: Centavos;
}

export interface Customer {
  id: string;
  businessId: string;
  name: string;
  contactInfo: string | null;
}

export type PaymentStatus = "PAID" | "UNPAID" | "PARTIAL";

export interface Order {
  id: string;
  businessId: string;
  customerId: string | null;
  channel: string;
  items: OrderItem[];
  paymentStatus: PaymentStatus;
  paymentMethod: AccountType | null;
  createdAt: string;
  /** True if this order's cash is sitting in marketplace escrow, not yet settled. */
  pendingMarketplaceSettlement: boolean;
}

export type ReceivableStatus = "UNPAID" | "PARTIAL" | "OVERDUE" | "SETTLED";

export interface Receivable {
  id: string;
  businessId: string;
  customerId: string;
  orderId: string | null;
  totalOwed: Centavos;
  amountPaid: Centavos;
  dueDate: string | null;
  status: ReceivableStatus;
}

export interface Expense {
  id: string;
  businessId: string;
  category: string;
  amount: Centavos;
  accountId: string;
  createdAt: string;
}

export interface MarketplacePendingFunds {
  businessId: string;
  channel: string;
  expectedAmount: Centavos;
}

/** Explicitly tracked near-term obligations the seller wants reserved out of spendable cash. */
export interface CommittedObligation {
  id: string;
  businessId: string;
  description: string;
  amount: Centavos;
  dueDate: string | null;
}
