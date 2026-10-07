import { Pool, type PoolClient } from "pg";

/**
 * Connection pool. In production (real Supabase), DATABASE_URL points at
 * your Supabase project's Postgres connection string, and the app should
 * connect using the `authenticated` role's credentials (via Supabase's
 * connection pooler + a user JWT, typically through supabase-js instead of
 * raw `pg` — see README "Swapping this for supabase-js"). This raw-pg
 * version exists so the data layer is independently testable against local
 * Postgres in this scaffold, per DATABASE.md.
 */
let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new DataLayerError(
        "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in, " +
          "or see db/local-dev/README.md to run against a local Postgres instance."
      );
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

export class DataLayerError extends Error {}

/**
 * Runs `fn` with a client whose session has kiracash.test_user_id set for
 * RLS to key off (see db/local-dev/0000_auth_shim.sql). In real Supabase,
 * auth.uid() comes from the request's verified JWT instead — this
 * `userId` parameter is what a real integration would get from
 * `supabase.auth.getUser()`, not from a value the caller can fabricate.
 *
 * CRITICAL: every query that touches business data MUST go through this
 * function. There is no other sanctioned way to get a client from this
 * module — see the missing export of `getPool`/`Pool` itself.
 *
 * The userId passed here MUST come from a verified session (see
 * src/lib/auth/session.ts) — never from a request body, query param, or any
 * other value a client could set directly. See SECURITY.md.
 */
export async function withUserContext<T>(
  userId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("select set_config('kiracash.test_user_id', $1, false)", [userId]);
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * Admin/superuser connection pool — BYPASSES RLS ENTIRELY. In real
 * Supabase, this maps to the `service_role` key/connection, which must
 * NEVER be sent to the client or used in any 'use client' file (see
 * SECURITY.md). Every query run through this pool is fully trusted and
 * unscoped by tenant — the caller is responsible for its own authorization.
 *
 * Used ONLY by:
 *   - src/lib/auth/authService.ts, for signup (creating auth.users +
 *     local_auth_credentials + business + membership before any session
 *     exists) and login (reading local_auth_credentials to verify a
 *     password — this IS the step that establishes identity, so it can't
 *     itself be gated by an identity that doesn't exist yet)
 *   - test fixture setup/teardown in *.integration.test.ts (seeding two
 *     separate tenants to prove cross-tenant isolation)
 *
 * NEVER use this for ordinary business-data reads/writes — those go
 * through withUserContext() so RLS is the actual enforcement, not
 * "we trust this code path."
 */
let adminPool: Pool | null = null;

export function getAdminPool(): Pool {
  if (!adminPool) {
    const connectionString = process.env.ADMIN_DATABASE_URL;
    if (!connectionString) {
      throw new DataLayerError(
        "ADMIN_DATABASE_URL is not set. This is required for signup/login (see " +
          "src/lib/auth/authService.ts) and must point at a privileged/superuser " +
          "connection — in real Supabase, the service_role connection. See .env.example."
      );
    }
    adminPool = new Pool({ connectionString });
  }
  return adminPool;
}
