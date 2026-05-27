"use client"

import { useEffect, useState, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/context/AuthContext"
import type { Analysis } from "@/lib/types"
import { isProUser } from "@/lib/user-plan"
import { getVerdictUi } from "@/lib/verdict-ui"
import { parseAnalysisResult } from "@/lib/validate-analysis"
import { motion, AnimatePresence } from "framer-motion"
import { Plus, ArrowUpRight, Sparkles } from "lucide-react"
import { Reveal, Counter } from "@/components/ui/Kinetic"
import { useBilling } from "@/hooks/useBilling"

function DashboardContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, profile, loading: authLoading, refreshProfile } = useAuth()
  const { openPortal, loading: portalLoading } = useBilling()
  const [analyses, setAnalyses] = useState<Analysis[]>([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [upgraded, setUpgraded] = useState(false)

  useEffect(() => {
    if (searchParams.get("upgraded") === "true") {
      queueMicrotask(() => setUpgraded(true))
      void refreshProfile()
    }
  }, [searchParams, refreshProfile])

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      router.push(`/login?redirect=${encodeURIComponent("/dashboard")}`)
      return
    }
    fetch("/api/analyses")
      .then((r) => (r.ok ? r.json() : Promise.resolve([])))
      .then((data: Analysis[]) => setAnalyses(Array.isArray(data) ? data : []))
      .finally(() => setLoadingHistory(false))
  }, [user, authLoading, router])

  if (authLoading) {
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

  const isPro = isProUser(
    profile
      ? { plan: profile.plan, subscriptionStatus: profile.subscriptionStatus }
      : null,
  )

  return (
    <div className="min-h-screen pt-32 pb-32">
      <div className="container-edition">
        <AnimatePresence>
          {upgraded && (
            <motion.div
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="mb-12 flex items-start gap-4 p-5 rounded-lg"
              style={{ background: "rgba(255,106,31,0.06)", border: "1px solid rgba(255,106,31,0.20)" }}
            >
              <Sparkles className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--ember)" }} />
              <div>
                <p
                  style={{
                    color: "var(--text)",
                    fontFamily: "var(--font-syne,'Syne',sans-serif)",
                    fontWeight: 500,
                    letterSpacing: "-0.02em",
                  }}
                >
                  Welcome to Pro.
                </p>
                <p className="text-sm mt-1" style={{ color: "var(--text-3)" }}>
                  You now have unlimited analyses.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <Reveal>
          <div className="flex items-baseline justify-between mb-10 gap-4 flex-wrap">
            <p className="eyebrow">Account · {user?.email}</p>
            <div className="flex items-center gap-3">
              {isPro && <span className="label label-ember">Pro</span>}
              {isPro && (
                <button
                  type="button"
                  onClick={() => void openPortal()}
                  disabled={portalLoading}
                  className="btn btn-ghost !py-2 !px-4 !text-[13px]"
                >
                  {portalLoading ? "Opening…" : "Manage subscription"}
                </button>
              )}
            </div>
          </div>
          <h1
            className="display max-w-[18ch] mb-6"
            style={{ fontSize: "clamp(2.4rem, 7vw, 6rem)", color: "var(--text)" }}
          >
            <span>Your </span>
            <span className="serif-italic" style={{ color: "var(--ember)" }}>desk.</span>
          </h1>
          <p className="max-w-md text-base" style={{ color: "var(--text-3)" }}>
            Every document you&apos;ve handed us, marked up and waiting for your next move.
          </p>
        </Reveal>

        {/* Stats row */}
        <div className="mt-20 grid grid-cols-2 md:grid-cols-3 gap-0 border-t border-l" style={{ borderColor: "var(--hairline-2)" }}>
          <Reveal>
            <div className="p-6 sm:p-8 border-b border-r min-h-[160px] flex flex-col justify-between" style={{ borderColor: "var(--hairline-2)" }}>
              <p className="mono text-[10px] tracking-[0.22em]" style={{ color: "var(--text-mute)" }}>PLAN</p>
              <p
                className="display"
                style={{
                  fontSize: "clamp(1.8rem, 3.5vw, 2.8rem)",
                  color: isPro ? "var(--ember)" : "var(--text)",
                }}
              >
                {isPro ? "Pro" : "Free"}
              </p>
              <p className="mono text-[10px]" style={{ color: "var(--text-3)" }}>
                {isPro ? "Unlimited" : `${profile?.freeUsesRemaining ?? 0} left`}
              </p>
            </div>
          </Reveal>
          <Reveal delay={0.05}>
            <div className="p-6 sm:p-8 border-b border-r min-h-[160px] flex flex-col justify-between" style={{ borderColor: "var(--hairline-2)" }}>
              <p className="mono text-[10px] tracking-[0.22em]" style={{ color: "var(--text-mute)" }}>ANALYZED</p>
              <p
                className="display"
                style={{ fontSize: "clamp(1.8rem, 3.5vw, 2.8rem)", color: "var(--text)" }}
              >
                <Counter to={analyses.length} />
              </p>
              <p className="mono text-[10px]" style={{ color: "var(--text-3)" }}>
                {analyses.length === 1 ? "document" : "documents"}
              </p>
            </div>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="p-6 sm:p-8 border-b border-r min-h-[160px] flex flex-col justify-between" style={{ borderColor: "var(--hairline-2)" }}>
              <p className="mono text-[10px] tracking-[0.22em]" style={{ color: "var(--text-mute)" }}>STATUS</p>
              <p
                className="display"
                style={{ fontSize: "clamp(1.8rem, 3.5vw, 2.8rem)", color: "var(--text)" }}
              >
                {isPro ? profile?.subscriptionStatus ?? "active" : "free"}
              </p>
              <p className="mono text-[10px]" style={{ color: "var(--text-3)" }}>
                {isPro ? "subscription" : "tier"}
              </p>
            </div>
          </Reveal>
        </div>

        {/* Upgrade prompt */}
        <AnimatePresence>
          {!isPro && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-12 p-6 sm:p-8 flex flex-col sm:flex-row sm:items-end justify-between gap-6 border"
              style={{
                borderColor: "var(--hairline-2)",
                background: "rgba(255,106,31,0.03)",
              }}
            >
              <div>
                <p className="eyebrow mb-3">Upgrade</p>
                <h3
                  className="display"
                  style={{ fontSize: "clamp(1.4rem, 2.4vw, 2rem)", color: "var(--text)" }}
                >
                  Unlimited analyses, <span className="serif-italic" style={{ color: "var(--ember)" }}>$9/month.</span>
                </h3>
                <p className="text-sm mt-2 max-w-md" style={{ color: "var(--text-3)" }}>
                  Cancel anytime. No hidden fees.
                </p>
              </div>
              <Link href="/pricing" className="btn btn-primary shrink-0">
                Upgrade
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </motion.div>
          )}
        </AnimatePresence>

        {/* History */}
        <div className="mt-24">
          <div className="flex items-baseline justify-between mb-10">
            <p className="eyebrow">History</p>
            <Link href="/" className="btn btn-ghost !py-2 !px-4 !text-[13px]">
              <Plus className="w-4 h-4" /> New analysis
            </Link>
          </div>

          {loadingHistory ? (
            <div className="py-16 flex justify-center">
              <motion.span
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.6, repeat: Infinity }}
                className="mono text-[11px] tracking-[0.3em]"
                style={{ color: "var(--text-3)" }}
              >
                LOADING
              </motion.span>
            </div>
          ) : analyses.length === 0 ? (
            <div
              className="py-20 text-center border"
              style={{ borderColor: "var(--hairline-2)", borderStyle: "dashed" }}
            >
              <p
                className="display mb-3"
                style={{ fontSize: "clamp(1.4rem, 2.4vw, 2rem)", color: "var(--text-2)" }}
              >
                Nothing here yet.
              </p>
              <p className="text-sm mb-8" style={{ color: "var(--text-3)" }}>
                Upload your first document to begin.
              </p>
              <Link href="/" className="btn btn-primary">
                <Plus className="w-4 h-4" /> Analyze your first document
              </Link>
            </div>
          ) : (
            <div className="border-t" style={{ borderColor: "var(--hairline-2)" }}>
              {analyses.map((analysis, idx) => {
                const ar = parseAnalysisResult(analysis.result)
                if (!ar) return null
                const vc = getVerdictUi(ar.overall_verdict)
                const VIcon = vc.Icon
                return (
                  <motion.div
                    key={analysis.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: idx * 0.04 }}
                    onClick={() => router.push(`/analyze/${analysis.id}`)}
                    className="group cursor-pointer py-5 px-2 border-b flex items-baseline gap-5 transition-colors"
                    style={{ borderColor: "var(--hairline-2)" }}
                  >
                    <span
                      className="mono text-[10px] tracking-[0.2em] shrink-0"
                      style={{ color: "var(--text-mute)" }}
                    >
                      {String(analyses.length - idx).padStart(2, "0")}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p
                        className="truncate group-hover:text-white transition-colors"
                        style={{
                          color: "var(--text)",
                          fontFamily: "var(--font-syne,'Syne',sans-serif)",
                          fontWeight: 500,
                          letterSpacing: "-0.025em",
                          fontSize: 18,
                        }}
                      >
                        {analysis.documentName}
                      </p>
                      <p className="mono text-[10px] mt-1" style={{ color: "var(--text-mute)" }}>
                        {analysis.documentType && analysis.documentType !== "Unknown"
                          ? `${analysis.documentType.toUpperCase()} · `
                          : ""}
                        {analysis.caseId ? "CASE · " : ""}
                        {new Date(analysis.createdAt).toLocaleDateString("en-US", {
                          month: "short", day: "numeric", year: "numeric",
                        }).toUpperCase()}
                      </p>
                    </div>
                    <span className={`label ${vc.labelClass} shrink-0 hidden sm:inline-flex`}>
                      <VIcon className="w-3 h-3" /> {vc.label}
                    </span>
                    <ArrowUpRight
                      className="w-4 h-4 shrink-0 opacity-50 group-hover:opacity-100 transition-opacity"
                      style={{ color: "var(--text-3)" }}
                    />
                  </motion.div>
                )
              })}
            </div>
          )}
        </div>

        {analyses.length > 0 && (
          <p className="mt-12 mono text-[10px] tracking-[0.2em]" style={{ color: "var(--text-mute)" }}>
            ANALYSIS RESULTS SAVED TO YOUR ACCOUNT · UPLOADED FILES NOT STORED
          </p>
        )}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <DashboardContent />
    </Suspense>
  )
}
