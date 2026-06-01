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
