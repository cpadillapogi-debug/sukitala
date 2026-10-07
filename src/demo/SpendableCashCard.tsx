"use client";

import { useState } from "react";
import { formatPHP, type Centavos } from "@/lib/money/money";
import type { SpendableCashBreakdown } from "@/lib/finance/spendableCash";

export function SpendableCashCard({ breakdown }: { breakdown: SpendableCashBreakdown }) {
  const [showDetail, setShowDetail] = useState(false);

  return (
    <div className="rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-700 p-6 text-white shadow-lg">
      <p className="text-sm font-medium text-emerald-100">SAFE TO SPEND TODAY</p>
      <p className="mt-1 text-4xl font-bold tracking-tight">{formatPHP(breakdown.spendableCash)}</p>

      <button
        onClick={() => setShowDetail((v) => !v)}
        className="mt-4 text-sm font-medium text-emerald-100 underline underline-offset-2"
      >
        {showDetail ? "Hide calculation" : "Why is my Safe to Spend this amount?"}
      </button>

      {showDetail && (
        <div className="mt-4 space-y-2 rounded-xl bg-black/10 p-4 text-sm">
          <Row label="Available Cash" amount={breakdown.availableCash} />
          {breakdown.accountBalances.map((b) => (
            <Row key={b.accountId} label={`  ${b.accountName}`} amount={b.balance} muted />
          ))}
          <Row label="Committed Expenses" amount={breakdown.committedObligations} sign="-" />
          {breakdown.safetyBuffer !== 0 && <Row label="Safety Buffer" amount={breakdown.safetyBuffer} sign="-" />}
          <div className="my-2 border-t border-white/20" />
          <Row label="Safe to Spend" amount={breakdown.spendableCash} bold />

          <div className="mt-3 space-y-1 border-t border-white/20 pt-3 text-emerald-100">
            <p className="text-xs">Not included above (not spendable yet):</p>
            <Row label="Pending Marketplace Funds" amount={breakdown.pendingMarketplaceFunds} muted />
            <Row label="Unpaid Customer Utang" amount={breakdown.unpaidReceivables} muted />
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  amount,
  muted,
  bold,
  sign = "",
}: {
  label: string;
  amount: Centavos;
  muted?: boolean;
  bold?: boolean;
  sign?: "" | "-";
}) {
  return (
    <div className={`flex justify-between ${muted ? "text-emerald-100/80" : ""} ${bold ? "font-semibold" : ""}`}>
      <span>{label}</span>
      <span>
        {sign}
        {formatPHP(amount)}
      </span>
    </div>
  );
}
