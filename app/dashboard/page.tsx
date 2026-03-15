"use client"

import { useEffect, useState, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/context/AuthContext"
import { getUserAnalyses } from "@/lib/firestore"
import type { Analysis } from "@/lib/types"
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
} from "lucide-react"

const VERDICT_CONFIG = {
  legitimate: { label: "Legitimate", icon: CheckCircle, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
  suspicious: { label: "Suspicious", icon: AlertCircle, color: "text-amber-400", bg: "bg-amber-400/10 border-amber-400/20" },
  likely_illegal: { label: "Likely Illegal", icon: XCircle, color: "text-red-400", bg: "bg-red-500/10 border-red-500/20" },
}

function DashboardContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, profile, loading: authLoading } = useAuth()
  const [analyses, setAnalyses] = useState<Analysis[]>([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [upgraded, setUpgraded] = useState(false)

  useEffect(() => {
    if (searchParams.get("upgraded") === "true") {
      setUpgraded(true)
    }
  }, [searchParams])

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      router.push("/")
      return
    }
    getUserAnalyses(user.uid)
      .then(setAnalyses)
      .finally(() => setLoadingHistory(false))
  }, [user, authLoading])

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#0A0A0F] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
      </div>
    )
  }

  const isPro = profile?.plan === "pro"

  return (
    <div className="relative min-h-screen bg-[#0A0A0F]">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-amber-400/3 rounded-full blur-[80px]" />
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {/* Upgraded banner */}
        {upgraded && (
          <div className="mb-6 flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl px-5 py-4">
            <Sparkles className="w-5 h-5 text-emerald-400 shrink-0" />
            <div>
              <p className="text-emerald-400 font-semibold text-sm">Welcome to ClearDoc Pro!</p>
              <p className="text-slate-400 text-xs">You now have unlimited document analyses.</p>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="mb-8">
          <p className="text-xs text-slate-600 uppercase tracking-wider mb-1">Your account</p>
          <h1 className="text-3xl font-black text-white" style={{ fontFamily: "var(--font-syne, sans-serif)" }}>
            Dashboard
          </h1>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {/* Plan card */}
          <div className={`rounded-2xl border p-5 ${isPro ? "bg-amber-400/5 border-amber-400/20" : "bg-white/[0.02] border-white/5"}`}>
            <div className="flex items-center gap-2 mb-3">
              {isPro ? <Zap className="w-4 h-4 text-amber-400" /> : <Shield className="w-4 h-4 text-slate-400" />}
              <span className="text-xs text-slate-500 uppercase tracking-wider">Plan</span>
            </div>
            <p className={`text-xl font-bold ${isPro ? "text-amber-400" : "text-white"}`}>
              {isPro ? "Pro" : "Free"}
            </p>
            <p className="text-xs text-slate-600 mt-1">
              {isPro ? "Unlimited analyses" : `${profile?.freeUsesRemaining ?? 0} analysis remaining`}
            </p>
          </div>

          {/* Analyses count */}
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-4 h-4 text-slate-400" />
              <span className="text-xs text-slate-500 uppercase tracking-wider">Analyses</span>
            </div>
            <p className="text-xl font-bold text-white">{analyses.length}</p>
            <p className="text-xs text-slate-600 mt-1">Documents analyzed</p>
          </div>

          {/* Email */}
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-slate-400" />
              <span className="text-xs text-slate-500 uppercase tracking-wider">Account</span>
            </div>
            <p className="text-sm font-medium text-white truncate">{user?.email}</p>
            <p className="text-xs text-slate-600 mt-1">
              {isPro ? `Status: ${profile?.subscriptionStatus}` : "Free tier"}
            </p>
          </div>
        </div>

        {/* Upgrade CTA (free users) */}
        {!isPro && (
          <div className="mb-8 bg-gradient-to-r from-amber-400/10 to-orange-400/5 border border-amber-400/20 rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
            <div>
              <h3 className="text-white font-bold mb-1" style={{ fontFamily: "var(--font-syne, sans-serif)" }}>Upgrade to Pro</h3>
              <p className="text-slate-400 text-sm">Unlimited analyses for $9/month. Cancel anytime.</p>
            </div>
            <Link
              href="/pricing"
              className="shrink-0 flex items-center gap-2 bg-amber-400 text-black font-bold px-5 py-2.5 rounded-xl hover:bg-amber-300 transition-all text-sm"
            >
              <Zap className="w-4 h-4" />
              Upgrade Now
            </Link>
          </div>
        )}

        {/* Analysis history */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-white" style={{ fontFamily: "var(--font-syne, sans-serif)" }}>
              Analysis History
            </h2>
            <Link
              href="/"
              className="flex items-center gap-1.5 text-sm text-amber-400 hover:text-amber-300 transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Analysis
            </Link>
          </div>

          {loadingHistory ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
            </div>
          ) : analyses.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-white/10 rounded-2xl">
              <FileText className="w-10 h-10 text-slate-700 mx-auto mb-3" />
              <p className="text-slate-500 mb-4">No analyses yet.</p>
              <Link
                href="/"
                className="inline-flex items-center gap-2 bg-amber-400 text-black font-bold px-5 py-2.5 rounded-xl hover:bg-amber-300 transition-all text-sm"
              >
                <Shield className="w-4 h-4" />
                Analyze Your First Document
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {analyses.map((analysis) => {
                const verdict = VERDICT_CONFIG[analysis.result.overall_verdict]
                const VIcon = verdict.icon
                return (
                  <div
                    key={analysis.id}
                    className="group flex items-center gap-4 bg-[#0F1117] border border-white/5 hover:border-white/10 rounded-2xl p-4 transition-all cursor-pointer"
                    onClick={() => router.push(`/analyze/${analysis.id}`)}
                  >
                    <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/5 flex items-center justify-center shrink-0">
                      <FileText className="w-5 h-5 text-slate-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-medium text-sm truncate">{analysis.documentName}</p>
                      <p className="text-slate-600 text-xs mt-0.5">
                        {analysis.documentType && analysis.documentType !== "Unknown" ? `${analysis.documentType} · ` : ""}
                        {new Date(analysis.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                    <div className={`hidden sm:flex items-center gap-1.5 text-xs font-medium border rounded-lg px-2.5 py-1 ${verdict.bg} ${verdict.color}`}>
                      <VIcon className="w-3 h-3" />
                      {verdict.label}
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-700 group-hover:text-slate-400 transition-colors shrink-0" />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0A0A0F]" />}>
      <DashboardContent />
    </Suspense>
  )
}
