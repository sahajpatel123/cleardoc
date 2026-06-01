"use client"

import { useEffect, useMemo, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import type { LoadingStage } from "@/lib/types"
import { Grid, Vignette } from "@/components/ui/Atmosphere"

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number]

const STAGES: {
  stage: LoadingStage
  n: string
  label: string
  sub: string
  log: string
}[] = [
  {
    stage: "uploading",
    n: "01",
    label: "Securing your document",
    sub: "Encrypted in transit — your file never stays on our servers",
    log: "vault.seal → document inbound",
  },
  {
    stage: "reading",
    n: "02",
    label: "Reading every line",
    sub: "Extracting text, dates, amounts, and signatures",
    log: "parser.extract · layout + OCR pass",
  },
  {
    stage: "analyzing",
    n: "03",
    label: "Hunting red flags",
    sub: "Cross-referencing statutes, templates, and known bluffs",
    log: "nim.analyze · nemotron-omni · reasoning",
  },
  {
    stage: "preparing",
    n: "04",
    label: "Drafting your counter",
    sub: "Letter, ranked steps, verdict — ready to send",
    log: "scribe.compile · response_letter + next_steps",
  },
]

const ANALYZING_BEATS = [
  "Parsing clauses and fine print…",
  "Matching against known manipulation tactics…",
  "Checking deadlines and appeal windows…",
  "Tracing dollar amounts and policy numbers…",
  "Ranking red flags by severity…",
  "Drafting your counter-letter…",
  "Building your ranked next steps…",
  "Double-checking citations before we show you…",
]

const WHILE_YOU_WAIT = [
  "Institutions count on you not reading the fine print. We read all of it.",
  "Most people miss the appeal window buried on page two — we surface it.",
  "A firm counter-letter often works before you ever need a lawyer.",
  "Your document stays private. Only the analysis is saved to your account.",
  "Red flags are quoted verbatim — so you can point to the exact sentence.",
]

function stageBaseProgress(stage: LoadingStage): number {
  switch (stage) {
    case "uploading":
      return 8
    case "reading":
      return 22
    case "analyzing":
      return 42
    case "preparing":
      return 88
    default:
      return 0
  }
}

export default function AnalysisSessionLoading({
  stage,
  fileName,
}: {
  stage: LoadingStage
  fileName?: string
}) {
  const [elapsed, setElapsed] = useState(0)
  const [beatIdx, setBeatIdx] = useState(0)
  const [tipIdx, setTipIdx] = useState(0)
  const [logs, setLogs] = useState<string[]>([])

  const currentIdx = Math.max(0, STAGES.findIndex((s) => s.stage === stage))
  const current = STAGES[currentIdx] ?? STAGES[0]

  const progress = useMemo(() => {
    const base = stageBaseProgress(stage)
    if (stage === "analyzing") {
      const creep = Math.min(46, elapsed * 0.55)
      return Math.min(86, base + creep)
    }
    if (stage === "preparing") {
      return Math.min(98, base + elapsed * 2)
    }
    return base
  }, [stage, elapsed])

  useEffect(() => {
    const t = setInterval(() => setElapsed((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (stage !== "analyzing") return
    const t = setInterval(() => setBeatIdx((i) => (i + 1) % ANALYZING_BEATS.length), 4200)
    return () => clearInterval(t)
  }, [stage])

  useEffect(() => {
    const t = setInterval(() => setTipIdx((i) => (i + 1) % WHILE_YOU_WAIT.length), 7000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    // Cap visible log lines to the last 5 for the live ticker. The setState is
    // intentionally inside an effect because the rotation is driven by an
    // external `current.log` prop change (not a user event) and the
    // prev-state guard makes this idempotent — no cascading re-renders.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLogs((prev) => {
      if (prev[prev.length - 1] === current.log) return prev
      return [...prev, current.log].slice(-5)
    })
  }, [current.log])

  const patienceLine =
    elapsed > 90
      ? "Deep documents take longer — we're still working. Worth the wait."
      : elapsed > 45
        ? "Almost there — polishing your response letter and next steps."
        : elapsed > 20
          ? "Good documents take a moment. We're matching against thousands of templates."
          : "Stay on this page — your analysis will appear here automatically."

  const displaySub =
    stage === "analyzing" ? ANALYZING_BEATS[beatIdx] : current.sub

  return (
    <div className="min-h-screen relative overflow-hidden flex flex-col pt-24 pb-16">
      <div className="absolute inset-0 pointer-events-none">
        <Grid opacity={0.04} />
        <Vignette />
        <motion.div
          className="absolute inset-x-0 top-0 h-px origin-left"
          style={{ background: "var(--ember)" }}
          animate={{ scaleX: progress / 100 }}
          initial={{ scaleX: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
        />
      </div>

      <div className="container-edition relative flex-1 flex flex-col">
        <div className="flex items-baseline justify-between gap-4 mb-10 sm:mb-14">
          <p className="eyebrow">Atelier · in session</p>
          <div className="flex items-center gap-3 mono text-[10px]" style={{ color: "var(--text-mute)" }}>
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse shrink-0"
              style={{ background: "var(--ember)" }}
            />
            WORKING · {elapsed}s
          </div>
        </div>

        {/* Document card + scan */}
        <div className="mb-12 sm:mb-16 max-w-xl mx-auto w-full">
          <div
            className="relative overflow-hidden border px-6 py-8 sm:px-8 sm:py-10"
            style={{ borderColor: "var(--hairline-2)", background: "var(--ink-1)" }}
          >
            <motion.div
              className="absolute inset-x-0 h-px"
              style={{
                background:
                  "linear-gradient(90deg, transparent, var(--ember), transparent)",
                top: "20%",
              }}
              animate={{ top: ["15%", "85%", "15%"] }}
              transition={{ duration: 4.2, repeat: Infinity, ease: "easeInOut" }}
            />
            <p className="mono text-[10px] tracking-[0.2em] mb-3" style={{ color: "var(--text-mute)" }}>
              DOCUMENT IN REVIEW
            </p>
            <p
              className="display text-lg sm:text-xl truncate"
              style={{ color: "var(--text)", letterSpacing: "-0.03em" }}
            >
              {fileName ?? "Your upload"}
            </p>
            <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--hairline)" }}>
              <motion.div
                className="h-full origin-left rounded-full"
                style={{ background: "var(--ember)" }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.5, ease: EASE }}
              />
            </div>
            <p className="mt-3 mono text-[10px]" style={{ color: "var(--text-mute)" }}>
              {Math.round(progress)}% · {current.n} of 04
            </p>
          </div>
        </div>

        {/* Headline */}
        <div className="mb-12 sm:mb-16 text-center max-w-3xl mx-auto">
          <AnimatePresence mode="wait">
            <motion.h1
              key={stage}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.55, ease: EASE }}
              className="display balance"
              style={{
                fontSize: "clamp(2rem, 5.5vw, 4.5rem)",
                color: "var(--text)",
              }}
            >
              {current.label}
              <span className="animate-blink ml-1 inline-block" style={{ color: "var(--ember)" }}>
                —
              </span>
            </motion.h1>
          </AnimatePresence>
          <AnimatePresence mode="wait">
            <motion.p
              key={displaySub}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35 }}
              className="mt-5 text-base max-w-lg mx-auto"
              style={{ color: "var(--text-3)" }}
            >
              {displaySub}
            </motion.p>
          </AnimatePresence>
        </div>

        {/* Stage rail */}
        <div
          className="grid grid-cols-2 sm:grid-cols-4 gap-0 border-t border-b max-w-4xl mx-auto w-full"
          style={{ borderColor: "var(--hairline-2)" }}
        >
          {STAGES.map((s, i) => {
            const done = i < currentIdx
            const active = i === currentIdx
            return (
              <div
                key={s.stage}
                className="py-5 px-3 sm:px-4 border-r relative last:border-r-0"
                style={{ borderColor: "var(--hairline-2)" }}
              >
                <motion.div
                  className="absolute top-0 left-0 h-0.5 origin-left w-full"
                  style={{ background: "var(--ember)" }}
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: done ? 1 : active ? 0.65 : 0 }}
                  transition={{ duration: 0.7, ease: EASE }}
                />
                <p
                  className="mono text-[10px] sm:text-[11px] tracking-[0.18em]"
                  style={{ color: done || active ? "var(--text-2)" : "var(--text-mute)" }}
                >
                  {s.n}
                </p>
                <p
                  className="mt-2 text-xs sm:text-sm leading-snug"
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

        <div className="mt-12 sm:mt-16 grid grid-cols-1 lg:grid-cols-2 gap-10 max-w-4xl mx-auto w-full flex-1">
          {/* Console */}
          <div style={{ borderLeft: "1px solid var(--hairline-2)", paddingLeft: 20 }}>
            <p className="eyebrow mb-4">Console</p>
            <div className="space-y-1.5 font-mono text-[11px] sm:text-[12px] min-h-[100px]">
              <AnimatePresence initial={false}>
                {logs.map((l, i) => (
                  <motion.div
                    key={`${l}-${i}`}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: i === logs.length - 1 ? 1 : 0.45, x: 0 }}
                    transition={{ duration: 0.3 }}
                    style={{ color: i === logs.length - 1 ? "var(--ember)" : "var(--text-mute)" }}
                  >
                    <span className="mr-2" style={{ color: "var(--text-mute)" }}>
                      $
                    </span>
                    {l}
                    {i === logs.length - 1 && (
                      <span
                        className="inline-block w-2 h-[10px] ml-1 align-middle animate-blink"
                        style={{ background: "var(--ember)" }}
                      />
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>

          {/* Retention tips */}
          <div
            className="relative pl-0 lg:pl-6 lg:border-l"
            style={{ borderColor: "var(--hairline-2)" }}
          >
            <p className="eyebrow mb-4">While you wait</p>
            <AnimatePresence mode="wait">
              <motion.p
                key={tipIdx}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.45, ease: EASE }}
                className="text-sm sm:text-base leading-relaxed italic"
                style={{ color: "var(--text-2)" }}
              >
                &ldquo;{WHILE_YOU_WAIT[tipIdx]}&rdquo;
              </motion.p>
            </AnimatePresence>
            <p className="mt-8 text-xs" style={{ color: "var(--text-mute)" }}>
              {patienceLine}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
