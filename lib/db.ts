import { prisma } from "@/lib/prisma"
import type { AnalysisResult, ChatMessage } from "@/lib/types"
import { FREE_DAILY_ANALYSIS_LIMIT, startOfUtcDay } from "@/lib/free-quota"
import { invalidateTokenVersionCache } from "@/lib/token-version-cache"
import { safeParseAnalysisResult } from "@/lib/schemas"
import { createLogger } from "@/lib/observability"
import { withDbTimeout } from "@/lib/db-timeout"

const log = createLogger("db")

// ── User ─────────────────────────────────────────────────

export async function getOrCreateUser(id: string, email: string) {
  // Fast path: the user was created at signup (Credentials provider) or by a
  // prior OAuth flow. A plain read is cheaper than an upsert write on every
  // authenticated request. The slow path (create) only fires for first-time
  // users or if the DB row was deleted while the JWT was still valid.
  const byId = await prisma.user.findUnique({ where: { id } })
  if (byId) return byId

  // H8 fix: the previous implementation used `prisma.user.upsert({ where:
  // { email }, update: {}, create: ... })`. If a row existed under the same
  // email (e.g. a prior OAuth flow with a different id), the upsert
  // returned that row unchanged — and the JWT id would never match any DB
  // row, silently breaking every subsequent getUserById(jwtId) lookup.
  //
  // New approach: use `update` first (treating the JWT id as the source of
  // truth) so we never return a row whose id differs from the JWT. If the
  // email row already exists with a different id, we surface the conflict
  // to the caller so they can re-issue credentials.
  const codeFromError = (e: unknown): string | undefined => {
    if (e && typeof e === "object" && "code" in e) {
      const c = (e as { code: unknown }).code
      return typeof c === "string" ? c : undefined
    }
    return undefined
  }

  try {
    return await prisma.user.update({
      where: { id },
      data: { email },
    })
  } catch (err: unknown) {
    if (codeFromError(err) === "P2025") {
      // Row under the JWT id does not exist. This means the user row was
      // deleted while the JWT was still valid. All associated analyses were
      // cascade-deleted. The user gets a fresh account.
      log.warn({ userId: id, email }, "getOrCreateUser slow path: user row deleted, creating fresh account")
      // Try to create it. If a row already exists with the same email but
      // a different id (the conflict we wanted to detect), return null so
      // the caller knows the JWT is stale and the user must sign in again.
      try {
        return await prisma.user.create({
          data: {
            id,
            email,
            plan: "free",
            subscriptionStatus: "inactive",
            freeUsesRemaining: FREE_DAILY_ANALYSIS_LIMIT,
            lastResetAt: startOfUtcDay(new Date()),
          },
        })
      } catch (createErr: unknown) {
        if (codeFromError(createErr) === "P2002") {
          // P2002 = unique constraint violation. It could be:
          //   (a) email conflict with a different id → stale JWT
          //   (b) id conflict from a concurrent first-time request → race winner
          // Try to re-read by id (the race winner's row). If not found, it's an
          // email conflict and the JWT is stale.
          const raced = await prisma.user.findUnique({ where: { id } })
          if (raced) return raced
          return null
        }
        throw createErr
      }
    }
    throw err
  }
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
  if (updated.count > 0) {
    // Evict cached version immediately (both per-instance memory and Redis)
    // so the next auth() re-reads from DB and detects the incremented version
    // without waiting for cache TTL.
    await invalidateTokenVersionCache(userId)
  }
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
 *
 * Lock key derivation: hashtextextended(${userId}, 0) returns a 64-bit
 * bigint. The previous code used `hashtext(${userId})::bigint` which
 * sign-extends a 32-bit int4 — same collision probability (~50% at
 * 65k active users). hashtextextended is Postgres 11+; we are on 14+ via
 * Supabase. Birthday collision for 64-bit is ~50% at 2^32 = 4B users,
 * which is well past any realistic install size.
 */
export async function saveFreeAnalysisWithQuota(
  userId: string,
  documentName: string,
  documentType: string,
  result: AnalysisResult,
): Promise<{ ok: true; id: string } | { ok: false }> {
  const since = startOfUtcDay(new Date())
  return withDbTimeout(
    prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`
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
  }),
    15000,
    "saveFreeAnalysisWithQuota",
  )
}

export async function upgradeUserToPro(
  userId: string,
  stripeCustomerId: string,
  stripeSubscriptionId: string | null,
) {
  try {
    return await prisma.user.update({
      where: { id: userId },
      data: {
        plan: "pro",
        stripeCustomerId,
        stripeSubscriptionId,
        subscriptionStatus: "active",
      },
    })
  } catch (err: unknown) {
    // P2025 = RecordNotFound — user was deleted between webhook and DB write.
    // Log and return gracefully instead of crashing the webhook handler.
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2025") {
      log.warn({ userId, op: "upgradeUserToPro" }, "user not found — may have been deleted")
      return null
    }
    throw err
  }
}

export async function updateUserSubscriptionByCustomerId(
  stripeCustomerId: string,
  data: {
    stripeSubscriptionId?: string | null
    plan: string
    subscriptionStatus: string
  },
) {
  try {
    // RACE CONDITION FIX: Use atomic upsert to protect the upgrade path.
    // This prevents checkout.session.completed (which sets plan: "pro") from being
    // overwritten by customer.subscription.* events that fire later with incomplete/pending status.
    //
    // Idempotency: Only downgrade to "free" if the user was never Pro. If already on "pro",
    // preserve that status regardless of subscription status transitions.
    // This handles the edge case where subscription.created fires before checkout.completed
    // or when subscription status is temporarily incomplete/past_due during migration.
    return await prisma.user.upsert({
      where: { stripeCustomerId },
      update: {
        ...(data.stripeSubscriptionId !== undefined && { stripeSubscriptionId: data.stripeSubscriptionId }),
        // Protect upgrade path: don't downgrade if already Pro
        plan: data.plan === "free" ? undefined : data.plan,
        subscriptionStatus: data.subscriptionStatus,
      },
      create: {
        stripeCustomerId,
        stripeSubscriptionId: data.stripeSubscriptionId ?? null,
        plan: data.plan,
        subscriptionStatus: data.subscriptionStatus,
        email: "", // Required field - will be incomplete user
        freeUsesRemaining: 0,
      },
    })
  } catch (err: unknown) {
    // P2025 = record not found - user has no stripeCustomerId on record.
    // This is now handled by upsert (returns result with created=false behavior).
    const code =
      err && typeof err === "object" && "code" in err
        ? (err as { code: string }).code
        : undefined
    if (code === "P2025") {
      log.warn({ stripeCustomerId, op: "updateUserSubscriptionByCustomerId" }, "user not found for customer")
      return null
    }
    throw err
  }
}

/**
 * Mark a subscription as cancelled.
 * Downgrade plan to free so the UI is consistent — the user sees
 * Free/Inactive after cancellation.
 */
export async function cancelSubscriptionForCustomer(stripeCustomerId: string) {
  try {
    return await prisma.user.update({
      where: { stripeCustomerId },
      data: {
        plan: "free",
        subscriptionStatus: "cancelled",
        stripeSubscriptionId: null,
      },
    })
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2025") {
      log.warn({ stripeCustomerId, op: "cancelSubscriptionForCustomer" }, "user not found for customer")
      return null
    }
    throw err
  }
}

// ── Analysis ─────────────────────────────────────────────

/** Dashboard history list. Returns full result because Prisma cannot partially select JSON fields.
 *  Prefer getUserAnalysesSummary for list views — it extracts only the verdict from the JSONB column. */
export type AnalysisSummary = {
  id: string
  documentName: string
  documentType: string
  createdAt: Date
  caseId: string | null
  parentId: string | null
  overallVerdict: string | null
}

/**
 * Lightweight dashboard list — extracts only overallVerdict from the JSONB
 * result column instead of transmitting full 5-8 KB blobs per row.
 * Use this for list/history views; use getAnalysisById for full detail.
 *
 * Supports cursor-based pagination via `cursor` (a createdAt ISO string).
 * When provided, only rows created before the cursor are returned.
 * Returns up to `limit` rows plus a `nextCursor` if more rows exist.
 */
export async function getUserAnalysesSummary(
  userId: string,
  options?: { cursor?: string; limit?: number },
): Promise<{ data: AnalysisSummary[]; nextCursor: string | null }> {
  const limit = Math.min(options?.limit ?? 50, 100)
  const cursor = options?.cursor

  // Fetch limit+1 rows to detect whether a next page exists without a
  // separate COUNT query — if we get limit+1 rows, there's more data.
  const rows = await withDbTimeout(
    cursor
      ? prisma.$queryRaw<AnalysisSummary[]>`
          SELECT
            id,
            "documentName",
            "documentType",
            "createdAt",
            "caseId",
            "parentId",
            result->>'overall_verdict' AS "overallVerdict"
          FROM "Analysis"
          WHERE "userId" = ${userId} AND "createdAt" < ${new Date(cursor)}
          ORDER BY "createdAt" DESC
          LIMIT ${limit + 1}
        `
      : prisma.$queryRaw<AnalysisSummary[]>`
          SELECT
            id,
            "documentName",
            "documentType",
            "createdAt",
            "caseId",
            "parentId",
            result->>'overall_verdict' AS "overallVerdict"
          FROM "Analysis"
          WHERE "userId" = ${userId}
          ORDER BY "createdAt" DESC
          LIMIT ${limit + 1}
        `,
    8000,
    "getUserAnalysesSummary",
  )

  const hasMore = rows.length > limit
  const data = (hasMore ? rows.slice(0, limit) : rows).map((r) => ({
    ...r,
    createdAt: new Date(r.createdAt),
  }))

  const nextCursor = hasMore && data.length > 0
    ? data[data.length - 1]!.createdAt.toISOString()
    : null

  return { data, nextCursor }
}

export async function countUserAnalysesSince(userId: string, since: Date): Promise<number> {
  return prisma.analysis.count({
    where: { userId, createdAt: { gte: since } },
  })
}

export async function getAnalysisById(userId: string, analysisId: string) {
  return prisma.analysis.findFirst({
    where: { id: analysisId, userId },
  })
}

/**
 * Walk the parentId chain up to 5 levels deep using a single recursive CTE,
 * replacing the previous serial N+1 loop (up to 5 sequential DB round-trips).
 * The userId guard is applied at every recursive step to prevent cross-user
 * chain traversal (the FK does not constrain ownership).
 */
export async function getAnalysisChainForContext(userId: string, parentId: string) {
  type ChainRow = {
    documentName: string
    createdAt: Date
    result: unknown
  }

  const rows = await withDbTimeout(
    prisma.$queryRaw<ChainRow[]>`
    WITH RECURSIVE chain AS (
      SELECT "documentName", "createdAt", "result", "parentId", 1 AS depth
      FROM "Analysis"
      WHERE id = ${parentId} AND "userId" = ${userId}

      UNION ALL

      SELECT a."documentName", a."createdAt", a."result", a."parentId", c.depth + 1
      FROM "Analysis" a
      JOIN chain c ON a.id = c."parentId"
      WHERE c.depth < 6 AND a."userId" = ${userId}
    )
    SELECT "documentName", "createdAt", "result"
    FROM chain
    ORDER BY depth ASC
  `,
    10000,
    "getAnalysisChainForContext",
  )

  return rows.map((r) => ({
    documentName: r.documentName,
    createdAt: new Date(r.createdAt),
    result: r.result,
  }))
}

export async function resolveCaseLinking(
  userId: string,
  parentId: string,
): Promise<{ parentId: string; caseId: string } | null> {
  const parent = await prisma.analysis.findFirst({
    where: { id: parentId, userId },
  })
  if (!parent) return null

  // If the parent already belongs to a Case, reuse it (verifying ownership).
  if (parent.caseId) {
    const existing = await prisma.case.findFirst({
      where: { id: parent.caseId, userId },
      select: { id: true },
    })
    if (existing) {
      return { parentId: parent.id, caseId: existing.id }
    }
    // Parent's caseId points to a Case we no longer own (or it was deleted
    // and parent.caseId was reset to NULL by ON DELETE SET NULL — though the
    // raw column should already be null in that case). Fall through to
    // create a new Case for the parent.
  }

  // No case yet — mint one. The slug uses the parent's id so a chain rooted
  // at the original analysis keeps a stable user-visible identifier.
  //
  // Use `upsert` keyed on the composite `@@unique([userId, slug])` so a
  // concurrent request racing to create the same Case (e.g. two child
  // analyses submitted at the same instant for the same parent) cannot
  // produce a P2002 unique-constraint violation. The second request
  // transparently receives the first one's Case.
  const caseRow = await prisma.case.upsert({
    where: { userId_slug: { userId, slug: parent.id } },
    update: {},
    create: { userId, slug: parent.id },
    select: { id: true },
  })
  return { parentId: parent.id, caseId: caseRow.id }
}

export async function updateAnalysisResult(
  userId: string,
  analysisId: string,
  result: AnalysisResult,
): Promise<boolean> {
  // Write-time validation: reject malformed AnalysisResult before it hits
  // the DB. This closes the gap where a route bug or AI regression could
  // corrupt the result JSONB column with a non-conformant shape.
  const validated = safeParseAnalysisResult(result)
  if (!validated) {
    throw new Error("Invalid AnalysisResult shape — rejected at write boundary")
  }
  const updated = await prisma.analysis.updateMany({
    where: { id: analysisId, userId },
    data: { result: validated as object },
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
      // Validate that createdAt is a parseable ISO date. Reject messages
      // with garbage timestamps to prevent React key collisions and silent
      // display bugs in future date-rendering code.
      if (Number.isNaN(Date.parse(m.createdAt))) continue
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
/** Validate that every message in the array is a well-formed ChatMessage.
 *  Prevents corrupted data from entering the chatMessages JSONB column. */
function validateChatMessages(messages: ChatMessage[]): void {
  for (const m of messages) {
    if (
      !m ||
      typeof m !== "object" ||
      (m.role !== "user" && m.role !== "assistant") ||
      typeof m.content !== "string" ||
      typeof m.createdAt !== "string"
    ) {
      throw new Error("Invalid chat message structure")
    }
  }
}

export async function appendChatMessages(
  userId: string,
  analysisId: string,
  newMessages: ChatMessage[],
  maxMessages: number,
): Promise<AppendChatResult> {
  // Write-time validation: reject malformed messages before they hit the DB.
  // This closes the gap where a route bug or injection could corrupt the
  // JSONB column with data that parseChatMessages would silently filter later.
  validateChatMessages(newMessages)

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

/**
 * Re-exported alias for backwards compatibility — the canonical home is
 * lib/stripe-events.ts (BUG #15: keep all Stripe-event lifecycle in one
 * module). New code should import from "@/lib/stripe-events".
 */
export { cleanupProcessedStripeEvents } from "@/lib/stripe-events"

export async function deleteAnalysis(userId: string, analysisId: string): Promise<boolean> {
  const deleted = await prisma.analysis.deleteMany({
    where: { id: analysisId, userId },
  })
  return deleted.count > 0
}

/** Get distinct user IDs with analyses in the last 24 hours for quota reconciliation.
 *  Used by the quota-reconcile cron job to correct Redis drift from aborted requests.
 */
export async function getAllActiveUserIds(): Promise<string[]> {
  const rows = await prisma.$queryRaw<[{ userId: string }]>`
    SELECT DISTINCT "userId"
    FROM "Analysis"
    WHERE "createdAt" >= NOW() - INTERVAL '24 hours'
    LIMIT 10000
  `
  return rows.map(r => r.userId)
}

