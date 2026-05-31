import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { createCheckoutSession } from "@/lib/stripe"
import { getOrCreateUser } from "@/lib/db"
import { rateLimitByUserId, BILLING_RATE_LIMITS } from "@/lib/rate-limit"

export async function POST() {
  try {
    const session = await auth()
    if (!session?.user?.id || !session.user.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const profile = await getOrCreateUser(session.user.id, session.user.email)

    // Fail open: checkout is low-frequency and auth-gated, so a rate-limiter
    // outage (e.g. Upstash unreachable) must not block a paying customer.
    let rate: { allowed: boolean }
    try {
      rate = await rateLimitByUserId(profile.id, BILLING_RATE_LIMITS.perHour, "1 h")
    } catch (rlErr) {
      console.error("[create-checkout] rate-limit check failed, allowing:", rlErr)
      rate = { allowed: true }
    }
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please wait before trying again." },
        { status: 429 },
      )
    }

    const url = await createCheckoutSession({
      userId: profile.id,
      userEmail: profile.email,
      stripeCustomerId: profile.stripeCustomerId ?? undefined,
    })

    return NextResponse.json({ url })
  } catch (err) {
    console.error("[create-checkout]", err)
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    )
  }
}
