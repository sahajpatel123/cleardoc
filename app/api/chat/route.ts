import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { assertServerEnv } from "@/lib/env"
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

    // Sanitize user message before sending to the AI to mitigate prompt injection.
    const sanitizedMessage = message
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
      .replace(/^\s*(system|user|assistant)\s*:/gim, "")
      .replace(/ignore\s+(all\s+)?(previous|above|prior)\s+instructions/gi, "[REMOVED]")
      .replace(/new\s+system\s+prompt/gi, "[REMOVED]")
      .replace(/<system\b[^>]*>[\s\S]*?<\/system>/gi, "[REMOVED]")
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
      { headers: { "x-request-id": reqId } },
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
      { headers: { "x-request-id": reqId } },
    )
  } catch (err) {
    captureException(err, { component: "chat", reqId, extra: { phase: "get" } })
    return NextResponse.json(
      { error: "Failed to fetch chat." },
      { status: 500, headers: { "x-request-id": reqId } },
    )
  }
}
