import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { createCheckoutSession } from "@/lib/stripe"
import { getOrCreateUser } from "@/lib/db"
import { rateLimitByUserId, BILLING_RATE_LIMITS } from "@/lib/rate-limit"
import { assertStripeEnv } from "@/lib/env"
import { createLogger } from "@/lib/observability"

export const runtime = "nodejs"

const log = createLogger("stripe-checkout")

export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? ""
  if (!contentType.startsWith("application/json")) {
    return NextResponse.json({ error: "Unsupported Media Type" }, { status: 415 })
  }

  try {
    assertStripeEnv()
    const session = await auth()
    if (!session?.user?.id || !session.user.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const profile = await getOrCreateUser(session.user.id, session.user.email)
    if (!profile) {
      return NextResponse.json(
        { error: "Session stale. Please sign in again." },
        { status: 401 },
      )
    }

    // FAIL-CLOSED on rate-limit errors. A paying customer being told
    // "service unavailable, retry in 30s" is far less harmful than an
    // attacker spamming Checkout endpoints during a rate-limiter outage
    // (which would generate hundreds of Stripe emails, hit Stripe API rate
    // limits, and create support load). The previous fail-open was a
    // bug — payment endpoints are the most abuse-attractive paths.
    let rate: { allowed: boolean; reset?: number }
    try {
      rate = await rateLimitByUserId(profile.id, BILLING_RATE_LIMITS.perHour, "1 h")
    } catch (rlErr) {
      log.error({ err: rlErr, userId: profile.id }, "rate-limit check failed; failing closed")
      const retryAfter = 30
      return NextResponse.json(
        { error: "Service temporarily unavailable. Please retry shortly." },
        { status: 503, headers: { "Retry-After": String(retryAfter) } },
      )
    }
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please wait before trying again." },
        {
          status: 429,
          headers: rate.reset ? { "Retry-After": String(Math.max(1, Math.ceil((rate.reset - Date.now()) / 1000))) } : {},
        },
      )
    }

    const url = await createCheckoutSession({
      userId: profile.id,
      userEmail: profile.email,
      stripeCustomerId: profile.stripeCustomerId ?? undefined,
    })

    return NextResponse.json({ url })
  } catch (err) {
    log.error({ err }, "create-checkout failed")
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    )
  }
}
