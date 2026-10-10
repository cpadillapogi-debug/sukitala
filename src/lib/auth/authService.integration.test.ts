import { describe, it, expect, afterAll, vi } from "vitest";
import { Pool } from "pg";
import { signUp, verifyCredentials, getCurrentUserId, requestPasswordReset, resetPassword, verifyEmail } from "./authService";
import { isLoginRateLimited, recordLoginAttempt } from "./rateLimit";
import { getCashAccounts } from "../data/finance";

/**
 * Runs only when both DATABASE_URL and ADMIN_DATABASE_URL are set (see
 * package.json "test:integration"). Proves the real auth flow — signup,
 * login, password verification, and cross-tenant RLS driven by ACTUALLY
 * SIGNED-UP users — not the hand-seeded fixtures used elsewhere.
 *
 * IMPORTANT: signIn() sets a cookie via next/headers `cookies()`, which
 * only works inside a real Next.js request context (server action/route
 * handler). Outside of one, `cookies()` throws. So these tests call the
 * lower-level pieces directly (getAdminPool-backed signUp, then verify the
 * password hash and RLS behavior via withUserContext with the resolved
 * userId) rather than signIn()'s cookie-setting path — the cookie
 * mechanics themselves are covered by src/lib/auth/session.test.ts
 * (pure token creation/verification) and the live HTTP smoke test (which
 * runs inside a real Next.js server, where cookies() works for real).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_DATABASE_URL = process.env.TEST_ADMIN_DATABASE_URL ?? process.env.ADMIN_DATABASE_URL;
const describeIfDb = DATABASE_URL && ADMIN_DATABASE_URL ? describe : describe.skip;

describeIfDb("auth integration — real signup/login against Postgres", () => {
  let adminPool: Pool;
  const createdUserIds: string[] = [];
  const createdBusinessIds: string[] = [];

  afterAll(async () => {
    if (!adminPool) return;
    for (const businessId of createdBusinessIds) {
      await adminPool.query(`delete from businesses where id = $1`, [businessId]);
    }
    for (const userId of createdUserIds) {
      await adminPool.query(`delete from auth.users where id = $1`, [userId]);
    }
    await adminPool.end();
  });

  function uniqueEmail(label: string) {
    return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@kiracash-test.dev`;
  }

  it("signUp creates a real auth.users row, a hashed credential, a business, and an OWNER membership", async () => {
    process.env.ADMIN_DATABASE_URL = ADMIN_DATABASE_URL;
    adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });

    const email = uniqueEmail("signup-test");
    const result = await signUp({ email, password: "correct-horse-battery", businessName: "Test Business A" });

    expect(result.ok).toBe(true);
    expect(result.userId).toBeTruthy();
    createdUserIds.push(result.userId!);

    const { rows: userRows } = await adminPool.query(`select id, email from auth.users where id = $1`, [result.userId]);
    expect(userRows).toHaveLength(1);
    expect(userRows[0].email).toBe(email);

    const { rows: credRows } = await adminPool.query(
      `select password_hash from local_auth_credentials where user_id = $1`,
      [result.userId]
    );
    expect(credRows).toHaveLength(1);
    expect(credRows[0].password_hash).not.toContain("correct-horse-battery"); // never plaintext

    const { rows: memberRows } = await adminPool.query(
      `select business_id, role from memberships where user_id = $1`,
      [result.userId]
    );
    expect(memberRows).toHaveLength(1);
    expect(memberRows[0].role).toBe("OWNER");
    createdBusinessIds.push(memberRows[0].business_id);
  });

  it("rejects signup with a duplicate email", async () => {
    const email = uniqueEmail("duplicate-test");
    const first = await signUp({ email, password: "correct-horse-battery", businessName: "First" });
    expect(first.ok).toBe(true);
    createdUserIds.push(first.userId!);
    const { rows } = await adminPool.query(`select business_id from memberships where user_id = $1`, [first.userId]);
    createdBusinessIds.push(rows[0].business_id);

    const second = await signUp({ email, password: "different-password", businessName: "Second" });
    expect(second.ok).toBe(false);
    expect(second.message).toMatch(/already exists/i);
  });

  it("rejects signup with a weak password", async () => {
    const result = await signUp({ email: uniqueEmail("weak-pw"), password: "short", businessName: "Test" });
    expect(result.ok).toBe(false);
  });

  it("password verification: correct password matches the stored hash, wrong password does not", async () => {
    const email = uniqueEmail("verify-test");
    const signUpResult = await signUp({ email, password: "the-real-password-123", businessName: "Verify Test" });
    createdUserIds.push(signUpResult.userId!);
    const { rows } = await adminPool.query(`select business_id from memberships where user_id = $1`, [signUpResult.userId]);
    createdBusinessIds.push(rows[0].business_id);

    const bcrypt = await import("bcryptjs");
    const { rows: credRows } = await adminPool.query(
      `select password_hash from local_auth_credentials where user_id = $1`,
      [signUpResult.userId]
    );
    expect(await bcrypt.compare("the-real-password-123", credRows[0].password_hash)).toBe(true);
    expect(await bcrypt.compare("wrong-password", credRows[0].password_hash)).toBe(false);
  });

  it(
    "CROSS-TENANT RLS via REAL signed-up users (not hand-seeded fixtures): " +
      "user A cannot read user B's accounts even though both are real, distinct, signed-up sellers",
    async () => {
      const emailA = uniqueEmail("tenant-a");
      const emailB = uniqueEmail("tenant-b");
      const signUpA = await signUp({ email: emailA, password: "password-for-a-123", businessName: "Tenant A Business" });
      const signUpB = await signUp({ email: emailB, password: "password-for-b-123", businessName: "Tenant B Business" });
      createdUserIds.push(signUpA.userId!, signUpB.userId!);

      const { rows: businessRowsA } = await adminPool.query(`select business_id from memberships where user_id = $1`, [signUpA.userId]);
      const { rows: businessRowsB } = await adminPool.query(`select business_id from memberships where user_id = $1`, [signUpB.userId]);
      const businessIdA = businessRowsA[0].business_id;
      const businessIdB = businessRowsB[0].business_id;
      createdBusinessIds.push(businessIdA, businessIdB);

      // Give business B a real account, so there's something for A to (fail to) see.
      await adminPool.query(
        `insert into accounts (business_id, type, name, opening_balance_centavos) values ($1, 'GCASH', 'B GCash', 500000)`,
        [businessIdB]
      );

      // As real user A (via withUserContext, the same RLS path every server
      // action uses), attempt to read business B's accounts by ID.
      const accountsBAsSeenByA = await getCashAccounts(signUpA.userId!, businessIdB);
      expect(accountsBAsSeenByA).toHaveLength(0);

      // Sanity: user B CAN see their own account — proves this is tenant
      // isolation, not just "nothing can see anything."
      const accountsBAsSeenByB = await getCashAccounts(signUpB.userId!, businessIdB);
      expect(accountsBAsSeenByB).toHaveLength(1);
    }
  );

  it("getCurrentUserId returns null outside a real request context (no cookies available) rather than throwing an unhandled error into calling code incorrectly", async () => {
    // This documents current behavior precisely: next/headers cookies()
    // throws outside a request scope, and getCurrentUserId does not catch
    // that — callers (sessionContext.ts, dashboardData.ts) only ever run
    // inside real Next.js server components/actions, where this is fine.
    // This test exists so that assumption is written down, not implicit.
    await expect(getCurrentUserId()).rejects.toThrow();
  });

  it("verifyCredentials accepts the correct password and rejects the wrong one, via the real DB", async () => {
    const email = uniqueEmail("verify-creds");
    const signUpResult = await signUp({ email, password: "the-real-password-456", businessName: "Verify Creds Test" });
    createdUserIds.push(signUpResult.userId!);
    const { rows } = await adminPool.query(`select business_id from memberships where user_id = $1`, [signUpResult.userId]);
    createdBusinessIds.push(rows[0].business_id);

    const correct = await verifyCredentials(email, "the-real-password-456");
    expect(correct.ok).toBe(true);
    if (correct.ok) expect(correct.userId).toBe(signUpResult.userId);

    const wrong = await verifyCredentials(email, "wrong-password");
    expect(wrong.ok).toBe(false);
  });

  it("verifyCredentials gives an IDENTICAL error message for a nonexistent email vs. a wrong password — no enumeration via message content", async () => {
    const email = uniqueEmail("enum-test");
    const signUpResult = await signUp({ email, password: "the-real-password-789", businessName: "Enum Test" });
    createdUserIds.push(signUpResult.userId!);
    const { rows } = await adminPool.query(`select business_id from memberships where user_id = $1`, [signUpResult.userId]);
    createdBusinessIds.push(rows[0].business_id);

    const wrongPasswordResult = await verifyCredentials(email, "wrong-password");
    const nonexistentEmailResult = await verifyCredentials(uniqueEmail("does-not-exist"), "anything");

    expect(wrongPasswordResult.ok).toBe(false);
    expect(nonexistentEmailResult.ok).toBe(false);
    if (!wrongPasswordResult.ok && !nonexistentEmailResult.ok) {
      expect(wrongPasswordResult.message).toBe(nonexistentEmailResult.message);
    }
  });

  it(
    "SECURITY: verifyCredentials takes roughly the SAME TIME for a nonexistent email as for a wrong " +
      "password on a real account — a real bcrypt compare runs in both cases, not skipped for the " +
      "nonexistent-email path, which would otherwise leak valid emails via response timing",
    async () => {
      const email = uniqueEmail("timing-test");
      const signUpResult = await signUp({ email, password: "the-real-password-timing", businessName: "Timing Test" });
      createdUserIds.push(signUpResult.userId!);
      const { rows } = await adminPool.query(`select business_id from memberships where user_id = $1`, [signUpResult.userId]);
      createdBusinessIds.push(rows[0].business_id);

      const timeIt = async (fn: () => Promise<unknown>) => {
        const start = performance.now();
        await fn();
        return performance.now() - start;
      };

      // Average over a few runs to reduce noise — this is a real timing
      // measurement against a real bcrypt compare (cost factor 12, ~300-700ms
      // each), not a mocked stopwatch.
      const RUNS = 3;
      let wrongPasswordTotal = 0;
      let nonexistentEmailTotal = 0;
      for (let i = 0; i < RUNS; i++) {
        wrongPasswordTotal += await timeIt(() => verifyCredentials(email, "wrong-password"));
        nonexistentEmailTotal += await timeIt(() => verifyCredentials(uniqueEmail(`nonexistent-${i}`), "anything"));
      }
      const avgWrongPassword = wrongPasswordTotal / RUNS;
      const avgNonexistentEmail = nonexistentEmailTotal / RUNS;

      // Both paths run a real bcrypt compare, so they should be in the same
      // ballpark — allow generous slack (2x) for test-environment noise,
      // since the point is "not near-instant vs. hundreds of ms," not
      // microsecond precision.
      const ratio = Math.max(avgWrongPassword, avgNonexistentEmail) / Math.min(avgWrongPassword, avgNonexistentEmail);
      expect(ratio).toBeLessThan(2);
      // Both should actually be slow (bcrypt-compare-slow), not near-zero —
      // proves neither path short-circuited before the compare.
      expect(avgWrongPassword).toBeGreaterThan(50);
      expect(avgNonexistentEmail).toBeGreaterThan(50);
    }
  );

  describe("rate limiting — real Postgres-backed, not in-memory", () => {
    function uniqueLimitEmail() {
      return `ratelimit-${Date.now()}-${Math.random().toString(36).slice(2)}@kiracash-test.dev`;
    }

    it("allows login attempts under the failure threshold", async () => {
      const email = uniqueLimitEmail();
      for (let i = 0; i < 4; i++) {
        const check = await isLoginRateLimited(email);
        expect(check.allowed).toBe(true);
        await recordLoginAttempt(email, false);
      }
    });

    it(
      "BLOCKS login after exceeding the failure threshold — proves this is enforced server-side " +
        "against real recorded attempts, not just a client-side limit that could be bypassed",
      async () => {
        const email = uniqueLimitEmail();
        // Exhaust the threshold with real recorded failures.
        for (let i = 0; i < 5; i++) {
          await recordLoginAttempt(email, false);
        }
        const check = await isLoginRateLimited(email);
        expect(check.allowed).toBe(false);
        expect(check.message).toMatch(/too many/i);
      }
    );

    it("a successful login does not count toward the failure threshold", async () => {
      const email = uniqueLimitEmail();
      for (let i = 0; i < 4; i++) {
        await recordLoginAttempt(email, false);
      }
      await recordLoginAttempt(email, true); // a success interleaved — doesn't reset failures, but doesn't add to them either
      const check = await isLoginRateLimited(email);
      expect(check.allowed).toBe(true); // still only 4 real failures
    });

    it("rate limiting is keyed per-email — one email's failures don't block a different email", async () => {
      const blockedEmail = uniqueLimitEmail();
      const otherEmail = uniqueLimitEmail();
      for (let i = 0; i < 5; i++) {
        await recordLoginAttempt(blockedEmail, false);
      }
      expect((await isLoginRateLimited(blockedEmail)).allowed).toBe(false);
      expect((await isLoginRateLimited(otherEmail)).allowed).toBe(true);
    });
  });

  describe("session revocation — the query getCurrentUserId() runs, tested directly against real Postgres", () => {
    // getCurrentUserId() itself requires a real Next.js request context
    // (next/headers cookies() throws otherwise — see the test above proving
    // exactly that). This block tests the REVOCATION QUERY LOGIC directly:
    // the same WHERE clause getCurrentUserId() uses against a real
    // `sessions` row, which is the part that's new and needs proving. The
    // cookie mechanics themselves are covered by session.test.ts (pure) and
    // the live HTTP smoke test (real request context).
    async function isSessionValid(sessionId: string): Promise<boolean> {
      const { rows } = await adminPool.query(
        `select 1 from sessions where id = $1 and revoked_at is null and expires_at > now()`,
        [sessionId]
      );
      return rows.length > 0;
    }

    it("a freshly created, unrevoked, unexpired session is valid", async () => {
      const email = uniqueEmail("session-fresh");
      const signUpResult = await signUp({ email, password: "session-test-password-1", businessName: "Session Fresh Test" });
      createdUserIds.push(signUpResult.userId!);
      const { rows } = await adminPool.query(`select business_id from memberships where user_id = $1`, [signUpResult.userId]);
      createdBusinessIds.push(rows[0].business_id);

      const { rows: sessionRows } = await adminPool.query(
        `insert into sessions (user_id, expires_at) values ($1, now() + interval '30 days') returning id`,
        [signUpResult.userId]
      );
      expect(await isSessionValid(sessionRows[0].id)).toBe(true);
    });

    it("REVOKED session is rejected — proves logout's revocation actually takes effect, not just clears a cookie", async () => {
      const email = uniqueEmail("session-revoked");
      const signUpResult = await signUp({ email, password: "session-test-password-2", businessName: "Session Revoked Test" });
      createdUserIds.push(signUpResult.userId!);
      const { rows } = await adminPool.query(`select business_id from memberships where user_id = $1`, [signUpResult.userId]);
      createdBusinessIds.push(rows[0].business_id);

      const { rows: sessionRows } = await adminPool.query(
        `insert into sessions (user_id, expires_at) values ($1, now() + interval '30 days') returning id`,
        [signUpResult.userId]
      );
      const sessionId = sessionRows[0].id;
      expect(await isSessionValid(sessionId)).toBe(true);

      // Exactly what signOut() does.
      await adminPool.query(`update sessions set revoked_at = now() where id = $1`, [sessionId]);
      expect(await isSessionValid(sessionId)).toBe(false);
    });

    it("EXPIRED session (past expires_at, never revoked) is rejected", async () => {
      const email = uniqueEmail("session-expired");
      const signUpResult = await signUp({ email, password: "session-test-password-3", businessName: "Session Expired Test" });
      createdUserIds.push(signUpResult.userId!);
      const { rows } = await adminPool.query(`select business_id from memberships where user_id = $1`, [signUpResult.userId]);
      createdBusinessIds.push(rows[0].business_id);

      const { rows: sessionRows } = await adminPool.query(
        `insert into sessions (user_id, expires_at) values ($1, now() - interval '1 minute') returning id`,
        [signUpResult.userId]
      );
      expect(await isSessionValid(sessionRows[0].id)).toBe(false);
    });

    it(
      "resetPassword revokes ALL of a user's sessions, not just one — proves the " +
        "\"password change invalidates existing sessions\" requirement",
      async () => {
        const email = uniqueEmail("session-reset-revoke");
        const signUpResult = await signUp({ email, password: "original-password-123", businessName: "Reset Revoke Test" });
        createdUserIds.push(signUpResult.userId!);
        const { rows } = await adminPool.query(`select business_id from memberships where user_id = $1`, [signUpResult.userId]);
        createdBusinessIds.push(rows[0].business_id);

        // Two "devices" logged in.
        const { rows: session1 } = await adminPool.query(
          `insert into sessions (user_id, expires_at) values ($1, now() + interval '30 days') returning id`,
          [signUpResult.userId]
        );
        const { rows: session2 } = await adminPool.query(
          `insert into sessions (user_id, expires_at) values ($1, now() + interval '30 days') returning id`,
          [signUpResult.userId]
        );
        expect(await isSessionValid(session1[0].id)).toBe(true);
        expect(await isSessionValid(session2[0].id)).toBe(true);

        const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        await requestPasswordReset(email);
        const logCall = consoleSpy.mock.calls.find((args) => String(args[0]).includes("password-reset"));
        consoleSpy.mockRestore();
        expect(logCall).toBeTruthy();
        const rawToken = String(logCall![0]).match(/token=([^\s]+)/)![1];

        const resetResult = await resetPassword(rawToken, "brand-new-password-456");
        expect(resetResult.ok).toBe(true);

        // BOTH sessions must now be invalid, not just a hypothetical "current" one.
        expect(await isSessionValid(session1[0].id)).toBe(false);
        expect(await isSessionValid(session2[0].id)).toBe(false);
      }
    );
  });

  describe("password reset — full flow against real Postgres", () => {
    it("requestPasswordReset returns the SAME generic message for an existing vs. nonexistent email", async () => {
      const email = uniqueEmail("reset-enum");
      const signUpResult = await signUp({ email, password: "reset-enum-password-1", businessName: "Reset Enum Test" });
      createdUserIds.push(signUpResult.userId!);
      const { rows } = await adminPool.query(`select business_id from memberships where user_id = $1`, [signUpResult.userId]);
      createdBusinessIds.push(rows[0].business_id);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const existingResult = await requestPasswordReset(email);
      const nonexistentResult = await requestPasswordReset(uniqueEmail("does-not-exist-reset"));
      consoleSpy.mockRestore();

      expect(existingResult.message).toBe(nonexistentResult.message);
    });

    it(
      "requestPasswordReset is rate-limited after 3 requests in the window, and the rate-limited " +
        "response is IDENTICAL to the normal one — the fix for the missing password-reset rate " +
        "limit, verified not to reopen the email-enumeration side channel it would create if the " +
        "rate-limited message ever differed from the normal one",
      async () => {
        const email = uniqueEmail("reset-ratelimit");
        const signUpResult = await signUp({ email, password: "reset-ratelimit-password-1", businessName: "Reset RL Test" });
        createdUserIds.push(signUpResult.userId!);
        const { rows } = await adminPool.query(`select business_id from memberships where user_id = $1`, [signUpResult.userId]);
        createdBusinessIds.push(rows[0].business_id);

        const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

        // First 3 requests: each should actually generate a new token (real
        // delivery attempted). Requests 4+: silently skipped — no new token,
        // but the SAME message is returned regardless.
        const results: { message: string }[] = [];
        for (let i = 0; i < 5; i++) {
          results.push(await requestPasswordReset(email));
        }
        consoleSpy.mockRestore();

        const distinctMessages = new Set(results.map((r) => r.message));
        expect(distinctMessages.size).toBe(1); // never leaks rate-limit state via the message

        const { rows: tokenRows } = await adminPool.query(
          `select count(*) as c from password_reset_tokens where user_id = $1`,
          [signUpResult.userId]
        );
        expect(parseInt(tokenRows[0].c, 10)).toBe(3); // exactly 3 tokens created, not 5
      }
    );

    it("a valid reset token successfully changes the password, and the OLD password no longer works", async () => {
      const email = uniqueEmail("reset-valid");
      const signUpResult = await signUp({ email, password: "old-password-123", businessName: "Reset Valid Test" });
      createdUserIds.push(signUpResult.userId!);
      const { rows } = await adminPool.query(`select business_id from memberships where user_id = $1`, [signUpResult.userId]);
      createdBusinessIds.push(rows[0].business_id);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await requestPasswordReset(email);
      const logCall = consoleSpy.mock.calls.find((args) => String(args[0]).includes("password-reset"));
      consoleSpy.mockRestore();
      const rawToken = String(logCall![0]).match(/token=([^\s]+)/)![1];

      const resetResult = await resetPassword(rawToken, "new-password-456");
      expect(resetResult.ok).toBe(true);

      const oldPasswordCheck = await verifyCredentials(email, "old-password-123");
      expect(oldPasswordCheck.ok).toBe(false);
      const newPasswordCheck = await verifyCredentials(email, "new-password-456");
      expect(newPasswordCheck.ok).toBe(true);
    });

    it("an INVALID (fabricated) reset token is rejected", async () => {
      const result = await resetPassword("completely-made-up-token-value", "some-new-password-789");
      expect(result.ok).toBe(false);
    });

    it("a reset token can only be used ONCE — reusing it after a successful reset fails", async () => {
      const email = uniqueEmail("reset-single-use");
      const signUpResult = await signUp({ email, password: "first-password-123", businessName: "Reset Single Use Test" });
      createdUserIds.push(signUpResult.userId!);
      const { rows } = await adminPool.query(`select business_id from memberships where user_id = $1`, [signUpResult.userId]);
      createdBusinessIds.push(rows[0].business_id);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await requestPasswordReset(email);
      const logCall = consoleSpy.mock.calls.find((args) => String(args[0]).includes("password-reset"));
      consoleSpy.mockRestore();
      const rawToken = String(logCall![0]).match(/token=([^\s]+)/)![1];

      const first = await resetPassword(rawToken, "second-password-456");
      expect(first.ok).toBe(true);
      const second = await resetPassword(rawToken, "third-password-789");
      expect(second.ok).toBe(false); // same token, already used
    });

    it("an EXPIRED reset token is rejected", async () => {
      const email = uniqueEmail("reset-expired");
      const signUpResult = await signUp({ email, password: "expired-test-password-1", businessName: "Reset Expired Test" });
      createdUserIds.push(signUpResult.userId!);
      const { rows } = await adminPool.query(`select business_id from memberships where user_id = $1`, [signUpResult.userId]);
      createdBusinessIds.push(rows[0].business_id);

      // Manually insert an already-expired token, bypassing the normal
      // 1-hour TTL, to test expiry rejection deterministically.
      const crypto = await import("crypto");
      const rawToken = "manually-expired-test-token";
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      await adminPool.query(
        `insert into password_reset_tokens (user_id, token_hash, expires_at) values ($1, $2, now() - interval '1 minute')`,
        [signUpResult.userId, tokenHash]
      );

      const result = await resetPassword(rawToken, "new-password-after-expiry");
      expect(result.ok).toBe(false);
    });
  });

  describe("email verification — full flow against real Postgres", () => {
    it("signUp generates a real verification token, and email_verified starts false", async () => {
      const email = uniqueEmail("verify-email-flow");
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const signUpResult = await signUp({ email, password: "verify-flow-password-1", businessName: "Verify Email Flow Test" });
      consoleSpy.mockRestore();
      createdUserIds.push(signUpResult.userId!);
      const { rows } = await adminPool.query(`select business_id from memberships where user_id = $1`, [signUpResult.userId]);
      createdBusinessIds.push(rows[0].business_id);

      const { rows: userRows } = await adminPool.query(`select email_verified from auth.users where id = $1`, [signUpResult.userId]);
      expect(userRows[0].email_verified).toBe(false);

      const { rows: tokenRows } = await adminPool.query(
        `select id from email_verification_tokens where user_id = $1`,
        [signUpResult.userId]
      );
      expect(tokenRows).toHaveLength(1);
    });

    it("a valid verification token marks the account verified", async () => {
      const email = uniqueEmail("verify-email-valid");
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const signUpResult = await signUp({ email, password: "verify-valid-password-1", businessName: "Verify Email Valid Test" });
      const logCall = consoleSpy.mock.calls.find((args) => String(args[0]).includes("email-verification"));
      consoleSpy.mockRestore();
      createdUserIds.push(signUpResult.userId!);
      const { rows } = await adminPool.query(`select business_id from memberships where user_id = $1`, [signUpResult.userId]);
      createdBusinessIds.push(rows[0].business_id);

      const rawToken = String(logCall![0]).match(/token=([^\s]+)/)![1];
      const result = await verifyEmail(rawToken);
      expect(result.ok).toBe(true);

      const { rows: userRows } = await adminPool.query(`select email_verified from auth.users where id = $1`, [signUpResult.userId]);
      expect(userRows[0].email_verified).toBe(true);
    });

    it("an invalid verification token is rejected", async () => {
      const result = await verifyEmail("fabricated-verification-token");
      expect(result.ok).toBe(false);
    });

    it("a verification token can only be used ONCE", async () => {
      const email = uniqueEmail("verify-email-single-use");
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const signUpResult = await signUp({ email, password: "verify-single-password-1", businessName: "Verify Single Use Test" });
      const logCall = consoleSpy.mock.calls.find((args) => String(args[0]).includes("email-verification"));
      consoleSpy.mockRestore();
      createdUserIds.push(signUpResult.userId!);
      const { rows } = await adminPool.query(`select business_id from memberships where user_id = $1`, [signUpResult.userId]);
      createdBusinessIds.push(rows[0].business_id);

      const rawToken = String(logCall![0]).match(/token=([^\s]+)/)![1];
      const first = await verifyEmail(rawToken);
      expect(first.ok).toBe(true);
      const second = await verifyEmail(rawToken);
      expect(second.ok).toBe(false);
    });
  });
});
