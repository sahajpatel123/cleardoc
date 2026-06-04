import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getCaseAnalyses } from "@/lib/db"
import { generateReqId, captureException } from "@/lib/observability"

export const runtime = "nodejs"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ caseId: string }> },
) {
  const reqId = generateReqId()
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: { "x-request-id": reqId } },
      )
    }

    const { caseId } = await params
    const rows = await getCaseAnalyses(session.user.id, caseId)
    return NextResponse.json(rows, { headers: { "Cache-Control": "no-store", "x-request-id": reqId } })
  } catch (err) {
    captureException(err, { component: "analyses-case", reqId })
    return NextResponse.json(
      { error: "Could not load case." },
      { status: 500, headers: { "x-request-id": reqId } },
    )
  }
}
