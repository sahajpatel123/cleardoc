"use client"

import { useEffect, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import type { LoadingStage } from "@/lib/types"

const STAGES: { stage: LoadingStage; n: string; label: string; sub: string; log: string }[] = [
  { stage: "uploading", n: "01", label: "Securing your document",  sub: "Encrypting and uploading", log: "vault.encrypt → ./document.pdf" },
  { stage: "reading",   n: "02", label: "Reading every line",      sub: "Extracting text and layout", log: "parser.read · 412 tokens · 1 page" },
  { stage: "analyzing", n: "03", label: "Hunting red flags",       sub: "Matching against 18,000 patterns", log: "claude.analyze · jurisdiction=detected" },
  { stage: "preparing", n: "04", label: "Drafting your counter",   sub: "Letter, ranked steps, citations", log: "scribe.draft · response_letter.txt" },
]

export default function LoadingAnalysis({ stage }: { stage: LoadingStage }) {
  const [now, setNow] = useState(0)
  const [logs, setLogs] = useState<string[]>([])
  const currentIdx = Math.max(0, STAGES.findIndex((s) => s.stage === stage))
  const current = STAGES[currentIdx] ?? STAGES[0]

  useEffect(() => {
    const t = setInterval(() => setNow((n) => n + 1), 700)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    setLogs((l) => {
      const next = STAGES[currentIdx]
      if (!next) return l
      if (l[l.length - 1] === next.log) return l
      return [...l, next.log].slice(-4)
    })
  }, [currentIdx])

  return (
    <div className="min-h-screen relative overflow-hidden flex items-center px-4">
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(245,242,235,0.025) 1px, transparent 1px), linear-gradient(to bottom, rgba(245,242,235,0.025) 1px, transparent 1px)",
            backgroundSize: "80px 80px",
            maskImage:
              "radial-gradient(ellipse 80% 70% at 50% 50%, black 30%, transparent 100%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 80% 70% at 50% 50%, black 30%, transparent 100%)",
          }}
        />
      </div>

      <div className="container-edition relative">
        {/* Top meta */}
        <div className="flex items-baseline justify-between mb-16 sm:mb-24">
          <p className="eyebrow">Atelier · in session</p>
          <div className="flex items-center gap-3 mono text-[10px]" style={{ color: "var(--text-mute)" }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--ember)" }} />
            WORKING · {Math.min(30, now)}s elapsed
          </div>
        </div>

        {/* Headline */}
        <div className="mb-16 sm:mb-24">
          <AnimatePresence mode="wait">
            <motion.h1
              key={stage}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -18 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="display max-w-[20ch]"
              style={{
                fontSize: "clamp(2.2rem, 6vw, 5.5rem)",
                color: "var(--text)",
              }}
            >
              {current.label}
              <span className="animate-blink ml-2 inline-block" style={{ color: "var(--ember)" }}>—</span>
            </motion.h1>
          </AnimatePresence>
          <AnimatePresence mode="wait">
            <motion.p
              key={stage + "-sub"}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="mt-6 text-base"
              style={{ color: "var(--text-3)" }}
            >
              {current.sub}
            </motion.p>
          </AnimatePresence>
        </div>

        {/* Stage rail */}
        <div className="grid grid-cols-4 gap-0 border-t" style={{ borderColor: "var(--hairline-2)" }}>
          {STAGES.map((s, i) => {
            const done = i < currentIdx
            const active = i === currentIdx
            return (
              <div
                key={s.stage}
                className="py-6 px-4 border-r relative"
                style={{ borderColor: i < 3 ? "var(--hairline-2)" : "transparent" }}
              >
                {/* fill bar at top */}
                <motion.div
                  className="absolute top-0 left-0 h-px origin-left"
                  style={{ background: "var(--ember)", width: "100%" }}
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: done ? 1 : active ? 0.5 : 0 }}
                  transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                />
                <p
                  className="mono text-[11px] tracking-[0.2em]"
                  style={{
                    color: done || active ? "var(--text-2)" : "var(--text-mute)",
                  }}
                >
                  {s.n}
                </p>
                <p
                  className="mt-3 text-sm"
                  style={{
                    color: done ? "var(--text-2)" : active ? "var(--text)" : "var(--text-mute)",
                    fontFamily: "var(--font-syne,'Syne',sans-serif)",
                    fontWeight: 500,
                    letterSpacing: "-0.02em",
                  }}
                >
                  {s.label.split(" ").slice(0, 2).join(" ")}
                </p>
              </div>
            )
          })}
        </div>

        {/* Console */}
        <div
          className="mt-16 max-w-2xl"
          style={{
            borderLeft: "1px solid var(--hairline-2)",
            paddingLeft: 24,
          }}
        >
          <p className="eyebrow mb-4">Console</p>
          <div className="space-y-1 font-mono text-[12px] min-h-[120px]">
            <AnimatePresence initial={false}>
              {logs.map((l, i) => (
                <motion.div
                  key={l + i}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: i === logs.length - 1 ? 1 : 0.4, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  style={{ color: i === logs.length - 1 ? "var(--ember)" : "var(--text-mute)" }}
                >
                  <span style={{ color: "var(--text-mute)" }} className="mr-2">$</span>
                  {l}
                  {i === logs.length - 1 && (
                    <span className="inline-block w-2 h-[10px] ml-1 align-middle animate-blink" style={{ background: "var(--ember)" }} />
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          <p className="mt-8 text-xs italic" style={{ color: "var(--text-mute)" }}>
            {now > 8
              ? "Almost there — double-checking the citations."
              : "Our AI is matching this against thousands of known templates."}
          </p>
        </div>
      </div>
    </div>
  )
}
