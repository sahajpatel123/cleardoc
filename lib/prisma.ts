import { PrismaClient } from "@prisma/client"
import { resolveDatabaseUrl } from "@/lib/env"
import { captureException, createLogger } from "@/lib/observability"

const log = createLogger("prisma")

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * Detect placeholder env values (e.g. `[PROJECT-REF]`, `[PASSWORD]`,
 * `[REGION]`) that ship in `.env.example` / development `.env.local`
 * files before the operator has provisioned real services. We can't
 * build with invalid URLs because Prisma's constructor validates the
 * datasource shape synchronously and the build pipeline imports every
 * module that touches `lib/db.ts`.
 */
function isPlaceholderUrl(value: string): boolean {
  return /\[[A-Z][A-Z0-9_-]*\]/.test(value)
}

function createPrismaClient(): PrismaClient {
  // resolveDatabaseUrl() (in lib/env.ts, the source of truth) automatically
  // appends PgBouncer params (pgbouncer=true & prepared_statements=false) when
  // the URL targets a pooler port (6543). The prebuild-migrate script has a
  // necessary standalone copy that must be kept in sync.
  let url = resolveDatabaseUrl()

  // directUrl bypasses PgBouncer for operations that require a persistent
  // connection (e.g. Supabase connection pooler on port 6543). When not set,
  // Prisma uses `url` for everything — fine for Render, Neon, and non-pooled
  // deployments. schema.prisma declares `directUrl = env("DIRECT_URL")` for
  // Prisma Migrate/Studio; here we pass it explicitly so the runtime client
  // benefits from it too when the env var is available.
  let directUrl =
    process.env.DIRECT_URL?.trim() ||
    process.env.POSTGRES_URL_NON_POOLING?.trim() ||
    undefined

  // When the operator hasn't set a real URL yet, fall back to a syntactically
  // valid placeholder so the build does not crash. The first real query at
  // runtime will fail with a clear connection error — the boot guard in
  // lib/env.ts will also have thrown a more specific error first.
  if (isPlaceholderUrl(url)) {
    url = "postgresql://localhost:5432/cleardoc?schema=public"
    if (directUrl && isPlaceholderUrl(directUrl)) {
      directUrl = "postgresql://localhost:5432/cleardoc?schema=public"
    } else if (!directUrl) {
      directUrl = url
    }
  }

  const client = new PrismaClient({
    datasources: { db: { url, ...(directUrl ? { directUrl } : {}) } },
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  })

  // Gracefully handle unexpected connection-level errors so the process
  // does not crash silently. Retry once with backoff for transient blips.
  async function connectWithRetry(maxRetries = 2): Promise<void> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await client.$connect()
        return
      } catch (err: unknown) {
        if (attempt === maxRetries) {
          captureException(err, { component: "prisma", extra: { phase: "initial-connect", attempts: maxRetries + 1 } })
          log.warn(
            { err: err instanceof Error ? err.message : String(err), attempts: maxRetries + 1 },
            "Prisma initial connection failed after retries — first query will surface error",
          )
          return
        }
        log.warn({ attempt: attempt + 1, maxRetries }, "Prisma connection failed, retrying...")
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
      }
    }
  }
  connectWithRetry()

  // Prisma middleware: guard the Analysis.chatMessages JSONB column against
  // non-array writes from future code paths that bypass appendChatMessages.
  // This prevents a single buggy updateMany from corrupting the column.
  type MiddlewareFn = (params: unknown, next: (params: unknown) => Promise<unknown>) => Promise<unknown>
  type ClientWithMiddleware = PrismaClient & { $use: (fn: MiddlewareFn) => void }
  ;(client as ClientWithMiddleware).$use(async (params, next) => {
    const p = params as { model?: string; action: string; args?: { data?: Record<string, unknown> | Record<string, unknown>[] } }
    if (p.model === "Analysis" && p.args?.data &&
        (p.action === "update" || p.action === "updateMany" || p.action === "create" || p.action === "createMany")) {
      const dataArray = Array.isArray(p.args.data) ? p.args.data : [p.args.data]
      for (const data of dataArray) {
        if (data.chatMessages !== undefined && !Array.isArray(data.chatMessages)) {
          throw new Error("chatMessages must be an array — write rejected by Prisma middleware")
        }
      }
    }
    return next(params)
  })

  return client
}

let _prismaInstance: PrismaClient | undefined = globalForPrisma.prisma

/**
 * Lazy Prisma client — construction is deferred to the first method call so
 * the build pipeline can import `lib/db.ts` (and everything that depends on
 * it) without triggering Prisma's constructor validation against unprovisioned
 * env vars. The first actual query at runtime will surface a clear connection
 * error if the database is unreachable.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    if (!_prismaInstance) {
      _prismaInstance = createPrismaClient()
      if (process.env.NODE_ENV !== "production") {
        globalForPrisma.prisma = _prismaInstance
      }
    }
    const value = Reflect.get(_prismaInstance, prop, receiver)
    return typeof value === "function" ? value.bind(_prismaInstance) : value
  },
})
