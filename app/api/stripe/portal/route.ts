import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getOrCreateUser } from "@/lib/db"
import { createBillingPortalSession } from "@/lib/stripe"
import { rateLimitByUserId, BILLING_RATE_LIMITS } from "@/lib/rate-limit"
import { assertStripeEnv } from "@/lib/env"
import { createLogger } from "@/lib/observability"

export const runtime = "nodejs"

const log = createLogger("stripe-portal")

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

    // Fail-closed on rate-limit errors. See create-checkout for rationale.
    let rate: { allowed: boolean; reset?: number }
    try {
      rate = await rateLimitByUserId(profile.id, BILLING_RATE_LIMITS.perHour, "1 h")
    } catch (rlErr) {
      log.error({ err: rlErr, userId: profile.id }, "rate-limit check failed; failing closed")
      return NextResponse.json(
        { error: "Service temporarily unavailable. Please retry shortly." },
        { status: 503, headers: { "Retry-After": "30" } },
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

    if (!profile.stripeCustomerId) {
      return NextResponse.json({ redirectTo: "/pricing" }, { status: 200 })
    }

    const url = await createBillingPortalSession(profile.stripeCustomerId)
    return NextResponse.json({ url })
  } catch (err) {
    log.error({ err }, "stripe-portal failed")
    return NextResponse.json(
      { error: "Failed to open billing portal. Please try again." },
      { status: 500 },
    )
  }
}
