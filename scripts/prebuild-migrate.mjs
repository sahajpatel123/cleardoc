#!/usr/bin/env node
/**
 * Runs `prisma migrate deploy` during Vercel builds (via prebuild hook) when a
 * database URL is available. Supabase direct connections (port 5432) are often
 * unreachable from Vercel build workers — we prefer the pooler URL when present.
 *
 * PgBouncer URL-rewriting logic lives in scripts/pg-bouncer-params.mjs and is
 * imported by both this script and lib/env.ts so the two call sites cannot
 * drift. Edit the .mjs file — never inline a second copy.
 */
import { execSync } from "node:child_process"
import { applyPgBouncerParams } from "./pg-bouncer-params.mjs"

const DIRECT_KEYS = ["DIRECT_URL", "POSTGRES_URL_NON_POOLING"]
const POOLED_KEYS = ["DATABASE_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL"]

function firstEnv(keys) {
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value) return { key, value }
  }
  return null
}

function isPoolerUrl(url) {
  return url.includes(":6543") || url.includes("pgbouncer=true")
}

function configureMigrationEnv() {
  const pooled = firstEnv(POOLED_KEYS)
  const direct = firstEnv(DIRECT_KEYS)

  // DDL (CREATE TABLE, ALTER TABLE, PL/pgSQL) cannot run on Supabase's
  // transaction-mode pgbouncer (port 6543). It returns errors like
  // "CREATE TABLE is not allowed in transaction mode" or hangs forever.
  // Prisma uses schema.prisma's `directUrl` (= DIRECT_URL) for migrations,
  // so the rule is: DIRECT_URL must point to a NON-pooler connection when
  // present, and DATABASE_URL stays on the pooler for runtime use.

  if (direct) {
    // Operator-provided a direct (non-pooler) URL — use it for migrations.
    // Refuse if it still looks like a pooler URL (port 6543); that means
    // the operator copy-pasted the same URL into DIRECT_URL, which would
    // break DDL. Surface the misconfig loudly.
    if (isPoolerUrl(direct.value)) {
      console.warn(
        `[migrate] WARNING: ${direct.key} looks like a pgbouncer transaction-pooler URL ` +
          "(port 6543 or pgbouncer=true). DDL migrations cannot run in transaction mode. " +
          "Set DIRECT_URL to a non-pooler connection (e.g. Supabase session pooler on port 5432).",
      )
    }
    process.env.DIRECT_URL = direct.value
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
      // No direct URL provided AND the only URL is a pooler URL. Migrations
      // will fail. Log loudly and refuse to attempt rather than burn 45s
      // hanging on a doomed DDL operation.
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

function runMigrate() {
  return execSync("npx prisma migrate deploy", {
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

if (!configureMigrationEnv()) {
  process.stdout.write("[migrate] No database URL — skipping prisma migrate deploy" + "\n")
  process.exit(0)
}

/**
 * General prebuild migration runner.
 * - On transient build-env DB unreachability (P1001) or timeout: skip gracefully
 *   (exit 0) so deploys succeed; runtime ensureDatabaseSchema + out-of-band
 *   `npm run db:migrate` (or manual) handle catch-up. See deployment-and-schema.md.
 * - On other errors (incl. P3009 failed-migration states): FAIL the build
 *   (visible error + non-zero exit). No more one-shot hardcoded migration name
 *   recovery — that was a past incident (20260526180000_analysis_features).
 *   Ops must resolve manually or Schema Stabilization swarm will replace the
 *   hybrid prebuild+runtime strategy.
 */
try {
  const out = runMigrate()
  if (out) process.stdout.write(out)
} catch (err) {
  if (isUnreachableError(err) || err.killed || err.signal === "SIGTERM") {
    console.warn(
      "[migrate] Database unreachable or timed out from build environment — skipping migrations.",
    )
    console.warn(
      "[migrate] Run `npx prisma migrate deploy` locally or fix Supabase network access.",
    )
    process.exit(0)
  }

  if (err.stdout) process.stdout.write(err.stdout)
  if (err.stderr) process.stderr.write(err.stderr)
  process.exit(err.status ?? 1)
}
