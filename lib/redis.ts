/**
 * Centralized Redis client (Upstash). All server-side persistent state —
 * rate limits, token version cache, future caches — flows through this
 * single client to avoid 6+ independent connections.
 *
 * In dev, when UPSTASH_* env vars are missing, returns null and callers
 * must either use a local-only path or refuse to operate. We do NOT fall
 * back to an in-memory shim here because doing so silently turns a
 * distributed system into a per-instance toy.
 */
import { Redis } from "@upstash/redis"

let _redis: Redis | null | undefined

export function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (!url || !token) {
    _redis = null
    return null
  }
  _redis = new Redis({ url, token })
  return _redis
}

/** True if the production-only Upstash guard will fail at boot. */
export function isProductionRedisConfigured(): boolean {
  return !!process.env.UPSTASH_REDIS_REST_URL?.trim() &&
    !!process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
}

/** Reset the cached client — only for tests. */
export function __resetRedisForTests(): void {
  _redis = undefined
}
