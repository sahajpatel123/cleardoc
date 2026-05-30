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
