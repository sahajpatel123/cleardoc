import { NextRequest, NextResponse } from "next/server"
import { cleanupProcessedStripeEvents } from "@/lib/db"

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
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 })
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const deleted = await cleanupProcessedStripeEvents()
    return NextResponse.json({ ok: true, deleted })
  } catch (err) {
    console.error("[cron/cleanup] failed:", err)
    return NextResponse.json({ error: "Cleanup failed" }, { status: 500 })
  }
}
