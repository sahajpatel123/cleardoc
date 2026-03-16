import { NextRequest, NextResponse } from "next/server"
import { adminGetUserProfile } from "@/lib/firestore-admin"
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

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization")
  const idToken = authHeader?.replace("Bearer ", "")

  if (!idToken) {
    return NextResponse.json({ freeUsesRemaining: 0, plan: "free" })
  }

  try {
    const adminApp = getAdminApp()
    const decoded = await admin.auth(adminApp).verifyIdToken(idToken)
    const profile = await adminGetUserProfile(decoded.uid)

    return NextResponse.json({
      freeUsesRemaining: profile?.freeUsesRemaining ?? 0,
      plan: profile?.plan ?? "free",
      subscriptionStatus: profile?.subscriptionStatus ?? "inactive",
    })
  } catch {
    return NextResponse.json({ freeUsesRemaining: 0, plan: "free" })
  }
}
