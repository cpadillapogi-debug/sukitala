import { parseDraftTransaction, ocrExtractionSchema, type DraftTransaction, type OcrExtraction } from "./schema";

/**
 * Provider interface. A real implementation (e.g. calling the Anthropic API
 * with an image + a "return ONLY this JSON schema" system prompt) can be
 * dropped in without touching any calling code — see MockAiProvider below
 * for why no real provider ships in this scaffold.
 */
export interface AiProvider {
  extractTransactionFromText(text: string): Promise<DraftTransaction>;
  extractPaymentProofFromImage(imageBuffer: Buffer, mimeType: string): Promise<OcrExtraction>;
}

/**
 * NO REAL OCR/AI PROVIDER IS CONFIGURED IN THIS SCAFFOLD.
 *
 * This repository was built without API credentials for any OCR/vision or
 * LLM provider. Wiring a real provider (Anthropic API, Google Vision, etc.)
 * requires an API key in .env.local (see .env.example) and a real
 * implementation of AiProvider — see ANTHROPIC_INTEGRATION.md for the exact
 * steps.
 *
 * This mock exists ONLY for local development and tests. It must never run
 * against a production database. The UI must show "Integration not
 * connected" rather than presenting mock output as a real extraction —
 * see isMockProvider below, which callers should check.
 */
export class MockAiProvider implements AiProvider {
  readonly isMock = true;

  async extractTransactionFromText(text: string): Promise<DraftTransaction> {
    // Extremely naive pattern match, sufficient only to exercise the pipeline
    // in dev/tests. Real extraction must come from an actual LLM call.
    const amountMatch = text.match(/₱?\s*([\d,]+(?:\.\d{1,2})?)/);
    const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, "")) : null;
    return parseDraftTransaction({
      intent: "CREATE_SALE",
      confidence: 0.4,
      customerName: null,
      items: [{ productQuery: text.slice(0, 50), quantity: 1, unitPrice: amount }],
      totalAmount: amount,
      paymentMethod: "UNKNOWN",
      paymentStatus: "PAID",
      channel: "UNKNOWN",
    });
  }

  async extractPaymentProofFromImage(): Promise<OcrExtraction> {
    return ocrExtractionSchema.parse({
      amount: null,
      referenceNumber: null,
      senderName: null,
      recipientName: null,
      timestamp: null,
      paymentProvider: "UNKNOWN",
      confidence: 0,
    });
  }
}

export function getAiProvider(): AiProvider {
  // Swap this for a real provider once ANTHROPIC_API_KEY (or another
  // provider's credentials) is set. Never silently fall back to the mock
  // in a deployed production environment — check isMockProvider() and warn.
  return new MockAiProvider();
}

export function isMockProvider(provider: AiProvider): boolean {
  return "isMock" in provider && (provider as MockAiProvider).isMock === true;
}
