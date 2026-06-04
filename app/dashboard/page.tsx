import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { DashboardClient } from "./DashboardClient"

/**
 * Server Component wrapper that performs the auth gate server-side BEFORE
 * the client component tree is shipped. The previous design was a pure
 * "use client" page that used useAuth() + router.push for the redirect,
 * which meant the unauthenticated HTML was sent to the browser, JS would
 * run, and only then would the redirect happen — a small but real flash
 * of unauthorized content and an unnecessary client JS round-trip.
 *
 * With this RSC, the server runs `auth()` (which reads the NextAuth JWT
 * cookie) and either:
 *   - returns a 307 to /login if there is no session, OR
 *   - streams <DashboardClient /> which hydrates with useAuth() already
 *     populated from the same session.
 *
 * The middleware in middleware.ts also gates this path, so the RSC check
 * is defense-in-depth (the middleware is cookie-only for Edge-compat; the
 * full session validation happens here).
 */
export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user?.id) {
    redirect("/login?redirect=/dashboard")
  }
  return <DashboardClient />
}
