"use client"

import { useState } from "react"
import { Copy, Check, Download } from "lucide-react"

interface Props {
  letter: string
}

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

  // Format the letter with proper line breaks
  const formattedLines = letter.split("\n")

  return (
    <div className="space-y-3">
      {/* Action buttons */}
      <div className="flex items-center gap-2 justify-end">
        <button
          onClick={handleDownload}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white border border-white/10 hover:border-white/20 px-3 py-1.5 rounded-lg transition-all"
        >
          <Download className="w-3.5 h-3.5" />
          Download .txt
        </button>
        <button
          onClick={handleCopy}
          className={`flex items-center gap-1.5 text-xs font-semibold px-4 py-1.5 rounded-lg transition-all ${
            copied
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
              : "bg-amber-400 text-black hover:bg-amber-300"
          }`}
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              Copy Letter
            </>
          )}
        </button>
      </div>

      {/* Letter display */}
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-b from-amber-400/3 to-transparent rounded-xl pointer-events-none" />
        <div className="font-mono text-sm leading-relaxed bg-[#0A0A0F] border border-white/10 rounded-xl p-6 text-slate-300 whitespace-pre-wrap overflow-x-auto">
          {formattedLines.map((line, i) => (
            <span key={i}>
              {line.startsWith("[") && line.endsWith("]") ? (
                <span className="text-amber-400/70 italic">{line}</span>
              ) : (
                line
              )}
              {"\n"}
            </span>
          ))}
        </div>
      </div>

      <p className="text-xs text-slate-600 text-center">
        Customize the{" "}
        <span className="text-amber-400/70">[bracketed placeholders]</span>{" "}
        with your information before sending.
      </p>
    </div>
  )
}
