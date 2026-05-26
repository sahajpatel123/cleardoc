/** PostgreSQL connection — checked in priority order (Vercel/Neon often use POSTGRES_*). */
export const DATABASE_URL_KEYS = [
  "DATABASE_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL",
  "NEON_DATABASE_URL",
] as const

/** Required environment variables for production API routes. */
export const REQUIRED_SERVER_ENV = [
  "DATABASE_URL",
  "NEXTAUTH_SECRET",
  "ANTHROPIC_API_KEY",
] as const

export const REQUIRED_STRIPE_ENV = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "NEXT_PUBLIC_APP_URL",
] as const

export function getMissingEnv(keys: readonly string[]): string[] {
  return keys.filter((key) => !process.env[key]?.trim())
}

/**
 * Resolve a PostgreSQL URL from standard env names and sync DATABASE_URL
 * so Prisma and other tools see a single canonical variable.
 */
export function resolveDatabaseUrl(): string {
  for (const key of DATABASE_URL_KEYS) {
    const value = process.env[key]?.trim()
    if (value) {
      if (!process.env.DATABASE_URL?.trim()) {
        process.env.DATABASE_URL = value
      }
      return value
    }
  }
  throw new Error(
    `Missing database URL. Set DATABASE_URL (or POSTGRES_PRISMA_URL / POSTGRES_URL on Vercel).`,
  )
}

export function hasDatabaseUrl(): boolean {
  return DATABASE_URL_KEYS.some((key) => Boolean(process.env[key]?.trim()))
}

export function assertServerEnv(): void {
  resolveDatabaseUrl()
  const missing = getMissingEnv(REQUIRED_SERVER_ENV).filter((key) => key !== "DATABASE_URL")
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`)
  }
}

export function assertStripeEnv(): void {
  const missing = getMissingEnv(REQUIRED_STRIPE_ENV)
  if (missing.length > 0) {
    throw new Error(`Missing Stripe environment variables: ${missing.join(", ")}`)
  }
}

export function getAppUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!url) throw new Error("NEXT_PUBLIC_APP_URL is not set")
  return url.replace(/\/$/, "")
}

/** For health checks — lists missing core env including database. */
export function getMissingCoreEnv(): string[] {
  const missing = getMissingEnv(REQUIRED_SERVER_ENV).filter((key) => key !== "DATABASE_URL")
  if (!hasDatabaseUrl()) missing.unshift("DATABASE_URL")
  return missing
}
