import { NextRequest, NextResponse } from "next/server"
import { cleanupProcessedStripeEvents } from "@/lib/stripe-events"
import { generateReqId, captureException } from "@/lib/observability"
import { timingSafeEqual } from "node:crypto"

export const runtime = "nodejs"

/**
 * Scheduled cleanup of old ProcessedStripeEvent idempotency rows so the table
 * does not grow unbounded. Wired to Vercel Cron (see vercel.json).
 *
 * Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` when the CRON_SECRET
 * env var is set, so we require it. If the secret is unset the endpoint refuses
 * to run (never leave a maintenance endpoint open to the public).
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
    const deleted = await cleanupProcessedStripeEvents()
    return NextResponse.json(
      { ok: true, deleted },
      { headers: { "x-request-id": reqId } },
    )
  } catch (err) {
    captureException(err, { component: "cron-cleanup", reqId })
    return NextResponse.json(
      { error: "Cleanup failed" },
      { status: 500, headers: { "x-request-id": reqId } },
    )
  }
}
