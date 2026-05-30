import OpenAI from "openai"
import type { AnalysisResult, ChatMessage, LetterTone } from "./types"

const client = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: "https://integrate.api.nvidia.com/v1",
})

const MODEL = "meta/llama-3.2-90b-vision-instruct"

const CHAT_SYSTEM = `You are ClearDoc's call-prep advocate — the same fierce, practical ally who analyzed the user's document. You help them prepare for phone calls, negotiations, and follow-up actions.

You have access to the analysis JSON from their document. Use specific facts (dates, amounts, policy numbers, clause references) from that analysis. Never invent details not present in the analysis.

Rules:
- Be direct, practical, and on the user's side
- For "what should I say" questions, give a short script or bullet points they can read on the call
- Keep responses concise (under 300 words unless they ask for detail)
- This is informational prep, not legal representation — do not claim to be their lawyer
- If they ask something unrelated to the document, gently redirect to the case at hand`

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  label = "AI call",
): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000
        console.warn(`[analysis-ai] ${label} attempt ${attempt} failed, retrying in ${delay}ms...`)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }
  console.error(`[analysis-ai] ${label} failed after ${maxRetries} attempts:`, lastError)
  throw lastError instanceof Error ? lastError : new Error(`${label} failed after retries`)
}

export async function generateChatReply(
  analysis: AnalysisResult,
  history: ChatMessage[],
  userMessage: string,
): Promise<string> {
  return withRetry(async () => {
    const contextBlock = JSON.stringify(
      {
        plain_summary: analysis.plain_summary,
        overall_verdict: analysis.overall_verdict,
        red_flags: analysis.red_flags,
        next_steps: analysis.next_steps,
        response_letter: analysis.response_letter,
        deadlines: analysis.deadlines ?? [],
      },
      null,
      2,
    )

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: `${CHAT_SYSTEM}\n\nDocument analysis JSON:\n${contextBlock}` },
      ...history.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user", content: userMessage },
    ]

    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 1024,
      temperature: 0.3,
      messages,
    })

    const text = response.choices[0]?.message?.content ?? ""
    return text.trim() || "I couldn't generate a response. Please try rephrasing your question."
  }, 3, "chat reply")
}

const TONE_PROMPTS: Record<LetterTone, string> = {
  firm: "professional, assertive, and firm — the default advocate tone. Stand your ground without being rude.",
  cooperative:
    "cooperative and good-faith — assume the institution may resolve this amicably while still protecting the user's rights.",
  hardship:
    "emphasizing hardship — highlight financial, medical, or emergency circumstances respectfully while preserving all factual claims.",
  assertive:
    "more assertive and direct — stronger language demanding compliance, while remaining professional and factual.",
}

export async function rephraseResponseLetter(
  letter: string,
  tone: LetterTone,
): Promise<string> {
  return withRetry(async () => {
    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 2000,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: `You rewrite formal response letters for consumers disputing institutions. Preserve ALL facts, dates, dollar amounts, policy numbers, names, and legal references exactly. Do not invent new facts or citations. Only change tone and phrasing. Return ONLY the rewritten letter text — no preamble or markdown.`,
        },
        {
          role: "user",
          content: `Rewrite this letter to sound ${TONE_PROMPTS[tone]}\n\n--- LETTER ---\n${letter}`,
        },
      ],
    })

    const text = response.choices[0]?.message?.content ?? ""
    return text.trim() || letter
  }, 3, "letter rephrase")
}

export const LETTER_TONE_OPTIONS: { id: LetterTone; label: string; hint: string }[] = [
  { id: "firm", label: "Firm", hint: "Default advocate tone" },
  { id: "cooperative", label: "Cooperative", hint: "Good-faith resolution" },
  { id: "hardship", label: "Hardship", hint: "Emphasize circumstances" },
  { id: "assertive", label: "Assertive", hint: "Stronger demands" },
]

export const CHAT_MESSAGE_LIMITS = {
  free: 10,
  pro: 50,
} as const
