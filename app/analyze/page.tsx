"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/context/AuthContext"
import { motion, AnimatePresence } from "framer-motion"
import LoadingAnalysis from "@/components/ui/LoadingAnalysis"
import AnalysisResultsView from "@/components/ui/AnalysisResultsView"
import PricingModal from "@/components/ui/PricingModal"
import { Reveal } from "@/components/ui/Kinetic"
import { takePendingAnalysis } from "@/lib/pending-analysis-store"
import { parseAnalysisResult } from "@/lib/validate-analysis"
import type { AnalysisResult, LoadingStage, Analysis } from "@/lib/types"
import { RotateCcw } from "lucide-react"

export default function AnalyzePage() {
  const router = useRouter()
  const { user, loading: authLoading, refreshProfile } = useAuth()
  const [stage, setStage] = useState<LoadingStage>("uploading")
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [analysisId, setAnalysisId] = useState<string | undefined>()
  const [caseAnalyses, setCaseAnalyses] = useState<Analysis[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showPricing, setShowPricing] = useState(false)
  const startedRef = useRef(false)

  const runAnalysis = useCallback(
    async (file: File, context: string, parentId?: string) => {
      const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))
      try {
        setStage("uploading")
        await delay(700)

        const fd = new FormData()
        fd.append("file", file)
        fd.append("context", context)
        if (parentId) fd.append("parentId", parentId)

        setStage("reading")
        await delay(900)
        setStage("analyzing")

        const res = await fetch("/api/analyze", { method: "POST", body: fd })
        const data = (await res.json()) as {
          error?: string
          result?: unknown
          analysisId?: string
        }

        if (!res.ok) {
          if (data.error === "FREE_LIMIT_REACHED") {
            setShowPricing(true)
            setStage("idle")
            return
          }
          throw new Error(data.error ?? "Analysis failed")
        }

        const parsed = parseAnalysisResult(data.result)
        if (!parsed) {
          throw new Error("Analysis returned unexpected data. Please try again.")
        }

        setStage("preparing")
        await delay(700)
        setResult(parsed)
        setAnalysisId(data.analysisId)
        if (data.analysisId) {
          try {
            const detailRes = await fetch(`/api/analyses/${data.analysisId}`)
            if (detailRes.ok) {
              const detail = await detailRes.json()
              if (detail.caseId) {
                const caseRes = await fetch(`/api/analyses/case/${detail.caseId}`)
                if (caseRes.ok) {
                  const caseData = (await caseRes.json()) as Analysis[]
                  if (Array.isArray(caseData)) setCaseAnalyses(caseData)
                }
              }
            }
          } catch (e) {
            // Case chain fetch is optional — don't fail the whole analysis
            console.warn("[analyze] case chain fetch failed:", e)
          }
        }
        setStage("done")
        await refreshProfile()
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.")
        setStage("idle")
      }
    },
    [refreshProfile],
  )

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      router.replace(`/login?redirect=${encodeURIComponent("/analyze")}`)
      return
    }
    if (startedRef.current) return
    startedRef.current = true

    void (async () => {
      const pending = await takePendingAnalysis()
      if (!pending) {
        router.replace("/")
        return
      }
      await runAnalysis(pending.file, pending.context, pending.parentAnalysisId)
    })()
  }, [authLoading, user, router, runAnalysis])

  if (showPricing && !result) {
    return (
      <div className="min-h-screen flex items-center px-4 pt-24">
        <div className="container-edition">
          <Reveal>
            <p className="eyebrow mb-8" style={{ color: "var(--ember)" }}>
              Free limit reached
            </p>
            <h1
              className="display max-w-[18ch] mb-8"
              style={{ fontSize: "clamp(2rem, 6vw, 4.5rem)", color: "var(--text)" }}
            >
              You&apos;ve used your free analysis.
            </h1>
            <p className="text-base mb-6 max-w-md" style={{ color: "var(--text-3)" }}>
              Upgrade to Pro for unlimited document analyses, or sign out and try another account.
            </p>
          </Reveal>
        </div>
        <AnimatePresence>
          <PricingModal onClose={() => router.push("/")} />
        </AnimatePresence>
      </div>
    )
  }

  if (stage !== "done" && stage !== "idle") return <LoadingAnalysis stage={stage} />

  if (error) {
    return (
      <div className="min-h-screen flex items-center px-4 pt-24">
        <div className="container-edition">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
            <p className="eyebrow mb-8" style={{ color: "var(--red)" }}>Analysis failed</p>
            <h1
              className="display max-w-[18ch] mb-8"
              style={{ fontSize: "clamp(2rem, 6vw, 4.5rem)", color: "var(--text)" }}
            >
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
  }

  if (!result) return null

  return (
    <AnalysisResultsView
      result={result}
      mode="fresh"
      analysisId={analysisId}
      caseAnalyses={caseAnalyses}
      onResultChange={setResult}
    />
  )
}
