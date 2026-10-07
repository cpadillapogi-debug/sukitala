import { describe, it, expect, beforeAll } from "vitest";
import { createHmac } from "crypto";
import { createSessionToken, verifySessionToken, SessionError } from "./session";

describe("session tokens", () => {
  beforeAll(() => {
    process.env.AUTH_SESSION_SECRET = "test-secret-that-is-at-least-32-characters-long";
  });

  it("creates a token that verifies successfully for the same user", () => {
    const token = createSessionToken("user-123", "session-abc");
    const payload = verifySessionToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.userId).toBe("user-123");
  });

  it("rejects a token with a tampered payload (userId swapped)", () => {
    const token = createSessionToken("user-123", "session-abc");
    const [, signature] = token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ userId: "user-456", sessionId: "session-abc", issuedAt: Date.now(), expiresAt: Date.now() + 1000000 })).toString("base64url");
    const forgedToken = `${forgedPayload}.${signature}`;
    expect(verifySessionToken(forgedToken)).toBeNull();
  });

  it("rejects a token with a tampered signature", () => {
    const token = createSessionToken("user-123", "session-abc");
    const [payloadB64] = token.split(".");
    const forgedToken = `${payloadB64}.deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdead`;
    expect(verifySessionToken(forgedToken)).toBeNull();
  });

  it("rejects a completely malformed token", () => {
    expect(verifySessionToken("not-a-real-token")).toBeNull();
    expect(verifySessionToken("")).toBeNull();
    expect(verifySessionToken(null)).toBeNull();
    expect(verifySessionToken(undefined)).toBeNull();
  });

  it("rejects an expired token", () => {
    // Construct a token with an already-past expiresAt, signed correctly,
    // to isolate "expiry is checked" from "signature verification works."
    const payload = { userId: "user-123", sessionId: "session-abc", issuedAt: Date.now() - 1000, expiresAt: Date.now() - 1 };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = createHmac("sha256", process.env.AUTH_SESSION_SECRET!).update(payloadB64).digest("base64url");
    const expiredToken = `${payloadB64}.${signature}`;
    expect(verifySessionToken(expiredToken)).toBeNull();
  });

  it("a token signed with a DIFFERENT secret is rejected — proves forgery without the real secret fails", () => {
    const payload = { userId: "attacker-controlled", sessionId: "session-attacker", issuedAt: Date.now(), expiresAt: Date.now() + 1000000 };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const wrongSignature = createHmac("sha256", "a-completely-different-secret-value-32ch").update(payloadB64).digest("base64url");
    const forgedToken = `${payloadB64}.${wrongSignature}`;
    expect(verifySessionToken(forgedToken)).toBeNull();
  });

  it("rejects a token missing sessionId (old-format payload, proves the new field is enforced)", () => {
    const payload = { userId: "user-123", issuedAt: Date.now(), expiresAt: Date.now() + 1000000 }; // no sessionId
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = createHmac("sha256", process.env.AUTH_SESSION_SECRET!).update(payloadB64).digest("base64url");
    expect(verifySessionToken(`${payloadB64}.${signature}`)).toBeNull();
  });

  it("throws SessionError when AUTH_SESSION_SECRET is missing at creation time", () => {
    const original = process.env.AUTH_SESSION_SECRET;
    delete process.env.AUTH_SESSION_SECRET;
    expect(() => createSessionToken("user-123", "session-abc")).toThrow(SessionError);
    process.env.AUTH_SESSION_SECRET = original;
  });
});
