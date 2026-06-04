"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import { useAuth } from "@/context/AuthContext"
import { motion } from "framer-motion"
import FreeLimitView, { type FreeLimitQuota } from "@/components/ui/FreeLimitView"

// Lazy-loaded: these components are heavy (framer-motion + large DOM) and only
// needed during/after the analysis flow — not on initial page shell render.
const AnalysisSessionLoading = dynamic(() => import("@/components/ui/AnalysisSessionLoading"))
const AnalysisResultsView = dynamic(() => import("@/components/ui/AnalysisResultsView"))
import { takePendingAnalysis } from "@/lib/pending-analysis-store"
import { safeParseAnalysisResult } from "@/lib/schemas"
import type { AnalysisResult, LoadingStage, Analysis } from "@/lib/types"
import { RotateCcw } from "lucide-react"
import { captureException } from "@/lib/observability"

const SESSION_PATH = "/analyze/session"

// H17 fix: dev-mode Strict Mode unmounts → remounts the component on
// initial render. A component-scoped `useRef(false)` flag is recreated on
// remount, so the second mount re-runs the effect and re-enters
// takePendingAnalysis — which is destructive and returns null on the second
// call, causing a spurious "no document found" → redirect to /#upload
// before the in-flight analysis from the first mount completes.
//
// sessionStorage survives both the strict-mode unmount AND a same-tab
// page refresh, so a single tab can never runAnalysis twice. The key is
// namespaced by the current user id so multi-account sessions are clean.
const STARTED_KEY_PREFIX = "cleardoc.analyze.started."

function getStartedKey(userId: string): string {
  return `${STARTED_KEY_PREFIX}${userId}`
}

function claimStartedSlot(userId: string): boolean {
  if (typeof window === "undefined") return false
  const key = getStartedKey(userId)
  if (window.sessionStorage.getItem(key) === "1") return false
  window.sessionStorage.setItem(key, "1")
  return true
}

function releaseStartedSlot(userId: string): void {
  if (typeof window === "undefined") return
  window.sessionStorage.removeItem(getStartedKey(userId))
}

export function AnalysisSessionClient() {
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
  // Fallback for SSR / pre-hydration — the sessionStorage check below is
  // the actual source of truth.
  const startedRef = useRef(false)
  // Single controller for the entire session lifecycle. Aborted on unmount
  // so a navigation away during a 60s AI call kills the request instead of
  // burning a full NVIDIA call + analysis quota for a result nobody sees.
  const abortRef = useRef<AbortController | null>(null)

  const runAnalysis = useCallback(
    async (file: File, context: string, parentId?: string) => {
      setFileName(file.name)
      const beat = (ms: number) => new Promise((r) => setTimeout(r, ms))

      // Hoisted to the callback's scope so the outer `finally` clause can
      // reference it for cleanup. The try/catch/finally scoping rules in
      // TypeScript do not let us read the declaration site from a sibling
      // `finally` clause, so we declare it once up-front.
      let localAbort: AbortController | null = null

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

        // Defense-in-depth: even if the parent abortRef is unset (e.g. HMR
        // re-mount), this local controller is bounded by the outer one.
        localAbort = new AbortController()
        abortRef.current = localAbort
        const timeoutId = setTimeout(() => localAbort?.abort(), 130_000)
        if (localAbort.signal.aborted) return

        let res: Response
        try {
          res = await fetch("/api/analyze", {
            method: "POST",
            body: fd,
            signal: localAbort.signal,
          })
        } finally {
          clearTimeout(timeoutId)
        }
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

        const parsed = safeParseAnalysisResult(data.result)
        if (!parsed) {
          throw new Error("Analysis returned unexpected data. Please try again.")
        }

        setStage("preparing")
        await beat(500)
        setResult(parsed)
        setAnalysisId(data.analysisId)
        if (data.analysisId) {
          // Follow-up fetches also respect the abort signal so a navigation
          // away mid-flow does not leak the analysis chain request.
          try {
            if (localAbort.signal.aborted) return
            const detailRes = await fetch(`/api/analyses/${data.analysisId}`, {
              signal: localAbort.signal,
            })
            if (detailRes.ok) {
              const detail = await detailRes.json()
              if (detail.caseId) {
                if (localAbort.signal.aborted) return
                const caseRes = await fetch(`/api/analyses/case/${detail.caseId}`, {
                  signal: localAbort.signal,
                })
                if (caseRes.ok) {
                  const caseData = (await caseRes.json()) as Analysis[]
                  if (Array.isArray(caseData)) setCaseAnalyses(caseData)
                }
              }
            }
          } catch (e) {
            if (e instanceof Error && e.name === "AbortError") throw e
            console.warn("[analyze/session] case chain fetch failed:", e)
          }
        }
        setStage("done")
        await refreshProfile()
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          // Navigation away or timeout — do not show error UI.
          return
        }
        setError(err instanceof Error ? err.message : "Something went wrong.")
        setStage("idle")
        startedRef.current = false
      } finally {
        if (localAbort && abortRef.current === localAbort) {
          abortRef.current = null
        }
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
    // H17 fix: sessionStorage-based dedup. Survives strict-mode unmount
    // and same-tab refresh. The component-scoped ref is a secondary check
    // for the same render cycle (race between effect re-runs).
    if (!claimStartedSlot(user.id)) {
      // Already running for this user in this tab. The first mount owns
      // the actual analysis call — we just stay put and let it finish.
      startedRef.current = true
      return
    }
    startedRef.current = true

    void (async () => {
      let pending: Awaited<ReturnType<typeof takePendingAnalysis>>
      try {
        pending = await takePendingAnalysis()
      } catch (storeErr) {
        captureException(storeErr, { component: "analyze-session", extra: { phase: "read-pending" } })
        setError("No document found. Please upload your document again.")
        setStage("idle")
        releaseStartedSlot(user.id)
        setTimeout(() => router.replace("/#upload"), 2500)
        return
      }

      if (!pending) {
        // First mount already took it; strict-mode twin sees null. Stay
        // put — the in-flight analysis from the first mount will redirect
        // to /analyze/[id] when it completes.
        return
      }

      try {
        await runAnalysis(pending.file, pending.context, pending.parentAnalysisId)
      } finally {
        // Release the slot on terminal completion so a subsequent
        // navigation to /analyze/session (e.g. retry) can run again.
        releaseStartedSlot(user.id)
        startedRef.current = false
      }
    })().catch((err: unknown) => {
      if (err instanceof Error && err.name === "AbortError") return
      captureException(err, { component: "analyze-session", extra: { phase: "run-analysis" } })
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.")
      setStage("idle")
      startedRef.current = false
      releaseStartedSlot(user.id)
    })
  }, [authLoading, user, router, runAnalysis])

  // Cancel any in-flight request on unmount (e.g. user navigates back).
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

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
              className="display max-w-[20ch] mb-8"
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
