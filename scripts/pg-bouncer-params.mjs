#!/usr/bin/env node
/**
 * Canonical PgBouncer URL-rewriting logic, used by BOTH:
 *
 *   1. `lib/env.ts` (runtime) — imported as a TypeScript module
 *   2. `scripts/prebuild-migrate.mjs` (build-time) — imported as a plain
 *      Node ESM module BEFORE any TypeScript compilation / `postinstall`
 *
 * Editing one without the other has caused real bugs in the past. The two
 * call sites import THIS file as the single source of truth.
 *
 * Pure function. No side effects, no I/O. Safe to import from edge / Node /
 * browser bundlers (though it should only be called server-side).
 */

/**
 * Detect whether a URL points at a connection pooler.
 *
 * Covers:
 *   - Supabase transaction pooler on port 6543
 *   - Supabase transaction pooler on port 5432 (Supavisor)
 *   - Any URL with `pgbouncer=true` query param
 */
export function isPoolerUrl(rawUrl) {
  if (rawUrl.includes("pgbouncer=true")) return true
  if (rawUrl.includes(":6543")) return true
  // Supabase Supavisor transaction pooler uses port 5432 on the pooler host.
  if (/pooler\.supabase\.com:\d+/.test(rawUrl)) {
    const portMatch = rawUrl.match(/:(\d+)/)
    const port = portMatch ? parseInt(portMatch[1], 10) : 5432
    // Any Supabase pooler port that is NOT 6543 is treated as transaction mode.
    return port !== 6543
  }
  return false
}

/**
 * Rewrite a Supabase pooler URL from transaction mode (port 5432) to session
 * mode (port 6543). Session mode supports prepared statements and full DDL,
 * making it safe for Prisma Migrate.
 *
 * Returns the original URL if it's not a Supabase pooler URL or is already
 * on port 6543.
 */
export function toSessionPoolerUrl(rawUrl) {
  if (!rawUrl.includes("pooler.supabase.com")) return rawUrl
  if (rawUrl.includes(":6543")) return rawUrl
  return rawUrl.replace(/:(\d+)(?=\/)/, ":6543")
}

export function applyPgBouncerParams(rawUrl) {
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
