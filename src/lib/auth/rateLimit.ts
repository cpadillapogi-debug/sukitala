import { getAdminPool } from "../data/db";

/**
 * Postgres-backed rate limiting — deliberately not in-memory. This
 * scaffold's whole architecture already treats Postgres as the shared
 * source of truth, so a table here is consistent with that, and correctly
 * shared across multiple app server instances (an in-process Map would
 * reset per-instance and per-restart, which is the "fragile in-memory-only
 * solution" the spec explicitly warns against).
 *
 * This is NOT a distributed cache (no Redis) — for a single-Postgres
 * deployment (which this whole scaffold assumes throughout), that's a
 * reasonable and honestly-described tradeoff, not a claim of a
 * general-purpose distributed rate limiter. See KNOWN_LIMITATIONS.md.
 */

const LOGIN_WINDOW_MINUTES = 15;
const LOGIN_MAX_FAILURES = 5;

const SIGNUP_WINDOW_MINUTES = 60;
const SIGNUP_MAX_ATTEMPTS = 5;

const RESET_REQUEST_WINDOW_MINUTES = 15;
const RESET_REQUEST_MAX_ATTEMPTS = 3;

export interface RateLimitResult {
  allowed: boolean;
  message?: string;
}

/**
 * Read-only check — call BEFORE attempting to verify credentials, so a
 * blocked request never even reaches the bcrypt compare. Does not record
 * anything; call recordLoginAttempt() separately once the actual outcome
 * (success/failure) is known.
 */
export async function isLoginRateLimited(email: string): Promise<RateLimitResult> {
  const pool = getAdminPool();
  const normalizedEmail = email.trim().toLowerCase();

  const { rows } = await pool.query(
    `select count(*) as failures
     from login_attempts
     where email = $1
       and succeeded = false
       and attempted_at > now() - ($2 || ' minutes')::interval`,
    [normalizedEmail, LOGIN_WINDOW_MINUTES]
  );
  const recentFailures = parseInt(rows[0].failures, 10);

  if (recentFailures >= LOGIN_MAX_FAILURES) {
    return {
      allowed: false,
      message: `Too many failed attempts. Please try again in ${LOGIN_WINDOW_MINUTES} minutes.`,
    };
  }
  return { allowed: true };
}

export async function recordLoginAttempt(email: string, succeeded: boolean): Promise<void> {
  const pool = getAdminPool();
  await pool.query(`insert into login_attempts (email, succeeded) values ($1, $2)`, [
    email.trim().toLowerCase(),
    succeeded,
  ]);
}

export async function checkAndRecordSignupAttempt(email: string): Promise<RateLimitResult> {
  const pool = getAdminPool();
  const normalizedEmail = email.trim().toLowerCase();

  const { rows } = await pool.query(
    `select count(*) as attempts
     from signup_attempts
     where email = $1
       and attempted_at > now() - ($2 || ' minutes')::interval`,
    [normalizedEmail, SIGNUP_WINDOW_MINUTES]
  );
  const recentAttempts = parseInt(rows[0].attempts, 10);

  if (recentAttempts >= SIGNUP_MAX_ATTEMPTS) {
    return {
      allowed: false,
      message: `Too many signup attempts for this email. Please try again in ${SIGNUP_WINDOW_MINUTES} minutes.`,
    };
  }

  await pool.query(`insert into signup_attempts (email) values ($1)`, [normalizedEmail]);
  return { allowed: true };
}

/**
 * Rate-limits password-reset REQUESTS (not the reset itself — that's
 * already single-use-token protected). Unlike isLoginRateLimited() and
 * checkAndRecordSignupAttempt(), this is keyed by user_id, not email —
 * password_reset_tokens doesn't store the raw email, only user_id, which
 * is only known once requestPasswordReset() has already looked the user up.
 *
 * CRITICAL: the caller must NOT let a "rate limited" result produce a
 * different response than the normal "if an account exists..." generic
 * message. Doing so would reopen exactly the email-enumeration side
 * channel that message was designed to close (an attacker could tell
 * "this email exists" purely from whether repeated requests eventually
 * start being rate-limited). The caller should silently skip creating a
 * new token/sending an email when rate-limited, and return the identical
 * generic message either way — never surface this result to the user.
 */
export async function isPasswordResetRequestRateLimited(userId: string): Promise<RateLimitResult> {
  const pool = getAdminPool();

  const { rows } = await pool.query(
    `select count(*) as recent
     from password_reset_tokens
     where user_id = $1
       and created_at > now() - ($2 || ' minutes')::interval`,
    [userId, RESET_REQUEST_WINDOW_MINUTES]
  );
  const recentRequests = parseInt(rows[0].recent, 10);

  if (recentRequests >= RESET_REQUEST_MAX_ATTEMPTS) {
    return { allowed: false };
  }
  return { allowed: true };
}
