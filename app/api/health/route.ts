import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getMissingCoreEnv, REQUIRED_STRIPE_ENV, getMissingEnv } from "@/lib/env"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const missingCore = getMissingCoreEnv()
  const missingStripe = getMissingEnv(REQUIRED_STRIPE_ENV)

  let database: "ok" | "error" = "ok"
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch {
    database = "error"
  }

  let tables: "ok" | "schema_incomplete" | "error" = "ok"
  if (database === "ok") {
    try {
      const rows = await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name IN ('User', 'Analysis')
          AND column_name IN ('lastResetAt', 'tokenVersion', 'caseId', 'parentId', 'chatMessages')
      `
      const found = new Set(rows.map((r) => r.column_name))
      const required = ["lastResetAt", "tokenVersion", "caseId", "parentId", "chatMessages"]
      if (!required.every((col) => found.has(col))) {
        tables = "schema_incomplete"
      }
    } catch {
      tables = "error"
    }
  }

  const healthy = missingCore.length === 0 && database === "ok" && tables === "ok"

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      database,
      tables,
      env: {
        core: missingCore.length === 0 ? "ok" : "missing",
        stripe: missingStripe.length === 0 ? "ok" : "missing",
      },
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 },
  )
}
