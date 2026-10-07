"use server";

import { signOut } from "@/lib/auth/provider";

export async function signOutAction(): Promise<void> {
  await signOut();
}
