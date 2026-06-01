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

    // Graceful shutdown on container termination (Vercel / Docker / K8s).
    // In serverless, the runtime may not always send SIGTERM, but when it
    // does we disconnect Prisma cleanly to avoid connection pool leaks.
    const gracefulShutdown = async (_signalName: string) => {
      try {
        const { prisma } = await import("@/lib/prisma")
        await prisma.$disconnect()
      } catch {}
      process.exit(0)
    }
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))
    process.on("SIGINT", () => gracefulShutdown("SIGINT"))
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
