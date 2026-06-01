import { getRedis } from "@/lib/redis"

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

  try {
    const count = await redis.incr(key)
    if (count === 1) {
      const ttlSec = Math.max(1, Math.floor((nextUtcMidnight().getTime() - Date.now()) / 1000))
      await redis.expire(key, ttlSec)
    }
    if (count > FREE_DAILY_ANALYSIS_LIMIT) {
      await redis.decr(key)
      return { ok: false, status }
    }
  } catch {
    // Redis failure — fall through to DB-only check
    return { ok: true, status }
  }

  return { ok: true, status }
}

/** Compensating decrement: call when the DB transaction ultimately rejects
 *  the save so the Redis optimistic counter stays consistent with reality.
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
