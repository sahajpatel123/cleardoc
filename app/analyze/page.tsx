"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/context/AuthContext"
import { motion, AnimatePresence } from "framer-motion"
import LoadingAnalysis from "@/components/ui/LoadingAnalysis"
import ResultCard from "@/components/ui/ResultCard"
import RedFlagItem from "@/components/ui/RedFlagItem"
import NextStepItem from "@/components/ui/NextStepItem"
import ResponseLetter from "@/components/ui/ResponseLetter"
import PricingModal from "@/components/ui/PricingModal"
import { Reveal } from "@/components/ui/Kinetic"
import type { AnalysisResult, LoadingStage } from "@/lib/types"
import {
  CheckCircle, XCircle, AlertCircle, RotateCcw, LayoutDashboard,
} from "lucide-react"

const VERDICT = {
  legitimate: {
    label: "Legitimate",
    Icon: CheckCircle,
    accent: "var(--moss)",
    labelClass: "label-moss",
    desc: "This document appears legal and fair.",
  },
  suspicious: {
    label: "Suspicious",
    Icon: AlertCircle,
    accent: "var(--amber)",
    labelClass: "label-amber",
    desc: "Review red flags carefully before responding.",
  },
  likely_illegal: {
    label: "Likely Illegal",
    Icon: XCircle,
    accent: "var(--red)",
    labelClass: "label-red",
    desc: "This may violate laws or regulations.",
  },
}

interface PendingAnalysis { fileName: string; fileType: string; fileBase64: string; context: string }

export default function AnalyzePage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const [stage, setStage] = useState<LoadingStage>("uploading")
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showPricing, setShowPricing] = useState(false)

  const runAnalysis = useCallback(async (pending: PendingAnalysis) => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))
    try {
      setStage("uploading"); await delay(700)
      const bs = atob(pending.fileBase64)
      const bytes = new Uint8Array(bs.length)
      for (let i = 0; i < bs.length; i++) bytes[i] = bs.charCodeAt(i)
      const blob = new Blob([bytes], { type: pending.fileType })
      const file = new File([blob], pending.fileName, { type: pending.fileType })
      const fd = new FormData()
      fd.append("file", file)
      fd.append("context", pending.context)

      setStage("reading"); await delay(900)
      setStage("analyzing")
      const res = await fetch("/api/analyze", { method: "POST", body: fd })
      const data = await res.json()

      if (!res.ok) {
        if (data.error === "FREE_LIMIT_REACHED") { setShowPricing(true); setStage("idle"); return }
        throw new Error(data.error ?? "Analysis failed")
      }

      setStage("preparing"); await delay(700)
      setResult(data.result)
      setStage("done")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.")
      setStage("idle")
    }
  }, [])

  useEffect(() => {
    if (authLoading) return
    const raw = sessionStorage.getItem("pendingAnalysis")
    if (!raw) { router.push("/"); return }
    const pending: PendingAnalysis = JSON.parse(raw)
    sessionStorage.removeItem("pendingAnalysis")
    ;(async () => { await runAnalysis(pending) })()
  }, [authLoading, router, runAnalysis])

  if (stage !== "done" && stage !== "idle") return <LoadingAnalysis stage={stage} />

  if (error) return (
    <div className="min-h-screen flex items-center px-4 pt-24">
      <div className="container-edition">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
          <p className="eyebrow mb-8" style={{ color: "var(--red)" }}>Analysis failed</p>
          <h1 className="display max-w-[18ch] mb-8" style={{ fontSize: "clamp(2rem, 6vw, 4.5rem)", color: "var(--text)" }}>
            Something stalled.
          </h1>
          <p className="text-base mb-10 max-w-md" style={{ color: "var(--text-3)" }}>
            {error}
          </p>
          <button onClick={() => router.push("/")} className="btn btn-primary">
            <RotateCcw className="w-4 h-4" /> Try again
          </button>
        </motion.div>
      </div>
    </div>
  )

  if (!result) return null

  const verdict = VERDICT[result.overall_verdict]
  const VIcon = verdict.Icon
  const highFlags = result.red_flags.filter((f) => f.severity === "high")
  const sortedFlags = [...result.red_flags].sort(
    (a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]),
  )

  return (
    <div className="min-h-screen pt-28 pb-32">
      <div className="container-edition">
        {/* Header */}
        <Reveal>
          <div className="flex items-baseline justify-between mb-10">
            <p className="eyebrow">Analysis complete</p>
            <span className={`label ${verdict.labelClass}`}>
              <VIcon className="w-3 h-3" /> {verdict.label}
            </span>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <h1
            className="display max-w-[20ch] mb-6"
            style={{ fontSize: "clamp(2.4rem, 7vw, 6rem)", color: "var(--text)" }}
          >
            <span>Here&apos;s what </span>
            <span className="serif-italic" style={{ color: "var(--ember)" }}>
              we found.
            </span>
          </h1>
          <p className="max-w-md text-base" style={{ color: "var(--text-3)" }}>
            {verdict.desc}
          </p>
        </Reveal>

        {/* High severity banner */}
        <AnimatePresence>
          {highFlags.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-10 flex items-start gap-4 p-5 rounded-lg"
              style={{
                background: "rgba(229,90,62,0.06)",
                border: "1px solid rgba(229,90,62,0.20)",
              }}
            >
              <span className="label label-red shrink-0">
                Heads up
              </span>
              <p className="text-sm leading-relaxed" style={{ color: "var(--text-2)" }}>
                <strong style={{ color: "var(--red)" }}>{highFlags.length} high-severity issue{highFlags.length > 1 ? "s" : ""}</strong>{" "}
                detected. Read the red flags below carefully before responding.
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Results */}
        <div className="mt-20">
          <ResultCard
            number="I"
            title="What this actually says"
            subtitle="Plain English, zero jargon"
            accent="orange"
          >
            <p
              className="text-lg leading-relaxed max-w-3xl"
              style={{ color: "var(--text-2)", fontFamily: "ui-serif, Georgia, serif" }}
            >
              {result.plain_summary}
            </p>
          </ResultCard>

          <ResultCard
            number="II"
            title="Red flags found"
            subtitle={
              result.red_flags.length > 0
                ? `${result.red_flags.length} issue${result.red_flags.length > 1 ? "s" : ""} detected`
                : "Document reviewed"
            }
            accent="red"
          >
            {result.red_flags.length === 0 ? (
              <div className="flex items-center gap-4 py-2">
                <CheckCircle className="w-5 h-5 shrink-0" style={{ color: "var(--moss)" }} />
                <div>
                  <p
                    style={{
                      color: "var(--text)",
                      fontFamily: "var(--font-syne,'Syne',sans-serif)",
                      fontWeight: 500,
                      letterSpacing: "-0.02em",
                    }}
                  >
                    No major red flags found
                  </p>
                  <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>
                    This document appears straightforward.
                  </p>
                </div>
              </div>
            ) : (
              <div>
                {sortedFlags.map((flag, i) => <RedFlagItem key={i} flag={flag} index={i} />)}
              </div>
            )}
          </ResultCard>

          <ResultCard
            number="III"
            title="Your response letter"
            subtitle="Ready to send — fill in the bracketed fields"
            accent="blue"
          >
            <ResponseLetter letter={result.response_letter} />
          </ResultCard>

          <ResultCard
            number="IV"
            title="Your next moves"
            subtitle="Ranked by likelihood of success"
            accent="green"
          >
            <div>
              {[...result.next_steps]
                .sort((a, b) => a.priority - b.priority)
                .map((step, i) => <NextStepItem key={i} step={step} index={i} />)}
            </div>
          </ResultCard>
        </div>

        {/* Footer actions */}
        <div className="hairline mt-16 mb-12" />
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <p className="text-xs italic max-w-md" style={{ color: "var(--text-mute)" }}>
            This is not legal advice. ClearDoc provides general information only.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={() => router.push("/")} className="btn btn-ghost">
              <RotateCcw className="w-4 h-4" /> Analyze another
            </button>
            {user && (
              <button onClick={() => router.push("/dashboard")} className="btn btn-primary">
                <LayoutDashboard className="w-4 h-4" /> View dashboard
              </button>
            )}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showPricing && <PricingModal onClose={() => { setShowPricing(false); router.push("/") }} />}
      </AnimatePresence>
    </div>
  )
}
