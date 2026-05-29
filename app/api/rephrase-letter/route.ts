import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { assertServerEnv } from "@/lib/env"
import { getAnalysisById, getOrCreateUser, updateAnalysisResult } from "@/lib/db"
import { rephraseResponseLetter } from "@/lib/analysis-ai"
import { FEATURE_RATE_LIMITS, rateLimitByUserId } from "@/lib/rate-limit"
import { parseAnalysisResult } from "@/lib/validate-analysis"
import { isProUser } from "@/lib/user-plan"
import type { LetterTone } from "@/lib/types"

export const runtime = "nodejs"
export const maxDuration = 30

const TONES = new Set<LetterTone>(["firm", "cooperative", "hardship", "assertive"])

export async function POST(req: NextRequest) {
  try {
    assertServerEnv()
  } catch (err) {
    console.error("[rephrase-letter] Server env not configured:", err)
    return NextResponse.json({ error: "Letter rewrite is temporarily unavailable." }, { status: 503 })
  }

  const session = await auth()
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 })
  }

  const { analysisId, tone } = (body ?? {}) as { analysisId?: string; tone?: string }
  if (!analysisId || !tone || !TONES.has(tone as LetterTone)) {
    return NextResponse.json({ error: "Analysis ID and valid tone are required." }, { status: 400 })
  }

  const userProfile = await getOrCreateUser(session.user.id, session.user.email)
  const pro = isProUser(userProfile)

  const rate = await rateLimitByUserId(
    userProfile.id,
    pro ? FEATURE_RATE_LIMITS.rephraseProPerHour : FEATURE_RATE_LIMITS.rephraseFreePerHour,
    "1 h",
  )
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many letter rewrites. Try again later." }, { status: 429 })
  }

  const row = await getAnalysisById(userProfile.id, analysisId)
  if (!row) {
    return NextResponse.json({ error: "Analysis not found." }, { status: 404 })
  }

  const analysis = parseAnalysisResult(row.result)
  if (!analysis) {
    return NextResponse.json({ error: "Analysis data is invalid." }, { status: 500 })
  }

  let rewritten: string
  try {
    rewritten = await rephraseResponseLetter(analysis.response_letter, tone as LetterTone)
  } catch {
    return NextResponse.json({ error: "Letter rewrite AI failed. Try again." }, { status: 500 })
  }
  const updated: typeof analysis = {
    ...analysis,
    response_letter: rewritten,
    letter_tone: tone as LetterTone,
  }

  let ok: boolean
  try {
    ok = await updateAnalysisResult(userProfile.id, analysisId, updated)
  } catch {
    return NextResponse.json({ error: "Could not save rewritten letter." }, { status: 500 })
  }
  if (!ok) {
    return NextResponse.json({ error: "Could not save rewritten letter." }, { status: 500 })
  }

  return NextResponse.json({ letter: rewritten, tone })
}
