/**
 * Centralized observability — structured logging via pino, optional Sentry
 * error capture. No PII (no document text, filenames, AI prompts, emails,
 * document content) ever appears in logs.
 *
 * Why pino: 5-10x faster than winston, JSON output, child loggers for
 * per-request context. In development we use pino-pretty if installed.
 *
 * Usage:
 *   const log = createLogger("analyze")
 *   log.info({ reqId, userId, phase: "extracted" }, "extracted text")
 *   log.error({ err, reqId }, "ai call failed")
 */
import pino from "pino"

const IS_PROD = process.env.NODE_ENV === "production"

export type LogContext = Record<string, unknown>

let _logger: pino.Logger | null = null

function getBaseLogger(): pino.Logger {
  if (_logger) return _logger
  _logger = pino({
    level: process.env.LOG_LEVEL ?? (IS_PROD ? "info" : "debug"),
    base: {
      app: "cleardoc",
      env: process.env.NODE_ENV ?? "development",
      ver: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
    },
    // Never log document text, filenames, AI prompts, emails, or full
    // multipart bodies. Pino's redact uses fast-redact which only supports
    // exact single-level wildcards. We enumerate the concrete key names we
    // want redacted (top-level AND nested) and rely on a defense-in-depth
    // substring check in sanitizeForSentry (see below) for variants like
    // `password_hash`, `auth_token`, `access_token`, etc.
    redact: {
      paths: [
        // Top-level keys (in case any caller logs `{ password: "..." }` directly).
        "password",
        "token",
        "secret",
        "email",
        "documentText",
        "file",
        "filename",
        "content",
        "body",
        "message",
        "userEmail",
        "cookie",
        "authorization",
        // Nested (single-level) keys.
        "*.password",
        "*.token",
        "*.secret",
        "*.email",
        "*.documentText",
        "*.file",
        "*.filename",
        "*.content",
        "*.body",
        "*.message",
        "*.userEmail",
        "*.cookie",
        "*.authorization",
        // Headers paths (canonical).
        "headers.cookie",
        "headers.authorization",
        'headers["x-health-token"]',
        'headers["x-csp-nonce"]',
        'headers["x-nonce"]',
      ],
      censor: "[REDACTED]",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  })
  return _logger
}

export function createLogger(component: string) {
  return getBaseLogger().child({ component })
}

/**
 * Capture an exception to Sentry when configured. Falls through to the
 * local logger when SENTRY_DSN is unset (which is the dev default).
 *
 * PII: never pass `documentText`, `file`, `email`, `body`, or `prompt` to
 * the `extra` parameter. Only IDs, counters, timings, and error stages.
 */
/**
 * Classify whether an error is an expected operational event that should
 * NOT be sent to Sentry (to avoid quota exhaustion from routine noise).
 */
export function isExpectedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message
  if (msg.includes("AI returned invalid JSON")) return true
  if (msg.includes("Request aborted")) return true
  if (msg.includes("Analysis deadline exceeded")) return true
  if (msg.includes("Circuit breaker OPEN")) return true
  if (msg.includes("Rate limiter unavailable")) return true
  if (msg.includes("Service temporarily unavailable")) return true
  if (msg.includes("FREE_DAILY_LIMIT_REACHED")) return true
  if (msg.includes("CHAT_LIMIT_REACHED")) return true
  return false
}

export function captureException(
  err: unknown,
  context?: { component?: string; reqId?: string; extra?: LogContext },
): void {
  const log = createLogger(context?.component ?? "app")
  const safeExtra = context?.extra ? sanitizeForSentry(context.extra) : undefined

  // Operational / expected errors are logged but NOT sent to Sentry.
  // This prevents Sentry quota exhaustion from routine model regressions,
  // rate-limit outages, and user-quota exhaustion.
  if (isExpectedError(err)) {
    log.warn({ err: err instanceof Error ? err.message : String(err), reqId: context?.reqId, ...safeExtra }, "expected operational error — not sent to sentry")
    return
  }

  log.error({ err, reqId: context?.reqId, ...safeExtra }, "captured exception")

  const dsn =
    process.env.SENTRY_DSN?.trim() ??
    (typeof window !== "undefined" ? process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() : undefined)
  if (!dsn) return
  try {
    // Dynamic require so dev runs without Sentry installed do not pay the
    // import cost or fail typecheck.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require("@sentry/nextjs")
    Sentry.captureException(err, { extra: safeExtra, tags: { component: context?.component } })
  } catch (sentryErr) {
    log.warn({ sentryErr }, "sentry capture failed (non-fatal)")
  }
}

/**
 * Defensive sanitizer for any context object before sending to Sentry or any
 * downstream log aggregator.
 *
 * Two-pass:
 *   1. Substring match on key name (case-insensitive). Catches
 *      `password_hash`, `auth_token`, `access_token`, `refresh_token`,
 *      `id_token`, `clientSecret`, `secret_key`, `api_key`, etc.
 *   2. Exact match on a known-banned set (covers single-word cases that
 *      substring over-matches, e.g. `content` would over-match `userContent`
 *      which we want to keep).
 */
export function isBannedKey(k: string): boolean {
  const lower = k.toLowerCase()
  // Substring red flags — exact case-insensitive contains.
  const SUBSTRINGS = [
    "password",
    "passwd",
    "secret",
    "token",
    "apikey",
    "api_key",
    "authorization",
    "cookie",
    "documenttext",
    "filename",
    "useremail",
  ]
  if (SUBSTRINGS.some((s) => lower.includes(s))) return true
  // Exact-match red flags — only when the whole key is one of these.
  const EXACT = new Set([
    "email",
    "file",
    "content",
    "body",
    "prompt",
    "message",
    "usercontent",
  ])
  return EXACT.has(lower)
}

function sanitizeValue(v: unknown): unknown {
  if (v === null || v === undefined) return v
  if (typeof v === "string") {
    return v.length > 500 ? `${v.slice(0, 500)}…[+${v.length - 500}]` : v
  }
  if (typeof v === "number" || typeof v === "boolean") return v
  if (Array.isArray(v)) {
    return v.map(sanitizeValue)
  }
  if (typeof v === "object") {
    const obj: LogContext = {}
    for (const [key, val] of Object.entries(v as LogContext)) {
      if (isBannedKey(key)) {
        obj[key] = "[REDACTED]"
      } else {
        obj[key] = sanitizeValue(val)
      }
    }
    return obj
  }
  return v
}

export function sanitizeForSentry(input: LogContext): LogContext {
  const out: LogContext = {}
  for (const [k, v] of Object.entries(input)) {
    if (isBannedKey(k)) {
      out[k] = "[REDACTED]"
    } else {
      out[k] = sanitizeValue(v)
    }
  }
  return out
}

/**
 * Generate a short, URL-safe request id for log correlation. Uses crypto
 * for cryptographic randomness. Throws if crypto is unavailable (we should
 * never silently fall back to Math.random — predictable reqIds are a
 * cross-request correlation risk).
 */
export function generateReqId(): string {
  if (typeof crypto === "undefined" || !("randomUUID" in crypto)) {
    throw new Error("crypto.randomUUID is required for request id generation")
  }
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16)
}

// ── Business Metrics ────────────────────────────────────────────────

/**
 * Structured business-metric log lines. These are NOT errors — they are
 * operational events that downstream log aggregators (Datadog, Grafana)
 * can count, alert on, or dashboard.
 *
 * Naming convention: `metric.<namespace>.<event>`
 *   - namespace: "analysis", "ai", "billing", "auth"
 *   - event: "completed", "failed", "rate_limited", "cache_hit"
 *
 * Example Grafana query:
 *   sum(rate({app="cleardoc"} | json | metric="metric.analysis.completed" [5m]))
 */
export function emitMetric(
  namespace: string,
  event: string,
  context?: LogContext,
): void {
  const log = createLogger("metrics")
  log.info({ metric: `metric.${namespace}.${event}`, ...context })
}

/**
 * Log AI token usage for cost tracking. The OpenAI SDK response includes
 * `usage.prompt_tokens` and `usage.completion_tokens`. We log these plus
 * the model name so an external cost calculator can compute spend.
 *
 * Pricing (NVIDIA NIM trial endpoint, approximate — operator should verify):
 *   Nemotron 3 Nano Omni: ~$0.0001 / 1K input tokens, ~$0.0002 / 1K output tokens
 */
// ── Distributed Tracing (Sentry Transactions) ──────────────────────

/**
 * A no-op span that safely discards all tracing calls when Sentry is
 * unconfigured. Every method mirrors the Sentry Span surface so callers
 * never need to check for null/undefined.
 */
class NoOpSpan {
  private declare _op: string
  private declare _description: string

  startChild(_opts: { op: string; description?: string }): NoOpSpan {
    return new NoOpSpan()
  }

  setStatus(_status: string): NoOpSpan {
    return this
  }

  finish(): void {
    // no-op
  }
}

/**
 * A no-op transaction that safely discards all tracing calls when Sentry
 * is unconfigured. Mirrors the Sentry Transaction surface.
 */
class NoOpTransaction extends NoOpSpan {
  private declare _name: string

  constructor(_name: string, _op: string) {
    super()
  }

  override startChild(_opts: { op: string; description?: string }): NoOpSpan {
    return new NoOpSpan()
  }

  setName(_name: string): void {
    // no-op
  }
}

export type SentryTransaction = NoOpTransaction | {
  startChild(opts: { op: string; description?: string }): SentrySpan
  finish(): void
  setName(name: string): void
}

export type SentrySpan = NoOpSpan | {
  setStatus(status: string): SentrySpan
  finish(): void
}

/**
 * Start a Sentry transaction for distributed tracing. Returns a no-op
 * transaction when Sentry is not configured (missing SENTRY_DSN), so
 * callers never need to guard against null.
 *
 * Uses dynamic require (matching the pattern in captureException) so
 * that dev builds without @sentry/nextjs installed do not fail.
 *
 * @param name Transaction name, e.g. "POST /api/analyze"
 * @param op   Operation type, e.g. "http.server"
 */
export function startSentryTransaction(name: string, op: string): NoOpTransaction | SentryTransaction {
  const dsn =
    process.env.SENTRY_DSN?.trim() ??
    (typeof window !== "undefined" ? process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() : undefined)
  if (!dsn) {
    return new NoOpTransaction(name, op)
  }
  try {
    // Dynamic require so dev runs without Sentry installed do not pay the
    // import cost or fail typecheck.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require("@sentry/nextjs")
    return Sentry.startTransaction({ name, op })
  } catch {
    return new NoOpTransaction(name, op)
  }
}

export function logAiUsage(params: {
  model: string
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  durationMs: number
  reqId?: string
}): void {
  const log = createLogger("ai-cost")
  if (params.promptTokens == null || params.completionTokens == null) {
    log.warn({ model: params.model, reqId: params.reqId }, "AI usage missing token counts — cost tracking may be inaccurate")
  }
  log.info({
    metric: "metric.ai.tokens",
    model: params.model,
    promptTokens: params.promptTokens ?? 0,
    completionTokens: params.completionTokens ?? 0,
    totalTokens: params.totalTokens ?? (params.promptTokens ?? 0) + (params.completionTokens ?? 0),
    durationMs: params.durationMs,
    reqId: params.reqId,
  })
}
