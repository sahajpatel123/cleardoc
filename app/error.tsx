"use client"

import { useEffect } from "react"
import Link from "next/link"
import { RotateCcw, ArrowUpRight } from "lucide-react"
import { captureException } from "@/lib/observability"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[app/error]", error)
    captureException(error, { component: "error-boundary", extra: { digest: error.digest } })
  }, [error])

  return (
    <div className="min-h-[80vh] flex items-center pt-32 pb-24">
      <div className="container-edition">
        <p className="eyebrow mb-8" style={{ color: "var(--red)" }}>
          Something broke
        </p>
        <h1
          className="display max-w-[18ch] mb-6"
          style={{ fontSize: "clamp(2.4rem, 7vw, 5.5rem)", color: "var(--text)" }}
        >
          <span>We hit a </span>
          <span className="serif-italic" style={{ color: "var(--text-3)" }}>
            snag.
          </span>
        </h1>
        <p
          className="text-base leading-relaxed max-w-md mb-10"
          style={{ color: "var(--text-3)" }}
        >
          An unexpected error interrupted this page. Your account and any saved
          analyses are safe. Try again — and if it keeps happening, head back
          home and start fresh.
        </p>
        <div className="flex items-center gap-4 flex-wrap">
          <button onClick={() => reset()} className="btn btn-primary">
            <RotateCcw className="w-4 h-4" />
            Try again
          </button>
          <Link href="/" className="btn-link">
            Back to home
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        {error?.digest && (
          <p className="mono text-[11px] mt-10" style={{ color: "var(--text-mute)" }}>
            Reference · {error.digest}
          </p>
        )}
      </div>
    </div>
  )
}
