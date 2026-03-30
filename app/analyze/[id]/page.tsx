"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { useAuth } from "@/context/AuthContext"
import { getUserAnalysis } from "@/lib/firestore"
import { motion } from "framer-motion"
import ResultCard from "@/components/ui/ResultCard"
import RedFlagItem from "@/components/ui/RedFlagItem"
import NextStepItem from "@/components/ui/NextStepItem"
import ResponseLetter from "@/components/ui/ResponseLetter"
import type { AnalysisResult } from "@/lib/types"
import {
  FileText,
  AlertTriangle,
  Mail,
  ArrowRight,
  CheckCircle,
  XCircle,
  AlertCircle,
  RotateCcw,
  LayoutDashboard,
} from "lucide-react"

const VERDICT = {
  legitimate: {
    label: "Legitimate",
    Icon: CheckCircle,
    bg: "#ECFDF5",
    border: "rgba(5,150,105,0.2)",
    text: "#059669",
    desc: "This document appears legal and fair.",
  },
  suspicious: {
    label: "Suspicious",
    Icon: AlertCircle,
    bg: "#FFFBEB",
    border: "rgba(217,119,6,0.2)",
    text: "#D97706",
    desc: "Review red flags carefully before responding.",
  },
  likely_illegal: {
    label: "Likely Illegal",
    Icon: XCircle,
    bg: "#FEF2F2",
    border: "rgba(220,38,38,0.2)",
    text: "#DC2626",
    desc: "This may violate laws or regulations.",
  },
}

const cardVariants = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.55,
      delay: i * 0.1,
      ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
    },
  }),
}

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const

export default function AnalyzeByIdPage() {
  const router = useRouter()
  const params = useParams()
  const { user, loading: authLoading } = useAuth()
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const analysisId =
    typeof params.id === "string"
      ? params.id
      : Array.isArray(params.id)
        ? params.id[0]
        : undefined

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      router.replace("/")
      return
    }
    if (!analysisId) {
      setNotFound(true)
      setLoading(false)
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const analysis = await getUserAnalysis(user.uid, analysisId)
        if (cancelled) return
        if (!analysis) {
          setNotFound(true)
          setResult(null)
        } else {
          setResult(analysis.result)
        }
      } catch {
        if (!cancelled) setNotFound(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [authLoading, user, analysisId, router])

  if (authLoading || loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "#FAFAF8" }}
      >
        <div
          className="w-8 h-8 rounded-full border-2 animate-spin"
          style={{
            borderColor: "rgba(232,101,26,0.2)",
            borderTopColor: "#E8651A",
          }}
        />
      </div>
    )
  }

  if (!user) return null

  if (notFound || !result) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center px-4"
        style={{ background: "#FAFAF8" }}
      >
        <p
          className="text-lg font-bold mb-4"
          style={{
            color: "#18130E",
            fontFamily: "var(--font-syne,'Syne',sans-serif)",
          }}
        >
          Not found
        </p>
        <p className="text-sm mb-6" style={{ color: "#6B5E52" }}>
          This analysis doesn&apos;t exist or you don&apos;t have access to it.
        </p>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => router.push("/dashboard")}
          className="flex items-center gap-2 px-6 py-3 rounded-2xl text-sm font-semibold"
          style={{
            background: "#FEF0E6",
            color: "#C4530F",
            border: "1px solid rgba(232,101,26,0.2)",
          }}
        >
          <LayoutDashboard className="w-4 h-4" /> Back to Dashboard
        </motion.button>
      </div>
    )
  }

  const verdict = VERDICT[result.overall_verdict]
  const VIcon = verdict.Icon
  const highFlags = result.red_flags.filter((f) => f.severity === "high")

  return (
    <div style={{ background: "#FAFAF8", minHeight: "100vh" }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-10"
        >
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <p className="section-label mb-2">Analysis Complete</p>
              <h1
                className="text-3xl sm:text-4xl font-black"
                style={{
                  color: "#18130E",
                  fontFamily: "var(--font-syne,'Syne',sans-serif)",
                }}
              >
                Here&apos;s what we found
              </h1>
            </div>
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, type: "spring", stiffness: 300 }}
              className="inline-flex items-center gap-3 rounded-2xl px-5 py-3 border"
              style={{ background: verdict.bg, borderColor: verdict.border }}
            >
              <VIcon className="w-5 h-5" style={{ color: verdict.text }} />
              <div>
                <p
                  className="text-sm font-bold"
                  style={{ color: verdict.text }}
                >
                  {verdict.label}
                </p>
                <p className="text-xs" style={{ color: "#A89484" }}>
                  {verdict.desc}
                </p>
              </div>
            </motion.div>
          </div>

          {highFlags.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 flex items-center gap-3 rounded-2xl px-4 py-3 border"
              style={{
                background: "#FEF2F2",
                borderColor: "rgba(220,38,38,0.2)",
              }}
            >
              <AlertTriangle
                className="w-4 h-4 shrink-0"
                style={{ color: "#DC2626" }}
              />
              <p className="text-sm" style={{ color: "#991B1B" }}>
                <strong>
                  {highFlags.length} high-severity issue
                  {highFlags.length > 1 ? "s" : ""}
                </strong>{" "}
                detected. Read red flags carefully before responding.
              </p>
            </motion.div>
          )}
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
          <motion.div
            custom={0}
            variants={cardVariants}
            initial="hidden"
            animate="show"
          >
            <ResultCard
              title="What This Actually Says"
              subtitle="Plain English, zero jargon"
              icon={<FileText className="w-4 h-4" />}
              accent="orange"
            >
              <p
                className="text-sm leading-relaxed"
                style={{ color: "#4A3F35" }}
              >
                {result.plain_summary}
              </p>
            </ResultCard>
          </motion.div>

          <motion.div
            custom={1}
            variants={cardVariants}
            initial="hidden"
            animate="show"
          >
            <ResultCard
              title="Red Flags Found"
              subtitle={
                result.red_flags.length > 0
                  ? `${result.red_flags.length} issue${result.red_flags.length > 1 ? "s" : ""} detected`
                  : "Document reviewed"
              }
              icon={<AlertTriangle className="w-4 h-4" />}
              accent={result.red_flags.length > 0 ? "red" : "green"}
            >
              {result.red_flags.length === 0 ? (
                <div className="flex items-center gap-3 py-2">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center"
                    style={{
                      background: "#ECFDF5",
                      border: "1px solid rgba(5,150,105,0.2)",
                    }}
                  >
                    <CheckCircle className="w-5 h-5" style={{ color: "#059669" }} />
                  </div>
                  <div>
                    <p
                      className="font-semibold text-sm"
                      style={{ color: "#18130E" }}
                    >
                      No major red flags found
                    </p>
                    <p className="text-xs" style={{ color: "#A89484" }}>
                      This document appears straightforward.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {result.red_flags
                    .sort(
                      (a, b) =>
                        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
                    )
                    .map((flag, i) => (
                      <RedFlagItem key={i} flag={flag} index={i} />
                    ))}
                </div>
              )}
            </ResultCard>
          </motion.div>
        </div>

        <motion.div
          custom={2}
          variants={cardVariants}
          initial="hidden"
          animate="show"
          className="mb-5"
        >
          <ResultCard
            title="Your Response Letter"
            subtitle="Ready to send — fill in the bracketed fields"
            icon={<Mail className="w-4 h-4" />}
            accent="blue"
          >
            <ResponseLetter letter={result.response_letter} />
          </ResultCard>
        </motion.div>

        <motion.div
          custom={3}
          variants={cardVariants}
          initial="hidden"
          animate="show"
          className="mb-10"
        >
          <ResultCard
            title="Your Next Steps"
            subtitle="Ranked by likelihood of success"
            icon={<ArrowRight className="w-4 h-4" />}
            accent="green"
          >
            <div className="space-y-2">
              {result.next_steps
                .sort((a, b) => a.priority - b.priority)
                .map((step, i) => (
                  <NextStepItem key={i} step={step} index={i} />
                ))}
            </div>
          </ResultCard>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-3"
        >
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => router.push("/")}
            className="flex items-center gap-2 px-6 py-3 rounded-2xl border text-sm font-semibold transition-all"
            style={{
              borderColor: "#E8E2D9",
              color: "#4A3F35",
              background: "white",
            }}
          >
            <RotateCcw className="w-4 h-4" /> Analyze Another Document
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => router.push("/dashboard")}
            className="flex items-center gap-2 px-6 py-3 rounded-2xl text-sm font-semibold"
            style={{
              background: "#FEF0E6",
              color: "#C4530F",
              border: "1px solid rgba(232,101,26,0.2)",
            }}
          >
            <LayoutDashboard className="w-4 h-4" /> View Dashboard
          </motion.button>
        </motion.div>

        <p
          className="text-center text-xs mt-8"
          style={{ color: "#CFC8BE" }}
        >
          This is not legal advice. ClearDoc provides general information only.
        </p>
      </div>
    </div>
  )
}
