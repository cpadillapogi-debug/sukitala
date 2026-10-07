import type { Product } from "./types";

/**
 * Resolves a free-text product query (e.g. "Heavy Tee", "heavy tee xl")
 * against a business's known products. This is the piece that was missing
 * before — recordQuickSale previously created orders with zero items
 * because nothing did this matching. See
 * KIRACASH_IMPLEMENTATION_PLAN.md / KNOWN_LIMITATIONS.md for that history.
 *
 * DELIBERATE DESIGN: this NEVER silently picks a product on ambiguity or
 * low confidence. It returns a result the caller must branch on — exactly
 * one confident match, several candidates needing human choice, or none
 * needing "create a new product?". The product rule is "never guess"; this
 * function is where that rule is actually enforced for product matching,
 * the same way duplicateDetection.ts enforces it for payment proofs.
 */

export type ProductResolution =
  | { status: "MATCHED"; product: Product }
  | { status: "AMBIGUOUS"; candidates: Product[] }
  | { status: "NOT_FOUND"; query: string };

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Simple word-overlap score: fraction of query words present in the candidate name. */
function matchScore(query: string, candidateName: string): number {
  const queryWords = normalize(query).split(" ").filter(Boolean);
  const candidateWords = new Set(normalize(candidateName).split(" ").filter(Boolean));
  if (queryWords.length === 0) return 0;
  const matched = queryWords.filter((w) => candidateWords.has(w)).length;
  return matched / queryWords.length;
}

export function resolveProduct(query: string, products: Product[]): ProductResolution {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return { status: "NOT_FOUND", query };

  // Exact name match (case/whitespace-insensitive) is unambiguous by definition.
  const exact = products.find((p) => normalize(p.name) === normalizedQuery);
  if (exact) return { status: "MATCHED", product: exact };

  // Exact SKU match is also unambiguous.
  const skuMatch = products.find((p) => p.sku && normalize(p.sku) === normalizedQuery);
  if (skuMatch) return { status: "MATCHED", product: skuMatch };

  // Fuzzy word-overlap match, only above a confidence floor.
  const CONFIDENT_THRESHOLD = 0.999; // effectively "all query words present"
  const CANDIDATE_THRESHOLD = 0.34; // at least ~1/3 of words overlap to even suggest it

  const scored = products
    .map((p) => ({ product: p, score: matchScore(query, p.name) }))
    .filter((s) => s.score >= CANDIDATE_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { status: "NOT_FOUND", query };

  const [best, second] = scored;
  const bestIsConfident = best.score >= CONFIDENT_THRESHOLD;
  const clearlyBest = !second || best.score - second.score >= 0.34;

  if (bestIsConfident && clearlyBest) {
    return { status: "MATCHED", product: best.product };
  }

  return { status: "AMBIGUOUS", candidates: scored.slice(0, 5).map((s) => s.product) };
}
