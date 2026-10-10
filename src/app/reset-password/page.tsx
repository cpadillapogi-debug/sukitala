"use client";

import { Suspense, useState, useTransition } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { resetPasswordAction } from "./actions";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await resetPasswordAction(token, password);
      setResult(r);
      if (r.ok) {
        setTimeout(() => router.push("/login"), 1500);
      }
    });
  }

  if (!token) {
    return <p className="text-sm text-red-600">No reset token found in the link. Please request a new one.</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="text-xs text-gray-500">New password (min. 8 characters)</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
          className="mt-1 w-full rounded-lg border border-gray-300 p-2.5 text-sm"
        />
      </div>
      {result && (
        <p className={`text-sm ${result.ok ? "text-emerald-700" : "text-red-600"}`}>{result.message}</p>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-lg bg-emerald-600 py-2.5 font-medium text-white disabled:opacity-50"
      >
        {isPending ? "Updating..." : "Update password"}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-bold text-gray-900">Set a new password</h1>
      <Suspense fallback={<p className="text-sm text-gray-500">Loading...</p>}>
        <ResetPasswordForm />
      </Suspense>
      <p className="text-center text-sm text-gray-500">
        <Link href="/login" className="text-emerald-700 underline">
          Back to sign in
        </Link>
      </p>
    </main>
  );
}
