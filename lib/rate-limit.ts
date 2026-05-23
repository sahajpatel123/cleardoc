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

/** Returns true if request is allowed. When Redis is not configured, always allows. */
export async function rateLimitByIp(
  req: NextRequest,
  limit: number,
  window: `${number} s` | `${number} m` | `${number} h` | `${number} d`,
): Promise<{ allowed: boolean; limit?: number; remaining?: number; reset?: number }> {
  const redis = getRedis()
  if (!redis) return { allowed: true }

  const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, window),
  })
  const ip = getClientIp(req)
  const result = await ratelimit.limit(ip)
  return {
    allowed: result.success,
    limit: result.limit,
    remaining: result.remaining,
    reset: result.reset,
  }
}
