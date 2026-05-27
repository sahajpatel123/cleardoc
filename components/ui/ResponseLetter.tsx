"use client"

import { useEffect, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Copy, Check, Download, Loader2 } from "lucide-react"
import { LETTER_TONE_OPTIONS } from "@/lib/analysis-ai"
import type { LetterTone } from "@/lib/types"

interface Props {
  letter: string
  tone?: LetterTone
  analysisId?: string
  onLetterChange?: (letter: string, tone: LetterTone) => void
}

export default function ResponseLetter({ letter, tone, analysisId, onLetterChange }: Props) {
  const [currentLetter, setCurrentLetter] = useState(letter)
  const [currentTone, setCurrentTone] = useState<LetterTone>(tone ?? "firm")
  const [copied, setCopied] = useState(false)
  const [rephrasing, setRephrasing] = useState(false)
  const [rephraseError, setRephraseError] = useState<string | null>(null)

  useEffect(() => {
    setCurrentLetter(letter)
    setCurrentTone(tone ?? "firm")
  }, [letter, tone])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(currentLetter)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownload = () => {
    const blob = new Blob([currentLetter], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "response-letter.txt"
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleTone = async (nextTone: LetterTone) => {
    if (nextTone === currentTone || rephrasing) return
    if (!analysisId) {
      setCurrentTone(nextTone)
      return
    }

    setRephraseError(null)
    setRephrasing(true)
    try {
      const res = await fetch("/api/rephrase-letter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysisId, tone: nextTone }),
      })
      const data = (await res.json()) as { error?: string; letter?: string; tone?: LetterTone }
      if (!res.ok || !data.letter) {
        setRephraseError(data.error ?? "Could not rewrite letter.")
        return
      }
      setCurrentLetter(data.letter)
      setCurrentTone(data.tone ?? nextTone)
      onLetterChange?.(data.letter, data.tone ?? nextTone)
    } catch {
      setRephraseError("Network error. Try again.")
    } finally {
      setRephrasing(false)
    }
  }

  const lines = currentLetter.split("\n")

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <p className="mono text-[10px] uppercase tracking-[0.22em]" style={{ color: "var(--text-mute)" }}>
          Tone
        </p>
        <div className="flex flex-wrap gap-2">
          {LETTER_TONE_OPTIONS.map((opt) => {
            const active = currentTone === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => void handleTone(opt.id)}
                disabled={rephrasing}
                className="rounded-full px-4 py-2 text-left transition-colors border disabled:opacity-50"
                style={
                  active
                    ? {
                        background: "rgba(255,106,31,0.15)",
                        borderColor: "rgba(255,106,31,0.4)",
                        color: "var(--text)",
                      }
                    : {
                        background: "transparent",
                        borderColor: "var(--hairline-2)",
                        color: "var(--text-3)",
                      }
                }
              >
                <span
                  className="block text-[13px]"
                  style={{ fontFamily: "var(--font-syne,'Syne',sans-serif)", fontWeight: 500 }}
                >
                  {opt.label}
                </span>
                <span className="block text-[10px] mt-0.5" style={{ color: "var(--text-mute)" }}>
                  {opt.hint}
                </span>
              </button>
            )
          })}
        </div>
        {rephraseError && (
          <p className="text-xs" style={{ color: "var(--red)" }}>
            {rephraseError}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="mono text-[10px] uppercase tracking-[0.22em]" style={{ color: "var(--text-mute)" }}>
          Counter-letter · ready to send
        </p>
        <div className="flex items-center gap-2">
          <button onClick={handleDownload} className="btn btn-ghost !py-1.5 !px-3 !text-[12px]">
            <Download className="w-3.5 h-3.5" />
            .txt
          </button>
          <button
            onClick={() => void handleCopy()}
            className={copied ? "btn btn-ghost !py-1.5 !px-3 !text-[12px]" : "btn btn-primary !py-1.5 !px-3 !text-[12px]"}
            style={copied ? { color: "var(--moss)", borderColor: "rgba(107,175,138,0.3)" } : {}}
          >
            <AnimatePresence mode="wait">
              {copied ? (
                <motion.span key="check" initial={{ scale: 0.7 }} animate={{ scale: 1 }} className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" /> Copied
                </motion.span>
              ) : (
                <motion.span key="copy" initial={{ scale: 0.7 }} animate={{ scale: 1 }} className="flex items-center gap-1.5">
                  <Copy className="w-3.5 h-3.5" /> Copy letter
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        </div>
      </div>

      <div
        className="paper rounded-lg overflow-hidden relative"
        style={{ boxShadow: "0 30px 80px rgba(0,0,0,0.5)" }}
      >
        {rephrasing && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center gap-2 backdrop-blur-sm"
            style={{ background: "rgba(250,247,242,0.75)" }}
          >
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--ember)" }} />
            <span className="text-sm" style={{ color: "var(--ink)" }}>
              Rewriting letter…
            </span>
          </div>
        )}
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 h-px w-2/3"
          style={{ background: "linear-gradient(90deg, transparent, rgba(0,0,0,0.15), transparent)" }}
        />
        <div
          className="p-6 sm:p-10 whitespace-pre-wrap overflow-x-auto max-h-[28rem] overflow-y-auto leading-relaxed"
          style={{
            color: "var(--ink)",
            fontFamily: "ui-serif, Georgia, serif",
            fontSize: 15,
          }}
        >
          {lines.map((line, i) => (
            <span key={i}>
              {line.startsWith("[") && line.endsWith("]") ? (
                <span style={{ color: "var(--ember-deep)" }} className="italic font-semibold">
                  {line}
                </span>
              ) : (
                line
              )}
              {"\n"}
            </span>
          ))}
        </div>
      </div>

      <p className="text-xs" style={{ color: "var(--text-3)" }}>
        Fill in the{" "}
        <span style={{ color: "var(--ember)" }} className="font-semibold">
          [bracketed placeholders]
        </span>{" "}
        before sending.
      </p>
    </div>
  )
}
