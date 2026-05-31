import { prisma } from "@/lib/prisma"

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
 * Idempotent DDL applied ONLY when a required column is missing (the slow path,
 * e.g. a brand-new database). Each is run independently and best-effort.
 */
const DDL_STATEMENTS: readonly string[] = [
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE "Analysis" ADD COLUMN IF NOT EXISTS "chatMessages" JSONB`,
  `ALTER TABLE "Analysis" ADD COLUMN IF NOT EXISTS "parentId" TEXT`,
  `ALTER TABLE "Analysis" ADD COLUMN IF NOT EXISTS "caseId" TEXT`,
  `CREATE INDEX IF NOT EXISTS "Analysis_caseId_idx" ON "Analysis" ("caseId")`,
  `CREATE INDEX IF NOT EXISTS "Analysis_parentId_idx" ON "Analysis" ("parentId")`,
  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'Analysis_parentId_fkey'
    ) THEN
      ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_parentId_fkey"
        FOREIGN KEY ("parentId") REFERENCES "Analysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
  END $$;`,
]

/**
 * Best-effort runtime guard that adds columns introduced in later migrations
 * when `prisma migrate deploy` could not run during the Vercel build (the build
 * container cannot reach the direct database port on Supabase).
 *
 * Two safety properties make this safe on managed Postgres (e.g. Supabase),
 * where the pooler role does NOT own the tables:
 *
 *  1. Read-first — if the required columns already exist (the normal production
 *     state), it runs zero DDL. A `SELECT` on information_schema needs no table
 *     ownership, so it can never fail with `42501 must be owner of table`.
 *  2. Never fatal — any DDL failure (insufficient privilege, already applied,
 *     transient) is logged and swallowed. The request proceeds; if a column
 *     were genuinely missing, the real query surfaces a precise error instead
 *     of every request dying inside this guard.
 *
 * Runs once per server instance. Safe to call on every request.
 */
export function ensureDatabaseSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = applySchemaGuards().catch((err) => {
      // Allow a retry on a later cold start, but never propagate — keep serving.
      schemaReady = null
      console.error("[ensureDatabaseSchema] non-fatal:", err)
    })
  }
  return schemaReady
}

/**
 * True when every required column already exists. Uses a read-only catalog
 * query (no ownership needed). On any probe error, returns false so the
 * best-effort DDL path still gets a chance to run.
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
    console.error("[ensureDatabaseSchema] schema probe failed:", err)
    return false
  }
}

async function applySchemaGuards(): Promise<void> {
  // Fast path: schema already current → no DDL, no ownership required.
  if (await schemaIsComplete()) return

  // Slow path (e.g. fresh database): attempt each idempotent statement on its
  // own. A failure on one — already applied, or insufficient privilege on a
  // managed DB — must not abort the rest or crash the request.
  for (const sql of DDL_STATEMENTS) {
    try {
      await prisma.$executeRawUnsafe(sql)
    } catch (err) {
      console.error("[ensureDatabaseSchema] statement skipped:", sql.slice(0, 64), err)
    }
  }
}
