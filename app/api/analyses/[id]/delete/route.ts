import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { generateReqId, captureException } from "@/lib/observability"
import { rateLimitByUserId } from "@/lib/rate-limit"

export const runtime = "nodejs"

/** Delete rate limit: 20 per user per hour — prevents bulk-deletion abuse. */
const DELETE_RATE_LIMIT = { max: 20, window: "1 h" as const }

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

    // Rate-limit deletes per user to prevent bulk-deletion scripts.
    const rl = await rateLimitByUserId(session.user.id, DELETE_RATE_LIMIT.max, DELETE_RATE_LIMIT.window)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many delete requests. Try again later." },
        { status: 429, headers: { "x-request-id": reqId, "Retry-After": String(Math.ceil((rl.reset ?? Date.now()) / 1000)) } },
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
      { headers: { "Cache-Control": "no-store", "x-request-id": reqId } },
    )
  } catch (err) {
    captureException(err, { component: "analyses-delete", reqId })
    return NextResponse.json(
      { error: "Failed to delete analysis." },
      { status: 500, headers: { "x-request-id": reqId } },
    )
  }
}
