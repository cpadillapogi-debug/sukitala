"use server";

import { resetPassword } from "@/lib/auth/provider";

export async function resetPasswordAction(token: string, newPassword: string): Promise<{ ok: boolean; message: string }> {
  return resetPassword(token, newPassword);
}
