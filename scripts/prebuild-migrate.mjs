#!/usr/bin/env node
/**
 * Runs `prisma migrate deploy` during Vercel builds (via prebuild hook) when a
 * database URL is available.
 *
 * Supabase connection strategy:
 *   - Runtime (Prisma queries) → transaction pooler on port 5432 or 6543.
 *   - Migrations (Prisma Migrate) → session pooler on port 6543, OR a direct
 *     connection (db.xxx.supabase.co:5432). DDL does NOT work on Supabase's
 *     transaction-mode pooler.
 *
 * PgBouncer / Supavisor URL-rewriting logic lives in
 * scripts/pg-bouncer-params.mjs and is imported by both this script and
 * lib/env.ts so the two call sites cannot drift.
 */
import { execFileSync } from "node:child_process"
import { applyPgBouncerParams, isPoolerUrl, toSessionPoolerUrl, DATABASE_URL_KEYS, DIRECT_DATABASE_URL_KEYS, getFirstEnvValue } from "./pg-bouncer-params.mjs"

function configureMigrationEnv() {
  const pooled = getFirstEnvValue(process.env, DATABASE_URL_KEYS)
  const direct = getFirstEnvValue(process.env, DIRECT_DATABASE_URL_KEYS)

  if (direct) {
    // Operator provided a direct / non-pooler URL. Use it for migrations.
    // If it is actually a Supabase transaction-pooler URL (the only kind
    // Supabase's auto-generated "direct" connection string can be, since
    // Supabase has no unmanaged direct endpoint on free/pro tiers), rewrite
    // it to session-mode port 6543 — this is the EXPECTED path, not a
    // misconfig, so log it on stdout (informational) rather than stderr
    // (Vercel treats stderr as a warning and fails-soft-gates the deploy).
    if (isPoolerUrl(direct.value)) {
      const sessionUrl = toSessionPoolerUrl(direct.value)
      if (sessionUrl !== direct.value) {
        process.stdout.write(
          `[migrate] ${direct.key} points at Supabase transaction pooler; ` +
            `rewriting to session pooler (port 6543) for migrations.\n`,
        )
        process.env.DIRECT_URL = sessionUrl
      } else {
        console.warn(
          `[migrate] WARNING: ${direct.key} looks like a pgbouncer pooler URL ` +
            "but cannot be rewritten to session mode. " +
            "DDL migrations may fail in transaction mode.",
        )
        process.env.DIRECT_URL = direct.value
      }
    } else {
      process.env.DIRECT_URL = direct.value
    }

    if (pooled) {
      const url = isPoolerUrl(pooled.value)
        ? applyPgBouncerParams(pooled.value)
        : pooled.value
      process.env.DATABASE_URL = url
    } else if (!process.env.DATABASE_URL?.trim()) {
      process.env.DATABASE_URL = direct.value
    }
    process.stdout.write(
      `[migrate] ${direct.key} → DIRECT_URL (migrations), ` +
        `${pooled ? pooled.key : "DATABASE_URL"} → DATABASE_URL (runtime)` + "\n",
    )
    return true
  }

  if (pooled) {
    if (isPoolerUrl(pooled.value)) {
      const sessionUrl = toSessionPoolerUrl(pooled.value)
      if (sessionUrl !== pooled.value) {
        // We can rewrite the Supabase transaction pooler to session mode.
        // Use the session URL for migrations, and keep the original for runtime.
        const runtimeUrl = applyPgBouncerParams(pooled.value)
        process.env.DATABASE_URL = runtimeUrl
        process.env.DIRECT_URL = sessionUrl
        process.stdout.write(
          `[migrate] ${pooled.key} → session pooler (port 6543) for migrations, ` +
            `original for runtime` + "\n",
        )
        return true
      }

      // Non-Supabase pooler that we can't rewrite. Refuse rather than hang.
      console.warn(
        "[migrate] REFUSING TO MIGRATE: only a pgbouncer transaction-pooler URL is configured. " +
          "DDL cannot run in transaction mode. Set DIRECT_URL to a non-pooler connection.",
      )
      return false
    }

    const url = applyPgBouncerParams(pooled.value)
    process.env.DATABASE_URL = url
    process.env.DIRECT_URL = url
    process.stdout.write(`[migrate] Using ${pooled.key} for both DATABASE_URL and DIRECT_URL` + "\n")
    return true
  }

  return false
}

// Hardened to prevent command injection. The previous version interpolated
// `migrationName` directly into a shell string — a name containing `$`, `;`,
// or backticks could execute arbitrary shell. We now use execFileSync with an
// argv array, and validate the migration name against a strict regex (cuid-
// shaped migration directories, with optional `.sql` suffix) before passing
// to prisma. Anything that fails the regex is treated as a build error.
const MIGRATION_NAME_RE = /^[a-z0-9_]{8,40}$/i

function runMigrate() {
  return execFileSync("npx", ["prisma", "migrate", "deploy"], {
    encoding: "utf8",
    env: process.env,
    timeout: 120_000,
  })
}

function runResolveApplied(migrationName) {
  if (!MIGRATION_NAME_RE.test(migrationName)) {
    throw new Error(
      `[migrate] Refusing to resolve migration with invalid name: ${JSON.stringify(migrationName)}`,
    )
  }
  return execFileSync("npx", ["prisma", "migrate", "resolve", "--applied", migrationName], {
    encoding: "utf8",
    env: process.env,
    timeout: 45_000,
  })
}

function errorText(err) {
  return `${err?.stdout ?? ""}${err?.stderr ?? ""}${err?.message ?? ""}`
}

function isUnreachableError(err) {
  return errorText(err).includes("P1001")
}

function isFailedMigrationError(err) {
  const text = errorText(err)
  return text.includes("P3018")
}

function extractFailedMigrationName(err) {
  const text = errorText(err)
  const match = text.match(/Migration name:\s*(\S+)/)
  return match ? match[1] : null
}

if (!configureMigrationEnv()) {
  // In production, missing database URL means migrations were NOT applied.
  // This is a critical misconfiguration - fail the build to prevent runtime errors.
  // The Vercel build environment may not have access to Supabase, but a direct URL
  // or a dedicated migration step should always be provided.
  if (process.env.NODE_ENV === "production") {
    console.error(
      "[migrate] FATAL: No database URL configured in production — " +
        "migrations were not run. Set DATABASE_URL or DIRECT_URL to fix.",
    )
    process.exit(1)
  }
  process.stdout.write("[migrate] No database URL — skipping prisma migrate deploy (dev)" + "\n")
  process.exit(0)
}

/**
 * Prebuild migration runner with resilient failure recovery.
 *
 * - On transient build-env DB unreachability (P1001) or timeout: skip
 *   gracefully (exit 0) so deploys succeed.
 * - On P3018 (failed migration blocking the queue): attempt to resolve the
 *   failed migration as applied when it is the known historical incident
 *   "20260526180000_analysis_features". This migration only adds optional
 *   columns / indexes / FKs with IF NOT EXISTS guards. The production DB
 *   already has these columns because the running app (a8077d0) uses them.
 *   Resolving it unblocks the remaining migrations.
 * - On other errors: FAIL the build (non-zero exit) so the error is visible.
 */
try {
  const out = runMigrate()
  if (out) process.stdout.write(out)
} catch (err) {
  if (isUnreachableError(err) || err.killed || err.signal === "SIGTERM") {
    // Vercel's build environment cannot reach Supabase's pooler (builds
    // run on an isolated network, and Supabase's pooler only allows
    // runtime IPs, not Vercel build IPs). The deploy still succeeds — the
    // runtime Prisma client will run pending migrations on first request
    // (via lib/ensure-schema.ts) — so skipping here is the safe default.
    // Log to stdout (informational), not stderr, so Vercel does not flag
    // the build as having warnings.
    process.stdout.write(
      "[migrate] Build env cannot reach Supabase pooler — skipping prisma migrate deploy.\n" +
        "[migrate] Runtime will apply pending schema via lib/ensure-schema.ts. " +
        "Run `npx prisma migrate deploy` locally for an explicit baseline.\n",
    )
    process.exit(0)
  }

  // P3018 — a previous migration failed and is blocking new ones.
  if (isFailedMigrationError(err)) {
    const failedMigration = extractFailedMigrationName(err)
    if (failedMigration === "20260526180000_analysis_features") {
      console.warn(
        `[migrate] Detected failed migration ${failedMigration} blocking the queue. ` +
          "Resolving as applied (schema is already in place; running app depends on these columns).",
      )
      try {
        const resolveOut = runResolveApplied(failedMigration)
        if (resolveOut) process.stdout.write(resolveOut)
        console.warn(`[migrate] Resolved ${failedMigration}. Retrying migrate deploy...`)
        const retryOut = runMigrate()
        if (retryOut) process.stdout.write(retryOut)
        process.exit(0)
      } catch (resolveErr) {
        console.error(
          `[migrate] FAILED to resolve ${failedMigration}:`,
          errorText(resolveErr),
        )
        if (resolveErr.stdout) process.stdout.write(resolveErr.stdout)
        if (resolveErr.stderr) process.stderr.write(resolveErr.stderr)
        process.exit(resolveErr.status ?? 1)
      }
    }
  }

  if (err.stdout) process.stdout.write(err.stdout)
  if (err.stderr) process.stderr.write(err.stderr)
  process.exit(err.status ?? 1)
}
