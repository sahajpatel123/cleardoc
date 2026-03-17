import Stripe from "stripe"

// Lazy-initialize so a missing env var at module-load time doesn't 404 the route
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set")
  return new Stripe(key, { apiVersion: "2026-02-25.clover" })
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
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?upgraded=true`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/pricing`,
    metadata: { userId },
    client_reference_id: userId,
  }

  if (stripeCustomerId) {
    sessionParams.customer = stripeCustomerId
  } else {
    sessionParams.customer_email = userEmail
  }

  const session = await getStripe().checkout.sessions.create(sessionParams)
  return session.url!
}
