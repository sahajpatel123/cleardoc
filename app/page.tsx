"use client"

import { useState, useEffect, useRef, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { motion, useScroll, useTransform, AnimatePresence } from "framer-motion"
import UploadZone from "@/components/ui/UploadZone"
import AuthModal from "@/components/ui/AuthModal"
import PricingModal from "@/components/ui/PricingModal"
import { useAuth } from "@/context/AuthContext"
import {
  ArrowRight, Shield, FileText, AlertTriangle, Mail, CheckCircle,
  Star, ChevronDown, Zap, Lock, Clock, TrendingUp, XCircle, AlertCircle,
} from "lucide-react"

/* ── constants ──────────────────────────────────────────────────────────── */
const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number]

const DOC_TYPES = [
  "insurance denial", "medical bill", "eviction notice",
  "IRS letter", "visa rejection", "debt collection", "legal threat", "bank dispute"
]

const FEATURES = [
  {
    icon: FileText, color: "#E8651A", bg: "#FEF0E6",
    title: "Plain English",
    desc: "Every clause, demand, and legal term explained like a friend would — zero jargon.",
    tag: "Instant clarity",
  },
  {
    icon: AlertTriangle, color: "#DC2626", bg: "#FEF2F2",
    title: "Red Flag Detection",
    desc: "Illegal demands, manipulation tactics, and bluffs flagged with the exact sentence that triggered each.",
    tag: "AI-powered",
  },
  {
    icon: Mail, color: "#2563EB", bg: "#EFF6FF",
    title: "Response Letter",
    desc: "A firm, formal, ready-to-send letter referencing specific clauses and amounts from your document.",
    tag: "Copy & send",
  },
  {
    icon: TrendingUp, color: "#059669", bg: "#ECFDF5",
    title: "Ranked Next Steps",
    desc: "3–5 concrete actions ranked by success likelihood, with free resources like legal aid.",
    tag: "Actionable",
  },
]

const STEPS = [
  { n: "01", title: "Upload your document", desc: "PDF, PNG, or JPG — any official document up to 10MB." },
  { n: "02", title: "Add optional context", desc: "A sentence about the situation helps our AI focus on what matters most." },
  { n: "03", title: "Get your full analysis", desc: "Plain English, red flags, response letter, and next steps in under 30 seconds." },
]

const USE_CASES = [
  { icon: "🏥", label: "Insurance denials" },
  { icon: "🏠", label: "Landlord disputes" },
  { icon: "💊", label: "Medical bills" },
  { icon: "🏛️", label: "IRS letters" },
  { icon: "✈️", label: "Visa rejections" },
  { icon: "💳", label: "Debt collection" },
  { icon: "⚖️", label: "Legal notices" },
  { icon: "🏦", label: "Bank disputes" },
]

/* ── animation helpers ──────────────────────────────────────────────────── */
function InView({ children, className = "", delay = 0 }: {
  children: React.ReactNode; className?: string; delay?: number
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.6, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  )
}

/* ── Analysis Preview Panel (hero right side) ───────────────────────────── */
function AnalysisPreview() {
  const flags = [
    { sev: "high"   as const, issue: "Illegal 72-hour notice",      expl: "State law requires minimum 30 days written notice." },
    { sev: "medium" as const, issue: "Missing required signature",   expl: "Document lacks legally required notarization." },
    { sev: "low"    as const, issue: "Non-standard payment clause",  expl: "This clause differs from industry norms." },
  ]
  const sevCfg = {
    high:   { Icon: XCircle,     color: "#DC2626", bg: "#FEF2F2", border: "rgba(220,38,38,0.2)",  label: "HIGH" },
    medium: { Icon: AlertCircle, color: "#D97706", bg: "#FFFBEB", border: "rgba(217,119,6,0.2)",  label: "MED" },
    low:    { Icon: AlertTriangle,color: "#2563EB", bg: "#EFF6FF", border: "rgba(37,99,235,0.2)",  label: "LOW" },
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 40, y: 10 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ duration: 0.9, delay: 0.5, ease: EASE }}
      className="relative w-full max-w-[440px] mx-auto lg:mx-0"
    >
      {/* Glow behind card */}
      <div className="absolute -inset-6 rounded-3xl pointer-events-none"
        style={{ background: "radial-gradient(ellipse 80% 70% at 50% 50%, rgba(232,101,26,0.12) 0%, transparent 70%)" }} />

      {/* Main preview card */}
      <div className="relative rounded-3xl border overflow-hidden"
        style={{
          background: "white",
          borderColor: "#E8E2D9",
          boxShadow: "0 24px 80px rgba(24,19,14,0.12), 0 0 0 1px rgba(24,19,14,0.04)"
        }}>
        {/* Card top bar */}
        <div className="px-5 py-4 border-b flex items-center justify-between"
          style={{ background: "#FAFAF8", borderColor: "#F2EDE6" }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: "#FEF0E6", border: "1px solid rgba(232,101,26,0.2)" }}>
              <FileText className="w-4 h-4" style={{ color: "#E8651A" }} />
            </div>
            <div>
              <p className="text-xs font-bold" style={{ color: "#18130E" }}>eviction-notice.pdf</p>
              <p className="text-[10px]" style={{ color: "#A89484" }}>Analysis complete · 12s</p>
            </div>
          </div>
          {/* Verdict badge */}
          <div className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full border"
            style={{ background: "#FFFBEB", borderColor: "rgba(217,119,6,0.25)", color: "#D97706" }}>
            <AlertCircle className="w-3 h-3" /> Suspicious
          </div>
        </div>

        {/* Red flags list */}
        <div className="p-4 space-y-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: "#A89484" }}>
            Red Flags Detected
          </p>
          {flags.map(({ sev, issue, expl }, i) => {
            const c = sevCfg[sev]
            const Icon = c.Icon
            return (
              <motion.div key={i}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, delay: 0.8 + i * 0.15, ease: EASE }}
                className="flex items-start gap-3 rounded-xl p-3 border"
                style={{ background: c.bg, borderColor: c.border }}>
                <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                  style={{ background: "white", border: `1px solid ${c.border}` }}>
                  <Icon className="w-3 h-3" style={{ color: c.color }} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <p className="text-xs font-bold" style={{ color: "#18130E" }}>{issue}</p>
                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded"
                      style={{ background: c.color, color: "white", letterSpacing: "0.05em" }}>
                      {c.label}
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed" style={{ color: "#6B5E52" }}>{expl}</p>
                </div>
              </motion.div>
            )
          })}
        </div>

        {/* Letter preview strip */}
        <div className="mx-4 mb-4 rounded-xl border p-3"
          style={{ background: "#F9F6F1", borderColor: "#E8E2D9" }}>
          <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "#A89484" }}>
            Response Letter Ready
          </p>
          <div className="space-y-1.5">
            {["Dear [Landlord Name],", "I am writing to formally dispute…", "[Your signature]"].map((t, i) => (
              <div key={i} className="h-2 rounded-full"
                style={{
                  background: i === 1 ? "#E8E2D9" : "#D0C8BF",
                  width: i === 0 ? "60%" : i === 1 ? "85%" : "35%"
                }} />
            ))}
          </div>
        </div>

        {/* Next steps */}
        <div className="px-4 pb-4">
          <div className="rounded-xl border p-3" style={{ background: "#ECFDF5", borderColor: "rgba(5,150,105,0.2)" }}>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 shrink-0" style={{ color: "#059669" }} />
              <p className="text-xs font-semibold" style={{ color: "#065F46" }}>
                3 next steps identified — ranked by success rate
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Floating accent badge — positioned relative to card */}
      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        className="absolute -top-4 -right-4 flex items-center gap-2 rounded-2xl px-4 py-2.5 border"
        style={{
          background: "white",
          borderColor: "#E8E2D9",
          boxShadow: "0 8px 24px rgba(24,19,14,0.1)"
        }}>
        <div className="w-7 h-7 rounded-full flex items-center justify-center"
          style={{ background: "#FEF0E6" }}>
          <Zap className="w-3.5 h-3.5" style={{ color: "#E8651A" }} />
        </div>
        <div>
          <p className="text-xs font-black" style={{ color: "#18130E" }}>Ready in 12s</p>
          <p className="text-[10px]" style={{ color: "#A89484" }}>AI-powered</p>
        </div>
      </motion.div>

      {/* Bottom left shield badge */}
      <motion.div
        animate={{ y: [0, 5, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
        className="absolute -bottom-4 -left-4 flex items-center gap-2 rounded-2xl px-4 py-2.5 border"
        style={{
          background: "white",
          borderColor: "#E8E2D9",
          boxShadow: "0 8px 24px rgba(24,19,14,0.1)"
        }}>
        <div className="w-7 h-7 rounded-full flex items-center justify-center"
          style={{ background: "#ECFDF5" }}>
          <Shield className="w-3.5 h-3.5" style={{ color: "#059669" }} />
        </div>
        <div>
          <p className="text-xs font-black" style={{ color: "#18130E" }}>100% Private</p>
          <p className="text-[10px]" style={{ color: "#A89484" }}>Deleted after 30d</p>
        </div>
      </motion.div>
    </motion.div>
  )
}

/* ── Main ───────────────────────────────────────────────────────────────── */
function HomeContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, profile } = useAuth()
  const uploadRef = useRef<HTMLDivElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [context, setContext] = useState("")
  const [showAuth, setShowAuth] = useState(false)
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signup")
  const [showPricing, setShowPricing] = useState(false)
  const [docTypeIdx, setDocTypeIdx] = useState(0)
  const pendingAnalysis = useRef(false)

  const { scrollY } = useScroll()
  const heroParallax = useTransform(scrollY, [0, 500], [0, -40])

  useEffect(() => {
    const t = setInterval(() => {
      setDocTypeIdx(i => (i + 1) % DOC_TYPES.length)
    }, 2600)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const p = searchParams.get("auth")
    if (p === "signin" || p === "signup") { setAuthMode(p); setShowAuth(true) }
  }, [searchParams])

  const scrollToUpload = () => {
    uploadRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
  }

  const handleAnalyze = async () => {
    if (!file) return
    if (!user) { pendingAnalysis.current = true; setAuthMode("signup"); setShowAuth(true); return }
    if (profile && profile.plan !== "pro" && profile.freeUsesRemaining <= 0) { setShowPricing(true); return }
    const ab = await file.arrayBuffer()
    const u8 = new Uint8Array(ab)
    const b64 = btoa(String.fromCharCode(...Array.from(u8)))
    sessionStorage.setItem("pendingAnalysis", JSON.stringify({
      fileName: file.name, fileType: file.type, fileBase64: b64, context
    }))
    router.push("/analyze")
  }

  const handleAuthSuccess = () => {
    setShowAuth(false)
    if (pendingAnalysis.current && file) { pendingAnalysis.current = false; setTimeout(handleAnalyze, 300) }
  }

  return (
    <div style={{ background: "#FAFAF8", minHeight: "100vh" }}>

      {/* ─── HERO ────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex items-center pt-16 pb-8 overflow-hidden">
        {/* Soft radial bg blobs */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-0 right-0 w-[700px] h-[700px] rounded-full opacity-50"
            style={{ background: "radial-gradient(circle, rgba(232,101,26,0.07) 0%, transparent 65%)", transform: "translate(20%, -20%)" }} />
          <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full opacity-40"
            style={{ background: "radial-gradient(circle, rgba(232,101,26,0.05) 0%, transparent 65%)", transform: "translate(-20%, 20%)" }} />
          {/* Subtle dot grid */}
          <div className="absolute inset-0 opacity-[0.35]"
            style={{
              backgroundImage: "radial-gradient(circle, rgba(24,19,14,0.08) 1px, transparent 1px)",
              backgroundSize: "24px 24px"
            }} />
        </div>

        <motion.div style={{ y: heroParallax }}
          className="relative z-10 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">

            {/* ── LEFT: Copy ── */}
            <div className="text-center lg:text-left">
              {/* Eyebrow */}
              <motion.div
                initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: EASE }}
                className="inline-flex items-center gap-2 rounded-full px-4 py-2 mb-7 border"
                style={{ background: "#FEF0E6", borderColor: "rgba(232,101,26,0.25)", color: "#C4530F" }}>
                <Zap className="w-3.5 h-3.5" />
                <span className="text-xs font-bold tracking-wide">AI-powered consumer protection · Free to start</span>
              </motion.div>

              {/* Headline */}
              <motion.h1
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.1, ease: EASE }}
                className="font-black leading-[1.05] tracking-tight mb-6"
                style={{
                  fontSize: "clamp(2.6rem, 5vw, 4.5rem)",
                  fontFamily: "var(--font-syne,'Syne',sans-serif)",
                  color: "#18130E"
                }}>
                They sent you a
                <br />
                <span className="relative inline-block">
                  <span className="gradient-text-animated">document.</span>
                  {/* Underline SVG */}
                  <motion.svg
                    initial={{ pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: 1, opacity: 1 }}
                    transition={{ duration: 1.0, delay: 0.9, ease: "easeOut" }}
                    className="absolute -bottom-1 left-0 w-full overflow-visible"
                    viewBox="0 0 300 10" fill="none" preserveAspectRatio="none">
                    <motion.path d="M2 7 C60 2, 150 2, 298 7"
                      stroke="#E8651A" strokeWidth="2.5" strokeLinecap="round" fill="none" pathLength={1} />
                  </motion.svg>
                </span>
                <br />
                Now fight back.
              </motion.h1>

              {/* Sub */}
              <motion.p
                initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.2, ease: EASE }}
                className="text-lg leading-relaxed mb-4 max-w-xl lg:max-w-none"
                style={{ color: "#6B5E52" }}>
                Upload any scary official document. Get plain English, red flags, a ready-to-send response letter, and your exact next steps.{" "}
                <span className="font-bold" style={{ color: "#18130E" }}>In 30 seconds.</span>
              </motion.p>

              {/* Rotating doc type */}
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                transition={{ delay: 0.35 }}
                className="flex items-center gap-2 mb-8 justify-center lg:justify-start h-7 overflow-hidden">
                <span className="text-sm" style={{ color: "#A89484" }}>Works on:</span>
                <div className="relative h-7 overflow-hidden flex items-center">
                  <AnimatePresence mode="wait">
                    <motion.span key={docTypeIdx}
                      initial={{ y: 18, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: -18, opacity: 0 }}
                      transition={{ duration: 0.3, ease: EASE }}
                      className="text-sm font-bold gradient-text block whitespace-nowrap">
                      {DOC_TYPES[docTypeIdx]}
                    </motion.span>
                  </AnimatePresence>
                </div>
              </motion.div>

              {/* CTAs */}
              <motion.div
                initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.3, ease: EASE }}
                className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start mb-8">
                <motion.button
                  whileHover={{ scale: 1.03, y: -2 }} whileTap={{ scale: 0.97 }}
                  onClick={scrollToUpload}
                  className="btn-primary text-base">
                  <Shield className="w-5 h-5" />
                  Analyze My Document
                  <ArrowRight className="w-4 h-4" />
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                  onClick={scrollToUpload}
                  className="flex items-center justify-center gap-2 text-sm font-semibold px-6 py-3.5 rounded-2xl border transition-all"
                  style={{ borderColor: "#E8E2D9", color: "#4A3F35", background: "white", boxShadow: "0 1px 4px rgba(24,19,14,0.05)" }}>
                  See how it works <ChevronDown className="w-4 h-4" />
                </motion.button>
              </motion.div>

              {/* Trust strip */}
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="flex items-center gap-5 flex-wrap justify-center lg:justify-start">
                {[
                  { icon: Lock,  text: "Secure & private" },
                  { icon: Zap,   text: "30-second results" },
                  { icon: Star,  text: "Free first analysis" },
                ].map(({ icon: Icon, text }) => (
                  <div key={text} className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "#A89484" }}>
                    <Icon className="w-3.5 h-3.5" style={{ color: "#E8651A" }} />
                    {text}
                  </div>
                ))}
              </motion.div>
            </div>

            {/* ── RIGHT: Analysis Preview ── */}
            <div className="flex justify-center lg:justify-end">
              <div className="relative py-8 px-4">
                <AnalysisPreview />
              </div>
            </div>

          </div>
        </motion.div>

        {/* Scroll cue */}
        <motion.div
          animate={{ y: [0, 7, 0] }} transition={{ repeat: Infinity, duration: 1.8 }}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10">
          <ChevronDown className="w-5 h-5" style={{ color: "#CFC8BE" }} />
        </motion.div>
      </section>

      {/* ─── USE CASES STRIP ─────────────────────────────────────────── */}
      <section className="py-10 border-y overflow-hidden" style={{ borderColor: "#E8E2D9", background: "white" }}>
        <InView>
          <p className="section-label text-center mb-6">Used by people fighting</p>
        </InView>
        <div className="flex gap-3 justify-center flex-wrap px-4">
          {USE_CASES.map(({ icon, label }, i) => (
            <InView key={label} delay={i * 0.04}>
              <motion.span
                whileHover={{ scale: 1.05, y: -2 }}
                className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium cursor-default"
                style={{ background: "#F9F6F1", border: "1px solid #E8E2D9", color: "#4A3F35",
                  transition: "box-shadow 0.2s" }}
                onHoverStart={e => (e.target as HTMLElement).style.boxShadow = "0 4px 12px rgba(24,19,14,0.08)"}
                onHoverEnd={e => (e.target as HTMLElement).style.boxShadow = "none"}>
                <span className="text-base">{icon}</span>
                {label}
              </motion.span>
            </InView>
          ))}
        </div>
      </section>

      {/* ─── HOW IT WORKS ────────────────────────────────────────────── */}
      <section className="py-24 px-4" style={{ background: "#FAFAF8" }}>
        <div className="max-w-5xl mx-auto">
          <InView className="text-center mb-16">
            <p className="section-label mb-3">Simple process</p>
            <h2 className="text-4xl sm:text-5xl font-black" style={{ color: "#18130E", fontFamily: "var(--font-syne,'Syne',sans-serif)" }}>
              From scared to prepared
              <br />
              <span className="gradient-text">in three steps</span>
            </h2>
          </InView>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {STEPS.map((s, i) => (
              <InView key={s.n} delay={i * 0.1}>
                <motion.div
                  whileHover={{ y: -6 }}
                  transition={{ type: "spring", stiffness: 300 }}
                  className="premium-card p-7 relative overflow-hidden group cursor-default">
                  {/* Large step number watermark */}
                  <div className="absolute top-3 right-4 text-7xl font-black select-none"
                    style={{ color: "#F2EDE6", fontFamily: "var(--font-syne,'Syne',sans-serif)", lineHeight: 1 }}>
                    {s.n}
                  </div>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                    style={{ background: "#FEF0E6", border: "1px solid rgba(232,101,26,0.2)" }}>
                    <span className="text-base font-black" style={{ color: "#E8651A", fontFamily: "var(--font-syne,'Syne',sans-serif)" }}>
                      {i + 1}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold mb-2" style={{ color: "#18130E", fontFamily: "var(--font-syne,'Syne',sans-serif)" }}>{s.title}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: "#6B5E52" }}>{s.desc}</p>
                  {/* Bottom accent bar */}
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300"
                    style={{ background: "linear-gradient(90deg, #E8651A, #FF8C42)" }} />
                </motion.div>
              </InView>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FEATURES ────────────────────────────────────────────────── */}
      <section className="py-24 px-4" style={{ background: "white" }}>
        <div className="max-w-6xl mx-auto">
          <InView className="text-center mb-16">
            <p className="section-label mb-3">What you get</p>
            <h2 className="text-4xl sm:text-5xl font-black" style={{ color: "#18130E", fontFamily: "var(--font-syne,'Syne',sans-serif)" }}>
              Everything you need
              <br />
              <span className="gradient-text">to fight back</span>
            </h2>
          </InView>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {FEATURES.map((f, i) => {
              const Icon = f.icon
              return (
                <InView key={f.title} delay={i * 0.08}>
                  <motion.div
                    whileHover={{ y: -6, scale: 1.01 }}
                    transition={{ type: "spring", stiffness: 280 }}
                    className="premium-card p-7 group cursor-default relative overflow-hidden">
                    {/* Hover glow */}
                    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                      style={{ background: `radial-gradient(ellipse 80% 60% at 30% 50%, ${f.bg}CC 0%, transparent 70%)` }} />
                    <div className="relative z-10">
                      <div className="flex items-center justify-between mb-5">
                        <motion.div
                          whileHover={{ rotate: 8, scale: 1.12 }}
                          className="w-12 h-12 rounded-xl flex items-center justify-center border"
                          style={{ background: f.bg, borderColor: `${f.color}30` }}>
                          <Icon className="w-6 h-6" style={{ color: f.color }} />
                        </motion.div>
                        <span className="tag tag-warm text-xs">{f.tag}</span>
                      </div>
                      <h3 className="text-xl font-bold mb-2" style={{ color: "#18130E", fontFamily: "var(--font-syne,'Syne',sans-serif)" }}>{f.title}</h3>
                      <p className="text-sm leading-relaxed" style={{ color: "#6B5E52" }}>{f.desc}</p>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300"
                      style={{ background: f.color }} />
                  </motion.div>
                </InView>
              )
            })}
          </div>
        </div>
      </section>

      {/* ─── UPLOAD ZONE ─────────────────────────────────────────────── */}
      <section ref={uploadRef} id="upload" className="py-24 px-4" style={{ background: "#FAFAF8" }}>
        <div className="max-w-2xl mx-auto">
          <InView className="text-center mb-10">
            <p className="section-label mb-3">Try it now — free</p>
            <h2 className="text-4xl font-black mb-3" style={{ color: "#18130E", fontFamily: "var(--font-syne,'Syne',sans-serif)" }}>
              Upload your document
            </h2>
            <p className="text-base" style={{ color: "#6B5E52" }}>
              Your first analysis is completely free. No credit card required.
            </p>
          </InView>

          <InView>
            <div className="premium-card p-7 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-0.5"
                style={{ background: "linear-gradient(90deg, transparent, #E8651A, transparent)" }} />
              <UploadZone file={file} onFileSelect={setFile} onClear={() => setFile(null)} />
              <div className="mt-4">
                <input
                  type="text" value={context}
                  onChange={e => setContext(e.target.value)}
                  placeholder='Optional context — e.g. "Insurance denied my surgery claim"'
                  className="input-field"
                />
              </div>
              <div className="mt-4">
                <motion.button
                  onClick={handleAnalyze} disabled={!file}
                  whileHover={file ? { scale: 1.015, y: -2 } : {}}
                  whileTap={file ? { scale: 0.975 } : {}}
                  className={`w-full flex items-center justify-center gap-2.5 font-bold text-base py-4 rounded-2xl transition-all duration-200 ${file ? "btn-primary" : "cursor-not-allowed"}`}
                  style={!file ? { background: "#F2EDE6", color: "#A89484", border: "1px solid #E8E2D9", boxShadow: "none" } : {}}>
                  <Shield className="w-5 h-5" />
                  Analyze My Document
                  <ArrowRight className="w-4 h-4" />
                </motion.button>
                <p className="text-center text-xs mt-3" style={{ color: "#A89484" }}>
                  🔒 Secure · Private · Deleted after 30 days
                </p>
              </div>
            </div>
          </InView>
        </div>
      </section>

      {/* ─── STATS STRIP ─────────────────────────────────────────────── */}
      <section className="py-16 px-4 border-y" style={{ background: "#18130E", borderColor: "#2E261E" }}>
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-center">
            {[
              { value: "30s",  label: "Average analysis time" },
              { value: "8+",   label: "Document categories" },
              { value: "100%", label: "Private & secure" },
            ].map((s, i) => (
              <InView key={s.label} delay={i * 0.1}>
                <div>
                  <div className="text-5xl font-black mb-2 gradient-text"
                    style={{ fontFamily: "var(--font-syne,'Syne',sans-serif)" }}>
                    {s.value}
                  </div>
                  <p className="text-sm" style={{ color: "#A89484" }}>{s.label}</p>
                </div>
              </InView>
            ))}
          </div>
        </div>
      </section>

      {/* ─── PRICING CTA ─────────────────────────────────────────────── */}
      <section className="py-24 px-4" style={{ background: "white" }}>
        <div className="max-w-3xl mx-auto">
          <InView>
            <motion.div
              whileHover={{ y: -4 }}
              className="premium-card p-10 text-center relative overflow-hidden">
              <div className="absolute top-0 right-0 w-56 h-56 rounded-full -translate-y-1/3 translate-x-1/3 pointer-events-none"
                style={{ background: "radial-gradient(circle, rgba(232,101,26,0.08), transparent)" }} />
              <div className="absolute bottom-0 left-0 w-48 h-48 rounded-full translate-y-1/3 -translate-x-1/3 pointer-events-none"
                style={{ background: "radial-gradient(circle, rgba(232,101,26,0.05), transparent)" }} />
              <div className="relative z-10">
                <div className="w-14 h-14 rounded-2xl mx-auto mb-5 flex items-center justify-center border"
                  style={{ background: "#FEF0E6", borderColor: "rgba(232,101,26,0.2)" }}>
                  <Zap className="w-7 h-7" style={{ color: "#E8651A" }} />
                </div>
                <h2 className="text-3xl sm:text-4xl font-black mb-3"
                  style={{ color: "#18130E", fontFamily: "var(--font-syne,'Syne',sans-serif)" }}>
                  Ready for unlimited access?
                </h2>
                <p className="text-base mb-8" style={{ color: "#6B5E52" }}>
                  Upgrade to Pro for $9/month. Unlimited analyses, full features, cancel anytime.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <motion.a href="/pricing" whileHover={{ scale: 1.03, y: -2 }} whileTap={{ scale: 0.97 }}
                    className="btn-primary">
                    <Zap className="w-5 h-5" />
                    Upgrade to Pro — $9/mo
                  </motion.a>
                  <motion.a href="/pricing" whileHover={{ scale: 1.02 }}
                    className="flex items-center justify-center gap-2 text-sm font-semibold px-6 py-3.5 rounded-2xl border transition-all"
                    style={{ borderColor: "#E8E2D9", color: "#4A3F35", background: "transparent" }}>
                    Compare plans
                  </motion.a>
                </div>
              </div>
            </motion.div>
          </InView>
        </div>
      </section>

      {/* Modals */}
      <AnimatePresence>
        {showAuth && (
          <AuthModal mode={authMode}
            onClose={() => { setShowAuth(false); pendingAnalysis.current = false }}
            onSuccess={handleAuthSuccess} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showPricing && <PricingModal onClose={() => setShowPricing(false)} />}
      </AnimatePresence>
    </div>
  )
}

export default function HomePage() {
  return (
    <Suspense fallback={<div className="min-h-screen" style={{ background: "#FAFAF8" }} />}>
      <HomeContent />
    </Suspense>
  )
}
