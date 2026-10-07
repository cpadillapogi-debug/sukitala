# KiraCash — Transfer Package

## 1. What checkpoint this represents

This ZIP is an exact snapshot of the KiraCash repository at git commit:

```
56b6f5301366d1960154842f7f3df5b835ff092a
```

That commit is the "live Supabase verification handoff package" milestone —
it includes the full application, all 11 database migrations, the complete
local security-hardening history (tenant isolation, `is_business_member()`
pg_temp fix, financial-integrity validation, rate limiting, dependency
upgrades), and the docs/scripts for running live verification against a
real Supabase project. It does **not** include anything from after this
commit — nothing has been added or changed since it was packaged.

This is a plain `git archive` of that commit (plus this README and
`.env.example`, added on top — see section 8 below for why). It contains
exactly the tracked files at that commit; nothing more, nothing less.

## 2. How to extract it

```bash
unzip kiracash-checkpoint-56b6f53.zip -d kiracash
cd kiracash
```

## 3. How to install dependencies

```bash
npm install
```

Requires Node.js (see `package.json` for the Next.js/React versions this
was built against) and, for local development/testing, a local Postgres 16
instance — see `db/local-dev/README.md` for the exact setup steps (roles,
migrations, seed data).

## 4. How to run the existing tests

Unit tests only (no database needed):

```bash
npm run test
```

Full suite including integration tests (needs local Postgres — see
`db/local-dev/README.md` first):

```bash
export DATABASE_URL="postgres://app_user:<password>@localhost:5432/kiracash"
export ADMIN_DATABASE_URL="postgres://kiracash:<password>@localhost:5432/kiracash"
export TEST_ADMIN_DATABASE_URL="$ADMIN_DATABASE_URL"
npm run test
npm run db:test-rls        # adversarial RLS/tenant-isolation suite
npm run typecheck
npm run lint
npm run build
```

At the last verified checkpoint (this one): 135/135 tests passing, local
RLS 11/11, typecheck/lint/build clean, `npm audit --omit=dev` reporting 0
vulnerabilities.

## 5. How to initialize/connect it to your own GitHub repository

This package is a plain directory, not a git repository — `git archive`
deliberately excludes `.git/` history. To put it under version control and
push to your own GitHub repo:

```bash
cd kiracash
git init
git add -A
git commit -m "Import KiraCash checkpoint 56b6f53"
git branch -M main
git remote add origin https://github.com/cpadillapogi-debug/kiracash.git
git push -u origin main
```

Note this creates a **new** local commit history (a single commit
containing this snapshot) — the original commit-by-commit history from the
development sessions that produced this checkpoint (28 commits covering
the money-validation fixes, the critical `is_business_member()` security
fix, rate limiting, dependency upgrades, and the live-verification
package) exists only in the environment that produced it, which has no way
to push directly to GitHub. If you want that full commit history on
GitHub rather than a single squashed import, it would need to be
transferred as an actual git bundle/clone rather than this ZIP — ask if
you want that instead.

## 6. Live Supabase verification status

**NOT VERIFIED.** This is important: everything in `db/live-verify/`,
`scripts/verify-live-*.mjs`, and `docs/LIVE_SUPABASE_VERIFICATION*.md` is
the *package* for running live verification against a real Supabase
project — none of it has actually been executed against one. The
environment that built this checkpoint never had Supabase network access
or credentials, confirmed repeatedly (network egress to `*.supabase.co`
was blocked at the proxy level).

Once you have this on a machine with real Supabase credentials and network
access, run:

```bash
NEXT_PUBLIC_SUPABASE_URL=... \
NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
npm run verify:live:preflight

SUPABASE_DB_URL=... npm run verify:live:rls
```

then work through `docs/LIVE_SUPABASE_VERIFICATION_RUNBOOK.md` for the
remaining steps that need a human/browser (auth UX, cookies on deployed
HTTPS, CSRF against a real origin, Supabase dashboard backup config), and
fill in `docs/LIVE_SUPABASE_VERIFICATION_RESULTS.md` as you go. Do not
treat this checkpoint as production-ready until that's actually done —
local verification and live verification are two different gates, and
only the first one has been passed so far.

## Known gap worth fixing on your end

`.gitignore`'s `.env*` pattern is broader than intended and has excluded
`.env.example` (a safe, secret-free template — no real values, just
variable names and comments) from every commit in this project's history,
including this one. It's included in this ZIP anyway, copied in
separately, because it's genuinely useful and contains nothing sensitive.
Once this is under your own git control, consider narrowing the ignore
pattern (e.g. `.env` / `.env.local` / `.env.production` instead of the
blanket `.env*`) and committing `.env.example` properly.
