import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, validatePasswordStrength, MIN_PASSWORD_LENGTH } from "./password";

describe("password hashing", () => {
  it("never stores the plaintext — hash differs from input", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).not.toBe("correct horse battery staple");
    expect(hash.length).toBeGreaterThan(20);
  });

  it("verifies a correct password against its hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });

  it("produces a different hash each time (random salt) even for the same password", async () => {
    const hash1 = await hashPassword("same password");
    const hash2 = await hashPassword("same password");
    expect(hash1).not.toBe(hash2);
    // Both must still verify correctly despite being different strings.
    expect(await verifyPassword("same password", hash1)).toBe(true);
    expect(await verifyPassword("same password", hash2)).toBe(true);
  });
});

describe("password strength validation", () => {
  it(`rejects passwords shorter than ${MIN_PASSWORD_LENGTH} characters`, () => {
    const result = validatePasswordStrength("short1");
    expect(result.ok).toBe(false);
  });

  it("accepts a password meeting the minimum length", () => {
    const result = validatePasswordStrength("longenoughpassword");
    expect(result.ok).toBe(true);
  });
});
