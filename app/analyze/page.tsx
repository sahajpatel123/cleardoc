"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/context/AuthContext"
import LoadingAnalysis from "@/components/ui/LoadingAnalysis"
import ResultCard from "@/components/ui/ResultCard"
import RedFlagItem from "@/components/ui/RedFlagItem"
import NextStepItem from "@/components/ui/NextStepItem"
import ResponseLetter from "@/components/ui/ResponseLetter"
import PricingModal from "@/components/ui/PricingModal"
import type { AnalysisResult, LoadingStage } from "@/lib/types"
import {
  FileText,
  AlertTriangle,
  Mail,
  ArrowRight,
  CheckCircle,
  XCircle,
  AlertCircle,
  RotateCcw,
  Shield,
} from "lucide-react"

const VERDICT_CONFIG = {
  legitimate: {
    label: "Legitimate",
    icon: CheckCircle,
    bg: "bg-emerald-500/10 border-emerald-500/30",
    text: "text-emerald-400",
    description: "This document appears legal and fair.",
  },
  suspicious: {
    label: "Suspicious",
    icon: AlertCircle,
    bg: "bg-amber-400/10 border-amber-400/30",
    text: "text-amber-400",
    description: "Something feels off — review red flags carefully.",
  },
  likely_illegal: {
    label: "Likely Illegal",
    icon: XCircle,
    bg: "bg-red-500/10 border-red-500/30",
    text: "text-red-400",
    description: "This document may violate laws or regulations.",
  },
}

interface PendingAnalysis {
  fileName: string
  fileType: string
  fileBase64: string
  context: string
}

export default function AnalyzePage() {
  const router = useRouter()
  const { user } = useAuth()
  const [stage, setStage] = useState<LoadingStage>("uploading")
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showPricing, setShowPricing] = useState(false)
  const [analysisId, setAnalysisId] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const didRun = useState(false)

  useEffect(() => {
    const raw = sessionStorage.getItem("pendingAnalysis")
    if (!raw) {
      router.push("/")
      return
    }

    const pending: PendingAnalysis = JSON.parse(raw)
    sessionStorage.removeItem("pendingAnalysis")
    runAnalysis(pending)
  }, [])

  const runAnalysis = async (pending: PendingAnalysis) => {
    try {
      // Stage 1: Uploading
      setStage("uploading")
      await sleep(800)

      // Reconstruct file from base64
      const binaryStr = atob(pending.fileBase64)
      const bytes = new Uint8Array(binaryStr.length)
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i)
      }
      const blob = new Blob([bytes], { type: pending.fileType })
      const file = new File([blob], pending.fileName, { type: pending.fileType })

      const formData = new FormData()
      formData.append("file", file)
      formData.append("context", pending.context)

      if (user) {
        const token = await user.getIdToken()
        formData.append("idToken", token)
      }

      // Stage 2: Reading
      setStage("reading")
      await sleep(1000)

      // Stage 3: Analyzing
      setStage("analyzing")

      const res = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
      })

      const data = await res.json()

      if (!res.ok) {
        if (data.error === "FREE_LIMIT_REACHED") {
          setShowPricing(true)
          setStage("idle")
          return
        }
        throw new Error(data.error ?? "Analysis failed")
      }

      // Stage 4: Preparing
      setStage("preparing")
      await sleep(800)

      setResult(data.result)
      setAnalysisId(data.analysisId ?? null)
      setStage("done")
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : "Something went wrong.")
      setStage("idle")
    }
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  if (stage !== "done" && stage !== "idle") {
    return <LoadingAnalysis stage={stage} />
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0A0A0F] flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
            <XCircle className="w-8 h-8 text-red-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2" style={{ fontFamily: "var(--font-syne, sans-serif)" }}>Analysis Failed</h2>
          <p className="text-slate-400 mb-6 text-sm">{error}</p>
          <button
            onClick={() => router.push("/")}
            className="flex items-center gap-2 bg-amber-400 text-black font-bold px-6 py-3 rounded-xl hover:bg-amber-300 transition-all mx-auto"
          >
            <RotateCcw className="w-4 h-4" />
            Try Again
          </button>
        </div>
      </div>
    )
  }

  if (!result) return null

  const verdict = VERDICT_CONFIG[result.overall_verdict]
  const VerdictIcon = verdict.icon
  const highFlags = result.red_flags.filter((f) => f.severity === "high")

  return (
    <div className="relative min-h-screen bg-[#0A0A0F]">
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-amber-400/3 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {/* Page header */}
        <div className="mb-10">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <p className="text-xs text-slate-600 uppercase tracking-wider mb-2">Analysis Complete</p>
              <h1
                className="text-3xl sm:text-4xl font-black text-white"
                style={{ fontFamily: "var(--font-syne, sans-serif)" }}
              >
                Here&apos;s what we found
              </h1>
            </div>

            {/* Verdict badge */}
            <div
              className={`inline-flex items-center gap-2.5 border rounded-2xl px-5 py-3 ${verdict.bg}`}
            >
              <VerdictIcon className={`w-5 h-5 ${verdict.text}`} />
              <div>
                <p className={`text-sm font-bold ${verdict.text}`}>
                  {verdict.label}
                </p>
                <p className="text-xs text-slate-500">{verdict.description}</p>
              </div>
            </div>
          </div>

          {/* Warning bar for high severity */}
          {highFlags.length > 0 && (
            <div className="mt-4 flex items-center gap-3 bg-red-500/5 border border-red-500/20 rounded-xl px-4 py-3">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <p className="text-sm text-red-300">
                <span className="font-semibold">{highFlags.length} high-severity issue{highFlags.length > 1 ? "s" : ""}</span>{" "}
                detected. Read the red flags carefully before responding.
              </p>
            </div>
          )}
        </div>

        {/* Results grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Card 1: Plain summary */}
          <ResultCard
            title="What This Actually Says"
            subtitle="Plain English, zero jargon"
            icon={<FileText className="w-4 h-4" />}
            accent="amber"
          >
            <p className="text-slate-300 leading-relaxed text-sm">{result.plain_summary}</p>
          </ResultCard>

          {/* Card 2: Red flags */}
          <ResultCard
            title="Red Flags Found"
            subtitle={
              result.red_flags.length > 0
                ? `${result.red_flags.length} issue${result.red_flags.length > 1 ? "s" : ""} detected`
                : "Document reviewed"
            }
            icon={<AlertTriangle className="w-4 h-4" />}
            accent={result.red_flags.length > 0 ? "red" : "emerald"}
          >
            {result.red_flags.length === 0 ? (
              <div className="flex items-center gap-3 py-2">
                <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                  <p className="text-white font-medium text-sm">No major red flags found</p>
                  <p className="text-slate-500 text-xs">This document appears to be straightforward.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {result.red_flags
                  .sort((a, b) => {
                    const order = { high: 0, medium: 1, low: 2 }
                    return order[a.severity] - order[b.severity]
                  })
                  .map((flag, i) => (
                    <RedFlagItem key={i} flag={flag} index={i} />
                  ))}
              </div>
            )}
          </ResultCard>
        </div>

        {/* Card 3: Response letter — full width */}
        <div className="mb-6">
          <ResultCard
            title="Your Response Letter"
            subtitle="Ready to send — customize the bracketed fields"
            icon={<Mail className="w-4 h-4" />}
            accent="blue"
          >
            <ResponseLetter letter={result.response_letter} />
          </ResultCard>
        </div>

        {/* Card 4: Next steps */}
        <div className="mb-10">
          <ResultCard
            title="Your Next Steps"
            subtitle="Ranked by likelihood of success"
            icon={<ArrowRight className="w-4 h-4" />}
            accent="emerald"
          >
            <div className="space-y-2">
              {result.next_steps
                .sort((a, b) => a.priority - b.priority)
                .map((step, i) => (
                  <NextStepItem key={i} step={step} index={i} />
                ))}
            </div>
          </ResultCard>
        </div>

        {/* Bottom actions */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <button
            onClick={() => router.push("/")}
            className="flex items-center gap-2 border border-white/10 hover:border-white/20 text-slate-300 hover:text-white px-6 py-3 rounded-xl transition-all text-sm font-medium"
          >
            <RotateCcw className="w-4 h-4" />
            Analyze Another Document
          </button>
          {user && analysisId && !saved && (
            <button
              onClick={() => {
                setSaved(true)
                router.push("/dashboard")
              }}
              className="flex items-center gap-2 bg-amber-400/10 hover:bg-amber-400/20 border border-amber-400/20 text-amber-400 px-6 py-3 rounded-xl transition-all text-sm font-medium"
            >
              <Shield className="w-4 h-4" />
              View in Dashboard
            </button>
          )}
        </div>

        <p className="text-center text-xs text-slate-700 mt-8">
          This is not legal advice. ClearDoc provides general information only.
        </p>
      </div>

      {showPricing && <PricingModal onClose={() => { setShowPricing(false); router.push("/") }} />}
    </div>
  )
}
