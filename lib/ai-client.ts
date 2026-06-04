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

import { Semaphore } from "./semaphore"
const _semaphore = new Semaphore(5)

export async function withAiClient<T>(
  fn: (client: OpenAI) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  // If the signal is already aborted before we even try to acquire, reject
  // immediately. Without this guard, acquire() rejects at line 30-32 without
  // consuming a permit, but the finally block below would still call release(),
  // incrementing the permit count past the max (permit inflation).
  if (signal?.aborted) {
    throw new Error("Request aborted while waiting for AI slot")
  }

  let acquired = false
  try {
    await _semaphore.acquire(signal)
    acquired = true
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
    // Only release if we actually acquired a permit. A pre-aborted signal
    // (checked above) or a timeout/abort during acquire means no permit was
    // consumed — releasing here would inflate the count past max.
    if (acquired) {
      _semaphore.release()
    }
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

export const __forTesting = process.env.NODE_ENV !== "production" ? {
  setAiClientForTesting(fake: OpenAI | null): () => void {
    const previous = _client
    _client = fake
    return () => { _client = previous }
  }
} : undefined
