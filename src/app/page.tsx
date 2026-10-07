import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-6 p-6 text-center">
      <h1 className="text-2xl font-bold text-gray-900">SukiTala</h1>
      <p className="text-gray-600">
        Know exactly how much business cash you can safely spend today.
      </p>
      <Link
        href="/dashboard"
        className="rounded-xl bg-emerald-600 px-6 py-3 font-medium text-white shadow"
      >
        View demo dashboard
      </Link>
    </main>
  );
}
