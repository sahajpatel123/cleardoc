"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import dynamic from "next/dynamic"
import { useAuth } from "@/context/AuthContext"
import { motion } from "framer-motion"

// Lazy-loaded: AnalysisResultsView is a heavy component with framer-motion
// animations — only needed after the analysis data loads.
const AnalysisResultsView = dynamic(() => import("@/components/ui/AnalysisResultsView"))
import { parseAnalysisResult } from "@/lib/validate-analysis"
import type { Analysis, AnalysisResult, ChatMessage } from "@/lib/types"
import { parseChatMessages } from "@/lib/db"
import { LayoutDashboard } from "lucide-react"

export function AnalyzeByIdClient() {
  const router = useRouter()
  const params = useParams()
  const { user, loading: authLoading } = useAuth()
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [caseAnalyses, setCaseAnalyses] = useState<Analysis[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

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
            setChatMessages(parseChatMessages(analysis.chatMessages))
            if (analysis.caseId) {
              const caseRes = await fetch(`/api/analyses/case/${analysis.caseId}`)
              if (caseRes.ok) {
                const caseData = (await caseRes.json()) as Analysis[]
                if (!cancelled) setCaseAnalyses(Array.isArray(caseData) ? caseData : [])
              }
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error("[analyze/id] fetch error:", err)
          setErrorMsg(err instanceof Error ? err.message : "Could not load analysis. Try again.")
        }
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

  if (errorMsg) {
    return (
      <div className="min-h-screen flex items-center px-4 pt-24">
        <div className="container-edition">
          <p className="eyebrow mb-8" style={{ color: "var(--red)" }}>Server error</p>
          <h1
            className="display max-w-[20ch] mb-8"
            style={{ fontSize: "clamp(2rem, 6vw, 4.5rem)", color: "var(--text)" }}
          >
            Couldn&apos;t load that analysis.
          </h1>
          <p className="text-base mb-10 max-w-md" style={{ color: "var(--text-3)" }}>
            {errorMsg}
          </p>
          <button onClick={() => router.push("/dashboard")} className="btn btn-primary">
            <LayoutDashboard className="w-4 h-4" /> Back to dashboard
          </button>
        </div>
      </div>
    )
  }

  if (notFound || !result || !analysisId) {
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

  return (
    <AnalysisResultsView
      result={result}
      mode="saved"
      analysisId={analysisId}
      chatMessages={chatMessages}
      caseAnalyses={caseAnalyses}
      onResultChange={setResult}
    />
  )
}
