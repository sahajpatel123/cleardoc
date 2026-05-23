import { prisma } from "@/lib/prisma"
import type { AnalysisResult } from "@/lib/types"

// ── User ─────────────────────────────────────────────────

export async function getOrCreateUser(id: string, email: string) {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ id }, { email }] },
  })
  if (existing) return existing

  return prisma.user.create({
    data: {
      id,
      email,
      plan: "free",
      freeUsesRemaining: 1,
      subscriptionStatus: "inactive",
    },
  })
}

export async function getUserById(id: string) {
  return prisma.user.findUnique({ where: { id } })
}

export async function getUserByStripeCustomerId(customerId: string) {
  return prisma.user.findUnique({ where: { stripeCustomerId: customerId } })
}

export type SaveAnalysisResult =
  | { ok: true; id: string }
  | { ok: false; error: "FREE_LIMIT_REACHED" }

/** Save analysis and consume one free credit atomically (skipped for Pro). */
export async function saveAnalysisWithQuota(
  userId: string,
  pro: boolean,
  documentName: string,
  documentType: string,
  result: AnalysisResult,
): Promise<SaveAnalysisResult> {
  return prisma.$transaction(async (tx) => {
    if (!pro) {
      const consumed = await tx.user.updateMany({
        where: { id: userId, plan: "free", freeUsesRemaining: { gt: 0 } },
        data: { freeUsesRemaining: { decrement: 1 } },
      })
      if (consumed.count === 0) {
        return { ok: false as const, error: "FREE_LIMIT_REACHED" as const }
      }
    }

    const created = await tx.analysis.create({
      data: { userId, documentName, documentType, result: result as object },
    })
    return { ok: true as const, id: created.id }
  })
}

export async function upgradeUserToPro(
  userId: string,
  stripeCustomerId: string,
  stripeSubscriptionId: string
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
  plan: string
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
  }
) {
  return prisma.user.update({
    where: { stripeCustomerId },
    data,
  })
}

export async function cancelSubscriptionForCustomer(stripeCustomerId: string) {
  return prisma.user.update({
    where: { stripeCustomerId },
    data: {
      plan: "free",
      subscriptionStatus: "cancelled",
      stripeSubscriptionId: null,
    },
  })
}

// ── Analysis ─────────────────────────────────────────────

export async function saveAnalysis(
  userId: string,
  documentName: string,
  documentType: string,
  result: AnalysisResult
) {
  return prisma.analysis.create({
    data: { userId, documentName, documentType, result: result as object },
  })
}

export async function getUserAnalyses(userId: string) {
  return prisma.analysis.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  })
}

export async function getAnalysisById(userId: string, analysisId: string) {
  return prisma.analysis.findFirst({
    where: { id: analysisId, userId }, // ownership enforced
  })
}
