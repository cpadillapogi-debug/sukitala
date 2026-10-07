# AI Guardrails

These rules are enforced in code, not just documented. If you're extending
this codebase, breaking any of these is a regression regardless of how
convenient it seems.

## The LLM may

- classify intent (sale, expense, receivable payment, unknown)
- extract entities (customer name, product, amount, reference number) as
  **candidate** values
- generate a plain-language explanation of a number the financial engine
  already computed
- format a Taglish response

## The LLM may NEVER

- perform arithmetic that becomes an authoritative financial number — all
  totals, balances, and profit figures come from `src/lib/finance/`, never
  from parsing a number the model wrote in its own response text
- write directly to the database
- claim a payment is "verified" — see `payment_proof_status` in
  `db/migrations/0003_receivables_proofs_saas.sql`; the strongest state an
  OCR-only pipeline can reach is `MATCHED`, not `CONFIRMED_BY_ACCOUNT_DATA`
  (reserved for an actual connected account/API source)
- execute arbitrary SQL or receive raw database access
- accuse a user or their customer of fraud — duplicate detection produces
  "needs review" signals only (`checkForDuplicate` in
  `src/lib/finance/duplicateDetection.ts` has a test asserting its reason
  strings never contain "fraud", "fake", or "scam")
- silently repair its own malformed output — `parseDraftTransaction` throws
  on invalid shape, and the UI must surface "couldn't understand that,
  please re-enter," never guess-and-proceed

## Enforcement points

| Rule | Enforced by |
|---|---|
| No LLM arithmetic | All money functions live in `src/lib/finance/`; nothing in `src/lib/ai/` imports money math for anything but pass-through display |
| No direct DB writes | `AiProvider` interface has no database import; server actions insert an explicit human-confirmation step between AI output and any persistence call |
| Strict output contract | `draftTransactionSchema` / `ocrExtractionSchema` (Zod, `src/lib/ai/schema.ts`) — `.parse()` throws on anything outside the contract |
| No "verified" language | `payment_proof_status` enum — application code must not display "Payment verified" for any status except `CONFIRMED_BY_ACCOUNT_DATA` |
| No fraud accusations | `duplicateDetection.test.ts` regex-asserts on the reason strings |

## Prompt-injection posture

All user-provided text, OCR-extracted text, and uploaded file content are
untrusted input to the AI layer, not instructions to the system. When a real
`AiProvider` is implemented (see `ANTHROPIC_INTEGRATION.md`), the system
prompt must instruct the model to treat everything in the user-content
portion as data to extract from, never as instructions, and
`draftTransactionSchema.parse()` is the backstop if that's ever
insufficient — malformed or out-of-contract output is rejected regardless of
what the model was told to do.
