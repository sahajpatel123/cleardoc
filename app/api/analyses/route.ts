import { NextResponse, type NextRequest } from "next/server"
import { auth } from "@/auth"
import { getUserAnalysesSummary } from "@/lib/db"
import { getRedis } from "@/lib/redis"
import { generateReqId, captureException, createLogger } from "@/lib/observability"

const log = createLogger("analyses")

/**
 * Validate a value pulled from the Redis dashboard cache. The cached payload
 * is a JSON-serialized AnalysisSummary[]; Redis returns `unknown` and any
 * value could be in the slot (a poisoned write, a stale format from before
 * a schema change, or an attacker with Redis access). We require the shape
 * the dashboard list actually depends on.
 *
 * We do NOT use the full strict zod schema for AnalysisSummary here — that
 * would force the dashboard to know about a column it doesn't render. A
 * minimal shape check is enough to catch the practical poisoning vectors
 * (null, primitive, object, partial array) without coupling.
 */
function isValidAnalysesSummaryArray(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false
  for (const row of value) {
    if (!row || typeof row !== "object") return false
    const r = row as Record<string, unknown>
    if (typeof r.id !== "string" || r.id.length === 0) return false
    if (typeof r.documentName !== "string") return false
    if (typeof r.documentType !== "string") return false
    if (typeof r.caseId !== "string" && r.caseId !== null) return false
    if (typeof r.parentId !== "string" && r.parentId !== null) return false
    if (typeof r.overallVerdict !== "string" && r.overallVerdict !== null) return false
    if (typeof r.createdAt !== "string") return false
  }
  return true
}

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
export async function GET(req: NextRequest) {
  const reqId = generateReqId()
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: { "x-request-id": reqId } },
      )
    }

    // Parse pagination parameters
    const url = new URL(req.url)
    const cursor = url.searchParams.get("cursor") || undefined
    const limitParam = url.searchParams.get("limit")
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10), 1), 100) : undefined

    // Only cache the first page (no cursor) — paginated results are dynamic
    const redis = getRedis()
    const cacheKey = `cleardoc:dashboard:${session.user.id}`
    if (!cursor && redis) {
      try {
        const cached = await redis.get<unknown>(cacheKey)
        // The cache stores the array directly; wrap in the paginated response shape
        if (Array.isArray(cached) && isValidAnalysesSummaryArray(cached)) {
          // Convert cached array to { data, nextCursor } format for consistency
          const cachedData = cached.map((r) => ({
            ...r,
            createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date(r.createdAt).toISOString(),
          }))
          return NextResponse.json({ data: cachedData, nextCursor: null }, {
            headers: { "Cache-Control": "no-store", "x-request-id": reqId, "x-cache": "HIT" },
          })
        }
        if (cached) {
          // Cache poisoning: schema-violating payload in Redis. Discard
          // and fall through to DB. We do NOT delete the bad key from
          // the request path (a write race could be in flight); it will
          // be overwritten in 10s by the next MISS path below.
          log.warn(
            { userId: session.user.id, cacheKey, payloadType: typeof cached },
            "dashboard cache hit failed validation — discarding poisoned entry",
          )
        }
      } catch (err) {
        // Redis miss/error on READ — fall through to DB.
        log.debug({ err, userId: session.user.id, cacheKey }, "dashboard cache read error — falling through to DB")
      }
    }

    const result = await getUserAnalysesSummary(session.user.id, { cursor, limit })

    // Only cache the first page
    if (!cursor) {
      const redis = getRedis()
      if (redis) {
        try {
          await redis.set(`cleardoc:dashboard:${session.user.id}`, result.data, { ex: 10 })
        } catch (err) {
          log.warn({ err, userId: session.user.id }, "dashboard cache write failed — request continues without caching")
        }
      }
      return NextResponse.json(result, {
        headers: { "Cache-Control": "no-store", "x-request-id": reqId, "x-cache": "MISS" },
      })
    }

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store", "x-request-id": reqId },
    })
  } catch (err) {
    captureException(err, { component: "analyses", reqId })
    return NextResponse.json(
      { error: "Could not load analyses." },
      { status: 500, headers: { "x-request-id": reqId } },
    )
  }
}
