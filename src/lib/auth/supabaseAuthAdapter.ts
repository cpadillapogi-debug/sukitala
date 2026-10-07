import { createSupabaseServerClient } from "../supabase/server";

/**
 * A Supabase Auth implementation of the same interface as authService.ts
 * (signUp/signIn/signOut/getCurrentUserId/requestPasswordReset). This is
 * prepared architecture, NOT an active code path — it has NEVER been run
 * against a real Supabase project, because none is reachable from this
 * environment (no network path, no credentials). Per this milestone's own
 * rules ("do not claim Supabase integration is complete without actually
 * testing it," "do not replace working functionality unnecessarily"), the
 * currently ACTIVE, tested authentication remains authService.ts's local
 * stand-in — nothing imports this file in a live code path.
 *
 * To actually activate this once real credentials exist:
 *   1. Set NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.
 *   2. Run db/migrations/0001-0003 and 0006 against the real project
 *      (skip db/local-dev/*.sql — those are the local stand-in's own
 *      tables, which Supabase doesn't need: Supabase Auth handles
 *      sessions/rate-limiting/password-reset/email-verification itself).
 *   3. Point sessionContext.ts's imports at this file's functions instead
 *      of authService.ts's, and update middleware.ts to use
 *      @supabase/ssr's session-refresh pattern instead of
 *      verifySessionToken().
 *   4. RUN THE ACTUAL TEST SUITE AGAINST IT before trusting any of this —
 *      untested code, however carefully written, is not verified code.
 *
 * signUp() below demonstrates the self-serve business/membership creation
 * pattern enabled by db/migrations/0006_self_serve_signup_rls.sql: a
 * client-generated business id, inserted explicitly without RETURNING
 * (avoiding the RETURNING-requires-SELECT-policy chicken-and-egg problem
 * documented in that migration and proven in db/local-dev/test-rls.sh).
 */

export interface SupabaseSignUpResult {
  ok: boolean;
  message: string;
  userId?: string;
}

export async function supabaseSignUp(params: {
  email: string;
  password: string;
  businessName: string;
}): Promise<SupabaseSignUpResult> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.auth.signUp({
    email: params.email.trim().toLowerCase(),
    password: params.password,
  });
  if (error || !data.user) {
    return { ok: false, message: error?.message ?? "Sign up failed." };
  }

  // Self-serve business/membership creation under the user's OWN
  // just-established session (RLS-respecting) — see the migration note
  // above for why this specific insert pattern (no RETURNING, client-
  // generated id) is required.
  const businessId = crypto.randomUUID();
  const { error: businessError } = await supabase
    .from("businesses")
    .insert({ id: businessId, name: params.businessName.trim() });
  if (businessError) {
    return { ok: false, message: `Account created but business setup failed: ${businessError.message}` };
  }

  const { error: membershipError } = await supabase
    .from("memberships")
    .insert({ business_id: businessId, user_id: data.user.id, role: "OWNER" });
  if (membershipError) {
    return { ok: false, message: `Account created but membership setup failed: ${membershipError.message}` };
  }

  return { ok: true, message: "Account created.", userId: data.user.id };
}

export interface SupabaseSignInResult {
  ok: boolean;
  message: string;
}

export async function supabaseSignIn(email: string, password: string): Promise<SupabaseSignInResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  // Supabase Auth's own error messages are already generic for bad
  // credentials ("Invalid login credentials") — no additional
  // generic-message wrapping needed here, unlike the local stand-in, which
  // had to build that property itself.
  if (error) {
    return { ok: false, message: error.message };
  }
  return { ok: true, message: "Signed in." };
}

export async function supabaseSignOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
}

export async function supabaseGetCurrentUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
}

export async function supabaseRequestPasswordReset(email: string): Promise<{ message: string }> {
  const supabase = await createSupabaseServerClient();
  // Supabase Auth's resetPasswordForEmail already returns a generic
  // response regardless of whether the email exists — matching the local
  // stand-in's explicit anti-enumeration design, but provided natively
  // here rather than hand-built.
  await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    // Routes through /auth/callback first, per the standard Supabase SSR
    // pattern — the recovery link carries a `code` that must be exchanged
    // for a session before /reset-password can call updateUser().
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/auth/callback?next=/reset-password`,
  });
  return { message: "If an account with that email exists, a reset link has been sent." };
}

/**
 * Completes a password reset. Unlike the local stand-in, this takes NO
 * token argument — /auth/callback already exchanged the recovery link's
 * code for an authenticated (recovery-scoped) session before the user
 * reached /reset-password, so this just updates the password on that
 * already-established session. Requires the recovery session to actually
 * be present (i.e. the callback exchange succeeded); if not, this fails
 * with Supabase's own "not authenticated" error rather than silently
 * doing nothing.
 */
export async function supabaseResetPassword(newPassword: string): Promise<{ ok: boolean; message: string }> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    return { ok: false, message: error.message };
  }
  return { ok: true, message: "Password updated. Please sign in with your new password." };
}
