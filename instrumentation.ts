/**
 * Next.js instrumentation hook — runs once per server boot, before any
 * route handler executes. We use it to load Sentry server config so
 * error capture is available from the first request.
 *
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register(): Promise<void> {
  // All Node-only APIs (Prisma, AI client, process.on, process.exit) live
  // inside the nodejs-runtime branch. The Edge runtime has no Prisma, no
  // process, and never receives SIGTERM — invoking any of these at module
  // scope triggers a Turbopack "A Node.js API is used …" warning and is
  // semantically wrong for Edge. Next.js calls register() once per runtime
  // boot, gated on NEXT_RUNTIME.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      await import("./sentry.server.config")
    } catch {
      // Sentry not installed or misconfigured — non-fatal. The app must
      // boot without Sentry so dev runs and partial deploys work.
    }

    // Eagerly warm heavy singletons so the first request does not pay the
    // 500ms-1.5s cold-start cost (Prisma connect + AI client init + auth).
    // Fire-and-forget: failures are non-fatal; the first request will retry.
    try { await (await import("@/lib/prisma")).prisma.$connect() } catch (warmupErr) {
      logWarmupFailure("prisma", warmupErr)
    }
    try { (await import("@/lib/ai-client")).getAiClient() } catch (warmupErr) {
      logWarmupFailure("ai-client", warmupErr)
    }

    // Graceful shutdown on container termination (Vercel / Docker / K8s) or fatal errors.
    // In serverless, the runtime may not always send SIGTERM, but when it
    // does we disconnect Prisma cleanly to avoid connection pool leaks.
    // IMPORTANT: Wait for in-flight webhooks to complete before shutting down.
    const gracefulShutdown = async (signalName: string, isError = false) => {
      const timeout = setTimeout(() => {
        // eslint-disable-next-line no-console
        console.error(`[instrumentation] Graceful shutdown timed out (${signalName}) — forcing exit`)
        process.exit(1)
      }, 10_000)

      try {
        // First, drain any in-flight webhooks so Vercel deploy doesn't lose them
        try {
          const { drainInFlight } = await import("@/lib/webhook-inflight")
          await drainInFlight()
        } catch (drainErr) {
          // Log but continue - we must exit eventually
          // eslint-disable-next-line no-console
          console.error("[instrumentation] Failed to drain webhooks:", drainErr)
        }

        // Then disconnect Prisma cleanly
        try {
          const { prisma } = await import("@/lib/prisma")
          await prisma.$disconnect()
        } catch {}
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[instrumentation] Error during graceful shutdown (${signalName}):`, err)
      } finally {
        clearTimeout(timeout)
        process.exit(isError ? 1 : 0)
      }
    }
    process.on("SIGTERM", () => { void gracefulShutdown("SIGTERM") })
    process.on("SIGINT", () => { void gracefulShutdown("SIGINT") })

    // Catch unhandled exceptions and promise rejections that slip through — prevents
    // the Node process from silently crashing with exit code 1 and no stack trace
    // in serverless. Worker threads can reject without a .catch() handler if
    // the caller's timeout wins the race before the worker's promise settles.
    const handleFatalError = async (errorType: string, error: unknown) => {
      // Log full error details for debugging
      if (error instanceof Error) {
        console.error(`[instrumentation] ${errorType}: ${error.message}`, {
          name: error.name,
          stack: error.stack,
        })
      } else {
        console.error(`[instrumentation] ${errorType}:`, error)
      }
      await gracefulShutdown(errorType)
    }

    // Catch unhandled promise rejections — same protection for async throws.
    process.on("unhandledRejection", (reason: unknown) => {
      void handleFatalError("Unhandled promise rejection", reason)
    })

    // Catch synchronous uncaught exceptions — same protection for sync throws.
    // A thrown exception means the process may be in a corrupted state.
    process.on("uncaughtException", (err: Error) => {
      void handleFatalError("Uncaught exception", err)
    })
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    try {
      await import("./sentry.edge.config")
    } catch {
      // Same non-fatal guard for edge runtime.
    }
  }
}

function logWarmupFailure(component: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  // eslint-disable-next-line no-console
  console.warn(`[instrumentation] Warm-up failed for ${component}: ${msg}`)
}
