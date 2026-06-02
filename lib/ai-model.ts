import OpenAI from "openai"

/**
 * NVIDIA NIM model for document analysis, chat, and letter rephrase.
 *
 * Nemotron 3 Nano Omni: multimodal (text + images), MoE (30B / 3B active),
 * tuned for document intelligence — faster than the shared 90B vision pool.
 */
export const AI_MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"

/**
 * Comma-separated list of model ids used as fallbacks when the primary
 * vision model returns 200 + empty content. The first model in the list
 * that returns a non-empty response wins. Default is an empty list —
 * the operator must opt in by setting AI_VISION_FALLBACK_MODELS so the
 * behavior is reversible without code changes.
 *
 * Text-mode analysis is never affected; the fallback chain only fires
 * for the vision path of `analyzeDocument`. Models are tried in order.
 * The OpenAI SDK `client` is the same one used by the primary call,
 * so all fallbacks hit the same NVIDIA_API_BASE_URL.
 */
export const AI_VISION_FALLBACK_MODELS: string[] = (() => {
  const raw = process.env.AI_VISION_FALLBACK_MODELS?.trim()
  if (!raw) return []
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
})()

/** Timeout in milliseconds for AI API calls (default 50s for analyze route). */
export const AI_TIMEOUT_MS = 50000

/** Shorter timeout for chat/rephrase routes where Vercel maxDuration is 30s. */
export const AI_TIMEOUT_MS_SHORT = 25000

/** Disable chain-of-thought for structured JSON — faster responses, cleaner output. */
export const AI_COMPLETION_EXTRA = {
  chat_template_kwargs: { enable_thinking: false },
} as const

/**
 * Wrapper for AI calls with timeout protection that ACTUALLY aborts the
 * underlying request. Accepts a factory so the timeout signal can be passed
 * into the OpenAI SDK — without this, the SDK keeps the HTTPS socket open
 * after the local Promise.race rejects, leaking connections.
 *
 * The factory receives a composed AbortSignal that fires when EITHER:
 *   (a) the caller's signal aborts, or
 *   (b) the timeout fires.
 *
 * Cancellation propagates to the actual resource holding the work.
 */
export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string,
  callerSignal?: AbortSignal,
): Promise<T> {
  if (callerSignal?.aborted) {
    throw new Error("Request aborted")
  }

  const timeoutController = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout>

  // Compose caller signal + timeout signal. When either fires, the composed
  // signal aborts, and the SDK cancels the in-flight HTTP request.
  let composedSignal: AbortSignal = timeoutController.signal
  let composedCleanup: (() => void) | undefined
  if (callerSignal) {
    const onCallerAbort = () => timeoutController.abort()
    callerSignal.addEventListener("abort", onCallerAbort)
    composedCleanup = () => callerSignal.removeEventListener("abort", onCallerAbort)
    // If the caller already aborted before we added the listener, abort now.
    if (callerSignal.aborted) {
      timeoutController.abort()
    }
  }

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timeoutController.abort()
      reject(new Error(`${label} timed out after ${ms}ms`))
    }, ms)
  })

  try {
    return await Promise.race([fn(composedSignal), timeout])
  } finally {
    clearTimeout(timeoutId!)
    timeoutController.abort() // belt-and-braces
    composedCleanup?.()
  }
}

/** OpenAI SDK types omit NVIDIA NIM `extra_body`; pass via widened params. */
export function nimCompletionParams(
  params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
): OpenAI.Chat.ChatCompletionCreateParamsNonStreaming & {
  extra_body: typeof AI_COMPLETION_EXTRA
} {
  return { ...params, extra_body: AI_COMPLETION_EXTRA }
}
