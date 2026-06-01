/**
 * Sentry edge runtime configuration (middleware / edge functions).
 */
{
  const dsn = process.env.SENTRY_DSN?.trim() || ""
  if (dsn) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require("@sentry/nextjs")
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || "development",
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
      sendDefaultPii: false,
      beforeBreadcrumb(breadcrumb: { category?: string; data?: Record<string, unknown> }) {
        if (breadcrumb.category === "http" && breadcrumb.data) {
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
