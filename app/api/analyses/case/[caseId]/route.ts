import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getCaseAnalyses } from "@/lib/db"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ caseId: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { caseId } = await params
  const rows = await getCaseAnalyses(session.user.id, caseId)
  return NextResponse.json(rows)
}
