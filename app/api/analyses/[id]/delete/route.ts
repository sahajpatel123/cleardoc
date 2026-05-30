import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params

    // Atomic ownership-scoped delete — no check-then-act TOCTOU window.
    // deleteMany only removes the row when BOTH id and userId match.
    const result = await prisma.analysis.deleteMany({
      where: { id, userId: session.user.id },
    })

    if (result.count === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    return NextResponse.json({ deleted: true })
  } catch (err) {
    console.error("[analyses/delete] Error deleting analysis:", err)
    return NextResponse.json({ error: "Failed to delete analysis." }, { status: 500 })
  }
}
