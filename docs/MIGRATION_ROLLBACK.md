# Database Migrations & Rollback Guide

## Overview

ClearDoc uses Prisma Migrate for schema migrations. Migrations are applied:
1. **At build time** via `scripts/prebuild-migrate.mjs` (Vercel prebuild hook)
2. **At runtime** via `lib/ensure-schema.ts` if the build script couldn't reach the database

## Creating a New Migration

```bash
# 1. Make your schema changes in prisma/schema.prisma
# 2. Create the migration
npx prisma migrate dev --name descriptive_name

# 3. Test locally
npm test

# 4. Commit both the schema change and the generated migration files
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add descriptive_name column to Analysis"
```

## CI Validation

The CI pipeline (`.github/workflows/ci.yml`) runs `prisma migrate diff` to detect
migration drift — if `schema.prisma` has changes not reflected in a migration file,
the build will warn (not fail) so you know to create a migration before deploying.

## Deployment Process

1. Push to `main` triggers a Vercel build
2. The prebuild hook runs `prisma migrate deploy`
3. If the build environment can't reach the database (P1001), migrations are
   skipped and will be applied at runtime
4. If a previous migration failed and blocks the queue (P3018), the script
   attempts to resolve known historical incidents automatically

## Rollback Procedures

### Level 1: Quick Schema Revert (Recommended)

If a migration breaks production:

1. **Identify the failing migration** from Vercel build logs or Sentry errors
2. **Create a new compensating migration** (never edit existing migrations):
   ```bash
   npx prisma migrate dev --name revert_descriptive_name
   ```
3. In the new migration SQL, write the inverse of the failing change:
   ```sql
   -- If the bad migration added a column:
   ALTER TABLE "Analysis" DROP COLUMN IF EXISTS "badColumn";
   
   -- If the bad migration dropped a column (restore from backup):
   ALTER TABLE "Analysis" ADD COLUMN "importantColumn" TEXT;
   ```
4. Commit and push — Prisma applies the new migration on top

### Level 2: Mark Migration as Applied

If a migration actually ran successfully but Prisma recorded it as failed (P3018):

```bash
# Connect to the database and mark it as applied
npx prisma migrate resolve --applied "migration_name"

# Then redeploy
npx prisma migrate deploy
```

### Level 3: Database Restore from Backup

For catastrophic failures where data was lost:

1. **Supabase Dashboard** → Database → Backups → Select the pre-migration backup
2. Restore to a point in time before the migration
3. Re-apply all migrations up to (but not including) the bad one:
   ```bash
   npx prisma migrate resolve --applied "migration_before_bad"
   # Skip the bad migration:
   npx prisma migrate resolve --rolled-back "bad_migration_name"
   # Apply the compensating migration:
   npx prisma migrate deploy
   ```

### Level 4: Emergency Redeploy

If the build itself is broken:

1. `git revert HEAD` on main to revert the commit
2. Push — Vercel redeploys the previous working commit
3. The database already has the new schema, but the app code is the old version
4. This is safe for additive migrations (new columns) but unsafe for destructive ones

## Safety Rules

1. **Never edit existing migration files** — always create new ones
2. **Always use `IF NOT EXISTS` / `IF EXISTS`** in migration SQL for idempotency
3. **Additive changes first** — add columns before removing old ones in a
   separate migration
4. **Test migrations locally** before pushing — run `npx prisma migrate dev`
5. **Keep migrations small** — one logical change per migration
6. **Column drops require a two-phase approach**: first deploy code that doesn't
   reference the column, then drop it in a separate migration

## Connection Pooling

All database URLs go through `scripts/pg-bouncer-params.mjs` which:
- Detects PgBouncer/Supavisor pooler URLs (port 6543)
- Appends `pgbouncer=true&prepared_statements=false&connection_limit=5`
- Converts transaction-mode URLs to session-mode for migrations (port 6543)

Never modify `DATABASE_URL` directly — use `DIRECT_URL` or `POSTGRES_URL_NON_POOLING`
for migration access.