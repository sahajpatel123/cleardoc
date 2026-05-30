"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/context/AuthContext"
import { motion } from "framer-motion"
import AnalysisSessionLoading from "@/components/ui/AnalysisSessionLoading"
import AnalysisResultsView from "@/components/ui/AnalysisResultsView"
import FreeLimitView, { type FreeLimitQuota } from "@/components/ui/FreeLimitView"
import { takePendingAnalysis } from "@/lib/pending-analysis-store"
import { parseAnalysisResult } from "@/lib/validate-analysis"
import type { AnalysisResult, LoadingStage, Analysis } from "@/lib/types"
import { RotateCcw } from "lucide-react"

const SESSION_PATH = "/analyze/session"

export default function AnalysisSessionPage() {
  const router = useRouter()
  const { user, loading: authLoading, refreshProfile } = useAuth()
  const [stage, setStage] = useState<LoadingStage>("uploading")
  const [fileName, setFileName] = useState<string>()
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [analysisId, setAnalysisId] = useState<string | undefined>()
  const [caseAnalyses, setCaseAnalyses] = useState<Analysis[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showPricing, setShowPricing] = useState(false)
  const [limitQuota, setLimitQuota] = useState<FreeLimitQuota | null>(null)
  const startedRef = useRef(false)

  const runAnalysis = useCallback(
    async (file: File, context: string, parentId?: string) => {
      setFileName(file.name)
      const beat = (ms: number) => new Promise((r) => setTimeout(r, ms))

      try {
        setStage("uploading")
        await beat(350)

        const fd = new FormData()
        fd.append("file", file)
        fd.append("context", context)
        if (parentId) fd.append("parentId", parentId)

        setStage("reading")
        await beat(450)
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
              router.replace(`/login?redirect=${encodeURIComponent(SESSION_PATH)}`)
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

          if (res.status === 504 || res.status === 408) {
            throw new Error(
              "Analysis timed out — the document may be large. Please try again or use a shorter PDF.",
            )
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
        await beat(500)
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
            console.warn("[analyze/session] case chain fetch failed:", e)
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
      router.replace(`/login?redirect=${encodeURIComponent(SESSION_PATH)}`)
      return
    }
    if (startedRef.current) return
    startedRef.current = true

    void (async () => {
      let pending: Awaited<ReturnType<typeof takePendingAnalysis>>
      try {
        pending = await takePendingAnalysis()
      } catch (storeErr) {
        console.error("[analyze/session] Failed to read pending analysis:", storeErr)
        setError("No document found. Please upload your document again.")
        setStage("idle")
        setTimeout(() => router.replace("/#upload"), 2500)
        return
      }

      if (!pending) {
        router.replace("/#upload")
        return
      }

      await runAnalysis(pending.file, pending.context, pending.parentAnalysisId)
    })().catch((err: unknown) => {
      console.error("[analyze/session] Unhandled error:", err)
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.")
      setStage("idle")
      startedRef.current = false
    })
  }, [authLoading, user, router, runAnalysis])

  if (showPricing && !result) {
    return <FreeLimitView quota={limitQuota ?? undefined} onClose={() => router.push("/#upload")} />
  }

  if (stage !== "done" && stage !== "idle") {
    return <AnalysisSessionLoading stage={stage} fileName={fileName} />
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center px-4 pt-24">
        <div className="container-edition">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
            <p className="eyebrow mb-8" style={{ color: "var(--red)" }}>
              Analysis failed
            </p>
            <h1
              className="display max-w-[18ch] mb-8"
              style={{ fontSize: "clamp(2rem, 6vw, 4.5rem)", color: "var(--text)" }}
            >
              Something stalled.
            </h1>
            <p className="text-base mb-10 max-w-md" style={{ color: "var(--text-3)" }}>
              {error}
            </p>
            <button onClick={() => router.push("/#upload")} className="btn btn-primary">
              <RotateCcw className="w-4 h-4" /> Upload again
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
