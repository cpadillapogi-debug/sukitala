"use server";

import { getAiProvider, isMockProvider } from "@/lib/ai/provider";
import { draftTransactionSchema, type DraftTransaction } from "@/lib/ai/schema";
import { z } from "zod";
import {
  recordSale,
  recordQuickExpense,
  resolveProductForBusiness,
  createProduct,
  InsufficientStockError,
} from "@/lib/data/finance";
import { pesosToCentavos, centavosToPesos, pesosToPositiveCentavos, pesosToNonNegativeCentavos, MoneyError } from "@/lib/money/money";
import { resolveSessionContext } from "@/lib/data/sessionContext";
import type { ProductResolution } from "@/lib/finance/productResolution";

export interface ParseResult {
  draft: DraftTransaction | null;
  usedMockProvider: boolean;
  error: string | null;
}

export async function parseQuickAddInput(text: string): Promise<ParseResult> {
  if (!text.trim()) {
    return { draft: null, usedMockProvider: false, error: "Please enter something first." };
  }
  const provider = getAiProvider();
  try {
    const draft = await provider.extractTransactionFromText(text);
    return { draft, usedMockProvider: isMockProvider(provider), error: null };
  } catch {
    return {
      draft: null,
      usedMockProvider: isMockProvider(provider),
      error: "Couldn't understand that — please try rephrasing or enter it manually.",
    };
  }
}

export interface ResolvedSaleLine {
  productQuery: string;
  quantity: number;
  fallbackUnitPrice: number | null; // from AI extraction, used only if creating a new product
  resolution: ProductResolution;
}

export interface ResolveSaleResult {
  ok: boolean;
  message: string;
  lines: ResolvedSaleLine[];
}

/**
 * Step 2 of the sale flow: for a CREATE_SALE draft, resolves every line
 * item's free-text productQuery against this business's real products.
 * NEVER guesses — see productResolution.ts. The UI must render each line's
 * `resolution` and let the user pick/create before anything is confirmed.
 */
export async function resolveQuickSaleItems(draft: DraftTransaction): Promise<ResolveSaleResult> {
  const parsed = draftTransactionSchema.safeParse(draft);
  if (!parsed.success || parsed.data.intent !== "CREATE_SALE") {
    return { ok: false, message: "Not a valid sale.", lines: [] };
  }
  const validatedDraft = parsed.data;
  const ctx = await resolveSessionContext();
  if (!ctx.ok) return { ok: false, message: ctx.message, lines: [] };

  const lines: ResolvedSaleLine[] = [];
  for (const item of validatedDraft.items) {
    const resolution = await resolveProductForBusiness(ctx.userId, ctx.businessId, item.productQuery);
    lines.push({
      productQuery: item.productQuery,
      quantity: item.quantity,
      fallbackUnitPrice: item.unitPrice,
      resolution,
    });
  }
  return { ok: true, message: "", lines };
}

export interface ConfirmResult {
  persisted: boolean;
  message: string;
}

/**
 * Creates a brand-new product (used from the "not found — create it?" step)
 * with a minimal, honest COGS default: if the user doesn't provide COGS,
 * defaults to the same value as selling price (i.e. assumes ₱0 profit)
 * rather than guessing a margin — this makes the gap visible (₱0 profit on
 * the confirm screen) instead of inventing a number that looks plausible.
 */
export async function createProductFromQuickAdd(params: {
  name: string;
  sellingPricePesos: number;
  cogsPesos: number | null;
}): Promise<{ ok: boolean; message: string }> {
  const ctx = await resolveSessionContext();
  if (!ctx.ok) return { ok: false, message: ctx.message };

  let sellingPrice, cogs;
  try {
    sellingPrice = pesosToPositiveCentavos(params.sellingPricePesos, "Selling price");
    cogs = params.cogsPesos != null ? pesosToNonNegativeCentavos(params.cogsPesos, "COGS") : sellingPrice;
  } catch (err) {
    if (err instanceof MoneyError) return { ok: false, message: err.message };
    throw err;
  }

  await createProduct(ctx.userId, {
    businessId: ctx.businessId,
    name: params.name,
    sku: null,
    unitCogsCentavos: cogs,
    sellingPriceCentavos: sellingPrice,
    initialStock: 0,
    reorderThreshold: 0,
  });
  return { ok: true, message: `Created "${params.name}". Re-resolving...` };
}

/**
 * Final step: called only once every line item is MATCHED (resolved to a
 * real product id) and the user has tapped Confirm. Re-resolves nothing
 * here — the caller must pass already-matched productIds, which came from
 * resolveQuickSaleItems()'s output, not from re-parsing free text.
 */
const confirmSaleItemsSchema = z
  .array(z.object({ productId: z.string().uuid(), quantity: z.number().int().positive() }))
  .min(1);

export async function confirmSale(
  items: { productId: string; quantity: number }[],
  channel: string,
  paymentStatus: "PAID" | "UNPAID",
  customerName?: string
): Promise<ConfirmResult> {
  const parsedItems = confirmSaleItemsSchema.safeParse(items);
  if (!parsedItems.success) {
    return { persisted: false, message: "Invalid line items — please re-resolve the sale." };
  }
  if (paymentStatus === "UNPAID" && !customerName?.trim()) {
    return { persisted: false, message: "A customer name is required to record this as utang." };
  }
  const ctx = await resolveSessionContext();
  if (!ctx.ok) return { persisted: false, message: ctx.message };

  try {
    const result = await recordSale(ctx.userId, {
      businessId: ctx.businessId,
      accountId: ctx.accountId,
      items: parsedItems.data,
      channel,
      paymentStatus,
      customerName,
    });
    const profit = centavosToPesos(result.totalRevenue) - centavosToPesos(result.totalCogs);
    if (paymentStatus === "UNPAID") {
      return {
        persisted: true,
        message:
          `Saved as utang for ${customerName}. Revenue ₱${centavosToPesos(result.totalRevenue).toFixed(2)}, ` +
          `COGS ₱${centavosToPesos(result.totalCogs).toFixed(2)}, profit ₱${profit.toFixed(2)}. ` +
          `Stock decremented. Cash and Spendable Cash are unchanged until ${customerName} pays — see /utang.`,
      };
    }
    return {
      persisted: true,
      message: `Saved. Revenue ₱${centavosToPesos(result.totalRevenue).toFixed(2)}, ` +
        `COGS ₱${centavosToPesos(result.totalCogs).toFixed(2)}, profit ₱${profit.toFixed(2)}. ` +
        `Stock decremented.`,
    };
  } catch (err) {
    if (err instanceof InsufficientStockError) {
      return { persisted: false, message: err.message };
    }
    throw err;
  }
}

export async function confirmExpense(draft: DraftTransaction): Promise<ConfirmResult> {
  // Re-validate rather than trusting client state just because it was shown
  // once already — same defense-in-depth principle as the old single-step
  // confirmDraftTransaction() this replaced.
  const parsed = draftTransactionSchema.safeParse(draft);
  if (!parsed.success || parsed.data.intent !== "CREATE_EXPENSE") {
    return { persisted: false, message: "This no longer matches a valid expense — please re-parse." };
  }
  const validatedDraft = parsed.data;
  const ctx = await resolveSessionContext();
  if (!ctx.ok) return { persisted: false, message: ctx.message };

  await recordQuickExpense(ctx.userId, {
    businessId: ctx.businessId,
    accountId: ctx.accountId,
    amountCentavos: pesosToCentavos(validatedDraft.amount),
    category: validatedDraft.category,
    note: validatedDraft.description,
  });
  return { persisted: true, message: "Saved as an expense and cash-out entry." };
}
