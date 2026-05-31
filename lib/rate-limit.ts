import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"
import { NextRequest } from "next/server"

function getRedis() {
  if (
    !process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    !process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  ) {
    return null
  }
  return Redis.fromEnv()
}

export function getClientIpFromHeaders(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    "anonymous"
  )
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

async function rateLimitByKey(
  key: string,
  limit: number,
  window: Window,
): Promise<RateLimitResult> {
  const redis = getRedis()
  if (!redis) {
    return rateLimitInMemory(key, limit, window)
  }

  const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, window),
  })
  const result = await ratelimit.limit(key)
  return {
    allowed: result.success,
    limit: result.limit,
    remaining: result.remaining,
    reset: result.reset,
  }
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
