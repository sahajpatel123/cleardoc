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
