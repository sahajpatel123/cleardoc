import OpenAI from "openai"

/**
 * NVIDIA NIM model for document analysis, chat, and letter rephrase.
 *
 * Nemotron 3 Nano Omni: multimodal (text + images), MoE (30B / 3B active),
 * tuned for document intelligence — faster than the shared 90B vision pool.
 */
export const AI_MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"

/** Timeout in milliseconds for AI API calls (default 60s). */
export const AI_TIMEOUT_MS = 60000

/** Disable chain-of-thought for structured JSON — faster responses, cleaner output. */
export const AI_COMPLETION_EXTRA = {
  chat_template_kwargs: { enable_thinking: false },
} as const

/** Wrapper for AI calls with timeout protection. */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timeoutId!)
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
