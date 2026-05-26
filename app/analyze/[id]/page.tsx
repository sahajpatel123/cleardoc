"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { useAuth } from "@/context/AuthContext"
import { motion } from "framer-motion"
import ResultCard from "@/components/ui/ResultCard"
import RedFlagItem from "@/components/ui/RedFlagItem"
import NextStepItem from "@/components/ui/NextStepItem"
import ResponseLetter from "@/components/ui/ResponseLetter"
import { Reveal } from "@/components/ui/Kinetic"
import type { AnalysisResult } from "@/lib/types"
import { parseAnalysisResult } from "@/lib/validate-analysis"
import { getVerdictUi } from "@/lib/verdict-ui"
import {
  CheckCircle, RotateCcw, LayoutDashboard, AlertTriangle,
} from "lucide-react"

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const

export default function AnalyzeByIdPage() {
  const router = useRouter()
  const params = useParams()
  const { user, loading: authLoading } = useAuth()
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const analysisId =
    typeof params.id === "string" ? params.id : Array.isArray(params.id) ? params.id[0] : undefined

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      router.replace(`/login?redirect=${encodeURIComponent(`/analyze/${analysisId ?? ""}`)}`)
      return
    }
    if (!analysisId) {
      queueMicrotask(() => { setNotFound(true); setLoading(false) })
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/analyses/${analysisId}`)
        if (cancelled) return
        if (!res.ok) {
          setNotFound(true)
          setResult(null)
        } else {
          const analysis = await res.json()
          const parsed = parseAnalysisResult(analysis.result)
          if (!parsed) {
            setNotFound(true)
            setResult(null)
          } else {
            setResult(parsed)
          }
        }
      } catch {
        if (!cancelled) setNotFound(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [authLoading, user, analysisId, router])

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <motion.span
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1.6, repeat: Infinity }}
          className="mono text-[11px] tracking-[0.3em]"
          style={{ color: "var(--text-3)" }}
        >
          LOADING
        </motion.span>
      </div>
    )
  }

  if (!user) return null

  if (notFound || !result) {
    return (
      <div className="min-h-screen flex items-center px-4 pt-24">
        <div className="container-edition">
          <p className="eyebrow mb-8">Not found</p>
          <h1
            className="display max-w-[20ch] mb-8"
            style={{ fontSize: "clamp(2rem, 6vw, 4.5rem)", color: "var(--text)" }}
          >
            We can&apos;t find that analysis.
          </h1>
          <p className="text-base mb-10 max-w-md" style={{ color: "var(--text-3)" }}>
            It may have been deleted, or it belongs to a different account.
          </p>
          <button onClick={() => router.push("/dashboard")} className="btn btn-primary">
            <LayoutDashboard className="w-4 h-4" /> Back to dashboard
          </button>
        </div>
      </div>
    )
  }

  const verdict = getVerdictUi(result.overall_verdict)
  const VIcon = verdict.Icon
  const highFlags = result.red_flags.filter((f) => f.severity === "high")
  const sortedFlags = [...result.red_flags].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  )

  return (
    <div className="min-h-screen pt-28 pb-32">
      <div className="container-edition">
        <Reveal>
          <div className="flex items-baseline justify-between mb-10">
            <p className="eyebrow">Saved analysis</p>
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

        {highFlags.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-10 flex items-start gap-4 p-5 rounded-lg"
            style={{ background: "rgba(229,90,62,0.06)", border: "1px solid rgba(229,90,62,0.20)" }}
          >
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--red)" }} />
            <p className="text-sm leading-relaxed" style={{ color: "var(--text-2)" }}>
              <strong style={{ color: "var(--red)" }}>{highFlags.length} high-severity issue{highFlags.length > 1 ? "s" : ""}</strong>{" "}
              detected. Read the red flags below carefully before responding.
            </p>
          </motion.div>
        )}

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

        <div className="hairline mt-16 mb-12" />
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <p className="text-xs italic max-w-md" style={{ color: "var(--text-mute)" }}>
            This is not legal advice. ClearDoc provides general information only.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={() => router.push("/")} className="btn btn-ghost">
              <RotateCcw className="w-4 h-4" /> Analyze another
            </button>
            <button onClick={() => router.push("/dashboard")} className="btn btn-primary">
              <LayoutDashboard className="w-4 h-4" /> View dashboard
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
