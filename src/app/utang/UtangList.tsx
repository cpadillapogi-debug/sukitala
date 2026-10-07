"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatPHP, subtract } from "@/lib/money/money";
import { recordUtangPayment, type RecordPaymentResult } from "./actions";
import type { ReceivableWithCustomer } from "@/lib/data/finance";

export function UtangList({ initialReceivables }: { initialReceivables: ReceivableWithCustomer[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [paymentResults, setPaymentResults] = useState<Record<string, RecordPaymentResult>>({});

  function handlePay(receivableId: string) {
    const raw = amounts[receivableId];
    const amount = parseFloat(raw ?? "");
    if (Number.isNaN(amount) || amount <= 0) return;
    startTransition(async () => {
      const result = await recordUtangPayment(receivableId, amount);
      setPaymentResults((prev) => ({ ...prev, [receivableId]: result }));
      if (result.ok) {
        setAmounts((prev) => ({ ...prev, [receivableId]: "" }));
        router.refresh(); // re-fetches the server component's real data — new balances, Spendable Cash context
      }
    });
  }

  return (
    <div className="space-y-3">
      {initialReceivables.map((r) => {
        const remaining = subtract(r.totalOwed, r.amountPaid);
        const result = paymentResults[r.id];
        return (
          <div key={r.id} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="font-medium text-gray-900">{r.customerName}</p>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  r.status === "OVERDUE"
                    ? "bg-red-100 text-red-700"
                    : r.status === "PARTIAL"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-gray-100 text-gray-700"
                }`}
              >
                {r.status}
              </span>
            </div>
            <div className="mt-2 space-y-1 text-sm text-gray-600">
              <div className="flex justify-between">
                <span>Total owed</span>
                <span>{formatPHP(r.totalOwed)}</span>
              </div>
              <div className="flex justify-between">
                <span>Paid so far</span>
                <span>{formatPHP(r.amountPaid)}</span>
              </div>
              <div className="flex justify-between font-medium text-gray-900">
                <span>Remaining</span>
                <span>{formatPHP(remaining)}</span>
              </div>
              {r.dueDate && (
                <div className="flex justify-between text-xs text-gray-400">
                  <span>Due</span>
                  <span>{new Date(r.dueDate).toLocaleDateString("en-PH")}</span>
                </div>
              )}
            </div>

            <div className="mt-3 flex gap-2">
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="Amount paid (₱)"
                value={amounts[r.id] ?? ""}
                onChange={(e) => setAmounts((prev) => ({ ...prev, [r.id]: e.target.value }))}
                className="flex-1 rounded-lg border border-gray-300 p-2 text-sm"
              />
              <button
                onClick={() => handlePay(r.id)}
                disabled={isPending || !amounts[r.id]}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Record payment
              </button>
            </div>
            {result && (
              <p className={`mt-2 text-xs ${result.ok ? "text-emerald-700" : "text-red-600"}`}>
                {result.ok ? "✓ " : "⚠ "}
                {result.message}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
