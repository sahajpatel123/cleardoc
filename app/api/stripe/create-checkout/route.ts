import { NextRequest, NextResponse } from "next/server"
import { createCheckoutSession } from "@/lib/stripe"
import { adminGetUserProfile, getAdminAuth } from "@/lib/firestore-admin"

export async function POST(req: NextRequest) {
  try {
    const { idToken } = await req.json()

    if (!idToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const decoded = await getAdminAuth().verifyIdToken(idToken)
    const uid = decoded.uid

    const profile = await adminGetUserProfile(uid)
    if (!profile) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const url = await createCheckoutSession({
      userId: uid,
      userEmail: profile.email,
      stripeCustomerId: profile.stripeCustomerId,
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
