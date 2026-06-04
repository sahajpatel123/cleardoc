import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { AnalyzeByIdClient } from "./AnalysisClient"

/**
 * Server-side auth gate. See app/dashboard/page.tsx for the full rationale.
 */
export default async function AnalyzeByIdPage() {
  const session = await auth()
  if (!session?.user?.id) {
    redirect("/login?redirect=/analyze")
  }
  return <AnalyzeByIdClient />
}
