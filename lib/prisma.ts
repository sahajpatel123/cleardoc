import { PrismaClient } from "@prisma/client"
import { resolveDatabaseUrl } from "@/lib/env"

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  const url = resolveDatabaseUrl()
  // Disable prepared statements to avoid issues with PgBouncer/connection pooling
  // by adding ?prepared_statements=false to the connection string for PostgreSQL
  // Alternative: use ?pgbouncer=true for PgBouncer pool mode
  const connectionString = url.includes('?')
    ? `${url}&prepared_statements=false`
    : `${url}?prepared_statements=false`

  return new PrismaClient({
    datasources: { db: { url: connectionString } },
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma