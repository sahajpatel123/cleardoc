import { prisma } from "@/lib/prisma"
import type { AnalysisResult, ChatMessage } from "@/lib/types"
import { FREE_DAILY_ANALYSIS_LIMIT, startOfUtcDay } from "@/lib/free-quota"
import { ensureDatabaseSchema } from "@/lib/ensure-schema"

// ── User ─────────────────────────────────────────────────

export async function getOrCreateUser(id: string, email: string) {
  await ensureDatabaseSchema()
  // Atomic upsert — no separate findUnique that would create a TOCTOU race
  return prisma.user.upsert({
    where: { email },
    update: {}, // existing user — do not mutate
    create: {
      id,
      email,
      plan: "free",
      subscriptionStatus: "inactive",
      freeUsesRemaining: FREE_DAILY_ANALYSIS_LIMIT,
      lastResetAt: startOfUtcDay(new Date()),
    },
  })
}

export async function getUserById(id: string) {
  return prisma.user.findUnique({ where: { id } })
}

export async function getUserByStripeCustomerId(customerId: string) {
  return prisma.user.findUnique({ where: { stripeCustomerId: customerId } })
}

/** Bump tokenVersion when password changes to invalidate stale JWTs. */
export async function incrementTokenVersion(userId: string): Promise<boolean> {
  const updated = await prisma.user.updateMany({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  })
  return updated.count > 0
}

/** Persist analysis JSON after quota was already reserved (or for Pro users). */
export async function saveAnalysisResult(
  userId: string,
  documentName: string,
  documentType: string,
  result: AnalysisResult,
  opts?: { parentId?: string; caseId?: string },
): Promise<{ id: string }> {
  await ensureDatabaseSchema()
  const created = await prisma.analysis.create({
    data: {
      userId,
      documentName,
      documentType,
      result: result as object,
      parentId: opts?.parentId ?? null,
      caseId: opts?.caseId ?? null,
    },
  })
  return { id: created.id }
}

/**
 * Atomically enforce the free daily quota AND persist the analysis in one
 * transaction. A per-user transaction-scoped advisory lock serializes
 * concurrent saves for the same user, so the row count is authoritative and
 * the check-then-insert race (two concurrent requests both passing a plain
 * COUNT) cannot exceed the limit. Pro users do not use this path.
 *
 * Returns { ok: false } when the user is already at the daily limit — the
 * caller should surface a 402 and NOT save. The lock auto-releases on
 * commit/rollback, so there is nothing to clean up on error.
 */
export async function saveFreeAnalysisWithQuota(
  userId: string,
  documentName: string,
  documentType: string,
  result: AnalysisResult,
): Promise<{ ok: true; id: string } | { ok: false }> {
  await ensureDatabaseSchema()
  const since = startOfUtcDay(new Date())
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`
    const used = await tx.analysis.count({
      where: { userId, createdAt: { gte: since } },
    })
    if (used >= FREE_DAILY_ANALYSIS_LIMIT) {
      return { ok: false as const }
    }
    const created = await tx.analysis.create({
      data: {
        userId,
        documentName,
        documentType,
        result: result as object,
      },
    })
    return { ok: true as const, id: created.id }
  })
}

export async function upgradeUserToPro(
  userId: string,
  stripeCustomerId: string,
  stripeSubscriptionId: string,
) {
  return prisma.user.update({
    where: { id: userId },
    data: {
      plan: "pro",
      stripeCustomerId,
      stripeSubscriptionId,
      subscriptionStatus: "active",
    },
  })
}

export async function updateUserSubscriptionStatus(
  stripeCustomerId: string,
  status: string,
  plan: string,
) {
  return prisma.user.update({
    where: { stripeCustomerId },
    data: { subscriptionStatus: status, plan },
  })
}

export async function updateUserSubscriptionByCustomerId(
  stripeCustomerId: string,
  data: {
    stripeSubscriptionId?: string | null
    plan: string
    subscriptionStatus: string
  },
) {
  return prisma.user.update({
    where: { stripeCustomerId },
    data,
  })
}

/**
 * Mark a subscription as cancelled.
 * We keep plan="pro" so the user still sees "Pro" in their UI,
 * but subscriptionStatus="cancelled" blocks Pro access immediately
 * via isProUser. In a future billing-period-end flow, this could
 * defer status change until current_period_end.
 */
export async function cancelSubscriptionForCustomer(stripeCustomerId: string) {
  return prisma.user.update({
    where: { stripeCustomerId },
    data: {
      plan: "pro",
      subscriptionStatus: "cancelled",
      stripeSubscriptionId: null,
    },
  })
}

// ── Analysis ─────────────────────────────────────────────

/** Dashboard history list. Returns full result because Prisma cannot partially select JSON fields.
 *  If bandwidth becomes problematic at scale, add `overallVerdict` column to Analysis table. */
export async function getUserAnalyses(userId: string) {
  await ensureDatabaseSchema()
  return prisma.analysis.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 100, // bounded — prevents unbounded payload
  })
}

export async function countUserAnalysesSince(userId: string, since: Date): Promise<number> {
  return prisma.analysis.count({
    where: { userId, createdAt: { gte: since } },
  })
}

export async function getAnalysisById(userId: string, analysisId: string) {
  await ensureDatabaseSchema()
  return prisma.analysis.findFirst({
    where: { id: analysisId, userId },
  })
}

export async function getAnalysisChainForContext(userId: string, parentId: string) {
  const chain: Array<{ documentName: string; createdAt: Date; result: unknown }> = []
  let currentId: string | null = parentId
  const seen = new Set<string>()

  while (currentId && !seen.has(currentId) && chain.length < 5) {
    seen.add(currentId)
    const row: Awaited<ReturnType<typeof prisma.analysis.findFirst>> = await prisma.analysis.findFirst({
      where: { id: currentId, userId },
    })
    if (!row) break
    chain.unshift({
      documentName: row.documentName,
      createdAt: row.createdAt,
      result: row.result,
    })
    currentId = row.parentId
  }

  return chain
}

export async function resolveCaseLinking(
  userId: string,
  parentId: string,
): Promise<{ parentId: string; caseId: string } | null> {
  const parent = await prisma.analysis.findFirst({
    where: { id: parentId, userId },
  })
  if (!parent) return null
  return {
    parentId: parent.id,
    caseId: parent.caseId ?? parent.id,
  }
}

export async function updateAnalysisResult(
  userId: string,
  analysisId: string,
  result: AnalysisResult,
): Promise<boolean> {
  const updated = await prisma.analysis.updateMany({
    where: { id: analysisId, userId },
    data: { result: result as object },
  })
  return updated.count > 0
}

export function parseChatMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return []
  const out: ChatMessage[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const m = item as Record<string, unknown>
    if (
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string" &&
      typeof m.createdAt === "string"
    ) {
      out.push({ role: m.role, content: m.content, createdAt: m.createdAt })
    }
  }
  return out
}

export type AppendChatResult =
  | { ok: true; messages: ChatMessage[] }
  | { ok: false; reason: "limit" | "missing" }

/**
 * Append chat messages atomically using PostgreSQL jsonb concatenation. The
 * per-analysis cap is enforced INSIDE the same statement (jsonb_array_length
 * guard with RETURNING), so concurrent requests cannot push the stored history
 * past the cap — closing the check-then-act race the route's pre-check alone
 * left open. Returns the merged messages on success, or a reason on no-op.
 */
export async function appendChatMessages(
  userId: string,
  analysisId: string,
  newMessages: ChatMessage[],
  maxMessages: number,
): Promise<AppendChatResult> {
  const updated = await prisma.$queryRaw<Array<{ chatMessages: unknown }>>`
    UPDATE "Analysis"
    SET "chatMessages" = COALESCE("chatMessages", '[]'::jsonb) || ${JSON.stringify(newMessages)}::jsonb
    WHERE id = ${analysisId}
      AND "userId" = ${userId}
      AND jsonb_array_length(COALESCE("chatMessages", '[]'::jsonb)) < ${maxMessages}
    RETURNING "chatMessages"
  `
  if (updated.length > 0) {
    return { ok: true, messages: parseChatMessages(updated[0].chatMessages) }
  }
  // No row updated: the analysis is either at/over the cap, or gone (deleted
  // concurrently / not owned). Distinguish so the route returns 402 vs 404.
  const row = await getAnalysisById(userId, analysisId)
  return { ok: false, reason: row ? "limit" : "missing" }
}

export async function getCaseAnalyses(userId: string, caseId: string) {
  return prisma.analysis.findMany({
    where: { userId, caseId },
    orderBy: { createdAt: "asc" },
    take: 100, // bounded
  })
}

export async function listAnalysesForCasePicker(userId: string) {
  return prisma.analysis.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      documentName: true,
      createdAt: true,
      caseId: true,
    },
    take: 50,
  })
}

export async function cleanupProcessedStripeEvents(olderThanDays: number = 90): Promise<number> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - olderThanDays)
  const deleted = await prisma.processedStripeEvent.deleteMany({
    where: { createdAt: { lt: cutoff } },
  })
  return deleted.count
}

export async function deleteAnalysis(userId: string, analysisId: string): Promise<boolean> {
  const deleted = await prisma.analysis.deleteMany({
    where: { id: analysisId, userId },
  })
  return deleted.count > 0
}

