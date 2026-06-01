import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getAnalysisById } from "@/lib/db"
import { generateReqId, captureException } from "@/lib/observability"

export const runtime = "nodejs"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
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

    const { id } = await params
    const analysis = await getAnalysisById(session.user.id, id)
    if (!analysis) {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404, headers: { "x-request-id": reqId } },
      )
    }

    return NextResponse.json(analysis, {
      headers: { "Cache-Control": "no-store", "x-request-id": reqId },
    })
  } catch (err) {
    captureException(err, { component: "analyses-id", reqId })
    return NextResponse.json(
      { error: "Could not load analysis." },
      { status: 500, headers: { "x-request-id": reqId } },
    )
  }
}
