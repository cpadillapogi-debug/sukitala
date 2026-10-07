import bcrypt from "bcryptjs";

/**
 * Thin wrapper around bcryptjs so the rest of the codebase never imports
 * bcryptjs directly — one place to audit for "is a password ever written
 * unhashed anywhere." A cost factor of 12 is a reasonable default as of
 * this writing (2026); revisit if hardware moves on enough to weaken it.
 */
const BCRYPT_COST_FACTOR = 12;

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_COST_FACTOR);
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

export const MIN_PASSWORD_LENGTH = 8;

export function validatePasswordStrength(password: string): { ok: boolean; message?: string } {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  return { ok: true };
}
