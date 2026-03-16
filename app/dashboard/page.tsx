"use client"

import { useEffect, useState, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/context/AuthContext"
import { getUserAnalyses } from "@/lib/firestore"
import type { Analysis } from "@/lib/types"
import { motion, AnimatePresence } from "framer-motion"
import {
  Shield,
  FileText,
  Clock,
  Zap,
  CheckCircle,
  AlertCircle,
  XCircle,
  Plus,
  ChevronRight,
  Sparkles,
  LayoutDashboard,
  User,
} from "lucide-react"

const VERDICT_CONFIG = {
  legitimate:    { label: "Legitimate",   Icon: CheckCircle, bg: "#ECFDF5", border: "rgba(5,150,105,0.2)",  text: "#059669" },
  suspicious:    { label: "Suspicious",   Icon: AlertCircle, bg: "#FFFBEB", border: "rgba(217,119,6,0.2)",  text: "#D97706" },
  likely_illegal:{ label: "Likely Illegal",Icon: XCircle,    bg: "#FEF2F2", border: "rgba(220,38,38,0.2)",  text: "#DC2626" },
}

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  show: (i: number) => ({
    opacity: 1, y: 0,
    transition: { duration: 0.5, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] as [number,number,number,number] },
  }),
}

function DashboardContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, profile, loading: authLoading } = useAuth()
  const [analyses, setAnalyses] = useState<Analysis[]>([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [upgraded, setUpgraded] = useState(false)

  useEffect(() => {
    if (searchParams.get("upgraded") === "true") setUpgraded(true)
  }, [searchParams])

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.push("/"); return }
    getUserAnalyses(user.uid)
      .then(setAnalyses)
      .finally(() => setLoadingHistory(false))
  }, [user, authLoading, router])

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#FAFAF8" }}>
        <div className="w-8 h-8 rounded-full border-2 animate-spin"
          style={{ borderColor: "rgba(232,101,26,0.2)", borderTopColor: "#E8651A" }} />
      </div>
    )
  }

  const isPro = profile?.plan === "pro"

  return (
    <div style={{ background: "#FAFAF8", minHeight: "100vh" }}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">

        {/* Upgraded banner */}
        <AnimatePresence>
          {upgraded && (
            <motion.div
              initial={{ opacity: 0, y: -12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12 }}
              className="mb-6 flex items-center gap-3 rounded-2xl px-5 py-4 border"
              style={{ background: "#ECFDF5", borderColor: "rgba(5,150,105,0.25)" }}
            >
              <Sparkles className="w-5 h-5 shrink-0" style={{ color: "#059669" }} />
              <div>
                <p className="font-bold text-sm" style={{ color: "#059669" }}>Welcome to ClearDoc Pro!</p>
                <p className="text-xs mt-0.5" style={{ color: "#6B5E52" }}>You now have unlimited document analyses.</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }} className="mb-8">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 rounded-xl border"
              style={{ background: "#FEF0E6", borderColor: "rgba(232,101,26,0.2)" }}>
              <LayoutDashboard className="w-4 h-4" style={{ color: "#E8651A" }} />
            </div>
            <p className="section-label">Your account</p>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black mt-2"
            style={{ color: "#18130E", fontFamily: "var(--font-syne,'Syne',sans-serif)" }}>
            Dashboard
          </h1>
        </motion.div>

        {/* Stats row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {/* Plan card */}
          <motion.div custom={0} variants={cardVariants} initial="hidden" animate="show"
            className="premium-card p-5"
            style={isPro ? { background: "#FEF0E6", borderColor: "rgba(232,101,26,0.3)" } : {}}>
            <div className="flex items-center gap-2 mb-3">
              {isPro
                ? <Zap className="w-4 h-4" style={{ color: "#E8651A" }} />
                : <Shield className="w-4 h-4" style={{ color: "#A89484" }} />
              }
              <span className="section-label !text-[10px]">Plan</span>
            </div>
            <p className="text-2xl font-black" style={{ color: isPro ? "#E8651A" : "#18130E" }}>
              {isPro ? "Pro" : "Free"}
            </p>
            <p className="text-xs mt-1" style={{ color: "#6B5E52" }}>
              {isPro ? "Unlimited analyses" : `${profile?.freeUsesRemaining ?? 0} analysis remaining`}
            </p>
            {isPro && (
              <div className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full"
                style={{ background: "rgba(232,101,26,0.15)", color: "#C4530F" }}>
                <CheckCircle className="w-3 h-3" /> Active
              </div>
            )}
          </motion.div>

          {/* Analyses count */}
          <motion.div custom={1} variants={cardVariants} initial="hidden" animate="show"
            className="premium-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-4 h-4" style={{ color: "#A89484" }} />
              <span className="section-label !text-[10px]">Analyses</span>
            </div>
            <p className="text-2xl font-black" style={{ color: "#18130E" }}>{analyses.length}</p>
            <p className="text-xs mt-1" style={{ color: "#6B5E52" }}>Documents analyzed</p>
          </motion.div>

          {/* Account */}
          <motion.div custom={2} variants={cardVariants} initial="hidden" animate="show"
            className="premium-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <User className="w-4 h-4" style={{ color: "#A89484" }} />
              <span className="section-label !text-[10px]">Account</span>
            </div>
            <p className="text-sm font-semibold truncate" style={{ color: "#18130E" }}>{user?.email}</p>
            <p className="text-xs mt-1" style={{ color: "#6B5E52" }}>
              {isPro ? `Status: ${profile?.subscriptionStatus}` : "Free tier"}
            </p>
          </motion.div>
        </div>

        {/* Upgrade CTA (free users) */}
        <AnimatePresence>
          {!isPro && (
            <motion.div
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              className="mb-8 rounded-2xl border p-6 flex flex-col sm:flex-row sm:items-center gap-4 justify-between overflow-hidden relative"
              style={{ background: "#FEF0E6", borderColor: "rgba(232,101,26,0.25)" }}
            >
              {/* Subtle bg pattern */}
              <div className="absolute right-0 top-0 bottom-0 w-48 pointer-events-none"
                style={{ background: "linear-gradient(90deg, transparent, rgba(232,101,26,0.06))" }} />
              <div className="relative">
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="w-4 h-4" style={{ color: "#E8651A" }} />
                  <h3 className="font-bold" style={{ color: "#18130E", fontFamily: "var(--font-syne,'Syne',sans-serif)" }}>
                    Upgrade to Pro
                  </h3>
                </div>
                <p className="text-sm" style={{ color: "#6B5E52" }}>Unlimited analyses for $9/month. Cancel anytime.</p>
              </div>
              <Link href="/pricing">
                <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                  className="relative shrink-0 flex items-center gap-2 font-bold px-5 py-2.5 rounded-xl text-sm cursor-pointer"
                  style={{ background: "#E8651A", color: "white", boxShadow: "0 4px 14px rgba(232,101,26,0.35)" }}>
                  <Zap className="w-4 h-4" /> Upgrade Now
                </motion.div>
              </Link>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Analysis history */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold" style={{ color: "#18130E", fontFamily: "var(--font-syne,'Syne',sans-serif)" }}>
              Analysis History
            </h2>
            <Link href="/">
              <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl border cursor-pointer transition-all"
                style={{ borderColor: "#E8E2D9", color: "#E8651A", background: "white" }}>
                <Plus className="w-4 h-4" /> New Analysis
              </motion.div>
            </Link>
          </div>

          {loadingHistory ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 rounded-full border-2 animate-spin"
                style={{ borderColor: "rgba(232,101,26,0.2)", borderTopColor: "#E8651A" }} />
            </div>
          ) : analyses.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
              className="text-center py-16 rounded-2xl border-2 border-dashed"
              style={{ borderColor: "#E8E2D9" }}>
              <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center border"
                style={{ background: "#F2EDE6", borderColor: "#E8E2D9" }}>
                <FileText className="w-6 h-6" style={{ color: "#A89484" }} />
              </div>
              <p className="font-semibold mb-1" style={{ color: "#18130E" }}>No analyses yet</p>
              <p className="text-sm mb-6" style={{ color: "#A89484" }}>Upload your first document to get started</p>
              <Link href="/">
                <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                  className="inline-flex items-center gap-2 font-bold px-5 py-2.5 rounded-xl text-sm cursor-pointer"
                  style={{ background: "#E8651A", color: "white", boxShadow: "0 4px 14px rgba(232,101,26,0.35)" }}>
                  <Shield className="w-4 h-4" /> Analyze Your First Document
                </motion.div>
              </Link>
            </motion.div>
          ) : (
            <div className="space-y-3">
              {analyses.map((analysis, idx) => {
                const vc = VERDICT_CONFIG[analysis.result.overall_verdict]
                const VIcon = vc.Icon
                return (
                  <motion.div
                    key={analysis.id}
                    custom={idx}
                    variants={cardVariants}
                    initial="hidden"
                    animate="show"
                    whileHover={{ y: -2, boxShadow: "0 8px 24px rgba(24,19,14,0.08)" }}
                    className="group flex items-center gap-4 rounded-2xl border p-4 cursor-pointer transition-all"
                    style={{ background: "white", borderColor: "#E8E2D9" }}
                    onClick={() => router.push(`/analyze/${analysis.id}`)}
                  >
                    <div className="w-10 h-10 rounded-xl border flex items-center justify-center shrink-0"
                      style={{ background: "#F2EDE6", borderColor: "#E8E2D9" }}>
                      <FileText className="w-5 h-5" style={{ color: "#A89484" }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate" style={{ color: "#18130E" }}>
                        {analysis.documentName}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: "#A89484" }}>
                        {analysis.documentType && analysis.documentType !== "Unknown"
                          ? `${analysis.documentType} · ` : ""}
                        {new Date(analysis.createdAt).toLocaleDateString("en-US", {
                          month: "short", day: "numeric", year: "numeric",
                        })}
                      </p>
                    </div>
                    <div className="hidden sm:flex items-center gap-1.5 text-xs font-semibold border rounded-lg px-2.5 py-1"
                      style={{ background: vc.bg, borderColor: vc.border, color: vc.text }}>
                      <VIcon className="w-3 h-3" />
                      {vc.label}
                    </div>
                    <motion.div
                      className="shrink-0"
                      animate={{ x: 0 }}
                      whileHover={{ x: 2 }}
                    >
                      <ChevronRight className="w-4 h-4 transition-colors"
                        style={{ color: "#CFC8BE" }} />
                    </motion.div>
                  </motion.div>
                )
              })}
            </div>
          )}
        </motion.div>

        {/* Bottom clock note */}
        {analyses.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}
            className="flex items-center justify-center gap-2 mt-8">
            <Clock className="w-3.5 h-3.5" style={{ color: "#CFC8BE" }} />
            <p className="text-xs" style={{ color: "#CFC8BE" }}>Documents stored for 30 days</p>
          </motion.div>
        )}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" style={{ background: "#FAFAF8" }} />}>
      <DashboardContent />
    </Suspense>
  )
}
