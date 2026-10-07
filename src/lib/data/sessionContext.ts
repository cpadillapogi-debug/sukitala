import { getCashAccounts, getPrimaryBusinessIdForUser } from "@/lib/data/finance";
import { getCurrentUserId } from "@/lib/auth/provider";

/**
 * Resolves (userId, businessId, a default accountId) for server actions
 * from the REAL authenticated session — replaces the old
 * KIRACASH_DEV_USER_ID env-var placeholder (see git history / session 7 in
 * KIRACASH_IMPLEMENTATION_PLAN.md for what that looked like and why it was
 * a real, documented security gap once auth existed to compare it against).
 *
 * Every server action that mutates or reads business data goes through
 * this rather than resolving identity itself, so there's exactly one place
 * that changes when auth architecture changes again (e.g. real Supabase
 * Auth) — see src/lib/auth/authService.ts's getCurrentUserId().
 */
export interface SessionContext {
  ok: true;
  userId: string;
  businessId: string;
  accountId: string;
}
export interface SessionContextError {
  ok: false;
  message: string;
  /** True when the caller should be redirected to /login rather than shown an inline error. */
  requiresAuth?: boolean;
}

export async function resolveSessionContext(): Promise<SessionContext | SessionContextError> {
  if (!process.env.DATABASE_URL) {
    return { ok: false, message: "No database connected in this environment — nothing can be saved yet." };
  }

  const userId = await getCurrentUserId();
  if (!userId) {
    return { ok: false, message: "Please sign in.", requiresAuth: true };
  }

  const businessId = await getPrimaryBusinessIdForUser(userId);
  if (!businessId) {
    return { ok: false, message: "Your account isn't linked to a business yet — this shouldn't happen after signup; please contact support." };
  }

  const accounts = await getCashAccounts(userId, businessId);
  if (accounts.length === 0) {
    return { ok: false, message: "No cash account exists for this business yet — add one first." };
  }
  // Simplification: uses the business's first account. Real account
  // selection needs UI for the user to confirm/pick — see
  // KNOWN_LIMITATIONS.md.
  return { ok: true, userId, businessId, accountId: accounts[0].id };
}
