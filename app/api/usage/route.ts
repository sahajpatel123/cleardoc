import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getUserById } from "@/lib/db"
import { getFreeDailyQuotaStatus, FREE_DAILY_ANALYSIS_LIMIT } from "@/lib/free-quota"
import { isProUser } from "@/lib/user-plan"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({
        freeUsesRemaining: 0,
        freeAnalysesRemainingToday: 0,
        freeDailyLimit: FREE_DAILY_ANALYSIS_LIMIT,
        plan: "free",
      })
    }

    const user = await getUserById(session.user.id)
    const pro = isProUser(
      user
        ? { plan: user.plan, subscriptionStatus: user.subscriptionStatus }
        : null,
    )

    if (pro) {
      return NextResponse.json({
        plan: user?.plan ?? "pro",
        subscriptionStatus: user?.subscriptionStatus ?? "active",
        freeDailyLimit: FREE_DAILY_ANALYSIS_LIMIT,
        freeAnalysesUsedToday: 0,
        freeAnalysesRemainingToday: 0,
        freeUsesRemaining: 0,
        unlimited: true,
      })
    }

    const quota = await getFreeDailyQuotaStatus(session.user.id)

    return NextResponse.json({
      plan: user?.plan ?? "free",
      subscriptionStatus: user?.subscriptionStatus ?? "inactive",
      freeDailyLimit: quota.limit,
      freeAnalysesUsedToday: quota.used,
      freeAnalysesRemainingToday: quota.remaining,
      resetsAt: quota.resetsAt,
      /** @deprecated use freeAnalysesRemainingToday */
      freeUsesRemaining: quota.remaining,
      unlimited: false,
    })
  } catch (err) {
    console.error("[usage] error:", err)
    return NextResponse.json({ error: "Could not load usage." }, { status: 500 })
  }
}
