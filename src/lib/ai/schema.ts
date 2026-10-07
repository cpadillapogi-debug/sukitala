import { z } from "zod";

/**
 * CONTRACT: The LLM/OCR layer may ONLY ever produce a DraftTransaction that
 * matches one of these schemas. It never touches the database, never computes
 * balances, and its output is always validated here before a human confirms it.
 *
 * Pipeline: raw input -> AI extraction -> zod.parse() (throws on anything
 * unexpected) -> human confirmation UI -> deterministic domain service.
 *
 * If AI output fails validation, the correct behavior is to surface a
 * "couldn't understand that, please re-enter" state — never to coerce or
 * guess at a fix.
 */

const moneyAmountSchema = z
  .number()
  .finite()
  .positive()
  .refine((v) => Math.round(v * 100) === v * 100, {
    message: "Amount must have at most 2 decimal places",
  });

export const draftSaleSchema = z.object({
  intent: z.literal("CREATE_SALE"),
  confidence: z.number().min(0).max(1),
  customerName: z.string().min(1).max(200).nullable(),
  items: z
    .array(
      z.object({
        productQuery: z.string().min(1).max(200),
        quantity: z.number().int().positive(),
        unitPrice: moneyAmountSchema.nullable(),
      })
    )
    .min(1),
  totalAmount: moneyAmountSchema.nullable(),
  paymentMethod: z.enum(["GCASH", "MAYA", "BANK", "CASH", "UNKNOWN"]),
  paymentStatus: z.enum(["PAID", "UNPAID", "PARTIAL"]),
  channel: z.string().max(50).default("UNKNOWN"),
});

export const draftExpenseSchema = z.object({
  intent: z.literal("CREATE_EXPENSE"),
  confidence: z.number().min(0).max(1),
  description: z.string().min(1).max(200),
  amount: moneyAmountSchema,
  category: z
    .enum(["LOGISTICS", "PACKAGING", "MARKETING", "PLATFORM_FEE", "INVENTORY_PURCHASE", "OTHER"])
    .default("OTHER"),
});

export const draftReceivablePaymentSchema = z.object({
  intent: z.literal("RECEIVABLE_PAYMENT"),
  confidence: z.number().min(0).max(1),
  customerName: z.string().min(1).max(200),
  amount: moneyAmountSchema,
});

export const draftUnknownSchema = z.object({
  intent: z.literal("UNKNOWN"),
  confidence: z.number().min(0).max(1),
  rawInput: z.string(),
});

export const draftTransactionSchema = z.discriminatedUnion("intent", [
  draftSaleSchema,
  draftExpenseSchema,
  draftReceivablePaymentSchema,
  draftUnknownSchema,
]);

export type DraftTransaction = z.infer<typeof draftTransactionSchema>;

/**
 * Parses raw AI/OCR provider output. Throws a ZodError on anything that
 * doesn't match the contract — callers must catch this and fall back to
 * asking the user to enter the transaction manually. Never attempt to
 * "repair" malformed AI output by guessing values.
 */
export function parseDraftTransaction(raw: unknown): DraftTransaction {
  return draftTransactionSchema.parse(raw);
}

/**
 * OCR extraction result for a payment-proof screenshot. Confidence and
 * extracted fields only — this is explicitly NOT a verification claim.
 * See /src/lib/finance/duplicateDetection.ts and PaymentProof.status for
 * how this feeds into the (human-gated) verification workflow.
 */
export const ocrExtractionSchema = z.object({
  amount: moneyAmountSchema.nullable(),
  referenceNumber: z.string().max(100).nullable(),
  senderName: z.string().max(200).nullable(),
  recipientName: z.string().max(200).nullable(),
  timestamp: z.string().datetime().nullable(),
  paymentProvider: z.enum(["GCASH", "MAYA", "BANK", "UNKNOWN"]),
  confidence: z.number().min(0).max(1),
});

export type OcrExtraction = z.infer<typeof ocrExtractionSchema>;
