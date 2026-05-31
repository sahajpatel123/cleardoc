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
import { parseAnalysisResult } from "@/lib/validate-analysis"
import { isProUser } from "@/lib/user-plan"
import type { ChatMessage } from "@/lib/types"

export const runtime = "nodejs"
export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    assertServerEnv()
  } catch (err) {
    console.error("[chat] Server env not configured:", err)
    return NextResponse.json({ error: "Chat is temporarily unavailable." }, { status: 503 })
  }

  // Outer guard so any throw (auth/DB/etc.) returns a shaped JSON error rather
  // than an unshaped framework 500 — matching the GET handler's convention.
  try {
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

    const { analysisId, message } = (body ?? {}) as { analysisId?: string; message?: string }
    const trimmed = typeof message === "string" ? message.trim() : ""
    if (typeof analysisId !== "string" || !analysisId.trim() || !trimmed) {
      return NextResponse.json({ error: "Analysis ID and message are required." }, { status: 400 })
    }
    if (trimmed.length > 2000) {
      return NextResponse.json({ error: "Message is too long." }, { status: 400 })
    }

    const userProfile = await getOrCreateUser(session.user.id, session.user.email)
    const pro = isProUser(userProfile)

    const rate = await rateLimitByUserId(
      userProfile.id,
      pro ? FEATURE_RATE_LIMITS.chatProPerHour : FEATURE_RATE_LIMITS.chatFreePerHour,
      "1 h",
    )
    if (!rate.allowed) {
      return NextResponse.json({ error: "Too many chat messages. Try again later." }, { status: 429 })
    }

    const row = await getAnalysisById(userProfile.id, analysisId)
    if (!row) {
      return NextResponse.json({ error: "Analysis not found." }, { status: 404 })
    }

    const analysis = parseAnalysisResult(row.result)
    if (!analysis) {
      return NextResponse.json({ error: "Analysis data is invalid." }, { status: 500 })
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
      { status: 402 },
    )
    // Cheap pre-check (fast path); the authoritative cap is enforced atomically
    // at append time below, so concurrent requests cannot exceed `limit`.
    if (history.length >= limit) {
      return limitReached
    }

    const userMsg: ChatMessage = {
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
    }

    let replyText: string
    try {
      replyText = await generateChatReply(analysis, history, trimmed)
    } catch {
      return NextResponse.json({ error: "AI response failed. Try again." }, { status: 500 })
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
      return NextResponse.json({ error: "Analysis not found." }, { status: 404 })
    }

    return NextResponse.json({ reply: replyText, messages: appended.messages })
  } catch (err) {
    console.error("[chat] POST error:", err)
    return NextResponse.json({ error: "Could not process chat." }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const analysisId = req.nextUrl.searchParams.get("analysisId")
    if (!analysisId) {
      return NextResponse.json({ error: "analysisId required." }, { status: 400 })
    }

    const row = await getAnalysisById(session.user.id, analysisId)
    if (!row) {
      return NextResponse.json({ error: "Analysis not found." }, { status: 404 })
    }

    return NextResponse.json({ messages: parseChatMessages(row.chatMessages) })
  } catch (err) {
    console.error("[chat] Error fetching chat history:", err)
    return NextResponse.json({ error: "Failed to fetch chat." }, { status: 500 })
  }
}
