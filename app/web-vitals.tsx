"use client"

/**
 * Web Vitals reporter — emits Core Web Vitals (CLS, INP, LCP, FCP, TTFB)
 * as structured metrics via the observability layer. Insert this component
 * inside the <Providers> wrapper in the root layout to start collecting.
 */
import { useReportWebVitals } from "next/web-vitals"
import { emitMetric } from "@/lib/observability"

export function WebVitals() {
  useReportWebVitals((metric) => {
    const { name, value, id } = metric

    // Emit as a structured log line for external aggregators (Datadog, Grafana).
    emitMetric("web-vitals", name, {
      value: Math.round(value),
      id,
    })

    // Forward to Sentry when configured.
    if (typeof window !== "undefined") {
      try {
        // Dynamic import avoids bundling Sentry in the web-vitals chunk.
        import("@sentry/nextjs").then((Sentry) => {
          Sentry.captureMessage(`web-vital:${name}`, {
            level: "info" as const,
            tags: { "web-vital": name },
            extra: { metric: name, value, id },
          })
        }).catch(() => {
          // Sentry not configured — non-fatal.
        })
      } catch {
        // Dynamic import failed — non-fatal.
      }
    }
  })

  return null
}