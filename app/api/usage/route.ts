import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getUserById } from "@/lib/db"
import { getFreeDailyQuotaStatus, FREE_TIER_CREDITS_PER_DAY } from "@/lib/db"
import { isProUser } from "@/lib/user-plan"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({
      freeUsesRemaining: 0,
      freeAnalysesRemainingToday: 0,
      freeDailyLimit: FREE_TIER_CREDITS_PER_DAY,
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
      freeDailyLimit: FREE_TIER_CREDITS_PER_DAY,
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
}
