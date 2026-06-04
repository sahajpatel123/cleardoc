"use client"

import { useEffect } from "react"
import { captureException } from "@/lib/observability"

// global-error replaces the root layout, so globals.css is NOT loaded here.
// Styles are inlined to keep the brand intact even in a catastrophic failure.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[app/global-error]", error)
    captureException(error, { component: "global-error-boundary", extra: { digest: error.digest } })
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#050505",
          color: "#F5F2EB",
          fontFamily:
            "'DM Sans', system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: 520, width: "100%" }}>
          <p
            style={{
              fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
              fontSize: 11,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "#FF6A1F",
              marginBottom: 28,
            }}
          >
            Critical error
          </p>
          <h1
            style={{
              fontSize: "clamp(2rem, 6vw, 3.5rem)",
              fontWeight: 600,
              letterSpacing: "-0.04em",
              lineHeight: 1.05,
              margin: "0 0 20px",
            }}
          >
            The application stopped responding.
          </h1>
          <p
            style={{
              fontSize: 16,
              lineHeight: 1.6,
              color: "rgba(245, 242, 235, 0.48)",
              margin: "0 0 36px",
            }}
          >
            ClearDoc ran into a problem it couldn&apos;t recover from. Your data
            is safe. Please reload to continue.
          </p>
          <button
            onClick={() => reset()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              padding: "13px 22px",
              fontSize: 14,
              fontWeight: 500,
              borderRadius: 100,
              border: "1px solid #F5F2EB",
              background: "#F5F2EB",
              color: "#050505",
              cursor: "pointer",
            }}
          >
            Reload ClearDoc
          </button>
          {error?.digest && (
            <p
              style={{
                fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
                fontSize: 11,
                color: "rgba(245, 242, 235, 0.28)",
                marginTop: 36,
              }}
            >
              Reference · {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  )
}
