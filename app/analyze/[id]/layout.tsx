import { Suspense } from "react"

/**
 * Nested layout for the /analyze/[id] route. Provides a Suspense
 * boundary (per BUG #16) so the page can stream as its data resolves.
 * Auth gate lives in page.tsx (per BUG #14).
 */
export default function AnalyzeByIdLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <Suspense fallback={null}>{children}</Suspense>
}
