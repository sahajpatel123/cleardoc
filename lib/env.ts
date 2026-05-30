/** PostgreSQL connection — checked in priority order (Vercel/Neon often use POSTGRES_*). */
export const DATABASE_URL_KEYS = [
  "DATABASE_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL",
  "NEON_DATABASE_URL",
] as const

export const REQUIRED_AUTH_ENV = [
  "DATABASE_URL",
  "NEXTAUTH_SECRET",
] as const

/** Used by Prisma CLI for migrations when set (Supabase direct connection). */
export const DIRECT_DATABASE_URL_KEYS = ["DIRECT_URL", "POSTGRES_URL_NON_POOLING"] as const

/** Required environment variables for production API routes. */
export const REQUIRED_SERVER_ENV = [
  "DATABASE_URL",
  "NEXTAUTH_SECRET",
  "NVIDIA_API_KEY",
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
 * Append PgBouncer compatibility params to a PostgreSQL URL when the URL
 * targets a connection pooler (port 6543, used by Supabase Pooler).
 * Params are only added when not already present to avoid duplication.
 */
function applyPgBouncerParams(rawUrl: string): string {
  // Only apply to pooler URLs (Supabase uses port 6543 for PgBouncer)
  if (!rawUrl.includes(":6543")) return rawUrl
  try {
    const parsed = new URL(rawUrl)
    let changed = false
    if (!parsed.searchParams.has("pgbouncer")) {
      parsed.searchParams.set("pgbouncer", "true")
      changed = true
    }
    if (!parsed.searchParams.has("prepared_statements")) {
      parsed.searchParams.set("prepared_statements", "false")
      changed = true
    }
    return changed ? parsed.toString() : rawUrl
  } catch {
    // If URL parsing fails fall back to raw string manipulation
    const hasParams = rawUrl.includes("?")
    const extra = [
      !rawUrl.includes("pgbouncer=") ? "pgbouncer=true" : "",
      !rawUrl.includes("prepared_statements=") ? "prepared_statements=false" : "",
    ]
      .filter(Boolean)
      .join("&")
    if (!extra) return rawUrl
    return hasParams ? `${rawUrl}&${extra}` : `${rawUrl}?${extra}`
  }
}

/**
 * Resolve a PostgreSQL URL from standard env names and sync DATABASE_URL
 * so Prisma and other tools see a single canonical variable.
 * Automatically appends PgBouncer compatibility params for pooler URLs.
 */
export function resolveDatabaseUrl(): string {
  for (const key of DATABASE_URL_KEYS) {
    const value = process.env[key]?.trim()
    if (value) {
      const resolvedUrl = applyPgBouncerParams(value)
      if (!process.env.DATABASE_URL?.trim()) {
        process.env.DATABASE_URL = resolvedUrl
      }
      return resolvedUrl
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

export function assertAuthEnv(): void {
  resolveDatabaseUrl()
  const missing = getMissingEnv(REQUIRED_AUTH_ENV).filter((key) => key !== "DATABASE_URL")
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
