import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { verifySessionToken } from "@/lib/auth/session";

/**
 * Protects private routes at the edge, before any page component runs.
 * Provider-aware, matching the dispatcher pattern in src/lib/auth/provider.ts:
 * when real Supabase credentials are configured, this uses the actual
 * @supabase/ssr middleware pattern (refreshing the session and verifying it
 * via supabase.auth.getUser()); otherwise it falls back to the local
 * signed-token check unchanged.
 *
 * IMPORTANT, stated plainly: the Supabase branch below has never executed
 * against a real project (no credentials/network path exist in the
 * environment this was built in) — it's written to the current documented
 * @supabase/ssr pattern but is unverified. The local branch is the one
 * that's actually been tested end-to-end (including via live HTTP smoke
 * tests) and remains what runs by default. See SUPABASE_SETUP.md and
 * KNOWN_LIMITATIONS.md.
 *
 * Either way, this middleware is defense-in-depth / UX (redirect early),
 * not the sole enforcement mechanism — the real authorization boundary is
 * server-side in sessionContext.ts/dashboardData.ts (which call through
 * provider.ts, the same dispatcher) for every actual data read.
 */

const PROTECTED_PATHS = ["/dashboard", "/quick-add", "/utang"];
const SESSION_COOKIE_NAME = "kiracash_session";

function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

async function checkSupabaseSession(request: NextRequest, response: NextResponse): Promise<boolean> {
  // Current @supabase/ssr middleware pattern: a server client backed by the
  // request/response cookie pair, refreshing the session as a side effect
  // of calling getUser(). UNVERIFIED against a real project — see the
  // module-level comment above.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );
  const { data, error } = await supabase.auth.getUser();
  return !error && Boolean(data.user);
}

function checkLocalSession(request: NextRequest): boolean {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  return verifySessionToken(token) !== null;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isProtected) return NextResponse.next();

  let response = NextResponse.next();
  const authenticated = isSupabaseConfigured()
    ? await checkSupabaseSession(request, response)
    : checkLocalSession(request);

  if (!authenticated) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirectTo", pathname);
    response = NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/quick-add/:path*", "/utang/:path*"],
  // Node.js runtime, not Edge: the local branch's verifySessionToken() uses
  // Node's `crypto` module (createHmac, timingSafeEqual), which the Edge
  // runtime doesn't support. Next.js 16 supports this via runtime: "nodejs".
  runtime: "nodejs",
};
