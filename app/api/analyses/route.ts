import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getUserAnalysesSummary } from "@/lib/db"
import { getRedis } from "@/lib/redis"
import { generateReqId, captureException } from "@/lib/observability"

export const runtime = "nodejs"

/**
 * GET /api/analyses
 *
 * Returns summary rows for the dashboard list — only the metadata and
 * overallVerdict extracted from the JSONB result column. Full analysis detail
 * is fetched on demand via /api/analyses/[id].
 *
 * ?full=1 returns complete rows (used by the case-linking picker which needs
 * documentName/createdAt but not the full result — kept for compatibility).
 */
export async function GET() {
  const reqId = generateReqId()
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: { "x-request-id": reqId } },
      )
    }

    const redis = getRedis()
    const cacheKey = `cleardoc:dashboard:${session.user.id}`
    if (redis) {
      try {
        const cached = await redis.get<ReturnType<typeof getUserAnalysesSummary>>(cacheKey)
        if (cached) {
          return NextResponse.json(cached, {
            headers: { "Cache-Control": "no-store", "x-request-id": reqId, "x-cache": "HIT" },
          })
        }
      } catch {
        // Redis miss/error — fall through to DB
      }
    }

    const analyses = await getUserAnalysesSummary(session.user.id)
    if (redis) {
      try {
        await redis.set(cacheKey, analyses, { ex: 10 })
      } catch {
        // Non-critical — cache write failure is logged elsewhere if needed
      }
    }
    return NextResponse.json(analyses, {
      headers: { "Cache-Control": "no-store", "x-request-id": reqId, "x-cache": "MISS" },
    })
  } catch (err) {
    captureException(err, { component: "analyses", reqId })
    return NextResponse.json(
      { error: "Could not load analyses." },
      { status: 500, headers: { "x-request-id": reqId } },
    )
  }
}
