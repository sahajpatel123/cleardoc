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

  // When the operator hasn't set a real URL yet, fall back to a syntactically
  // valid placeholder so the build does not crash. The first real query at
  // runtime will fail with a clear connection error — the boot guard in
  // lib/env.ts will also have thrown a more specific error first.
  if (isPlaceholderUrl(url)) {
    url = "postgresql://localhost:5432/cleardoc?schema=public"
  }

  // directUrl is declared in prisma/schema.prisma as `directUrl = env("DIRECT_URL")`
  // (with POSTGRES_URL_NON_POOLING as a Supabase-fallback alias). Prisma reads it
  // automatically from the env, so it MUST NOT be passed through the PrismaClient
  // constructor's `datasources.db` object — Prisma 6 rejects it with
  // `PrismaClientConstructorValidationError: Invalid value { db: { url, directUrl } }
  // for datasource "db"` at construction time, which surfaced as a warm-up failure
  // and a "Missing database URL" tail in the truncated runtime log.
  //
  // Prisma 6 also removed the legacy `$use()` middleware API in favor of
  // Client Extensions (`$extends`). We attach the chatMessages JSONB guard
  // via `$allOperations` on `$allModels`, filtered to the Analysis model.
  const baseClient = new PrismaClient({
    datasources: { db: { url } },
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  })

  const client = baseClient.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (
            model === "Analysis" &&
            args &&
            typeof args === "object" &&
            "data" in args &&
            (operation === "update" ||
              operation === "updateMany" ||
              operation === "create" ||
              operation === "createMany")
          ) {
            const data = (args as { data: unknown }).data
            const dataArray = Array.isArray(data) ? data : [data]
            for (const d of dataArray) {
              if (
                d &&
                typeof d === "object" &&
                "chatMessages" in d &&
                (d as { chatMessages: unknown }).chatMessages !== undefined &&
                !Array.isArray((d as { chatMessages: unknown }).chatMessages)
              ) {
                throw new Error(
                  "chatMessages must be an array — write rejected by Prisma extension",
                )
              }
            }
          }
          return query(args)
        },
      },
    },
  })

  // Gracefully handle unexpected connection-level errors so the process
  // does not crash silently. Retry once with backoff for transient blips.
  async function connectWithRetry(maxRetries = 2): Promise<void> {
    const connectable = client as unknown as { $connect: () => Promise<void> }
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await connectable.$connect()
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

  return client as unknown as PrismaClient
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
