import { NextRequest, NextResponse } from "next/server"
import { extractDocumentFromBuffer, getFileMimeType } from "@/lib/pdf-parser"
import { assertServerEnv } from "@/lib/env"
import { ANALYZE_RATE_LIMITS, rateLimitByIp, rateLimitByUserId } from "@/lib/rate-limit"
import {
  analyzeDocument,
  CLAUDE_INVALID_JSON_ERROR_MESSAGE,
} from "@/lib/claude"
import { auth } from "@/auth"
import {
  getOrCreateUser,
  saveAnalysisResult,
  getAnalysisChainForContext,
  resolveCaseLinking,
} from "@/lib/db"
import { checkFreeDailyQuota } from "@/lib/free-quota"
import { buildCaseContextFromAnalyses, mergeUserContextWithCase } from "@/lib/case-context"
import { isProUser } from "@/lib/user-plan"

export const runtime = "nodejs"
export const maxDuration = 60

/** Generic catch-all error for exceptions we don't want to leak. */
function genericErrorResponse(status = 500) {
  return NextResponse.json(
    { error: "Something went wrong. Please try again." },
    { status },
  )
}

export async function POST(req: NextRequest) {
  let userId: string | null = null

  try {
    assertServerEnv()

    const ipRate = await rateLimitByIp(req, ANALYZE_RATE_LIMITS.ipPerHour, "1 h")
    if (!ipRate.allowed) {
      return NextResponse.json(
        { error: "Too many requests", limit: ipRate.limit, remaining: ipRate.remaining, reset: ipRate.reset },
        { status: 429 },
      )
    }

    const formData = await req.formData()
    const file = formData.get("file") as File | null
    const context = (formData.get("context") as string) ?? ""
    const parentIdRaw = (formData.get("parentId") as string) ?? ""
    const parentId = parentIdRaw.trim() || undefined

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    const MAX_FILE_SIZE = 10 * 1024 * 1024
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.`,
          maxSize: MAX_FILE_SIZE,
        },
        { status: 400 },
      )
    }

    if (!file.name || file.name.includes("..") || file.name.includes("/")) {
      return NextResponse.json({ error: "Invalid file name" }, { status: 400 })
    }

    const MAX_FILE_NAME_LENGTH = 255
    if (file.name.length > MAX_FILE_NAME_LENGTH) {
      return NextResponse.json({ error: "File name too long." }, { status: 400 })
    }

    const MAX_CONTEXT_LENGTH = 2000
    if (context.length > MAX_CONTEXT_LENGTH) {
      return NextResponse.json(
        {
          error: `Context too long. Maximum ${MAX_CONTEXT_LENGTH} characters.`,
          maxLength: MAX_CONTEXT_LENGTH,
        },
        { status: 400 },
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

    userId = userProfile.id
    const pro = isProUser(userProfile)

    let caseLink: { parentId: string; caseId: string } | undefined
    if (parentId) {
      if (!pro) {
        return NextResponse.json(
          { error: "Case linking is available on Pro. Upgrade to connect follow-up documents." },
          { status: 403 },
        )
      }
      const resolved = await resolveCaseLinking(userId, parentId)
      if (!resolved) {
        return NextResponse.json({ error: "Previous analysis not found." }, { status: 404 })
      }
      caseLink = resolved
    }

    const userRate = await rateLimitByUserId(
      userId,
      pro ? ANALYZE_RATE_LIMITS.proUserPerHour : ANALYZE_RATE_LIMITS.freeUserPerHour,
      "1 h",
    )
    if (!userRate.allowed) {
      return NextResponse.json(
        {
          error: "Too many analyses. Please wait before trying again.",
          limit: userRate.limit,
          remaining: userRate.remaining,
          reset: userRate.reset,
        },
        { status: 429 },
      )
    }

    if (!pro) {
      const quota = await checkFreeDailyQuota(userId)
      if (!quota.ok) {
        return NextResponse.json(
          {
            error: "FREE_DAILY_LIMIT_REACHED",
            code: "FREE_DAILY_LIMIT_REACHED",
            limit: quota.status.limit,
            used: quota.status.used,
            remaining: quota.status.remaining,
            resetsAt: quota.status.resetsAt,
          },
          { status: 402 },
        )
      }
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const mimeType = getFileMimeType(file.name)
    if (mimeType === "application/octet-stream") {
      return NextResponse.json({ error: "Unsupported file type." }, { status: 400 })
    }

    const extracted = await extractDocumentFromBuffer(buffer, mimeType)

    let enrichedContext = context || undefined
    if (caseLink) {
      const chain = await getAnalysisChainForContext(userId, caseLink.parentId)
      const caseContext = buildCaseContextFromAnalyses(chain)
      enrichedContext = mergeUserContextWithCase(context, caseContext)
    }

    let result
    try {
      if (extracted.kind === "text") {
        result = await analyzeDocument({
          mode: "text",
          documentText: extracted.text,
          userContext: enrichedContext,
          documentName: file.name,
        })
      } else {
        result = await analyzeDocument({
          mode: "vision",
          mediaType: extracted.mediaType,
          base64Data: extracted.base64Data,
          userContext: enrichedContext,
          documentName: file.name,
        })
      }
    } catch (modelErr: unknown) {
      console.error("[analyze] Model error:", modelErr)
      let errorMessage = "Analysis failed. Please try again."
      const status = 500
      if (modelErr instanceof Error) {
        if (modelErr.message === CLAUDE_INVALID_JSON_ERROR_MESSAGE) {
          errorMessage = "Analysis failed: model returned unexpected output. Please retry."
        }
      }
      return NextResponse.json({ error: errorMessage }, { status })
    }

    const saved = await saveAnalysisResult(
      userId,
      file.name,
      context || "Unknown",
      result,
      caseLink
        ? { parentId: caseLink.parentId, caseId: caseLink.caseId }
        : undefined,
    )
    return NextResponse.json({ result, analysisId: saved.id })
  } catch (err: unknown) {
    console.error("[analyze] Error:", err)
    return genericErrorResponse(500)
  }
}
