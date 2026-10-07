import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests the DISPATCH LOGIC itself — "given these env vars, which
 * implementation gets called" — without ever executing a real Supabase
 * network call (impossible here; no credentials/network path exists). The
 * two branches (local vs. Supabase) are mocked at the module level so this
 * test proves the SWITCH works correctly, which is the part that's
 * actually new and testable. It does NOT prove supabaseAuthAdapter.ts's
 * Supabase calls work against a real project — nothing in this repository
 * can prove that. See KNOWN_LIMITATIONS.md.
 */

const {
  localSignUp,
  localSignIn,
  localSignOut,
  localGetCurrentUserId,
  localRequestPasswordReset,
  localResetPassword,
  supabaseSignUp,
  supabaseSignIn,
  supabaseSignOut,
  supabaseGetCurrentUserId,
  supabaseRequestPasswordReset,
  supabaseResetPassword,
} = vi.hoisted(() => ({
  localSignUp: vi.fn().mockResolvedValue({ ok: true, message: "local signup" }),
  localSignIn: vi.fn().mockResolvedValue({ ok: true, message: "local signin" }),
  localSignOut: vi.fn().mockResolvedValue(undefined),
  localGetCurrentUserId: vi.fn().mockResolvedValue("local-user-id"),
  localRequestPasswordReset: vi.fn().mockResolvedValue({ message: "local reset requested" }),
  localResetPassword: vi.fn().mockResolvedValue({ ok: true, message: "local reset done" }),
  supabaseSignUp: vi.fn().mockResolvedValue({ ok: true, message: "supabase signup" }),
  supabaseSignIn: vi.fn().mockResolvedValue({ ok: true, message: "supabase signin" }),
  supabaseSignOut: vi.fn().mockResolvedValue(undefined),
  supabaseGetCurrentUserId: vi.fn().mockResolvedValue("supabase-user-id"),
  supabaseRequestPasswordReset: vi.fn().mockResolvedValue({ message: "supabase reset requested" }),
  supabaseResetPassword: vi.fn().mockResolvedValue({ ok: true, message: "supabase reset done" }),
}));

vi.mock("./authService", () => ({
  signUp: localSignUp,
  signIn: localSignIn,
  signOut: localSignOut,
  getCurrentUserId: localGetCurrentUserId,
  requestPasswordReset: localRequestPasswordReset,
  resetPassword: localResetPassword,
  verifyEmail: vi.fn(),
}));

vi.mock("./supabaseAuthAdapter", () => ({
  supabaseSignUp,
  supabaseSignIn,
  supabaseSignOut,
  supabaseGetCurrentUserId,
  supabaseRequestPasswordReset,
  supabaseResetPassword,
}));

describe("auth provider dispatcher", () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  afterEach(() => {
    if (originalUrl) process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalKey) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
  });

  it("isSupabaseConfigured() is false when no Supabase env vars are set", async () => {
    const { isSupabaseConfigured } = await import("./provider");
    expect(isSupabaseConfigured()).toBe(false);
  });

  it("isSupabaseConfigured() is false with only URL set, no anon key", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    const { isSupabaseConfigured } = await import("./provider");
    expect(isSupabaseConfigured()).toBe(false);
  });

  it("isSupabaseConfigured() is true when BOTH URL and anon key are set", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    const { isSupabaseConfigured } = await import("./provider");
    expect(isSupabaseConfigured()).toBe(true);
  });

  it("routes signUp/signIn/signOut/getCurrentUserId to the LOCAL adapter when Supabase is not configured (the current, real, default state of this environment)", async () => {
    const provider = await import("./provider");
    await provider.signUp({ email: "a@b.com", password: "pw", businessName: "Biz" });
    await provider.signIn("a@b.com", "pw");
    await provider.signOut();
    await provider.getCurrentUserId();

    expect(localSignUp).toHaveBeenCalledTimes(1);
    expect(localSignIn).toHaveBeenCalledTimes(1);
    expect(localSignOut).toHaveBeenCalledTimes(1);
    expect(localGetCurrentUserId).toHaveBeenCalledTimes(1);
    expect(supabaseSignUp).not.toHaveBeenCalled();
    expect(supabaseSignIn).not.toHaveBeenCalled();
    expect(supabaseSignOut).not.toHaveBeenCalled();
    expect(supabaseGetCurrentUserId).not.toHaveBeenCalled();
  });

  it("routes signUp/signIn/signOut/getCurrentUserId to the SUPABASE adapter when both env vars ARE set — proving the switch itself genuinely activates", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    const provider = await import("./provider");

    await provider.signUp({ email: "a@b.com", password: "pw", businessName: "Biz" });
    await provider.signIn("a@b.com", "pw");
    await provider.signOut();
    await provider.getCurrentUserId();

    expect(supabaseSignUp).toHaveBeenCalledTimes(1);
    expect(supabaseSignIn).toHaveBeenCalledTimes(1);
    expect(supabaseSignOut).toHaveBeenCalledTimes(1);
    expect(supabaseGetCurrentUserId).toHaveBeenCalledTimes(1);
    expect(localSignUp).not.toHaveBeenCalled();
    expect(localSignIn).not.toHaveBeenCalled();
    expect(localSignOut).not.toHaveBeenCalled();
    expect(localGetCurrentUserId).not.toHaveBeenCalled();
  });

  it("routes requestPasswordReset to LOCAL when Supabase is not configured", async () => {
    const provider = await import("./provider");
    await provider.requestPasswordReset("a@b.com");
    expect(localRequestPasswordReset).toHaveBeenCalledTimes(1);
    expect(supabaseRequestPasswordReset).not.toHaveBeenCalled();
  });

  it("routes requestPasswordReset to SUPABASE when configured", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    const provider = await import("./provider");
    await provider.requestPasswordReset("a@b.com");
    expect(supabaseRequestPasswordReset).toHaveBeenCalledTimes(1);
    expect(localRequestPasswordReset).not.toHaveBeenCalled();
  });

  it("resetPassword routes to LOCAL with the token when Supabase is not configured", async () => {
    const provider = await import("./provider");
    await provider.resetPassword("some-raw-token", "new-password");
    expect(localResetPassword).toHaveBeenCalledWith("some-raw-token", "new-password");
    expect(supabaseResetPassword).not.toHaveBeenCalled();
  });

  it("resetPassword routes to SUPABASE (ignoring the token — no token concept there) when configured", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    const provider = await import("./provider");
    await provider.resetPassword(null, "new-password");
    expect(supabaseResetPassword).toHaveBeenCalledWith("new-password");
    expect(localResetPassword).not.toHaveBeenCalled();
  });

  it("resetPassword with a null token under the LOCAL provider fails cleanly instead of calling the local implementation with a bad value", async () => {
    const provider = await import("./provider");
    const result = await provider.resetPassword(null, "new-password");
    expect(result.ok).toBe(false);
    expect(localResetPassword).not.toHaveBeenCalled();
  });
});
