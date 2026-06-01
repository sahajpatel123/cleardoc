import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { generateReqId, captureException } from "@/lib/observability"

export const runtime = "nodejs"

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
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

    // Atomic ownership-scoped delete — no check-then-act TOCTOU window.
    // deleteMany only removes the row when BOTH id and userId match.
    const result = await prisma.analysis.deleteMany({
      where: { id, userId: session.user.id },
    })

    if (result.count === 0) {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404, headers: { "x-request-id": reqId } },
      )
    }

    return NextResponse.json(
      { deleted: true },
      { headers: { "x-request-id": reqId } },
    )
  } catch (err) {
    captureException(err, { component: "analyses-delete", reqId })
    return NextResponse.json(
      { error: "Failed to delete analysis." },
      { status: 500, headers: { "x-request-id": reqId } },
    )
  }
}
