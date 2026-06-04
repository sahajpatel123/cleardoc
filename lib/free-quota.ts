import { getRedis } from "@/lib/redis"
import { withRedisCircuit } from "@/lib/redis-circuit"

/** Free tier: saved analyses per UTC calendar day. */
export const FREE_DAILY_ANALYSIS_LIMIT = 3

export type FreeDailyQuotaStatus = {
  limit: number
  used: number
  remaining: number
  resetsAt: string
}

export function startOfUtcDay(from = new Date()): Date {
  const d = new Date(from)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

export function nextUtcMidnight(from = new Date()): Date {
  const d = startOfUtcDay(from)
  d.setUTCDate(d.getUTCDate() + 1)
  return d
}

export function buildFreeDailyQuotaStatus(used: number): FreeDailyQuotaStatus {
  const limit = FREE_DAILY_ANALYSIS_LIMIT
  const clampedUsed = Math.min(Math.max(used, 0), limit)
  return {
    limit,
    used: clampedUsed,
    remaining: Math.max(0, limit - clampedUsed),
    resetsAt: nextUtcMidnight().toISOString(),
  }
}

export async function getFreeDailyQuotaStatus(userId: string): Promise<FreeDailyQuotaStatus> {
  const { countUserAnalysesSince } = await import("@/lib/db")
  const used = await countUserAnalysesSince(userId, startOfUtcDay())
  return buildFreeDailyQuotaStatus(used)
}

export async function checkFreeDailyQuota(
  userId: string,
): Promise<{ ok: true; status: FreeDailyQuotaStatus } | { ok: false; status: FreeDailyQuotaStatus }> {
  const status = await getFreeDailyQuotaStatus(userId)
  if (status.remaining <= 0) {
    return { ok: false, status }
  }
  return { ok: true, status }
}

export async function reserveFreeAnalysisQuota(
  userId: string,
): Promise<{ ok: true; status: FreeDailyQuotaStatus } | { ok: false; status: FreeDailyQuotaStatus }> {
  const status = await getFreeDailyQuotaStatus(userId)
  if (status.remaining <= 0) {
    return { ok: false, status }
  }

  const redis = getRedis()
  if (!redis) {
    return { ok: true, status }
  }

  const dateStr = startOfUtcDay().toISOString().slice(0, 10)
  const key = `cleardoc:quota-reserve:${userId}:${dateStr}`

  // Circuit-breaker: a transient Upstash outage would otherwise hang every
  // analyze call waiting for HTTP timeouts. The DB-side
  // saveFreeAnalysisWithQuota (lib/db.ts) still enforces the hard limit via
  // a transaction-scoped advisory lock + COUNT, so a Redis-bypass path is
  // safe — the worst case is a brief over-count which the next DB read will
  // catch. The circuit fast-fails and returns the DB-only-check fallback.
  return withRedisCircuit(
    "quota",
    async () => {
      const count = await redis.incr(key)
      if (count === 1) {
        const ttlSec = Math.max(1, Math.floor((nextUtcMidnight().getTime() - Date.now()) / 1000))
        await redis.expire(key, ttlSec)
      }
      if (count > FREE_DAILY_ANALYSIS_LIMIT) {
        await redis.decr(key)
        return { ok: false as const, status }
      }
      return { ok: true as const, status }
    },
    // Fallback: return current DB-derived status. If the user is at the
    // limit, ok=false blocks; otherwise ok=true with the DB snapshot.
    () => ({ ok: status.remaining > 0, status }),
  )
}

/** Compensating decrement: call when the DB transaction ultimately rejects
 *  the save so the Redis optimistic counter stays consistent with reality.
 *  Also call when a request is aborted/timeout to prevent permanent drift.
 */
export async function releaseFreeAnalysisQuota(userId: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  const dateStr = startOfUtcDay().toISOString().slice(0, 10)
  const key = `cleardoc:quota-reserve:${userId}:${dateStr}`
  try {
    await redis.decr(key)
  } catch {
    // Best-effort; TTL will eventually reconcile.
  }
}

/** Reconcile Redis optimistic counter with actual DB count for a user.
 *  Use this for background jobs to correct drift from aborted requests.
 *  Returns { corrected: boolean, redisCount: number, dbCount: number }
 */
export async function reconcileFreeQuota(userId: string): Promise<{ corrected: boolean; redisCount: number; dbCount: number }> {
  const redis = getRedis()
  if (!redis) return { corrected: false, redisCount: 0, dbCount: await getFreeDailyQuotaStatus(userId).then(s => s.used) }

  const dateStr = startOfUtcDay().toISOString().slice(0, 10)
  const key = `cleardoc:quota-reserve:${userId}:${dateStr}`

  const [redisCountStr, dbStatus] = await Promise.all([
    redis.get<string>(key).then(v => v ? parseInt(v, 10) : 0),
    getFreeDailyQuotaStatus(userId),
  ])

  const redisCount = redisCountStr < 0 ? 0 : redisCountStr // Clamp negative values
  const dbCount = dbStatus.used

  if (redisCount !== dbCount) {
    // Set Redis to match DB exactly
    if (dbCount >= FREE_DAILY_ANALYSIS_LIMIT) {
      await redis.set(key, FREE_DAILY_ANALYSIS_LIMIT)
    } else {
      await redis.set(key, String(dbCount))
    }
    return { corrected: true, redisCount, dbCount }
  }
  return { corrected: false, redisCount, dbCount }
}

export function formatQuotaResetLabel(iso: string): string {
  const reset = new Date(iso)
  if (Number.isNaN(reset.getTime())) return "soon"
  return reset.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  })
}
