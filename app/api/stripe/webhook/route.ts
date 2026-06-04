import { NextRequest, NextResponse } from "next/server"
import { getStripe } from "@/lib/stripe"
import { prisma } from "@/lib/prisma"
import { assertStripeEnv } from "@/lib/env"
import {
  getUserByStripeCustomerId,
  upgradeUserToPro,
  updateUserSubscriptionByCustomerId,
  cancelSubscriptionForCustomer,
  recordPaymentFailure,
  evaluateSubscriptionDownshift,
} from "@/lib/db"
import { claimStripeEvent, releaseStripeEventClaim } from "@/lib/stripe-events"
import { createLogger, generateReqId, captureException } from "@/lib/observability"
import { trackWebhook } from "@/lib/webhook-inflight"
import Stripe from "stripe"

export const runtime = "nodejs"

const log = createLogger("stripe-webhook")

/**
 * Normalize Stripe subscription status to our internal status values.
 * Idempotent mapping: all subscription status transitions go through this single point.
 */
function mapSubscriptionStatus(stripeStatus: string): string {
  // Active/trialing states grant Pro access
  if (stripeStatus === "active" || stripeStatus === "trialing") {
    return "active"
  }
  // Delinquent state - tracked but doesn't auto-downgrade
  if (stripeStatus === "past_due") {
    return "past_due"
  }
  // Canceled/unpaid states
  if (stripeStatus === "canceled" || stripeStatus === "unpaid" || stripeStatus === "incomplete_expired") {
    return "cancelled"
  }
  // All other states (incomplete, canceled, unpaid, etc.) - default to inactive
  return "inactive"
}

/**
 * Stripe webhook bodies are typically <100KB. We cap at 1MB to bound
 * memory exposure and prevent an attacker from OOMing the function with
 * an oversized payload before we ever reach the signature check. Stripe
 * itself documents that webhook payloads fit in well under 256KB.
 */
const MAX_WEBHOOK_BODY_BYTES = 1_048_576

async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session
      let userId = session.metadata?.userId ?? session.client_reference_id ?? null

      if (!userId && session.customer_email) {
        const byEmail = await prisma.user.findUnique({
          where: { email: session.customer_email.trim().toLowerCase() },
        })
        userId = byEmail?.id ?? null
      }

      if (!userId) {
        // CRITICAL: Do NOT release the claim — keep it as a tombstone so ops
        // can identify unprocessed checkout events. Returning 200 tells Stripe
        // not to retry (the event is acknowledged), but the loud error log
        // triggers manual intervention.
        log.error(
          { event: "checkout.session.completed", sessionId: session.id },
          "CRITICAL: cannot resolve userId — checkout event TOMBSTONED for manual reconciliation",
        )
        return
      }

      if (!session.subscription) {
        log.error(
          { event: "checkout.session.completed", sessionId: session.id },
          "missing subscription — releasing claim for retry",
        )
        await releaseStripeEventClaim(event.id)
        throw new Error("Missing subscription in checkout session")
      }

      const customerId =
        typeof session.customer === "string" ? session.customer : session.customer?.id
      if (!customerId) {
        log.error(
          { event: "checkout.session.completed", sessionId: session.id },
          "missing customer — releasing claim for retry",
        )
        await releaseStripeEventClaim(event.id)
        throw new Error("Missing customer in checkout session")
      }

      // If subscription is not expanded, we still upgrade with what we have
      // The subscription.* webhook will update with full status later
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id

      await upgradeUserToPro(userId, customerId, subscriptionId ?? null)
      break
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id
      if (!customerId) {
        log.error(
          { event: event.type, subscriptionId: sub.id },
          "missing customer id",
        )
        break
      }
      const user = await getUserByStripeCustomerId(customerId)
      if (!user) {
        log.warn(
          { event: event.type, customerId },
          "no user found for customer — event will be dropped",
        )
        break
      }

      // IDEMPOTENT STATE MACHINE: subscription.updated NEVER downgrades Pro users.
      // It only updates subscription metadata. Payment failure tracking and any
      // necessary downgrades are handled separately by invoice.payment_failed webhook
      // which uses evaluateSubscriptionDownshift() to atomically check the failure
      // threshold before downgrading. This prevents races between:
      //   - subscription.updated (could revoke Pro on past_due)
      //   - invoice.payment_failed (could downgrade on attempt_count >= 3)
      // Both events could fire and race, causing inconsistent state.
      await updateUserSubscriptionByCustomerId(customerId, {
        stripeSubscriptionId: sub.id,
        plan: "pro", // Preserve existing Pro status; state machine handles transitions
        subscriptionStatus: mapSubscriptionStatus(sub.status),
      })

      // After status update, check if payment failure threshold has been reached
      // This is idempotent: evaluateSubscriptionDownshift only downgrades if
      // paymentFailedAttempts >= 3 AND user is currently Pro
      await evaluateSubscriptionDownshift(customerId)
      break
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id
      if (!customerId) {
        log.error(
          { event: "customer.subscription.deleted", subscriptionId: sub.id },
          "missing customer id",
        )
        break
      }
      const user = await getUserByStripeCustomerId(customerId)
      if (!user) {
        log.warn(
          { event: "customer.subscription.deleted", customerId },
          "no user found for customer — cancellation will be dropped",
        )
        break
      }

      await cancelSubscriptionForCustomer(customerId)
      break
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice
      const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id
      if (!customerId) {
        log.error(
          { event: "invoice.payment_failed", invoiceId: invoice.id },
          "missing customer id",
        )
        break
      }
      const user = await getUserByStripeCustomerId(customerId)
      if (!user) {
        log.warn(
          { event: "invoice.payment_failed", customerId },
          "no user found for customer — failure will be dropped",
        )
        break
      }

      log.warn(
        { event: "invoice.payment_failed", userId: user.id, invoiceId: invoice.id, attempt: invoice.attempt_count },
        "payment failed",
      )

      // IDEMPOTENT STATE MACHINE: Record the failure attempt and let the state machine
      // decide if downgrades are needed. This uses the same advisory lock as
      // subscription.updated, preventing race conditions. The threshold check (3 attempts)
      // and downgrade happen atomically in recordPaymentFailure/evaluateSubscriptionDownshift.
      await recordPaymentFailure(customerId, invoice.attempt_count)
      break
    }

    default:
      break
  }
}

export async function POST(req: NextRequest) {
  const reqId = generateReqId()
  const headers = { "x-request-id": reqId }

  try {
    assertStripeEnv()
  } catch (err) {
    captureException(err, { component: "stripe-webhook", reqId })
    return NextResponse.json(
      { error: "Webhook not configured" },
      { status: 500, headers },
    )
  }

  // Reject oversized payloads BEFORE buffering the body. Content-Length is
  // a hint (an attacker can omit or lie about it), but a present-and-large
  // header is the common case for an oversized request and lets us return
  // a clean 413 without allocating gigabytes. We also enforce the cap
  // unconditionally by streaming up to the limit below.
  const contentLength = req.headers.get("content-length")
  if (contentLength) {
    const length = Number(contentLength)
    if (Number.isFinite(length) && length > MAX_WEBHOOK_BODY_BYTES) {
      log.error({ reqId, contentLength, max: MAX_WEBHOOK_BODY_BYTES }, "Rejecting oversized Stripe webhook payload")
      return NextResponse.json(
        { error: "Payload too large" },
        { status: 413, headers },
      )
    }
  }

  const rawBody = await req.text()
  if (rawBody.length > MAX_WEBHOOK_BODY_BYTES) {
    log.error({ reqId, bodyLength: rawBody.length, max: MAX_WEBHOOK_BODY_BYTES }, "Rejecting Stripe webhook body exceeding size cap")
    return NextResponse.json(
      { error: "Payload too large" },
      { status: 413, headers },
    )
  }

  const sig = req.headers.get("stripe-signature")

  if (!sig) {
    return NextResponse.json(
      { error: "No signature" },
      { status: 400, headers },
    )
  }

  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!,
    )
  } catch (err) {
    captureException(err, { component: "stripe-webhook", reqId })
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 400, headers },
    )
  }

  // Belt-and-braces: reject empty event ids before claiming. An empty id would
  // create a row with id="" and break idempotency for all subsequent events.
  if (!event.id || event.id.trim().length === 0) {
    log.error({ reqId }, "Rejecting webhook with empty event id")
    return NextResponse.json({ error: "Invalid event" }, { status: 400, headers })
  }

  // Replay freshness bound: reject events older than 24 hours to prevent
  // replay attacks after the 90-day tombstone cleanup window expires.
  const eventAgeMs = Date.now() - (event.created * 1000)
  if (eventAgeMs > 24 * 60 * 60 * 1000) {
    log.warn({ reqId, eventId: event.id, type: event.type, ageHours: Math.round(eventAgeMs / 3600000) }, "Dropping stale Stripe event")
    return NextResponse.json({ received: true, dropped: true, reason: "stale" }, { headers })
  }

  // Reject test-mode events in production environments using live keys.
  const stripeSecret = process.env.STRIPE_SECRET_KEY?.trim() ?? ""
  const isLiveKey = stripeSecret.startsWith("sk_live_")
  if (isLiveKey && event.livemode === false) {
    log.warn({ reqId, eventId: event.id, type: event.type }, "Dropping test-mode Stripe event in production")
    return NextResponse.json({ received: true, dropped: true, reason: "test-mode-in-production" }, { headers })
  }

  let claimed: boolean
  try {
    claimed = await claimStripeEvent(event.id)
  } catch (err) {
    // A transient DB error here means the claim row wasn't created, so a 500
    // lets Stripe retry safely (no event is dropped). Keep the response shape
    // consistent rather than letting the throw escape as an unshaped 500.
    captureException(err, { component: "stripe-webhook", reqId })
    return NextResponse.json(
      { error: "Webhook claim failed" },
      { status: 500, headers },
    )
  }
  if (!claimed) {
    return NextResponse.json(
      { received: true, duplicate: true },
      { headers },
    )
  }

  // Track in-flight webhook for graceful shutdown draining.
  // handleStripeEvent manages claim release internally for recoverable errors.
  // For tombstone cases (e.g., missing userId), it returns without releasing
  // to leave a tombstone for manual reconciliation.
  const handlerPromise = handleStripeEvent(event)

  trackWebhook(event.id, handlerPromise)

  // Wait for handler to complete before returning response.
  // The draining logic in gracefulShutdown will also wait via trackWebhook.
  let handlerErrored = false
  try {
    await handlerPromise
  } catch (err) {
    handlerErrored = true
    // Note: handleStripeEvent already released the claim for recoverable errors
    // For tombstone cases, we intentionally leave the claim unreleased
    captureException(err, { component: "stripe-webhook", reqId, extra: { stripeEventType: event.type } })
  }

  if (handlerErrored) {
    return NextResponse.json(
      { error: "Webhook handler error" },
      { status: 500, headers },
    )
  }

  // 200 OK - event was processed or tombstoned (no release needed for tombstones)
  return NextResponse.json({ received: true }, { headers })
}
