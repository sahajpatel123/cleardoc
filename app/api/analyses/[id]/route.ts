import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getAnalysisById } from "@/lib/db"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const analysis = await getAnalysisById(session.user.id, id)
    if (!analysis) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    return NextResponse.json(analysis)
  } catch (err) {
    console.error("[analyses/[id]] error:", err)
    return NextResponse.json({ error: "Could not load analysis." }, { status: 500 })
  }
}
