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

  const healthy = missingCore.length === 0 && database === "ok"

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      database,
      env: {
        core: missingCore.length === 0 ? "ok" : "missing",
        stripe: missingStripe.length === 0 ? "ok" : "missing",
      },
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 },
  )
}
