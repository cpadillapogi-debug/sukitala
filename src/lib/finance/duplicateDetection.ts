import type { Centavos } from "../money/money";

/**
 * A parsed payment proof — the OUTPUT of OCR/AI extraction, before it becomes
 * a trusted transaction. See /src/lib/ai/schema.ts for the extraction contract.
 */
export interface PaymentProof {
  id: string;
  businessId: string;
  referenceNumber: string | null;
  amount: Centavos;
  timestamp: string | null; // sender-claimed timestamp from the screenshot, if extracted
  senderName: string | null;
  imageHash: string | null; // perceptual/content hash of the uploaded image
  status:
    | "UNVERIFIED"
    | "PENDING_REVIEW"
    | "DUPLICATE_SUSPECTED"
    | "MATCHED"
    | "CONFIRMED_BY_ACCOUNT_DATA"
    | "REJECTED";
}

export interface DuplicateCheckResult {
  isDuplicateSuspected: boolean;
  reasons: string[];
  matchedProofIds: string[];
}

/**
 * Flags a NEW payment proof as a possible duplicate of existing proofs for the
 * same business. This NEVER accuses anyone of fraud — it only ever produces
 * "needs review" signals for a human to check. See product rule: OCR extraction
 * is not proof of payment; duplicate suspicion is not proof of fraud either.
 */
export function checkForDuplicate(
  candidate: Pick<PaymentProof, "referenceNumber" | "amount" | "timestamp" | "imageHash">,
  existing: PaymentProof[],
  options: { timestampProximityMinutes?: number } = {}
): DuplicateCheckResult {
  const proximityMs = (options.timestampProximityMinutes ?? 5) * 60_000;
  const reasons: string[] = [];
  const matchedProofIds: string[] = [];

  for (const proof of existing) {
    let matched = false;

    if (
      candidate.referenceNumber &&
      proof.referenceNumber &&
      candidate.referenceNumber === proof.referenceNumber
    ) {
      reasons.push(`Same reference number as an existing proof (${proof.id}).`);
      matched = true;
    }

    if (candidate.imageHash && proof.imageHash && candidate.imageHash === proof.imageHash) {
      reasons.push(`Identical image content as an existing proof (${proof.id}).`);
      matched = true;
    }

    if (
      !matched &&
      candidate.amount === proof.amount &&
      candidate.timestamp &&
      proof.timestamp &&
      Math.abs(new Date(candidate.timestamp).getTime() - new Date(proof.timestamp).getTime()) <=
        proximityMs
    ) {
      reasons.push(
        `Same amount and a timestamp within ${options.timestampProximityMinutes ?? 5} minutes of an existing proof (${proof.id}).`
      );
      matched = true;
    }

    if (matched) matchedProofIds.push(proof.id);
  }

  return {
    isDuplicateSuspected: matchedProofIds.length > 0,
    reasons,
    matchedProofIds,
  };
}
