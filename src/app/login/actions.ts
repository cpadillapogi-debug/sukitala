"use server";

import { signIn } from "@/lib/auth/provider";

export interface SignInFormResult {
  ok: boolean;
  message: string;
}

export async function signInAction(email: string, password: string): Promise<SignInFormResult> {
  return signIn(email, password);
}
