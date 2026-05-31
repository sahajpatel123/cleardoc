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
import Stripe from "stripe"

export const runtime = "nodejs"

async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session
      let userId = session.metadata?.userId ?? session.client_reference_id ?? null

      if (!userId && session.customer_email) {
        const byEmail = await prisma.user.findFirst({
          where: { email: session.customer_email.trim().toLowerCase() },
          orderBy: { createdAt: "desc" },
        })
        userId = byEmail?.id ?? null
      }

      if (!userId) {
        // Don't consume the event — let Stripe retry until we can resolve the user.
        // This prevents the "user pays but never gets Pro" failure mode.
        console.error("[webhook] checkout.session.completed: cannot resolve userId — releasing claim for retry", session.id)
        await releaseStripeEventClaim(event.id)
        throw new Error("Cannot resolve userId for checkout session")
      }

      if (!session.subscription) {
        console.error("[webhook] checkout.session.completed: missing subscription — releasing claim for retry", session.id)
        await releaseStripeEventClaim(event.id)
        throw new Error("Missing subscription in checkout session")
      }

      const customerId =
        typeof session.customer === "string" ? session.customer : session.customer?.id
      if (!customerId) {
        console.error("[webhook] checkout.session.completed: missing customer — releasing claim for retry", session.id)
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
        console.error("[webhook] subscription event missing customer id", sub.id)
        break
      }
      const user = await getUserByStripeCustomerId(customerId)
      if (!user) {
        console.warn("[webhook] subscription.updated/created: no user found for customer", customerId, "— event will be dropped")
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
        console.error("[webhook] subscription.deleted missing customer id", sub.id)
        break
      }
      const user = await getUserByStripeCustomerId(customerId)
      if (!user) {
        console.warn("[webhook] subscription.deleted: no user found for customer", customerId, "— cancellation will be dropped")
        break
      }

      await cancelSubscriptionForCustomer(customerId)
      break
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice
      const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id
      if (!customerId) {
        console.error("[webhook] invoice.payment_failed missing customer id", invoice.id)
        break
      }
      const user = await getUserByStripeCustomerId(customerId)
      if (!user) {
        console.warn("[webhook] invoice.payment_failed: no user found for customer", customerId, "— failure will be dropped")
        break
      }

      console.warn(
        "[webhook] Payment failed for user",
        user.id,
        "- invoice:",
        invoice.id,
        "- attempt:",
        invoice.attempt_count,
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
  try {
    assertStripeEnv()
  } catch (err) {
    console.error("[webhook] Stripe env not configured:", err)
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 })
  }

  const rawBody = await req.text()
  const sig = req.headers.get("stripe-signature")

  if (!sig) {
    return NextResponse.json({ error: "No signature" }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!,
    )
  } catch (err) {
    console.error("[webhook] Signature verification failed:", err)
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  let claimed: boolean
  try {
    claimed = await claimStripeEvent(event.id)
  } catch (err) {
    // A transient DB error here means the claim row wasn't created, so a 500
    // lets Stripe retry safely (no event is dropped). Keep the response shape
    // consistent rather than letting the throw escape as an unshaped 500.
    console.error("[webhook] Claim failed:", err)
    return NextResponse.json({ error: "Webhook claim failed" }, { status: 500 })
  }
  if (!claimed) {
    return NextResponse.json({ received: true, duplicate: true })
  }

  try {
    await handleStripeEvent(event)
  } catch (err) {
    await releaseStripeEventClaim(event.id)
    console.error("[webhook] Handler error:", err)
    return NextResponse.json({ error: "Webhook handler error" }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
