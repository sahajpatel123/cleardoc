import { captureException, createLogger } from "./observability"

const log = createLogger("ai-retry")

/** Default retry predicate: do NOT retry 4xx client errors, auth failures, or
 *  circuit-breaker rejections. Circuit-open means the service is known down —
 *  retrying wastes 2-3 attempts with exponential backoff while achieving nothing.
 */
function defaultShouldRetry(err: unknown): boolean {
  if (err && typeof err === "object") {
    const e = err as { status?: number; code?: string; message?: string }
    if (typeof e.status === "number" && e.status >= 400 && e.status < 500) return false
    if (e.code === "authentication_error" || e.code === "invalid_api_key") return false
    if (e.message?.includes("401") || e.message?.includes("403") || e.message?.includes("429")) {
      return false
    }
    // Circuit breaker is OPEN — fail fast, do not burn retries.
    if (e.message?.includes("Circuit breaker OPEN")) return false
  }
  // CircuitOpenError is a class import — check by name for cases where the
  // error is serialized or wrapped. The class check covers the direct throw.
  if (err instanceof Error && err.constructor.name === "CircuitOpenError") return false
  return true
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  label: string,
  signal?: AbortSignal,
  reqId?: string,
  shouldRetry?: (err: unknown) => boolean,
  component?: string,
  deadlineMs?: number,
): Promise<T> {
  const loopStart = Date.now()
  let lastError: unknown
  const retryPredicate = shouldRetry ?? defaultShouldRetry
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) {
      throw new Error("Request aborted")
    }
    if (deadlineMs && Date.now() - loopStart >= deadlineMs) {
      throw new Error("Analysis deadline exceeded")
    }
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (!retryPredicate(err)) {
        break
      }
      if (attempt < maxRetries) {
        const baseDelay = Math.min(Math.pow(2, attempt) * 1000, 30000) // cap at 30 s
        const delay = Math.random() * baseDelay
        log.warn(
          { label, attempt, delayMs: Math.round(delay), reqId },
          "ai call failed, retrying",
        )
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }
  captureException(lastError, {
    component: component ?? "ai-retry",
    reqId,
    extra: { label, attempts: maxRetries },
  })
  throw lastError instanceof Error ? lastError : new Error(`${label} failed after retries`)
}
