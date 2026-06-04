import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { assertServerEnv, isValidOrigin } from "@/lib/env"
import {
  appendChatMessages,
  getAnalysisById,
  getOrCreateUser,
  parseChatMessages,
} from "@/lib/db"
import { generateChatReply, CHAT_MESSAGE_LIMITS } from "@/lib/analysis-ai"
import { FEATURE_RATE_LIMITS, rateLimitByUserId } from "@/lib/rate-limit"
import { parseAnalysisResultLenient } from "@/lib/validate-analysis"
import { isProUser } from "@/lib/user-plan"
import { ChatRequestSchema, parseOrError } from "@/lib/schemas"
import { generateReqId, captureException } from "@/lib/observability"
import type { ChatMessage } from "@/lib/types"

export const runtime = "nodejs"
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const reqId = generateReqId()

  try {
    assertServerEnv()
  } catch (err) {
    captureException(err, { component: "chat", reqId, extra: { phase: "assert-env" } })
    return NextResponse.json(
      { error: "Chat is temporarily unavailable." },
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

    // CSRF defense: even though Content-Type is locked to application/json
    // (which forces a CORS preflight for cross-origin XHR), defense in depth
    // requires a same-origin check. Without this, a browser extension or a
    // same-origin XSS could submit a chat mutation that consumes quota and
    // produces AI spend on behalf of a logged-in user.
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

    const parsed = parseOrError(ChatRequestSchema, body)
    if (!parsed.ok) {
      return NextResponse.json(
        { error: parsed.error },
        { status: 400, headers: { "x-request-id": reqId } },
      )
    }
    const { analysisId, message } = parsed.data

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
        pro ? FEATURE_RATE_LIMITS.chatProPerHour : FEATURE_RATE_LIMITS.chatFreePerHour,
        "1 h",
      )
    } catch (rlErr) {
      captureException(rlErr, { component: "chat", reqId, extra: { phase: "rate-limit" } })
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
        { error: "Too many chat messages. Try again later." },
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

    // Lenient parse: legacy rows saved before the strict schema may have a
    // tolerated-then-dropped malformed deadline. We still want to render
    // chat, rephrase, and dashboard loads for those rows.
    const analysis = parseAnalysisResultLenient(row.result)
    if (!analysis) {
      return NextResponse.json(
        { error: "Analysis data is invalid." },
        { status: 500, headers: { "x-request-id": reqId } },
      )
    }

    const history = parseChatMessages(row.chatMessages)
    const limit = pro ? CHAT_MESSAGE_LIMITS.pro : CHAT_MESSAGE_LIMITS.free
    const limitReached = NextResponse.json(
      {
        error: pro
          ? "Chat limit reached for this analysis."
          : "Free chat limit reached. Upgrade to Pro for more messages.",
        code: "CHAT_LIMIT_REACHED",
      },
      { status: 402, headers: { "x-request-id": reqId } },
    )
    if (history.length >= limit) {
      return limitReached
    }

    // Defensive normalization before passing to the AI. Note: the structural
    // prompt-injection defense lives in lib/analysis-ai.ts (USER_MESSAGE
    // block + explicit system-prompt rule). This layer is belt-and-braces:
    // strip zero-width and bidirectional-override characters that some
    // attackers use to hide injected instructions from human review,
    // collapse runs of whitespace, and cap the message at 2K chars.
    //
    // We do NOT try to regex-strip "ignore previous" etc — that approach is
    // trivially bypassed (whitespace, unicode confusables, code blocks) and
    // gives a false sense of security. The data/instruction boundary in the
    // prompt structure is the real defense.
    // Strip the zero-width and bidi-override codepoints most commonly used
    // to hide prompt-injection text from human reviewers. We assemble the
    // character class via String.fromCharCode so the source file stays pure
    // ASCII and no editor / tool / encoding layer can mangle the codepoints.
    // Covers: U+200B–U+200F, U+202A–U+202E, U+2060–U+2069, U+FEFF.
    const ZERO_WIDTH_AND_BIDI = new RegExp(
      "[" +
        [0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0x2066, 0x2067, 0x2068, 0x2069, 0xfeff]
          .map((cp) => String.fromCharCode(cp))
          .join("") +
        "]" +
        "g",
    )
    const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g

    const sanitizedMessage = message
      .replace(ZERO_WIDTH_AND_BIDI, "")
      .replace(CONTROL_CHARS, "")
      .replace(/\n{4,}/g, "\n\n\n")
      .slice(0, 2000)
      .trim()

    const userMsg: ChatMessage = {
      role: "user",
      content: sanitizedMessage,
      createdAt: new Date().toISOString(),
    }

    let replyText: string
    try {
      replyText = await generateChatReply(analysis, history, sanitizedMessage, req.signal, reqId)
    } catch (aiErr) {
      captureException(aiErr, { component: "chat", reqId, extra: { phase: "ai" } })
      return NextResponse.json(
        { error: "AI response failed. Try again." },
        { status: 500, headers: { "x-request-id": reqId } },
      )
    }
    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: replyText,
      createdAt: new Date().toISOString(),
    }

    const appended = await appendChatMessages(
      userProfile.id,
      analysisId,
      [userMsg, assistantMsg],
      limit,
    )
    if (!appended.ok) {
      if (appended.reason === "limit") return limitReached
      return NextResponse.json(
        { error: "Analysis not found." },
        { status: 404, headers: { "x-request-id": reqId } },
      )
    }

    return NextResponse.json(
      { reply: replyText, messages: appended.messages },
      { headers: { "Cache-Control": "no-store", "x-request-id": reqId } },
    )
  } catch (err) {
    captureException(err, { component: "chat", reqId })
    return NextResponse.json(
      { error: "Could not process chat.", reqId },
      { status: 500, headers: { "x-request-id": reqId } },
    )
  }
}

export async function GET(req: NextRequest) {
  const reqId = generateReqId()
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: { "x-request-id": reqId } },
      )
    }

    const analysisId = req.nextUrl.searchParams.get("analysisId")
    if (!analysisId) {
      return NextResponse.json(
        { error: "analysisId required." },
        { status: 400, headers: { "x-request-id": reqId } },
      )
    }

    const row = await getAnalysisById(session.user.id, analysisId)
    if (!row) {
      return NextResponse.json(
        { error: "Analysis not found." },
        { status: 404, headers: { "x-request-id": reqId } },
      )
    }

    return NextResponse.json(
      { messages: parseChatMessages(row.chatMessages) },
      { headers: { "Cache-Control": "no-store", "x-request-id": reqId } },
    )
  } catch (err) {
    captureException(err, { component: "chat", reqId, extra: { phase: "get" } })
    return NextResponse.json(
      { error: "Failed to fetch chat." },
      { status: 500, headers: { "x-request-id": reqId } },
    )
  }
}
