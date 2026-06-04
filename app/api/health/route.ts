import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  getMissingCoreEnv,
  REQUIRED_STRIPE_ENV,
  getMissingEnv,
  assertProductionRateLimiter,
} from "@/lib/env"
import { ensureDatabaseSchema } from "@/lib/ensure-schema"
import { rateLimitByIp } from "@/lib/rate-limit"
import { generateReqId } from "@/lib/observability"
import { Redis } from "@upstash/redis"
import { timingSafeEqual } from "node:crypto"

const AI_BASE_URL = process.env.NVIDIA_API_BASE_URL?.trim() ?? "https://integrate.api.nvidia.com/v1"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Cache TTL for healthy results (ms). */
const CACHE_TTL_MS = 30_000
/** Shorter TTL for error/degraded results — we want fresh probes sooner. */
const ERROR_CACHE_TTL_MS = 10_000

interface CachedHealth {
  result: {
    database: "ok" | "error"
    tables: "ok" | "schema_incomplete" | "error"
    rateLimiter: "distributed" | "distributed-unreachable" | "in-memory-fallback" | "error"
    aiUpstream: "ok" | "unconfigured" | "unreachable" | "error"
    stripeApi: "ok" | "unconfigured" | "error"
    env: {
      core: "ok" | "missing"
      stripe: "ok" | "missing"
    }
    healthy: boolean
  }
  timestamp: number
}

let healthCache: CachedHealth | null = null

/**
 * Timing-safe comparison of the `x-health-token` header against the
 * configured `HEALTH_CHECK_SECRET`. A naive `===` leaks the prefix length
 * to a network attacker via response-time difference: short tokens resolve
 * faster than long ones. `timingSafeEqual` runs in constant time.
 *
 * Length check first — timingSafeEqual throws on mismatched buffer lengths,
 * so we must guard separately. The length check itself is also
 * constant-time-by-construction because the lengths are public.
 */
function safeTokenEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8")
  const bBuf = Buffer.from(b, "utf8")
  if (aBuf.length !== bBuf.length) return false
  return timingSafeEqual(aBuf, bBuf)
}

/** Probe Redis / rate-limiter reachability. */
async function probeRateLimiter(): Promise<
  "distributed" | "distributed-unreachable" | "in-memory-fallback" | "error"
> {
  try {
    assertProductionRateLimiter()
    const url = process.env.UPSTASH_REDIS_REST_URL?.trim()
    const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
    if (url && token) {
      const probe = Redis.fromEnv()
      const reachable = await Promise.race([
        probe.ping(),
        new Promise<"timeout">((resolve) =>
          setTimeout(() => resolve("timeout"), 1000),
        ),
      ])
      return reachable === "PONG" ? "distributed" : "distributed-unreachable"
    } else {
      return "in-memory-fallback"
    }
  } catch {
    return "error"
  }
}

/** Probe database connectivity and schema completeness. */
async function probeDatabase(): Promise<{
  database: "ok" | "error"
  tables: "ok" | "schema_incomplete" | "error"
}> {
  let database: "ok" | "error" = "ok"
  let tables: "ok" | "schema_incomplete" | "error" = "ok"

  try {
    await ensureDatabaseSchema()
    await prisma.$queryRaw`SELECT 1`
  } catch {
    return { database: "error", tables: "error" }
  }

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

  return { database, tables }
}

/** Probe NVIDIA AI upstream reachability. */
async function probeAIUpstream(): Promise<"ok" | "unconfigured" | "unreachable" | "error"> {
  try {
    const hasKey = !!process.env.NVIDIA_API_KEY?.trim()
    if (!hasKey) {
      return "unconfigured"
    }
    const probe = await Promise.race([
      fetch(AI_BASE_URL, { method: "HEAD", signal: AbortSignal.timeout(3000) }),
      new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), 3000),
      ),
    ])
    if (probe === "timeout") {
      return "unreachable"
    } else if (typeof probe === "object" && probe.status >= 500) {
      return "error"
    } else {
      return "ok"
    }
  } catch {
    return "error"
  }
}

/** Probe Stripe API key validity. */
async function probeStripeApi(): Promise<"ok" | "unconfigured" | "error"> {
  try {
    const stripeSecret = process.env.STRIPE_SECRET_KEY?.trim() ?? ""
    if (!stripeSecret) {
      return "unconfigured"
    } else if (!stripeSecret.startsWith("sk_")) {
      return "error"
    } else {
      return "ok"
    }
  } catch {
    return "error"
  }
}

export async function GET(req: NextRequest) {
  const reqId = generateReqId()
  const headers = { "x-request-id": reqId }

  // Light rate limit on health endpoint to prevent DoS amplification.
  // 60 requests per IP per minute is generous for uptime probes.
  const rl = await rateLimitByIp(req, 60, "1 m")
  if (!rl.allowed) {
    return new NextResponse(null, { status: 429, headers })
  }

  // Serve cached result if still fresh.
  if (healthCache) {
    const age = Date.now() - healthCache.timestamp
    const maxAge = healthCache.result.healthy ? CACHE_TTL_MS : ERROR_CACHE_TTL_MS
    if (age < maxAge) {
      const expected = process.env.HEALTH_CHECK_SECRET?.trim() ?? ""
      const provided = req.headers.get("x-health-token") ?? ""
      const authorized = expected.length > 0 && safeTokenEquals(provided, expected)

      if (!authorized) {
        return new NextResponse(null, {
          status: healthCache.result.healthy ? 200 : 503,
          headers,
        })
      }

      return NextResponse.json(
        {
          ...healthCache.result,
          timestamp: new Date(healthCache.timestamp).toISOString(),
        },
        { status: healthCache.result.healthy ? 200 : 503, headers },
      )
    }
  }

  const missingCore = getMissingCoreEnv()
  const missingStripe = getMissingEnv(REQUIRED_STRIPE_ENV)

  // Run all probes in parallel — Redis, DB+schema, AI upstream, and Stripe
  // are all independent and can execute concurrently.
  const [rateLimiter, dbResult, aiUpstream, stripeApi] = await Promise.all([
    probeRateLimiter(),
    probeDatabase(),
    probeAIUpstream(),
    probeStripeApi(),
  ])

  const { database, tables } = dbResult

  const healthy =
    missingCore.length === 0 &&
    database === "ok" &&
    tables === "ok" &&
    aiUpstream !== "error" &&
    aiUpstream !== "unreachable" &&
    !(process.env.NODE_ENV === "production" && aiUpstream === "unconfigured") &&
    stripeApi !== "error"

  const env = {
    core: missingCore.length === 0 ? ("ok" as const) : ("missing" as const),
    stripe: missingStripe.length === 0 ? ("ok" as const) : ("missing" as const),
  }

  // Cache the result for subsequent requests.
  healthCache = {
    result: { database, tables, rateLimiter, aiUpstream, stripeApi, env, healthy },
    timestamp: Date.now(),
  }

  // Public response is intentionally minimal — uptime/deploy checks still get
  // a 200/503 but learn nothing about WHICH subsystem is degraded. Internal
  // diagnostics (which env groups are missing, rate-limiter mode, table
  // status) are only disclosed to callers presenting HEALTH_CHECK_SECRET.
  // Even the "ok" vs "degraded" string is omitted from the public body so an
  // attacker probing /api/health cannot tell green from a single failed probe.
  const expected = process.env.HEALTH_CHECK_SECRET?.trim() ?? ""
  const provided = req.headers.get("x-health-token") ?? ""
  const authorized = expected.length > 0 && safeTokenEquals(provided, expected)

  if (!authorized) {
    return new NextResponse(null, { status: healthy ? 200 : 503, headers })
  }

  const body = {
    status: healthy ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    database,
    tables,
    rateLimiter,
    aiUpstream,
    stripeApi,
    env,
  }

  return NextResponse.json(body, { status: healthy ? 200 : 503, headers })
}