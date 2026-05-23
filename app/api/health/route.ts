import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getMissingEnv, REQUIRED_SERVER_ENV, REQUIRED_STRIPE_ENV } from "@/lib/env"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const missingCore = getMissingEnv(REQUIRED_SERVER_ENV)
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
        missing: [...missingCore, ...missingStripe],
      },
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 },
  )
}
