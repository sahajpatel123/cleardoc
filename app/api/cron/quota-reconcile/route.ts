import { NextRequest, NextResponse } from "next/server"
import { reconcileFreeQuota } from "@/lib/free-quota"
import { generateReqId, captureException } from "@/lib/observability"
import { timingSafeEqual } from "node:crypto"
import { getAllActiveUserIds } from "@/lib/db"

export const runtime = "nodejs"

/**
 * Scheduled reconciliation of Redis optimistic quota counters with actual DB counts.
 * Corrects drift from aborted requests that timed out or were killed during serverless drain.
 * Wired to Vercel Cron (see vercel.json). Runs hourly for users with active analyses.
 */
export async function GET(req: NextRequest) {
  const reqId = generateReqId()
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: "Cron not configured" },
      { status: 503, headers: { "x-request-id": reqId } },
    )
  }
  const expected = Buffer.from(`Bearer ${secret}`, "utf8")
  const actual = Buffer.from(req.headers.get("authorization") ?? "", "utf8")
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "x-request-id": reqId } },
    )
  }

  try {
    // Get all users who have analyses today (recent active users)
    const userIds = await getAllActiveUserIds()

    let corrected = 0
    let errors = 0

    // Process in small batches to avoid overwhelming Redis
    const batchSize = 50
    for (let i = 0; i < userIds.length; i += batchSize) {
      const batch = userIds.slice(i, i + batchSize)
      const results = await Promise.allSettled(
        batch.map(userId => reconcileFreeQuota(userId))
      )
      for (const result of results) {
        if (result.status === "fulfilled" && result.value.corrected) {
          corrected++
        } else if (result.status === "rejected") {
          errors++
        }
      }
    }

    return NextResponse.json(
      { ok: true, corrected, errors, total: userIds.length },
      { headers: { "x-request-id": reqId } },
    )
  } catch (err) {
    captureException(err, { component: "cron-quota-reconcile", reqId })
    return NextResponse.json(
      { error: "Reconciliation failed" },
      { status: 500, headers: { "x-request-id": reqId } },
    )
  }
}