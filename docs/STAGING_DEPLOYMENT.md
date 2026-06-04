# Staging & Preview Deployment Guide

ClearDoc uses Vercel's built-in preview deployment system for staging. This document describes how preview deployments work, how to configure staging environment variables, how database migrations behave in preview, and how to promote a preview deploy to production.

---

## 1. Preview Deployments

Vercel automatically creates a preview deployment for every pull request against `main`. No manual configuration is needed.

- **Trigger**: Opening or pushing to a PR that targets `main`
- **URL format**: `cleardoc-git-<branch>-sahajpatel123.vercel.app`
- **Runtime**: Identical to production (Node.js 22, serverless functions with the same `maxDuration` and `memory` settings from `vercel.json`)
- **Function config**: The same `vercel.json` function overrides (e.g. `/api/analyze` at 120s maxDuration / 2048MB) apply to preview deploys
- **Visibility**: The preview URL is posted as a GitHub commit status and appears in the PR conversation

Every preview deploy runs through the full build pipeline, including `scripts/prebuild-migrate.mjs`, which applies pending Prisma migrations.

---

## 2. Staging Environment Variables

Vercel supports per-environment variable scoping: **Production**, **Preview**, and **Development**. Use the Preview environment to isolate staging config from production.

### Setting Preview-Only Variables

In the Vercel dashboard, go to **Settings > Environment Variables** and add variables scoped to the **Preview** environment. Preview deploys will use the Preview-scoped values; any variable not overridden in Preview falls through to the Production value.

### Key Staging Overrides

| Variable | Production Value | Staging (Preview) Value | Notes |
|----------|-----------------|------------------------|-------|
| `NEXT_PUBLIC_APP_URL` | `https://cleardoc.vercel.app` | `https://cleardoc-git-<branch>-sahajpatel123.vercel.app` | Preview URL for OAuth callbacks |
| `STRIPE_SECRET_KEY` | `sk_live_...` | `sk_test_...` | Stripe test mode key |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` (live) | `whsec_...` (from `stripe listen --forward-to`) | Use Stripe CLI for local webhooks or create a test-mode webhook endpoint |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_live_...` | `pk_test_...` | Stripe test mode publishable key |
| `DATABASE_URL` | Production Supabase pooler | Staging Supabase pooler | See "Separate Staging Database" below |
| `DIRECT_URL` | Production direct/session pooler | Staging direct/session pooler | Required for migrations on staging DB |

### Separate Staging Database

To fully isolate staging data from production:

1. **Create a second Supabase project** (free tier is sufficient for staging)
2. Note both the **transaction pooler URL** (port 5432 or 6543) and the **session pooler / direct URL** (port 6543 or the direct `db.xxx.supabase.co:5432` endpoint)
3. In Vercel, set these as Preview-scoped overrides:
   - `DATABASE_URL` = staging transaction pooler URL
   - `DIRECT_URL` = staging session pooler URL (port 6543)

`scripts/pg-bouncer-params.mjs` and `lib/env.ts` use `DATABASE_URL_KEYS` and `DIRECT_DATABASE_URL_KEYS` to resolve the correct connection strings. Setting `DATABASE_URL` and `DIRECT_URL` in the Preview environment overrides the production values, so preview deploys will point at the staging database.

> **Warning**: If you do NOT set separate staging database URLs, preview deploys share the production database. In that case, all migrations must be backward-compatible (additive only) because the production app is still reading the same schema.

### Stripe Test Mode

Using `sk_test_...` keys in Preview means:
- No real charges are created
- Webhook events come from Stripe's test mode
- Use `stripe listen --forward-to https://cleardoc-git-<branch>-sahajpatel123.vercel.app/api/stripe/webhook` to forward test events locally, or create a test-mode webhook endpoint in the Stripe dashboard pointing at the preview URL

---

## 3. Database Migrations in Staging

The `prebuild` script in `package.json` runs `scripts/prebuild-migrate.mjs` before every Vercel build (both production and preview). This script handles migration application with several safeguards specific to preview deploys.

### How It Works

1. **Environment resolution**: `prebuild-migrate.mjs` calls `configureMigrationEnv()` which reads `DATABASE_URL` and `DIRECT_URL` (or `DIRECT_DATABASE_URL_KEYS` aliases like `POSTGRES_URL_NON_POOLING`). For preview deploys using a staging database, these point at the staging Supabase instance.

2. **Session pooler rewriting**: If `DIRECT_URL` points at a Supabase transaction-mode pooler, the script rewrites it to session-mode (port 6543) so DDL operations work. This logic lives in `scripts/pg-bouncer-params.mjs` and is shared with `lib/env.ts`.

3. **Migration execution**: `prisma migrate deploy` is run with a 120-second timeout. All pending migrations are applied.

### Failure Handling (Critical for Preview Deploys)

`prebuild-migrate.mjs` distinguishes between production and non-production environments:

- **Production** (`NODE_ENV=production`): If the database is unreachable (P1001) or the build times out, the script **exits 1** and fails the build. Production deploys must have migrations applied.
- **Preview / Non-production**: If the database is unreachable, the script **exits 0** and the build continues. Migrations are skipped, and `lib/ensure-schema.ts` will apply schema guards at runtime on the first request. This prevents a transient network issue in the build environment from blocking preview deploys.

```bash
# From prebuild-migrate.mjs — the key branching logic:
if (isUnreachableError(err) || err.killed || err.signal === "SIGTERM") {
  if (process.env.NODE_ENV === "production") {
    // FAIL LOUDLY — migrations MUST run at build time in production
    process.exit(1)
  }
  // Non-production: skip gracefully so deploys succeed
  process.stdout.write(
    "[migrate] Build env cannot reach Supabase pooler — skipping prisma migrate deploy.\n" +
    "[migrate] Runtime will apply pending schema via lib/ensure-schema.ts.\n"
  )
  process.exit(0)
}
```

### Shared Database Considerations

If preview deploys use the same database as production (no staging override):

- Migrations applied by the preview build immediately affect the production schema
- Always make migrations additive (new columns, new tables) — never drop or rename columns that production code still reads
- Use `IF NOT EXISTS` / `IF EXISTS` guards in migration SQL for idempotency
- See `docs/MIGRATION_ROLLBACK.md` for rollback procedures if a migration breaks production

### Testing Migrations Locally

```bash
# Validate that schema.prisma matches migrations
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --script > /dev/null

# Full CI check
npm run lint && npm run typecheck && npm test && npm run build
```

---

## 4. Promoting to Production

### Standard Promotion Flow

1. **Create PR** against `main` -- Vercel creates a preview deployment automatically
2. **Test on preview** -- Verify functionality on the preview URL
3. **Merge PR to `main`** -- Vercel auto-deploys to production
4. **Prebuild hook runs** -- `scripts/prebuild-migrate.mjs` executes `prisma migrate deploy` against the production database
5. **Build completes** -- Next.js production build runs
6. **Monitor** -- Check `/api/health` and Vercel deploy logs for the new deploy

### Promotion Checklist

- [ ] All CI checks pass (lint, typecheck, test, build)
- [ ] Preview deployment tested and verified at the preview URL
- [ ] No pending Prisma migrations that would break backward compatibility
- [ ] Stripe webhook events tested in test mode (if billing changes are included)
- [ ] `/api/health` returns `"ok"` on preview deployment

### Monitoring the New Production Deploy

After merging, verify the deployment:

```bash
# Check health (authenticated — requires HEALTH_CHECK_SECRET)
curl -s -H "x-health-token: $HEALTH_CHECK_SECRET" \
  https://cleardoc.vercel.app/api/health | jq .

# Without auth, you still get a status code: 200 = healthy, 503 = degraded
curl -s -o /dev/null -w "%{http_code}" https://cleardoc.vercel.app/api/health

# Watch Vercel production logs
vercel logs --follow
```

The health endpoint (defined in `app/api/health/route.ts`) checks:
- Database connectivity and schema completeness
- Redis / rate-limiter reachability
- AI upstream (NVIDIA NIM) availability
- Stripe API key validity
- Core and Stripe environment variable presence

### Emergency Hotfix Flow

For critical production fixes that cannot wait for a full PR review cycle:

1. Create a branch from `main`
2. Make the minimal fix
3. Push and merge immediately (Vercel deploys on merge)
4. Verify `/api/health` returns HTTP 200 and production logs
5. Create a follow-up PR for any related cleanup

---

## 5. Rollback

For the full rollback procedure with 4 escalation levels, see [MIGRATION_ROLLBACK.md](./MIGRATION_ROLLBACK.md).

Quick Vercel rollback (redeploys the previous production deploy without a new build):

```bash
# List recent production deploys
vercel ls --prod

# Roll back to the previous deploy
vercel rollback
```

Note: `vercel rollback` redeploys the old code but does NOT reverse database migrations. If a migration was applied, you need a compensating migration (Level 1 in MIGRATION_ROLLBACK.md) or a database restore (Level 3).