import { NextRequest, NextResponse } from "next/server"
import { extractDocumentFromBuffer, getFileMimeType } from "@/lib/pdf-parser"
import { assertServerEnv } from "@/lib/env"
import { rateLimitByIp } from "@/lib/rate-limit"
import {
  analyzeDocument,
  CLAUDE_INVALID_JSON_ERROR_MESSAGE,
} from "@/lib/claude"
import { auth } from "@/auth"
import { getOrCreateUser, saveAnalysisWithQuota } from "@/lib/db"
import { isProUser } from "@/lib/user-plan"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  try {
    assertServerEnv()

    const rate = await rateLimitByIp(req, 15, "1 h")
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many requests", limit: rate.limit, remaining: rate.remaining, reset: rate.reset },
        { status: 429 },
      )
    }

    const formData = await req.formData()
    const file = formData.get("file") as File | null
    const context = (formData.get("context") as string) ?? ""

    // Improved file validation
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    // Enhanced file size validation with better error messages
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.`,
          maxSize: MAX_FILE_SIZE
        },
        { status: 400 }
      )
    }

    // Validate file name to prevent path traversal
    if (!file.name || file.name.includes('..') || file.name.includes('/')) {
      return NextResponse.json(
        { error: "Invalid file name" },
        { status: 400 }
      )
    }

    const session = await auth()
    if (!session?.user?.id || !session.user.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userEmail = session.user.email

    let userProfile: Awaited<ReturnType<typeof getOrCreateUser>>
    try {
      userProfile = await getOrCreateUser(session.user.id, userEmail)
    } catch (err) {
      console.error("[analyze] User lookup failed:", err)
      return NextResponse.json(
        { error: "Could not load your account. Please sign in again." },
        { status: 500 },
      )
    }

    const userId = userProfile.id

    const pro = isProUser(userProfile)
    if (!pro && userProfile.freeUsesRemaining <= 0) {
      return NextResponse.json(
        { error: "FREE_LIMIT_REACHED" },
        { status: 402 },
      )
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

    const saved = await saveAnalysisWithQuota(
      userId,
      pro,
      file.name,
      context || "Unknown",
      result,
    )
    if (!saved.ok) {
      return NextResponse.json(
        { error: "FREE_LIMIT_REACHED" },
        { status: 402 },
      )
    }

    return NextResponse.json({ result, analysisId: saved.id })
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
