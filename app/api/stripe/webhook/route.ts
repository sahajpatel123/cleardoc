import { NextRequest, NextResponse } from "next/server"
import { getStripe } from "@/lib/stripe"
import { prisma } from "@/lib/prisma"
import { assertStripeEnv } from "@/lib/env"
import {
  getUserByStripeCustomerId,
  upgradeUserToPro,
  updateUserSubscriptionByCustomerId,
  cancelSubscriptionForCustomer,
} from "@/lib/db"
import { claimStripeEvent, releaseStripeEventClaim } from "@/lib/stripe-events"
import { createLogger, generateReqId, captureException } from "@/lib/observability"
import Stripe from "stripe"

export const runtime = "nodejs"

const log = createLogger("stripe-webhook")

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

      const isActive = sub.status === "active" || sub.status === "trialing"
      const isPastDue = sub.status === "past_due"
      await updateUserSubscriptionByCustomerId(customerId, {
        stripeSubscriptionId: sub.id,
        plan: isActive ? "pro" : isPastDue ? user.plan : "free",
        subscriptionStatus: isActive ? "active" : isPastDue ? "past_due" : "inactive",
      })
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

      // After 3 failed attempts, downgrade to past_due to revoke Pro access.
      // Stripe retries automatically; this prevents indefinite free Pro access.
      if (invoice.attempt_count >= 3) {
        await updateUserSubscriptionByCustomerId(customerId, {
          plan: "free",
          subscriptionStatus: "past_due",
        })
      }
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

  const rawBody = await req.text()
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

  try {
    await handleStripeEvent(event)
  } catch (err) {
    await releaseStripeEventClaim(event.id)
    captureException(err, { component: "stripe-webhook", reqId, extra: { stripeEventType: event.type } })
    return NextResponse.json(
      { error: "Webhook handler error" },
      { status: 500, headers },
    )
  }

  return NextResponse.json({ received: true }, { headers })
}
