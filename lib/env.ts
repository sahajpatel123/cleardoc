/** PostgreSQL connection — checked in priority order (Vercel/Neon often use POSTGRES_*). */
export const DATABASE_URL_KEYS = [
  "DATABASE_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL",
  "NEON_DATABASE_URL",
] as const

export const REQUIRED_AUTH_ENV = [
  "DATABASE_URL",
  // NextAuth v5 accepts both NEXTAUTH_SECRET and AUTH_SECRET. We require one of
  // them via resolvedAuthSecret() rather than constraining to a single name.
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

// The runtime implementation lives in scripts/pg-bouncer-params.mjs (it must
// be plain ESM so scripts/prebuild-migrate.mjs can import it at install time,
// before any TypeScript compilation has produced .js files). The sibling
// .d.mts file provides ambient types for TypeScript consumers.
import { applyPgBouncerParams as _applyPgBouncerParamsRaw } from "../scripts/pg-bouncer-params.mjs"
export const applyPgBouncerParams: (rawUrl: string) => string = _applyPgBouncerParamsRaw
import { createLogger, captureException } from "@/lib/observability"
const _envLog = createLogger("env")

/**
 * Resolve a PostgreSQL URL from standard env names and sync DATABASE_URL
 * so Prisma and other tools see a single canonical variable.
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
  assertProductionRateLimiter()
  assertProductionEnvSafety()
}

/** Resolve the NextAuth v5 secret from either NEXTAUTH_SECRET or AUTH_SECRET. */
export function resolvedAuthSecret(): string {
  return process.env.NEXTAUTH_SECRET?.trim() ?? process.env.AUTH_SECRET?.trim() ?? ""
}

export function assertAuthEnv(): void {
  resolveDatabaseUrl()
  if (!resolvedAuthSecret()) {
    throw new Error(
      "Missing required environment variable: NEXTAUTH_SECRET (or AUTH_SECRET, supported by NextAuth v5)",
    )
  }
  assertProductionRateLimiter()
  // NOTE: Stripe live-mode guard is intentionally NOT called here. Signup
  // does not touch Stripe — only the /api/stripe/* routes do — so blocking
  // signup because the operator has not yet swapped test→live keys is a
  // bug, not a safety win. The Stripe guard is enforced in assertStripeEnv()
  // below and is wired up by /api/stripe/create-checkout, /portal, /webhook,
  // and lib/stripe.ts (everywhere Stripe is actually used).
  assertProductionEnvSafety()
}

export function assertStripeEnv(): void {
  const missing = getMissingEnv(REQUIRED_STRIPE_ENV)
  if (missing.length > 0) {
    throw new Error(`Missing Stripe environment variables: ${missing.join(", ")}`)
  }
  assertProductionRateLimiter()
  assertProductionEnvSafety()
  assertStripeLiveMode()
}

export function getAppUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!url) throw new Error("NEXT_PUBLIC_APP_URL is not set")
  return url.replace(/\/$/, "")
}

/**
 * Validate that a request's Origin or Referer header matches the app's
 * canonical URL. Used on state-changing routes that accept multipart/form-data
 * (which a malicious <form> can submit cross-origin) to prevent CSRF.
 *
 * Returns `true` when the origin is same-site or when the header is missing
 * but the request is from a trusted source (e.g. server-to-server). In
 * production, a missing Origin on a state-changing route is treated as
 * suspicious and returns `false`.
 */
export function isValidOrigin(req: { headers: Headers }): boolean {
  const origin = req.headers.get("origin")
  const referer = req.headers.get("referer")
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() ?? ""

  if (!appUrl) {
    // In production we must have a canonical URL to validate origins.
    // Without one, state-changing routes are vulnerable to CSRF.
    return process.env.NODE_ENV !== "production"
  }

  const allowedOrigin = appUrl.toLowerCase()

  if (origin) {
    return origin.toLowerCase() === allowedOrigin
  }

  // Fallback to referer check (less strict — any subpath is acceptable)
  if (referer) {
    try {
      const refererOrigin = new URL(referer).origin.toLowerCase()
      return refererOrigin === allowedOrigin
    } catch {
      // Malformed referer header — treat as invalid origin
      return false
    }
  }

  // No origin/referer header. In production, reject state-changing requests
  // without an origin header. In dev, allow (e.g. curl, testing tools).
  return process.env.NODE_ENV !== "production"
}

/** For health checks — lists missing core env including database. */
export function getMissingCoreEnv(): string[] {
  const missing = getMissingEnv(REQUIRED_SERVER_ENV).filter((key) => key !== "DATABASE_URL")
  if (!hasDatabaseUrl()) missing.unshift("DATABASE_URL")
  return missing
}

/**
 * Startup guard for production: distributed rate limiter (Upstash Redis) is
 * MANDATORY. The in-memory fallback in lib/rate-limit.ts is per-process only
 * and multiplies effective limits across serverless instances — unacceptable
 * for abuse/Cogs protection on analyze, chat, billing, login paths in prod.
 *
 * Call this early (via assertServerEnv or health) in production deploys.
 * Does nothing outside NODE_ENV=production.
 */
export function assertProductionRateLimiter(): void {
  if (process.env.NODE_ENV !== "production") return

  const hasUpstash =
    !!process.env.UPSTASH_REDIS_REST_URL?.trim() &&
    !!process.env.UPSTASH_REDIS_REST_TOKEN?.trim()

  if (!hasUpstash) {
    throw new Error(
      "CRITICAL PRODUCTION GUARD: Distributed rate limiter is required. " +
        "Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (Upstash). " +
        "In-memory fallback is unsafe for production (limits multiplied by instance count; no coordination across deploys). " +
        "See lib/rate-limit.ts and BUILD/DEPLOYMENT cleanup.",
    )
  }
}

/**
 * Production-only safety guards. Called from assertAuthEnv(), assertServerEnv(),
 * and assertStripeEnv() — i.e. from every entry point that gates an API route.
 *
 * Catches configuration mistakes that would otherwise ship silently:
 *
 *   1. NEXTAUTH_SECRET shorter than 32 chars in production — refuses to
 *      boot. NextAuth v5 accepts any non-empty string, but RFC 2104 / NIST
 *      guidance is 256 bits of entropy (32 base64 chars ~= 192 bits).
 *
 *   2. NVIDIA NIM baseURL pointing at the trial endpoint (integrate.api.nvidia.com)
 *      — logs a hard warning. The trial endpoint logs inputs and outputs
 *      for product improvement; sending HIPAA / GDPR / privileged-document
 *      content through it is a regulatory violation. There is no API-level
 *      way to disable logging; the only fixes are (a) self-host Nemotron on
 *      a private endpoint or (b) sign an enterprise contract with NVIDIA.
 *      We refuse to silence the warning — the operator must take action.
 *
 *   3. NEXT_PUBLIC_APP_URL still set to localhost in production — refuses
 *      to boot. Stripe success/cancel URLs would all point to localhost.
 *
 * NOTE: Stripe live-mode enforcement (sk_test_ / pk_test_ skew) lives in
 * its own assertStripeLiveMode() so it can be wired to the routes that
 * actually use Stripe (/api/stripe/* + lib/stripe.ts) without blocking
 * auth, AI, and billing-agnostic routes that have no business with Stripe.
 */
export function assertProductionEnvSafety(): void {
  if (process.env.NODE_ENV !== "production") return

  const nextAuthSecret = process.env.NEXTAUTH_SECRET?.trim() ?? process.env.AUTH_SECRET?.trim() ?? ""
  if (nextAuthSecret && nextAuthSecret.length < 32) {
    throw new Error(
      "CRITICAL PRODUCTION GUARD: NEXTAUTH_SECRET is shorter than 32 characters. " +
        "Generate a stronger secret: openssl rand -base64 32",
    )
  }

  const aiBaseUrl = process.env.NVIDIA_API_BASE_URL?.trim() ?? "https://integrate.api.nvidia.com/v1"
  if (aiBaseUrl.includes("integrate.api.nvidia.com")) {
    // Log but do not throw — the trial endpoint is functional, just
    // privacy-incompatible. The operator must act before serving EU/health/
    // immigration users. We log at error level so it surfaces in Vercel
    // function logs but does not break the boot.
    _envLog.error(
      "NVIDIA_API_BASE_URL is the trial endpoint (integrate.api.nvidia.com) — trial endpoint LOGS inputs/outputs; " +
        "sending HIPAA / GDPR / privileged-document content through it is a regulatory violation. " +
        "Set NVIDIA_API_BASE_URL to a private deployment or sign an enterprise DPA.",
    )
    captureException(
      new Error("NVIDIA_API_BASE_URL is the trial endpoint — privacy violation risk"),
      { component: "env-safety", extra: { aiBaseUrl } }
    )
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() ?? ""
  if (appUrl) {
    // Reject any loopback / private-network address in production. A
    // misconfigured APP_URL would silently send Stripe success URLs and
    // password-reset emails to the developer's machine, or worse to an
    // internal service that the attacker can register.
    if (
      appUrl.includes("localhost") ||
      appUrl.includes("127.0.0.1") ||
      appUrl.includes("[::1]") ||
      // 10.0.0.0/8, 172.16/12, 192.168/16 — RFC 1918 private space
      /https?:\/\/(10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d+)?(\/|$)/.test(
        appUrl,
      )
    ) {
      throw new Error(
        `CRITICAL PRODUCTION GUARD: NEXT_PUBLIC_APP_URL (${appUrl}) resolves to ` +
          "a loopback (localhost / 127.0.0.1 / ::1) or RFC 1918 private-network " +
          "address. Stripe success/cancel URLs and email links would point to an " +
          "unreachable or attacker-controllable host. Set NEXT_PUBLIC_APP_URL to " +
          "the public Vercel URL before deploying.",
      )
    }
  }
}

/**
 * Stripe live-mode guard. ONLY called from assertStripeEnv() and the routes
 * that actually touch Stripe. Refuses to boot if:
 *
 *   - STRIPE_SECRET_KEY starts with sk_test_ — would create non-chargeable
 *     Checkout sessions and fail webhook signature verification, silently
 *     never granting Pro to paying customers.
 *   - NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is pk_test_ while the secret is
 *     sk_live_ (or vice versa) — the skew is the most dangerous misconfig
 *     because it looks correct at a glance.
 *
 * Previously this guard lived inside assertProductionEnvSafety() and ran on
 * every API route (including signup and AI), which broke signup when the
 * operator had not yet swapped test→live keys. The right scope is "every
 * route that actually uses Stripe", which is what assertStripeEnv() covers.
 */
export function assertStripeLiveMode(): void {
  if (process.env.NODE_ENV !== "production") return

  const stripeSecret = process.env.STRIPE_SECRET_KEY?.trim() ?? ""
  if (stripeSecret && stripeSecret.startsWith("sk_test_")) {
    throw new Error(
      "CRITICAL PRODUCTION GUARD: STRIPE_SECRET_KEY starts with sk_test_. " +
        "Refusing to boot. Switch to a live Stripe secret (sk_live_…) before deploying. " +
        "See lib/env.ts assertStripeLiveMode.",
    )
  }
  const stripePub = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() ?? ""
  if (stripePub && stripePub.startsWith("pk_test_") && !stripeSecret.startsWith("sk_test_")) {
    throw new Error(
      "CRITICAL PRODUCTION GUARD: NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY starts with pk_test_ " +
        "but STRIPE_SECRET_KEY is live. Refusing to boot. Either both test or both live.",
    )
  }
}
