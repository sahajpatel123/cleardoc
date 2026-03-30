import { NextRequest, NextResponse } from "next/server"
import { extractDocumentFromBuffer, getFileMimeType } from "@/lib/pdf-parser"
import {
  analyzeDocument,
  CLAUDE_INVALID_JSON_ERROR_MESSAGE,
} from "@/lib/claude"
import type { UserProfile } from "@/lib/types"
import {
  adminGetUserProfile,
  adminCreateUserProfile,
  adminDecrementFreeUse,
  adminSaveAnalysis,
  getAdminAuth,
} from "@/lib/firestore-admin"

// PRODUCTION RATE LIMITING: Use Upstash Redis with @upstash/ratelimit
// https://github.com/upstash/ratelimit
// Current: rate limiting is DISABLED. Do not deploy without implementing this.

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get("file") as File | null
    const context = (formData.get("context") as string) ?? ""
    const idToken = (formData.get("idToken") as string) ?? ""

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    // Validate file size (10MB)
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 10MB." },
        { status: 400 }
      )
    }

    // Verify Firebase ID token
    let uid: string | null = null
    let userEmail = ""
    if (idToken) {
      try {
        const decoded = await getAdminAuth().verifyIdToken(idToken)
        uid = decoded.uid
        userEmail = decoded.email ?? ""
      } catch {
        return NextResponse.json(
          { error: "Invalid authentication token." },
          { status: 401 }
        )
      }
    }

    // Free tier: one-time quota. Pro users skip all free-use checks and are never decremented here.
    let userProfile: UserProfile | null = null
    if (uid) {
      let profile = await adminGetUserProfile(uid)
      if (!profile) {
        await adminCreateUserProfile(uid, userEmail)
        profile = await adminGetUserProfile(uid)
      }
      userProfile = profile
      if (profile && profile.plan === "free" && profile.freeUsesRemaining <= 0) {
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
    if (uid) {
      analysisId = await adminSaveAnalysis({
        userId: uid,
        documentName: file.name,
        documentType: context || "Unknown",
        result,
      })
      if (userProfile?.plan === "free") {
        await adminDecrementFreeUse(uid)
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
