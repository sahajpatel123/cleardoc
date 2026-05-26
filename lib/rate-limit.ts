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

async function rateLimitByKey(
  key: string,
  limit: number,
  window: `${number} s` | `${number} m` | `${number} h` | `${number} d`,
): Promise<RateLimitResult> {
  const redis = getRedis()
  if (!redis) return { allowed: true }

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

/** Analyze route limits — tune COGS vs UX. */
export const ANALYZE_RATE_LIMITS = {
  ipPerHour: 15,
  freeUserPerHour: 10,
  proUserPerHour: 60,
} as const
