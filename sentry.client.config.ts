"use client"
/**
 * Sentry browser configuration.
 *
 * Initialized only when NEXT_PUBLIC_SENTRY_DSN is set. Never sends PII
 * (uploads, document names, AI prompts).
 */
{
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() || ""
  if (dsn && typeof window !== "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require("@sentry/nextjs")
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || "development",
      tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
      sendDefaultPii: false,
      // Never capture document text, filenames, or user-context fields.
      // Replays and onerror captures default to including form input values
      // — disable them entirely.
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      beforeBreadcrumb(breadcrumb: { data?: Record<string, unknown> }) {
        if (breadcrumb.data) {
          delete breadcrumb.data.body
          delete breadcrumb.data.headers
          delete breadcrumb.data.cookies
        }
        return breadcrumb
      },
    })
  }
}

export {}
