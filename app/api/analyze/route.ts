import { NextRequest, NextResponse } from "next/server"
import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"
import { extractDocumentFromBuffer, getFileMimeType } from "@/lib/pdf-parser"
import {
  analyzeDocument,
  CLAUDE_INVALID_JSON_ERROR_MESSAGE,
} from "@/lib/claude"
import { auth } from "@/auth"
import {
  getOrCreateUser,
  getUserById,
  decrementFreeUse,
  saveAnalysis,
} from "@/lib/db"

export async function POST(req: NextRequest) {
  try {
    if (
      process.env.UPSTASH_REDIS_REST_URL &&
      process.env.UPSTASH_REDIS_REST_TOKEN
    ) {
      const ratelimit = new Ratelimit({
        redis: Redis.fromEnv(),
        limiter: Ratelimit.slidingWindow(10, "1 h"),
      })
      const ip =
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        req.headers.get("x-real-ip") ??
        "anonymous"
      const { success } = await ratelimit.limit(ip)
      if (!success) {
        return NextResponse.json(
          { error: "Too many requests" },
          { status: 429 }
        )
      }
    }

    const formData = await req.formData()
    const file = formData.get("file") as File | null
    const context = (formData.get("context") as string) ?? ""

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 10MB." },
        { status: 400 }
      )
    }

    const session = await auth()
    const userId = session?.user?.id ?? null
    const userEmail = session?.user?.email ?? ""

    // Free tier: one-time quota. Pro users skip all free-use checks and are never decremented here.
    let userProfile = null as Awaited<ReturnType<typeof getUserById>>
    if (userId && userEmail) {
      await getOrCreateUser(userId, userEmail)
      userProfile = await getUserById(userId)
      if (
        userProfile &&
        userProfile.plan === "free" &&
        userProfile.freeUsesRemaining <= 0
      ) {
        return NextResponse.json(
          { error: "FREE_LIMIT_REACHED" },
          { status: 402 }
        )
      }
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const mimeType = getFileMimeType(file.name)
    if (mimeType === "application/octet-stream") {
      return NextResponse.json(
        { error: "Unsupported file type." },
        { status: 400 }
      )
    }

    const extracted = await extractDocumentFromBuffer(buffer, mimeType)

    let result
    if (extracted.kind === "text") {
      result = await analyzeDocument({
        mode: "text",
        documentText: extracted.text,
        userContext: context || undefined,
        documentName: file.name,
      })
    } else {
      result = await analyzeDocument({
        mode: "vision",
        mediaType: extracted.mediaType,
        base64Data: extracted.base64Data,
        userContext: context || undefined,
        documentName: file.name,
      })
    }

    let analysisId: string | null = null
    if (userId) {
      const created = await saveAnalysis(
        userId,
        file.name,
        context || "Unknown",
        result
      )
      analysisId = created.id
      if (userProfile?.plan === "free") {
        await decrementFreeUse(userId)
      }
    }

    return NextResponse.json({ result, analysisId })
  } catch (err) {
    console.error("[analyze] Error:", err)
    if (
      err instanceof Error &&
      err.message === CLAUDE_INVALID_JSON_ERROR_MESSAGE
    ) {
      return NextResponse.json(
        {
          error:
            "Analysis failed: model returned unexpected output. Please retry.",
        },
        { status: 500 }
      )
    }
    const message =
      err instanceof Error ? err.message : "Analysis failed. Please try again."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
