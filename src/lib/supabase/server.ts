import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase client for server components/actions, wired to Next.js's cookie
 * store per the current @supabase/ssr pattern. NOT currently active — same
 * reasoning as client.ts: no live Supabase project has ever been reachable
 * from this environment, so this has never been exercised against a real
 * project. Uses only the anon key (RLS-respecting, like withUserContext()/
 * app_user in the local stand-in) — never the service-role key, which
 * would bypass RLS and must stay server-only under a completely separate
 * accessor (see supabaseAdmin.ts) if ever used at all.
 */
export async function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set. " +
        "This scaffold has no live Supabase project connected — see .env.example and " +
        "ARCHITECTURE.md 'Authentication' for what's required before this client can be used."
    );
  }
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // In a Server Component (not a Server Action/Route Handler), this
        // throws — @supabase/ssr's documented pattern is to catch and
        // ignore it there, relying on middleware to refresh the session
        // cookie instead. See middleware.ts's TODO for where that refresh
        // logic would need to be added once this is actually wired up.
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Expected in Server Components — see comment above.
        }
      },
    },
  });
}
