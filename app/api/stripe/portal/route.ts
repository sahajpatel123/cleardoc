import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getOrCreateUser } from "@/lib/db"
import { createBillingPortalSession } from "@/lib/stripe"

export async function POST() {
  try {
    const session = await auth()
    if (!session?.user?.id || !session.user.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const profile = await getOrCreateUser(session.user.id, session.user.email)
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
