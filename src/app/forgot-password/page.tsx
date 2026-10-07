"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { forgotPasswordAction } from "./actions";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await forgotPasswordAction(email);
      setMessage(result.message);
    });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-bold text-gray-900">Reset your password</h1>
      <p className="text-sm text-gray-500">
        No real email is sent in this environment (see KNOWN_LIMITATIONS.md) — the reset link is
        logged to the server console instead.
      </p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="text-xs text-gray-500">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-gray-300 p-2.5 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-lg bg-emerald-600 py-2.5 font-medium text-white disabled:opacity-50"
        >
          {isPending ? "Sending..." : "Send reset link"}
        </button>
      </form>
      {message && <p className="text-sm text-gray-700">{message}</p>}
      <p className="text-center text-sm text-gray-500">
        <Link href="/login" className="text-emerald-700 underline">
          Back to sign in
        </Link>
      </p>
    </main>
  );
}
