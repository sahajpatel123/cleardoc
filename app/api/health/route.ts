import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getMissingCoreEnv, REQUIRED_STRIPE_ENV, getMissingEnv } from "@/lib/env"
import { ensureDatabaseSchema } from "@/lib/ensure-schema"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const missingCore = getMissingCoreEnv()
  const missingStripe = getMissingEnv(REQUIRED_STRIPE_ENV)

  let database: "ok" | "error" = "ok"
  try {
    await ensureDatabaseSchema()
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

  // Public response is intentionally minimal — uptime/deploy checks still get a
  // 200/503 and a status string, but internal diagnostics (which subsystems and
  // env groups are degraded) are only disclosed to callers presenting the secret.
  const authorized =
    !!process.env.HEALTH_CHECK_SECRET &&
    req.headers.get("x-health-token") === process.env.HEALTH_CHECK_SECRET

  const body: Record<string, unknown> = {
    status: healthy ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
  }

  if (authorized) {
    body.database = database
    body.tables = tables
    body.env = {
      core: missingCore.length === 0 ? "ok" : "missing",
      stripe: missingStripe.length === 0 ? "ok" : "missing",
    }
  }

  return NextResponse.json(body, { status: healthy ? 200 : 503 })
}
