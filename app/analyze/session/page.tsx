import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { AnalysisSessionClient } from "./SessionClient"

/**
 * Server-side auth gate. See app/dashboard/page.tsx for the full rationale.
 */
export default async function AnalysisSessionPage() {
  const session = await auth()
  if (!session?.user?.id) {
    redirect("/login?redirect=/analyze/session")
  }
  return <AnalysisSessionClient />
}
