import * as localAuth from "./authService";
import * as supabaseAuth from "./supabaseAuthAdapter";

/**
 * THE ACTIVATION SWITCH. Every auth entry point (signup/login/logout/
 * session pages) calls through THIS module, not authService.ts or
 * supabaseAuthAdapter.ts directly — this is what makes Supabase Auth a
 * real, wired path rather than a dormant unused file (see git history:
 * previously nothing imported supabaseAuthAdapter.ts at all).
 *
 * isSupabaseConfigured() is the entire decision: if real Supabase
 * credentials are present, every call below genuinely routes to Supabase
 * Auth. If not — which is the case in every environment this scaffold has
 * been built and tested in so far, since no live Supabase project has ever
 * been reachable here — it routes to the local stand-in, unchanged.
 *
 * IMPORTANT, stated plainly: the Supabase branch below has NEVER executed
 * against a real project. isSupabaseConfigured() and the dispatch logic
 * itself are unit-tested (see provider.test.ts); the actual Supabase
 * network calls inside supabaseAuthAdapter.ts are not, and cannot be,
 * verified without real credentials. See SUPABASE_SETUP.md for exactly
 * what's required to close that gap, and KNOWN_LIMITATIONS.md for the
 * honest current status.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export interface AuthProviderSignUpResult {
  ok: boolean;
  message: string;
  userId?: string;
}

export async function signUp(params: {
  email: string;
  password: string;
  businessName: string;
}): Promise<AuthProviderSignUpResult> {
  if (isSupabaseConfigured()) {
    return supabaseAuth.supabaseSignUp(params);
  }
  return localAuth.signUp(params);
}

export interface AuthProviderSignInResult {
  ok: boolean;
  message: string;
}

export async function signIn(email: string, password: string): Promise<AuthProviderSignInResult> {
  if (isSupabaseConfigured()) {
    return supabaseAuth.supabaseSignIn(email, password);
  }
  return localAuth.signIn(email, password);
}

export async function signOut(): Promise<void> {
  if (isSupabaseConfigured()) {
    return supabaseAuth.supabaseSignOut();
  }
  return localAuth.signOut();
}

export async function getCurrentUserId(): Promise<string | null> {
  if (isSupabaseConfigured()) {
    return supabaseAuth.supabaseGetCurrentUserId();
  }
  return localAuth.getCurrentUserId();
}

export async function requestPasswordReset(email: string): Promise<{ message: string }> {
  if (isSupabaseConfigured()) {
    return supabaseAuth.supabaseRequestPasswordReset(email);
  }
  return localAuth.requestPasswordReset(email);
}

/**
 * Completes a password reset. The two providers' completion mechanisms
 * genuinely differ in shape, not just implementation: the local stand-in
 * needs the raw token (it has no session yet — the token IS the proof of
 * identity); Supabase's flow already established a recovery session via
 * /auth/callback before the user reached this point, so no token is
 * needed or used for that branch. `token` is nullable specifically to
 * reflect that — pass whatever the local flow's URL query param gave you
 * (or null under Supabase, where there isn't one).
 */
export async function resetPassword(
  token: string | null,
  newPassword: string
): Promise<{ ok: boolean; message: string }> {
  if (isSupabaseConfigured()) {
    return supabaseAuth.supabaseResetPassword(newPassword);
  }
  if (!token) {
    return { ok: false, message: "No reset token found in the link. Please request a new one." };
  }
  return localAuth.resetPassword(token, newPassword);
}

/**
 * Email verification is NOT unified — under Supabase, verification is
 * handled implicitly by /auth/callback (following the confirmation link
 * exchanges the code and marks the account confirmed as a side effect;
 * there is no separate "call verifyEmail()" step the way the local
 * stand-in requires). The local stand-in's verifyEmail() remains the only
 * explicit-token verification path, used only when Supabase isn't
 * configured. See KNOWN_LIMITATIONS.md.
 */
export const verifyEmail = localAuth.verifyEmail;
