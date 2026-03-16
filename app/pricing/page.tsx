"use client"

import { useState } from "react"
import { useAuth } from "@/context/AuthContext"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import {
  Shield,
  Check,
  Zap,
  FileText,
  AlertTriangle,
  Mail,
  ArrowRight,
  ChevronRight,
  Sparkles,
  X,
} from "lucide-react"
import AuthModal from "@/components/ui/AuthModal"

const FREE_FEATURES = [
  "1 document analysis",
  "Plain English summary",
  "Red flag detection",
  "Response letter draft",
  "Next steps guide",
]

const PRO_FEATURES = [
  "Unlimited document analyses",
  "Full red flag detection",
  "Ready-to-send response letters",
  "Priority AI processing",
  "Analysis history & dashboard",
  "All document types supported",
  "Cancel anytime",
]

const FAQ = [
  {
    q: "What types of documents can I upload?",
    a: "Any official document: insurance denial letters, medical bills, eviction notices, visa rejections, IRS letters, debt collection letters, legal notices, bank dispute letters, and more. If it's official and intimidating, ClearDoc can help.",
  },
  {
    q: "Is this actually legal advice?",
    a: "No — ClearDoc is a general information tool, not a law firm. Our AI gives you a starting point to understand your situation and respond. For serious legal matters, also consult a licensed attorney (we'll often suggest free legal aid resources in your next steps).",
  },
  {
    q: "How accurate is the AI analysis?",
    a: "Our AI is trained to identify common red flags, illegal clauses, and manipulation tactics used in official documents. It's highly accurate for pattern recognition, but always read the analysis critically and verify specific legal claims with a professional.",
  },
  {
    q: "What happens to my uploaded documents?",
    a: "Your documents are processed securely and never shared. We don't use your documents to train AI models. Documents are automatically deleted from our servers after 30 days.",
  },
  {
    q: "Can I cancel my Pro subscription?",
    a: "Yes, anytime. Cancel from your account settings and you'll retain Pro access until the end of your billing period. No cancellation fees.",
  },
]

const FEATURES_DETAIL = [
  {
    icon: FileText,
    title: "Plain English Summary",
    desc: "What the document actually says, explained like a friend would.",
    accent: "orange",
  },
  {
    icon: AlertTriangle,
    title: "Red Flag Detection",
    desc: "Illegal demands, manipulation tactics, and suspicious clauses — named explicitly.",
    accent: "red",
  },
  {
    icon: Mail,
    title: "Response Letter",
    desc: "A formal, assertive letter ready to send — with your details filled in.",
    accent: "blue",
  },
  {
    icon: ArrowRight,
    title: "Next Steps",
    desc: "3-5 ranked actions with free resources and realistic expectations.",
    accent: "green",
  },
]

const accentMap = {
  orange: { iconBg: "#FEF0E6", iconColor: "#E8651A", border: "rgba(232,101,26,0.2)", glow: "rgba(232,101,26,0.08)" },
  red:    { iconBg: "#FEF2F2", iconColor: "#DC2626", border: "rgba(220,38,38,0.2)",  glow: "rgba(220,38,38,0.06)" },
  blue:   { iconBg: "#EFF6FF", iconColor: "#2563EB", border: "rgba(37,99,235,0.2)",  glow: "rgba(37,99,235,0.06)" },
  green:  { iconBg: "#ECFDF5", iconColor: "#059669", border: "rgba(5,150,105,0.2)",  glow: "rgba(5,150,105,0.06)" },
}

const cardVariants = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number) => ({
    opacity: 1, y: 0,
    transition: { duration: 0.5, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
  }),
}

function InView({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  )
}

export default function PricingPage() {
  const router = useRouter()
  const { user, profile } = useAuth()
  const [loading, setLoading] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  const handleUpgrade = async () => {
    if (!user) { setShowAuth(true); return }
    setLoading(true)
    try {
      const token = await user.getIdToken()
      const res = await fetch("/api/stripe/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: token }),
      })
      const data = await res.json()
      if (data.url) window.location.href = data.url
    } catch {
      alert("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  const isPro = profile?.plan === "pro"

  return (
    <div style={{ background: "#FAFAF8", minHeight: "100vh" }}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16">

        {/* Header */}
        <InView>
          <div className="text-center mb-16">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1, type: "spring", stiffness: 300 }}
              className="inline-flex items-center gap-2 rounded-full px-4 py-2 mb-6 border"
              style={{ background: "#FEF0E6", borderColor: "rgba(232,101,26,0.25)", color: "#E8651A" }}>
              <Shield className="w-3.5 h-3.5" />
              <span className="text-xs font-bold tracking-wide">Simple, honest pricing</span>
            </motion.div>
            <h1 className="text-4xl sm:text-5xl font-black mb-4 leading-tight"
              style={{ color: "#18130E", fontFamily: "var(--font-syne,'Syne',sans-serif)" }}>
              Everyone deserves someone{" "}
              <span className="gradient-text">smart in their corner</span>
            </h1>
            <p className="text-lg max-w-xl mx-auto" style={{ color: "#6B5E52" }}>
              Start free. Upgrade when you need more.
            </p>
          </div>
        </InView>

        {/* Pricing cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-20 max-w-3xl mx-auto">
          {/* Free */}
          <motion.div custom={0} variants={cardVariants} initial="hidden" whileInView="show"
            viewport={{ once: true }}
            whileHover={{ y: -4, boxShadow: "0 16px 40px rgba(24,19,14,0.08)" }}
            className="premium-card p-6 flex flex-col">
            <div className="mb-6">
              <p className="section-label mb-2">Free forever</p>
              <div className="flex items-end gap-1">
                <span className="text-5xl font-black" style={{ color: "#18130E" }}>$0</span>
                <span className="mb-2 text-sm" style={{ color: "#A89484" }}>/month</span>
              </div>
              <p className="text-xs mt-1" style={{ color: "#A89484" }}>No credit card required</p>
            </div>

            <ul className="space-y-3 mb-6 flex-1">
              {FREE_FEATURES.map((f, i) => (
                <motion.li key={f} initial={{ opacity: 0, x: -8 }} whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }} transition={{ delay: 0.1 + i * 0.05 }}
                  className="flex items-center gap-2.5 text-sm" style={{ color: "#4A3F35" }}>
                  <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0 border"
                    style={{ background: "#F2EDE6", borderColor: "#E8E2D9" }}>
                    <Check className="w-2.5 h-2.5" style={{ color: "#A89484" }} />
                  </div>
                  {f}
                </motion.li>
              ))}
            </ul>

            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
              onClick={() => router.push("/")}
              className="w-full border py-3 rounded-2xl text-sm font-semibold transition-all"
              style={{ borderColor: "#E8E2D9", color: "#4A3F35", background: "white" }}>
              Get started free
            </motion.button>
          </motion.div>

          {/* Pro */}
          <motion.div custom={1} variants={cardVariants} initial="hidden" whileInView="show"
            viewport={{ once: true }}
            whileHover={{ y: -4, boxShadow: "0 20px 50px rgba(232,101,26,0.18)" }}
            className="relative rounded-2xl border p-6 flex flex-col overflow-hidden"
            style={{ background: "#FEF0E6", borderColor: "rgba(232,101,26,0.35)" }}>
            {/* Top accent line */}
            <div className="absolute top-0 left-0 right-0 h-0.5"
              style={{ background: "linear-gradient(90deg, transparent, #E8651A, transparent)" }} />

            {/* Most popular badge */}
            <div className="absolute top-4 right-4">
              <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.4, type: "spring" }}
                className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full border"
                style={{ background: "#E8651A", color: "white", borderColor: "transparent",
                  boxShadow: "0 2px 10px rgba(232,101,26,0.4)" }}>
                <Sparkles className="w-3 h-3" /> POPULAR
              </motion.div>
            </div>

            <div className="mb-6">
              <p className="section-label mb-2" style={{ color: "#C4530F" }}>Pro plan</p>
              <div className="flex items-end gap-1">
                <span className="text-5xl font-black" style={{ color: "#18130E" }}>$9</span>
                <span className="mb-2 text-sm" style={{ color: "#A89484" }}>/month</span>
              </div>
              <p className="text-xs mt-1" style={{ color: "#A89484" }}>Cancel anytime</p>
            </div>

            <ul className="space-y-3 mb-6 flex-1">
              {PRO_FEATURES.map((f, i) => (
                <motion.li key={f} initial={{ opacity: 0, x: -8 }} whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }} transition={{ delay: 0.1 + i * 0.05 }}
                  className="flex items-center gap-2.5 text-sm font-medium" style={{ color: "#18130E" }}>
                  <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0 border"
                    style={{ background: "rgba(232,101,26,0.15)", borderColor: "rgba(232,101,26,0.3)" }}>
                    <Check className="w-2.5 h-2.5" style={{ color: "#E8651A" }} />
                  </div>
                  {f}
                </motion.li>
              ))}
            </ul>

            {isPro ? (
              <div className="w-full rounded-2xl py-3 text-sm font-bold text-center border"
                style={{ background: "#ECFDF5", borderColor: "rgba(5,150,105,0.3)", color: "#059669" }}>
                ✓ You&apos;re on Pro
              </div>
            ) : (
              <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                onClick={handleUpgrade} disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-bold transition-all disabled:opacity-60"
                style={{ background: "#E8651A", color: "white",
                  boxShadow: "0 6px 20px rgba(232,101,26,0.4)" }}>
                <Zap className="w-4 h-4" />
                {loading ? "Loading..." : "Upgrade to Pro"}
                {!loading && <ArrowRight className="w-4 h-4" />}
              </motion.button>
            )}
          </motion.div>
        </div>

        {/* What you get */}
        <InView>
          <div className="mb-20">
            <div className="text-center mb-10">
              <p className="section-label mb-2">Every analysis includes</p>
              <h2 className="text-2xl sm:text-3xl font-black" style={{ color: "#18130E", fontFamily: "var(--font-syne,'Syne',sans-serif)" }}>
                What you get with every analysis
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {FEATURES_DETAIL.map(({ icon: Icon, title, desc, accent }, i) => {
                const cfg = accentMap[accent as keyof typeof accentMap]
                return (
                  <motion.div key={title}
                    custom={i} variants={cardVariants} initial="hidden" whileInView="show"
                    viewport={{ once: true }}
                    whileHover={{ y: -4, boxShadow: `0 16px 40px ${cfg.glow}` }}
                    className="premium-card p-5 cursor-default transition-all"
                  >
                    <div className="w-10 h-10 rounded-xl border flex items-center justify-center mb-4"
                      style={{ background: cfg.iconBg, borderColor: cfg.border }}>
                      <Icon className="w-4.5 h-4.5" style={{ color: cfg.iconColor }} />
                    </div>
                    <h3 className="font-bold text-sm mb-1.5" style={{ color: "#18130E" }}>{title}</h3>
                    <p className="text-xs leading-relaxed" style={{ color: "#6B5E52" }}>{desc}</p>
                  </motion.div>
                )
              })}
            </div>
          </div>
        </InView>

        {/* FAQ */}
        <InView>
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-10">
              <p className="section-label mb-2">Got questions?</p>
              <h2 className="text-2xl sm:text-3xl font-black" style={{ color: "#18130E", fontFamily: "var(--font-syne,'Syne',sans-serif)" }}>
                Frequently asked questions
              </h2>
            </div>
            <div className="space-y-3">
              {FAQ.map((item, i) => (
                <motion.div key={i}
                  initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }} transition={{ delay: i * 0.06 }}
                  className="premium-card overflow-hidden">
                  <motion.button
                    className="w-full flex items-center justify-between px-5 py-4 text-left"
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    whileTap={{ scale: 0.99 }}
                  >
                    <span className="font-semibold text-sm pr-4" style={{ color: "#18130E" }}>{item.q}</span>
                    <motion.div
                      animate={{ rotate: openFaq === i ? 90 : 0 }}
                      transition={{ duration: 0.2 }}>
                      <ChevronRight className="w-4 h-4 shrink-0" style={{ color: "#A89484" }} />
                    </motion.div>
                  </motion.button>

                  <AnimatePresence>
                    {openFaq === i && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                        style={{ overflow: "hidden" }}>
                        <div className="px-5 pb-5 pt-0 border-t" style={{ borderColor: "#F2EDE6" }}>
                          <p className="text-sm leading-relaxed pt-4" style={{ color: "#6B5E52" }}>{item.a}</p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </div>
          </div>
        </InView>

        {/* Bottom CTA */}
        <InView delay={0.1}>
          <div className="mt-20 text-center">
            <motion.div
              whileHover={{ scale: 1.01 }}
              className="inline-block rounded-3xl border px-10 py-10 max-w-lg w-full"
              style={{ background: "white", borderColor: "#E8E2D9",
                boxShadow: "0 8px 40px rgba(24,19,14,0.06)" }}>
              <div className="w-14 h-14 rounded-2xl mx-auto mb-5 flex items-center justify-center border"
                style={{ background: "#FEF0E6", borderColor: "rgba(232,101,26,0.2)" }}>
                <Shield className="w-7 h-7" style={{ color: "#E8651A" }} />
              </div>
              <h3 className="text-2xl font-black mb-2"
                style={{ color: "#18130E", fontFamily: "var(--font-syne,'Syne',sans-serif)" }}>
                Ready to fight back?
              </h3>
              <p className="text-sm mb-6" style={{ color: "#6B5E52" }}>
                Upload your first document free. No credit card needed.
              </p>
              <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                onClick={() => router.push("/")}
                className="btn-primary mx-auto">
                Analyze a Document <ArrowRight className="w-4 h-4" />
              </motion.button>
            </motion.div>
          </div>
        </InView>

        <p className="text-center text-xs mt-12" style={{ color: "#CFC8BE" }}>
          This is not legal advice. ClearDoc provides general information only.
        </p>
      </div>

      <AnimatePresence>
        {showAuth && (
          <AuthModal
            mode="signup"
            onClose={() => setShowAuth(false)}
            onSuccess={() => { setShowAuth(false); handleUpgrade() }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
