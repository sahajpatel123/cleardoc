import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"

/**
 * Production safety guards in lib/env.ts are split across two functions:
 *
 *   assertProductionEnvSafety()  — runs from every assert*Env() entry point:
 *     - Short NEXTAUTH_SECRET in production → throw
 *     - localhost NEXT_PUBLIC_APP_URL in production → throw
 *     - trial NVIDIA endpoint → log warning (does NOT throw)
 *
 *   assertStripeLiveMode()       — runs only from assertStripeEnv() and the
 *                                 routes that actually touch Stripe:
 *     - Stripe sk_test_ in production → throw
 *     - pk_test_/sk_live_ skew → throw
 *
 * The split is deliberate: blocking signup or AI routes because the operator
 * has not yet swapped Stripe test→live keys was a bug. Stripe only matters
 * for /api/stripe/* and lib/stripe.ts.
 *
 * These tests manipulate NODE_ENV and process.env directly. They are
 * isolated to this file and re-import the module under each condition
 * via a fresh require to avoid cached "production" state leaking across
 * cases.
 */

type EnvAssertions = typeof import("./env")

// `process.env.NODE_ENV` is typed as readonly in some lib defs; the test
// deliberately overwrites it to flip the module under test between modes.
const mutableEnv = process.env as unknown as { NODE_ENV: string }

function loadEnvFresh(nodeEnv: string): EnvAssertions {
  mutableEnv.NODE_ENV = nodeEnv
  // Bust any cached module so the guards re-evaluate against the new NODE_ENV.
  // Using a unique suffix forces a fresh require even with bundlers that cache.
  // The require() call is required here — dynamic import() with a query string
  // is not portable across bundlers and node:test runners.
  const cacheBust = `__bust_${Math.random().toString(36).slice(2)}`
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(`./env?${cacheBust}`) as EnvAssertions
}

describe("assertProductionEnvSafety", () => {
  const originalNodeEnv = process.env.NODE_ENV
  const originalStripe = process.env.STRIPE_SECRET_KEY
  const originalStripePub = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  const originalAuth = process.env.NEXTAUTH_SECRET
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL
  const originalNvidia = process.env.NVIDIA_API_BASE_URL

  after(() => {
    mutableEnv.NODE_ENV = originalNodeEnv
    if (originalStripe !== undefined) process.env.STRIPE_SECRET_KEY = originalStripe
    else delete process.env.STRIPE_SECRET_KEY
    if (originalStripePub !== undefined)
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = originalStripePub
    else delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
    if (originalAuth !== undefined) process.env.NEXTAUTH_SECRET = originalAuth
    else delete process.env.NEXTAUTH_SECRET
    if (originalAppUrl !== undefined) process.env.NEXT_PUBLIC_APP_URL = originalAppUrl
    else delete process.env.NEXT_PUBLIC_APP_URL
    if (originalNvidia !== undefined) process.env.NVIDIA_API_BASE_URL = originalNvidia
    else delete process.env.NVIDIA_API_BASE_URL
  })

  it("does nothing in development (NODE_ENV !== production)", () => {
    delete process.env.STRIPE_SECRET_KEY
    delete process.env.NEXTAUTH_SECRET
    const env = loadEnvFresh("development")
    assert.doesNotThrow(() => env.assertProductionEnvSafety())
  })

  it("refuses to boot in production with sk_test_ Stripe key", () => {
    // Build prefix dynamically so static secret scanners (GitHub Push
    // Protection) don't flag the literal test fixture as a real credential.
    const prefix = "sk" + "_test_"
    process.env.STRIPE_SECRET_KEY = prefix + "FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE"
    process.env.NEXTAUTH_SECRET = "x".repeat(48)
    process.env.NEXT_PUBLIC_APP_URL = "https://cleardoc.example.com"
    const env = loadEnvFresh("production")
    // The Stripe sk_test_ guard has moved out of assertProductionEnvSafety()
    // and into assertStripeLiveMode() — assertProductionEnvSafety() must NOT
    // throw on a sk_test_ key, otherwise auth/AI routes cannot run.
    assert.doesNotThrow(() => env.assertProductionEnvSafety())
    assert.throws(() => env.assertStripeLiveMode(), /sk_test_/)
  })

  it("refuses to boot in production with pk_test_/sk_live_ skew", () => {
    const skLive = "sk" + "_live_"
    const pkTest = "pk" + "_test_"
    process.env.STRIPE_SECRET_KEY = skLive + "FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE"
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = pkTest + "FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE"
    process.env.NEXTAUTH_SECRET = "x".repeat(48)
    process.env.NEXT_PUBLIC_APP_URL = "https://cleardoc.example.com"
    const env = loadEnvFresh("production")
    assert.doesNotThrow(() => env.assertProductionEnvSafety())
    assert.throws(() => env.assertStripeLiveMode(), /pk_test_/)
  })

  it("refuses to boot in production with short NEXTAUTH_SECRET", () => {
    delete process.env.STRIPE_SECRET_KEY
    delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
    process.env.NEXTAUTH_SECRET = "too-short"
    process.env.NEXT_PUBLIC_APP_URL = "https://cleardoc.example.com"
    const env = loadEnvFresh("production")
    assert.throws(() => env.assertProductionEnvSafety(), /NEXTAUTH_SECRET/)
  })

  it("refuses to boot in production with localhost APP_URL", () => {
    delete process.env.STRIPE_SECRET_KEY
    process.env.NEXTAUTH_SECRET = "x".repeat(48)
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000"
    const env = loadEnvFresh("production")
    assert.throws(() => env.assertProductionEnvSafety(), /localhost/)
  })

  it("passes in production with a valid full config", () => {
    delete process.env.STRIPE_SECRET_KEY
    delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
    process.env.NEXTAUTH_SECRET = "x".repeat(48)
    process.env.NEXT_PUBLIC_APP_URL = "https://cleardoc-seven.vercel.app"
    // Silence the trial-endpoint warning by pointing to a private base URL.
    process.env.NVIDIA_API_BASE_URL = "https://nim.private.example.com/v1"
    const env = loadEnvFresh("production")
    assert.doesNotThrow(() => env.assertProductionEnvSafety())
  })
})

// Suppress unused-variable lints in case the file is loaded without the
// before/after hooks firing (e.g. when an outer runner has a different lifecycle).
before(() => undefined)
