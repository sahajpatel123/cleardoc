import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"
import { NextRequest } from "next/server"
import { createLogger } from "@/lib/observability"
import { withRedisCircuit } from "@/lib/redis-circuit"

const log = createLogger("rate-limit")

let _redisWarnedOnce = false

// Memoized Ratelimit instances keyed by "limit:window".
const _ratelimitCache = new Map<string, Ratelimit>()

function getRedis() {
  if (
    !process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    !process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  ) {
    // In production, each serverless instance has its own in-memory store, so
    // the effective rate limit = configured_limit × number_of_live_instances.
    // This provides minimal abuse protection. Configure Upstash Redis to get
    // coordinated rate limiting across instances.
    if (process.env.NODE_ENV === "production" && !_redisWarnedOnce) {
      _redisWarnedOnce = true
      log.error(
        "UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set — rate limiting falls back to per-instance memory",
      )
      log.warn(
        "Rate-limit fallback: effective limit = configured_limit × instance_count. " +
          "Abuse protection is severely degraded. Configure Upstash Redis immediately.",
      )
    }
    return null
  }
  return Redis.fromEnv()
}

export function getClientIpFromHeaders(headers: Headers): string {
  // Vercel sanitises x-vercel-forwarded-for to the real client IP.
  // For other platforms, use the RIGHTMOST IP in x-forwarded-for
  // (the last proxy appended the real client IP).
  const vercelIp = headers.get("x-vercel-forwarded-for")?.trim()
  if (vercelIp) return vercelIp

  const forwarded = headers.get("x-forwarded-for")
  if (forwarded) {
    const parts = forwarded.split(",")
    const rightmost = parts[parts.length - 1]?.trim()
    if (rightmost) return rightmost
  }

  return headers.get("x-real-ip") ?? "anonymous"
}

export function getClientIp(req: NextRequest): string {
  return getClientIpFromHeaders(req.headers)
}

export type RateLimitResult = {
  allowed: boolean
  limit?: number
  remaining?: number
  reset?: number
}

type Window = `${number} s` | `${number} m` | `${number} h` | `${number} d`

const WINDOW_UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
}

function windowToMs(window: Window): number {
  const [amount, unit] = window.split(" ")
  const n = Number(amount)
  const base = WINDOW_UNIT_MS[unit] ?? 60_000
  return (Number.isFinite(n) && n > 0 ? n : 1) * base
}

/**
 * Per-process fixed-window fallback, used ONLY when Upstash Redis is not
 * configured. It does not coordinate across serverless instances, so the
 * effective limit is multiplied by the number of live instances — it errs on
 * the lenient side and will never block a legitimate user more strictly than
 * Redis would. This replaces the previous fail-open behavior, where every
 * limit was silently disabled whenever Redis was absent.
 */
const memoryStore = new Map<string, { count: number; resetAt: number }>()
const MEMORY_STORE_MAX_KEYS = 10_000

/**
 * Return the current number of in-memory rate-limit entries. Used by the health
 * endpoint for leak monitoring — a continuously growing count when Redis is
 * configured would indicate a bug in the circuit-breaker fallback path.
 */
export function getMemoryStoreSize(): number {
  return memoryStore.size
}

function sweepExpired(now: number) {
  let swept = 0
  for (const [key, entry] of memoryStore) {
    if (entry.resetAt <= now) {
      memoryStore.delete(key)
      swept++
    }
    if (swept >= 1000) break // cap sweep to avoid O(N) latency
  }
}

/** Generic rate limit by arbitrary key. Used for per-email signup limits. */
export async function rateLimitByKey(
  key: string,
  limit: number,
  window: Window,
): Promise<RateLimitResult> {
  const redis = getRedis()
  if (!redis) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Rate limiter unavailable in production — Upstash Redis is required. " +
          "Refusing to operate without distributed rate limiting.",
      )
    }
    return rateLimitInMemory(key, limit, window)
  }

  // Circuit-breaker around the Redis round-trip. A transient Upstash outage
  // would otherwise hang every call for ~10-50s waiting for the HTTP timeout
  // and cascade into 503s across all routes. The circuit opens after 3
  // failures within 30s, then falls back to in-memory for 30s before retrying.
  // In production this is permissive-per-instance (each instance opens
  // independently) but recovers automatically when Redis comes back.
  return withRedisCircuit(
    "rate-limit",
    async () => {
      // Memoize Ratelimit instances by (limit, window) to avoid allocating
      // thousands of closures per minute on high-RPS routes like /api/analyze.
      const cacheKey = `${limit}:${window}`
      let ratelimit = _ratelimitCache.get(cacheKey)
      if (!ratelimit) {
        ratelimit = new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(limit, window),
        })
        _ratelimitCache.set(cacheKey, ratelimit)
      }
      const result = await ratelimit.limit(key)
      return {
        allowed: result.success,
        limit: result.limit,
        remaining: result.remaining,
        reset: result.reset,
      }
    },
    () => {
      // Fallback during circuit-open. In-memory is per-instance only — the
      // whole point is to keep the app responsive when Redis is down. This
      // is strictly more permissive than the distributed path, but it
      // accepts the trade-off: a 30s window of degraded rate limiting is
      // much less harmful than a 30s full outage.
      log.warn({ key, limit, window }, "rate-limit circuit open — falling back to in-memory")
      return rateLimitInMemory(key, limit, window)
    },
  )
}

function rateLimitInMemory(key: string, limit: number, window: Window): RateLimitResult {
  const now = Date.now()
  if (memoryStore.size > MEMORY_STORE_MAX_KEYS) sweepExpired(now)

  const existing = memoryStore.get(key)
  let count: number
  let resetAt: number

  if (!existing || existing.resetAt <= now) {
    count = 1
    resetAt = now + windowToMs(window)
    memoryStore.set(key, { count, resetAt })
  } else {
    existing.count += 1
    count = existing.count
    resetAt = existing.resetAt
  }

  return {
    allowed: count <= limit,
    limit,
    remaining: Math.max(0, limit - count),
    reset: resetAt,
  }
}

/** Per-IP limit. When Redis is not configured, always allows. */
export async function rateLimitByIp(
  req: NextRequest,
  limit: number,
  window: `${number} s` | `${number} m` | `${number} h` | `${number} d`,
): Promise<RateLimitResult> {
  return rateLimitByKey(`ip:${getClientIp(req)}`, limit, window)
}

/** Per-account limit for authenticated routes (analyze, etc.). */
export async function rateLimitByUserId(
  userId: string,
  limit: number,
  window: `${number} s` | `${number} m` | `${number} h` | `${number} d`,
): Promise<RateLimitResult> {
  return rateLimitByKey(`user:${userId}`, limit, window)
}

/** Credential login attempts per IP — brute-force protection. */
export const LOGIN_RATE_LIMITS = {
  ipPer15Min: 10,
} as const

/**
 * Throttle credential login attempts by client IP, derived from request
 * headers. Called from within auth.ts authorize() so a rejected attempt
 * returns the standard "invalid credentials" response (returning null) —
 * never a custom 429 that would break the next-auth client's signIn() flow.
 */
export async function rateLimitLoginByHeaders(headers: Headers): Promise<RateLimitResult> {
  return rateLimitByKey(
    `login:${getClientIpFromHeaders(headers)}`,
    LOGIN_RATE_LIMITS.ipPer15Min,
    "15 m",
  )
}

/** Analyze route limits — tune COGS vs UX. */
export const ANALYZE_RATE_LIMITS = {
  ipPerHour: 15,
  freeUserPerHour: 10,
  proUserPerHour: 60,
} as const

/** Rate limit for billing endpoints (checkout, portal). */
export const BILLING_RATE_LIMITS = {
  perHour: 5,
} as const

export const FEATURE_RATE_LIMITS = {
  chatFreePerHour: 20,
  chatProPerHour: 100,
  rephraseFreePerHour: 5,
  rephraseProPerHour: 60,
} as const
