import { NextRequest, NextResponse } from "next/server"
import { createCheckoutSession } from "@/lib/stripe"
import { adminGetUserProfile, adminCreateUserProfile, getAdminAuth } from "@/lib/firestore-admin"

export async function POST(req: NextRequest) {
  try {
    const { idToken } = await req.json()

    if (!idToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const decoded = await getAdminAuth().verifyIdToken(idToken)
    const uid = decoded.uid

    // Auto-create profile if missing (Google sign-in users may not have one yet
    // if the client-side write was blocked by Firestore security rules)
    let profile = await adminGetUserProfile(uid)
    if (!profile) {
      await adminCreateUserProfile(uid, decoded.email ?? "")
      profile = await adminGetUserProfile(uid)
    }
    if (!profile) {
      return NextResponse.json({ error: "Failed to create user profile" }, { status: 500 })
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
