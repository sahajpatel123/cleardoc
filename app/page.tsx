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
  Star, ChevronDown, Zap, Lock, Clock, TrendingUp
} from "lucide-react"

/* ── animation helpers ─────────────────────────────────────────── */
const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number]

const fadeUp = {
  hidden: { opacity: 0, y: 32 },
  show: (i = 0) => ({
    opacity: 1, y: 0,
    transition: { duration: 0.65, delay: i * 0.1, ease: EASE },
  }),
}

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.1 } },
}

function InView({ children, className = "", delay = 0 }: {
  children: React.ReactNode; className?: string; delay?: number
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.65, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  )
}

/* ── document types rotating ───────────────────────────────────── */
const DOC_TYPES = [
  "insurance denial", "medical bill", "eviction notice",
  "IRS letter", "visa rejection", "debt collection", "legal threat", "bank dispute"
]

/* ── features ──────────────────────────────────────────────────── */
const FEATURES = [
  {
    icon: FileText, color: "#E8651A", bg: "#FEF0E6",
    title: "Plain English",
    desc: "We translate every clause, demand, and legal term into plain language you actually understand.",
    tag: "Instant clarity",
  },
  {
    icon: AlertTriangle, color: "#DC2626", bg: "#FEF2F2",
    title: "Red Flag Detection",
    desc: "Our AI flags illegal demands, manipulative language, and bluffs — with the exact sentence that triggered each flag.",
    tag: "AI-powered",
  },
  {
    icon: Mail, color: "#2563EB", bg: "#EFF6FF",
    title: "Response Letter",
    desc: "A firm, formal, ready-to-send letter referencing specific clauses, dates, and amounts from your document.",
    tag: "Copy & send",
  },
  {
    icon: TrendingUp, color: "#059669", bg: "#ECFDF5",
    title: "Ranked Next Steps",
    desc: "3–5 concrete actions ranked by likelihood of success, with free resources like legal aid and state agencies.",
    tag: "Actionable",
  },
]

/* ── steps ─────────────────────────────────────────────────────── */
const STEPS = [
  { n: "01", title: "Upload your document", desc: "PDF, PNG, or JPG — any official document up to 10MB." },
  { n: "02", title: "Add optional context", desc: "A sentence about the situation helps our AI focus on what matters most." },
  { n: "03", title: "Get your full analysis", desc: "Plain English summary, red flags, response letter, and next steps in under 30 seconds." },
]

/* ── use-case pills ─────────────────────────────────────────────── */
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

/* ── floating doc card ──────────────────────────────────────────── */
function DocCard({ style, delay, severity, lines }: {
  style?: React.CSSProperties; delay?: number
  severity: "high" | "medium" | "low"
  lines: string[]
}) {
  const colors = { high: "#DC2626", medium: "#D97706", low: "#2563EB" }
  const bgs   = { high: "#FEF2F2", medium: "#FFFBEB", low: "#EFF6FF" }
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay: delay ?? 0, ease: EASE }}
      style={style}
      className="absolute pointer-events-none"
    >
      <div
        className="premium-card p-4 w-56 select-none"
        style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(12px)" }}
      >
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 rounded-full flex items-center justify-center"
            style={{ background: bgs[severity] }}>
            <AlertTriangle className="w-3 h-3" style={{ color: colors[severity] }} />
          </div>
          <span className="text-xs font-bold uppercase tracking-wider"
            style={{ color: colors[severity] }}>
            {severity} severity
          </span>
        </div>
        {lines.map((l, i) => (
          <div key={i} className="h-2 rounded-full mb-1.5"
            style={{
              background: i === 0 ? "#E8E2D9" : "#F2EDE6",
              width: i === 0 ? "90%" : i === 1 ? "70%" : "55%",
            }} />
        ))}
      </div>
    </motion.div>
  )
}

/* ── main component ─────────────────────────────────────────────── */
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
  const [prevIdx, setPrevIdx] = useState<number | null>(null)
  const pendingAnalysis = useRef(false)

  const { scrollY } = useScroll()
  const heroY = useTransform(scrollY, [0, 500], [0, -60])
  const heroOpacity = useTransform(scrollY, [0, 300], [1, 0.6])

  useEffect(() => {
    const t = setInterval(() => {
      setPrevIdx(docTypeIdx)
      setDocTypeIdx(i => (i + 1) % DOC_TYPES.length)
    }, 2800)
    return () => clearInterval(t)
  }, [docTypeIdx])

  useEffect(() => {
    const p = searchParams.get("auth")
    if (p === "signin" || p === "signup") {
      setAuthMode(p)
      setShowAuth(true)
    }
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
    if (pendingAnalysis.current && file) {
      pendingAnalysis.current = false
      setTimeout(handleAnalyze, 300)
    }
  }

  return (
    <div className="relative overflow-hidden" style={{ background: "var(--bg)" }}>

      {/* ── HERO ─────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-4 pt-20 pb-16 overflow-hidden">
        {/* Background layers */}
        <div className="absolute inset-0 mesh-gradient" />
        <div className="absolute inset-0 dot-grid opacity-40" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[600px] rounded-full"
          style={{ background: "radial-gradient(ellipse, rgba(232,101,26,0.07) 0%, transparent 70%)" }} />

        {/* Floating cards */}
        <div className="hidden lg:block">
          <div className="animate-float" style={{ position: "absolute", top: "22%", left: "6%", animationDelay: "0s" }}>
            <DocCard severity="high" delay={1.0}
              lines={["Illegal 72-hour notice", "Missing signature", ""]} />
          </div>
          <div className="animate-float-b" style={{ position: "absolute", top: "30%", right: "5%", animationDelay: "0.3s" }}>
            <DocCard severity="medium" delay={1.3}
              lines={["Unusual clause #14", "Waiver of rights", ""]} />
          </div>
          <div className="animate-float" style={{ position: "absolute", bottom: "20%", left: "8%", animationDelay: "0.6s" }}>
            <DocCard severity="low" delay={1.6}
              lines={["Non-standard timeline", "", ""]} />
          </div>
        </div>

        {/* Hero content */}
        <motion.div style={{ y: heroY, opacity: heroOpacity }}
          className="relative z-10 text-center max-w-4xl mx-auto">
          <motion.div variants={stagger} initial="hidden" animate="show">
            {/* Eyebrow */}
            <motion.div variants={fadeUp} custom={0} className="flex justify-center mb-8">
              <span className="tag tag-orange flex items-center gap-1.5 py-1.5 px-4">
                <Zap className="w-3 h-3" />
                AI-powered consumer protection · Free to start
              </span>
            </motion.div>

            {/* Headline */}
            <motion.h1 variants={fadeUp} custom={1}
              className="text-5xl sm:text-6xl lg:text-[78px] font-black leading-[1.0] mb-6"
              style={{ fontFamily: "var(--font-syne,'Syne',sans-serif)", color: "#18130E" }}>
              They sent you a
              <br />
              <span className="relative inline-block">
                <span className="gradient-text-animated">document.</span>
                <motion.svg
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ duration: 1.2, delay: 1.2, ease: "easeOut" }}
                  className="absolute -bottom-2 left-0 w-full" viewBox="0 0 400 12" fill="none">
                  <motion.path d="M4 8 C80 3, 200 3, 396 8" stroke="#E8651A" strokeWidth="3"
                    strokeLinecap="round" fill="none" pathLength={1} />
                </motion.svg>
              </span>
              <br />
              Now fight back.
            </motion.h1>

            {/* Sub */}
            <motion.p variants={fadeUp} custom={2}
              className="text-lg sm:text-xl max-w-2xl mx-auto mb-4 leading-relaxed"
              style={{ color: "#6B5E52" }}>
              Upload any scary official document. Get plain English, red flags,
              a ready-to-send response letter, and your exact next steps.{" "}
              <strong style={{ color: "#18130E" }}>In 30 seconds.</strong>
            </motion.p>

            {/* Rotating doc type */}
            <motion.div variants={fadeUp} custom={3}
              className="flex items-center justify-center gap-2 mb-10 h-8 overflow-hidden">
              <span className="text-sm" style={{ color: "#A89484" }}>Works on:</span>
              <div className="relative h-8 overflow-hidden flex items-center">
                <AnimatePresence mode="wait">
                  <motion.span key={docTypeIdx}
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -20, opacity: 0 }}
                    transition={{ duration: 0.35, ease: EASE }}
                    className="text-sm font-semibold gradient-text block">
                    {DOC_TYPES[docTypeIdx]}
                  </motion.span>
                </AnimatePresence>
              </div>
            </motion.div>

            {/* CTAs */}
            <motion.div variants={fadeUp} custom={4} className="flex flex-col sm:flex-row gap-3 justify-center mb-12">
              <motion.button
                whileHover={{ scale: 1.03, y: -2 }}
                whileTap={{ scale: 0.97 }}
                onClick={scrollToUpload}
                className="btn-primary text-base"
              >
                <Shield className="w-5 h-5" />
                Analyze My Document
                <ArrowRight className="w-4 h-4" />
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={scrollToUpload}
                className="flex items-center justify-center gap-2 text-sm font-semibold px-6 py-3.5 rounded-2xl border transition-all"
                style={{
                  borderColor: "#E8E2D9", color: "#4A3F35",
                  background: "white",
                  boxShadow: "0 1px 4px rgba(24,19,14,0.05)"
                }}
              >
                See how it works
                <ChevronDown className="w-4 h-4" />
              </motion.button>
            </motion.div>

            {/* Trust strip */}
            <motion.div variants={fadeUp} custom={5} className="flex items-center justify-center gap-6 flex-wrap">
              {[
                { icon: Lock, text: "Secure & private" },
                { icon: Zap, text: "30-second results" },
                { icon: Star, text: "Free first analysis" },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "#A89484" }}>
                  <Icon className="w-3.5 h-3.5" style={{ color: "#E8651A" }} />
                  {text}
                </div>
              ))}
            </motion.div>
          </motion.div>
        </motion.div>

        {/* Scroll cue */}
        <motion.div
          animate={{ y: [0, 8, 0] }} transition={{ repeat: Infinity, duration: 1.8 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2"
        >
          <ChevronDown className="w-5 h-5" style={{ color: "#A89484" }} />
        </motion.div>
      </section>

      {/* ── USE CASES ────────────────────────────────────────────── */}
      <section className="py-10 border-y overflow-hidden" style={{ borderColor: "#E8E2D9", background: "white" }}>
        <InView>
          <p className="section-label text-center mb-6">Used by people fighting</p>
        </InView>
        <div className="flex gap-4 justify-center flex-wrap px-4">
          {USE_CASES.map(({ icon, label }, i) => (
            <InView key={label} delay={i * 0.05}>
              <motion.span
                whileHover={{ scale: 1.06, y: -2 }}
                className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium cursor-default transition-shadow hover:shadow-md"
                style={{
                  background: "#F9F6F1", border: "1px solid #E8E2D9",
                  color: "#4A3F35"
                }}
              >
                <span className="text-base">{icon}</span>
                {label}
              </motion.span>
            </InView>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────────── */}
      <section className="py-24 px-4">
        <div className="max-w-5xl mx-auto">
          <InView className="text-center mb-16">
            <p className="section-label mb-3">Simple process</p>
            <h2 className="text-4xl sm:text-5xl font-black" style={{ color: "#18130E" }}>
              From scared to prepared<br />
              <span className="gradient-text">in three steps</span>
            </h2>
          </InView>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {STEPS.map((s, i) => (
              <InView key={s.n} delay={i * 0.1}>
                <motion.div
                  whileHover={{ y: -6 }}
                  transition={{ type: "spring", stiffness: 300 }}
                  className="premium-card p-7 relative overflow-hidden group"
                >
                  {/* Step number watermark */}
                  <div className="absolute top-4 right-4 text-6xl font-black select-none transition-all duration-300 group-hover:scale-110"
                    style={{ color: "#F2EDE6", fontFamily: "var(--font-syne,'Syne',sans-serif)" }}>
                    {s.n}
                  </div>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4 transition-all duration-300 group-hover:scale-110"
                    style={{ background: "#FEF0E6" }}>
                    <span className="text-lg font-black" style={{ color: "#E8651A", fontFamily: "var(--font-syne,'Syne',sans-serif)" }}>
                      {i + 1}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold mb-2" style={{ color: "#18130E" }}>{s.title}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: "#6B5E52" }}>{s.desc}</p>

                  {/* Bottom accent */}
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300"
                    style={{ background: "linear-gradient(90deg, #E8651A, #FF8C42)" }} />
                </motion.div>
              </InView>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES ─────────────────────────────────────────────── */}
      <section className="py-24 px-4" style={{ background: "white" }}>
        <div className="max-w-6xl mx-auto">
          <InView className="text-center mb-16">
            <p className="section-label mb-3">What you get</p>
            <h2 className="text-4xl sm:text-5xl font-black" style={{ color: "#18130E" }}>
              Everything you need<br />
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
                    className="premium-card p-7 group cursor-default relative overflow-hidden"
                  >
                    {/* Hover glow */}
                    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                      style={{ background: `radial-gradient(ellipse 80% 60% at 30% 50%, ${f.bg}80 0%, transparent 70%)` }} />

                    <div className="relative z-10">
                      <div className="flex items-center justify-between mb-5">
                        <motion.div
                          whileHover={{ rotate: 8, scale: 1.15 }}
                          className="w-12 h-12 rounded-xl flex items-center justify-center"
                          style={{ background: f.bg }}
                        >
                          <Icon className="w-6 h-6" style={{ color: f.color }} />
                        </motion.div>
                        <span className="tag tag-warm text-xs">{f.tag}</span>
                      </div>
                      <h3 className="text-xl font-bold mb-2" style={{ color: "#18130E" }}>{f.title}</h3>
                      <p className="text-sm leading-relaxed" style={{ color: "#6B5E52" }}>{f.desc}</p>
                    </div>

                    <div className="absolute bottom-0 left-0 right-0 h-0.5 origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-400"
                      style={{ background: f.color }} />
                  </motion.div>
                </InView>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── UPLOAD ZONE ──────────────────────────────────────────── */}
      <section ref={uploadRef} id="upload" className="py-24 px-4">
        <div className="max-w-2xl mx-auto">
          <InView className="text-center mb-10">
            <p className="section-label mb-3">Try it now</p>
            <h2 className="text-4xl font-black mb-3" style={{ color: "#18130E" }}>
              Upload your document
            </h2>
            <p className="text-base" style={{ color: "#6B5E52" }}>
              Your first analysis is completely free. No credit card required.
            </p>
          </InView>

          <InView>
            <div className="premium-card p-7 relative overflow-hidden">
              {/* Top accent line */}
              <div className="absolute top-0 left-0 right-0 h-0.5"
                style={{ background: "linear-gradient(90deg, transparent, #E8651A, transparent)" }} />

              <UploadZone file={file} onFileSelect={setFile} onClear={() => setFile(null)} />

              <div className="mt-4">
                <input
                  type="text"
                  value={context}
                  onChange={e => setContext(e.target.value)}
                  placeholder='What is this document about? (optional) — e.g. "Insurance denied my surgery"'
                  className="input-field"
                />
              </div>

              <div className="mt-4">
                <motion.button
                  onClick={handleAnalyze}
                  disabled={!file}
                  whileHover={file ? { scale: 1.015, y: -2 } : {}}
                  whileTap={file ? { scale: 0.975 } : {}}
                  className={`w-full flex items-center justify-center gap-2.5 font-bold text-base py-4 rounded-2xl transition-all duration-200 ${
                    file
                      ? "btn-primary"
                      : "cursor-not-allowed"
                  }`}
                  style={!file ? {
                    background: "#F2EDE6", color: "#A89484",
                    border: "1px solid #E8E2D9",
                    boxShadow: "none"
                  } : {}}
                >
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

      {/* ── STATS STRIP ──────────────────────────────────────────── */}
      <section className="py-16 px-4 border-y" style={{ background: "#18130E", borderColor: "#2E261E" }}>
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-center">
            {[
              { value: "30s", label: "Average analysis time" },
              { value: "8+", label: "Document categories" },
              { value: "100%", label: "Private & secure" },
            ].map((s, i) => (
              <InView key={s.label} delay={i * 0.1}>
                <div>
                  <div className="text-5xl font-black mb-2 gradient-text" style={{ fontFamily: "var(--font-syne,'Syne',sans-serif)" }}>
                    {s.value}
                  </div>
                  <p className="text-sm" style={{ color: "#A89484" }}>{s.label}</p>
                </div>
              </InView>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING CTA ──────────────────────────────────────────── */}
      <section className="py-24 px-4" style={{ background: "white" }}>
        <div className="max-w-3xl mx-auto">
          <InView>
            <div className="premium-card p-10 text-center relative overflow-hidden">
              {/* Corner decoration */}
              <div className="absolute top-0 right-0 w-48 h-48 rounded-full -translate-y-1/2 translate-x-1/2 opacity-30"
                style={{ background: "radial-gradient(circle, #FEF0E6, transparent)" }} />
              <div className="relative z-10">
                <div className="w-14 h-14 rounded-2xl mx-auto mb-5 flex items-center justify-center"
                  style={{ background: "#FEF0E6" }}>
                  <Zap className="w-7 h-7" style={{ color: "#E8651A" }} />
                </div>
                <h2 className="text-3xl sm:text-4xl font-black mb-3" style={{ color: "#18130E" }}>
                  Ready for unlimited access?
                </h2>
                <p className="text-base mb-8" style={{ color: "#6B5E52" }}>
                  Upgrade to Pro for $9/month. Unlimited analyses, full features, cancel anytime.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <motion.a
                    href="/pricing"
                    whileHover={{ scale: 1.03, y: -2 }}
                    whileTap={{ scale: 0.97 }}
                    className="btn-primary"
                  >
                    <Shield className="w-5 h-5" />
                    Upgrade to Pro — $9/mo
                  </motion.a>
                  <motion.a
                    href="/pricing"
                    whileHover={{ scale: 1.02 }}
                    className="flex items-center justify-center gap-2 text-sm font-semibold px-6 py-3.5 rounded-2xl border"
                    style={{ borderColor: "#E8E2D9", color: "#4A3F35" }}
                  >
                    Compare plans
                  </motion.a>
                </div>
              </div>
            </div>
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
