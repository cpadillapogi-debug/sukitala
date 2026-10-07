"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { verifyEmailAction } from "./actions";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!token) return;
    verifyEmailAction(token).then(setResult);
  }, [token]);

  if (!token) {
    return <p className="text-sm text-red-600">No verification token found in the link.</p>;
  }
  if (!result) {
    return <p className="text-sm text-gray-500">Verifying...</p>;
  }
  return <p className={`text-sm ${result.ok ? "text-emerald-700" : "text-red-600"}`}>{result.message}</p>;
}

export default function VerifyEmailPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-bold text-gray-900">Email verification</h1>
      <Suspense fallback={<p className="text-sm text-gray-500">Loading...</p>}>
        <VerifyEmailContent />
      </Suspense>
      <p className="text-center text-sm text-gray-500">
        <Link href="/dashboard" className="text-emerald-700 underline">
          Go to dashboard
        </Link>
      </p>
    </main>
  );
}
