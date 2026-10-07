"use server";

import { verifyEmail } from "@/lib/auth/provider";

export async function verifyEmailAction(token: string): Promise<{ ok: boolean; message: string }> {
  return verifyEmail(token);
}
