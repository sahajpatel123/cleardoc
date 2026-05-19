import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getUserById } from "@/lib/db"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ freeUsesRemaining: 0, plan: "free" })
  }

  const user = await getUserById(session.user.id)
  return NextResponse.json({
    freeUsesRemaining: user?.freeUsesRemaining ?? 0,
    plan: user?.plan ?? "free",
    subscriptionStatus: user?.subscriptionStatus ?? "inactive",
  })
}
