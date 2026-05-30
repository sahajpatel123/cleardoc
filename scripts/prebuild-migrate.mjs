#!/usr/bin/env node
/**
 * Runs `prisma migrate deploy` during Vercel builds when a direct DB URL is
 * available. Supabase integrations often expose POSTGRES_URL_NON_POOLING
 * instead of DIRECT_URL — this script bridges that gap.
 */
import { execSync } from "node:child_process"

const DIRECT_KEYS = ["DIRECT_URL", "POSTGRES_URL_NON_POOLING"]

function hasDirectUrl() {
  return DIRECT_KEYS.some((key) => process.env[key]?.trim())
}

function ensureDirectUrl() {
  if (process.env.DIRECT_URL?.trim()) return
  for (const key of DIRECT_KEYS) {
    const value = process.env[key]?.trim()
    if (value) {
      process.env.DIRECT_URL = value
      console.log(`[migrate] Using ${key} as DIRECT_URL for Prisma migrations`)
      return
    }
  }
}

function runMigrate() {
  return execSync("npx prisma migrate deploy", {
    encoding: "utf8",
    env: process.env,
  })
}

function isFailedMigrationError(err) {
  const msg = `${err?.stdout ?? ""}${err?.stderr ?? ""}${err?.message ?? ""}`
  return msg.includes("P3009") && msg.includes("20260526180000_analysis_features")
}

if (!hasDirectUrl()) {
  console.log("[migrate] No direct database URL — skipping prisma migrate deploy")
  process.exit(0)
}

ensureDirectUrl()

try {
  const out = runMigrate()
  if (out) process.stdout.write(out)
} catch (err) {
  if (!isFailedMigrationError(err)) {
    if (err.stdout) process.stdout.write(err.stdout)
    if (err.stderr) process.stderr.write(err.stderr)
    process.exit(err.status ?? 1)
  }

  console.warn(
    "[migrate] Recovering from failed 20260526180000_analysis_features migration…",
  )
  try {
    execSync(
      "npx prisma migrate resolve --rolled-back 20260526180000_analysis_features",
      { stdio: "inherit", env: process.env },
    )
    const out = runMigrate()
    if (out) process.stdout.write(out)
  } catch (retryErr) {
    console.error("[migrate] Migration recovery failed")
    if (retryErr.stdout) process.stdout.write(retryErr.stdout)
    if (retryErr.stderr) process.stderr.write(retryErr.stderr)
    process.exit(retryErr.status ?? 1)
  }
}
