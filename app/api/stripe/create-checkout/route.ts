import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { createCheckoutSession } from "@/lib/stripe"
import { getOrCreateUser, getUserById } from "@/lib/db"

export async function POST(_req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id || !session.user.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userId = session.user.id
    const email = session.user.email

    await getOrCreateUser(userId, email)
    const profile = await getUserById(userId)
    if (!profile) {
      return NextResponse.json(
        { error: "Failed to load user profile" },
        { status: 500 }
      )
    }

    const url = await createCheckoutSession({
      userId,
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
