import { NextRequest, NextResponse } from "next/server"
import { adminGetUserProfile, getAdminAuth } from "@/lib/firestore-admin"

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization")
  const idToken = authHeader?.replace("Bearer ", "")

  if (!idToken) {
    return NextResponse.json({ freeUsesRemaining: 0, plan: "free" })
  }

  try {
    const decoded = await getAdminAuth().verifyIdToken(idToken)
    const profile = await adminGetUserProfile(decoded.uid)

    return NextResponse.json({
      freeUsesRemaining: profile?.freeUsesRemaining ?? 0,
      plan: profile?.plan ?? "free",
      subscriptionStatus: profile?.subscriptionStatus ?? "inactive",
    })
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 })
  }
}
