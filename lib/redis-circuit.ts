/**
 * Redis circuit breaker + safe-call wrapper.
 *
 * Without this, a transient Upstash outage makes every rate-limit, quota,
 * cache, and token-version call hang on HTTP timeout (10-50s per call). On
 * a serverless instance with a 30s route budget, this turns a Redis blip
 * into a full app outage: all routes return 503 or 504.
 *
 * Strategy: track recent Redis failures in a process-local Map keyed by
 * service ("rate-limit", "quota", "cache", "token-cache"). When the failure
 * rate crosses a threshold within a sliding window, mark the service
 * "OPEN" for a short cool-down. While OPEN, calls return the supplied
 * fallback immediately instead of attempting the Redis round-trip. The
 * circuit auto-closes after the cool-down elapses (no half-open probe —
 * Redis is best-effort, not critical-path).
 *
 * This is intentionally per-process: cross-instance coordination would
 * require another round-trip, defeating the purpose. Each serverless
 * instance independently opens its circuit. Once the underlying Redis
 * recovers, all instances independently close their circuits within the
 * 30s cool-down — at worst, the user sees a 30s window of degraded mode.
 */
import { createLogger } from "@/lib/observability"

const log = createLogger("redis-circuit")

const FAILURE_WINDOW_MS = 30_000
const FAILURE_THRESHOLD = 3
const COOL_DOWN_MS = 30_000

type Service = "rate-limit" | "quota" | "cache" | "token-cache"

type CircuitState = {
  failures: number[]
  openUntil: number
  consecutiveOpens: number
}

const _circuits = new Map<Service, CircuitState>()

function getCircuit(service: Service): CircuitState {
  let c = _circuits.get(service)
  if (!c) {
    c = { failures: [], openUntil: 0, consecutiveOpens: 0 }
    _circuits.set(service, c)
  }
  return c
}

export function isRedisCircuitOpen(service: Service): boolean {
  const c = getCircuit(service)
  if (c.openUntil > Date.now()) return true
  if (c.openUntil > 0 && c.openUntil <= Date.now()) {
    // Cool-down elapsed — half-close. Reset failure window.
    log.info({ service }, "redis circuit closing — cool-down elapsed")
    c.failures = []
    c.openUntil = 0
  }
  return false
}

export function recordRedisFailure(service: Service): void {
  const c = getCircuit(service)
  const now = Date.now()
  c.failures = c.failures.filter((t) => t > now - FAILURE_WINDOW_MS)
  c.failures.push(now)
  if (c.failures.length >= FAILURE_THRESHOLD && c.openUntil <= now) {
    c.consecutiveOpens += 1
    c.openUntil = now + COOL_DOWN_MS
    log.error(
      { service, failures: c.failures.length, coolDownMs: COOL_DOWN_MS, consecutiveOpens: c.consecutiveOpens },
      "redis circuit opened — failing fast to local fallback",
    )
  }
}

export function recordRedisSuccess(service: Service): void {
  const c = getCircuit(service)
  if (c.consecutiveOpens > 0) {
    log.info({ service, previousOpens: c.consecutiveOpens }, "redis circuit fully closed after successful call")
  }
  c.failures = []
  c.consecutiveOpens = 0
  c.openUntil = 0
}

/**
 * Run a Redis call with circuit-breaker protection. If the circuit is OPEN
 * the fallback runs immediately. If the call throws, record the failure
 * and run the fallback.
 *
 * Use this for every Redis touchpoint where the route can degrade
 * gracefully (rate limiting → in-memory; quota → DB-only check; cache →
 * skip; token-cache → DB).
 */
export async function withRedisCircuit<T>(
  service: Service,
  fn: () => Promise<T>,
  fallback: () => T | Promise<T>,
): Promise<T> {
  if (isRedisCircuitOpen(service)) {
    return fallback()
  }
  try {
    const result = await fn()
    recordRedisSuccess(service)
    return result
  } catch {
    // The error is already swallowed by the fallback semantics; the
    // circuit breaker just needs to know that a failure occurred, not
    // what the error was. Logging would be redundant with the caller's
    // own logging.
    recordRedisFailure(service)
    return fallback()
  }
}
