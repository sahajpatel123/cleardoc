/**
 * Sentry server-side configuration (Node runtime).
 *
 * Initialization is opt-in via SENTRY_DSN. When the env var is missing, the
 * Sentry client is a no-op stub so the rest of the app's logging continues
 * to work via pino (see lib/observability.ts).
 *
 * Production sample rate is conservative (10%) to stay within Vercel's
 * bandwidth budget. Set SENTRY_TRACES_SAMPLE_RATE in env to override.
 */
{
  const dsn = process.env.SENTRY_DSN?.trim() || ""
  if (dsn) {
    // Dynamic require so bundling does not eagerly pull Sentry into routes
    // that do not need it. Sentry reads env at module-load time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require("@sentry/nextjs")
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || "development",
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
      sendDefaultPii: false,
      beforeBreadcrumb(crumb: { data?: Record<string, unknown> }) {
        if (crumb.data) {
          delete crumb.data.body
          delete crumb.data.headers
          delete crumb.data.cookies
        }
        return crumb
      },
    })
  }
}

export {}
