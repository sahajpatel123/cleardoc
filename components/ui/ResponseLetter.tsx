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
    <div className="space-y-3">
      {/* Actions */}
      <div className="flex items-center gap-2 justify-end">
        <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
          onClick={handleDownload}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all"
          style={{ color: "#6B5E52", borderColor: "#E8E2D9", background: "white" }}>
          <Download className="w-3.5 h-3.5" />
          Download .txt
        </motion.button>

        <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs font-bold px-4 py-1.5 rounded-lg transition-all"
          style={copied
            ? { background: "#ECFDF5", color: "#059669", border: "1px solid rgba(5,150,105,0.2)" }
            : { background: "#E8651A", color: "white", boxShadow: "0 2px 8px rgba(232,101,26,0.3)" }
          }>
          <AnimatePresence mode="wait">
            {copied
              ? <motion.span key="check" initial={{ scale: 0.8 }} animate={{ scale: 1 }} className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" /> Copied!
                </motion.span>
              : <motion.span key="copy" initial={{ scale: 0.8 }} animate={{ scale: 1 }} className="flex items-center gap-1.5">
                  <Copy className="w-3.5 h-3.5" /> Copy Letter
                </motion.span>
            }
          </AnimatePresence>
        </motion.button>
      </div>

      {/* Letter display */}
      <div className="relative rounded-2xl border overflow-hidden"
        style={{ background: "#FAFAF8", borderColor: "#E8E2D9" }}>
        <div className="absolute top-0 left-0 right-0 h-0.5"
          style={{ background: "linear-gradient(90deg, transparent, rgba(232,101,26,0.3), transparent)" }} />
        <div className="font-mono text-sm leading-relaxed p-6 whitespace-pre-wrap overflow-x-auto max-h-96 overflow-y-auto"
          style={{ color: "#2E261E" }}>
          {lines.map((line, i) => (
            <span key={i}>
              {line.startsWith("[") && line.endsWith("]")
                ? <span style={{ color: "#E8651A" }} className="italic">{line}</span>
                : line}
              {"\n"}
            </span>
          ))}
        </div>
      </div>

      <p className="text-xs text-center" style={{ color: "#A89484" }}>
        Fill in the{" "}
        <span style={{ color: "#E8651A" }} className="font-semibold">[bracketed placeholders]</span>{" "}
        before sending.
      </p>
    </div>
  )
}
