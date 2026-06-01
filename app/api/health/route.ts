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

export async function GET(req: NextRequest) {
  const reqId = generateReqId()
  const headers = { "x-request-id": reqId }

  // Light rate limit on health endpoint to prevent DoS amplification.
  // 60 requests per IP per minute is generous for uptime probes.
  const rl = await rateLimitByIp(req, 60, "1 m")
  if (!rl.allowed) {
    return new NextResponse(null, { status: 429, headers })
  }

  const missingCore = getMissingCoreEnv()
  const missingStripe = getMissingEnv(REQUIRED_STRIPE_ENV)

  // H4: rate-limiter reachability is now actively probed (1s timeout) when
  // Upstash is configured. We do not throw on probe failure — the body
  // reports "unreachable" and the operator can act before a real traffic
  // spike hits a broken limiter.
  let rateLimiter:
    | "distributed"
    | "distributed-unreachable"
    | "in-memory-fallback"
    | "error" = "in-memory-fallback"
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
      rateLimiter = reachable === "PONG" ? "distributed" : "distributed-unreachable"
    } else {
      rateLimiter = "in-memory-fallback"
    }
  } catch {
    rateLimiter = "error"
  }

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

  // AI upstream probe: lightweight connectivity check (no API key needed for
  // a HEAD — a 401/404 still proves the host is reachable; 5xx or timeout
  // means degraded).
  let aiUpstream: "ok" | "unconfigured" | "unreachable" | "error" = "unconfigured"
  try {
    const hasKey = !!process.env.NVIDIA_API_KEY?.trim()
    if (!hasKey) {
      aiUpstream = "unconfigured"
    } else {
      const probe = await Promise.race([
        fetch(AI_BASE_URL, { method: "HEAD", signal: AbortSignal.timeout(3000) }),
        new Promise<"timeout">((resolve) =>
          setTimeout(() => resolve("timeout"), 3000),
        ),
      ])
      if (probe === "timeout") {
        aiUpstream = "unreachable"
      } else if (typeof probe === "object" && probe.status >= 500) {
        aiUpstream = "error"
      } else {
        aiUpstream = "ok"
      }
    }
  } catch {
    aiUpstream = "error"
  }

  // Stripe API probe: verify the secret key is present and syntactically valid.
  let stripeApi: "ok" | "unconfigured" | "error" = "unconfigured"
  try {
    const stripeSecret = process.env.STRIPE_SECRET_KEY?.trim() ?? ""
    if (!stripeSecret) {
      stripeApi = "unconfigured"
    } else if (!stripeSecret.startsWith("sk_")) {
      stripeApi = "error"
    } else {
      stripeApi = "ok"
    }
  } catch {
    stripeApi = "error"
  }

  const healthy =
    missingCore.length === 0 &&
    database === "ok" &&
    tables === "ok" &&
    aiUpstream !== "error" &&
    aiUpstream !== "unreachable" &&
    !(process.env.NODE_ENV === "production" && aiUpstream === "unconfigured") &&
    stripeApi !== "error"

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
    env: {
      core: missingCore.length === 0 ? "ok" : "missing",
      stripe: missingStripe.length === 0 ? "ok" : "missing",
    },
  }

  return NextResponse.json(body, { status: healthy ? 200 : 503, headers })
}
