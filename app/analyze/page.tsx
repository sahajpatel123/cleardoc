"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/context/AuthContext"
import { motion } from "framer-motion"
import LoadingAnalysis from "@/components/ui/LoadingAnalysis"
import AnalysisResultsView from "@/components/ui/AnalysisResultsView"
import FreeLimitView, { type FreeLimitQuota } from "@/components/ui/FreeLimitView"
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
  const [limitQuota, setLimitQuota] = useState<FreeLimitQuota | null>(null)
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
          limit?: number
          used?: number
          remaining?: number
          resetsAt?: string
        }

        if (!res.ok) {
          if (res.status === 401) {
            setError("Your session expired. Please sign in again.")
            setStage("idle")
            setTimeout(() => {
              router.replace(`/login?redirect=${encodeURIComponent("/analyze")}`)
            }, 2000)
            return
          }

          if (
            res.status === 402 ||
            data.error === "FREE_DAILY_LIMIT_REACHED" ||
            data.error === "FREE_LIMIT_REACHED"
          ) {
            setLimitQuota({
              limit: data.limit ?? 3,
              used: data.used ?? data.limit ?? 3,
              remaining: data.remaining ?? 0,
              resetsAt: data.resetsAt,
            })
            setShowPricing(true)
            setStage("idle")
            return
          }

          const rawError = data.error ?? ""
          if (
            res.status === 500 &&
            (rawError.toLowerCase().includes("model") ||
              rawError.toLowerCase().includes("analysis failed"))
          ) {
            throw new Error("AI analysis failed. Please try again.")
          }

          if (res.status === 500) {
            throw new Error("Something went wrong. Please try again.")
          }

          throw new Error(rawError || "Analysis failed. Please try again.")
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
        startedRef.current = false
      }
    },
    [refreshProfile, router],
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
      let pending: Awaited<ReturnType<typeof takePendingAnalysis>>
      try {
        pending = await takePendingAnalysis()
      } catch (storeErr) {
        console.error("[analyze] Failed to read pending analysis:", storeErr)
        setError("No document found. Please upload your document again.")
        setStage("idle")
        setTimeout(() => router.replace("/"), 2500)
        return
      }

      if (!pending) {
        router.replace("/")
        return
      }

      await runAnalysis(pending.file, pending.context, pending.parentAnalysisId)
    })().catch((err: unknown) => {
      // Catch anything that escapes runAnalysis (should not happen, but belt-and-suspenders)
      console.error("[analyze] Unhandled error in analysis flow:", err)
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.")
      setStage("idle")
      startedRef.current = false
    })
  }, [authLoading, user, router, runAnalysis])

  if (showPricing && !result) {
    return <FreeLimitView quota={limitQuota ?? undefined} onClose={() => router.push("/")} />
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
