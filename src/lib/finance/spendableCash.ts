import { add, clampToZero, subtract, ZERO, type Centavos } from "../money/money";
import type { CashAccount, CommittedObligation, LedgerEntry } from "./types";

/**
 * SPENDABLE CASH — the single most important number in SukiTala.
 *
 * Definition (documented, not hidden):
 *
 *   Spendable Cash
 *   =  Available Cash Balance          (derived from ledger entries per account,
 *                                        summed across non-escrow accounts)
 *   -  Committed Obligations            (explicitly tracked near-term commitments
 *                                        the seller told us about, e.g. next restock)
 *   -  Safety Buffer                    (optional, configurable, defaults to 0)
 *
 * Deliberately EXCLUDED, because they are not cash the seller can spend today:
 *   - Marketplace escrow / pending payouts (not yet settled to a real account)
 *   - Unpaid customer utang (receivables — money owed TO the business, not held)
 *   - Inventory value (capital tied up in stock, not liquid)
 *   - Net profit (an accounting figure, not a cash balance)
 *
 * Every account balance here is DERIVED from ledger entries (opening balance +
 * sum of ledger entries for that account), never a cached/mutable field, so it
 * can always be recomputed and audited from source records.
 */

export function calculateAccountBalance(
  account: CashAccount,
  entries: LedgerEntry[]
): Centavos {
  const accountEntries = entries.filter((e) => e.accountId === account.id);
  return add(account.openingBalance, ...accountEntries.map((e) => e.amount), ZERO);
}

export interface SpendableCashBreakdown {
  availableCash: Centavos;
  committedObligations: Centavos;
  safetyBuffer: Centavos;
  spendableCash: Centavos;
  /** Per-account balances, for the "why is my number X" drill-down UI. */
  accountBalances: { accountId: string; accountName: string; balance: Centavos }[];
  /** Informational only — NOT included in spendableCash, shown separately in the UI. */
  pendingMarketplaceFunds: Centavos;
  unpaidReceivables: Centavos;
}

export function calculateSpendableCash(params: {
  accounts: CashAccount[]; // exclude MARKETPLACE_ESCROW accounts from spendable calc
  ledgerEntries: LedgerEntry[];
  committedObligations: CommittedObligation[];
  safetyBuffer?: Centavos;
  pendingMarketplaceFunds?: Centavos;
  unpaidReceivablesTotal?: Centavos;
}): SpendableCashBreakdown {
  const spendableAccounts = params.accounts.filter((a) => a.type !== "MARKETPLACE_ESCROW");

  const accountBalances = spendableAccounts.map((a) => ({
    accountId: a.id,
    accountName: a.name,
    balance: calculateAccountBalance(a, params.ledgerEntries),
  }));

  const availableCash = add(...accountBalances.map((b) => b.balance), ZERO);
  const committedObligations = add(
    ...params.committedObligations.map((o) => o.amount),
    ZERO
  );
  const safetyBuffer = params.safetyBuffer ?? ZERO;

  const spendableCash = clampToZero(
    subtract(subtract(availableCash, committedObligations), safetyBuffer)
  );

  return {
    availableCash,
    committedObligations,
    safetyBuffer,
    spendableCash,
    accountBalances,
    pendingMarketplaceFunds: params.pendingMarketplaceFunds ?? ZERO,
    unpaidReceivables: params.unpaidReceivablesTotal ?? ZERO,
  };
}
