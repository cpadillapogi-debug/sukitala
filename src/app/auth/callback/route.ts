import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Standard Supabase SSR pattern: email confirmation links and password
 * recovery links redirect here with a `code` query param, which must be
 * exchanged for a session before the user lands on the intended page
 * (dashboard, or /reset-password for recovery).
 *
 * UNVERIFIED — like the rest of the Supabase branch, this has never
 * executed against a real project (no credentials/network path exist
 * here). It exists so the activation switch (src/lib/auth/provider.ts)
 * has everywhere it needs once real credentials are configured — without
 * this route, Supabase's own email verification and password reset links
 * would have nowhere to land. See SUPABASE_SETUP.md.
 *
 * This route only does anything when Supabase is configured; if it's hit
 * without configuration (shouldn't happen in practice, since nothing
 * generates links to it without Supabase being active), it fails closed by
 * redirecting to /login rather than throwing an unhandled error.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.redirect(`${origin}/login`);
  }

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
