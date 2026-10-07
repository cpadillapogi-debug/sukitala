import { createHmac, timingSafeEqual } from "crypto";

/**
 * Signed session tokens: base64url(payload JSON) + "." +
 * HMAC-SHA256(payload, AUTH_SESSION_SECRET). The token carries a
 * `sessionId` (a row id in the `sessions` table — see
 * db/local-dev/0005_auth_hardening.sql) so it CAN be revoked: this module
 * only verifies signature and expiry (cheap, no DB — used by
 * middleware.ts for a fast redirect check), while the actual revocation
 * check (is this sessionId still valid in the `sessions` table?) happens
 * in authService.ts's getCurrentUserId(), the real authorization boundary
 * where business data is about to be read/written. This two-layer split
 * mirrors the same "middleware = defense-in-depth, real check = the data
 * layer" pattern already used for tenant isolation — see ARCHITECTURE.md.
 */

export interface SessionPayload {
  userId: string;
  sessionId: string;
  issuedAt: number; // epoch ms
  expiresAt: number; // epoch ms
}

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SESSION_DURATION_SECONDS = SESSION_DURATION_MS / 1000;

export class SessionError extends Error {}

function getSecret(): string {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new SessionError(
      "AUTH_SESSION_SECRET is not set (or is too short — needs 32+ characters). " +
        "Generate one with: openssl rand -base64 32. See .env.example."
    );
  }
  return secret;
}

function sign(payloadB64: string): string {
  return createHmac("sha256", getSecret()).update(payloadB64).digest("base64url");
}

export function createSessionToken(userId: string, sessionId: string): string {
  const now = Date.now();
  const payload: SessionPayload = { userId, sessionId, issuedAt: now, expiresAt: now + SESSION_DURATION_MS };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(payloadB64);
  return `${payloadB64}.${signature}`;
}

/**
 * Verifies a session token's signature and expiry ONLY — does NOT check
 * revocation (that requires a DB round-trip; see getCurrentUserId() in
 * authService.ts for the full check). Returns null for anything invalid,
 * tampered, or expired — callers must treat null as "not authenticated,"
 * never throw a distinguishing error back to the client (which would leak
 * whether a token was malformed vs. expired vs. forged).
 */
export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;

  let expectedSignature: string;
  try {
    expectedSignature = sign(payloadB64);
  } catch {
    return null; // e.g. AUTH_SESSION_SECRET missing — fail closed
  }

  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null; // tampered or forged
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof payload.userId !== "string" || typeof payload.sessionId !== "string" || typeof payload.expiresAt !== "number") {
    return null;
  }
  if (Date.now() > payload.expiresAt) return null; // expired

  return payload;
}
