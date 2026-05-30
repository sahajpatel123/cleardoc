import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getUserAnalyses } from "@/lib/db"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const analyses = await getUserAnalyses(session.user.id)
    return NextResponse.json(analyses)
  } catch (err) {
    console.error("[analyses] error:", err)
    return NextResponse.json({ error: "Could not load analyses." }, { status: 500 })
  }
}
