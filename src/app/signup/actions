"use server";

import { signUp, signIn, isSupabaseConfigured } from "@/lib/auth/provider";

export interface SignUpFormResult {
  ok: boolean;
  message: string;
}

export async function signUpAction(formData: {
  email: string;
  password: string;
  businessName: string;
}): Promise<SignUpFormResult> {
  const result = await signUp(formData);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  // Sign the new user straight in. For the local stand-in this always
  // works (no email verification gate exists there). For real Supabase
  // Auth (see provider.ts), if the connected project requires email
  // confirmation, this sign-in attempt will correctly fail until the user
  // confirms — that's Supabase's real behavior, not a bug in this code,
  // but it has never been exercised against a live project, so the exact
  // error message/UX here is unverified. See KNOWN_LIMITATIONS.md.
  const signInResult = await signIn(formData.email, formData.password);
  if (!signInResult.ok) {
    return {
      ok: false,
      message: isSupabaseConfigured()
        ? "Account created. If email confirmation is required, please check your inbox before signing in."
        : "Account created, but sign-in failed — please try logging in manually.",
    };
  }
  return { ok: true, message: "Account created." };
}
