import { NextRequest, NextResponse } from "next/server"
import { getStripe } from "@/lib/stripe"
import {
  getUserByStripeCustomerId,
  upgradeUserToPro,
  updateUserSubscriptionByCustomerId,
  cancelSubscriptionForCustomer,
} from "@/lib/db"
import Stripe from "stripe"

export async function POST(req: NextRequest) {
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
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (err) {
    console.error("[webhook] Signature verification failed:", err)
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session
        const userId = session.metadata?.userId ?? session.client_reference_id
        if (!userId) break

        const subscription = await getStripe().subscriptions.retrieve(
          session.subscription as string
        )

        await upgradeUserToPro(
          userId,
          session.customer as string,
          subscription.id
        )
        break
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription
        const customerId = sub.customer as string
        const user = await getUserByStripeCustomerId(customerId)
        if (!user) break

        const isActive = sub.status === "active" || sub.status === "trialing"
        await updateUserSubscriptionByCustomerId(customerId, {
          stripeSubscriptionId: sub.id,
          plan: isActive ? "pro" : "free",
          subscriptionStatus: isActive ? "active" : "inactive",
        })
        break
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription
        const customerId = sub.customer as string
        const user = await getUserByStripeCustomerId(customerId)
        if (!user) break

        await cancelSubscriptionForCustomer(customerId)
        break
      }

      default:
        break
    }
  } catch (err) {
    console.error("[webhook] Handler error:", err)
    return NextResponse.json({ error: "Webhook handler error" }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
