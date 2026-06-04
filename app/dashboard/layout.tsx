import { Suspense } from "react"

/**
 * Nested layout for the dashboard route. Provides a Suspense boundary
 * (per BUG #16) so individual sections of the page can stream
 * independently as their data resolves. The auth gate lives in
 * page.tsx (per BUG #14) — Next.js layouts and pages run in parallel,
 * so the layout must NOT re-check auth (would double the DB round-trip
 * for no benefit; the middleware also gates this path).
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <Suspense fallback={null}>{children}</Suspense>
}
