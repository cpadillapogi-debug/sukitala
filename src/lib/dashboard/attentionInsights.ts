import type { Receivable, Order, Product } from "../finance/types";
import { formatPHP, add, subtract, ZERO } from "../money/money";

export interface AttentionInsight {
  text: string;
  tone: "warn" | "info";
  href?: string;
}

export interface AttentionInsightsInput {
  unpaidReceivables: Receivable[];
  products: Product[];
  orders: Order[];
  now?: Date;
}

/**
 * Builds the dashboard's "What needs your attention?" list from REAL data
 * only. The dashboard at this checkpoint (restored from
 * kiracash-checkpoint-56b6f53.zip) had two hardcoded example bullets baked
 * directly into the page component — "₱1,200 utang from Maria is overdue"
 * and "₱8,500 pending from Shopee" — shown to every user regardless of
 * their actual data, since neither string came from any query. Both
 * product specs this app was built against are explicit and repeated on
 * this exact point: "Only generate statements supported by actual data" /
 * "Never fabricate insights." This function is the fix — every string it
 * returns is derived from a real query result passed in, never invented.
 *
 * Deliberately not AI-generated: these are plain template sentences over
 * real numbers, not free-form text, so there's nothing here to hallucinate.
 * If this dashboard ever wants richer natural-language phrasing later, an
 * AI layer could rewrite these strings for tone — but it must never be the
 * one computing the numbers inside them (see AI_GUARDRAILS.md).
 */
export function buildAttentionInsights(input: AttentionInsightsInput): AttentionInsight[] {
  const insights: AttentionInsight[] = [];
  const now = input.now ?? new Date();

  const unpaidTotal =
    input.unpaidReceivables.length > 0
      ? add(...input.unpaidReceivables.map((r) => subtract(r.totalOwed, r.amountPaid)))
      : ZERO;
  if (input.unpaidReceivables.length > 0) {
    const who = input.unpaidReceivables.length === 1 ? "1 customer" : `${input.unpaidReceivables.length} customers`;
    insights.push({
      text: `${formatPHP(unpaidTotal)} in customer payments is still outstanding, from ${who}.`,
      tone: "warn",
      href: "/utang",
    });
  }

  const outOfStock = input.products.filter((p) => p.stockQty <= 0);
  const lowStock = input.products.filter((p) => p.stockQty > 0 && p.stockQty <= p.reorderThreshold);
  if (outOfStock.length > 0) {
    insights.push({
      text:
        outOfStock.length === 1
          ? `"${outOfStock[0].name}" is out of stock.`
          : `${outOfStock.length} products are out of stock.`,
      tone: "warn",
      href: "/inventory",
    });
  }
  if (lowStock.length > 0) {
    insights.push({
      text:
        lowStock.length === 1
          ? `"${lowStock[0].name}" is running low (${lowStock[0].stockQty} left).`
          : `${lowStock.length} products are running low.`,
      tone: "warn",
      href: "/inventory",
    });
  }

  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const ordersThisWeek = input.orders.filter((o) => new Date(o.createdAt) >= sevenDaysAgo);
  if (ordersThisWeek.length > 0) {
    insights.push({
      text: `You recorded ${ordersThisWeek.length} sale${ordersThisWeek.length === 1 ? "" : "s"} this week.`,
      tone: "info",
    });
  }

  return insights;
}
