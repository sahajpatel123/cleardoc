import OpenAI from "openai"
import { AI_TIMEOUT_MS } from "./ai-model"
import { withCircuit, CircuitOpenError } from "./circuit-breaker"

/**
 * Shared NVIDIA NIM OpenAI-compatible client.
 *
 * A single singleton is used by both lib/ai.ts (document analysis) and
 * lib/analysis-ai.ts (chat + letter rephrase). The per-call timeout is
 * controlled by the withTimeout wrapper in lib/ai-model.ts rather than the
 * SDK-level timeout so that callers with different SLAs can pass different
 * deadlines without needing separate client instances.
 *
 * maxRetries is 0 because both call sites implement their own retry loops —
 * the SDK's built-in retries would otherwise multiply latency and orphan
 * in-flight HTTP requests after a withTimeout fires.
 */
let _client: OpenAI | null = null

/** Lightweight async semaphore to cap concurrent NVIDIA connections.
 *  Prevents stampede when many serverless instances are warm — each instance
 *  caps its own concurrency; cross-instance coordination is via rate limits.
 */
class Semaphore {
  private permits: number
  private queue: Array<() => void> = []

  constructor(permits: number) {
    this.permits = permits
  }

  async acquire(signal?: AbortSignal, timeoutMs = 10_000): Promise<void> {
    if (this.permits > 0) {
      this.permits--
      return
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(new Error("Request aborted while waiting for AI slot"))
      if (signal?.aborted) {
        onAbort()
        return
      }
      signal?.addEventListener("abort", onAbort, { once: true })

      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort)
        reject(new Error(`AI semaphore acquisition timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      this.queue.push(() => {
        clearTimeout(timer)
        signal?.removeEventListener("abort", onAbort)
        resolve()
      })
    })
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()
      next?.()
    } else {
      this.permits++
    }
  }
}

const _semaphore = new Semaphore(5)

export async function withAiClient<T>(
  fn: (client: OpenAI) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  await _semaphore.acquire(signal)
  try {
    return await withCircuit("ai", () => fn(getAiClient()), {
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
      halfOpenMaxCalls: 1,
    })
  } catch (err) {
    if (err instanceof CircuitOpenError) {
      throw new Error("AI service is temporarily unavailable. Please try again shortly.")
    }
    throw err
  } finally {
    _semaphore.release()
  }
}

export function getAiClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      apiKey: process.env.NVIDIA_API_KEY,
      baseURL: process.env.NVIDIA_API_BASE_URL?.trim() ?? "https://integrate.api.nvidia.com/v1",
      timeout: AI_TIMEOUT_MS,
      maxRetries: 0,
    })
  }
  return _client
}

/**
 * Test-only: replace the cached singleton with a fake client. Returns a
 * restore function the caller must invoke to put the real client back.
 * Production code never calls this — the test file in `ai.test.ts` is
 * the only caller.
 *
 * Important: the test must invoke this on the SAME module instance that
 * `lib/ai.ts` imports. The simplest way to guarantee that is to grab the
 * module instance from `Module._cache` after `import`/`require` of
 * `lib/ai.ts` has run, then call this on the same instance.
 */
export function _setAiClientForTesting(fake: OpenAI | null): () => void {
  const previous = _client
  _client = fake
  return () => {
    _client = previous
  }
}
