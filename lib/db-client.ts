import type { ChatMessage } from "./types"

/** Client-safe chat message parser (mirrors server parseChatMessages). */
export function parseChatMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return []
  const out: ChatMessage[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const m = item as Record<string, unknown>
    if (
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string" &&
      typeof m.createdAt === "string"
    ) {
      out.push({ role: m.role, content: m.content, createdAt: m.createdAt })
    }
  }
  return out
}
