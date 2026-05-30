import OpenAI from "openai"

/**
 * NVIDIA NIM model for document analysis, chat, and letter rephrase.
 *
 * Nemotron 3 Nano Omni: multimodal (text + images), MoE (30B / 3B active),
 * tuned for document intelligence — faster than the shared 90B vision pool.
 */
export const AI_MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"

/** Disable chain-of-thought for structured JSON — faster responses, cleaner output. */
export const AI_COMPLETION_EXTRA = {
  chat_template_kwargs: { enable_thinking: false },
} as const

/** OpenAI SDK types omit NVIDIA NIM `extra_body`; pass via widened params. */
export function nimCompletionParams(
  params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
): OpenAI.Chat.ChatCompletionCreateParamsNonStreaming & {
  extra_body: typeof AI_COMPLETION_EXTRA
} {
  return { ...params, extra_body: AI_COMPLETION_EXTRA }
}
