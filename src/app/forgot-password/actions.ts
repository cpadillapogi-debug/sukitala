"use server";

import { requestPasswordReset } from "@/lib/auth/provider";

export async function forgotPasswordAction(email: string): Promise<{ message: string }> {
  return requestPasswordReset(email);
}
