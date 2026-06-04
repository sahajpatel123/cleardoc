import { prisma } from "@/lib/prisma"
import { captureException } from "@/lib/observability"

/**
 * Claim a Stripe event id before handling. Returns false if already processed.
 * On handler failure, call releaseStripeEventClaim so Stripe retries can succeed.
 */
export async function claimStripeEvent(eventId: string): Promise<boolean> {
  try {
    await prisma.processedStripeEvent.create({ data: { id: eventId } })
    return true
  } catch (err: unknown) {
    const code =
      err && typeof err === "object" && "code" in err
        ? (err as { code: string }).code
        : undefined
    if (code === "P2002") return false
    throw err
  }
}

export async function releaseStripeEventClaim(eventId: string): Promise<void> {
  try {
    await prisma.processedStripeEvent.delete({ where: { id: eventId } })
  } catch (err: unknown) {
    const code =
      err && typeof err === "object" && "code" in err
        ? (err as { code: string }).code
        : undefined
    // P2025 = record not found - not an error, already released
    if (code !== "P2025") {
      captureException(err, {
        component: "stripe-events",
        extra: { phase: "release-claim", eventId },
      })
    }
  }
}

/**
 * Delete processed-stripe-event tombstones older than the given age. Stripe
 * retries for at most 3 days, so the standard 90-day retention gives
 * comfortable headroom for late retries while keeping the table small.
 * Called from the daily cron route (app/api/cron/cleanup/route.ts).
 *
 * Moved from lib/db.ts to keep all Stripe-event concerns (claim, release,
 * cleanup) in a single focused module — see BUG #15.
 */
export async function cleanupProcessedStripeEvents(olderThanDays: number = 90): Promise<number> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - olderThanDays)
  const deleted = await prisma.processedStripeEvent.deleteMany({
    where: { createdAt: { lt: cutoff } },
  })
  return deleted.count
}
