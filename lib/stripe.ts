import Stripe from "stripe"
import { assertStripeEnv, getAppUrl } from "@/lib/env"

let _stripe: Stripe | null = null

// Lazy-initialize so a missing env var at module-load time doesn't 404 the route
export function getStripe(): Stripe {
  if (!_stripe) {
    assertStripeEnv()
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2026-02-25.clover" })
  }
  return _stripe
}

export async function createCheckoutSession(params: {
  userId: string
  userEmail: string
  stripeCustomerId?: string
}): Promise<string> {
  const { userId, userEmail, stripeCustomerId } = params

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: "ClearDoc Pro",
            description: "Unlimited document analyses",
          },
          unit_amount: 900,
          recurring: { interval: "month" },
        },
        quantity: 1,
      },
    ],
    success_url: `${getAppUrl()}/dashboard?upgraded=true`,
    cancel_url: `${getAppUrl()}/pricing`,
    metadata: { userId },
    client_reference_id: userId,
  }

  if (stripeCustomerId) {
    sessionParams.customer = stripeCustomerId
  } else {
    sessionParams.customer_email = userEmail
  }

  const session = await getStripe().checkout.sessions.create(sessionParams)
  if (!session.url) throw new Error("Stripe did not return a checkout URL")
  return session.url
}

export async function createBillingPortalSession(stripeCustomerId: string): Promise<string> {
  const session = await getStripe().billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${getAppUrl()}/dashboard`,
  })
  if (!session.url) throw new Error("Stripe did not return a portal URL")
  return session.url
}
