import { getCashAccounts, getLedgerEntries, getUnpaidReceivables, getCommittedObligations, getOrders, getExpenses, getProducts, getPrimaryBusinessIdForUser } from "./finance";
import { getCurrentUserId } from "@/lib/auth/provider";
import {
  demoAccounts,
  demoLedgerEntries,
  demoCommittedObligations,
  demoReceivables,
  demoOrders,
  demoExpenses,
} from "../demo/demoData";
import type { CashAccount, LedgerEntry, CommittedObligation, Receivable, Order, Expense, Product } from "../finance/types";

export interface DashboardData {
  accounts: CashAccount[];
  ledgerEntries: LedgerEntry[];
  committedObligations: CommittedObligation[];
  unpaidReceivables: Receivable[];
  orders: Order[];
  expenses: Expense[];
  products: Product[];
  isDemoData: boolean;
  /** True when the caller should redirect to /login rather than show demo data. */
  requiresAuth: boolean;
}

const DEMO_FALLBACK: DashboardData = {
  accounts: demoAccounts,
  ledgerEntries: demoLedgerEntries,
  committedObligations: demoCommittedObligations,
  unpaidReceivables: demoReceivables,
  orders: demoOrders,
  expenses: demoExpenses,
  products: [],
  isDemoData: true,
  requiresAuth: false,
};

/**
 * The single place that decides "real authenticated data" vs "demo data."
 * Every UI component reads through this — none of them should import
 * demoData.ts or the Postgres data layer directly.
 *
 * Identity now comes from the REAL session (getCurrentUserId()), not an
 * env-var placeholder — see src/lib/data/sessionContext.ts for the same
 * pattern used by quick-add/utang server actions. Without DATABASE_URL
 * (no database at all) or without a session (nobody logged in), this falls
 * back to demo data — but see `requiresAuth`: pages should use that to
 * redirect to /login rather than silently showing demo data to someone who
 * isn't authenticated, once auth is a required part of the flow (see the
 * dashboard/utang page components for how this is applied).
 */
export async function getDashboardData(): Promise<DashboardData> {
  if (!process.env.DATABASE_URL) {
    return DEMO_FALLBACK;
  }

  const userId = await getCurrentUserId();
  if (!userId) {
    return { ...DEMO_FALLBACK, requiresAuth: true };
  }

  const businessId = await getPrimaryBusinessIdForUser(userId);
  if (!businessId) {
    return { ...DEMO_FALLBACK, requiresAuth: true };
  }

  const [accounts, ledgerEntries, committedObligations, unpaidReceivables, orders, expenses, products] =
    await Promise.all([
      getCashAccounts(userId, businessId),
      getLedgerEntries(userId, businessId),
      getCommittedObligations(userId, businessId),
      getUnpaidReceivables(userId, businessId),
      getOrders(userId, businessId),
      getExpenses(userId, businessId),
      getProducts(userId, businessId),
    ]);

  return {
    accounts,
    ledgerEntries,
    committedObligations,
    unpaidReceivables,
    orders,
    expenses,
    products,
    isDemoData: false,
    requiresAuth: false,
  };
}
