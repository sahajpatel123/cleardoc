import { NextRequest, NextResponse } from "next/server"
import { createCheckoutSession } from "@/lib/stripe"
import { getUserProfile } from "@/lib/firestore"
import admin from "firebase-admin"

function getAdminApp() {
  if (admin.apps.length > 0) return admin.apps[0]!
  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  })
}

export async function POST(req: NextRequest) {
  try {
    const { idToken } = await req.json()

    if (!idToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const adminApp = getAdminApp()
    const decoded = await admin.auth(adminApp).verifyIdToken(idToken)
    const uid = decoded.uid

    const profile = await getUserProfile(uid)
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
