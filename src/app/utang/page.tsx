import Link from "next/link";
import { redirect } from "next/navigation";
import { formatPHP, add, subtract, ZERO } from "@/lib/money/money";
import { getUtangList } from "./actions";
import { UtangList } from "./UtangList";

export default async function UtangPage() {
  const { receivables, isDemoData, requiresAuth, message } = await getUtangList();
  if (requiresAuth) {
    redirect("/login?redirectTo=/utang");
  }
  const totalOutstanding = add(
    ...receivables.map((r) => subtract(r.totalOwed, r.amountPaid)),
    ZERO
  );

  return (
    <main className="mx-auto max-w-lg space-y-4 p-4 pb-24">
      <Link href="/dashboard" className="text-sm text-gray-500">
        ← Back
      </Link>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">Utang</h1>
        {isDemoData ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
            Demo data
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">
            Live
          </span>
        )}
      </div>

      {message && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">{message}</p>}

      {receivables.length === 0 ? (
        <p className="text-sm text-gray-500">No outstanding utang. 🎉</p>
      ) : (
        <>
          <div className="rounded-xl bg-amber-50 p-4">
            <p className="text-sm text-amber-800">Total outstanding</p>
            <p className="text-2xl font-bold text-amber-900">{formatPHP(totalOutstanding)}</p>
            <p className="mt-1 text-xs text-amber-700">
              Not included in Spendable Cash until customers actually pay.
            </p>
          </div>
          <UtangList initialReceivables={receivables} />
        </>
      )}
    </main>
  );
}
