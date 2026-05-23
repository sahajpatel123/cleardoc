"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Copy, Check, Download } from "lucide-react"

interface Props { letter: string }

export default function ResponseLetter({ letter }: Props) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(letter)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownload = () => {
    const blob = new Blob([letter], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "response-letter.txt"
    a.click()
    URL.revokeObjectURL(url)
  }

  const lines = letter.split("\n")

  return (
    <div className="space-y-5">
      {/* Actions */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p
          className="mono text-[10px] uppercase tracking-[0.22em]"
          style={{ color: "var(--text-mute)" }}
        >
          Counter-letter · ready to send
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDownload}
            className="btn btn-ghost !py-1.5 !px-3 !text-[12px]"
          >
            <Download className="w-3.5 h-3.5" />
            .txt
          </button>
          <button
            onClick={handleCopy}
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

      {/* The letter itself — on paper */}
      <div
        className="paper rounded-lg overflow-hidden relative"
        style={{ boxShadow: "0 30px 80px rgba(0,0,0,0.5)" }}
      >
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
