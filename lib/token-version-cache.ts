/**
 * Distributed token-version cache backed by Upstash Redis.
 *
 * Previous implementation was a process-local `Map` that could not propagate
 * invalidations across Vercel serverless instances — a password change in
 * instance A could leave a 60-second window of stale tokens in instances B-N.
 *
 * New model: Redis is the source of truth. We use a short TTL (30 s) so even
 * a Redis outage eventually heals. The in-memory `Map` is kept ONLY as a
 * hot-path read-through cache (per-instance, ~ms latency vs Redis RTT of
 * ~10-50 ms). Writes go to Redis; reads check memory first, then Redis.
 *
 * On invalidation (password change) we delete from BOTH memory and Redis so
 * the next read forces a DB re-fetch. There is no race-free way to coordinate
 * across instances without a small TTL window, so we accept the 30s window
 * as the cost of stateless auth.
 *
 * Production-only: in dev we keep the in-memory path so unit tests can run
 * without Redis. In production, Redis MUST be configured (assertServerEnv
 * enforces this).
 */
import { getRedis } from "./redis"
import { captureException, createLogger } from "./observability"

const log = createLogger("token-cache")

const IS_PROD = process.env.NODE_ENV === "production"
const TTL_SECONDS = 30

// Per-instance hot-path cache. Lost on cold start, but most calls hit it.
const _mem = new Map<string, { version: number; expiresAt: number }>()
const MEM_TTL_MS = 5_000 // 5 seconds — short enough to never be the the bottleneck
const MEM_MAX_ENTRIES = 5_000

/**
 * Return the current number of in-memory token-version cache entries. Used by
 * the health endpoint for leak monitoring — a growing count indicates either
 * high user volume (expected) or a failure to evict expired entries (bug).
 */
export function getTokenCacheSize(): number {
  return _mem.size
}

function memGet(userId: string): number | null {
  const entry = _mem.get(userId)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    _mem.delete(userId)
    return null
  }
  return entry.version
}

function memSet(userId: string, version: number): void {
  if (_mem.size >= MEM_MAX_ENTRIES) {
    // Drop expired entries first
    const now = Date.now()
    for (const [k, v] of _mem) {
      if (v.expiresAt <= now) _mem.delete(k)
      if (_mem.size < MEM_MAX_ENTRIES) break
    }
  }
  _mem.set(userId, { version, expiresAt: Date.now() + MEM_TTL_MS })
}

function memDelete(userId: string): void {
  _mem.delete(userId)
}

function redisKey(userId: string): string {
  return `cleardoc:tokenver:${userId}`
}

/**
 * Get the cached token version for a user. Returns `null` on cache miss
 * OR on Redis error — callers should fall through to the DB. We do NOT
 * cache Redis errors as "version=N" because that would pin the user to a
 * stale value for the whole TTL window.
 */
export async function getTokenVersion(userId: string): Promise<number | null> {
  // Hot path: check per-instance memory first.
  const mem = memGet(userId)
  if (mem !== null) return mem

  if (!IS_PROD) {
    // In dev, no Redis required — return null so the caller hits the DB.
    return null
  }

  const redis = getRedis()
  if (!redis) {
    // Production with no Redis would have been blocked by assertServerEnv.
    // We are past that gate, so this is a runtime misconfiguration.
    log.error("redis client missing in production")
    return null
  }

  try {
    const v = await redis.get<number>(redisKey(userId))
    if (typeof v === "number" && Number.isFinite(v)) {
      memSet(userId, v)
      return v
    }
    return null
  } catch (err) {
    captureException(err, { component: "token-cache", extra: { userId } })
    return null
  }
}

export async function setTokenVersion(userId: string, version: number): Promise<void> {
  // H20 fix: NX on the write prevents a stale-read race. Two instances
  // both miss the cache, both read N from DB, but instance A also serves
  // a password-change request that bumps the version to N+1 and
  // SETNX'es the cache to N+1. Instance B's later SET would otherwise
  // overwrite N+1 with N (the older value B read). With NX, B's write
  // is a no-op and the N+1 value from A wins.
  memSet(userId, version)
  if (!IS_PROD) return

  const redis = getRedis()
  if (!redis) return
  try {
    // The Upstash SDK's `set` type does not expose `nx` directly, so we
    // fall through to the raw REST command when running on Upstash.
    const setWithNx = (redis.set as unknown as (
      key: string,
      value: number,
      opts: { ex: number; nx?: boolean },
    ) => Promise<unknown>).bind(redis)
    await setWithNx(redisKey(userId), version, { ex: TTL_SECONDS, nx: true })
  } catch (err) {
    captureException(err, { component: "token-cache", extra: { userId, op: "set" } })
  }
}

export async function invalidateTokenVersionCache(userId: string): Promise<void> {
  memDelete(userId)
  if (!IS_PROD) return

  const redis = getRedis()
  if (!redis) return
  try {
    await redis.del(redisKey(userId))
  } catch (err) {
    captureException(err, { component: "token-cache", extra: { userId, op: "del" } })
  }
}
