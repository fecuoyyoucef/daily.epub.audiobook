# Implementation status

**Baseline checked:** 2026-11-11  
**Working branch:** `v0/product-plan-foundation` (created before project edits)  
**Baseline commit:** `a30ed83cb86dc6d0f573af026f8c854036a5572c` (`Initialize workspace`)  
**Repository:** `fecuoyyoucef/daily.epub.audiobook` (`origin`)  

## Production deployment baseline

- Vercel project: `daily-epub-audiobook` (`prj_8dhR6I6N51QYIy8hs8CfEhhdsWzf`), root directory `.`.
- Framework/runtime: Next.js, Node.js 26.x.
- Latest deployment observed: `dpl_5QFDuteKigZB26xF4q8Q6cfHc5h8`, Ready, Production; `daily-epub-audiobook-aaqb22m59-fecuoyyoucefs-projects.vercel.app`.
- Production aliases include `daily-epub-audiobook.vercel.app` and the `git-main` alias.
- Deployment metadata did not expose a source commit or Git repository/ref, so the deployed source revision is not confirmed.
- `vercel.json` schedules `/api/cron` at `0 6 * * *`.
- No production writes or schema changes were made during this audit.

## Current application shape

- Next.js App Router with React 19 and TypeScript; dependencies are managed with pnpm.
- Existing pages: `/`, `/listen`, `/settings`.
- Existing API routes: `/api/audio`, `/api/cron`, `/api/run-now`, `/api/settings`, `/api/status`, `/api/upload`, `/api/upload/chunk`, `/api/upload/complete`.
- `lib/store.ts` stores a JSON manifest and private objects in Vercel Blob; the app currently has no PostgreSQL repository layer.
- `@vercel/blob` resolves to 2.9.0.
- Neon is connected. A live schema inspection returned nine `neon_auth` tables; the Vercel project also has PostgreSQL environment-variable names configured. No application tables or migrations were applied.

## Environment variable names observed

Names only; values are intentionally excluded. The production project list and local development environment included:

`BLOB_READ_WRITE_TOKEN`, `CRON_SECRET`, `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `GEMINI_API_KEY`, `NEON_AUTH_BASE_URL`, `NEON_PROJECT_ID`, `PGDATABASE`, `PGHOST`, `PGHOST_UNPOOLED`, `PGPASSWORD`, `PGUSER`, `POSTGRES_DATABASE`, `POSTGRES_HOST`, `POSTGRES_PASSWORD`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_URL_NO_SSL`, `POSTGRES_USER`, `VERCEL_OIDC_TOKEN`, `VITE_NEON_AUTH_URL`, and `NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL`.

`BETTER_AUTH_SECRET` was not present in the observed project/local variable-name lists. It is required before adding Better Auth runtime code. Although `DATABASE_URL` is configured for Production, Preview, and Development, the database/branch isolation between those targets has not been verified; do not run migrations until a non-production target is confirmed.

## Legacy data and runtime inspection

- A read-only private Blob listing for `state/` returned zero objects. `state/manifest.json` was not found, so no manifest backup or legacy Blob migration was needed during this audit.
- The production runtime-error query for the last 24 hours exited unsuccessfully and returned no usable log summary. This is **unknown**, not evidence that there were no errors; log retention/access remains to be checked.

## Baseline checks and known risks

- `pnpm run build`: **passed** (Next.js compilation, TypeScript, and static page generation).
- Automated test script/files: **none identified** in the project manifest; no test suite was run.
- Existing APIs currently lack application-level authentication. This is a high-priority security risk because upload, audio, settings, and job endpoints can access user content or trigger work.
- Blob has no `state/` objects in the connected store at audit time. Avoid destructive cleanup or migration assumptions.
- Preview-vs-production database separation and current runtime-log availability are unverified.
- Stage 0 was read-only; the current phase-by-phase implementation status follows.

## Phase 1 — relational foundation

- Created the persistent Neon branch `epub-audiobook-dev` from production `main`. The development endpoint is configured at the minimum 0.25 CU; no production branch or data was changed.
- Applied `db/migrations/0001_app_schema.sql` to `epub-audiobook-dev` only. It defines the ownership/session, library, reader, audio-job, quota, upload, import, and job-event tables with database-level checks, foreign keys, idempotency constraints, and query indexes. Migration `0001_app_schema` is recorded in `schema_migrations` with checksum `454adc2756cc511aa79b807a9c2f91028d02fa5386d8b52cae04aff686d7593b`.
- Added Drizzle schema/client and a user-scoped book repository. Non-production connections use the development endpoint; `VERCEL_ENV=production` continues to use the integration-provided production `DATABASE_URL`. The endpoint hostname is non-secret; connection credentials remain in environment variables.
- Added `pnpm run test:db-schema`. It connected to the development endpoint, verified book/chapter/progress writes, the quota idempotency constraint, user-scoped reads, and transaction rollback. No test data was retained.
- Phase 1 checks: `pnpm exec tsc --noEmit` **passed**; `pnpm run test:db-schema` **passed**; `pnpm run build` **passed**.
- The existing application routes still use the legacy Blob-manifest store at this point; moving their data flow to PostgreSQL is pending in later phases. The audit found no legacy `state/` objects to migrate.
- `BETTER_AUTH_SECRET` is now present in the project environment. Its value was not read or logged. Better Auth tables and route protection have not yet been added.

## Current risks and remaining work

- The v0 development database connection was verified against the isolated Neon branch. A deployed Vercel Preview has not yet been smoke-tested, and production remains intentionally unchanged.
- The production deployment’s source commit and the runtime-log query remain unconfirmed as noted in the baseline section.
- Authentication, replacement of Blob-manifest metadata, real durable workers, TTS, reader/player UI integration, backup, accessibility, and end-to-end checks remain for subsequent phases.
