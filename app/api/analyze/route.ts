// Bug #7 fix: Sharp image processing uses libuv threadpool threads. The default
// pool size is 4, which is insufficient when 5 concurrent image analyses (matching
// the AI semaphore) each run sharp operations — DNS lookups and other I/O can
// stall. UV_THREADPOOL_SIZE can only be set before the first libuv operation, so
// it must be the very first executable statement in this module, before any imports
// that may trigger libuv work (e.g., sharp, crypto, dns, net).
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || "8"

import { NextRequest, NextResponse } from "next/server"
import { createHash } from "node:crypto"
import { extractDocumentFromBuffer, getFileMimeType } from "@/lib/pdf-parser"
import { assertServerEnv, isValidOrigin } from "@/lib/env"
import { ANALYZE_RATE_LIMITS, rateLimitByIp, rateLimitByUserId } from "@/lib/rate-limit"
import {
  analyzeDocument,
  AI_INVALID_JSON_ERROR_MESSAGE,
} from "@/lib/ai"
import { AI_MODEL } from "@/lib/ai-model"
import { auth } from "@/auth"
import {
  getOrCreateUser,
  saveAnalysisResult,
  saveFreeAnalysisWithQuota,
  getAnalysisChainForContext,
  resolveCaseLinking,
} from "@/lib/db"
import { reserveFreeAnalysisQuota, getFreeDailyQuotaStatus, releaseFreeAnalysisQuota } from "@/lib/free-quota"
import { TARGET_DIMENSION } from "@/lib/image-cap"
import { buildCaseContextFromAnalyses, mergeUserContextWithCase } from "@/lib/case-context"
import { isProUser } from "@/lib/user-plan"
import { getRedis } from "@/lib/redis"
import { safeParseAnalysisResult } from "@/lib/schemas"
import { createLogger, generateReqId, captureException, emitMetric } from "@/lib/observability"
import type { AnalysisResult } from "@/lib/types"

export const runtime = "nodejs"
export const maxDuration = 120

const log = createLogger("analyze")

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB — pre-load gate to prevent buffering oversized files into memory
const CACHE_TTL_SECONDS = 60 * 60 * 24 // 24 hours

/**
 * Build a deterministic cache key for an analysis result.
 *
 * Performance note (Bug #8): SHA-256 on the full file buffer is synchronous
 * CPU work on the main thread. For the expected file sizes (up to 10 MB per
 * the upload limit), this takes <10 ms on modern hardware. Streaming the hash
 * would avoid a brief thread block but adds significant complexity for no
 * measurable gain at these sizes. Revisit only if file limits increase
 * substantially or if profiling shows this step as a bottleneck.
 */
function buildCacheKey(userId: string, buffer: Buffer, context: string, parentId: string | undefined): string {
  const hash = createHash("sha256")
    .update(buffer)
    .update(context)
    .update(parentId ?? "")
    .update(AI_MODEL)
    .update(TARGET_DIMENSION.toString())
    .digest("hex")
  return `cleardoc:ai-result:${userId}:${hash}`
}

async function getCachedResult(userId: string, key: string): Promise<AnalysisResult | null> {
  const redis = getRedis()
  if (!redis) return null
  try {
    const cached = await redis.get<AnalysisResult>(key)
    if (cached && typeof cached === "object" && "overall_verdict" in cached) {
      // Validate cached payload against the strict schema to prevent cache
      // poisoning from a malformed or stale Redis entry.
      const validated = safeParseAnalysisResult(cached)
      if (validated) {
        log.info({ userId, key }, "AI result cache hit")
        return validated
      }
      log.warn({ userId, key }, "AI result cache hit but schema validation failed — discarding")
    }
  } catch {
    // Cache miss or Redis error — fall through to AI call
  }
  return null
}

async function setCachedResult(_userId: string, key: string, result: AnalysisResult): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    await redis.set(key, result, { ex: CACHE_TTL_SECONDS })
  } catch {
    // Non-critical — cache write failure is silently ignored
  }
}

/** Generic catch-all error for exceptions we don't want to leak. */
function genericErrorResponse(status = 500) {
  return NextResponse.json(
    { error: "Something went wrong. Please try again." },
    { status },
  )
}

class ResponseError extends Error {
  response: NextResponse
  constructor(response: NextResponse) {
    super("Route error")
    this.name = "ResponseError"
    this.response = response
  }
}

function throwResponse(response: NextResponse): never {
  throw new ResponseError(response)
}

async function extractAndValidateFormData(
  req: NextRequest,
): Promise<{ file: File; context: string; parentId: string | undefined }> {
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    throwResponse(NextResponse.json({ error: "Invalid form submission." }, { status: 400 }))
  }

  const file = formData.get("file") as File | null
  const context = (formData.get("context") as string) ?? ""
  const parentIdRaw = (formData.get("parentId") as string) ?? ""
  const parentId = parentIdRaw.trim() || undefined

  if (!file) {
    throwResponse(NextResponse.json({ error: "No file provided" }, { status: 400 }))
  }

  if (file.size > MAX_FILE_SIZE) {
    emitMetric("analysis", "rejected_oversized", { fileSize: file.size, maxSize: MAX_FILE_SIZE })
    throwResponse(
      NextResponse.json(
        { error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.`, maxSize: MAX_FILE_SIZE },
        { status: 413 },
      ),
    )
  }

  if (!file.name || file.name.includes("..") || file.name.includes("/")) {
    throwResponse(NextResponse.json({ error: "Invalid file name" }, { status: 400 }))
  }

  const MAX_FILE_NAME_LENGTH = 255
  if (file.name.length > MAX_FILE_NAME_LENGTH) {
    throwResponse(NextResponse.json({ error: "File name too long." }, { status: 400 }))
  }

  const MAX_CONTEXT_LENGTH = 2000
  if (context.length > MAX_CONTEXT_LENGTH) {
    throwResponse(
      NextResponse.json(
        { error: `Context too long. Maximum ${MAX_CONTEXT_LENGTH} characters.`, maxLength: MAX_CONTEXT_LENGTH },
        { status: 400 },
      ),
    )
  }

  return { file, context, parentId }
}

async function resolveUserAndRateLimits(
  session: { user: { id: string; email: string } },
  req: NextRequest,
  reqId: string,
): Promise<{ userProfile: NonNullable<Awaited<ReturnType<typeof getOrCreateUser>>>; pro: boolean; quotaReserved: boolean }> {
  const userEmail = session.user.email

  let quotaReserved = false
  let userProfile: Awaited<ReturnType<typeof getOrCreateUser>>
  try {
    userProfile = await getOrCreateUser(session.user.id, userEmail)
  } catch (err) {
    captureException(err, { component: "analyze", reqId, extra: { phase: "user-lookup" } })
    throwResponse(
      NextResponse.json(
        { error: "Could not load your account. Please sign in again." },
        { status: 500 },
      ),
    )
  }

  if (!userProfile) {
    throwResponse(
      NextResponse.json(
        { error: "Session stale. Please sign in again." },
        { status: 401, headers: { "x-request-id": reqId } },
      ),
    )
  }

  const userId = userProfile.id
  const pro = isProUser(userProfile)

  // Run both rate limit checks in parallel for lower latency
  const [ipSettled, userSettled] = await Promise.allSettled([
    rateLimitByIp(req, ANALYZE_RATE_LIMITS.ipPerHour, "1 h"),
    rateLimitByUserId(
      userId,
      pro ? ANALYZE_RATE_LIMITS.proUserPerHour : ANALYZE_RATE_LIMITS.freeUserPerHour,
      "1 h",
    ),
  ])

  // Collect errors: any Redis failure or rate-limit rejection blocks the request (fail-closed)
  let blockedBy: "ip" | "user" | null = null
  let blockResponse: NextResponse | null = null

  // IP rate limit result
  if (ipSettled.status === "rejected") {
    captureException(ipSettled.reason, { component: "analyze", reqId, extra: { phase: "rate-limit-ip" } })
    // Redis error -> 503 (fail-closed, but prefer 429 if user is also rate-limited)
    blockedBy = "ip"
    blockResponse = NextResponse.json(
      { error: "Service temporarily unavailable. Please retry shortly." },
      { status: 503, headers: { "Retry-After": "30", "x-request-id": reqId } },
    )
  } else {
    const ipRate = ipSettled.value
    if (!ipRate.allowed) {
      emitMetric("analysis", "rate_limited", { type: "ip", reqId })
      blockedBy = "ip"
      blockResponse = NextResponse.json(
        { error: "Too many requests", limit: ipRate.limit, remaining: ipRate.remaining, reset: ipRate.reset },
        { status: 429 },
      )
    }
  }

  // User rate limit result — always evaluated even if IP already failed (both ran in parallel)
  if (userSettled.status === "rejected") {
    captureException(userSettled.reason, { component: "analyze", reqId, extra: { phase: "rate-limit-user" } })
    // Redis error -> 503; if we already have a 429 block, keep the 429 (more specific)
    if (!blockedBy) {
      blockedBy = "user"
      blockResponse = NextResponse.json(
        { error: "Service temporarily unavailable. Please retry shortly." },
        { status: 503, headers: { "Retry-After": "30", "x-request-id": reqId } },
      )
    }
  } else {
    const userRate = userSettled.value
    if (!userRate.allowed) {
      emitMetric("analysis", "rate_limited", { type: "user", userId, pro, reqId })
      // 429 from user always overrides — it's the more restrictive / more actionable error
      blockedBy = "user"
      blockResponse = NextResponse.json(
        {
          error: "Too many analyses. Please wait before trying again.",
          limit: userRate.limit,
          remaining: userRate.remaining,
          reset: userRate.reset,
        },
        { status: 429 },
      )
    }
  }

  if (blockedBy && blockResponse) {
    throwResponse(blockResponse)
  }

  if (!pro) {
    let quota: { ok: boolean; status: { limit: number; used: number; remaining: number; resetsAt: string } }
    try {
      quota = await reserveFreeAnalysisQuota(userId)
    } catch (quotaErr) {
      captureException(quotaErr, { component: "analyze", reqId, extra: { phase: "quota-reserve" } })
      throwResponse(
        NextResponse.json(
          { error: "Service temporarily unavailable. Please retry shortly." },
          { status: 503, headers: { "Retry-After": "30", "x-request-id": reqId } },
        ),
      )
    }
    if (!quota.ok) {
      emitMetric("analysis", "quota_exhausted", { userId, reqId })
      throwResponse(
        NextResponse.json(
          {
            error: "FREE_DAILY_LIMIT_REACHED",
            code: "FREE_DAILY_LIMIT_REACHED",
            message: "You have used your free analyses for today. Upgrade to Pro for unlimited analyses.",
            limit: quota.status.limit,
            used: quota.status.used,
            remaining: quota.status.remaining,
            resetsAt: quota.status.resetsAt,
          },
          { status: 402 },
        ),
      )
    }
    quotaReserved = true
  }

  return { userProfile, pro, quotaReserved }
}

async function runAnalysisWithCache(
  userId: string,
  extracted: Awaited<ReturnType<typeof extractDocumentFromBuffer>>,
  enrichedContext: string | undefined,
  fileName: string,
  parentId: string | undefined,
  signal: AbortSignal,
  reqId: string,
  pro: boolean,
  buffer: Buffer,
): Promise<{ result: AnalysisResult; wasCached: boolean }> {
  const cacheKey = buildCacheKey(userId, buffer, enrichedContext ?? "", parentId)
  const cachedResult = await getCachedResult(userId, cacheKey)

  if (cachedResult) {
    return { result: cachedResult, wasCached: true }
  }

  let result: AnalysisResult
  try {
    if (extracted.kind === "text") {
      result = await analyzeDocument({
        mode: "text",
        documentText: extracted.text,
        userContext: enrichedContext,
        documentName: fileName,
        signal,
        deadlineMs: 100000,
      })
    } else {
      result = await analyzeDocument({
        mode: "vision",
        mediaType: extracted.mediaType,
        buffer: extracted.buffer,
        userContext: enrichedContext,
        documentName: fileName,
        signal,
        deadlineMs: 100000,
        reqId,
        userId,
        pro,
      })
    }
    await setCachedResult(userId, cacheKey, result)
  } catch (modelErr: unknown) {
    captureException(modelErr, { component: "analyze", reqId, extra: { phase: "ai" } })
    // Release quota because the AI call (including image-cap rejection now
    // happening inside analyzeDocument) failed after reserve but before save.
    // Without this, free users lose a quota slot on every AI failure
    // (timeouts, rate limits, invalid JSON, image-cap rejection, etc.).
    if (!pro) await releaseFreeAnalysisQuota(userId)
    let errorMessage = "Analysis failed. Please try again."
    const status = 500
    if (modelErr instanceof Error) {
      if (modelErr.message === AI_INVALID_JSON_ERROR_MESSAGE) {
        errorMessage = "Analysis failed: model returned unexpected output. Please retry."
      }
    }

    emitMetric("analysis", "failed", { userId, pro, phase: "ai", status, reqId })
    throwResponse(NextResponse.json({ error: errorMessage }, { status }))
  }

  return { result, wasCached: false }
}

export async function POST(req: NextRequest) {
  const reqId = generateReqId()
  let userId: string | null = null
  let pro = false
  let quotaReserved = false
  const reqLog = log.child({ reqId })
  const signal = req.signal

  // Register abort handler to release quota on timeout/serverless kill
  signal.addEventListener("abort", () => {
    reqLog.warn({ userId, reqId }, "request aborted - quota will be released asynchronously")
    if (userId && quotaReserved) {
      releaseFreeAnalysisQuota(userId).catch((err) => {
        reqLog.error({ err, userId, reqId }, "failed to release quota on abort")
      })
    }
  })

  try {
    assertServerEnv()

    // CSRF defense: the analyze route accepts multipart/form-data, which a
    // malicious cross-origin <form> can submit. We require an Origin header
    // that matches our canonical URL. JSON routes are protected by Content-Type.
    if (!isValidOrigin(req)) {
      return NextResponse.json(
        { error: "Invalid origin." },
        { status: 403, headers: { "x-request-id": reqId } },
      )
    }

    const session = await auth()
    if (!session?.user?.id || !session.user.email) {
      reqLog.warn("unauthorized request (no session)")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (signal.aborted) {
      return NextResponse.json({ error: "Client closed request" }, { status: 499 })
    }

    const { file, context, parentId } = await extractAndValidateFormData(req)

    const { userProfile: userProfile_, pro: pro_, quotaReserved: wasReserved } = await resolveUserAndRateLimits(session, req, reqId)
    pro = pro_
    userId = userProfile_.id
    quotaReserved = wasReserved

    if (parentId) {
      const cuidRegex = /^c[a-z0-9]{24}$/
      if (!cuidRegex.test(parentId)) {
        throwResponse(
          NextResponse.json(
            { error: "Invalid parent analysis ID." },
            { status: 400, headers: { "x-request-id": reqId } },
          ),
        )
      }
    }

    let caseLink: { parentId: string; caseId: string } | undefined
    if (parentId) {
      if (!pro) {
        throwResponse(
          NextResponse.json(
            { error: "Case linking is available on Pro. Upgrade to connect follow-up documents." },
            { status: 403 },
          ),
        )
      }
      const resolved = await resolveCaseLinking(userId, parentId)
      if (!resolved) {
        throwResponse(NextResponse.json({ error: "Previous analysis not found." }, { status: 404 }))
      }
      caseLink = resolved
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const mimeType = getFileMimeType(file.name)
    if (mimeType === "application/octet-stream") {
      throwResponse(NextResponse.json({ error: "Unsupported file type." }, { status: 400 }))
    }

    let extracted: Awaited<ReturnType<typeof extractDocumentFromBuffer>>
    try {
      extracted = await extractDocumentFromBuffer(buffer, mimeType)
    } catch (err) {
      captureException(err, { component: "analyze", reqId, extra: { phase: "extract" } })
      // Release quota because this pre-AI rejection occurs after reserve but before save.
      if (quotaReserved) await releaseFreeAnalysisQuota(userId)
      throwResponse(
        NextResponse.json(
          {
            error:
              "We couldn't read this file. It may be corrupted or password-protected — try re-exporting it, or describe it in the context field.",
          },
          { status: 422 },
        ),
      )
    }

    if (extracted.kind === "text" && extracted.isScanned) {
      // Release quota because this pre-AI rejection occurs after reserve but before save.
      if (quotaReserved) await releaseFreeAnalysisQuota(userId)
      throwResponse(
        NextResponse.json(
          { error: "This PDF appears to be scanned and contains no extractable text. Please describe the document in the context field for accurate analysis." },
          { status: 422, headers: { "x-request-id": reqId } },
        ),
      )
    }



    let enrichedContext = context || undefined
    if (caseLink) {
      const chain = await getAnalysisChainForContext(userId, caseLink.parentId)
      const caseContext = buildCaseContextFromAnalyses(chain)
      enrichedContext = mergeUserContextWithCase(context, caseContext)
    }

    if (signal.aborted) {
      // Release quota on abort during case-link phase
      if (quotaReserved) await releaseFreeAnalysisQuota(userId)
      return NextResponse.json({ error: "Client closed request" }, { status: 499 })
    }

    const { result, wasCached } = await runAnalysisWithCache(
      userId,
      extracted,
      enrichedContext,
      file.name,
      parentId,
      signal,
      reqId,
      pro,
      buffer,
    )

    const documentType =
      mimeType === "application/pdf"
        ? "PDF"
        : mimeType.startsWith("image/")
          ? "Image"
          : "Document"

    let analysisId: string
    if (pro) {
      const saved = await saveAnalysisResult(
        userId,
        file.name,
        documentType,
        result,
        caseLink
          ? { parentId: caseLink.parentId, caseId: caseLink.caseId }
          : undefined,
      )
      analysisId = saved.id
    } else {
      const outcome = await saveFreeAnalysisWithQuota(
        userId,
        file.name,
        documentType,
        result,
      )
      if (!outcome.ok) {
        // Compensating decrement: the Redis optimistic counter was incremented
        // before the AI call, but the DB transaction ultimately rejected the save.
        // Roll back the Redis reservation so the user doesn't lose a free analysis.
        quotaReserved = false
        await releaseFreeAnalysisQuota(userId)
        const status = await getFreeDailyQuotaStatus(userId)
        throwResponse(
          NextResponse.json(
            {
              error: "FREE_DAILY_LIMIT_REACHED",
              code: "FREE_DAILY_LIMIT_REACHED",
              message:
                "You have used your free analyses for today. Upgrade to Pro for unlimited analyses.",
              limit: status.limit,
              used: status.used,
              remaining: status.remaining,
              resetsAt: status.resetsAt,
            },
            { status: 402 },
          ),
        )
      }
      analysisId = outcome.id
      quotaReserved = false // Quota was successfully consumed
    }

    reqLog.info(
      { userId, analysisId, pro, hasCaseLink: Boolean(caseLink), mimeType, fileSize: file.size },
      "analysis saved",
    )
    emitMetric("analysis", "completed", {
      userId,
      pro,
      cacheHit: wasCached,
      hasCaseLink: Boolean(caseLink),
      documentType,
      reqId,
    })
    const responseBody: { result: AnalysisResult; analysisId: string; warning?: string } = { result, analysisId }
    if (extracted.kind === "text" && extracted.truncated) {
      responseBody.warning = "Only the first 50 pages were analyzed."
    }
    return NextResponse.json(responseBody)
  } catch (err: unknown) {
    // Release quota on any error that occurred after successful reservation.
    // This handles abort signals during async operations where the signal event
    // handler cannot be guaranteed to run before the async stack unwinds.
    if (quotaReserved && userId && !pro) {
      releaseFreeAnalysisQuota(userId).catch((releaseErr) => {
        reqLog.error({ releaseErr, userId, reqId }, "failed to release quota on error")
      })
    }
    if (err instanceof ResponseError) {
      return err.response
    }
    captureException(err, { component: "analyze", reqId, extra: { userId } })
    emitMetric("analysis", "failed", { userId, phase: "unexpected", reqId })
    return genericErrorResponse(500)
  }
}
