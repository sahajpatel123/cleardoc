import { PrismaClient } from "@prisma/client"
import { resolveDatabaseUrl } from "@/lib/env"

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  // resolveDatabaseUrl() automatically appends PgBouncer params (pgbouncer=true
  // & prepared_statements=false) when the URL targets a pooler port (6543).
  const url = resolveDatabaseUrl()

  const client = new PrismaClient({
    datasources: { db: { url } },
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  })

  // Gracefully handle unexpected connection-level errors so the process
  // does not crash silently — Prisma will still surface errors per-query.
  client.$connect().catch((err: unknown) => {
    console.error("[Prisma] Initial connection failed:", err)
  })

  return client
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma