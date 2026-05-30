import { prisma } from "@/lib/prisma"

let ensureAttempted = false
let ensurePromise: Promise<void> | null = null

async function exec(sql: string) {
  await prisma.$executeRawUnsafe(sql)
}

/**
 * Applies idempotent DDL for columns added after initial deploy. Runtime
 * serverless functions can reach Supabase even when Vercel build workers cannot.
 */
export async function ensureDatabaseSchema(): Promise<void> {
  if (ensureAttempted) return
  if (ensurePromise) return ensurePromise

  ensurePromise = (async () => {
    try {
      await exec(`ALTER TABLE "Analysis" ADD COLUMN IF NOT EXISTS "parentId" TEXT`)
      await exec(`ALTER TABLE "Analysis" ADD COLUMN IF NOT EXISTS "caseId" TEXT`)
      await exec(`ALTER TABLE "Analysis" ADD COLUMN IF NOT EXISTS "chatMessages" JSONB`)
      await exec(
        `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`,
      )
      await exec(
        `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0`,
      )
      await exec(`CREATE INDEX IF NOT EXISTS "Analysis_caseId_idx" ON "Analysis"("caseId")`)
      await exec(`CREATE INDEX IF NOT EXISTS "Analysis_parentId_idx" ON "Analysis"("parentId")`)
      await exec(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'Analysis_parentId_fkey'
          ) THEN
            ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_parentId_fkey"
              FOREIGN KEY ("parentId") REFERENCES "Analysis"("id")
              ON DELETE SET NULL ON UPDATE CASCADE;
          END IF;
        END $$;
      `)
    } catch (err) {
      console.error("[ensureDatabaseSchema] failed:", err)
    } finally {
      ensureAttempted = true
    }
  })()

  return ensurePromise
}
