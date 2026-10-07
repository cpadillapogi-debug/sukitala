# Wiring a real AI/OCR provider

`src/lib/ai/provider.ts` currently exports `MockAiProvider`, a naive regex
parser used only so the quick-add UI has something to exercise in dev. To
replace it with a real Claude-backed provider:

1. Get an API key from the Anthropic Console, add it to `.env.local` as
   `ANTHROPIC_API_KEY` (already listed in `.env.example`).

2. Add the SDK:
   ```bash
   npm install @anthropic-ai/sdk
   ```

3. Implement the `AiProvider` interface in a new file,
   `src/lib/ai/anthropicProvider.ts`:
   - `extractTransactionFromText(text)`: send `text` plus a system prompt
     instructing the model to return **only** JSON matching
     `draftTransactionSchema` (no prose). Parse the response with
     `parseDraftTransaction()` — let it throw on anything malformed; catch
     that in the caller and fall back to "please enter manually," never
     retry-and-guess.
   - `extractPaymentProofFromImage(imageBuffer, mimeType)`: send the image
     as a base64 content block, same JSON-only instruction, parsed against
     `ocrExtractionSchema`.
   - Treat the user's raw text / the screenshot's OCR content strictly as
     data for the model to extract from — see `AI_GUARDRAILS.md`'s
     prompt-injection section for the exact posture.

4. Update `getAiProvider()` to return the real provider when
   `ANTHROPIC_API_KEY` is set, `MockAiProvider` otherwise — and make sure
   any screen using `isMockProvider()` keeps showing the "Integration not
   connected" notice in that fallback case, so a misconfigured production
   deploy fails loudly instead of quietly serving mock output.

5. Add usage tracking: increment
   `subscriptions.ocr_scans_used_this_period` on every real OCR call, so the
   Free-tier 30-scan limit (see product spec) can be enforced server-side —
   never trust a client-side count.

Nothing else in the codebase needs to change — `src/app/quick-add/actions.ts`
and the dashboard already call through `getAiProvider()`, not a concrete
class, specifically so this swap is a one-file change.
