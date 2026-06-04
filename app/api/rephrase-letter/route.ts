import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { assertServerEnv, isValidOrigin } from "@/lib/env"
import { getAnalysisById, getOrCreateUser, updateAnalysisResult } from "@/lib/db"
import { rephraseResponseLetter } from "@/lib/analysis-ai"
import { FEATURE_RATE_LIMITS, rateLimitByUserId } from "@/lib/rate-limit"
import { parseAnalysisResultLenient } from "@/lib/validate-analysis"
import { isProUser } from "@/lib/user-plan"
import { RephraseRequestSchema, parseOrError, safeParseAnalysisResult } from "@/lib/schemas"
import { generateReqId, captureException } from "@/lib/observability"
import type { LetterTone } from "@/lib/types"

export const runtime = "nodejs"
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const reqId = generateReqId()

  try {
    assertServerEnv()
  } catch (err) {
    captureException(err, { component: "rephrase-letter", reqId, extra: { phase: "assert-env" } })
    return NextResponse.json(
      { error: "Letter rewrite is temporarily unavailable." },
      { status: 503, headers: { "x-request-id": reqId } },
    )
  }

  try {
    const session = await auth()
    if (!session?.user?.id || !session.user.email) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: { "x-request-id": reqId } },
      )
    }

    const contentType = req.headers.get("content-type") ?? ""
    if (!contentType.startsWith("application/json")) {
      return NextResponse.json(
        { error: "Unsupported Media Type" },
        { status: 415, headers: { "x-request-id": reqId } },
      )
    }

    // CSRF defense: state-changing route. Same defense-in-depth as /api/chat
    // — see comments there for rationale.
    if (!isValidOrigin(req)) {
      return NextResponse.json(
        { error: "Invalid origin." },
        { status: 403, headers: { "x-request-id": reqId } },
      )
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json(
        { error: "Invalid request." },
        { status: 400, headers: { "x-request-id": reqId } },
      )
    }

    const parsed = parseOrError(RephraseRequestSchema, body)
    if (!parsed.ok) {
      return NextResponse.json(
        { error: parsed.error },
        { status: 400, headers: { "x-request-id": reqId } },
      )
    }
    const { analysisId, tone } = parsed.data

    const userProfile = await getOrCreateUser(session.user.id, session.user.email)
    if (!userProfile) {
      return NextResponse.json(
        { error: "Session stale. Please sign in again." },
        { status: 401, headers: { "x-request-id": reqId } },
      )
    }
    const pro = isProUser(userProfile)

    let rate: { allowed: boolean; reset?: number }
    try {
      rate = await rateLimitByUserId(
        userProfile.id,
        pro ? FEATURE_RATE_LIMITS.rephraseProPerHour : FEATURE_RATE_LIMITS.rephraseFreePerHour,
        "1 h",
      )
    } catch (rlErr) {
      captureException(rlErr, {
        component: "rephrase-letter",
        reqId,
        extra: { phase: "rate-limit" },
      })
      return NextResponse.json(
        { error: "Service temporarily unavailable. Please retry shortly." },
        { status: 503, headers: { "Retry-After": "30", "x-request-id": reqId } },
      )
    }
    if (!rate.allowed) {
      const retryAfter = rate.reset
        ? String(Math.max(1, Math.ceil((rate.reset - Date.now()) / 1000)))
        : "60"
      return NextResponse.json(
        { error: "Too many letter rewrites. Try again later." },
        { status: 429, headers: { "Retry-After": retryAfter, "x-request-id": reqId } },
      )
    }

    const row = await getAnalysisById(userProfile.id, analysisId)
    if (!row) {
      return NextResponse.json(
        { error: "Analysis not found." },
        { status: 404, headers: { "x-request-id": reqId } },
      )
    }

    // Lenient: tolerate legacy rows with malformed deadlines.
    const analysis = parseAnalysisResultLenient(row.result)
    if (!analysis) {
      return NextResponse.json(
        { error: "Analysis data is invalid." },
        { status: 500, headers: { "x-request-id": reqId } },
      )
    }

    let rewritten: string
    try {
      rewritten = await rephraseResponseLetter(analysis.response_letter, tone as LetterTone, req.signal, reqId)
    } catch (aiErr) {
      captureException(aiErr, { component: "rephrase-letter", reqId, extra: { phase: "ai" } })
      return NextResponse.json(
        { error: "Letter rewrite AI failed. Try again." },
        { status: 500, headers: { "x-request-id": reqId } },
      )
    }

    // Build the updated analysis and re-validate through the strict schema.
    // If the rephrased letter violates the schema (e.g. > 50K chars), refuse
    // to save and surface a clear error.
    const updated = {
      ...analysis,
      response_letter: rewritten,
      letter_tone: tone as LetterTone,
    }
    const revalidated = safeParseAnalysisResult(updated)
    if (!revalidated) {
      captureException(new Error("Rephrased letter failed strict validation"), {
        component: "rephrase-letter",
        reqId,
        extra: { analysisId, letterLength: rewritten.length },
      })
      return NextResponse.json(
        { error: "Rephrased letter failed validation. Please try again." },
        { status: 500, headers: { "x-request-id": reqId } },
      )
    }

    let ok: boolean
    try {
      ok = await updateAnalysisResult(userProfile.id, analysisId, revalidated)
    } catch (saveErr) {
      captureException(saveErr, { component: "rephrase-letter", reqId, extra: { phase: "save" } })
      return NextResponse.json(
        { error: "Could not save rewritten letter." },
        { status: 500, headers: { "x-request-id": reqId } },
      )
    }
    if (!ok) {
      return NextResponse.json(
        { error: "Could not save rewritten letter." },
        { status: 500, headers: { "x-request-id": reqId } },
      )
    }

    return NextResponse.json(
      { letter: rewritten, tone },
      { headers: { "Cache-Control": "no-store", "x-request-id": reqId } },
    )
  } catch (err) {
    captureException(err, { component: "rephrase-letter", reqId })
    return NextResponse.json(
      { error: "Could not rewrite letter." },
      { status: 500, headers: { "x-request-id": reqId } },
    )
  }
}
