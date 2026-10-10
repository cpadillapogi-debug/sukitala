import Link from "next/link";
import { redirect } from "next/navigation";
import { calculateSpendableCash } from "@/lib/finance/spendableCash";
import { calculateNetProfit } from "@/lib/finance/profit";
import { totalUnpaidReceivables } from "@/lib/finance/receivables";
import { summarizeInventory } from "@/lib/finance/inventory";
import { formatPHP } from "@/lib/money/money";
import { getDashboardData } from "@/lib/data/dashboardData";
import { demoPendingMarketplaceFunds } from "@/lib/demo/demoData";
import { buildAttentionInsights } from "@/lib/dashboard/attentionInsights";
import { SpendableCashCard } from "@/components/SpendableCashCard";
import { DemoBadge } from "@/components/DemoBadge";
import { LogoutButton } from "@/components/LogoutButton";

export default async function DashboardPage() {
  const data = await getDashboardData();
  if (data.requiresAuth) {
    redirect("/login?redirectTo=/dashboard");
  }
  const unpaidReceivablesTotal = totalUnpaidReceivables(data.unpaidReceivables);

  const spendable = calculateSpendableCash({
    accounts: data.accounts,
    ledgerEntries: data.ledgerEntries,
    committedObligations: data.committedObligations,
    // Marketplace payouts stay demo-sourced: no marketplace CSV import or
    // payout table is wired yet (Phase 9 in KIRACASH_IMPLEMENTATION_PLAN.md).
    // Sales/Profit below, by contrast, ARE now real — the product-resolution
    // fix (recordSale/productResolution.ts) means quick-add sales create
    // real order_items, so revenue is no longer stuck at ₱0.
    pendingMarketplaceFunds: demoPendingMarketplaceFunds,
    unpaidReceivablesTotal,
  });

  const profit = calculateNetProfit(data.orders, data.expenses);
  const inventory = summarizeInventory(data.products);
  const attentionInsights = buildAttentionInsights({
    unpaidReceivables: data.unpaidReceivables,
    products: data.products,
    orders: data.orders,
  });

  return (
    <main className="mx-auto max-w-lg space-y-6 p-4 pb-24">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">Kamusta, CJ 👋</p>
          <h1 className="text-lg font-semibold text-gray-900">Your business today</h1>
        </div>
        {data.isDemoData ? (
          <DemoBadge />
        ) : (
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Live cash &amp; sales data (marketplace payouts still demo)
            </span>
            <LogoutButton />
          </div>
        )}
      </div>

      <SpendableCashCard breakdown={spendable} />

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Today's Sales" value={formatPHP(profit.revenue)} />
        <StatCard label="Net Profit" value={formatPHP(profit.netProfit)} />
        <StatCard label="Pending Marketplace" value={formatPHP(spendable.pendingMarketplaceFunds)} tone="warn" />
        <StatCard label="Unpaid Utang" value={formatPHP(spendable.unpaidReceivables)} tone="warn" href="/utang" />
        <StatCard label="Money Tied Up in Inventory" value={formatPHP(inventory.totalCostValue)} href="/inventory" />
      </div>

      {attentionInsights.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-amber-900">WHAT NEEDS YOUR ATTENTION</h2>
          <ul className="mt-2 space-y-1 text-sm text-amber-800">
            {attentionInsights.map((insight, i) =>
              insight.href ? (
                <li key={i}>
                  •{" "}
                  <Link href={insight.href} className="underline">
                    {insight.text}
                  </Link>
                </li>
              ) : (
                <li key={i}>• {insight.text}</li>
              )
            )}
          </ul>
        </section>
      )}

      <section className="flex gap-3">
        <Link
          href="/quick-add"
          className="flex-1 rounded-xl bg-emerald-600 py-3 text-center font-medium text-white shadow"
        >
          + Log Sale / Expense
        </Link>
        <Link
          href="/inventory"
          className="flex-1 rounded-xl border border-gray-300 py-3 text-center font-medium text-gray-700"
        >
          Inventory
        </Link>
      </section>
    </main>
  );
}

function StatCard({ label, value, tone, href }: { label: string; value: string; tone?: "warn"; href?: string }) {
  const content = (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${tone === "warn" ? "text-amber-700" : "text-gray-900"}`}>
        {value}
      </p>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}
