import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getOrCreateUser } from "@/lib/db"
import { createBillingPortalSession } from "@/lib/stripe"
import { rateLimitByUserId, BILLING_RATE_LIMITS } from "@/lib/rate-limit"

export async function POST() {
  try {
    const session = await auth()
    if (!session?.user?.id || !session.user.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const profile = await getOrCreateUser(session.user.id, session.user.email)

    // Fail open: the billing portal is low-frequency and auth-gated, so a
    // rate-limiter outage must not lock a customer out of managing their plan.
    let rate: { allowed: boolean }
    try {
      rate = await rateLimitByUserId(profile.id, BILLING_RATE_LIMITS.perHour, "1 h")
    } catch (rlErr) {
      console.error("[stripe/portal] rate-limit check failed, allowing:", rlErr)
      rate = { allowed: true }
    }
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please wait before trying again." },
        { status: 429 },
      )
    }

    if (!profile.stripeCustomerId) {
      return NextResponse.json(
        { error: "No billing account found. Subscribe to Pro first." },
        { status: 400 },
      )
    }

    const url = await createBillingPortalSession(profile.stripeCustomerId)
    return NextResponse.json({ url })
  } catch (err) {
    console.error("[stripe/portal]", err)
    return NextResponse.json(
      { error: "Failed to open billing portal. Please try again." },
      { status: 500 },
    )
  }
}
