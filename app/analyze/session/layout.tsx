import { Suspense } from "react"

/**
 * Nested layout for /analyze/session. Provides a Suspense boundary
 * (per BUG #16) so the session page can stream as its data resolves.
 * Auth gate lives in page.tsx (per BUG #14).
 */
export default function AnalyzeSessionLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <Suspense fallback={null}>{children}</Suspense>
}
