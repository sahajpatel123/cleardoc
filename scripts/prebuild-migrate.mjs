#!/usr/bin/env node
/**
 * Runs `prisma migrate deploy` during Vercel builds when a database URL is
 * available. Supabase direct connections (port 5432) are often unreachable from
 * Vercel build workers — we prefer the pooler URL when present.
 */
import { execSync } from "node:child_process"

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

function applyPgBouncerParams(rawUrl) {
  if (!rawUrl.includes(":6543")) return rawUrl
  try {
    const parsed = new URL(rawUrl)
    if (!parsed.searchParams.has("pgbouncer")) {
      parsed.searchParams.set("pgbouncer", "true")
    }
    if (!parsed.searchParams.has("prepared_statements")) {
      parsed.searchParams.set("prepared_statements", "false")
    }
    return parsed.toString()
  } catch {
    return rawUrl
  }
}

function configureMigrationEnv() {
  const pooled = firstEnv(POOLED_KEYS)
  const direct = firstEnv(DIRECT_KEYS)

  if (pooled && isPoolerUrl(pooled.value)) {
    const url = applyPgBouncerParams(pooled.value)
    process.env.DATABASE_URL = url
    process.env.DIRECT_URL = url
    console.log(`[migrate] Using ${pooled.key} (pooler) for migrations`)
    return true
  }

  if (direct) {
    process.env.DIRECT_URL = direct.value
    if (!process.env.DATABASE_URL?.trim() && pooled) {
      process.env.DATABASE_URL = pooled.value
    }
    console.log(`[migrate] Using ${direct.key} for migrations`)
    return true
  }

  if (pooled) {
    process.env.DATABASE_URL = pooled.value
    process.env.DIRECT_URL = pooled.value
    console.log(`[migrate] Using ${pooled.key} for migrations`)
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

function isFailedMigrationError(err) {
  const msg = errorText(err)
  return msg.includes("P3009") && msg.includes("20260526180000_analysis_features")
}

function isUnreachableError(err) {
  return errorText(err).includes("P1001")
}

if (!configureMigrationEnv()) {
  console.log("[migrate] No database URL — skipping prisma migrate deploy")
  process.exit(0)
}

function tryRecoverAndMigrate(initialErr) {
  if (!isFailedMigrationError(initialErr)) {
    throw initialErr
  }

  console.warn(
    "[migrate] Recovering from failed 20260526180000_analysis_features migration…",
  )
  execSync(
    "npx prisma migrate resolve --rolled-back 20260526180000_analysis_features",
    { stdio: "inherit", env: process.env },
  )
  return runMigrate()
}

try {
  const out = runMigrate()
  if (out) process.stdout.write(out)
} catch (err) {
  try {
    const out = tryRecoverAndMigrate(err)
    if (out) process.stdout.write(out)
  } catch (retryErr) {
    if (isUnreachableError(retryErr) || retryErr.killed || retryErr.signal === "SIGTERM") {
      console.warn(
        "[migrate] Database unreachable or timed out from build environment — skipping migrations.",
      )
      console.warn(
        "[migrate] Run `npx prisma migrate deploy` locally or fix Supabase network access.",
      )
      process.exit(0)
    }

    if (retryErr.stdout) process.stdout.write(retryErr.stdout)
    if (retryErr.stderr) process.stderr.write(retryErr.stderr)
    process.exit(retryErr.status ?? 1)
  }
}
