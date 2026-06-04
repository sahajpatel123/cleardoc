import { prisma } from "@/lib/prisma"
import { createLogger, captureException } from "@/lib/observability"

const log = createLogger("ensure-schema")

let schemaReady: Promise<void> | null = null

/**
 * Columns introduced by later migrations. If every one of these already exists,
 * the schema is current and NO DDL needs to run — which is the normal state in
 * production once migrations have been applied.
 */
const REQUIRED_COLUMNS: ReadonlyArray<{ table: "User" | "Analysis"; column: string }> = [
  { table: "User", column: "lastResetAt" },
  { table: "User", column: "tokenVersion" },
  { table: "Analysis", column: "chatMessages" },
  { table: "Analysis", column: "parentId" },
  { table: "Analysis", column: "caseId" },
]

/**
 * Best-effort runtime guard that adds columns introduced in later migrations
 * when `prisma migrate deploy` could not run during the Vercel build.
 *
 * Two safety properties:
 *  1. Read-first — if the required columns exist (normal production state),
 *     zero DDL runs. The catalog SELECT needs no table ownership.
 *  2. Never fatal — any DDL failure is logged and swallowed. The request
 *     proceeds; missing columns surface as precise query errors instead.
 *
 * Runs once per server instance. Each DDL statement uses $executeRaw (tagged
 * template) rather than $executeRawUnsafe so Prisma's parameterisation layer
 * is still active for the parts of the statement that accept parameters.
 * All values here are hard-coded constants with no user input, but the safer
 * API is used by default to prevent footguns if the code is later modified.
 *
 * NOTE: In production, this function only READS to verify schema health.
 * Runtime DDL is intentionally disabled - migrations must be applied at
 * build time via `prisma migrate deploy` (scripts/prebuild-migrate.mjs).
 * If ensureDatabaseSchema returns in production but schema is incomplete,
 * the server still boots but queries will fail with column errors.
 */
export async function ensureDatabaseSchema(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    // In production, migrations MUST be applied at build time via
    // `prisma migrate deploy` (scripts/prebuild-migrate.mjs). Runtime DDL
    // is disabled to avoid table locks, cold-start latency, and the
    // information_schema probe tax on every health check.
    // We still probe for schema health to detect misconfiguration.
    const complete = await schemaIsComplete().catch((err) => {
      captureException(err, { component: "ensure-schema", extra: { phase: "probe-production" } })
      return false
    })
    if (!complete) {
      captureException(new Error("Production schema incomplete at boot — migrations were not applied"), {
        component: "ensure-schema",
        extra: { phase: "schema-incomplete" },
      })
    }
    return
  }

  if (!schemaReady) {
    schemaReady = applySchemaGuards().catch((err) => {
      // Allow a retry on a later cold start, but never propagate — keep serving.
      // This is the ONLY place a failed DDL state can re-trigger the boot path.
      captureException(err, { component: "ensure-schema", extra: { phase: "boot" } })
      schemaReady = null
    })
  }
  return schemaReady
}

/**
 * True when every required column already exists.
 */
async function schemaIsComplete(): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM information_schema.columns
      WHERE (table_name = 'User' AND column_name IN ('lastResetAt', 'tokenVersion'))
         OR (table_name = 'Analysis' AND column_name IN ('chatMessages', 'parentId', 'caseId'))
    `
    return Number(rows[0]?.count ?? 0) >= REQUIRED_COLUMNS.length
  } catch (err) {
    captureException(err, { component: "ensure-schema", extra: { phase: "probe" } })
    return false
  }
}

async function tryDdl(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    log.error({ statement: label }, "ddl statement skipped")
    captureException(err, { component: "ensure-schema", extra: { statement: label } })
  }
}

async function applySchemaGuards(): Promise<void> {
  const complete = await schemaIsComplete()

  // In production, migrations must be applied at build time via
  // `prisma migrate deploy` (see scripts/prebuild-migrate.mjs). Running DDL
  // inside request handlers causes dangerous race conditions, table locks, and
  // cold-start latency on serverless platforms. We skip entirely in production.
  if (process.env.NODE_ENV === "production") {
    return
  }

  if (complete) return

  // Each statement is idempotent (IF NOT EXISTS / IF NOT EXISTS constraint check).
  // Using $executeRaw tagged templates instead of $executeRawUnsafe — no dynamic
  // user input ever reaches these queries, but the safer API is the correct default.
  await tryDdl("User.lastResetAt", () =>
    prisma.$executeRaw`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`
  )
  await tryDdl("User.tokenVersion", () =>
    prisma.$executeRaw`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0`
  )
  await tryDdl("Analysis.chatMessages", () =>
    prisma.$executeRaw`ALTER TABLE "Analysis" ADD COLUMN IF NOT EXISTS "chatMessages" JSONB`
  )
  await tryDdl("Analysis.parentId", () =>
    prisma.$executeRaw`ALTER TABLE "Analysis" ADD COLUMN IF NOT EXISTS "parentId" TEXT`
  )
  await tryDdl("Analysis.caseId", () =>
    prisma.$executeRaw`ALTER TABLE "Analysis" ADD COLUMN IF NOT EXISTS "caseId" TEXT`
  )
  await tryDdl("idx_caseId", () =>
    prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Analysis_caseId_idx" ON "Analysis" ("caseId")`
  )
  await tryDdl("idx_parentId", () =>
    prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Analysis_parentId_idx" ON "Analysis" ("parentId")`
  )
  // The FK check uses a DO block which cannot be parameterised; it contains no
  // user input, so using $executeRaw here is safe.
  await tryDdl("Analysis.parentId_fkey", () =>
    prisma.$executeRaw`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'Analysis_parentId_fkey'
        ) THEN
          ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_parentId_fkey"
            FOREIGN KEY ("parentId") REFERENCES "Analysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;
      END $$`
  )
}
