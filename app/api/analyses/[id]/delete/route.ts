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

    // Verify ownership before deletion
    const analysis = await prisma.analysis.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    })

    if (!analysis) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    // Delete the analysis
    await prisma.analysis.delete({
      where: { id },
    })

    return NextResponse.json({ deleted: true })
  } catch (err) {
    console.error("[analyses/delete] Error deleting analysis:", err)
    return NextResponse.json({ error: "Failed to delete analysis." }, { status: 500 })
  }
}
