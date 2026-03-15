"use client"

import { useState, useEffect, useRef, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import UploadZone from "@/components/ui/UploadZone"
import AuthModal from "@/components/ui/AuthModal"
import PricingModal from "@/components/ui/PricingModal"
import { useAuth } from "@/context/AuthContext"
import { ArrowRight, Shield, FileText, AlertTriangle, Mail, ChevronRight } from "lucide-react"

const USE_CASES = [
  "Insurance denial letters",
  "Medical bills",
  "Eviction notices",
  "Visa rejections",
  "IRS letters",
  "Legal notices",
  "Debt collection letters",
  "Bank disputes",
]

const SOCIAL_PROOF = [
  { label: "Insurance companies", icon: "🏥" },
  { label: "Landlords & property managers", icon: "🏠" },
  { label: "Hospitals & billing depts", icon: "💊" },
  { label: "Government agencies", icon: "🏛️" },
  { label: "Debt collectors", icon: "💳" },
]

function HomeContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, profile } = useAuth()

  const [file, setFile] = useState<File | null>(null)
  const [context, setContext] = useState("")
  const [showAuth, setShowAuth] = useState(false)
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signup")
  const [showPricing, setShowPricing] = useState(false)
  const [useCaseIndex, setUseCaseIndex] = useState(0)
  const pendingAnalysis = useRef(false)

  useEffect(() => {
    const timer = setInterval(() => {
      setUseCaseIndex((i) => (i + 1) % USE_CASES.length)
    }, 2500)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const authParam = searchParams.get("auth")
    if (authParam === "signin") {
      setAuthMode("signin")
      setShowAuth(true)
    } else if (authParam === "signup") {
      setAuthMode("signup")
      setShowAuth(true)
    }
  }, [searchParams])

  const handleAnalyze = async () => {
    if (!file) return

    if (!user) {
      pendingAnalysis.current = true
      setAuthMode("signup")
      setShowAuth(true)
      return
    }

    if (profile && profile.plan !== "pro" && profile.freeUsesRemaining <= 0) {
      setShowPricing(true)
      return
    }

    const arrayBuffer = await file.arrayBuffer()
    const uint8 = new Uint8Array(arrayBuffer)
    const base64 = btoa(String.fromCharCode(...Array.from(uint8)))

    sessionStorage.setItem(
      "pendingAnalysis",
      JSON.stringify({
        fileName: file.name,
        fileType: file.type,
        fileBase64: base64,
        context,
      })
    )
    router.push("/analyze")
  }

  const handleAuthSuccess = () => {
    setShowAuth(false)
    if (pendingAnalysis.current && file) {
      pendingAnalysis.current = false
      setTimeout(handleAnalyze, 300)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Background glows */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[900px] h-[600px] bg-amber-400/5 rounded-full blur-[120px]" />
        <div className="absolute top-[10%] right-[-10%] w-[500px] h-[500px] bg-red-500/3 rounded-full blur-[100px]" />
        <div className="absolute bottom-0 left-[-10%] w-[400px] h-[400px] bg-blue-500/3 rounded-full blur-[100px]" />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
            backgroundSize: "60px 60px",
          }}
        />
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-20">
        {/* Hero */}
        <div className="text-center mb-12">
          <div
            className="inline-flex items-center gap-2 bg-amber-400/10 border border-amber-400/20 text-amber-400 text-xs font-semibold px-3 py-1.5 rounded-full mb-8"
            style={{ fontFamily: "var(--font-syne, sans-serif)" }}
          >
            <Shield className="w-3 h-3" />
            AI-powered · Consumer rights · Free to start
          </div>

          <h1
            className="text-5xl sm:text-6xl lg:text-7xl font-black text-white leading-[1.05] mb-6"
            style={{ fontFamily: "var(--font-syne, sans-serif)" }}
          >
            They sent you a
            <br />
            <span className="relative inline-block">
              <span className="text-amber-400">document.</span>
            </span>
            <br />
            <span className="text-white">Now fight back.</span>
          </h1>

          <p className="text-lg text-slate-400 max-w-2xl mx-auto mb-4 leading-relaxed">
            Upload any scary official document. Get{" "}
            <span className="text-slate-200">plain English</span>,{" "}
            <span className="text-slate-200">red flags</span>, a{" "}
            <span className="text-slate-200">ready-to-send response letter</span>, and your{" "}
            <span className="text-slate-200">exact next steps</span>. Instantly.
          </p>

          <div className="flex items-center justify-center gap-2 text-sm text-slate-600 mb-12 h-6 overflow-hidden">
            <span>Works on:</span>
            <span className="text-amber-400/80 font-medium">
              {USE_CASES[useCaseIndex]}
            </span>
          </div>
        </div>

        {/* Upload card */}
        <div className="bg-[#0F1117] border border-white/8 rounded-3xl p-6 sm:p-8 shadow-2xl mb-8 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-400/30 to-transparent" />

          <UploadZone
            file={file}
            onFileSelect={setFile}
            onClear={() => setFile(null)}
          />

          <div className="mt-4">
            <input
              type="text"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder='What is this document about? (optional) — e.g. "Insurance denied my surgery"'
              className="w-full bg-white/[0.03] border border-white/8 rounded-xl px-4 py-3.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-400/40 transition-colors"
            />
          </div>

          <div className="mt-4">
            <button
              onClick={handleAnalyze}
              disabled={!file}
              className={`w-full flex items-center justify-center gap-2.5 font-bold text-base py-4 rounded-xl transition-all duration-200 ${
                file
                  ? "bg-amber-400 hover:bg-amber-300 text-black shadow-lg shadow-amber-400/20 hover:scale-[1.01]"
                  : "bg-white/5 text-slate-600 cursor-not-allowed border border-white/5"
              }`}
              style={{ fontFamily: "var(--font-syne, sans-serif)" }}
            >
              <Shield className="w-5 h-5" />
              Analyze My Document
              <ArrowRight className="w-4 h-4" />
            </button>

            <p className="text-center text-xs text-slate-600 mt-3">
              Your first analysis is free · No credit card required
            </p>
          </div>
        </div>

        {/* Feature grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-16">
          {[
            { icon: FileText, label: "Plain English", desc: "No jargon, ever" },
            { icon: AlertTriangle, label: "Red Flags", desc: "Illegal & suspicious tactics" },
            { icon: Mail, label: "Response Letter", desc: "Ready to send" },
            { icon: ChevronRight, label: "Next Steps", desc: "Ranked by impact" },
          ].map(({ icon: Icon, label, desc }) => (
            <div
              key={label}
              className="bg-white/[0.02] border border-white/5 rounded-xl p-4 text-center hover:border-white/10 transition-all"
            >
              <Icon className="w-5 h-5 text-amber-400 mx-auto mb-2" />
              <p className="text-white text-xs font-semibold mb-0.5" style={{ fontFamily: "var(--font-syne, sans-serif)" }}>{label}</p>
              <p className="text-slate-600 text-xs">{desc}</p>
            </div>
          ))}
        </div>

        {/* Social proof */}
        <div className="text-center">
          <p className="text-xs text-slate-600 mb-4 tracking-wider uppercase">
            Used by people fighting
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {SOCIAL_PROOF.map(({ label, icon }) => (
              <span
                key={label}
                className="flex items-center gap-1.5 bg-white/[0.03] border border-white/5 text-slate-400 text-xs px-3 py-1.5 rounded-full"
              >
                <span>{icon}</span>
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {showAuth && (
        <AuthModal
          mode={authMode}
          onClose={() => {
            setShowAuth(false)
            pendingAnalysis.current = false
          }}
          onSuccess={handleAuthSuccess}
        />
      )}
      {showPricing && <PricingModal onClose={() => setShowPricing(false)} />}
    </div>
  )
}

export default function HomePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0A0A0F]" />}>
      <HomeContent />
    </Suspense>
  )
}
