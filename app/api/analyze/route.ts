import { NextRequest, NextResponse } from "next/server"
import { extractTextFromBuffer, getFileMimeType } from "@/lib/pdf-parser"
import { analyzeDocument } from "@/lib/claude"
import {
  adminGetUserProfile,
  adminDecrementFreeUse,
  adminSaveAnalysis,
  getAdminAuth,
} from "@/lib/firestore-admin"

// Rate limiting — simple in-memory store (use Redis in prod)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const windowMs = 60 * 60 * 1000 // 1 hour
  const limit = 10

  const entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (entry.count >= limit) return false
  entry.count++
  return true
}

export async function POST(req: NextRequest) {
  // Rate limit check
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0] ??
    req.headers.get("x-real-ip") ??
    "unknown"

  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "Too many requests. Please try again in an hour." },
      { status: 429 }
    )
  }

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
    if (idToken) {
      try {
        const decoded = await getAdminAuth().verifyIdToken(idToken)
        uid = decoded.uid
      } catch {
        return NextResponse.json(
          { error: "Invalid authentication token." },
          { status: 401 }
        )
      }
    }

    // Check usage limits
    if (uid) {
      const profile = await adminGetUserProfile(uid)
      if (profile && profile.plan !== "pro" && profile.freeUsesRemaining <= 0) {
        return NextResponse.json(
          { error: "FREE_LIMIT_REACHED" },
          { status: 402 }
        )
      }
    }

    // Extract text from document
    const buffer = Buffer.from(await file.arrayBuffer())
    const mimeType = getFileMimeType(file.name)
    const documentText = await extractTextFromBuffer(buffer, mimeType)

    // Call Claude API
    const result = await analyzeDocument({
      documentText,
      userContext: context || undefined,
      documentName: file.name,
    })

    // Save analysis and update usage
    let analysisId: string | null = null
    if (uid) {
      analysisId = await adminSaveAnalysis({
        userId: uid,
        documentName: file.name,
        documentType: context || "Unknown",
        storageUrl: "",
        result,
      })
      await adminDecrementFreeUse(uid)
    }

    return NextResponse.json({ result, analysisId })
  } catch (err) {
    console.error("[analyze] Error:", err)
    const message =
      err instanceof Error ? err.message : "Analysis failed. Please try again."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
