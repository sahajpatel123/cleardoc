/**
 * Tracks in-flight Stripe webhook operations for graceful shutdown.
 * During Vercel's deploy drain window, we wait for all in-flight webhooks
 * to complete before disconnecting Prisma and exiting.
 *
 * Vercel's graceful shutdown period is typically 10-15 seconds. We use a
 * conservative 8-second wait to ensure completion before SIGKILL.
 */
import { createLogger } from "@/lib/observability"

const log = createLogger("webhook-shutdown")

const DRAIN_TIMEOUT_MS = 8000

type InFlightOperation = {
  eventId: string
  startedAt: number
  promise: Promise<unknown>
}

// Map of pending webhook operations. Keys are Stripe event IDs.
const inFlight = new Map<string, InFlightOperation>()

export function trackWebhook(eventId: string, promise: Promise<unknown>): void {
  inFlight.set(eventId, {
    eventId,
    startedAt: Date.now(),
    promise,
  })

  // Clean up when the operation completes ( success or failure)
  promise.finally(() => {
    inFlight.delete(eventId)
  })
}

export function getInFlightCount(): number {
  return inFlight.size
}

export async function drainInFlight(timeoutMs: number = DRAIN_TIMEOUT_MS): Promise<void> {
  if (inFlight.size === 0) {
    log.info({ count: 0 }, "no in-flight webhooks to drain")
    return
  }

  const eventIds = Array.from(inFlight.keys())
  log.info({ count: eventIds.length, eventIds }, "draining in-flight webhooks before shutdown")

  const promises = Array.from(inFlight.values()).map((op) => op.promise)

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Webhook drain timeout after ${timeoutMs}ms — ${inFlight.size} webhooks still in-flight`))
    }, timeoutMs)
  })

  try {
    await Promise.race([Promise.all(promises), timeoutPromise])
    log.info({ drained: inFlight.size }, "all in-flight webhooks drained successfully")
  } catch (err) {
    const remaining = inFlight.size
    log.error(
      { err: err instanceof Error ? err.message : String(err), remaining },
      "webhook drain timeout — some webhooks may not complete",
    )
    // Continue with shutdown anyway — we can't block forever
  }

  // Final count after race (some may have completed)
  if (inFlight.size > 0) {
    log.warn({ remaining: inFlight.size }, "force-exiting with in-flight webhooks still pending")
  }
}

export function isTracking(eventId: string): boolean {
  return inFlight.has(eventId)
}

export function getAgeMs(eventId: string): number | null {
  const entry = inFlight.get(eventId)
  return entry ? Date.now() - entry.startedAt : null
}