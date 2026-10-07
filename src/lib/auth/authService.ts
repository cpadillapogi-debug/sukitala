import { randomBytes, createHash } from "crypto";
import { cookies } from "next/headers";
import { getAdminPool } from "../data/db";
import { hashPassword, verifyPassword, validatePasswordStrength } from "./password";
import { createSessionToken, verifySessionToken, SESSION_DURATION_SECONDS } from "./session";
import { isLoginRateLimited, recordLoginAttempt, checkAndRecordSignupAttempt, isPasswordResetRequestRateLimited } from "./rateLimit";

/**
 * Real signup/login/logout/password-reset/email-verification, self-hosted
 * against local Postgres because no live Supabase project is reachable in
 * this environment — see db/local-dev/0004_local_auth.sql,
 * db/local-dev/0005_auth_hardening.sql, and ARCHITECTURE.md
 * "Authentication" for exactly what this is a stand-in for and how to
 * replace it.
 *
 * Every function here uses the ADMIN pool (bypasses RLS) — correct and
 * necessary: these operations happen before a session exists (or, for
 * password reset, ARE the mechanism establishing a new one), so there is
 * no auth.uid() yet for RLS to key off. Once a session is established,
 * every subsequent business-data query goes through withUserContext()
 * (the RLS-respecting path) instead. See SECURITY.md.
 */

const SESSION_COOKIE_NAME = "kiracash_session";
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Generates a cryptographically random token, returning both the raw value
 * (shown to the user exactly once, via the dev-log delivery abstraction
 * below) and its SHA-256 hash (the only thing ever persisted). A database
 * read alone — even a full dump — can never yield a usable reset/
 * verification link, matching the spec's "hash the token before
 * persistence" requirement.
 */
function generateTokenPair(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

/**
 * NO EMAIL PROVIDER IS CONFIGURED. This "delivers" reset/verification
 * links by logging them to the server console — sufficient to prove the
 * mechanism works end-to-end in development/testing, but this is
 * explicitly NOT production email delivery. See KNOWN_LIMITATIONS.md.
 * Wiring a real provider (Resend, Postmark, etc.) means replacing this one
 * function; nothing else in the reset/verification flow needs to change.
 */
function devLogDeliverLink(kind: "password-reset" | "email-verification", email: string, token: string): void {
  const path = kind === "password-reset" ? "reset-password" : "verify-email";
  console.log(`[DEV EMAIL STAND-IN] ${kind} link for ${email}: /${path}?token=${token}`);
}

export interface SignUpResult {
  ok: boolean;
  message: string;
  userId?: string;
}

export async function signUp(params: {
  email: string;
  password: string;
  businessName: string;
}): Promise<SignUpResult> {
  const email = params.email.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { ok: false, message: "Enter a valid email address." };
  }
  const strength = validatePasswordStrength(params.password);
  if (!strength.ok) {
    return { ok: false, message: strength.message! };
  }
  if (!params.businessName.trim()) {
    return { ok: false, message: "Business name is required." };
  }

  const signupLimit = await checkAndRecordSignupAttempt(email);
  if (!signupLimit.allowed) {
    return { ok: false, message: signupLimit.message! };
  }

  const pool = getAdminPool();
  const client = await pool.connect();
  try {
    await client.query("begin");

    const { rows: existing } = await client.query(`select id from auth.users where email = $1`, [email]);
    if (existing.length > 0) {
      await client.query("rollback");
      return { ok: false, message: "An account with that email already exists." };
    }

    const { rows: userRows } = await client.query(
      `insert into auth.users (email) values ($1) returning id`,
      [email]
    );
    const userId = userRows[0].id;

    const passwordHash = await hashPassword(params.password);
    await client.query(`insert into local_auth_credentials (user_id, password_hash) values ($1, $2)`, [
      userId,
      passwordHash,
    ]);

    const { rows: businessRows } = await client.query(
      `insert into businesses (name) values ($1) returning id`,
      [params.businessName.trim()]
    );
    const businessId = businessRows[0].id;

    await client.query(
      `insert into memberships (business_id, user_id, role) values ($1, $2, 'OWNER')`,
      [businessId, userId]
    );

    const { raw: verificationToken, hash: verificationHash } = generateTokenPair();
    await client.query(
      `insert into email_verification_tokens (user_id, token_hash, expires_at) values ($1, $2, $3)`,
      [userId, verificationHash, new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS)]
    );

    await client.query("commit");
    devLogDeliverLink("email-verification", email, verificationToken);
    return { ok: true, message: "Account created.", userId };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export interface SignInResult {
  ok: boolean;
  message: string;
}

/**
 * The actual credential check, separated from cookie-setting so it's
 * testable without a Next.js request context (next/headers `cookies()`
 * throws outside one — see authService.integration.test.ts). This is also
 * where the timing-safety property lives: verifyPassword() is ALWAYS
 * called, even for a nonexistent email, against a dummy hash if needed, so
 * response time can't be used to enumerate valid emails even though the
 * error message already doesn't distinguish the two cases.
 *
 * Rate limiting is checked BEFORE this runs (in signIn(), below) — a
 * blocked request never reaches the bcrypt compare at all.
 */
export async function verifyCredentials(
  email: string,
  password: string
): Promise<{ ok: true; userId: string } | { ok: false; message: string }> {
  const normalizedEmail = email.trim().toLowerCase();
  const pool = getAdminPool();

  const { rows } = await pool.query(
    `select u.id, c.password_hash
     from auth.users u
     join local_auth_credentials c on c.user_id = u.id
     where u.email = $1`,
    [normalizedEmail]
  );

  const genericError = { ok: false as const, message: "Incorrect email or password." };
  const DUMMY_HASH_FOR_TIMING_SAFETY = "$2a$12$C6UzMDM.H6dfI/f/IKcEeO7DKGaFf/qJqbEE1G6tS7L0EJfNqXEre"; // bcrypt hash of an arbitrary unused string, not a real credential
  const passwordHash = rows.length > 0 ? rows[0].password_hash : DUMMY_HASH_FOR_TIMING_SAFETY;
  const valid = await verifyPassword(password, passwordHash);
  if (rows.length === 0 || !valid) return genericError;

  return { ok: true, userId: rows[0].id };
}

/**
 * Creates a new session row (the revocation record) and returns a signed
 * token embedding its id. Shared by signIn() and any future "re-issue a
 * session" path.
 */
async function establishSession(userId: string): Promise<string> {
  const pool = getAdminPool();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_SECONDS * 1000);
  const { rows } = await pool.query(
    `insert into sessions (user_id, expires_at) values ($1, $2) returning id`,
    [userId, expiresAt]
  );
  const sessionId = rows[0].id;
  return createSessionToken(userId, sessionId);
}

async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
}

export async function signIn(email: string, password: string): Promise<SignInResult> {
  // Rate limit is checked (and later recorded) keyed on the literal email
  // string attempted — identical handling whether or not that email is
  // registered, so the block behavior itself can't be used to enumerate
  // accounts.
  const limitCheck = await isLoginRateLimited(email);
  if (!limitCheck.allowed) {
    return { ok: false, message: limitCheck.message! };
  }

  const result = await verifyCredentials(email, password);
  await recordLoginAttempt(email, result.ok);
  if (!result.ok) return result;

  const token = await establishSession(result.userId);
  await setSessionCookie(token);

  return { ok: true, message: "Signed in." };
}

/**
 * Logs out the CURRENT session only: revokes its row in `sessions` (so a
 * copy of the cookie obtained before logout stops working immediately, not
 * just "eventually expires") and clears the cookie. Does not affect the
 * user's other active sessions on other devices — see
 * revokeAllSessionsForUser() for that (used by password reset).
 */
export async function signOut(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const payload = verifySessionToken(token);
  if (payload) {
    const pool = getAdminPool();
    await pool.query(`update sessions set revoked_at = now() where id = $1 and revoked_at is null`, [
      payload.sessionId,
    ]);
  }
  cookieStore.delete(SESSION_COOKIE_NAME);
}

async function revokeAllSessionsForUser(userId: string): Promise<void> {
  const pool = getAdminPool();
  await pool.query(`update sessions set revoked_at = now() where user_id = $1 and revoked_at is null`, [userId]);
}

/**
 * Resolves the current authenticated user's id from the session cookie —
 * checks signature+expiry (verifySessionToken) AND revocation (a DB read
 * against `sessions`), so a logged-out or password-reset-invalidated
 * session is correctly rejected here even though its signature is still
 * valid. This is the ONLY sanctioned way for server code to learn "who is
 * making this request" — nothing should ever read a userId from a request
 * body, query param, or client-supplied header.
 *
 * Note the asymmetry with middleware.ts: middleware only checks signature
 * + expiry (fast, no DB) as a defense-in-depth redirect for page
 * navigation; THIS function is where revocation is actually enforced,
 * immediately before any real business data would be read or written.
 */
export async function getCurrentUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const payload = verifySessionToken(token);
  if (!payload) return null;

  const pool = getAdminPool();
  const { rows } = await pool.query(
    `select 1 from sessions where id = $1 and revoked_at is null and expires_at > now()`,
    [payload.sessionId]
  );
  if (rows.length === 0) return null; // revoked, or the DB row expired/was never created

  return payload.userId;
}

export interface RequestPasswordResetResult {
  message: string;
}

/**
 * ALWAYS returns the same generic message regardless of whether the email
 * exists — per spec, "never reveal that email does not exist." Internally,
 * only generates/stores/logs a token when the account is real.
 */
export async function requestPasswordReset(email: string): Promise<RequestPasswordResetResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const genericMessage = "If an account with that email exists, a reset link has been sent.";

  const pool = getAdminPool();
  const { rows } = await pool.query(`select id from auth.users where email = $1`, [normalizedEmail]);
  if (rows.length === 0) {
    return { message: genericMessage };
  }
  const userId = rows[0].id;

  // Rate-limit AFTER the lookup (so this only ever runs for a real account),
  // and return the SAME generic message either way — see the doc comment
  // on isPasswordResetRequestRateLimited() for why the result must never
  // be allowed to leak into a different response.
  const limitCheck = await isPasswordResetRequestRateLimited(userId);
  if (!limitCheck.allowed) {
    return { message: genericMessage };
  }

  const { raw, hash } = generateTokenPair();
  await pool.query(
    `insert into password_reset_tokens (user_id, token_hash, expires_at) values ($1, $2, $3)`,
    [userId, hash, new Date(Date.now() + RESET_TOKEN_TTL_MS)]
  );
  devLogDeliverLink("password-reset", normalizedEmail, raw);

  return { message: genericMessage };
}

export interface ResetPasswordResult {
  ok: boolean;
  message: string;
}

export async function resetPassword(rawToken: string, newPassword: string): Promise<ResetPasswordResult> {
  const strength = validatePasswordStrength(newPassword);
  if (!strength.ok) {
    return { ok: false, message: strength.message! };
  }

  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const pool = getAdminPool();
  const client = await pool.connect();
  let resetUserId: string | null = null;
  try {
    await client.query("begin");

    // Lock the row so two concurrent uses of the same token can't both
    // succeed (mirrors the receivable-payment locking pattern elsewhere).
    const { rows } = await client.query(
      `select id, user_id, expires_at, used_at from password_reset_tokens where token_hash = $1 for update`,
      [tokenHash]
    );
    const genericInvalid = { ok: false as const, message: "This reset link is invalid or has expired." };
    if (rows.length === 0) {
      await client.query("rollback");
      return genericInvalid;
    }
    const tokenRow = rows[0];
    if (tokenRow.used_at !== null || new Date(tokenRow.expires_at) < new Date()) {
      await client.query("rollback");
      return genericInvalid;
    }

    const passwordHash = await hashPassword(newPassword);
    await client.query(`update local_auth_credentials set password_hash = $1 where user_id = $2`, [
      passwordHash,
      tokenRow.user_id,
    ]);
    await client.query(`update password_reset_tokens set used_at = now() where id = $1`, [tokenRow.id]);
    resetUserId = tokenRow.user_id;

    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }

  // Outside the transaction (already committed): invalidate every existing
  // session for this user — a password reset must not leave old sessions
  // (e.g. an attacker's, if the reset was prompted by a suspected
  // compromise) still valid.
  if (resetUserId) {
    await revokeAllSessionsForUser(resetUserId);
  }

  return { ok: true, message: "Password updated. Please sign in with your new password." };
}

export interface VerifyEmailResult {
  ok: boolean;
  message: string;
}

export async function verifyEmail(rawToken: string): Promise<VerifyEmailResult> {
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const pool = getAdminPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query(
      `select id, user_id, expires_at, used_at from email_verification_tokens where token_hash = $1 for update`,
      [tokenHash]
    );
    const genericInvalid = { ok: false as const, message: "This verification link is invalid or has expired." };
    if (rows.length === 0) {
      await client.query("rollback");
      return genericInvalid;
    }
    const tokenRow = rows[0];
    if (tokenRow.used_at !== null || new Date(tokenRow.expires_at) < new Date()) {
      await client.query("rollback");
      return genericInvalid;
    }

    await client.query(`update auth.users set email_verified = true where id = $1`, [tokenRow.user_id]);
    await client.query(`update email_verification_tokens set used_at = now() where id = $1`, [tokenRow.id]);
    await client.query("commit");
    return { ok: true, message: "Email verified." };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
