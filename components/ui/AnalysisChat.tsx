"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { MessageCircle, Send, Loader2, ArrowUpRight } from "lucide-react"
import type { ChatMessage } from "@/lib/types"

interface Props {
  analysisId: string
  initialMessages?: ChatMessage[]
}

export default function AnalysisChat({ analysisId, initialMessages = [] }: Props) {
  const router = useRouter()
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showUpgrade, setShowUpgrade] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, loading])

  const send = async () => {
    const trimmed = input.trim()
    if (!trimmed || loading) return

    setError(null)
    setShowUpgrade(false)
    setLoading(true)
    setInput("")

    const optimistic: ChatMessage = {
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimistic])

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysisId, message: trimmed }),
      })
      const data = (await res.json()) as {
        error?: string
        code?: string
        messages?: ChatMessage[]
        reply?: string
      }

      if (!res.ok) {
        setMessages((prev) => prev.filter((m) => m !== optimistic))
        setInput(trimmed)
        setError(data.error ?? "Could not send message.")
        if (data.code === "CHAT_LIMIT_REACHED") setShowUpgrade(true)
        return
      }

      if (data.messages) {
        setMessages(data.messages)
      } else if (data.reply) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.reply!, createdAt: new Date().toISOString() },
        ])
      }
    } catch {
      setMessages((prev) => prev.filter((m) => m !== optimistic))
      setInput(trimmed)
      setError("Network error. Try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div
        className="rounded-lg border overflow-hidden"
        style={{ borderColor: "var(--hairline-2)", background: "rgba(255,255,255,0.02)" }}
      >
        <div
          className="px-4 py-3 border-b flex items-center gap-2"
          style={{ borderColor: "var(--hairline-2)" }}
        >
          <MessageCircle className="w-4 h-4" style={{ color: "var(--ember)" }} />
          <p
            className="text-sm"
            style={{
              color: "var(--text-2)",
              fontFamily: "var(--font-syne,'Syne',sans-serif)",
              fontWeight: 500,
            }}
          >
            Questions about this document? Let&apos;s prep for your call.
          </p>
        </div>

        <div className="max-h-80 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && !loading && (
            <p className="text-sm italic" style={{ color: "var(--text-mute)" }}>
              Try: &ldquo;I&apos;m calling the billing department now — what should I say when they pick up?&rdquo;
            </p>
          )}
          {messages.map((m, i) => (
            <div
              key={`${m.createdAt}-${i}`}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className="max-w-[85%] rounded-lg px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap"
                style={
                  m.role === "user"
                    ? { background: "rgba(255,106,31,0.15)", color: "var(--text)" }
                    : { background: "rgba(255,255,255,0.05)", color: "var(--text-2)" }
                }
              >
                {m.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-mute)" }}>
              <Loader2 className="w-4 h-4 animate-spin" />
              Preparing your answer…
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="p-4 border-t space-y-2" style={{ borderColor: "var(--hairline-2)" }}>
          {error && (
            <div className="space-y-2">
              <p className="text-xs" style={{ color: "var(--red)" }}>
                {error}
              </p>
              {showUpgrade && (
                <button
                  type="button"
                  onClick={() => router.push("/pricing")}
                  className="inline-flex items-center gap-1.5 text-xs font-medium"
                  style={{ color: "var(--ember)" }}
                >
                  Upgrade to Pro for unlimited messages
                  <ArrowUpRight className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  void send()
                }
              }}
              placeholder="Ask about your next call or step…"
              className="field flex-1"
              disabled={loading}
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={loading || !input.trim()}
              className="btn btn-primary !px-4 shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <p className="text-[11px] italic" style={{ color: "var(--text-mute)" }}>
            Prep help only — not legal advice or representation.
          </p>
        </div>
      </div>
    </div>
  )
}
