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

export function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "anonymous"
  )
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
  for (const [key, entry] of memoryStore) {
    if (entry.resetAt <= now) memoryStore.delete(key)
  }
}

function rateLimitInMemory(key: string, limit: number, window: Window): RateLimitResult {
  const now = Date.now()
  if (memoryStore.size > MEMORY_STORE_MAX_KEYS) sweepExpired(now)

  let entry = memoryStore.get(key)
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowToMs(window) }
    memoryStore.set(key, entry)
  }
  entry.count += 1

  return {
    allowed: entry.count <= limit,
    limit,
    remaining: Math.max(0, limit - entry.count),
    reset: entry.resetAt,
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

/** Analyze route limits — tune COGS vs UX. */
export const ANALYZE_RATE_LIMITS = {
  ipPerHour: 15,
  freeUserPerHour: 10,
  proUserPerHour: 60,
} as const

export const FEATURE_RATE_LIMITS = {
  chatFreePerHour: 20,
  chatProPerHour: 100,
  rephraseFreePerHour: 5,
  rephraseProPerHour: 60,
} as const
