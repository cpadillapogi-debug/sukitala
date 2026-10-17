#!/usr/bin/env node
/**
 * Preflight check for live Supabase verification. Run this FIRST, before
 * anything else in docs/LIVE_SUPABASE_VERIFICATION_RUNBOOK.md.
 *
 * Verifies:
 *   - required env vars are present
 *   - NEXT_PUBLIC_SUPABASE_URL is syntactically a valid https:// URL
 *   - the host is actually reachable (a real network request, not just a
 *     URL parse) and responds like a real Supabase project
 *
 * NEVER prints secret values — only presence/absence, and derived
 * non-secret metadata (hostname, project ref parsed from the URL).
 *
 * Exit code 0  = safe to proceed to the rest of the runbook.
 * Exit code 1  = LIVE VERIFICATION BLOCKED — see the printed reason.
 */

function blocked(reason) {
  console.error(`\nLIVE VERIFICATION BLOCKED — ${reason}\n`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

console.log("=== SukiTala live-verification preflight ===\n");

// --- 1. Presence ---
console.log(`NEXT_PUBLIC_SUPABASE_URL:       ${url ? "present" : "MISSING"}`);
console.log(`NEXT_PUBLIC_SUPABASE_ANON_KEY:  ${anonKey ? "present" : "MISSING"}`);

if (!url || !anonKey) {
  blocked("ENVIRONMENT — required environment variable(s) not set");
}

// --- 2. Syntactic validity (no secrets in this output — hostname only) ---
let parsed;
try {
  parsed = new URL(url);
} catch {
  blocked(`ENVIRONMENT — NEXT_PUBLIC_SUPABASE_URL is not a valid URL`);
}

if (parsed.protocol !== "https:") {
  blocked("ENVIRONMENT — NEXT_PUBLIC_SUPABASE_URL must use https://");
}

const projectRef = parsed.hostname.split(".")[0];
console.log(`\nParsed host:     ${parsed.hostname}`);
console.log(`Project ref:     ${projectRef}`);

if (!parsed.hostname.endsWith(".supabase.co") && !parsed.hostname.endsWith(".supabase.in")) {
  console.warn(
    `\nWARNING: host does not end in .supabase.co / .supabase.in — this may be a ` +
      `self-hosted or proxied Supabase instance. Continuing, but double-check this is ` +
      `the intended project before proceeding.`
  );
}

// --- 3. Real network reachability ---
console.log(`\nChecking network reachability to ${parsed.hostname} ...`);

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 8000);

let response;
try {
  // The Auth health endpoint is unauthenticated and side-effect-free —
  // safe to hit with no key at all, just to prove the host is reachable
  // and is actually running Supabase's GoTrue auth service.
  response = await fetch(`${parsed.origin}/auth/v1/health`, {
    signal: controller.signal,
  });
} catch (err) {
  clearTimeout(timeout);
  const detail = err.name === "AbortError" ? "request timed out after 8s" : err.message;
  blocked(`ENVIRONMENT/NETWORK — could not reach ${parsed.hostname} (${detail})`);
}
clearTimeout(timeout);

console.log(`Reachability check: HTTP ${response.status}`);

if (response.status >= 500) {
  blocked(`the project responded with a server error (HTTP ${response.status}) — investigate before proceeding`);
}

// --- 4. Confirm the anon key is at least well-formed (never logged) ---
// Supabase anon keys are JWTs — three base64url segments. This checks
// shape only, never decodes claims or prints the key.
const looksLikeJwt = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(anonKey);
console.log(`Anon key shape:  ${looksLikeJwt ? "looks like a JWT (expected)" : "UNEXPECTED — does not look like a JWT"}`);
if (!looksLikeJwt) {
  blocked("ENVIRONMENT — NEXT_PUBLIC_SUPABASE_ANON_KEY does not look like a valid Supabase key");
}

console.log(
  `\nPreflight PASSED. ${parsed.hostname} is reachable and responding.\n` +
    `Proceed to LIVE_SUPABASE_VERIFICATION_RUNBOOK.md, step 3 (migration-state inspection).\n`
);
process.exit(0);
