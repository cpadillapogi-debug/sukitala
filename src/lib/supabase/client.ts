import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for browser/client-component use. NOT currently active —
 * see ARCHITECTURE.md "Authentication" for why: no live Supabase project
 * is reachable from the environment this was built in (no network path, no
 * credentials), so this has never been run against a real project. It only
 * receives the public/publishable anon key, never the service-role key —
 * that's enforced by which env vars this reads (both are meant to be
 * public/embeddable in the browser bundle by design).
 *
 * Throws clearly if the required env vars aren't set, rather than
 * constructing a client that would fail confusingly later.
 */
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set. " +
        "This scaffold has no live Supabase project connected — see .env.example and " +
        "ARCHITECTURE.md 'Authentication' for what's required before this client can be used."
    );
  }
  return createBrowserClient(url, anonKey);
}
